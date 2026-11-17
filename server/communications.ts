import crypto from 'crypto';
import { db } from './db.ts';

export interface DeliveryResult {
  status: 'ACCEPTED_BY_PROVIDER' | 'DELIVERED' | 'FAILED' | 'NOT_CONFIGURED';
  provider: string;
  providerMessageId?: string;
  error?: string;
}

export interface LoggedSmsResult extends DeliveryResult {
  logId: string;
  deduplicated?: boolean;
}

export function getCommunicationProviderStatus() {
  const smsProvider = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER
    ? 'Twilio'
    : process.env.MSG91_AUTH_KEY && process.env.MSG91_TEMPLATE_ID
      ? 'MSG91'
      : null;

  const emailProvider = process.env.RESEND_API_KEY
    ? 'Resend'
    : process.env.SENDGRID_API_KEY
      ? 'SendGrid'
      : null;

  const voiceProvider = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER
    ? 'Twilio Voice'
    : null;

  return {
    smsConfigured: Boolean(smsProvider),
    smsProvider,
    emailConfigured: Boolean(emailProvider),
    emailProvider,
    voiceConfigured: Boolean(voiceProvider),
    voiceProvider,
  };
}

export async function sendSms(toPhone: string, message: string): Promise<DeliveryResult> {
  // 1. Twilio SMS
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      const from = process.env.TWILIO_PHONE_NUMBER;
      const params = new URLSearchParams({ To: toPhone, From: from, Body: message });

      const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      const data = await resp.json() as any;
      if (!resp.ok) {
        return {
          status: 'FAILED',
          provider: 'Twilio',
          error: data?.message || `Twilio error HTTP ${resp.status}`,
        };
      }
      return {
        status: data?.status === 'delivered' ? 'DELIVERED' : 'ACCEPTED_BY_PROVIDER',
        provider: 'Twilio',
        providerMessageId: data.sid,
      };
    } catch (err: any) {
      return {
        status: 'FAILED',
        provider: 'Twilio',
        error: err?.message || 'Network error calling Twilio API',
      };
    }
  }

  // 2. MSG91 SMS
  if (process.env.MSG91_AUTH_KEY && process.env.MSG91_TEMPLATE_ID) {
    try {
      const mobileDigits = toPhone.replace(/^\+/, '');
      const resp = await fetch('https://control.msg91.com/api/v5/flow/', {
        method: 'POST',
        headers: {
          authkey: process.env.MSG91_AUTH_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          template_id: process.env.MSG91_TEMPLATE_ID,
          sender: process.env.MSG91_SENDER_ID || 'SEVAAI',
          short_url: '0',
          recipients: [{ mobiles: mobileDigits, message }],
        }),
      });
      const data = await resp.json() as any;
      if (!resp.ok || data?.type === 'error') {
        return {
          status: 'FAILED',
          provider: 'MSG91',
          error: data?.message || `MSG91 error HTTP ${resp.status}`,
        };
      }
      return {
        status: 'ACCEPTED_BY_PROVIDER',
        provider: 'MSG91',
        providerMessageId: data?.request_id || data?.message,
      };
    } catch (err: any) {
      return {
        status: 'FAILED',
        provider: 'MSG91',
        error: err?.message || 'Network error calling MSG91 API',
      };
    }
  }

  return {
    status: 'NOT_CONFIGURED',
    provider: 'None',
    error: 'No SMS provider configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_PHONE_NUMBER or MSG91_AUTH_KEY missing).',
  };
}

export async function sendAndLogSms(params: {
  userId?: string | null;
  recipientPhone: string;
  eventType: string;
  relatedId?: string | null;
  message: string;
  storedMessagePreview?: string;
  dedupeWindowSec?: number;
}): Promise<LoggedSmsResult> {
  const storedBody = params.storedMessagePreview ?? params.message;

  if (params.dedupeWindowSec && params.dedupeWindowSec > 0) {
    const recent = db.prepare(`
      SELECT id, status, provider, provider_message_id, error_message
      FROM sms_logs
      WHERE recipient_phone = ? AND event_type = ? AND COALESCE(related_id, '') = COALESCE(?, '')
        AND message_body = ?
        AND status != 'FAILED'
        AND datetime(created_at) >= datetime('now', '-' || ? || ' seconds')
      ORDER BY created_at DESC LIMIT 1
    `).get(params.recipientPhone, params.eventType, params.relatedId || null, storedBody, params.dedupeWindowSec) as any;

    if (recent) {
      return {
        logId: recent.id,
        status: recent.status,
        provider: recent.provider || 'None',
        providerMessageId: recent.provider_message_id || undefined,
        error: recent.error_message || undefined,
        deduplicated: true,
      };
    }
  }

  const result = await sendSms(params.recipientPhone, params.message);
  const logId = crypto.randomUUID();

  try {
    db.prepare(`
      INSERT INTO sms_logs (
        id, user_id, recipient_phone, event_type, related_id, message_body,
        status, provider, provider_message_id, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      logId,
      params.userId || null,
      params.recipientPhone,
      params.eventType,
      params.relatedId || null,
      storedBody,
      result.status,
      result.provider,
      result.providerMessageId || null,
      result.error || null
    );
  } catch (err) {
    console.error('Failed to persist SMS log:', err);
  }

  return {
    logId,
    ...result,
    deduplicated: false,
  };
}

export async function sendEmail(toEmail: string, subject: string, htmlBody: string, textBody: string): Promise<DeliveryResult> {
  // 1. Resend
  if (process.env.RESEND_API_KEY) {
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL || 'SEVA AI <onboarding@resend.dev>',
          to: [toEmail],
          subject,
          html: htmlBody,
          text: textBody,
        }),
      });
      const data = await resp.json() as any;
      if (!resp.ok) {
        return {
          status: 'FAILED',
          provider: 'Resend',
          error: data?.message || `Resend error HTTP ${resp.status}`,
        };
      }
      return {
        status: 'ACCEPTED_BY_PROVIDER',
        provider: 'Resend',
        providerMessageId: data?.id,
      };
    } catch (err: any) {
      return {
        status: 'FAILED',
        provider: 'Resend',
        error: err?.message || 'Network error calling Resend API',
      };
    }
  }

  // 2. SendGrid
  if (process.env.SENDGRID_API_KEY) {
    try {
      const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: toEmail }] }],
          from: { email: process.env.SENDGRID_FROM_EMAIL || 'noreply@seva-ai.in' },
          subject,
          content: [
            { type: 'text/plain', value: textBody },
            { type: 'text/html', value: htmlBody },
          ],
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        return {
          status: 'FAILED',
          provider: 'SendGrid',
          error: errText || `SendGrid error HTTP ${resp.status}`,
        };
      }
      return {
        status: 'ACCEPTED_BY_PROVIDER',
        provider: 'SendGrid',
        providerMessageId: resp.headers.get('x-message-id') || undefined,
      };
    } catch (err: any) {
      return {
        status: 'FAILED',
        provider: 'SendGrid',
        error: err?.message || 'Network error calling SendGrid API',
      };
    }
  }

  return {
    status: 'NOT_CONFIGURED',
    provider: 'None',
    error: 'No email provider configured (RESEND_API_KEY or SENDGRID_API_KEY missing).',
  };
}

export async function triggerVoiceCall(toPhone: string, spokenAlertText: string): Promise<DeliveryResult> {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      const from = process.env.TWILIO_PHONE_NUMBER;
      const twiml = `<Response><Say voice="alice" language="en-IN">${spokenAlertText.replace(/[<>&"]/g, '')}</Say></Response>`;

      const params = new URLSearchParams({
        To: toPhone,
        From: from,
        Twiml: twiml,
      });

      const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      const data = await resp.json() as any;
      if (!resp.ok) {
        return {
          status: 'FAILED',
          provider: 'Twilio Voice',
          error: data?.message || `Twilio Voice HTTP ${resp.status}`,
        };
      }
      return {
        status: 'ACCEPTED_BY_PROVIDER',
        provider: 'Twilio Voice',
        providerMessageId: data?.sid,
      };
    } catch (err: any) {
      return {
        status: 'FAILED',
        provider: 'Twilio Voice',
        error: err?.message || 'Network error calling Twilio Voice API',
      };
    }
  }

  return {
    status: 'NOT_CONFIGURED',
    provider: 'None',
    error: 'Server-side voice calling is not configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_PHONE_NUMBER missing). Use manual emergency dial.',
  };
}
