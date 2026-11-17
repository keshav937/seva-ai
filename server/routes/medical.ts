import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { sendSms, triggerVoiceCall } from '../communications.ts';
import { db } from '../db.ts';
import { reverseGeocodeCoords, searchNearbyPlaces } from '../places.ts';
import {
  broadcastToAuthorities,
  broadcastToUser,
  createAndPushNotification,
  notifyAllAuthorities,
} from '../realtime.ts';
import { type AuthedRequest, logAudit, normalizeIndianPhone, requireAuthority, requireCitizen } from '../security.ts';

export const medicalRouter = express.Router();

medicalRouter.post('/request', requireCitizen, async (req: AuthedRequest, res) => {
  const schema = z.object({
    phone: z.string().min(10).max(20),
    patientCondition: z.string().min(4).max(2000),
    severity: z.enum(['Medium', 'High', 'Critical']).default('High'),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyMeters: z.number().optional().nullable(),
    selectedFacility: z
      .object({
        name: z.string(),
        address: z.string().optional(),
        phone: z.string().nullable().optional(),
        latitude: z.number(),
        longitude: z.number(),
        distanceMeters: z.number(),
      })
      .optional()
      .nullable(),
    triggerVoiceAlert: z.boolean().default(false),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid medical emergency payload.' });
    return;
  }

  const d = parsed.data;
  const normalizedPhone = normalizeIndianPhone(d.phone);
  if (!normalizedPhone) {
    res.status(400).json({ error: 'Please enter a valid 10-digit Indian mobile number.' });
    return;
  }

  const requestId = crypto.randomUUID();
  const trackingCode = `MED-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const nowIso = new Date().toISOString();

  const geo = await reverseGeocodeCoords(d.latitude, d.longitude);
  let nearbyHospitals: any[] = [];
  try {
    const resPlaces = await searchNearbyPlaces({
      lat: d.latitude,
      lng: d.longitude,
      category: 'hospital',
      radiusMeters: 7000,
    });
    nearbyHospitals = resPlaces.places.slice(0, 8);
  } catch {
    nearbyHospitals = [];
  }

  const chosen = d.selectedFacility || nearbyHospitals[0] || null;

  let callStatus = 'NOT_ATTEMPTED';
  let callDetail: string | null = null;
  if (d.triggerVoiceAlert) {
    const targetCallPhone = chosen?.phone ? normalizeIndianPhone(chosen.phone) || normalizedPhone : normalizedPhone;
    const voiceRes = await triggerVoiceCall(
      targetCallPhone,
      `SEVA AI Medical Emergency Alert ${trackingCode}. Patient requires urgent medical assistance near ${geo.formattedAddress}.`
    );
    callStatus = voiceRes.status;
    callDetail = voiceRes.error || `Call queued via ${voiceRes.provider} (${voiceRes.providerMessageId})`;
  }

  db.transaction(() => {
    db.prepare(`
      INSERT INTO medical_requests (
        id, tracking_code, citizen_id, phone, patient_condition, severity,
        latitude, longitude, accuracy_meters, formatted_address,
        selected_facility_name, selected_facility_address, selected_facility_phone, selected_facility_distance_m,
        status, call_status, call_detail, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Authority Notified', ?, ?, ?, ?)
    `).run(
      requestId,
      trackingCode,
      req.user!.id,
      normalizedPhone,
      d.patientCondition.trim(),
      d.severity,
      d.latitude,
      d.longitude,
      d.accuracyMeters ?? null,
      geo.formattedAddress,
      chosen?.name || null,
      chosen?.address || null,
      chosen?.phone || null,
      chosen?.distanceMeters ?? null,
      callStatus,
      callDetail,
      nowIso,
      nowIso
    );

    for (const h of nearbyHospitals) {
      db.prepare(`
        INSERT INTO facility_records (id, request_type, request_id, facility_name, facility_type, address, phone, latitude, longitude, distance_meters, source)
        VALUES (?, 'medical', ?, ?, ?, ?, ?, ?, ?, ?, 'OpenStreetMap')
      `).run(crypto.randomUUID(), requestId, h.name, h.category, h.address, h.phone, h.latitude, h.longitude, h.distanceMeters);
    }
  })();

  createAndPushNotification({
    userId: req.user!.id,
    category: 'MEDICAL_REQUEST',
    title: `Medical Request ${trackingCode} Sent`,
    message: `Emergency medical assistance request sent for ${geo.formattedAddress}.`,
    linkPath: '/citizen/medical',
    relatedId: requestId,
    priority: 'emergency',
  });

  notifyAllAuthorities({
    category: 'MEDICAL_EMERGENCY',
    title: `MEDICAL EMERGENCY: ${trackingCode} (${d.severity})`,
    message: `${req.user!.full_name} (${normalizedPhone}) requested medical aid at ${geo.formattedAddress}. Nearest facility: ${chosen?.name || 'Check live coordinates'}.`,
    linkPath: '/authority/emergency',
    relatedId: requestId,
    priority: 'emergency',
  });

  broadcastToAuthorities({
    type: 'medical:created',
    request: {
      id: requestId,
      tracking_code: trackingCode,
      citizen_name: req.user!.full_name,
      phone: normalizedPhone,
      patient_condition: d.patientCondition.trim(),
      severity: d.severity,
      latitude: d.latitude,
      longitude: d.longitude,
      formatted_address: geo.formattedAddress,
      selected_facility_name: chosen?.name || null,
      status: 'Authority Notified',
      created_at: nowIso,
    },
  });

  logAudit({
    actorUserId: req.user!.id,
    actorRole: 'citizen',
    action: 'MEDICAL_EMERGENCY_CREATED',
    resourceType: 'medical_request',
    resourceId: requestId,
    detail: `code=${trackingCode}`,
    ipAddress: req.ip,
  });

  res.status(201).json({
    requestId,
    trackingCode,
    status: 'Authority Notified',
    formattedAddress: geo.formattedAddress,
    callStatus,
    callDetail,
    nearbyHospitals,
  });
});

medicalRouter.get('/my', requireCitizen, (req: AuthedRequest, res) => {
  const requests = db.prepare(`
    SELECT mr.*, ou.full_name as officer_name
    FROM medical_requests mr
    LEFT JOIN users ou ON ou.id = mr.assigned_officer_id
    WHERE mr.citizen_id = ?
    ORDER BY mr.created_at DESC
  `).all(req.user!.id);

  res.json({ requests });
});

medicalRouter.get('/', requireAuthority, (_req, res) => {
  const requests = db.prepare(`
    SELECT mr.*, u.full_name as citizen_name, ou.full_name as officer_name
    FROM medical_requests mr
    JOIN users u ON u.id = mr.citizen_id
    LEFT JOIN users ou ON ou.id = mr.assigned_officer_id
    ORDER BY CASE WHEN mr.status != 'Resolved' THEN 0 ELSE 1 END, mr.created_at DESC
  `).all();
  res.json({ requests });
});

medicalRouter.patch('/:id/status', requireAuthority, async (req: AuthedRequest, res) => {
  const existing = db.prepare('SELECT * FROM medical_requests WHERE id = ?').get(req.params.id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Medical emergency request not found.' });
    return;
  }

  const schema = z.object({
    status: z.enum(['Received', 'Authority Notified', 'Acknowledged', 'Ambulance Assigned', 'On the Way', 'Resolved']),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid medical status.' });
    return;
  }

  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE medical_requests
    SET status = ?,
        assigned_officer_id = COALESCE(assigned_officer_id, ?),
        resolved_at = CASE WHEN ? = 'Resolved' THEN ? ELSE resolved_at END,
        updated_at = ?
    WHERE id = ?
  `).run(parsed.data.status, req.user!.id, parsed.data.status, nowIso, nowIso, existing.id);

  createAndPushNotification({
    userId: existing.citizen_id,
    category: 'MEDICAL_STATUS',
    title: `Medical Request ${existing.tracking_code}: ${parsed.data.status}`,
    message: `Officer ${req.user!.full_name} updated your medical assistance status to "${parsed.data.status}".`,
    linkPath: '/citizen/medical',
    relatedId: existing.id,
    priority: 'emergency',
  });

  await sendSms(
    existing.phone,
    `SEVA AI Medical Update (${existing.tracking_code}): Status is now ${parsed.data.status}.`
  );

  broadcastToUser(existing.citizen_id, { type: 'medical:updated', id: existing.id, status: parsed.data.status });
  broadcastToAuthorities({ type: 'medical:updated', id: existing.id, status: parsed.data.status });

  res.json({ success: true, status: parsed.data.status });
});
