import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { analyzeCivicTrendsWithAI } from '../ai.ts';
import { sendEmail, sendSms } from '../communications.ts';
import { db } from '../db.ts';
import { createAndPushNotification } from '../realtime.ts';
import { type AuthedRequest, logAudit, requireAuth, requireAuthority, requireCitizen } from '../security.ts';

export const governanceRouter = express.Router();

// ============================================================
// 1. CENTRALIZED NOTIFICATION CENTER & SMS AUDIT LOGS
// ============================================================
governanceRouter.get('/notifications', requireAuth, (req: AuthedRequest, res) => {
  const items = db.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 60
  `).all(req.user!.id);

  const unreadCount = (db.prepare(`
    SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0
  `).get(req.user!.id) as { c: number }).c;

  const smsLogs = db.prepare(`
    SELECT * FROM sms_logs
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 60
  `).all(req.user!.id);

  res.json({ notifications: items, unreadCount, smsLogs });
});

governanceRouter.post('/notifications/sms/:id/retry', requireAuth, async (req: AuthedRequest, res) => {
  const row = db.prepare('SELECT * FROM sms_logs WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id) as any;
  if (!row) {
    res.status(404).json({ error: 'SMS delivery log not found.' });
    return;
  }
  const result = await sendSms(row.recipient_phone, row.message_body);
  db.prepare(`
    UPDATE sms_logs
    SET status = ?, provider = ?, provider_message_id = ?, error_message = ?,
        retry_count = retry_count + 1, updated_at = datetime('now')
    WHERE id = ?
  `).run(result.status, result.provider, result.providerMessageId || null, result.error || null, row.id);

  res.json({
    id: row.id,
    status: result.status,
    provider: result.provider,
    providerMessageId: result.providerMessageId || null,
    error: result.error || null,
  });
});

governanceRouter.post('/notifications/:id/read', requireAuth, (req: AuthedRequest, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
  res.json({ success: true });
});

governanceRouter.post('/notifications/read-all', requireAuth, (req: AuthedRequest, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user!.id);
  res.json({ success: true });
});

governanceRouter.post('/notifications/:id/acknowledge', requireAuth, (req: AuthedRequest, res) => {
  db.prepare(`
    UPDATE notifications
    SET is_read = 1, is_acknowledged = 1, acknowledged_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(req.params.id, req.user!.id);
  res.json({ success: true });
});

// ============================================================
// 2. CITY CRIME & SAFETY HEATMAP (Admin-approved, anonymized)
// ============================================================
governanceRouter.get('/heatmap', (req, res) => {
  const { subType, timeOfDay, dateFrom, dateTo, ward } = req.query as Record<string, string | undefined>;

  const where: string[] = [
    "r.category = 'Women and Child Safety'",
    'r.admin_heatmap_approved = 1',
    "r.status != 'REJECTED'",
  ];
  const params: any[] = [];

  if (subType && subType !== 'ALL') {
    where.push('r.sub_type = ?');
    params.push(subType);
  }
  if (ward) {
    where.push("LOWER(COALESCE(r.ward, rl.ward, '')) LIKE ?");
    params.push(`%${ward.toLowerCase()}%`);
  }
  if (dateFrom) {
    where.push('date(r.incident_timestamp) >= date(?)');
    params.push(dateFrom);
  }
  if (dateTo) {
    where.push('date(r.incident_timestamp) <= date(?)');
    params.push(dateTo);
  }
  if (timeOfDay === 'day') {
    where.push("CAST(strftime('%H', r.incident_timestamp) AS INTEGER) BETWEEN 6 AND 17");
  } else if (timeOfDay === 'night') {
    where.push("(CAST(strftime('%H', r.incident_timestamp) AS INTEGER) >= 18 OR CAST(strftime('%H', r.incident_timestamp) AS INTEGER) < 6)");
  }

  const rows = db.prepare(`
    SELECT r.sub_type, r.severity, r.incident_timestamp, r.ward, r.created_at,
           rl.latitude, rl.longitude, rl.ward as loc_ward
    FROM reports r
    JOIN report_locations rl ON rl.report_id = r.id
    WHERE ${where.join(' AND ')}
    ORDER BY r.created_at DESC
  `).all(...params) as any[];

  // Aggregate into ~300m privacy grid cells (0.003 deg ~ 330m) — never expose reporter identity or exact coordinates
  const cells = new Map<
    string,
    {
      lat: number;
      lng: number;
      count: number;
      weight: number;
      ward: string | null;
      subTypes: Set<string>;
      latestAt: string;
    }
  >();

  const sevWeights: Record<string, number> = { Low: 1, Medium: 2, High: 3.5, Critical: 5 };
  const nowMs = Date.now();

  for (const r of rows) {
    const gridLat = Math.round(r.latitude / 0.003) * 0.003;
    const gridLng = Math.round(r.longitude / 0.003) * 0.003;
    const key = `${gridLat.toFixed(3)}:${gridLng.toFixed(3)}`;

    const ageDays = Math.max(0, (nowMs - new Date(r.incident_timestamp || r.created_at).getTime()) / (86400 * 1000));
    const recencyMultiplier = ageDays <= 7 ? 1.5 : ageDays <= 30 ? 1.15 : 0.8;
    const w = (sevWeights[r.severity] || 2) * recencyMultiplier;

    const existing = cells.get(key);
    if (!existing) {
      cells.set(key, {
        lat: Number(gridLat.toFixed(4)),
        lng: Number(gridLng.toFixed(4)),
        count: 1,
        weight: w,
        ward: r.ward || r.loc_ward || null,
        subTypes: new Set([r.sub_type || 'Safety Incident']),
        latestAt: r.incident_timestamp || r.created_at,
      });
    } else {
      existing.count += 1;
      existing.weight += w;
      existing.subTypes.add(r.sub_type || 'Safety Incident');
      if (r.created_at > existing.latestAt) existing.latestAt = r.created_at;
    }
  }

  const zones = Array.from(cells.values()).map((c) => {
    const riskLevel = c.weight >= 8 || c.count >= 4 ? 'High reported risk' : c.weight >= 4 || c.count >= 2 ? 'Moderate reported risk' : 'Low reported risk';
    return {
      latitude: c.lat,
      longitude: c.lng,
      incidentCount: c.count,
      riskScore: Number(c.weight.toFixed(2)),
      riskLevel,
      ward: c.ward,
      categories: Array.from(c.subTypes),
      latestAt: c.latestAt,
    };
  });

  res.json({
    zones,
    totalApprovedIncidents: rows.length,
    lastUpdatedAt: rows[0]?.created_at || null,
    disclaimer:
      'Heatmap reflects only administrator-approved safety reports aggregated by area grid. Absence of reports never guarantees an area is completely safe.',
  });
});

// ============================================================
// 3. CITIZEN REWARDS, BADGES & POINTS
// ============================================================
governanceRouter.get('/rewards/my', requireCitizen, (req: AuthedRequest, res) => {
  const pointsHistory = db.prepare(`
    SELECT cp.*, r.tracking_code, r.title as report_title
    FROM citizen_points cp
    LEFT JOIN reports r ON r.id = cp.report_id
    WHERE cp.citizen_id = ?
    ORDER BY cp.created_at DESC
  `).all(req.user!.id);

  const badges = db.prepare(`
    SELECT * FROM citizen_badges WHERE citizen_id = ? ORDER BY awarded_at DESC
  `).all(req.user!.id);

  const summary = db.prepare(`
    SELECT * FROM leaderboard_records WHERE citizen_id = ?
  `).get(req.user!.id) as any;

  const badgeTiers = db.prepare('SELECT * FROM badge_config ORDER BY min_verified_reports ASC').all();

  res.json({
    totalPoints: summary?.total_points || 0,
    verifiedReports: summary?.verified_reports || 0,
    resolvedReports: summary?.resolved_reports || 0,
    badges,
    pointsHistory,
    badgeTiers,
  });
});

governanceRouter.get('/rewards/config', requireAuthority, (_req, res) => {
  const tiers = db.prepare('SELECT * FROM badge_config ORDER BY min_verified_reports ASC').all();
  res.json({ tiers });
});

governanceRouter.patch('/rewards/config', requireAuthority, (req: AuthedRequest, res) => {
  const schema = z.object({
    tiers: z.array(
      z.object({
        id: z.string(),
        min_verified_reports: z.number().int().min(1).max(500),
        points_per_verified: z.number().int().min(1).max(500),
        points_per_evidence: z.number().int().min(0).max(200),
        points_per_location: z.number().int().min(0).max(200),
        points_per_resolved: z.number().int().min(0).max(500),
        points_per_medical: z.number().int().min(0).max(500),
        daily_point_cap: z.number().int().min(10).max(2000),
      })
    ),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid badge configuration.' });
    return;
  }

  const stmt = db.prepare(`
    UPDATE badge_config
    SET min_verified_reports = ?, points_per_verified = ?, points_per_evidence = ?,
        points_per_location = ?, points_per_resolved = ?, points_per_medical = ?,
        daily_point_cap = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  db.transaction(() => {
    for (const t of parsed.data.tiers) {
      stmt.run(
        t.min_verified_reports,
        t.points_per_verified,
        t.points_per_evidence,
        t.points_per_location,
        t.points_per_resolved,
        t.points_per_medical,
        t.daily_point_cap,
        t.id
      );
    }
  })();

  logAudit({
    actorUserId: req.user!.id,
    actorRole: 'authority',
    action: 'BADGE_CONFIG_UPDATED',
    ipAddress: req.ip,
  });

  res.json({ success: true });
});

// ============================================================
// 4. REAL DATABASE LEADERBOARD
// ============================================================
governanceRouter.get('/leaderboard', requireAuth, (req: AuthedRequest, res) => {
  const period = String(req.query.period || 'all');
  const wardFilter = String(req.query.ward || '').trim();

  let dateClause = '1=1';
  if (period === 'month') {
    dateClause = "strftime('%Y-%m', cp.created_at) = strftime('%Y-%m', 'now')";
  } else if (period === 'year') {
    dateClause = "strftime('%Y', cp.created_at) = strftime('%Y', 'now')";
  }

  const wardClause = wardFilter ? "AND LOWER(COALESCE(up.ward, '')) LIKE ?" : '';
  const params = wardFilter ? [`%${wardFilter.toLowerCase()}%`] : [];

  // Exclude users who ONLY have sensitive reports to never expose sensitive-case reporters
  const rows = db.prepare(`
    SELECT u.id as citizen_id,
           u.full_name,
           u.anonymous_leaderboard,
           up.ward,
           COALESCE(SUM(cp.points), 0) as points,
           (
             SELECT COUNT(*) FROM reports r
             WHERE r.citizen_id = u.id AND r.is_verified_civic = 1 AND r.is_duplicate = 0 AND r.is_sensitive = 0
           ) as verified_reports,
           (
             SELECT badge_name FROM citizen_badges cb
             WHERE cb.citizen_id = u.id
             ORDER BY cb.awarded_at DESC LIMIT 1
           ) as top_badge
    FROM users u
    LEFT JOIN user_profiles up ON up.user_id = u.id
    LEFT JOIN citizen_points cp ON cp.citizen_id = u.id AND ${dateClause}
    WHERE u.role = 'citizen' AND u.is_active = 1 ${wardClause}
    GROUP BY u.id
    HAVING points > 0 OR verified_reports > 0
    ORDER BY points DESC, verified_reports DESC, u.created_at ASC
    LIMIT 100
  `).all(...params) as any[];

  const ranked = rows.map((r, idx) => ({
    rank: idx + 1,
    isSelf: r.citizen_id === req.user!.id,
    displayName: r.anonymous_leaderboard && r.citizen_id !== req.user!.id ? `Anonymous Citizen #${idx + 1}` : r.full_name,
    ward: r.ward || 'Citywide',
    badge: r.top_badge || 'Active Citizen',
    verifiedReports: r.verified_reports,
    points: r.points,
  }));

  const selfEntry = ranked.find((x) => x.isSelf) || null;
  res.json({ entries: ranked, selfEntry, period });
});

// ============================================================
// 5. ANNUAL AWARD ("MOST SOCIALLY ALERT CITIZEN") & HALL OF FAME
// ============================================================
governanceRouter.get('/awards', (_req, res) => {
  const hallOfFame = db.prepare(`
    SELECT aa.award_year, aa.title, aa.confirmed_at,
           u.full_name as winner_name, up.city, up.ward,
           c.certificate_code
    FROM annual_awards aa
    JOIN users u ON u.id = aa.winner_citizen_id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    LEFT JOIN certificates c ON c.award_id = aa.id AND c.citizen_id = aa.winner_citizen_id
    WHERE aa.status = 'CONFIRMED' AND aa.winner_consent = 1
    ORDER BY aa.award_year DESC
  `).all();

  const currentYear = new Date().getFullYear();
  const currentBanner = (hallOfFame as any[]).find((h) => h.award_year === currentYear) || null;

  res.json({ hallOfFame, currentBanner });
});

governanceRouter.get('/awards/my', requireCitizen, (req: AuthedRequest, res) => {
  const awards = db.prepare(`
    SELECT aa.*, c.certificate_code, c.issued_at
    FROM annual_awards aa
    LEFT JOIN certificates c ON c.award_id = aa.id AND c.citizen_id = aa.winner_citizen_id
    WHERE aa.winner_citizen_id = ? AND aa.status = 'CONFIRMED'
    ORDER BY aa.award_year DESC
  `).all(req.user!.id);
  res.json({ awards });
});

governanceRouter.post('/awards/:awardId/consent', requireCitizen, (req: AuthedRequest, res) => {
  const award = db.prepare('SELECT * FROM annual_awards WHERE id = ? AND winner_citizen_id = ?').get(req.params.awardId, req.user!.id) as any;
  if (!award) {
    res.status(404).json({ error: 'Award record not found for your account.' });
    return;
  }
  const consent = req.body?.consent ? 1 : 0;
  db.prepare('UPDATE annual_awards SET winner_consent = ? WHERE id = ?').run(consent, award.id);
  res.json({ success: true, winnerConsent: Boolean(consent) });
});

governanceRouter.get('/awards/admin', requireAuthority, (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const award = db.prepare('SELECT * FROM annual_awards WHERE award_year = ?').get(year) as any;
  const candidates = award
    ? db.prepare(`
        SELECT ac.*, u.full_name, u.email, u.phone, up.ward, up.city
        FROM award_candidates ac
        JOIN users u ON u.id = ac.citizen_id
        LEFT JOIN user_profiles up ON up.user_id = u.id
        WHERE ac.award_id = ?
        ORDER BY ac.rank_order ASC
      `).all(award.id)
    : [];

  res.json({ year, award, candidates });
});

governanceRouter.post('/awards/admin/shortlist', requireAuthority, (req: AuthedRequest, res) => {
  const year = Number(req.body?.year) || new Date().getFullYear();
  let award = db.prepare('SELECT * FROM annual_awards WHERE award_year = ?').get(year) as any;
  if (!award) {
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO annual_awards (id, award_year, title, status)
      VALUES (?, ?, 'MOST SOCIALLY ALERT CITIZEN', 'OPEN')
    `).run(id, year);
    award = db.prepare('SELECT * FROM annual_awards WHERE id = ?').get(id);
  }

  const topCitizens = db.prepare(`
    SELECT u.id as citizen_id,
           COALESCE(SUM(cp.points), 0) as total_points,
           COUNT(DISTINCT CASE WHEN r.is_verified_civic = 1 AND r.is_duplicate = 0 THEN r.id END) as verified_count
    FROM users u
    LEFT JOIN reports r ON r.citizen_id = u.id AND strftime('%Y', r.created_at) = ?
    LEFT JOIN citizen_points cp ON cp.citizen_id = u.id AND strftime('%Y', cp.created_at) = ?
    WHERE u.role = 'citizen' AND u.is_active = 1
    GROUP BY u.id
    HAVING verified_count > 0 AND total_points > 0
    ORDER BY total_points DESC, verified_count DESC
    LIMIT 5
  `).all(String(year), String(year)) as any[];

  if (topCitizens.length === 0) {
    res.status(400).json({ error: `No eligible citizens with verified civic reports found for ${year}.` });
    return;
  }

  db.transaction(() => {
    db.prepare('DELETE FROM award_candidates WHERE award_id = ?').run(award.id);
    const ins = db.prepare(`
      INSERT INTO award_candidates (id, award_id, citizen_id, rank_order, verified_reports_count, total_points, status)
      VALUES (?, ?, ?, ?, ?, ?, 'SHORTLISTED')
    `);
    topCitizens.forEach((c, idx) => {
      ins.run(crypto.randomUUID(), award.id, c.citizen_id, idx + 1, c.verified_count, c.total_points);
    });
    db.prepare("UPDATE annual_awards SET status = 'SHORTLISTED' WHERE id = ?").run(award.id);
  })();

  res.json({ success: true, count: topCitizens.length });
});

governanceRouter.patch('/awards/admin/candidate/:candidateId', requireAuthority, (req: AuthedRequest, res) => {
  const schema = z.object({
    action: z.enum(['investigate', 'disqualify', 'reinstate']),
    investigationNote: z.string().max(1000).optional(),
    disqualificationReason: z.string().max(1000).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid candidate update.' });
    return;
  }
  const d = parsed.data;
  if (d.action === 'disqualify' && (!d.disqualificationReason || d.disqualificationReason.trim().length < 5)) {
    res.status(400).json({ error: 'Disqualification reason is mandatory.' });
    return;
  }

  db.prepare(`
    UPDATE award_candidates
    SET status = CASE WHEN ? = 'disqualify' THEN 'DISQUALIFIED' WHEN ? = 'reinstate' THEN 'SHORTLISTED' ELSE status END,
        investigation_note = COALESCE(?, investigation_note),
        disqualification_reason = COALESCE(?, disqualification_reason),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(d.action, d.action, d.investigationNote || null, d.disqualificationReason || null, req.params.candidateId);

  res.json({ success: true });
});

governanceRouter.post('/awards/admin/confirm', requireAuthority, async (req: AuthedRequest, res) => {
  const schema = z.object({
    awardId: z.string(),
    candidateId: z.string(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Award ID and Candidate ID required.' });
    return;
  }

  const candidate = db.prepare(`
    SELECT ac.*, u.full_name, u.email, aa.award_year, aa.title
    FROM award_candidates ac
    JOIN users u ON u.id = ac.citizen_id
    JOIN annual_awards aa ON aa.id = ac.award_id
    WHERE ac.id = ? AND ac.award_id = ?
  `).get(parsed.data.candidateId, parsed.data.awardId) as any;

  if (!candidate || candidate.status === 'DISQUALIFIED') {
    res.status(400).json({ error: 'Selected candidate is disqualified or invalid.' });
    return;
  }

  const certCode = `SEVA-CERT-${candidate.award_year}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const nowIso = new Date().toISOString();

  db.transaction(() => {
    db.prepare("UPDATE award_candidates SET status = 'WINNER' WHERE id = ?").run(candidate.id);
    db.prepare(`
      UPDATE annual_awards
      SET status = 'CONFIRMED', winner_citizen_id = ?, winner_consent = 1, confirmed_by = ?, confirmed_at = ?
      WHERE id = ?
    `).run(candidate.citizen_id, req.user!.id, nowIso, candidate.award_id);

    db.prepare(`
      INSERT INTO certificates (id, certificate_code, award_id, citizen_id, winner_name, award_year, award_title, issued_by, issued_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      certCode,
      candidate.award_id,
      candidate.citizen_id,
      candidate.full_name,
      candidate.award_year,
      candidate.title,
      req.user!.full_name,
      nowIso
    );
  })();

  createAndPushNotification({
    userId: candidate.citizen_id,
    category: 'ANNUAL_AWARD',
    title: `Congratulations! ${candidate.title} (${candidate.award_year})`,
    message: `You have been confirmed as the ${candidate.award_year} ${candidate.title}. Download your official PDF certificate in Rewards.`,
    linkPath: '/citizen/rewards',
    priority: 'high',
  });

  await sendEmail(
    candidate.email,
    `SEVA AI Annual Award: ${candidate.title} (${candidate.award_year})`,
    `<p>Congratulations <strong>${candidate.full_name}</strong>! You have been confirmed as the ${candidate.award_year} winner of <strong>${candidate.title}</strong>. Certificate ID: ${certCode}.</p>`,
    `Congratulations ${candidate.full_name}! You won ${candidate.title} (${candidate.award_year}). Certificate ID: ${certCode}.`
  );

  res.json({ success: true, certificateCode: certCode });
});

governanceRouter.get('/awards/certificate/:code', (req, res) => {
  const cert = db.prepare('SELECT * FROM certificates WHERE certificate_code = ?').get(req.params.code);
  if (!cert) {
    res.status(404).json({ error: 'Certificate not found.' });
    return;
  }
  res.json({ certificate: cert });
});

// ============================================================
// 6. AUTHORITY ADMIN CONTROL CENTER & DPDP HUB
// ============================================================
governanceRouter.get('/departments', (_req, res) => {
  const departments = db.prepare(`
    SELECT id, code, name, category_scope, description, escalation_order, contact_email
    FROM departments
    WHERE is_active = 1
    ORDER BY escalation_order ASC, name ASC
  `).all();
  res.json({ departments });
});

governanceRouter.get('/admin/departments', requireAuth, (_req, res) => {
  const departments = db.prepare(`
    SELECT d.*,
           (SELECT COUNT(*) FROM reports r WHERE r.assigned_department_id = d.id) as assigned_reports_count,
           (SELECT COUNT(*) FROM authority_accounts aa WHERE aa.department_id = d.id) as officers_count
    FROM departments d
    ORDER BY d.escalation_order ASC, d.name ASC
  `).all();
  res.json({ departments });
});

governanceRouter.post('/admin/departments', requireAuthority, (req: AuthedRequest, res) => {
  const schema = z.object({
    code: z.string().min(2).max(16),
    name: z.string().min(3).max(120),
    categoryScope: z.string().min(2).max(120),
    description: z.string().max(500).optional(),
    contactEmail: z.string().email().optional().or(z.literal('')),
    escalationOrder: z.number().int().min(1).max(5).default(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid department details.' });
    return;
  }
  const d = parsed.data;
  const id = `dept-${crypto.randomBytes(4).toString('hex')}`;
  try {
    db.prepare(`
      INSERT INTO departments (id, code, name, category_scope, description, escalation_order, contact_email)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, d.code.toUpperCase(), d.name.trim(), d.categoryScope.trim(), d.description || null, d.escalationOrder, d.contactEmail || null);
    res.status(201).json({ id });
  } catch (err: any) {
    res.status(409).json({ error: 'Department code already exists.' });
  }
});

governanceRouter.get('/admin/users', requireAuthority, (_req, res) => {
  const citizens = db.prepare(`
    SELECT u.id, u.full_name, u.email, u.phone, u.phone_verified, u.email_verified, u.is_active, u.deletion_requested_at, u.created_at,
           up.city, up.ward,
           (SELECT COUNT(*) FROM reports r WHERE r.citizen_id = u.id) as reports_count
    FROM users u
    LEFT JOIN user_profiles up ON up.user_id = u.id
    WHERE u.role = 'citizen'
    ORDER BY u.created_at DESC
  `).all();

  const officers = db.prepare(`
    SELECT u.id, u.full_name, u.email, u.phone, u.is_active, u.created_at,
           aa.designation, aa.badge_number, aa.is_chief_admin, aa.department_id, d.name as department_name
    FROM users u
    JOIN authority_accounts aa ON aa.user_id = u.id
    LEFT JOIN departments d ON d.id = aa.department_id
    WHERE u.role = 'authority'
    ORDER BY aa.is_chief_admin DESC, u.created_at DESC
  `).all();

  res.json({ citizens, officers });
});

governanceRouter.patch('/admin/users/:id/status', requireAuthority, (req: AuthedRequest, res) => {
  if (req.params.id === req.user!.id) {
    res.status(400).json({ error: 'You cannot deactivate your own active authority session.' });
    return;
  }
  const isActive = req.body?.isActive ? 1 : 0;
  db.prepare("UPDATE users SET is_active = ?, updated_at = datetime('now') WHERE id = ?").run(isActive, req.params.id);
  logAudit({
    actorUserId: req.user!.id,
    actorRole: 'authority',
    action: isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
    resourceType: 'user',
    resourceId: req.params.id,
    ipAddress: req.ip,
  });
  res.json({ success: true });
});

governanceRouter.get('/admin/audit-logs', requireAuthority, (_req, res) => {
  const logs = db.prepare(`
    SELECT al.*, u.full_name as actor_name
    FROM audit_logs al
    LEFT JOIN users u ON u.id = al.actor_user_id
    ORDER BY al.created_at DESC
    LIMIT 150
  `).all();
  res.json({ logs });
});

governanceRouter.get('/admin/analytics', requireAuthority, (_req, res) => {
  const byCategory = db.prepare(`
    SELECT category, COUNT(*) as count,
           SUM(CASE WHEN status = 'RESOLVED' THEN 1 ELSE 0 END) as resolved
    FROM reports
    GROUP BY category
    ORDER BY count DESC
  `).all();

  const bySeverity = db.prepare(`
    SELECT severity, COUNT(*) as count FROM reports GROUP BY severity
  `).all();

  const byStatus = db.prepare(`
    SELECT status, COUNT(*) as count FROM reports GROUP BY status
  `).all();

  const dpdpStats = {
    consentsRecorded: (db.prepare('SELECT COUNT(*) as c FROM consent_records WHERE granted = 1').get() as { c: number }).c,
    deletionRequests: (db.prepare('SELECT COUNT(*) as c FROM users WHERE deletion_requested_at IS NOT NULL').get() as { c: number }).c,
    sensitiveReportsCount: (db.prepare('SELECT COUNT(*) as c FROM reports WHERE is_sensitive = 1').get() as { c: number }).c,
  };

  res.json({ byCategory, bySeverity, byStatus, dpdpStats });
});

governanceRouter.post('/admin/analytics/ai-insights', requireAuthority, async (_req, res) => {
  const byCategory = db.prepare('SELECT category, status, severity, COUNT(*) as count FROM reports GROUP BY category, status, severity').all();
  const totalSos = (db.prepare('SELECT COUNT(*) as c FROM sos_events').get() as { c: number }).c;
  const totalMed = (db.prepare('SELECT COUNT(*) as c FROM medical_requests').get() as { c: number }).c;

  const summaryInput = JSON.stringify({ reportsBreakdown: byCategory, totalSos, totalMed });
  const result = await analyzeCivicTrendsWithAI(summaryInput);
  res.json(result);
});
