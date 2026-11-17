import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.ts';

export const SESSION_COOKIE_NAME = 'seva_session';
const SESSION_DURATION_HOURS = 24 * 7; // 7 days

export interface AuthUser {
  id: string;
  role: 'citizen' | 'authority';
  full_name: string;
  email: string;
  phone: string;
  phone_verified: number;
  email_verified: number;
  anonymous_leaderboard: number;
  department_id?: string | null;
  department_name?: string | null;
  designation?: string | null;
  badge_number?: string | null;
  is_chief_admin?: number;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
  sessionId?: string;
}

export function isDevelopmentMode(): boolean {
  // Never allow frontend to override this. Controlled strictly by server environment.
  if (process.env.SEVA_ENV_MODE === 'production') {
    return false;
  }
  return true;
}

export function normalizePhone(input: string): string | null {
  const cleaned = input.replace(/[\s\-()]/g, '');
  if (/^\+91([6-9]\d{9})$/.test(cleaned)) {
    return `+91${cleaned.slice(3)}`;
  }
  if (/^91([6-9]\d{9})$/.test(cleaned)) {
    return `+91${cleaned.slice(2)}`;
  }
  if (/^0([6-9]\d{9})$/.test(cleaned)) {
    return `+91${cleaned.slice(1)}`;
  }
  if (/^([6-9]\d{9})$/.test(cleaned)) {
    return `+91${cleaned}`;
  }
  // Standard E.164 international phone number with country code (+1..., +44..., etc.)
  if (/^\+[1-9]\d{7,14}$/.test(cleaned)) {
    return cleaned;
  }
  return null;
}

export const normalizeIndianPhone = normalizePhone;

const FALLBACK_RUNTIME_SECRET = 'seva-ai-runtime-secret-key';

export function hashPassword(password: string, existingSalt?: string): { hash: string; salt: string } {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash: derived, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const derived = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, 'hex');
  if (derived.length !== stored.length) return false;
  return crypto.timingSafeEqual(derived, stored);
}

export function generateRandomOtp(): string {
  return String(crypto.randomInt(100000, 1000000));
}

let warnedMissingSecret = false;
export function hashSecret(value: string): string {
  const envSecret = process.env.SESSION_SECRET;
  if (!isDevelopmentMode() && (!envSecret || envSecret === 'replace-with-strong-random-secret') && !warnedMissingSecret) {
    warnedMissingSecret = true;
    console.warn('[SEVA AI SECURITY WARNING] SESSION_SECRET is unset or default in production mode.');
  }
  const secret = envSecret || FALLBACK_RUNTIME_SECRET;
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

export function createSession(userId: string, role: string, req: Request): { token: string; sessionId: string; expiresAt: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSecret(token);
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 3600 * 1000).toISOString();

  db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, role, expires_at, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, userId, tokenHash, role, expiresAt, req.ip || null, req.get('user-agent') || null);

  return { token, sessionId, expiresAt };
}

export function getUserBySessionToken(token: string): { user: AuthUser; sessionId: string } | null {
  if (!token) return null;
  const tokenHash = hashSecret(token);
  const row = db.prepare(`
    SELECT s.id as session_id, s.expires_at,
           u.id, u.role, u.full_name, u.email, u.phone, u.phone_verified, u.email_verified,
           u.anonymous_leaderboard, u.is_active,
           aa.department_id, d.name as department_name, aa.designation, aa.badge_number, aa.is_chief_admin
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN authority_accounts aa ON aa.user_id = u.id
    LEFT JOIN departments d ON d.id = aa.department_id
    WHERE s.token_hash = ?
  `).get(tokenHash) as any;

  if (!row || !row.is_active) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
    return null;
  }

  return {
    sessionId: row.session_id,
    user: {
      id: row.id,
      role: row.role,
      full_name: row.full_name,
      email: row.email,
      phone: row.phone,
      phone_verified: row.phone_verified,
      email_verified: row.email_verified,
      anonymous_leaderboard: row.anonymous_leaderboard,
      department_id: row.department_id,
      department_name: row.department_name,
      designation: row.designation,
      badge_number: row.badge_number,
      is_chief_admin: row.is_chief_admin,
    },
  };
}

export function extractSessionToken(req: Request): string | null {
  const authHeader = req.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (cookieToken) return cookieToken;
  if (req.method === 'GET' && typeof req.query?.token === 'string' && req.query.token.trim()) {
    return req.query.token.trim();
  }
  return null;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = extractSessionToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }
  const session = getUserBySessionToken(token);
  if (!session) {
    res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
    return;
  }
  req.user = session.user;
  req.sessionId = session.sessionId;
  next();
}

export function requireAuthority(req: AuthedRequest, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'authority') {
      res.status(403).json({ error: 'Authorized official access required.' });
      return;
    }
    next();
  });
}

export function requireCitizen(req: AuthedRequest, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'citizen') {
      res.status(403).json({ error: 'Citizen account required.' });
      return;
    }
    next();
  });
}

export function logAudit(params: {
  actorUserId?: string | null;
  actorRole?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  detail?: string;
  ipAddress?: string;
}): void {
  try {
    db.prepare(`
      INSERT INTO audit_logs (id, actor_user_id, actor_role, action, resource_type, resource_id, detail, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      params.actorUserId || null,
      params.actorRole || null,
      params.action,
      params.resourceType || null,
      params.resourceId || null,
      params.detail || null,
      params.ipAddress || null
    );
  } catch (err) {
    console.error('Audit log insert failed:', err);
  }
}

// Simple in-memory rate limiter for auth & OTP abuse protection
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, maxRequests: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (current.count >= maxRequests) {
    return { allowed: false, retryAfterSec: Math.ceil((current.resetAt - now) / 1000) };
  }
  current.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}
