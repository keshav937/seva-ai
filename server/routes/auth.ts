import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import { db, STORAGE_AVATAR_DIR } from '../db.ts';
import { getCommunicationProviderStatus, sendAndLogSms, sendEmail } from '../communications.ts';
import { createAndPushNotification } from '../realtime.ts';
import {
  type AuthedRequest,
  SESSION_COOKIE_NAME,
  checkRateLimit,
  createSession,
  extractSessionToken,
  generateRandomOtp,
  getUserBySessionToken,
  hashPassword,
  hashSecret,
  isDevelopmentMode,
  logAudit,
  normalizeIndianPhone,
  requireAuth,
  verifyPassword,
} from '../security.ts';

export const authRouter = express.Router();

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, STORAGE_AVATAR_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '.jpg').replace(/[^a-zA-Z0-9.]/g, '') || '.jpg';
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for profile photographs.'));
    }
  },
});

function isHttpsRequest(req: express.Request): boolean {
  if (req.secure) return true;
  const xfProto = req.get('x-forwarded-proto') || '';
  return xfProto.split(',')[0].trim().toLowerCase() === 'https';
}

function setSessionCookie(req: express.Request, res: express.Response, token: string, expiresAt: string) {
  const isHttps = isHttpsRequest(req);
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    expires: new Date(expiresAt),
    path: '/',
  });
}

function clearSessionCookie(req: express.Request, res: express.Response) {
  const isHttps = isHttpsRequest(req);
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    path: '/',
  });
}

authRouter.get('/session', (req, res) => {
  const token = extractSessionToken(req);
  if (!token) {
    res.json({ authenticated: false, user: null });
    return;
  }
  const session = getUserBySessionToken(token);
  if (!session) {
    clearSessionCookie(req, res);
    res.json({ authenticated: false, user: null });
    return;
  }
  res.json({ authenticated: true, user: session.user });
});

authRouter.get('/mode', (_req, res) => {
  res.json({
    mode: isDevelopmentMode() ? 'development' : 'production',
    providers: getCommunicationProviderStatus(),
  });
});

// Request random server-side OTP
authRouter.post('/otp/request', async (req, res) => {
  const schema = z.object({
    channel: z.enum(['phone', 'email']),
    target: z.string().min(3).max(160),
    purpose: z.enum(['register_phone', 'register_email', 'login_phone', 'reset_password', 'verify_phone', 'authority_login', 'caregiver_phone']),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid OTP request parameters.' });
    return;
  }

  const { channel, purpose } = parsed.data;
  if (purpose === 'caregiver_phone' && channel !== 'phone') {
    res.status(400).json({ error: 'Caregiver verification requires a phone channel.' });
    return;
  }

  let normalizedTarget = parsed.data.target.trim();

  if (channel === 'phone') {
    const phone = normalizeIndianPhone(normalizedTarget);
    if (!phone) {
      res.status(400).json({ error: 'Please enter a valid mobile number (e.g. 10-digit Indian mobile or +countrycode format).' });
      return;
    }
    normalizedTarget = phone;
  } else {
    normalizedTarget = normalizedTarget.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedTarget)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
  }

  const reqToken = extractSessionToken(req);
  const currentSession = reqToken ? getUserBySessionToken(reqToken) : null;
  if (purpose === 'caregiver_phone' && currentSession && currentSession.user.phone === normalizedTarget) {
    res.status(400).json({ error: 'You cannot verify your own mobile number as a caregiver.' });
    return;
  }

  // Rate limit per target & IP
  const rlKey = `otp_req:${req.ip}:${channel}:${normalizedTarget}`;
  const rl = checkRateLimit(rlKey, 5, 10 * 60 * 1000);
  if (!rl.allowed) {
    res.status(429).json({
      error: `Too many OTP requests. Please wait ${rl.retryAfterSec} seconds before requesting another OTP.`,
    });
    return;
  }

  // Enforce 30s resend cooldown on active challenges
  const recent = db.prepare(`
    SELECT id, resend_available_at FROM otp_challenges
    WHERE target = ? AND channel = ? AND purpose = ? AND consumed = 0
    ORDER BY created_at DESC LIMIT 1
  `).get(normalizedTarget, channel, purpose) as { id: string; resend_available_at: string } | undefined;

  if (recent && new Date(recent.resend_available_at).getTime() > Date.now()) {
    const waitSec = Math.ceil((new Date(recent.resend_available_at).getTime() - Date.now()) / 1000);
    res.status(429).json({ error: `Please wait ${waitSec}s before resending OTP.`, retryAfterSec: waitSec });
    return;
  }

  // For login_phone / reset_password, verify account exists
  const existingUser = db.prepare(
    channel === 'phone' ? 'SELECT id, full_name, role FROM users WHERE phone = ?' : 'SELECT id, full_name, role FROM users WHERE email = ?'
  ).get(normalizedTarget) as { id: string; full_name: string; role: string } | undefined;

  if (purpose === 'login_phone' && !existingUser) {
    res.status(404).json({ error: 'No registered account found with this mobile number.' });
    return;
  }
  if (purpose === 'reset_password' && !existingUser) {
    res.status(404).json({ error: 'No account found with this email or mobile number.' });
    return;
  }

  // Generate fresh cryptographic random 6-digit OTP
  const otp = generateRandomOtp();
  const otpSalt = crypto.randomBytes(16).toString('hex');
  const otpHash = hashSecret(`${otp}:${otpSalt}`);
  const challengeId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const resendAvailableAt = new Date(Date.now() + 30 * 1000).toISOString();

  let deliveryStatus = 'PENDING';
  let deliveryProvider = 'Demo Mode';
  let deliveryError: string | null = null;

  const devMode = isDevelopmentMode();

  if (channel === 'phone') {
    const smsBody =
      purpose === 'caregiver_phone'
        ? `SEVA AI Caregiver Verification OTP: ${otp}. Valid for 5 minutes. Only share this if you consent to be linked as an emergency caregiver.`
        : `Your SEVA AI verification OTP is ${otp}. Valid for 5 minutes. Do not share this code with anyone.`;
    const smsRes = await sendAndLogSms({
      userId: currentSession?.user.id || existingUser?.id || null,
      recipientPhone: normalizedTarget,
      eventType: purpose === 'caregiver_phone' ? 'CAREGIVER_OTP' : 'OTP_VERIFICATION',
      relatedId: challengeId,
      message: smsBody,
      storedMessagePreview: `SEVA AI verification OTP (******) [${purpose}]`,
    });
    if (smsRes.status === 'ACCEPTED_BY_PROVIDER' || smsRes.status === 'DELIVERED') {
      deliveryStatus = smsRes.status;
      deliveryProvider = smsRes.provider;
    } else if (!devMode) {
      // Production mode MUST fail clearly if SMS provider cannot accept
      res.status(502).json({
        error: smsRes.error || 'SMS provider could not deliver OTP. Please try again later.',
        deliveryStatus: smsRes.status,
      });
      return;
    } else {
      deliveryStatus = smsRes.status;
      deliveryProvider = smsRes.provider;
      deliveryError = smsRes.error || null;
    }
  } else {
    const emailRes = await sendEmail(
      normalizedTarget,
      'SEVA AI Verification Code',
      `<p>Your SEVA AI verification OTP is <strong>${otp}</strong>. It expires in 5 minutes.</p>`,
      `Your SEVA AI verification OTP is ${otp}. It expires in 5 minutes.`
    );
    if (emailRes.status === 'ACCEPTED_BY_PROVIDER' || emailRes.status === 'DELIVERED') {
      deliveryStatus = emailRes.status;
      deliveryProvider = emailRes.provider;
    } else if (!devMode) {
      res.status(502).json({
        error: emailRes.error || 'Email provider could not deliver OTP. Please try again later.',
        deliveryStatus: emailRes.status,
      });
      return;
    } else {
      deliveryStatus = emailRes.status;
      deliveryProvider = emailRes.provider;
      deliveryError = emailRes.error || null;
    }
  }

  // Invalidate older unconsumed challenges for same target & purpose
  db.prepare(`
    UPDATE otp_challenges SET consumed = 1
    WHERE target = ? AND channel = ? AND purpose = ? AND consumed = 0
  `).run(normalizedTarget, channel, purpose);

  db.prepare(`
    INSERT INTO otp_challenges (
      id, user_id, target, channel, purpose, otp_hash, otp_salt,
      delivery_status, delivery_provider, delivery_error, expires_at, resend_available_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    challengeId,
    existingUser?.id || null,
    normalizedTarget,
    channel,
    purpose,
    otpHash,
    otpSalt,
    deliveryStatus,
    deliveryProvider,
    deliveryError,
    expiresAt,
    resendAvailableAt
  );

  logAudit({
    actorUserId: existingUser?.id || null,
    action: 'OTP_REQUESTED',
    resourceType: 'otp_challenge',
    resourceId: challengeId,
    detail: `channel=${channel}, purpose=${purpose}, deliveryStatus=${deliveryStatus}`,
    ipAddress: req.ip,
  });

  res.json({
    challengeId,
    target: normalizedTarget,
    channel,
    purpose,
    expiresAt,
    resendAvailableAt,
    mode: devMode ? 'development' : 'production',
    deliveryStatus,
    deliveryProvider,
    deliveryError,
    // Strictly only expose test OTP in server-enforced development mode for this session challenge
    ...(devMode ? { devOtp: otp } : {}),
  });
});

// Verify OTP challenge (for registration verification, profile phone/email verification)
authRouter.post('/otp/verify', (req, res) => {
  const schema = z.object({
    challengeId: z.string().uuid(),
    otp: z.string().regex(/^\d{6}$/),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Please enter a valid 6-digit OTP.' });
    return;
  }

  const rl = checkRateLimit(`otp_verify:${req.ip}:${parsed.data.challengeId}`, 10, 10 * 60 * 1000);
  if (!rl.allowed) {
    res.status(429).json({ error: 'Too many failed verification attempts. Request a new OTP.' });
    return;
  }

  const challenge = db.prepare('SELECT * FROM otp_challenges WHERE id = ?').get(parsed.data.challengeId) as any;
  if (!challenge) {
    res.status(404).json({ error: 'OTP challenge not found. Please request a new OTP.' });
    return;
  }
  if (challenge.consumed) {
    res.status(400).json({ error: 'This OTP has already been used or invalidated. Please request a new OTP.' });
    return;
  }
  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    db.prepare('UPDATE otp_challenges SET consumed = 1 WHERE id = ?').run(challenge.id);
    res.status(400).json({ error: 'OTP has expired. Please request a new OTP.' });
    return;
  }
  if (challenge.attempts >= challenge.max_attempts) {
    db.prepare('UPDATE otp_challenges SET consumed = 1 WHERE id = ?').run(challenge.id);
    res.status(400).json({ error: 'Maximum verification attempts exceeded. Please request a new OTP.' });
    return;
  }

  const expectedHash = hashSecret(`${parsed.data.otp}:${challenge.otp_salt}`);
  if (!crypto.timingSafeEqual(Buffer.from(expectedHash, 'hex'), Buffer.from(challenge.otp_hash, 'hex'))) {
    const newAttempts = challenge.attempts + 1;
    db.prepare('UPDATE otp_challenges SET attempts = ? WHERE id = ?').run(newAttempts, challenge.id);
    res.status(400).json({
      error: `Incorrect OTP. ${Math.max(0, challenge.max_attempts - newAttempts)} attempts remaining.`,
    });
    return;
  }

  // Mark challenge verified (keep consumed=1 for standalone verify; registration checks a signed verification proof token)
  db.prepare('UPDATE otp_challenges SET consumed = 1 WHERE id = ?').run(challenge.id);

  // If user is logged in or challenge belongs to an existing user and purpose is verify_phone / register_phone / register_email
  if (challenge.user_id) {
    if (challenge.channel === 'phone') {
      db.prepare("UPDATE users SET phone_verified = 1, updated_at = datetime('now') WHERE id = ?").run(challenge.user_id);
    } else {
      db.prepare("UPDATE users SET email_verified = 1, updated_at = datetime('now') WHERE id = ?").run(challenge.user_id);
    }
  }

  const verificationToken = hashSecret(`verified:${challenge.id}:${challenge.target}:${challenge.channel}`);
  logAudit({
    actorUserId: challenge.user_id || null,
    action: 'OTP_VERIFIED',
    resourceType: 'otp_challenge',
    resourceId: challenge.id,
    detail: `channel=${challenge.channel}, purpose=${challenge.purpose}`,
    ipAddress: req.ip,
  });

  res.json({
    verified: true,
    challengeId: challenge.id,
    target: challenge.target,
    channel: challenge.channel,
    verificationToken,
  });
});

// Citizen registration (strictly citizen role only!)
authRouter.post('/register/citizen', (req, res) => {
  const caregiverSchema = z.object({
    name: z.string().min(2).max(100),
    phone: z.string().min(8).max(20),
    email: z.string().email().optional().or(z.literal('')),
    relationship: z.string().min(2).max(60),
    phoneChallengeId: z.string().uuid(),
    phoneVerificationToken: z.string().min(10),
    locationConsent: z.boolean(),
    caregiverConsent: z.boolean(),
  });

  const schema = z.object({
    fullName: z.string().min(2).max(120),
    email: z.string().email().max(160),
    phone: z.string().min(8).max(20),
    password: z.string().min(8).max(128),
    confirmPassword: z.string().min(8).max(128),
    phoneChallengeId: z.string().uuid().optional(),
    phoneVerificationToken: z.string().optional(),
    emailChallengeId: z.string().uuid().optional(),
    emailVerificationToken: z.string().optional(),
    dpdpConsent: z.boolean(),
    caregiver: caregiverSchema.optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid registration details.' });
    return;
  }

  const data = parsed.data;
  if (data.password !== data.confirmPassword) {
    res.status(400).json({ error: 'Passwords do not match.' });
    return;
  }
  if (!data.dpdpConsent) {
    res.status(400).json({ error: 'Please accept the DPDP Data Privacy Notice to create your account.' });
    return;
  }

  const normalizedPhone = normalizeIndianPhone(data.phone);
  if (!normalizedPhone) {
    res.status(400).json({ error: 'Please enter a valid mobile number.' });
    return;
  }
  const normalizedEmail = data.email.trim().toLowerCase();

  // Verify phone & email OTP proof tokens
  let phoneVerified = 0;
  let emailVerified = 0;

  if (data.phoneChallengeId && data.phoneVerificationToken) {
    const expected = hashSecret(`verified:${data.phoneChallengeId}:${normalizedPhone}:phone`);
    if (expected === data.phoneVerificationToken) {
      phoneVerified = 1;
    }
  }
  if (data.emailChallengeId && data.emailVerificationToken) {
    const expected = hashSecret(`verified:${data.emailChallengeId}:${normalizedEmail}:email`);
    if (expected === data.emailVerificationToken) {
      emailVerified = 1;
    }
  }

  if (!phoneVerified || !emailVerified) {
    res.status(400).json({
      error: 'Both Mobile OTP and Email OTP verification are required before completing citizen registration.',
    });
    return;
  }

  // Optional Caregiver verification & consent validation
  let verifiedCaregiverPhone: string | null = null;
  if (data.caregiver) {
    verifiedCaregiverPhone = normalizeIndianPhone(data.caregiver.phone);
    if (!verifiedCaregiverPhone) {
      res.status(400).json({ error: 'Please enter a valid caregiver mobile number with country code.' });
      return;
    }
    if (verifiedCaregiverPhone === normalizedPhone) {
      res.status(400).json({ error: 'Your own mobile number cannot be linked as your emergency caregiver.' });
      return;
    }
    if (!data.caregiver.locationConsent || !data.caregiver.caregiverConsent) {
      res.status(400).json({ error: 'Both location-sharing consent and caregiver contact consent are required to link a caregiver.' });
      return;
    }
    const expectedCgProof = hashSecret(`verified:${data.caregiver.phoneChallengeId}:${verifiedCaregiverPhone}:phone`);
    const cgChallenge = db.prepare(`
      SELECT id FROM otp_challenges
      WHERE id = ? AND target = ? AND channel = 'phone' AND purpose = 'caregiver_phone' AND consumed = 1
    `).get(data.caregiver.phoneChallengeId, verifiedCaregiverPhone);
    if (expectedCgProof !== data.caregiver.phoneVerificationToken || !cgChallenge) {
      res.status(400).json({ error: 'Caregiver phone number must be verified via OTP before linking.' });
      return;
    }
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ? OR phone = ?').get(normalizedEmail, normalizedPhone);
  if (existing) {
    res.status(409).json({ error: 'An account with this email or mobile number already exists.' });
    return;
  }

  const userId = crypto.randomUUID();
  const { hash, salt } = hashPassword(data.password);
  const nowIso = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO users (id, role, full_name, email, phone, password_hash, password_salt, phone_verified, email_verified)
      VALUES (?, 'citizen', ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, data.fullName.trim(), normalizedEmail, normalizedPhone, hash, salt, phoneVerified, emailVerified);

    db.prepare(`
      INSERT INTO user_profiles (user_id, share_location_consent) VALUES (?, ?)
    `).run(userId, data.caregiver?.locationConsent ? 1 : 0);

    db.prepare(`
      INSERT INTO leaderboard_records (citizen_id, total_points, verified_reports, resolved_reports)
      VALUES (?, 0, 0, 0)
    `).run(userId);

    db.prepare(`
      INSERT INTO consent_records (id, user_id, consent_type, granted, ip_address)
      VALUES (?, ?, 'DPDP_PLATFORM_TERMS', 1, ?)
    `).run(crypto.randomUUID(), userId, req.ip || null);

    // Link optional OTP-verified caregiver during registration
    if (data.caregiver && verifiedCaregiverPhone) {
      const cgLinkedUser = db.prepare('SELECT id FROM users WHERE phone = ?').get(verifiedCaregiverPhone) as { id: string } | undefined;
      const contactId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO emergency_contacts (
          id, user_id, name, phone, email, relationship, is_caregiver,
          linked_user_id, location_consent, phone_verified, verified_at, caregiver_consent
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 1, 1, ?, 1)
      `).run(
        contactId,
        userId,
        data.caregiver.name.trim(),
        verifiedCaregiverPhone,
        data.caregiver.email?.trim().toLowerCase() || null,
        data.caregiver.relationship.trim(),
        cgLinkedUser?.id || null,
        nowIso
      );
      db.prepare(`
        INSERT INTO caregiver_permissions (id, citizen_id, contact_id, caregiver_user_id, can_view_live_location, can_receive_sos)
        VALUES (?, ?, ?, ?, 1, 1)
      `).run(crypto.randomUUID(), userId, contactId, cgLinkedUser?.id || null);
      db.prepare(`
        INSERT INTO consent_records (id, user_id, consent_type, granted, ip_address)
        VALUES (?, ?, ?, 1, ?)
      `).run(crypto.randomUUID(), userId, `CAREGIVER_LOCATION_SHARING_${contactId}`, req.ip || null);
    }

    // Link any existing emergency contacts pointing to this phone number
    db.prepare(`
      UPDATE emergency_contacts SET linked_user_id = ? WHERE phone = ?
    `).run(userId, normalizedPhone);
    db.prepare(`
      UPDATE caregiver_permissions
      SET caregiver_user_id = ?
      WHERE contact_id IN (SELECT id FROM emergency_contacts WHERE phone = ?)
    `).run(userId, normalizedPhone);
  });
  tx();

  createAndPushNotification({
    userId,
    category: 'ACCOUNT',
    title: 'Welcome to SEVA AI',
    message: 'Your citizen account is verified and active. You can report civic issues, use Seva Shield SOS, and track responses.',
    linkPath: '/citizen',
  });

  const session = createSession(userId, 'citizen', req);
  setSessionCookie(req, res, session.token, session.expiresAt);

  logAudit({
    actorUserId: userId,
    actorRole: 'citizen',
    action: 'CITIZEN_REGISTERED',
    resourceType: 'user',
    resourceId: userId,
    ipAddress: req.ip,
  });

  res.status(201).json({
    sessionToken: session.token,
    user: {
      id: userId,
      role: 'citizen',
      full_name: data.fullName.trim(),
      email: normalizedEmail,
      phone: normalizedPhone,
      phone_verified: phoneVerified,
      email_verified: emailVerified,
    },
  });
});

// Citizen Password Login
authRouter.post('/login/password', (req, res) => {
  const schema = z.object({
    identifier: z.string().min(3).max(160),
    password: z.string().min(1).max(128),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Please enter your email/mobile and password.' });
    return;
  }

  const rl = checkRateLimit(`login:${req.ip}`, 15, 10 * 60 * 1000);
  if (!rl.allowed) {
    res.status(429).json({ error: `Too many login attempts. Retry in ${rl.retryAfterSec}s.` });
    return;
  }

  const rawId = parsed.data.identifier.trim();
  const maybePhone = normalizeIndianPhone(rawId);
  const user = db.prepare(
    maybePhone
      ? "SELECT * FROM users WHERE phone = ? AND role = 'citizen'"
      : "SELECT * FROM users WHERE email = ? AND role = 'citizen'"
  ).get(maybePhone || rawId.toLowerCase()) as any;

  if (!user || !user.is_active || !verifyPassword(parsed.data.password, user.password_hash, user.password_salt)) {
    logAudit({ action: 'LOGIN_FAILED', detail: `identifier=${rawId}`, ipAddress: req.ip });
    res.status(401).json({ error: 'Invalid credentials or account inactive.' });
    return;
  }

  const session = createSession(user.id, user.role, req);
  setSessionCookie(req, res, session.token, session.expiresAt);

  logAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'CITIZEN_LOGIN_PASSWORD',
    resourceType: 'user',
    resourceId: user.id,
    ipAddress: req.ip,
  });

  res.json({
    sessionToken: session.token,
    user: {
      id: user.id,
      role: user.role,
      full_name: user.full_name,
      email: user.email,
      phone: user.phone,
      phone_verified: user.phone_verified,
      email_verified: user.email_verified,
    },
  });
});

// Citizen Phone + OTP Login
authRouter.post('/login/phone-otp', (req, res) => {
  const schema = z.object({
    phone: z.string().min(10).max(20),
    challengeId: z.string().uuid(),
    otp: z.string().regex(/^\d{6}$/),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter a valid mobile number and 6-digit OTP.' });
    return;
  }

  const normalizedPhone = normalizeIndianPhone(parsed.data.phone);
  if (!normalizedPhone) {
    res.status(400).json({ error: 'Invalid Indian mobile number.' });
    return;
  }

  const challenge = db.prepare('SELECT * FROM otp_challenges WHERE id = ?').get(parsed.data.challengeId) as any;
  if (!challenge || challenge.consumed || challenge.target !== normalizedPhone || challenge.purpose !== 'login_phone') {
    res.status(400).json({ error: 'Invalid or expired OTP challenge.' });
    return;
  }
  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    db.prepare('UPDATE otp_challenges SET consumed = 1 WHERE id = ?').run(challenge.id);
    res.status(400).json({ error: 'OTP has expired. Request a new one.' });
    return;
  }
  if (challenge.attempts >= challenge.max_attempts) {
    db.prepare('UPDATE otp_challenges SET consumed = 1 WHERE id = ?').run(challenge.id);
    res.status(400).json({ error: 'Too many incorrect attempts.' });
    return;
  }

  const expectedHash = hashSecret(`${parsed.data.otp}:${challenge.otp_salt}`);
  if (!crypto.timingSafeEqual(Buffer.from(expectedHash, 'hex'), Buffer.from(challenge.otp_hash, 'hex'))) {
    db.prepare('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?').run(challenge.id);
    res.status(400).json({ error: 'Incorrect OTP.' });
    return;
  }

  const user = db.prepare("SELECT * FROM users WHERE phone = ? AND role = 'citizen' AND is_active = 1").get(normalizedPhone) as any;
  if (!user) {
    res.status(404).json({ error: 'Citizen account not found.' });
    return;
  }

  db.prepare('UPDATE otp_challenges SET consumed = 1 WHERE id = ?').run(challenge.id);
  db.prepare("UPDATE users SET phone_verified = 1, updated_at = datetime('now') WHERE id = ?").run(user.id);

  const session = createSession(user.id, 'citizen', req);
  setSessionCookie(req, res, session.token, session.expiresAt);

  logAudit({
    actorUserId: user.id,
    actorRole: 'citizen',
    action: 'CITIZEN_LOGIN_OTP',
    resourceType: 'user',
    resourceId: user.id,
    ipAddress: req.ip,
  });

  res.json({
    sessionToken: session.token,
    user: {
      id: user.id,
      role: user.role,
      full_name: user.full_name,
      email: user.email,
      phone: user.phone,
      phone_verified: 1,
      email_verified: user.email_verified,
    },
  });
});

// Forgot Password Reset
authRouter.post('/forgot-password/reset', (req, res) => {
  const schema = z.object({
    target: z.string().min(3).max(160),
    channel: z.enum(['phone', 'email']),
    challengeId: z.string().uuid(),
    otp: z.string().regex(/^\d{6}$/),
    newPassword: z.string().min(8).max(128),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Provide valid target, 6-digit OTP, and password (min 8 chars).' });
    return;
  }

  const normalizedTarget =
    parsed.data.channel === 'phone'
      ? normalizeIndianPhone(parsed.data.target)
      : parsed.data.target.trim().toLowerCase();

  if (!normalizedTarget) {
    res.status(400).json({ error: 'Invalid target phone or email.' });
    return;
  }

  const challenge = db.prepare('SELECT * FROM otp_challenges WHERE id = ?').get(parsed.data.challengeId) as any;
  if (!challenge || challenge.consumed || challenge.target !== normalizedTarget || challenge.purpose !== 'reset_password') {
    res.status(400).json({ error: 'Invalid or expired password reset challenge.' });
    return;
  }
  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    db.prepare('UPDATE otp_challenges SET consumed = 1 WHERE id = ?').run(challenge.id);
    res.status(400).json({ error: 'OTP has expired.' });
    return;
  }

  const expectedHash = hashSecret(`${parsed.data.otp}:${challenge.otp_salt}`);
  if (!crypto.timingSafeEqual(Buffer.from(expectedHash, 'hex'), Buffer.from(challenge.otp_hash, 'hex'))) {
    db.prepare('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?').run(challenge.id);
    res.status(400).json({ error: 'Incorrect OTP.' });
    return;
  }

  const user = db.prepare(
    parsed.data.channel === 'phone' ? 'SELECT id FROM users WHERE phone = ?' : 'SELECT id FROM users WHERE email = ?'
  ).get(normalizedTarget) as { id: string } | undefined;

  if (!user) {
    res.status(404).json({ error: 'Account not found.' });
    return;
  }

  const { hash, salt } = hashPassword(parsed.data.newPassword);
  db.transaction(() => {
    db.prepare('UPDATE otp_challenges SET consumed = 1 WHERE id = ?').run(challenge.id);
    db.prepare("UPDATE users SET password_hash = ?, password_salt = ?, updated_at = datetime('now') WHERE id = ?").run(
      hash,
      salt,
      user.id
    );
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  })();

  logAudit({
    actorUserId: user.id,
    action: 'PASSWORD_RESET',
    resourceType: 'user',
    resourceId: user.id,
    ipAddress: req.ip,
  });

  res.json({ success: true, message: 'Password updated successfully. Please sign in with your new password.' });
});

// Authority bootstrap status & official onboarding (prevents self-assigned authority via citizen signup)
authRouter.get('/authority/bootstrap-status', (_req, res) => {
  const count = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'authority'").get() as { c: number };
  const departments = db.prepare('SELECT id, code, name, category_scope FROM departments WHERE is_active = 1 ORDER BY escalation_order, name').all();
  res.json({
    hasAuthority: count.c > 0,
    departments,
  });
});

// Independent Authority Registration (No Admin approval gate; supports both /authority/onboard and /authority/register)
const handleAuthorityRegister: express.RequestHandler = (req, res) => {
  const schema = z.object({
    fullName: z.string().min(2).max(120),
    email: z.string().email().max(160),
    phone: z.string().min(10).max(20),
    password: z.string().min(8).max(128),
    departmentId: z.string().min(2),
    designation: z.string().min(2).max(100),
    badgeNumber: z.string().min(2).max(50),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid authority registration details.' });
    return;
  }

  const normalizedPhone = normalizeIndianPhone(parsed.data.phone);
  if (!normalizedPhone) {
    res.status(400).json({ error: 'Valid 10-digit Indian official mobile number required.' });
    return;
  }
  const normalizedEmail = parsed.data.email.trim().toLowerCase();

  const dept = db.prepare('SELECT id, name FROM departments WHERE id = ?').get(parsed.data.departmentId) as any;
  if (!dept) {
    res.status(400).json({ error: 'Selected department does not exist.' });
    return;
  }

  const dup = db.prepare('SELECT id FROM users WHERE email = ? OR phone = ?').get(normalizedEmail, normalizedPhone);
  if (dup) {
    res.status(409).json({ error: 'An account with this email or mobile number already exists.' });
    return;
  }

  const dupBadge = db.prepare('SELECT user_id FROM authority_accounts WHERE badge_number = ?').get(parsed.data.badgeNumber.trim());
  if (dupBadge) {
    res.status(409).json({ error: 'Badge number is already registered to an authority officer.' });
    return;
  }

  const authCount = (db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'authority'").get() as { c: number }).c;
  const userId = crypto.randomUUID();
  const { hash, salt } = hashPassword(parsed.data.password);
  const isChief = authCount === 0 ? 1 : 0;

  db.transaction(() => {
    db.prepare(`
      INSERT INTO users (id, role, full_name, email, phone, password_hash, password_salt, phone_verified, email_verified)
      VALUES (?, 'authority', ?, ?, ?, ?, ?, 1, 1)
    `).run(userId, parsed.data.fullName.trim(), normalizedEmail, normalizedPhone, hash, salt);

    db.prepare('INSERT INTO user_profiles (user_id) VALUES (?)').run(userId);

    db.prepare(`
      INSERT INTO authority_accounts (user_id, department_id, designation, badge_number, is_chief_admin)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, dept.id, parsed.data.designation.trim(), parsed.data.badgeNumber.trim(), isChief);
  })();

  const session = createSession(userId, 'authority', req);
  setSessionCookie(req, res, session.token, session.expiresAt);

  logAudit({
    actorUserId: userId,
    actorRole: 'authority',
    action: isChief ? 'CHIEF_AUTHORITY_REGISTERED' : 'AUTHORITY_REGISTERED',
    resourceType: 'authority_account',
    resourceId: userId,
    detail: `department=${dept.name}, badge=${parsed.data.badgeNumber.trim()}`,
    ipAddress: req.ip,
  });

  res.status(201).json({
    sessionToken: session.token,
    user: {
      id: userId,
      role: 'authority',
      full_name: parsed.data.fullName.trim(),
      email: normalizedEmail,
      phone: normalizedPhone,
      phone_verified: 1,
      email_verified: 1,
      anonymous_leaderboard: 0,
      department_id: dept.id,
      department_name: dept.name,
      designation: parsed.data.designation.trim(),
      badge_number: parsed.data.badgeNumber.trim(),
      is_chief_admin: isChief,
    },
  });
};

authRouter.post('/authority/onboard', handleAuthorityRegister);
authRouter.post('/authority/register', handleAuthorityRegister);

// Dedicated Authority Login
authRouter.post('/authority/login', (req, res) => {
  const schema = z.object({
    identifier: z.string().min(3).max(160),
    password: z.string().min(1).max(128),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter your official email or mobile number and password.' });
    return;
  }

  const rl = checkRateLimit(`auth_login:${req.ip}`, 15, 10 * 60 * 1000);
  if (!rl.allowed) {
    res.status(429).json({ error: `Too many login attempts. Retry in ${rl.retryAfterSec}s.` });
    return;
  }

  const rawId = parsed.data.identifier.trim();
  const maybePhone = normalizeIndianPhone(rawId);

  const user = db.prepare(`
    SELECT u.*, aa.department_id, d.name as department_name, aa.designation, aa.badge_number, aa.is_chief_admin
    FROM users u
    JOIN authority_accounts aa ON aa.user_id = u.id
    LEFT JOIN departments d ON d.id = aa.department_id
    WHERE ${maybePhone ? 'u.phone = ?' : 'u.email = ?'} AND u.role = 'authority'
  `).get(maybePhone || rawId.toLowerCase()) as any;

  if (!user || !user.is_active || !verifyPassword(parsed.data.password, user.password_hash, user.password_salt)) {
    logAudit({ action: 'AUTHORITY_LOGIN_FAILED', detail: `identifier=${rawId}`, ipAddress: req.ip });
    res.status(401).json({ error: 'Invalid official credentials.' });
    return;
  }

  const session = createSession(user.id, 'authority', req);
  setSessionCookie(req, res, session.token, session.expiresAt);

  logAudit({
    actorUserId: user.id,
    actorRole: 'authority',
    action: 'AUTHORITY_LOGIN',
    resourceType: 'authority_account',
    resourceId: user.id,
    ipAddress: req.ip,
  });

  res.json({
    sessionToken: session.token,
    user: {
      id: user.id,
      role: 'authority',
      full_name: user.full_name,
      email: user.email,
      phone: user.phone,
      phone_verified: user.phone_verified,
      email_verified: user.email_verified,
      anonymous_leaderboard: user.anonymous_leaderboard,
      department_id: user.department_id,
      department_name: user.department_name,
      designation: user.designation,
      badge_number: user.badge_number,
      is_chief_admin: user.is_chief_admin,
    },
  });
});

authRouter.post('/logout', (req: AuthedRequest, res) => {
  const token = extractSessionToken(req);
  if (token) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashSecret(token));
  }
  clearSessionCookie(req, res);
  res.json({ success: true });
});

authRouter.get('/me', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const profile = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId) as any;
  const contactsCount = (db.prepare('SELECT COUNT(*) as c FROM emergency_contacts WHERE user_id = ?').get(userId) as { c: number }).c;

  // Calculate genuine profile completion %
  const checks = [
    Boolean(req.user!.full_name),
    Boolean(req.user!.phone_verified),
    Boolean(req.user!.email_verified),
    Boolean(profile?.avatar_filename),
    Boolean(profile?.address || profile?.ward || profile?.city),
    contactsCount > 0,
  ];
  const completionPct = Math.round((checks.filter(Boolean).length / checks.length) * 100);

  res.json({
    user: req.user,
    profile: {
      ...profile,
      avatarUrl: profile?.avatar_filename ? `/api/auth/avatars/${userId}?v=${encodeURIComponent(profile.updated_at || '')}` : null,
      completionPct,
    },
    providers: getCommunicationProviderStatus(),
  });
});

authRouter.patch('/profile', requireAuth, (req: AuthedRequest, res) => {
  const schema = z.object({
    fullName: z.string().min(2).max(120).optional(),
    address: z.string().max(300).optional().nullable(),
    ward: z.string().max(100).optional().nullable(),
    city: z.string().max(100).optional().nullable(),
    anonymousLeaderboard: z.boolean().optional(),
    voiceProtectionEnabled: z.boolean().optional(),
    voiceLanguage: z.enum(['en-IN', 'hi-IN']).optional(),
    voiceCustomPhrase: z.string().max(80).optional().nullable(),
    notifySms: z.boolean().optional(),
    notifyEmail: z.boolean().optional(),
    notifyInApp: z.boolean().optional(),
    shareLocationConsent: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid profile update payload.' });
    return;
  }
  const d = parsed.data;
  const userId = req.user!.id;

  db.transaction(() => {
    if (d.fullName !== undefined || d.anonymousLeaderboard !== undefined) {
      db.prepare(`
        UPDATE users
        SET full_name = COALESCE(?, full_name),
            anonymous_leaderboard = COALESCE(?, anonymous_leaderboard),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(
        d.fullName?.trim() || null,
        d.anonymousLeaderboard === undefined ? null : d.anonymousLeaderboard ? 1 : 0,
        userId
      );
    }

    db.prepare(`
      UPDATE user_profiles
      SET address = COALESCE(?, address),
          ward = COALESCE(?, ward),
          city = COALESCE(?, city),
          voice_protection_enabled = COALESCE(?, voice_protection_enabled),
          voice_language = COALESCE(?, voice_language),
          voice_custom_phrase = COALESCE(?, voice_custom_phrase),
          notify_sms = COALESCE(?, notify_sms),
          notify_email = COALESCE(?, notify_email),
          notify_in_app = COALESCE(?, notify_in_app),
          share_location_consent = COALESCE(?, share_location_consent),
          updated_at = datetime('now')
      WHERE user_id = ?
    `).run(
      d.address === undefined ? null : d.address,
      d.ward === undefined ? null : d.ward,
      d.city === undefined ? null : d.city,
      d.voiceProtectionEnabled === undefined ? null : d.voiceProtectionEnabled ? 1 : 0,
      d.voiceLanguage || null,
      d.voiceCustomPhrase === undefined ? null : d.voiceCustomPhrase,
      d.notifySms === undefined ? null : d.notifySms ? 1 : 0,
      d.notifyEmail === undefined ? null : d.notifyEmail ? 1 : 0,
      d.notifyInApp === undefined ? null : d.notifyInApp ? 1 : 0,
      d.shareLocationConsent === undefined ? null : d.shareLocationConsent ? 1 : 0,
      userId
    );
  })();

  logAudit({
    actorUserId: userId,
    actorRole: req.user!.role,
    action: 'PROFILE_UPDATED',
    resourceType: 'user_profile',
    resourceId: userId,
    ipAddress: req.ip,
  });

  res.json({ success: true });
});

authRouter.post('/profile/avatar', requireAuth, avatarUpload.single('avatar'), (req: AuthedRequest, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Please select an image file.' });
    return;
  }
  const userId = req.user!.id;
  const old = db.prepare('SELECT avatar_filename FROM user_profiles WHERE user_id = ?').get(userId) as { avatar_filename?: string } | undefined;
  if (old?.avatar_filename) {
    const oldPath = path.join(STORAGE_AVATAR_DIR, old.avatar_filename);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  db.prepare(`
    UPDATE user_profiles SET avatar_filename = ?, avatar_mime = ?, updated_at = datetime('now') WHERE user_id = ?
  `).run(req.file.filename, req.file.mimetype, userId);

  res.json({
    avatarUrl: `/api/auth/avatars/${userId}?v=${Date.now()}`,
  });
});

authRouter.get('/avatars/:userId', (req, res) => {
  const profile = db.prepare('SELECT avatar_filename, avatar_mime FROM user_profiles WHERE user_id = ?').get(req.params.userId) as any;
  if (!profile?.avatar_filename) {
    res.status(404).json({ error: 'No avatar uploaded.' });
    return;
  }
  const filePath = path.join(STORAGE_AVATAR_DIR, profile.avatar_filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Avatar file missing.' });
    return;
  }
  res.setHeader('Content-Type', profile.avatar_mime || 'image/jpeg');
  res.sendFile(filePath);
});

authRouter.post('/change-password', requireAuth, (req: AuthedRequest, res) => {
  const schema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(128),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'New password must be at least 8 characters.' });
    return;
  }

  const user = db.prepare('SELECT password_hash, password_salt FROM users WHERE id = ?').get(req.user!.id) as any;
  if (!verifyPassword(parsed.data.currentPassword, user.password_hash, user.password_salt)) {
    res.status(400).json({ error: 'Current password is incorrect.' });
    return;
  }

  const { hash, salt } = hashPassword(parsed.data.newPassword);
  db.prepare("UPDATE users SET password_hash = ?, password_salt = ?, updated_at = datetime('now') WHERE id = ?").run(
    hash,
    salt,
    req.user!.id
  );

  logAudit({
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: 'PASSWORD_CHANGED',
    resourceType: 'user',
    resourceId: req.user!.id,
    ipAddress: req.ip,
  });

  res.json({ success: true });
});

authRouter.get('/dpdp/summary', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const consents = db.prepare('SELECT * FROM consent_records WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(userId);
  const userRow = db.prepare('SELECT deletion_requested_at, created_at FROM users WHERE id = ?').get(userId) as any;
  const recentAudit = db.prepare('SELECT action, resource_type, created_at FROM audit_logs WHERE actor_user_id = ? ORDER BY created_at DESC LIMIT 20').all(userId);

  res.json({
    policyVersion: 'DPDP-2026.1',
    deletionRequestedAt: userRow?.deletion_requested_at || null,
    accountCreatedAt: userRow?.created_at || null,
    consents,
    recentAudit,
  });
});

authRouter.post('/request-deletion', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  db.prepare("UPDATE users SET deletion_requested_at = datetime('now') WHERE id = ?").run(userId);
  logAudit({
    actorUserId: userId,
    actorRole: req.user!.role,
    action: 'DPDP_ACCOUNT_DELETION_REQUESTED',
    resourceType: 'user',
    resourceId: userId,
    ipAddress: req.ip,
  });
  res.json({
    success: true,
    message: 'Your DPDP account & personal data deletion request has been logged and queued for verification.',
  });
});
