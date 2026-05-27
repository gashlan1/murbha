const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const crypto = require('node:crypto');

const HAS_DB = !!process.env.DATABASE_URL;

let app, pool;
before(async () => {
  if (!HAS_DB) return;
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
  // Make sure no stray SMTP env trips the mailer during tests.
  delete process.env.SMTP_HOST; delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
  app = require('../server');
  ({ pool } = require('../db/pool'));
});
after(async () => { if (HAS_DB && pool) await pool.end(); });

test('POST /api/contact persists submission, returns id', { skip: !HAS_DB }, async () => {
  const unique = `t${crypto.randomBytes(4).toString('hex')}@test.local`;
  const r = await request(app).post('/api/contact').send({
    name: 'Test User', email: unique, message: 'hello there', type: 'general',
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.match(r.body.id, /^[0-9a-f-]{36}$/);

  const { rows } = await pool.query(
    `SELECT name, email, type, message, status FROM contact_submissions WHERE id = $1`, [r.body.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Test User');
  assert.equal(rows[0].email, unique);
  assert.equal(rows[0].message, 'hello there');
  assert.equal(rows[0].status, 'new');
});

test('POST /api/contact rejects missing name/message and bad email', { skip: !HAS_DB }, async () => {
  const r1 = await request(app).post('/api/contact').send({ message: 'no name' });
  assert.equal(r1.status, 400);
  const r2 = await request(app).post('/api/contact').send({ name: 'X', message: '', });
  assert.equal(r2.status, 400);
  const r3 = await request(app).post('/api/contact').send({ name: 'X', message: 'hi', email: 'not-an-email' });
  assert.equal(r3.status, 400);
});

test('POST /api/newsletter idempotent on email', { skip: !HAS_DB }, async () => {
  const unique = `n${crypto.randomBytes(4).toString('hex')}@test.local`;
  const r1 = await request(app).post('/api/newsletter').send({ email: unique, source: 'test' });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.success, true);
  assert.equal(r1.body.alreadySubscribed, false);

  // Re-subscribe with same email: same row, idempotent.
  const r2 = await request(app).post('/api/newsletter').send({ email: unique.toUpperCase(), source: 'test' });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.alreadySubscribed, true);
  assert.equal(r2.body.id, r1.body.id);

  const { rows } = await pool.query(
    `SELECT email, status, source FROM newsletter_subscribers WHERE id = $1`, [r1.body.id]);
  assert.equal(rows[0].email.toLowerCase(), unique);
  assert.equal(rows[0].status, 'active');
});

test('POST /api/newsletter rejects bad email', { skip: !HAS_DB }, async () => {
  for (const bad of ['', 'plain', 'a@b', 'no-at-symbol.com']) {
    const r = await request(app).post('/api/newsletter').send({ email: bad });
    assert.equal(r.status, 400, `expected 400 for "${bad}", got ${r.status}`);
  }
});
