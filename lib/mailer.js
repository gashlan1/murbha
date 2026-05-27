// Best-effort SMTP notifier. The endpoints persist submissions to Postgres
// regardless; this module just notifies the operator when SMTP_* is set, so the
// app stays useful in dev (no creds) and production (real SMTP) without code
// branching at each call site.
//
// Config (.env / .env.local):
//   SMTP_HOST     e.g. smtp.sendgrid.net / smtp.gmail.com / mail.murbha.com
//   SMTP_PORT     587 (STARTTLS) or 465 (TLS); default 587
//   SMTP_USER     SMTP login (e.g. "apikey" for SendGrid)
//   SMTP_PASS     SMTP password / API key
//   SMTP_FROM     From: header (e.g. "Murbha <no-reply@murbha.com>")
//   NOTIFY_TO     Operator inbox to receive contact pings (defaults to SMTP_FROM)
//
// All values optional. With nothing set, send() returns { sent: false, reason }
// and the caller logs a console line — same behaviour as the original stubs.

let _transport;
let _tried = false;

function buildTransport() {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (!host || !user || !pass) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  // Lazy-require so the module is harmless when nodemailer is absent (CI/min installs)
  let nodemailer;
  try { nodemailer = require('nodemailer'); } catch { return null; }
  return nodemailer.createTransport({
    host, port,
    secure: port === 465,                 // 465 = implicit TLS; 587 = STARTTLS
    auth: { user, pass },
  });
}

function transport() {
  if (!_tried) { _transport = buildTransport(); _tried = true; }
  return _transport;
}

function senderConfigured() { return Boolean(transport()); }

/**
 * @param {{ to?: string, subject: string, text: string, replyTo?: string }} msg
 * @returns {Promise<{ sent: boolean, reason?: string, messageId?: string }>}
 */
async function send(msg) {
  const t = transport();
  if (!t) return { sent: false, reason: 'smtp_not_configured' };
  const from = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER;
  const to   = msg.to || process.env.NOTIFY_TO?.trim() || from;
  if (!to) return { sent: false, reason: 'no_recipient' };
  try {
    const r = await t.sendMail({
      from, to, replyTo: msg.replyTo,
      subject: msg.subject, text: msg.text,
    });
    return { sent: true, messageId: r.messageId };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}

module.exports = { send, senderConfigured };
