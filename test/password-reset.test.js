const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const HAS_DB = !!process.env.DATABASE_URL;

let app, pool, hashPassword;
before(async () => {
  if (!HAS_DB) return;
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
  app = require('../server');
  ({ pool } = require('../db/pool'));
  ({ hashPassword } = require('../lib/auth'));
  // Confine cleanup to this file's mobile range.
  await pool.query("DELETE FROM otp_codes WHERE mobile LIKE '+9665998%'");
  await pool.query("DELETE FROM password_resets WHERE user_id IN (SELECT id FROM users WHERE mobile LIKE '+9665998%' OR email LIKE 'reset+%')");
  await pool.query("DELETE FROM users WHERE mobile LIKE '+9665998%' OR email LIKE 'reset+%'");
});
after(async () => { if (HAS_DB && pool) await pool.end(); });

test('reset/request: unknown identifier returns quiet success on both channels', { skip: !HAS_DB }, async () => {
  const sms = await request(app).post('/api/auth/password-reset/request')
    .send({ channel: 'sms', identifier: '0599800001' });
  assert.equal(sms.status, 200);

  const email = await request(app).post('/api/auth/password-reset/request')
    .send({ channel: 'email', identifier: 'reset+unknown@example.com' });
  assert.equal(email.status, 200);
});

test('reset/confirm: SMS path resets password and kills sessions', { skip: !HAS_DB }, async () => {
  const mobile = '0599800002';
  const password = 'OldPass!1';
  const newPassword = 'BrandNew!9';

  // Register the account, then capture its session cookie.
  const agent = request.agent(app);
  const reg = await agent.post('/api/auth/register-mobile')
    .send({ mobile, password, full_name: 'Reset SMS' });
  assert.equal(reg.status, 201);
  // Confirm the session is live before reset.
  const meBefore = await agent.get('/api/auth/me');
  assert.equal(meBefore.status, 200);

  // Stage a reset OTP directly (the endpoint hashes the code).
  const code = '7777';
  const codeHash = await hashPassword(code);
  await pool.query(
    `INSERT INTO otp_codes (mobile, code_hash, purpose, expires_at)
     VALUES ($1, $2, 'reset', now() + interval '10 minutes')`,
    ['+966599800002', codeHash]
  );

  const confirm = await request(app).post('/api/auth/password-reset/confirm')
    .send({ channel: 'sms', mobile, code, new_password: newPassword });
  assert.equal(confirm.status, 200);

  // Old session cookie should now be dead (reset wipes all sessions for the user).
  const meAfter = await agent.get('/api/auth/me');
  assert.equal(meAfter.status, 401);

  // New password works.
  const ok = await request(app).post('/api/auth/login-mobile')
    .send({ mobile, password: newPassword });
  assert.equal(ok.status, 200);

  // Old password rejected.
  const fail = await request(app).post('/api/auth/login-mobile')
    .send({ mobile, password });
  assert.equal(fail.status, 401);
});

test('reset/confirm: email path consumes token and updates password', { skip: !HAS_DB }, async () => {
  // Seed a user with an email directly (the signup form does not collect one yet).
  const email = 'reset+email@example.com';
  const oldHash = await hashPassword('OldPass!1');
  const { rows } = await pool.query(
    `INSERT INTO users (username, password_hash, full_name, email)
     VALUES ('reset_email_user', $1, 'Reset Email', $2)
     RETURNING id`,
    [oldHash, email]
  );
  const userId = rows[0].id;

  // Request a reset (server inserts a row in password_resets).
  const req1 = await request(app).post('/api/auth/password-reset/request')
    .send({ channel: 'email', identifier: email });
  assert.equal(req1.status, 200);

  // Read the generated token back so we can confirm.
  const t = await pool.query(
    `SELECT token FROM password_resets WHERE user_id = $1 AND used_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  assert.ok(t.rows[0], 'expected a password_resets row');
  const token = t.rows[0].token;

  const newPassword = 'EmailReset!9';
  const confirm = await request(app).post('/api/auth/password-reset/confirm')
    .send({ channel: 'email', token, new_password: newPassword });
  assert.equal(confirm.status, 200);

  // Token cannot be reused.
  const replay = await request(app).post('/api/auth/password-reset/confirm')
    .send({ channel: 'email', token, new_password: newPassword });
  assert.equal(replay.status, 400);
});

test('reset/confirm: invalid token returns 400', { skip: !HAS_DB }, async () => {
  const res = await request(app).post('/api/auth/password-reset/confirm')
    .send({ channel: 'email', token: 'definitely-not-a-real-token', new_password: 'NewPass!42' });
  assert.equal(res.status, 400);
});

test('reset/confirm: rejects weak new password', { skip: !HAS_DB }, async () => {
  const res = await request(app).post('/api/auth/password-reset/confirm')
    .send({ channel: 'email', token: 'whatever', new_password: 'weak' });
  assert.equal(res.status, 400);
});
