const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

// Mobile-first auth endpoints need Postgres. Skip cleanly when absent.
const HAS_DB = !!process.env.DATABASE_URL;

let app, pool;
before(async () => {
  if (!HAS_DB) return;
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
  app = require('../server');
  ({ pool } = require('../db/pool'));
  // Clean only the rows we'll touch — leave other test fixtures alone.
  await pool.query("DELETE FROM otp_codes WHERE mobile LIKE '+9665999%'");
  await pool.query("DELETE FROM users WHERE mobile LIKE '+9665999%'");
});
after(async () => { if (HAS_DB && pool) await pool.end(); });

// Helper: grab the latest unused OTP for a mobile+purpose, mark it used, and
// return the cleartext code. The endpoint hashes the code so we cannot read
// it back from the DB — we generate one fresh here and stitch it in.
async function injectOtp(mobile, purpose) {
  const code = '4242';
  const { hashPassword } = require('../lib/auth');
  const codeHash = await hashPassword(code);
  await pool.query(
    `INSERT INTO otp_codes (mobile, code_hash, purpose, expires_at)
     VALUES ($1, $2, $3, now() + interval '10 minutes')`,
    [mobile, codeHash, purpose]
  );
  return code;
}

test('register-mobile -> me -> login-mobile cycle', { skip: !HAS_DB }, async () => {
  const mobile = '0599900001';
  const password = 'StrongPass!1';
  const agent = request.agent(app);

  const reg = await agent.post('/api/auth/register-mobile')
    .send({ mobile, password, full_name: 'Mobile Tester' });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.user.mobile, '+966599900001');

  const me = await agent.get('/api/auth/me');
  assert.equal(me.status, 200);

  const out = await agent.post('/api/auth/logout');
  assert.equal(out.status, 200);

  const login = await request(app).post('/api/auth/login-mobile')
    .send({ mobile, password });
  assert.equal(login.status, 200);
});

test('register-mobile: rejects invalid mobile + weak password', { skip: !HAS_DB }, async () => {
  const bad = await request(app).post('/api/auth/register-mobile')
    .send({ mobile: '123', password: 'StrongPass!1' });
  assert.equal(bad.status, 400);

  const weak = await request(app).post('/api/auth/register-mobile')
    .send({ mobile: '0599900002', password: 'weak' });
  assert.equal(weak.status, 400);
});

test('register-mobile: duplicate mobile -> 409', { skip: !HAS_DB }, async () => {
  const mobile = '0599900003';
  await request(app).post('/api/auth/register-mobile')
    .send({ mobile, password: 'StrongPass!1', full_name: 'First' });
  const dup = await request(app).post('/api/auth/register-mobile')
    .send({ mobile, password: 'StrongPass!1', full_name: 'Second' });
  assert.equal(dup.status, 409);
});

test('login-mobile: bad credentials return 401', { skip: !HAS_DB }, async () => {
  const res = await request(app).post('/api/auth/login-mobile')
    .send({ mobile: '0599900099', password: 'WhateverPass!1' });
  assert.equal(res.status, 401);
});

test('login-mobile: Arabic-Indic digits normalize to the same account', { skip: !HAS_DB }, async () => {
  const mobile = '0599900004';
  const password = 'StrongPass!1';
  await request(app).post('/api/auth/register-mobile')
    .send({ mobile, password, full_name: 'Arabic Digits' });

  // Same number written with Arabic-Indic digits should log into the same account.
  const arabicMobile = '٠٥٩٩٩٠٠٠٠٤';
  const res = await request(app).post('/api/auth/login-mobile')
    .send({ mobile: arabicMobile, password });
  assert.equal(res.status, 200);
});

test('otp/request: unknown mobile returns quiet success (no enumeration)', { skip: !HAS_DB }, async () => {
  const res = await request(app).post('/api/auth/otp/request')
    .send({ mobile: '0599900100', purpose: 'login' });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
});

test('otp/verify: signup creates account via OTP', { skip: !HAS_DB }, async () => {
  const mobile = '+966599900005';
  const code = await injectOtp(mobile, 'signup');
  const res = await request(app).post('/api/auth/otp/verify')
    .send({ mobile, code, purpose: 'signup', full_name: 'OTP Signup' });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.mobile, mobile);
});

test('otp/verify: rejects wrong code', { skip: !HAS_DB }, async () => {
  const mobile = '+966599900006';
  await injectOtp(mobile, 'login');
  const res = await request(app).post('/api/auth/otp/verify')
    .send({ mobile, code: '0000', purpose: 'login' });
  assert.equal(res.status, 400);
});

test('otp/verify: single-use — same code cannot be reused', { skip: !HAS_DB }, async () => {
  const mobile = '0599900007';
  const password = 'StrongPass!1';
  // Pre-create the account so OTP login can succeed.
  await request(app).post('/api/auth/register-mobile')
    .send({ mobile, password, full_name: 'Replay Tester' });
  const code = await injectOtp('+966599900007', 'login');

  const first = await request(app).post('/api/auth/otp/verify')
    .send({ mobile, code, purpose: 'login' });
  assert.equal(first.status, 200);

  const replay = await request(app).post('/api/auth/otp/verify')
    .send({ mobile, code, purpose: 'login' });
  assert.equal(replay.status, 400);
});
