import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { sendAndLogSms, sendEmail } from '../communications.ts';
import { db } from '../db.ts';
import {
  broadcastToAuthorities,
  broadcastToTrackingToken,
  broadcastToUser,
  createAndPushNotification,
  notifyAllAuthorities,
} from '../realtime.ts';
import { type AuthedRequest, hashSecret, logAudit, normalizeIndianPhone, requireAuth, requireAuthority, requireCitizen } from '../security.ts';

export const sevaShieldRouter = express.Router();

function getAppBaseUrl(req: express.Request): string {
  if (process.env.APP_URL && !process.env.APP_URL.includes('MY_APP_URL')) {
    return process.env.APP_URL.replace(/\/$/, '');
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

// List Citizen Emergency Contacts & Caregiver Permissions
sevaShieldRouter.get('/contacts', requireCitizen, (req: AuthedRequest, res) => {
  const contacts = db.prepare(`
    SELECT ec.*, u.full_name as linked_user_name,
           cp.can_view_live_location, cp.can_receive_sos, cp.consent_granted_at
    FROM emergency_contacts ec
    LEFT JOIN users u ON u.id = ec.linked_user_id
    LEFT JOIN caregiver_permissions cp ON cp.contact_id = ec.id AND cp.revoked_at IS NULL
    WHERE ec.user_id = ?
    ORDER BY ec.created_at ASC
  `).all(req.user!.id);

  res.json({ contacts });
});

// Add Emergency Contact (Max 5, Caregiver Phone OTP verification & consent required, no duplicates, no self-number)
sevaShieldRouter.post('/contacts', requireCitizen, async (req: AuthedRequest, res) => {
  const count = (db.prepare('SELECT COUNT(*) as c FROM emergency_contacts WHERE user_id = ?').get(req.user!.id) as { c: number }).c;
  if (count >= 5) {
    res.status(400).json({ error: 'Maximum limit of 5 emergency contacts reached.' });
    return;
  }

  const schema = z.object({
    name: z.string().min(2).max(100),
    phone: z.string().min(8).max(20),
    email: z.string().email().optional().or(z.literal('')),
    relationship: z.string().min(2).max(60),
    isCaregiver: z.boolean().default(true),
    locationConsent: z.boolean(),
    caregiverConsent: z.boolean(),
    phoneChallengeId: z.string().uuid(),
    phoneVerificationToken: z.string().min(10),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid contact details or missing caregiver OTP verification.' });
    return;
  }
  const d = parsed.data;
  if (!d.locationConsent) {
    res.status(400).json({ error: 'Please confirm citizen consent to share live emergency location with this contact.' });
    return;
  }
  if (!d.caregiverConsent) {
    res.status(400).json({ error: 'Please confirm caregiver contact consent before linking this number.' });
    return;
  }

  const normalizedPhone = normalizeIndianPhone(d.phone);
  if (!normalizedPhone) {
    res.status(400).json({ error: 'Please enter a valid mobile number with country code.' });
    return;
  }
  if (normalizedPhone === req.user!.phone) {
    res.status(400).json({ error: 'You cannot add your own mobile number as an emergency contact.' });
    return;
  }

  // Verify caregiver phone OTP proof strictly on the server
  const expectedProof = hashSecret(`verified:${d.phoneChallengeId}:${normalizedPhone}:phone`);
  const otpRow = db.prepare(`
    SELECT id FROM otp_challenges
    WHERE id = ? AND target = ? AND channel = 'phone' AND purpose IN ('caregiver_phone', 'verify_phone') AND consumed = 1
  `).get(d.phoneChallengeId, normalizedPhone);

  if (expectedProof !== d.phoneVerificationToken || !otpRow) {
    res.status(400).json({ error: 'Caregiver phone number must be verified via OTP before linking.' });
    return;
  }

  const existing = db.prepare('SELECT id FROM emergency_contacts WHERE user_id = ? AND phone = ?').get(req.user!.id, normalizedPhone);
  if (existing) {
    res.status(409).json({ error: 'This mobile number is already in your emergency contacts.' });
    return;
  }

  const linkedUser = db.prepare('SELECT id FROM users WHERE phone = ?').get(normalizedPhone) as { id: string } | undefined;
  const contactId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  db.transaction(() => {
    db.prepare(`
      INSERT INTO emergency_contacts (
        id, user_id, name, phone, email, relationship, is_caregiver,
        linked_user_id, location_consent, phone_verified, verified_at, caregiver_consent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, 1)
    `).run(
      contactId,
      req.user!.id,
      d.name.trim(),
      normalizedPhone,
      d.email?.trim().toLowerCase() || null,
      d.relationship.trim(),
      d.isCaregiver ? 1 : 0,
      linkedUser?.id || null,
      nowIso
    );

    if (d.isCaregiver) {
      db.prepare(`
        INSERT INTO caregiver_permissions (id, citizen_id, contact_id, caregiver_user_id, can_view_live_location, can_receive_sos)
        VALUES (?, ?, ?, ?, 1, 1)
      `).run(crypto.randomUUID(), req.user!.id, contactId, linkedUser?.id || null);
    }

    db.prepare(`
      INSERT INTO consent_records (id, user_id, consent_type, granted, ip_address)
      VALUES (?, ?, ?, 1, ?)
    `).run(crypto.randomUUID(), req.user!.id, `EMERGENCY_CONTACT_LOCATION_${contactId}`, req.ip || null);
  })();

  await sendAndLogSms({
    userId: req.user!.id,
    recipientPhone: normalizedPhone,
    eventType: 'CAREGIVER_LINKED',
    relatedId: contactId,
    message: `SEVA AI: ${req.user!.full_name} has linked your verified mobile number as their emergency caregiver contact.`,
  });

  if (linkedUser) {
    createAndPushNotification({
      userId: linkedUser.id,
      category: 'CAREGIVER_LINKED',
      title: `Trusted Caregiver Connection`,
      message: `${req.user!.full_name} added you as a verified emergency caregiver on SEVA AI.`,
      linkPath: '/citizen/seva-shield',
    });
  }

  res.status(201).json({ id: contactId, phoneVerified: true, linkedAccountFound: Boolean(linkedUser) });
});

sevaShieldRouter.patch('/contacts/:id', requireCitizen, (req: AuthedRequest, res) => {
  const existing = db.prepare('SELECT * FROM emergency_contacts WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Emergency contact not found.' });
    return;
  }

  const schema = z.object({
    name: z.string().min(2).max(100),
    phone: z.string().min(8).max(20),
    email: z.string().email().optional().or(z.literal('')),
    relationship: z.string().min(2).max(60),
    isCaregiver: z.boolean().default(true),
    locationConsent: z.boolean().optional(),
    caregiverConsent: z.boolean().optional(),
    phoneChallengeId: z.string().uuid().optional(),
    phoneVerificationToken: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid contact details.' });
    return;
  }
  const d = parsed.data;
  const normalizedPhone = normalizeIndianPhone(d.phone);
  if (!normalizedPhone) {
    res.status(400).json({ error: 'Invalid mobile number.' });
    return;
  }
  if (normalizedPhone === req.user!.phone) {
    res.status(400).json({ error: 'Cannot add your own mobile number.' });
    return;
  }

  const phoneChanged = normalizedPhone !== existing.phone;
  let phoneVerified = existing.phone_verified ? 1 : 0;
  let verifiedAt = existing.verified_at || null;

  if (phoneChanged || !phoneVerified) {
    if (!d.phoneChallengeId || !d.phoneVerificationToken) {
      res.status(400).json({ error: 'Caregiver phone verification via OTP is required when updating or verifying a phone number.' });
      return;
    }
    const expectedProof = hashSecret(`verified:${d.phoneChallengeId}:${normalizedPhone}:phone`);
    const otpRow = db.prepare(`
      SELECT id FROM otp_challenges
      WHERE id = ? AND target = ? AND channel = 'phone' AND purpose IN ('caregiver_phone', 'verify_phone') AND consumed = 1
    `).get(d.phoneChallengeId, normalizedPhone);
    if (expectedProof !== d.phoneVerificationToken || !otpRow) {
      res.status(400).json({ error: 'Invalid caregiver OTP verification proof.' });
      return;
    }
    phoneVerified = 1;
    verifiedAt = new Date().toISOString();
  }

  const duplicateOther = db
    .prepare('SELECT id FROM emergency_contacts WHERE user_id = ? AND phone = ? AND id != ?')
    .get(req.user!.id, normalizedPhone, req.params.id);
  if (duplicateOther) {
    res.status(409).json({ error: 'Another emergency contact already uses this mobile number.' });
    return;
  }

  const linkedUser = db.prepare('SELECT id FROM users WHERE phone = ?').get(normalizedPhone) as { id: string } | undefined;

  db.transaction(() => {
    db.prepare(`
      UPDATE emergency_contacts
      SET name = ?, phone = ?, email = ?, relationship = ?, is_caregiver = ?,
          linked_user_id = ?, phone_verified = ?, verified_at = ?,
          location_consent = COALESCE(?, location_consent),
          caregiver_consent = COALESCE(?, caregiver_consent),
          updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(
      d.name.trim(),
      normalizedPhone,
      d.email?.trim().toLowerCase() || null,
      d.relationship.trim(),
      d.isCaregiver ? 1 : 0,
      linkedUser?.id || null,
      phoneVerified,
      verifiedAt,
      d.locationConsent === undefined ? null : d.locationConsent ? 1 : 0,
      d.caregiverConsent === undefined ? null : d.caregiverConsent ? 1 : 0,
      req.params.id,
      req.user!.id
    );

    db.prepare(`
      UPDATE caregiver_permissions SET caregiver_user_id = ?, can_receive_sos = ?, can_view_live_location = ?
      WHERE contact_id = ? AND citizen_id = ?
    `).run(linkedUser?.id || null, d.isCaregiver ? 1 : 0, d.isCaregiver ? 1 : 0, req.params.id, req.user!.id);
  })();

  res.json({ success: true, phoneVerified: Boolean(phoneVerified) });
});

sevaShieldRouter.delete('/contacts/:id', requireCitizen, (req: AuthedRequest, res) => {
  const result = db.prepare('DELETE FROM emergency_contacts WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Emergency contact not found.' });
    return;
  }
  res.json({ success: true });
});

// Caregiver alerts for registered caregiver viewing citizens who linked them
sevaShieldRouter.get('/caregiver-alerts', requireAuth, (req: AuthedRequest, res) => {
  const alerts = db.prepare(`
    SELECT se.*, u.full_name as citizen_name, u.phone as citizen_phone, ts.tracking_token
    FROM emergency_contacts ec
    JOIN sos_events se ON se.citizen_id = ec.user_id
    JOIN users u ON u.id = se.citizen_id
    LEFT JOIN tracking_sessions ts ON ts.sos_event_id = se.id
    WHERE (ec.linked_user_id = ? OR ec.phone = ?) AND ec.is_caregiver = 1
    ORDER BY se.created_at DESC
    LIMIT 30
  `).all(req.user!.id, req.user!.phone);

  res.json({ alerts });
});

// Activate SOS
sevaShieldRouter.post('/sos/activate', requireCitizen, async (req: AuthedRequest, res) => {
  // Prevent accidental duplicate active SOS sessions
  const existingActive = db.prepare(`
    SELECT se.*, ts.tracking_token
    FROM sos_events se
    LEFT JOIN tracking_sessions ts ON ts.sos_event_id = se.id
    WHERE se.citizen_id = ? AND se.status != 'SAFE_RESOLVED'
    ORDER BY se.created_at DESC LIMIT 1
  `).get(req.user!.id) as any;

  if (existingActive) {
    const baseUrl = getAppBaseUrl(req);
    res.status(409).json({
      error: `An active SOS alert (${existingActive.emergency_code}) is already running.`,
      activeSos: {
        sosId: existingActive.id,
        emergencyCode: existingActive.emergency_code,
        trackingToken: existingActive.tracking_token,
        trackingUrl: existingActive.tracking_token ? `${baseUrl}/track/${existingActive.tracking_token}` : null,
        status: existingActive.status,
      },
    });
    return;
  }

  const schema = z.object({
    triggerMethod: z.enum(['button', 'voice', 'manual']).default('button'),
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
    accuracyMeters: z.number().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid SOS activation payload.' });
    return;
  }

  const d = parsed.data;
  const hasCoords = typeof d.latitude === 'number' && typeof d.longitude === 'number';
  const sosId = crypto.randomUUID();
  const emergencyCode = `SOS-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const trackingToken = crypto.randomBytes(24).toString('hex');
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  db.transaction(() => {
    db.prepare(`
      INSERT INTO sos_events (
        id, emergency_code, citizen_id, trigger_method, status,
        initial_latitude, initial_longitude, initial_accuracy,
        latest_latitude, latest_longitude, latest_accuracy, latest_location_at,
        last_sms_location_at, created_at
      ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sosId,
      emergencyCode,
      req.user!.id,
      d.triggerMethod,
      d.latitude ?? null,
      d.longitude ?? null,
      d.accuracyMeters ?? null,
      d.latitude ?? null,
      d.longitude ?? null,
      d.accuracyMeters ?? null,
      hasCoords ? nowIso : null,
      nowIso,
      nowIso
    );

    db.prepare(`
      INSERT INTO tracking_sessions (id, sos_event_id, citizen_id, tracking_token, is_active, consent_active, expires_at)
      VALUES (?, ?, ?, ?, 1, 1, ?)
    `).run(crypto.randomUUID(), sosId, req.user!.id, trackingToken, expiresAt);

    if (hasCoords) {
      db.prepare(`
        INSERT INTO sos_location_updates (id, sos_event_id, latitude, longitude, accuracy_meters, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), sosId, d.latitude!, d.longitude!, d.accuracyMeters ?? null, nowIso);
    }
  })();

  const baseUrl = getAppBaseUrl(req);
  const trackingUrl = `${baseUrl}/track/${trackingToken}`;
  const googleMapsLink = hasCoords
    ? `https://maps.google.com/?q=${d.latitude!.toFixed(6)},${d.longitude!.toFixed(6)}`
    : null;
  const locationText = hasCoords
    ? `${d.latitude!.toFixed(5)}, ${d.longitude!.toFixed(5)} (±${Math.round(d.accuracyMeters || 0)}m)`
    : 'Location could not be obtained from device GPS';
  const alertTimeStr = new Date(nowIso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  // 1. Immediate Citizen Dashboard Website Notification
  createAndPushNotification({
    userId: req.user!.id,
    category: 'SOS_ACTIVE',
    title: `Emergency SOS Activated (${emergencyCode})`,
    message: hasCoords
      ? `Active location sharing started (${locationText}). Share link: ${trackingUrl}`
      : `Emergency SOS activated. GPS coordinates could not be obtained automatically. Tracking link: ${trackingUrl}`,
    linkPath: '/citizen/seva-shield',
    relatedId: sosId,
    priority: 'emergency',
  });

  // 2. Immediate Authority Dashboard Website Notification & WebSocket Alert
  notifyAllAuthorities({
    category: 'SOS_ALERT',
    title: `LIVE SOS ALERT: ${req.user!.full_name} (${emergencyCode})`,
    message: `Citizen triggered ${d.triggerMethod} SOS. Location: ${locationText}`,
    linkPath: '/authority/emergency',
    relatedId: sosId,
    priority: 'emergency',
  });

  broadcastToAuthorities({
    type: 'sos:activated',
    sos: {
      id: sosId,
      emergencyCode,
      citizenId: req.user!.id,
      citizenName: req.user!.full_name,
      citizenPhone: req.user!.phone,
      triggerMethod: d.triggerMethod,
      status: 'ACTIVE',
      latitude: d.latitude ?? null,
      longitude: d.longitude ?? null,
      accuracyMeters: d.accuracyMeters ?? null,
      trackingToken,
      createdAt: nowIso,
    },
  });

  // 3. Notify ONLY Verified Caregivers & Emergency Contacts (never transmit sensitive info to unverified numbers!)
  const contacts = db.prepare('SELECT * FROM emergency_contacts WHERE user_id = ?').all(req.user!.id) as any[];
  const deliveryLogs: any[] = [];

  for (const c of contacts) {
    if (!c.phone_verified) {
      const skippedId = crypto.randomUUID();
      const skipMsg = 'Skipped external SMS: caregiver phone number has not been OTP-verified.';
      db.prepare(`
        INSERT INTO emergency_notifications (id, sos_event_id, recipient_name, recipient_phone, channel, status, provider, error_message, payload_text)
        VALUES (?, ?, ?, ?, 'sms', 'FAILED', 'Security Policy', ?, ?)
      `).run(skippedId, sosId, c.name, c.phone, skipMsg, 'Withheld until caregiver phone OTP is verified.');
      deliveryLogs.push({
        id: skippedId,
        recipientName: c.name,
        recipientPhone: c.phone,
        channel: 'sms',
        status: 'FAILED',
        provider: 'Security Policy',
        error: skipMsg,
      });
      continue;
    }

    const caregiverUser =
      c.linked_user_id
        ? { id: c.linked_user_id }
        : (db.prepare('SELECT id FROM users WHERE phone = ?').get(c.phone) as { id: string } | undefined);

    if (caregiverUser) {
      createAndPushNotification({
        userId: caregiverUser.id,
        category: 'CAREGIVER_SOS',
        title: `EMERGENCY SOS: ${req.user!.full_name} needs help!`,
        message: hasCoords
          ? `SOS activated at ${alertTimeStr}. Location: ${locationText}. Maps: ${googleMapsLink}`
          : `SOS activated at ${alertTimeStr}. GPS location unavailable. Open live status: ${trackingUrl}`,
        linkPath: `/track/${trackingToken}`,
        relatedId: sosId,
        priority: 'emergency',
      });

      const inAppId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO emergency_notifications (id, sos_event_id, recipient_name, recipient_phone, recipient_user_id, channel, status, provider, payload_text)
        VALUES (?, ?, ?, ?, ?, 'in_app', 'DELIVERED', 'SEVA AI Website', ?)
      `).run(inAppId, sosId, c.name, c.phone, caregiverUser.id, trackingUrl);
      deliveryLogs.push({ id: inAppId, recipientName: c.name, channel: 'in_app', status: 'DELIVERED', provider: 'SEVA AI Website' });
    }

    const smsText = googleMapsLink
      ? `SEVA AI EMERGENCY ALERT: An SOS alert has been triggered by ${req.user!.full_name}. Their current location is available here: ${googleMapsLink} . Live tracking map: ${trackingUrl} . Alert time: ${alertTimeStr}.`
      : `SEVA AI EMERGENCY ALERT: An SOS alert has been triggered by ${req.user!.full_name}. Current device location could not be obtained. Live status: ${trackingUrl} . Alert time: ${alertTimeStr}.`;

    const smsResult = await sendAndLogSms({
      userId: req.user!.id,
      recipientPhone: c.phone,
      eventType: 'SOS_ACTIVATION',
      relatedId: sosId,
      message: smsText,
      dedupeWindowSec: 15,
    });

    const smsNotifId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO emergency_notifications (id, sos_event_id, recipient_name, recipient_phone, channel, status, provider, provider_message_id, error_message, payload_text)
      VALUES (?, ?, ?, ?, 'sms', ?, ?, ?, ?, ?)
    `).run(
      smsNotifId,
      sosId,
      c.name,
      c.phone,
      smsResult.status,
      smsResult.provider,
      smsResult.providerMessageId || null,
      smsResult.error || null,
      smsText
    );
    deliveryLogs.push({
      id: smsNotifId,
      recipientName: c.name,
      recipientPhone: c.phone,
      channel: 'sms',
      status: smsResult.status,
      provider: smsResult.provider,
      error: smsResult.error || null,
    });

    if (c.email) {
      const emailResult = await sendEmail(
        c.email,
        `SEVA AI EMERGENCY SOS ALERT: ${req.user!.full_name} (${emergencyCode})`,
        `<p><strong>SEVA AI EMERGENCY ALERT:</strong> An SOS alert has been triggered by <strong>${req.user!.full_name}</strong>.</p><p>Location: ${locationText}</p>${googleMapsLink ? `<p><a href="${googleMapsLink}">View Google Maps Location</a></p>` : ''}<p><a href="${trackingUrl}">Open Live Caregiver Tracking Map</a></p><p>Alert time: ${alertTimeStr}</p>`,
        smsText
      );
      const emailNotifId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO emergency_notifications (id, sos_event_id, recipient_name, recipient_email, channel, status, provider, provider_message_id, error_message, payload_text)
        VALUES (?, ?, ?, ?, 'email', ?, ?, ?, ?, ?)
      `).run(
        emailNotifId,
        sosId,
        c.name,
        c.email,
        emailResult.status,
        emailResult.provider,
        emailResult.providerMessageId || null,
        emailResult.error || null,
        smsText
      );
      deliveryLogs.push({
        id: emailNotifId,
        recipientName: c.name,
        recipientEmail: c.email,
        channel: 'email',
        status: emailResult.status,
        provider: emailResult.provider,
        error: emailResult.error || null,
      });
    }
  }

  logAudit({
    actorUserId: req.user!.id,
    actorRole: 'citizen',
    action: 'SOS_ACTIVATED',
    resourceType: 'sos_event',
    resourceId: sosId,
    detail: `code=${emergencyCode}, method=${d.triggerMethod}, hasCoords=${hasCoords}`,
    ipAddress: req.ip,
  });

  res.status(201).json({
    sosId,
    emergencyCode,
    trackingToken,
    trackingUrl,
    googleMapsLink,
    status: 'ACTIVE',
    deliveries: deliveryLogs,
  });
});

// Live GPS update during active SOS (+ configurable periodic SMS location updates)
sevaShieldRouter.post('/sos/:id/location', requireCitizen, async (req: AuthedRequest, res) => {
  const sos = db.prepare('SELECT * FROM sos_events WHERE id = ? AND citizen_id = ?').get(req.params.id, req.user!.id) as any;
  if (!sos) {
    res.status(404).json({ error: 'SOS session not found.' });
    return;
  }
  if (sos.status === 'SAFE_RESOLVED') {
    res.status(400).json({ error: 'SOS session has already ended.' });
    return;
  }

  const schema = z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyMeters: z.number().optional().nullable(),
    heading: z.number().optional().nullable(),
    speed: z.number().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid GPS coordinates.' });
    return;
  }

  const d = parsed.data;
  const nowIso = new Date().toISOString();

  db.transaction(() => {
    db.prepare(`
      INSERT INTO sos_location_updates (id, sos_event_id, latitude, longitude, accuracy_meters, heading, speed, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), sos.id, d.latitude, d.longitude, d.accuracyMeters ?? null, d.heading ?? null, d.speed ?? null, nowIso);

    db.prepare(`
      UPDATE sos_events
      SET latest_latitude = ?, latest_longitude = ?, latest_accuracy = ?, latest_location_at = ?
      WHERE id = ?
    `).run(d.latitude, d.longitude, d.accuracyMeters ?? null, nowIso, sos.id);
  })();

  const session = db.prepare('SELECT tracking_token FROM tracking_sessions WHERE sos_event_id = ?').get(sos.id) as { tracking_token: string } | undefined;
  const locPayload = {
    type: 'sos:location_updated',
    sosId: sos.id,
    latitude: d.latitude,
    longitude: d.longitude,
    accuracyMeters: d.accuracyMeters ?? null,
    heading: d.heading ?? null,
    speed: d.speed ?? null,
    recordedAt: nowIso,
  };

  broadcastToAuthorities(locPayload);
  if (session?.tracking_token) {
    broadcastToTrackingToken(session.tracking_token, locPayload);
  }

  // Push to linked caregivers via WebSocket
  const linkedCaregivers = db.prepare('SELECT DISTINCT linked_user_id FROM emergency_contacts WHERE user_id = ? AND linked_user_id IS NOT NULL').all(req.user!.id) as Array<{ linked_user_id: string }>;
  for (const cg of linkedCaregivers) {
    broadcastToUser(cg.linked_user_id, locPayload);
  }

  // Periodic SOS Location SMS update (respects SOS_SMS_INTERVAL_SECONDS & verified caregivers only)
  const intervalSec = Math.max(30, Number(process.env.SOS_SMS_INTERVAL_SECONDS) || 120);
  const lastSmsMs = sos.last_sms_location_at ? new Date(sos.last_sms_location_at).getTime() : new Date(sos.created_at).getTime();
  let smsLocationSent = false;

  if (Date.now() - lastSmsMs >= intervalSec * 1000) {
    const verifiedCaregivers = db.prepare(`
      SELECT * FROM emergency_contacts
      WHERE user_id = ? AND is_caregiver = 1 AND phone_verified = 1
    `).all(req.user!.id) as any[];

    if (verifiedCaregivers.length > 0) {
      const baseUrl = getAppBaseUrl(req);
      const trackingUrl = session?.tracking_token ? `${baseUrl}/track/${session.tracking_token}` : `${baseUrl}/citizen/seva-shield`;
      const mapsLink = `https://maps.google.com/?q=${d.latitude.toFixed(6)},${d.longitude.toFixed(6)}`;
      const timeStr = new Date(nowIso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      const periodicSmsText = `SEVA AI LIVE SOS UPDATE: ${req.user!.full_name} current location: ${mapsLink} . Live tracking map: ${trackingUrl} . Updated at: ${timeStr}.`;

      db.prepare('UPDATE sos_events SET last_sms_location_at = ? WHERE id = ?').run(nowIso, sos.id);
      for (const cg of verifiedCaregivers) {
        const resSms = await sendAndLogSms({
          userId: req.user!.id,
          recipientPhone: cg.phone,
          eventType: 'SOS_LOCATION_UPDATE',
          relatedId: sos.id,
          message: periodicSmsText,
          dedupeWindowSec: Math.max(20, intervalSec - 5),
        });
        db.prepare(`
          INSERT INTO emergency_notifications (id, sos_event_id, recipient_name, recipient_phone, channel, status, provider, provider_message_id, error_message, payload_text)
          VALUES (?, ?, ?, ?, 'sms', ?, ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(),
          sos.id,
          cg.name,
          cg.phone,
          resSms.status,
          resSms.provider,
          resSms.providerMessageId || null,
          resSms.error || null,
          periodicSmsText
        );
      }
      smsLocationSent = true;
    }
  }

  res.json({ success: true, recordedAt: nowIso, periodicSmsTriggered: smsLocationSent });
});

// Authority acknowledges SOS
sevaShieldRouter.post('/sos/:id/acknowledge', requireAuthority, (req: AuthedRequest, res) => {
  const sos = db.prepare('SELECT * FROM sos_events WHERE id = ?').get(req.params.id) as any;
  if (!sos) {
    res.status(404).json({ error: 'SOS alert not found.' });
    return;
  }
  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE sos_events
    SET status = CASE WHEN status = 'SAFE_RESOLVED' THEN status ELSE 'ACKNOWLEDGED' END,
        acknowledged_by = ?,
        acknowledged_at = ?
    WHERE id = ?
  `).run(req.user!.id, nowIso, sos.id);

  createAndPushNotification({
    userId: sos.citizen_id,
    category: 'SOS_ACKNOWLEDGED',
    title: `SOS Alert Acknowledged (${sos.emergency_code})`,
    message: `Officer ${req.user!.full_name} has acknowledged your SOS emergency and is coordinating response.`,
    linkPath: '/citizen/seva-shield',
    relatedId: sos.id,
    priority: 'emergency',
  });

  // Notify linked caregivers
  const caregivers = db.prepare('SELECT DISTINCT linked_user_id FROM emergency_contacts WHERE user_id = ? AND linked_user_id IS NOT NULL').all(sos.citizen_id) as Array<{ linked_user_id: string }>;
  for (const cg of caregivers) {
    createAndPushNotification({
      userId: cg.linked_user_id,
      category: 'CAREGIVER_SOS_ACKNOWLEDGED',
      title: `SOS Acknowledged by Authority (${sos.emergency_code})`,
      message: `Authority officer ${req.user!.full_name} acknowledged the SOS alert.`,
      linkPath: '/citizen/seva-shield',
      relatedId: sos.id,
      priority: 'high',
    });
  }

  const session = db.prepare('SELECT tracking_token FROM tracking_sessions WHERE sos_event_id = ?').get(sos.id) as { tracking_token: string } | undefined;
  const ackPayload = { type: 'sos:acknowledged', sosId: sos.id, acknowledgedBy: req.user!.full_name, acknowledgedAt: nowIso };
  broadcastToUser(sos.citizen_id, ackPayload);
  broadcastToAuthorities(ackPayload);
  if (session?.tracking_token) broadcastToTrackingToken(session.tracking_token, ackPayload);

  logAudit({
    actorUserId: req.user!.id,
    actorRole: 'authority',
    action: 'SOS_ACKNOWLEDGED',
    resourceType: 'sos_event',
    resourceId: sos.id,
    ipAddress: req.ip,
  });

  res.json({ success: true, acknowledgedAt: nowIso });
});

// Citizen marks "I'm Safe"
sevaShieldRouter.post('/sos/:id/safe', requireCitizen, async (req: AuthedRequest, res) => {
  const sos = db.prepare('SELECT * FROM sos_events WHERE id = ? AND citizen_id = ?').get(req.params.id, req.user!.id) as any;
  if (!sos) {
    res.status(404).json({ error: 'SOS alert not found.' });
    return;
  }

  const nowIso = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`
      UPDATE sos_events SET status = 'SAFE_RESOLVED', resolved_at = ? WHERE id = ?
    `).run(nowIso, sos.id);

    db.prepare(`
      UPDATE tracking_sessions SET is_active = 0, revoked_at = ? WHERE sos_event_id = ?
    `).run(nowIso, sos.id);
  })();

  const session = db.prepare('SELECT tracking_token FROM tracking_sessions WHERE sos_event_id = ?').get(sos.id) as { tracking_token: string } | undefined;

  notifyAllAuthorities({
    category: 'SOS_RESOLVED',
    title: `Citizen Marked Safe (${sos.emergency_code})`,
    message: `${req.user!.full_name} marked themselves safe. Active tracking session has ended.`,
    linkPath: '/authority/emergency',
    relatedId: sos.id,
  });

  const contacts = db.prepare('SELECT * FROM emergency_contacts WHERE user_id = ? AND phone_verified = 1').all(req.user!.id) as any[];
  for (const c of contacts) {
    if (c.linked_user_id) {
      createAndPushNotification({
        userId: c.linked_user_id,
        category: 'CAREGIVER_SAFE',
        title: `${req.user!.full_name} is Safe (${sos.emergency_code})`,
        message: `${req.user!.full_name} selected "I'm Safe". Live location tracking has ended.`,
        linkPath: '/citizen/seva-shield',
        relatedId: sos.id,
      });
    }
    await sendAndLogSms({
      userId: req.user!.id,
      recipientPhone: c.phone,
      eventType: 'SOS_SAFE',
      relatedId: sos.id,
      message: `SEVA AI UPDATE: ${req.user!.full_name} has marked themselves SAFE (${sos.emergency_code}). Emergency live location tracking has ended.`,
      dedupeWindowSec: 15,
    });
  }

  const safePayload = { type: 'sos:safe', sosId: sos.id, resolvedAt: nowIso };
  broadcastToAuthorities(safePayload);
  broadcastToUser(req.user!.id, safePayload);
  if (session?.tracking_token) broadcastToTrackingToken(session.tracking_token, safePayload);

  logAudit({
    actorUserId: req.user!.id,
    actorRole: 'citizen',
    action: 'SOS_MARKED_SAFE',
    resourceType: 'sos_event',
    resourceId: sos.id,
    ipAddress: req.ip,
  });

  res.json({ success: true, resolvedAt: nowIso });
});

// Retry failed external SOS notification
sevaShieldRouter.post('/sos/notifications/:notifId/retry', requireCitizen, async (req: AuthedRequest, res) => {
  const notif = db.prepare(`
    SELECT en.*, se.citizen_id
    FROM emergency_notifications en
    JOIN sos_events se ON se.id = en.sos_event_id
    WHERE en.id = ? AND se.citizen_id = ?
  `).get(req.params.notifId, req.user!.id) as any;

  if (!notif) {
    res.status(404).json({ error: 'Notification delivery record not found.' });
    return;
  }

  let result: { status: string; provider: string; providerMessageId?: string; error?: string };
  if (notif.channel === 'sms' && notif.recipient_phone) {
    const contactRow = db
      .prepare('SELECT phone_verified FROM emergency_contacts WHERE user_id = ? AND phone = ?')
      .get(req.user!.id, notif.recipient_phone) as { phone_verified?: number } | undefined;
    if (contactRow && !contactRow.phone_verified) {
      res.status(400).json({ error: 'Caregiver phone number must be OTP-verified before sending SOS SMS.' });
      return;
    }
    result = await sendAndLogSms({
      userId: req.user!.id,
      recipientPhone: notif.recipient_phone,
      eventType: 'SOS_ACTIVATION_RETRY',
      relatedId: notif.sos_event_id,
      message: notif.payload_text || 'EMERGENCY: Citizen needs help on SEVA AI.',
    });
  } else if (notif.channel === 'email' && notif.recipient_email) {
    result = await sendEmail(
      notif.recipient_email,
      'SEVA AI EMERGENCY SOS ALERT (Retry)',
      `<p>${notif.payload_text || 'Citizen needs urgent assistance.'}</p>`,
      notif.payload_text || 'Citizen needs urgent assistance.'
    );
  } else {
    res.status(400).json({ error: 'Retry is only supported for external SMS and Email channels.' });
    return;
  }

  db.prepare(`
    UPDATE emergency_notifications
    SET status = ?, provider = ?, provider_message_id = ?, error_message = ?, retry_count = retry_count + 1, updated_at = datetime('now')
    WHERE id = ?
  `).run(result.status, result.provider, result.providerMessageId || null, result.error || null, notif.id);

  res.json({
    id: notif.id,
    status: result.status,
    provider: result.provider,
    error: result.error || null,
  });
});

// Citizen SOS history & active SOS
sevaShieldRouter.get('/sos/my', requireCitizen, (req: AuthedRequest, res) => {
  const events = db.prepare(`
    SELECT se.*, ts.tracking_token, ts.is_active as tracking_active,
           au.full_name as acknowledged_by_name
    FROM sos_events se
    LEFT JOIN tracking_sessions ts ON ts.sos_event_id = se.id
    LEFT JOIN users au ON au.id = se.acknowledged_by
    WHERE se.citizen_id = ?
    ORDER BY se.created_at DESC
  `).all(req.user!.id) as any[];

  const hydrated = events.map((ev) => ({
    ...ev,
    deliveries: db.prepare('SELECT * FROM emergency_notifications WHERE sos_event_id = ? ORDER BY created_at ASC').all(ev.id),
    locationsCount: (db.prepare('SELECT COUNT(*) as c FROM sos_location_updates WHERE sos_event_id = ?').get(ev.id) as { c: number }).c,
  }));

  res.json({ events: hydrated });
});

// Authority: All SOS alerts
sevaShieldRouter.get('/sos/all', requireAuthority, (_req, res) => {
  const events = db.prepare(`
    SELECT se.*, u.full_name as citizen_name, u.phone as citizen_phone, u.email as citizen_email,
           ts.tracking_token, au.full_name as acknowledged_by_name
    FROM sos_events se
    JOIN users u ON u.id = se.citizen_id
    LEFT JOIN tracking_sessions ts ON ts.sos_event_id = se.id
    LEFT JOIN users au ON au.id = se.acknowledged_by
    ORDER BY CASE WHEN se.status != 'SAFE_RESOLVED' THEN 0 ELSE 1 END, se.created_at DESC
  `).all();
  res.json({ events });
});

// Public unguessable Caregiver Live Tracking endpoint (no login required, strictly token-gated)
sevaShieldRouter.get('/track/:token', (req, res) => {
  const session = db.prepare(`
    SELECT ts.*, se.emergency_code, se.status as sos_status, se.trigger_method,
           se.latest_latitude, se.latest_longitude, se.latest_accuracy, se.latest_location_at,
           se.acknowledged_at, se.resolved_at, se.created_at as sos_created_at,
           u.full_name as citizen_name
    FROM tracking_sessions ts
    JOIN sos_events se ON se.id = ts.sos_event_id
    JOIN users u ON u.id = ts.citizen_id
    WHERE ts.tracking_token = ?
  `).get(req.params.token) as any;

  if (!session) {
    res.status(404).json({ error: 'Tracking link is invalid or does not exist.' });
    return;
  }

  if (new Date(session.expires_at).getTime() < Date.now()) {
    res.status(410).json({ error: 'This live tracking link has expired.' });
    return;
  }

  const trail = db.prepare(`
    SELECT latitude, longitude, accuracy_meters, recorded_at
    FROM sos_location_updates
    WHERE sos_event_id = ?
    ORDER BY recorded_at ASC
    LIMIT 100
  `).all(session.sos_event_id);

  res.json({
    trackingToken: session.tracking_token,
    emergencyCode: session.emergency_code,
    citizenName: session.citizen_name,
    sosStatus: session.sos_status,
    isActive: Boolean(session.is_active) && session.sos_status !== 'SAFE_RESOLVED',
    latestLocation:
      typeof session.latest_latitude === 'number'
        ? {
            latitude: session.latest_latitude,
            longitude: session.latest_longitude,
            accuracyMeters: session.latest_accuracy,
            recordedAt: session.latest_location_at,
          }
        : null,
    acknowledgedAt: session.acknowledged_at,
    resolvedAt: session.resolved_at,
    createdAt: session.sos_created_at,
    trail,
  });
});
