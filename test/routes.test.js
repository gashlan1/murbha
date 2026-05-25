const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

// These tests need a database. Skip cleanly if DATABASE_URL is unset.
const HAS_DB = !!process.env.DATABASE_URL;

let app, pool;
before(async () => {
  if (!HAS_DB) return;
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
  app = require('../server');
  ({ pool } = require('../db/pool'));
  await pool.query('DELETE FROM sessions');
  await pool.query('DELETE FROM users');
});
after(async () => { if (HAS_DB && pool) await pool.end(); });

test('register -> me -> logout cycle', { skip: !HAS_DB }, async () => {
  const agent = request.agent(app);
  const reg = await agent.post('/api/auth/register')
    .send({ username: 'tester1', password: 'hunter2!!' });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.user.username, 'tester1');

  const me = await agent.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.username, 'tester1');

  const out = await agent.post('/api/auth/logout');
  assert.equal(out.status, 200);

  const me2 = await agent.get('/api/auth/me');
  assert.equal(me2.status, 401);
});

test('duplicate username rejected', { skip: !HAS_DB }, async () => {
  const a = request.agent(app);
  await a.post('/api/auth/register').send({ username: 'dup', password: 'hunter2!!' });
  const res = await request(app).post('/api/auth/register')
    .send({ username: 'dup', password: 'hunter2!!' });
  assert.equal(res.status, 409);
});

test('bad credentials return 401', { skip: !HAS_DB }, async () => {
  const res = await request(app).post('/api/auth/login')
    .send({ username: 'nobody', password: 'whatever1' });
  assert.equal(res.status, 401);
});

test('unauthenticated /portfolio redirects to /login', { skip: !HAS_DB }, async () => {
  const res = await request(app).get('/portfolio').redirects(0);
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/login');
});
