/**
 * SMS sender. Provider-abstracted to mirror lib/mailer.js.
 *
 * Adapters:
 *   - mock      — dry-run, logs to stdout (active when no keys set)
 *   - unifonic  — Unifonic (KSA-native, best deliverability in-country)
 *   - twilio    — Twilio (international fallback)
 *
 * Env:
 *   SMS_PROVIDER       one of: mock | unifonic | twilio (default: mock)
 *   UNIFONIC_APP_SID   Unifonic application SID
 *   UNIFONIC_SENDER    sender name (e.g. "Murbha")
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_FROM
 */
'use strict';

const cfg = () => process.env.SMS_PROVIDER || 'mock';

const normPhone = (s) => {
  const d = (s || '').replace(/\D/g, '');
  if (d.startsWith('966')) return '+' + d;
  if (d.startsWith('05'))  return '+966' + d.slice(1);
  if (d.startsWith('5'))   return '+966' + d;
  if (d.startsWith('00966')) return '+' + d.slice(2);
  return (s || '').startsWith('+') ? s : '+' + d;
};

// ── Mock adapter (always available) ──────────────────────────────
const mockSend = async ({ to, text }) => {
  console.log(`[sms-mock] → ${normPhone(to)}: ${text}`);
  return { ok: true, dryRun: true, provider: 'mock' };
};

// ── Unifonic adapter ─────────────────────────────────────────────
// Docs: https://developers.unifonic.com/messaging/messaging-api/sms-api
const unifonicSend = async ({ to, text }) => {
  const sid = process.env.UNIFONIC_APP_SID;
  const sender = process.env.UNIFONIC_SENDER || 'Murbha';
  if (!sid) {
    console.warn('[sms-unifonic] UNIFONIC_APP_SID missing; dry-run');
    return mockSend({ to, text });
  }
  const body = new URLSearchParams({
    AppSid: sid,
    SenderID: sender,
    Recipient: normPhone(to).replace('+', ''),
    Body: text,
  });
  try {
    const r = await fetch('https://el.cloud.unifonic.com/rest/SMS/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: body.toString(),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data?.success === 'false') {
      console.error('[sms-unifonic] error', r.status, data);
      return { ok: false, status: r.status, error: data?.message || data?.errorCode || 'unknown' };
    }
    console.log(`[sms-unifonic] sent → ${normPhone(to)} [id=${data?.data?.MessageID || '-'}]`);
    return { ok: true, id: data?.data?.MessageID, provider: 'unifonic' };
  } catch (e) {
    console.error('[sms-unifonic] send failed', e.message);
    return { ok: false, error: e.message };
  }
};

// ── Twilio adapter ───────────────────────────────────────────────
// Docs: https://www.twilio.com/docs/sms/api
const twilioSend = async ({ to, text }) => {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_FROM;
  if (!sid || !token || !from) {
    console.warn('[sms-twilio] TWILIO_* missing; dry-run');
    return mockSend({ to, text });
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const body = new URLSearchParams({ From: from, To: normPhone(to), Body: text });
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('[sms-twilio] error', r.status, data);
      return { ok: false, status: r.status, error: data?.message || 'unknown' };
    }
    console.log(`[sms-twilio] sent → ${normPhone(to)} [sid=${data.sid}]`);
    return { ok: true, id: data.sid, provider: 'twilio' };
  } catch (e) {
    console.error('[sms-twilio] send failed', e.message);
    return { ok: false, error: e.message };
  }
};

const send = ({ to, text }) => {
  const provider = cfg();
  if (provider === 'unifonic') return unifonicSend({ to, text });
  if (provider === 'twilio')   return twilioSend({ to, text });
  return mockSend({ to, text });
};

// ── Templated messages ───────────────────────────────────────────
const otpTemplate = (code) => `رمز التحقق على منصة مُرابحة: ${code}\nصالح لمدة 10 دقائق. لا تشاركه مع أي شخص.`;

const welcomeTemplate = (name) =>
  `مرحباً ${name || 'بك'} في منصة مُرابحة. اكمل خطوات التحقق من هويتك للبدء.`;

module.exports = {
  send,
  normPhone,
  otpTemplate,
  welcomeTemplate,
  provider: cfg,
};
