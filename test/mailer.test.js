const { test } = require('node:test');
const assert = require('node:assert');

// Clear any inherited SMTP_* config so the mailer reports "not configured"
// rather than attempting real delivery on a dev machine that happens to have
// SMTP credentials sitting around.
for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_PORT', 'SMTP_FROM', 'NOTIFY_TO']) {
  delete process.env[k];
}

const mailer = require('../lib/mailer');

test('mailer.senderConfigured() is false without SMTP env', () => {
  assert.equal(mailer.senderConfigured(), false);
});

test('mailer.send() degrades gracefully when SMTP is absent', async () => {
  const r = await mailer.send({ to: 'x@example.com', subject: 'hi', text: 'hello' });
  assert.equal(r.sent, false);
  assert.equal(r.reason, 'smtp_not_configured');
});
