import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import { analyzeCivicReportWithAI, findPotentialDuplicates } from '../ai.ts';
import { sendAndLogSms, sendEmail } from '../communications.ts';
import { STORAGE_MEDIA_DIR, db, getDepartmentIdForCategory } from '../db.ts';
import { reverseGeocodeCoords } from '../places.ts';
import {
  broadcastToAuthorities,
  broadcastToUser,
  createAndPushNotification,
  notifyAllAuthorities,
} from '../realtime.ts';
import { type AuthedRequest, logAudit, requireAuth, requireAuthority, requireCitizen } from '../security.ts';

export const reportsRouter = express.Router();

const ALLOWED_CATEGORIES = [
  'Roads and Potholes',
  'Waste Management',
  'Drainage and Waterlogging',
  'Traffic and Road Obstructions',
  'Medical Assistance',
  'Women and Child Safety',
  'Road Accident',
  'Animal Rescue',
  'Other Civic Issues',
] as const;

const mediaStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, STORAGE_MEDIA_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').replace(/[^a-zA-Z0-9.]/g, '') || '.bin';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const reportUpload = multer({
  storage: mediaStorage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max for video; photos checked <= 10MB below
    files: 6,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only valid image and video files are supported as evidence.'));
    }
  },
});

function generateReportTrackingCode(): string {
  const year = new Date().getFullYear();
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `SEVA-${year}-${suffix}`;
}

export function normalizeLegacyCategory(cat: string): (typeof ALLOWED_CATEGORIES)[number] {
  if (cat.toLowerCase().includes('animal') || cat.toLowerCase().includes('wildlife')) {
    return 'Animal Rescue';
  }
  if (cat.toLowerCase().includes('other')) {
    return 'Other Civic Issues';
  }
  if ((ALLOWED_CATEGORIES as readonly string[]).includes(cat)) {
    return cat as (typeof ALLOWED_CATEGORIES)[number];
  }
  return 'Other Civic Issues';
}

function hydrateReport(reportRow: any, includeCitizenContact: boolean) {
  const media = db.prepare(`
    SELECT id, media_kind, original_filename, mime_type, size_bytes, duration_seconds, created_at
    FROM report_media
    WHERE report_id = ?
    ORDER BY created_at ASC
  `).all(reportRow.id) as any[];

  const history = db.prepare(`
    SELECT h.*, u.full_name as updated_by_name, u.role as updated_by_role
    FROM report_status_history h
    JOIN users u ON u.id = h.updated_by
    WHERE h.report_id = ?
    ORDER BY h.created_at ASC
  `).all(reportRow.id);

  return {
    id: reportRow.id,
    trackingCode: reportRow.tracking_code,
    citizenId: reportRow.citizen_id,
    citizenName: reportRow.citizen_name,
    citizenPhone: includeCitizenContact ? (reportRow.contact_phone || reportRow.citizen_phone) : null,
    citizenEmail: includeCitizenContact ? (reportRow.contact_email || reportRow.citizen_email) : null,
    category: reportRow.category,
    subType: reportRow.sub_type,
    title: reportRow.title,
    description: reportRow.description,
    severity: reportRow.severity,
    status: reportRow.status,
    ward: reportRow.ward || reportRow.loc_ward,
    incidentTimestamp: reportRow.incident_timestamp,
    assignedDepartmentId: reportRow.assigned_department_id,
    assignedDepartmentName: reportRow.department_name,
    assignedOfficerId: reportRow.assigned_officer_id,
    assignedOfficerName: reportRow.officer_name || null,
    aiSuggestedCategory: reportRow.ai_suggested_category,
    aiSuggestedSeverity: reportRow.ai_suggested_severity,
    aiSummary: reportRow.ai_summary,
    aiConfidence: reportRow.ai_confidence,
    isSensitive: Boolean(reportRow.is_sensitive),
    adminHeatmapApproved: Boolean(reportRow.admin_heatmap_approved),
    isVerifiedCivic: Boolean(reportRow.is_verified_civic),
    isDuplicate: Boolean(reportRow.is_duplicate),
    resolutionDescription: reportRow.resolution_description,
    resolvedAt: reportRow.resolved_at,
    rejectionReason: reportRow.rejection_reason,
    escalationLevel: reportRow.escalation_level,
    createdAt: reportRow.created_at,
    updatedAt: reportRow.updated_at,
    location:
      typeof reportRow.latitude === 'number'
        ? {
            latitude: reportRow.latitude,
            longitude: reportRow.longitude,
            accuracyMeters: reportRow.accuracy_meters,
            source: reportRow.location_source,
            formattedAddress: reportRow.formatted_address,
            ward: reportRow.loc_ward,
            capturedAt: reportRow.captured_at,
          }
        : null,
    media: media.map((m) => ({
      ...m,
      url: `/api/reports/media/${m.id}`,
    })),
    history,
  };
}

// AI Analysis endpoint (server-side Gemini + duplicate detection)
reportsRouter.post('/ai-analyze', requireAuth, async (req: AuthedRequest, res) => {
  const { description, title, selectedCategory, imageBase64, imageMimeType, latitude, longitude } = req.body || {};
  const result = await analyzeCivicReportWithAI({
    description,
    title,
    selectedCategory,
    imageBase64,
    imageMimeType,
    latitude: typeof latitude === 'number' ? latitude : null,
    longitude: typeof longitude === 'number' ? longitude : null,
  });
  res.json(result);
});

// Citizen submits a new civic/accident/safety report with real evidence & GPS
reportsRouter.post(
  '/',
  requireCitizen,
  reportUpload.fields([
    { name: 'photos', maxCount: 5 },
    { name: 'video', maxCount: 1 },
  ]),
  async (req: AuthedRequest, res) => {
    const files = (req.files as Record<string, Express.Multer.File[]>) || {};
    const photos = files.photos || [];
    const videos = files.video || [];

    // Validate photo <= 10MB and video <= 50MB
    for (const p of photos) {
      if (!p.mimetype.startsWith('image/') || p.size > 10 * 1024 * 1024) {
        for (const f of [...photos, ...videos]) fs.existsSync(f.path) && fs.unlinkSync(f.path);
        res.status(400).json({ error: `Photo "${p.originalname}" exceeds 10 MB or is not a valid image.` });
        return;
      }
    }
    for (const v of videos) {
      if (!v.mimetype.startsWith('video/') || v.size > 50 * 1024 * 1024) {
        for (const f of [...photos, ...videos]) fs.existsSync(f.path) && fs.unlinkSync(f.path);
        res.status(400).json({ error: `Video "${v.originalname}" exceeds 50 MB or is not a valid video.` });
        return;
      }
    }

    const schema = z.object({
      category: z.string().min(2),
      departmentId: z.string().max(64).optional(),
      subType: z.string().max(120).optional(),
      title: z.string().min(3).max(180),
      description: z.string().min(5).max(4000),
      severity: z.enum(['Low', 'Medium', 'High', 'Critical']),
      latitude: z.coerce.number().min(-90).max(90),
      longitude: z.coerce.number().min(-180).max(180),
      accuracyMeters: z.coerce.number().optional(),
      locationSource: z.enum(['gps', 'manual']).default('gps'),
      formattedAddress: z.string().max(400).optional(),
      ward: z.string().max(120).optional(),
      incidentTimestamp: z.string().optional(),
      contactPhone: z.string().max(30).optional(),
      contactEmail: z.string().max(160).optional(),
      aiSuggestedCategory: z.string().optional(),
      aiSuggestedSeverity: z.string().optional(),
      aiSummary: z.string().optional(),
      aiConfidence: z.coerce.number().optional(),
      locationConsent: z.coerce.boolean().default(true),
      videoDurationSeconds: z.coerce.number().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      for (const f of [...photos, ...videos]) fs.existsSync(f.path) && fs.unlinkSync(f.path);
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid report submission data.' });
      return;
    }

    const d = parsed.data;
    if (d.videoDurationSeconds && d.videoDurationSeconds > 60) {
      for (const f of [...photos, ...videos]) fs.existsSync(f.path) && fs.unlinkSync(f.path);
      res.status(400).json({ error: 'Video evidence cannot exceed 60 seconds.' });
      return;
    }

    const category = normalizeLegacyCategory(d.category);

    // Prevent accidental duplicate report submission (same citizen, category, and title within 120 seconds)
    const recentSame = db.prepare(`
      SELECT id, tracking_code FROM reports
      WHERE citizen_id = ? AND category = ? AND LOWER(TRIM(title)) = LOWER(?)
        AND datetime(created_at) >= datetime('now', '-120 seconds')
      ORDER BY created_at DESC LIMIT 1
    `).get(req.user!.id, category, d.title.trim()) as { id: string; tracking_code: string } | undefined;

    if (recentSame) {
      for (const f of [...photos, ...videos]) fs.existsSync(f.path) && fs.unlinkSync(f.path);
      res.status(409).json({
        error: `Duplicate submission prevented: report ${recentSame.tracking_code} with this exact title was already submitted moments ago.`,
        duplicateReportId: recentSame.id,
        trackingCode: recentSame.tracking_code,
      });
      return;
    }

    let departmentId = getDepartmentIdForCategory(category);
    if (d.departmentId) {
      const validDept = db.prepare('SELECT id FROM departments WHERE id = ? AND is_active = 1').get(d.departmentId) as { id: string } | undefined;
      if (validDept) {
        departmentId = validDept.id;
      }
    }
    const reportId = crypto.randomUUID();
    const trackingCode = generateReportTrackingCode();
    const nowIso = new Date().toISOString();

    let resolvedAddress = d.formattedAddress || '';
    let resolvedWard = d.ward || null;
    if (!resolvedAddress) {
      const geo = await reverseGeocodeCoords(d.latitude, d.longitude);
      resolvedAddress = geo.formattedAddress;
      resolvedWard = resolvedWard || geo.ward;
    }

    const isSensitive = category === 'Women and Child Safety' ? 1 : 0;
    const dupMatches = findPotentialDuplicates({
      category,
      title: d.title,
      latitude: d.latitude,
      longitude: d.longitude,
    });

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO reports (
          id, tracking_code, citizen_id, category, sub_type, title, description, severity, status,
          contact_phone, contact_email, ward, incident_timestamp, assigned_department_id,
          ai_suggested_category, ai_suggested_severity, ai_summary, ai_confidence,
          is_sensitive, is_duplicate, duplicate_of_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        reportId,
        trackingCode,
        req.user!.id,
        category,
        d.subType || null,
        d.title.trim(),
        d.description.trim(),
        d.severity,
        d.contactPhone || req.user!.phone,
        d.contactEmail || req.user!.email,
        resolvedWard,
        d.incidentTimestamp || nowIso,
        departmentId,
        d.aiSuggestedCategory || null,
        d.aiSuggestedSeverity || null,
        d.aiSummary || null,
        d.aiConfidence ?? null,
        isSensitive,
        dupMatches.length > 0 ? 1 : 0,
        dupMatches[0]?.id || null,
        nowIso,
        nowIso
      );

      db.prepare(`
        INSERT INTO report_locations (id, report_id, latitude, longitude, accuracy_meters, location_source, formatted_address, ward, captured_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        reportId,
        d.latitude,
        d.longitude,
        d.accuracyMeters ?? null,
        d.locationSource,
        resolvedAddress,
        resolvedWard,
        nowIso
      );

      for (const p of photos) {
        db.prepare(`
          INSERT INTO report_media (id, report_id, uploader_id, media_kind, stored_filename, original_filename, mime_type, size_bytes, latitude, longitude, location_consent)
          VALUES (?, ?, ?, 'evidence_photo', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(),
          reportId,
          req.user!.id,
          p.filename,
          p.originalname,
          p.mimetype,
          p.size,
          d.locationConsent ? d.latitude : null,
          d.locationConsent ? d.longitude : null,
          d.locationConsent ? 1 : 0
        );
      }

      for (const v of videos) {
        db.prepare(`
          INSERT INTO report_media (id, report_id, uploader_id, media_kind, stored_filename, original_filename, mime_type, size_bytes, duration_seconds, latitude, longitude, location_consent)
          VALUES (?, ?, ?, 'evidence_video', ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(),
          reportId,
          req.user!.id,
          v.filename,
          v.originalname,
          v.mimetype,
          v.size,
          d.videoDurationSeconds ?? null,
          d.locationConsent ? d.latitude : null,
          d.locationConsent ? d.longitude : null,
          d.locationConsent ? 1 : 0
        );
      }

      db.prepare(`
        INSERT INTO report_status_history (id, report_id, previous_status, new_status, updated_by, action_note, created_at)
        VALUES (?, ?, NULL, 'SUBMITTED', ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        reportId,
        req.user!.id,
        `Report submitted by citizen and automatically routed to department.`,
        nowIso
      );
    });
    tx();

    // Notify Citizen in-app & via logged SMS confirmation
    createAndPushNotification({
      userId: req.user!.id,
      category: 'REPORT_SUBMITTED',
      title: `Report ${trackingCode} Submitted`,
      message: `Your ${category} report "${d.title.trim()}" has been received and routed for authority review.`,
      linkPath: `/citizen/reports/${reportId}`,
      relatedId: reportId,
    });

    const citizenPrefs = db.prepare(`
      SELECT u.phone, u.phone_verified, p.notify_sms
      FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ?
    `).get(req.user!.id) as any;

    let smsConfirmation: any = null;
    if (citizenPrefs?.phone_verified && (citizenPrefs?.notify_sms ?? 1)) {
      smsConfirmation = await sendAndLogSms({
        userId: req.user!.id,
        recipientPhone: citizenPrefs.phone,
        eventType: 'REPORT_SUBMITTED',
        relatedId: reportId,
        message: `SEVA AI: Your civic complaint ${trackingCode} has been successfully registered. You can track its status through your SEVA AI account.`,
        dedupeWindowSec: 30,
      });
    }

    // Notify ALL Authority officers in real time
    const urgent = d.severity === 'Critical' || category === 'Road Accident' || category === 'Women and Child Safety' || category === 'Medical Assistance';
    notifyAllAuthorities({
      category: urgent ? 'URGENT_REPORT' : 'NEW_REPORT',
      title: `${urgent ? 'URGENT ' : ''}New ${category} Report (${trackingCode})`,
      message: `${d.severity} severity: "${d.title.trim()}" at ${resolvedAddress}`,
      linkPath: `/authority/reports/${reportId}`,
      relatedId: reportId,
      priority: urgent ? 'emergency' : 'high',
    });

    broadcastToAuthorities({
      type: 'report:created',
      reportId,
      trackingCode,
      category,
      severity: d.severity,
      title: d.title.trim(),
      createdAt: nowIso,
    });

    logAudit({
      actorUserId: req.user!.id,
      actorRole: 'citizen',
      action: 'REPORT_CREATED',
      resourceType: 'report',
      resourceId: reportId,
      detail: `trackingCode=${trackingCode}, category=${category}`,
      ipAddress: req.ip,
    });

    res.status(201).json({
      reportId,
      trackingCode,
      status: 'SUBMITTED',
      assignedDepartmentId: departmentId,
      potentialDuplicates: dupMatches,
      smsConfirmation,
    });
  }
);

// Citizen My Reports (strictly only logged-in citizen's own reports)
reportsRouter.get('/my', requireCitizen, (req: AuthedRequest, res) => {
  const rows = db.prepare(`
    SELECT r.*, u.full_name as citizen_name, u.phone as citizen_phone, u.email as citizen_email,
           d.name as department_name, ou.full_name as officer_name,
           rl.latitude, rl.longitude, rl.accuracy_meters, rl.location_source, rl.formatted_address, rl.ward as loc_ward, rl.captured_at
    FROM reports r
    JOIN users u ON u.id = r.citizen_id
    LEFT JOIN departments d ON d.id = r.assigned_department_id
    LEFT JOIN users ou ON ou.id = r.assigned_officer_id
    LEFT JOIN report_locations rl ON rl.report_id = r.id
    WHERE r.citizen_id = ?
    ORDER BY r.created_at DESC
  `).all(req.user!.id) as any[];

  res.json({
    reports: rows.map((r) => hydrateReport(r, true)),
  });
});

// Authority Portal: All citizen reports visible immediately after authentication (NO permission-request wall!)
reportsRouter.get('/', requireAuthority, (req: AuthedRequest, res) => {
  const { category, severity, status, departmentId, ward, dateFrom, dateTo, search } = req.query as Record<string, string | undefined>;

  const where: string[] = ['1=1'];
  const params: any[] = [];

  if (category && category !== 'ALL') {
    where.push('r.category = ?');
    params.push(category);
  }
  if (severity && severity !== 'ALL') {
    where.push('r.severity = ?');
    params.push(severity);
  }
  if (status && status !== 'ALL') {
    where.push('r.status = ?');
    params.push(status);
  }
  if (departmentId && departmentId !== 'ALL') {
    where.push('r.assigned_department_id = ?');
    params.push(departmentId);
  }
  if (ward) {
    where.push('(LOWER(COALESCE(r.ward, rl.ward, \'\')) LIKE ?)');
    params.push(`%${ward.toLowerCase()}%`);
  }
  if (dateFrom) {
    where.push('date(r.created_at) >= date(?)');
    params.push(dateFrom);
  }
  if (dateTo) {
    where.push('date(r.created_at) <= date(?)');
    params.push(dateTo);
  }
  if (search) {
    const q = `%${search.toLowerCase()}%`;
    where.push('(LOWER(r.tracking_code) LIKE ? OR LOWER(r.title) LIKE ? OR LOWER(r.description) LIKE ? OR LOWER(u.full_name) LIKE ?)');
    params.push(q, q, q, q);
  }

  const rows = db.prepare(`
    SELECT r.*, u.full_name as citizen_name, u.phone as citizen_phone, u.email as citizen_email,
           d.name as department_name, ou.full_name as officer_name,
           rl.latitude, rl.longitude, rl.accuracy_meters, rl.location_source, rl.formatted_address, rl.ward as loc_ward, rl.captured_at
    FROM reports r
    JOIN users u ON u.id = r.citizen_id
    LEFT JOIN departments d ON d.id = r.assigned_department_id
    LEFT JOIN users ou ON ou.id = r.assigned_officer_id
    LEFT JOIN report_locations rl ON rl.report_id = r.id
    WHERE ${where.join(' AND ')}
    ORDER BY
      CASE r.status WHEN 'ESCALATED' THEN 0 WHEN 'SUBMITTED' THEN 1 ELSE 2 END,
      r.created_at DESC
  `).all(...params) as any[];

  // Real database overview counts
  const counts = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status IN ('SUBMITTED', 'RECEIVED') THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'ASSIGNED' THEN 1 ELSE 0 END) as assigned,
      SUM(CASE WHEN status = 'UNDER REVIEW' THEN 1 ELSE 0 END) as underReview,
      SUM(CASE WHEN status = 'IN PROGRESS' THEN 1 ELSE 0 END) as inProgress,
      SUM(CASE WHEN status = 'RESOLVED' THEN 1 ELSE 0 END) as resolved,
      SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) as rejected,
      SUM(CASE WHEN status = 'ESCALATED' THEN 1 ELSE 0 END) as escalated,
      SUM(CASE WHEN category = 'Road Accident' AND status != 'RESOLVED' THEN 1 ELSE 0 END) as accidentAlerts
    FROM reports
  `).get() as any;

  const medicalCount = (db.prepare("SELECT COUNT(*) as c FROM medical_requests WHERE status != 'Resolved'").get() as { c: number }).c;
  const activeSosCount = (db.prepare("SELECT COUNT(*) as c FROM sos_events WHERE status != 'SAFE_RESOLVED'").get() as { c: number }).c;

  res.json({
    reports: rows.map((r) => hydrateReport(r, true)),
    overview: {
      total: counts.total || 0,
      pending: counts.pending || 0,
      assigned: counts.assigned || 0,
      underReview: counts.underReview || 0,
      inProgress: counts.inProgress || 0,
      resolved: counts.resolved || 0,
      rejected: counts.rejected || 0,
      escalated: counts.escalated || 0,
      medicalEmergencies: medicalCount,
      activeSos: activeSosCount,
      accidentAlerts: counts.accidentAlerts || 0,
    },
  });
});

// Get single report detail (ownership enforced for citizen; full access for authenticated authority)
reportsRouter.get('/:id', requireAuth, (req: AuthedRequest, res) => {
  const row = db.prepare(`
    SELECT r.*, u.full_name as citizen_name, u.phone as citizen_phone, u.email as citizen_email,
           d.name as department_name, ou.full_name as officer_name,
           rl.latitude, rl.longitude, rl.accuracy_meters, rl.location_source, rl.formatted_address, rl.ward as loc_ward, rl.captured_at
    FROM reports r
    JOIN users u ON u.id = r.citizen_id
    LEFT JOIN departments d ON d.id = r.assigned_department_id
    LEFT JOIN users ou ON ou.id = r.assigned_officer_id
    LEFT JOIN report_locations rl ON rl.report_id = r.id
    WHERE r.id = ?
  `).get(req.params.id) as any;

  if (!row) {
    res.status(404).json({ error: 'Report not found.' });
    return;
  }

  if (req.user!.role === 'citizen' && row.citizen_id !== req.user!.id) {
    res.status(403).json({ error: 'You do not have permission to view another citizen report.' });
    return;
  }

  res.json({ report: hydrateReport(row, true) });
});

// Evaluate and award citizen points & badges upon authority verification/resolution
export function evaluateCitizenRewards(citizenId: string, reportId: string, actorAuthorityId: string) {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId) as any;
  if (!report || report.is_duplicate || report.status === 'REJECTED') return;

  const cfg = db.prepare('SELECT * FROM badge_config ORDER BY min_verified_reports ASC').all() as any[];
  const baseCfg = cfg[0] || {
    points_per_verified: 25,
    points_per_evidence: 10,
    points_per_location: 5,
    points_per_resolved: 20,
    points_per_medical: 30,
    daily_point_cap: 150,
  };

  // Check daily point cap
  const todayEarned = (db.prepare(`
    SELECT COALESCE(SUM(points), 0) as total
    FROM citizen_points
    WHERE citizen_id = ? AND date(created_at) = date('now') AND points > 0
  `).get(citizenId) as { total: number }).total;

  let pointsToAward = 0;
  const reasons: string[] = [];

  // Verified civic report points (only once per report)
  const alreadyVerifiedPts = db.prepare(
    "SELECT id FROM citizen_points WHERE report_id = ? AND reason LIKE 'Verified Civic Report%'"
  ).get(reportId);

  if (!alreadyVerifiedPts && report.is_verified_civic) {
    pointsToAward += baseCfg.points_per_verified;
    reasons.push('Verified Civic Report');

    const hasMedia = (db.prepare('SELECT COUNT(*) as c FROM report_media WHERE report_id = ?').get(reportId) as { c: number }).c > 0;
    if (hasMedia) {
      pointsToAward += baseCfg.points_per_evidence;
      reasons.push('Photo/Video Evidence');
    }

    const hasGps = db.prepare("SELECT id FROM report_locations WHERE report_id = ? AND location_source = 'gps'").get(reportId);
    if (hasGps) {
      pointsToAward += baseCfg.points_per_location;
      reasons.push('Accurate GPS');
    }

    if (report.category === 'Medical Assistance') {
      pointsToAward += baseCfg.points_per_medical;
      reasons.push('Medical Assistance');
    }
  }

  // Resolution bonus (only once per report)
  const alreadyResolvedPts = db.prepare(
    "SELECT id FROM citizen_points WHERE report_id = ? AND reason LIKE '%Resolved Report%'"
  ).get(reportId);

  if (!alreadyResolvedPts && report.status === 'RESOLVED') {
    pointsToAward += baseCfg.points_per_resolved;
    reasons.push('Resolved Report');
  }

  const remainingCap = Math.max(0, baseCfg.daily_point_cap - todayEarned);
  const finalPoints = Math.min(pointsToAward, remainingCap);

  if (finalPoints > 0) {
    db.prepare(`
      INSERT INTO citizen_points (id, citizen_id, report_id, points, reason, awarded_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), citizenId, reportId, finalPoints, reasons.join(' + '), actorAuthorityId);
  }

  // Recalculate totals & leaderboard
  const totalPts = (db.prepare('SELECT COALESCE(SUM(points), 0) as total FROM citizen_points WHERE citizen_id = ?').get(citizenId) as { total: number }).total;
  const verifiedCount = (db.prepare('SELECT COUNT(*) as c FROM reports WHERE citizen_id = ? AND is_verified_civic = 1 AND is_duplicate = 0').get(citizenId) as { c: number }).c;
  const resolvedCount = (db.prepare("SELECT COUNT(*) as c FROM reports WHERE citizen_id = ? AND status = 'RESOLVED'").get(citizenId) as { c: number }).c;
  const profile = db.prepare('SELECT ward FROM user_profiles WHERE user_id = ?').get(citizenId) as { ward?: string } | undefined;

  db.prepare(`
    INSERT INTO leaderboard_records (citizen_id, total_points, verified_reports, resolved_reports, ward, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(citizen_id) DO UPDATE SET
      total_points = excluded.total_points,
      verified_reports = excluded.verified_reports,
      resolved_reports = excluded.resolved_reports,
      ward = COALESCE(excluded.ward, leaderboard_records.ward),
      updated_at = datetime('now')
  `).run(citizenId, Math.max(0, totalPts), verifiedCount, resolvedCount, profile?.ward || null);

  // Check standard tier badges
  const awardBadge = (code: string, name: string, note: string) => {
    const exists = db.prepare('SELECT id FROM citizen_badges WHERE citizen_id = ? AND badge_code = ?').get(citizenId, code);
    if (!exists) {
      db.prepare(`
        INSERT INTO citizen_badges (id, citizen_id, badge_code, badge_name, audit_note)
        VALUES (?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), citizenId, code, name, note);

      createAndPushNotification({
        userId: citizenId,
        category: 'BADGE_EARNED',
        title: `New Civic Badge Unlocked: ${name}`,
        message: `You earned the ${name} badge for verified civic contributions.`,
        linkPath: '/citizen/rewards',
      });
    }
  };

  for (const tier of cfg) {
    if (verifiedCount >= tier.min_verified_reports) {
      awardBadge(tier.badge_code, tier.badge_name, `Reached ${tier.min_verified_reports} verified reports.`);
    }
  }

  // Special badges
  if (verifiedCount >= 1) {
    awardBadge('FIRST_REPORT', 'First Report', 'First verified civic report submitted.');
  }
  const medCount = (db.prepare("SELECT COUNT(*) as c FROM reports WHERE citizen_id = ? AND is_verified_civic = 1 AND category = 'Medical Assistance'").get(citizenId) as { c: number }).c;
  if (medCount >= 1) {
    awardBadge('FIRST_MEDICAL_REPORT', 'First Medical Assistance Report', 'Submitted verified medical assistance report.');
  }
  const distinctMonths = (db.prepare(`
    SELECT COUNT(DISTINCT strftime('%Y-%m', created_at)) as m
    FROM reports
    WHERE citizen_id = ? AND is_verified_civic = 1 AND is_duplicate = 0
  `).get(citizenId) as { m: number }).m;
  if (distinctMonths >= 3) {
    awardBadge('CONSISTENT_REPORTER', 'Consistent Reporter', 'Verified reports across 3 distinct calendar months.');
  }
  const safetyHeroCount = (db.prepare(`
    SELECT COUNT(*) as c FROM reports
    WHERE citizen_id = ? AND is_verified_civic = 1 AND status = 'RESOLVED'
      AND category IN ('Women and Child Safety', 'Medical Assistance', 'Road Accident')
  `).get(citizenId) as { c: number }).c;
  if (safetyHeroCount >= 1) {
    awardBadge('SAFETY_HERO', 'Safety Hero', 'Verified report contributed to a confirmed resolved emergency/police/medical action.');
  }
}

// Authority updates report status, assigns department/officer, uploads resolution evidence
reportsRouter.patch(
  '/:id/status',
  requireAuthority,
  reportUpload.single('resolutionPhoto'),
  async (req: AuthedRequest, res) => {
    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id) as any;
    if (!report) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(404).json({ error: 'Report not found.' });
      return;
    }

    const schema = z.object({
      status: z.enum([
        'SUBMITTED',
        'RECEIVED',
        'UNDER REVIEW',
        'ASSIGNED',
        'IN PROGRESS',
        'RESOLVED',
        'REJECTED',
        'REOPENED',
        'ESCALATED',
      ]),
      actionNote: z.string().max(2000).optional(),
      assignedDepartmentId: z.string().optional(),
      assignedOfficerId: z.string().optional().nullable(),
      resolutionDescription: z.string().max(2000).optional(),
      rejectionReason: z.string().max(1000).optional(),
      adminHeatmapApproved: z.coerce.boolean().optional(),
      isVerifiedCivic: z.coerce.boolean().optional(),
      isDuplicate: z.coerce.boolean().optional(),
      applyFalseReportPenalty: z.coerce.boolean().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(400).json({ error: 'Invalid status update payload.' });
      return;
    }

    const d = parsed.data;

    if (d.status === 'RESOLVED' && (!d.resolutionDescription || d.resolutionDescription.trim().length < 5)) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(400).json({ error: 'Resolution details are mandatory before marking a report as RESOLVED.' });
      return;
    }

    if (d.status === 'REJECTED' && (!d.rejectionReason || d.rejectionReason.trim().length < 5)) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(400).json({ error: 'A clear rejection reason is required when rejecting a report.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const resolvedAt = d.status === 'RESOLVED' ? nowIso : report.resolved_at;
    const verifiedCivic =
      d.isVerifiedCivic !== undefined
        ? d.isVerifiedCivic ? 1 : 0
        : ['RECEIVED', 'UNDER REVIEW', 'ASSIGNED', 'IN PROGRESS', 'RESOLVED'].includes(d.status)
          ? 1
          : report.is_verified_civic;

    const heatmapApproved =
      d.adminHeatmapApproved !== undefined
        ? d.adminHeatmapApproved ? 1 : 0
        : report.admin_heatmap_approved;

    let evidenceMediaId: string | null = null;

    db.transaction(() => {
      if (req.file) {
        evidenceMediaId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO report_media (id, report_id, uploader_id, media_kind, stored_filename, original_filename, mime_type, size_bytes)
          VALUES (?, ?, ?, 'resolution_photo', ?, ?, ?, ?)
        `).run(
          evidenceMediaId,
          report.id,
          req.user!.id,
          req.file.filename,
          req.file.originalname,
          req.file.mimetype,
          req.file.size
        );
      }

      db.prepare(`
        UPDATE reports
        SET status = ?,
            assigned_department_id = COALESCE(?, assigned_department_id),
            assigned_officer_id = COALESCE(?, assigned_officer_id),
            resolution_description = COALESCE(?, resolution_description),
            resolved_at = ?,
            rejection_reason = COALESCE(?, rejection_reason),
            admin_heatmap_approved = ?,
            is_verified_civic = ?,
            is_duplicate = COALESCE(?, is_duplicate),
            updated_at = ?
        WHERE id = ?
      `).run(
        d.status,
        d.assignedDepartmentId || null,
        d.assignedOfficerId === undefined ? null : d.assignedOfficerId,
        d.resolutionDescription?.trim() || null,
        resolvedAt,
        d.rejectionReason?.trim() || null,
        heatmapApproved,
        verifiedCivic,
        d.isDuplicate === undefined ? null : d.isDuplicate ? 1 : 0,
        nowIso,
        report.id
      );

      if (d.assignedDepartmentId) {
        db.prepare(`
          INSERT INTO assignments (id, report_id, department_id, officer_id, assigned_by, note)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(),
          report.id,
          d.assignedDepartmentId,
          d.assignedOfficerId || null,
          req.user!.id,
          d.actionNote || `Assigned to department`
        );
      }

      db.prepare(`
        INSERT INTO report_status_history (id, report_id, previous_status, new_status, updated_by, action_note, evidence_media_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        report.id,
        report.status,
        d.status,
        req.user!.id,
        d.actionNote?.trim() || d.resolutionDescription?.trim() || d.rejectionReason?.trim() || `Status updated to ${d.status}`,
        evidenceMediaId,
        nowIso
      );

      if (d.status === 'REJECTED' && d.applyFalseReportPenalty) {
        db.prepare(`
          INSERT INTO citizen_points (id, citizen_id, report_id, points, reason, awarded_by)
          VALUES (?, ?, ?, -25, 'False/Abusive Report Penalty', ?)
        `).run(crypto.randomUUID(), report.citizen_id, report.id, req.user!.id);
      }
    })();

    // Re-evaluate points & badges for citizen
    evaluateCitizenRewards(report.citizen_id, report.id, req.user!.id);

    // Notify Citizen in-app & via WebSocket
    createAndPushNotification({
      userId: report.citizen_id,
      category: 'REPORT_STATUS',
      title: `Report ${report.tracking_code}: ${d.status}`,
      message:
        d.actionNote?.trim() ||
        d.resolutionDescription?.trim() ||
        d.rejectionReason?.trim() ||
        `Your report "${report.title}" status is now ${d.status}.`,
      linkPath: `/citizen/reports/${report.id}`,
      relatedId: report.id,
      priority: d.status === 'RESOLVED' ? 'high' : 'normal',
    });

    // Consented SMS/Email status update & persistent SMS logging
    const citizenPrefs = db.prepare(`
      SELECT u.phone, u.email, u.phone_verified, p.notify_sms, p.notify_email
      FROM users u JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ?
    `).get(report.citizen_id) as any;

    let smsNotification: any = null;
    if (citizenPrefs?.phone_verified && citizenPrefs?.notify_sms) {
      let statusSms = `SEVA AI: Your complaint ${report.tracking_code} status has been updated to ${d.status}. Please log in to review details.`;
      if (d.status === 'IN PROGRESS') {
        statusSms = `SEVA AI: Your complaint ${report.tracking_code} is now being processed by the concerned authority.`;
      } else if (d.status === 'RESOLVED') {
        statusSms = `SEVA AI: Your complaint ${report.tracking_code} has been marked as resolved. Please log in to review the resolution details.`;
      }
      smsNotification = await sendAndLogSms({
        userId: report.citizen_id,
        recipientPhone: citizenPrefs.phone,
        eventType: 'REPORT_STATUS_UPDATE',
        relatedId: report.id,
        message: statusSms,
        dedupeWindowSec: 5,
      });
    }
    if (citizenPrefs?.notify_email) {
      await sendEmail(
        citizenPrefs.email,
        `SEVA AI Report ${report.tracking_code} Update: ${d.status}`,
        `<p>Your report <strong>${report.tracking_code}</strong> ("${report.title}") has been updated to <strong>${d.status}</strong>.</p><p>${d.actionNote || d.resolutionDescription || d.rejectionReason || ''}</p>`,
        `Your report ${report.tracking_code} is now ${d.status}.`
      );
    }

    broadcastToUser(report.citizen_id, { type: 'report:updated', reportId: report.id, status: d.status });
    broadcastToAuthorities({ type: 'report:updated', reportId: report.id, status: d.status });

    logAudit({
      actorUserId: req.user!.id,
      actorRole: 'authority',
      action: 'REPORT_STATUS_UPDATED',
      resourceType: 'report',
      resourceId: report.id,
      detail: `${report.status} -> ${d.status}`,
      ipAddress: req.ip,
    });

    res.json({ success: true, status: d.status, smsNotification });
  }
);

// Private media download/stream endpoint (strictly uploader OR authenticated authority)
reportsRouter.get('/media/:mediaId', requireAuth, (req: AuthedRequest, res) => {
  const media = db.prepare(`
    SELECT rm.*, r.citizen_id
    FROM report_media rm
    JOIN reports r ON r.id = rm.report_id
    WHERE rm.id = ?
  `).get(req.params.mediaId) as any;

  if (!media) {
    res.status(404).json({ error: 'Media evidence not found.' });
    return;
  }

  if (req.user!.role !== 'authority' && media.citizen_id !== req.user!.id && media.uploader_id !== req.user!.id) {
    res.status(403).json({ error: 'Access denied to private report evidence.' });
    return;
  }

  const filePath = path.join(STORAGE_MEDIA_DIR, media.stored_filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Media file missing from secure storage.' });
    return;
  }

  res.setHeader('Content-Type', media.mime_type);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(filePath);
});
