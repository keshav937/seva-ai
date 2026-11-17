import crypto from 'crypto';
import type { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { db } from './db.ts';
import { getUserBySessionToken } from './security.ts';

interface SocketMeta {
  ws: WebSocket;
  userId?: string;
  role?: 'citizen' | 'authority';
  trackingTokens: Set<string>;
}

const clients = new Set<SocketMeta>();

export function setupWebSocketServer(server: HttpServer): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const meta: SocketMeta = {
      ws,
      trackingTokens: new Set(),
    };

    // Attempt cookie auth automatically on WebSocket handshake
    const cookieHeader = req.headers.cookie || '';
    const match = cookieHeader.match(/(?:^|;\s*)seva_session=([^;]+)/);
    if (match?.[1]) {
      const session = getUserBySessionToken(decodeURIComponent(match[1]));
      if (session) {
        meta.userId = session.user.id;
        meta.role = session.user.role;
      }
    }

    clients.add(meta);
    ws.send(JSON.stringify({ type: 'ws:connected', authenticated: Boolean(meta.userId), role: meta.role || null }));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'auth' && typeof msg.token === 'string') {
          const session = getUserBySessionToken(msg.token);
          if (session) {
            meta.userId = session.user.id;
            meta.role = session.user.role;
            ws.send(JSON.stringify({ type: 'ws:authenticated', userId: meta.userId, role: meta.role }));
          }
        } else if (msg.type === 'subscribe_tracking' && typeof msg.trackingToken === 'string') {
          const valid = db
            .prepare('SELECT id FROM tracking_sessions WHERE tracking_token = ? AND is_active = 1')
            .get(msg.trackingToken);
          if (valid) {
            meta.trackingTokens.add(msg.trackingToken);
            ws.send(JSON.stringify({ type: 'ws:tracking_subscribed', trackingToken: msg.trackingToken }));
          }
        } else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        }
      } catch {
        // Ignore malformed socket frames
      }
    });

    ws.on('close', () => {
      clients.delete(meta);
    });
  });

  // Start automatic 60-second emergency escalation engine
  startEscalationMonitor();
}

export function broadcastToUser(userId: string, event: Record<string, unknown>): void {
  const payload = JSON.stringify(event);
  for (const client of clients) {
    if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

export function broadcastToAuthorities(event: Record<string, unknown>): void {
  const payload = JSON.stringify(event);
  for (const client of clients) {
    if (client.role === 'authority' && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

export function broadcastToTrackingToken(trackingToken: string, event: Record<string, unknown>): void {
  const payload = JSON.stringify(event);
  for (const client of clients) {
    if (client.trackingTokens.has(trackingToken) && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

export function createAndPushNotification(params: {
  userId: string;
  category: string;
  title: string;
  message: string;
  linkPath?: string;
  relatedId?: string;
  priority?: 'normal' | 'high' | 'emergency';
}): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO notifications (id, user_id, category, title, message, link_path, related_id, priority, delivery_channel, delivery_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'in_app', 'DELIVERED', ?)
  `).run(
    id,
    params.userId,
    params.category,
    params.title,
    params.message,
    params.linkPath || null,
    params.relatedId || null,
    params.priority || 'normal',
    now
  );

  broadcastToUser(params.userId, {
    type: 'notification:new',
    notification: {
      id,
      user_id: params.userId,
      category: params.category,
      title: params.title,
      message: params.message,
      link_path: params.linkPath || null,
      related_id: params.relatedId || null,
      priority: params.priority || 'normal',
      is_read: 0,
      is_acknowledged: 0,
      created_at: now,
    },
  });

  return id;
}

export function notifyAllAuthorities(params: {
  category: string;
  title: string;
  message: string;
  linkPath?: string;
  relatedId?: string;
  priority?: 'normal' | 'high' | 'emergency';
}): void {
  const authorities = db.prepare("SELECT id FROM users WHERE role = 'authority' AND is_active = 1").all() as Array<{ id: string }>;
  for (const auth of authorities) {
    createAndPushNotification({
      userId: auth.id,
      category: params.category,
      title: params.title,
      message: params.message,
      linkPath: params.linkPath,
      relatedId: params.relatedId,
      priority: params.priority,
    });
  }
}

function startEscalationMonitor(): void {
  setInterval(() => {
    try {
      const nowIso = new Date().toISOString();

      // 1. Escalate unacknowledged SOS events older than 60 seconds
      const unackSos = db.prepare(`
        SELECT id, emergency_code, citizen_id, escalation_level
        FROM sos_events
        WHERE status = 'ACTIVE'
          AND escalation_level < 2
          AND datetime(COALESCE(last_escalated_at, created_at)) <= datetime('now', '-60 seconds')
      `).all() as any[];

      for (const sos of unackSos) {
        const nextLevel = sos.escalation_level + 1;
        db.prepare(`
          UPDATE sos_events
          SET status = 'ESCALATED', escalation_level = ?, last_escalated_at = ?
          WHERE id = ?
        `).run(nextLevel, nowIso, sos.id);

        notifyAllAuthorities({
          category: 'SOS_ESCALATION',
          title: `ESCALATED SOS ALERT (${sos.emergency_code})`,
          message: `SOS alert ${sos.emergency_code} remained unacknowledged for >60s and has been escalated to Level ${nextLevel} Supervisory Command.`,
          linkPath: `/authority/emergency`,
          relatedId: sos.id,
          priority: 'emergency',
        });

        broadcastToAuthorities({
          type: 'sos:escalated',
          sosId: sos.id,
          emergencyCode: sos.emergency_code,
          escalationLevel: nextLevel,
          escalatedAt: nowIso,
        });
      }

      // 2. Escalate unacknowledged Critical / Accident / Medical reports older than 60 seconds
      const unackReports = db.prepare(`
        SELECT id, tracking_code, category, citizen_id, escalation_level, assigned_department_id
        FROM reports
        WHERE status = 'SUBMITTED'
          AND (severity = 'Critical' OR category IN ('Road Accident', 'Medical Assistance', 'Women and Child Safety'))
          AND escalation_level < 2
          AND datetime(COALESCE(last_escalated_at, created_at)) <= datetime('now', '-60 seconds')
      `).all() as any[];

      for (const rep of unackReports) {
        const nextLevel = rep.escalation_level + 1;
        db.prepare(`
          UPDATE reports
          SET status = 'ESCALATED', escalation_level = ?, last_escalated_at = ?, updated_at = ?
          WHERE id = ?
        `).run(nextLevel, nowIso, nowIso, rep.id);

        const systemActor = db.prepare("SELECT id FROM users WHERE role = 'authority' LIMIT 1").get() as { id: string } | undefined;
        if (systemActor) {
          db.prepare(`
            INSERT INTO report_status_history (id, report_id, previous_status, new_status, updated_by, action_note, created_at)
            VALUES (?, ?, 'SUBMITTED', 'ESCALATED', ?, ?, ?)
          `).run(
            crypto.randomUUID(),
            rep.id,
            systemActor.id,
            `Auto-escalated after 60s without acknowledgment (Escalation Level ${nextLevel} to Municipal Nodal Desk).`,
            nowIso
          );
        }

        notifyAllAuthorities({
          category: 'REPORT_ESCALATION',
          title: `Auto-Escalated Urgent Report ${rep.tracking_code}`,
          message: `${rep.category} report ${rep.tracking_code} was not acknowledged within 60 seconds and escalated to Level ${nextLevel}.`,
          linkPath: `/authority/reports/${rep.id}`,
          relatedId: rep.id,
          priority: 'high',
        });

        broadcastToAuthorities({
          type: 'report:updated',
          reportId: rep.id,
          status: 'ESCALATED',
        });
        broadcastToUser(rep.citizen_id, {
          type: 'report:updated',
          reportId: rep.id,
          status: 'ESCALATED',
        });
      }
    } catch (err) {
      console.error('Escalation monitor error:', err);
    }
  }, 15000);
}
