const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const crypto = require('node:crypto');
const HAS_DB = !!process.env.DATABASE_URL;

let app, pool;
before(async () => {
  if (!HAS_DB) return;
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
  app = require('../server');
  ({ pool } = require('../db/pool'));
});
after(async () => { if (HAS_DB && pool) await pool.end(); });

test('GET /api/portfolio reflects an investment', { skip: !HAS_DB }, async () => {
  const agent = request.agent(app);
  const u = 'pf_' + crypto.randomBytes(4).toString('hex');
  await agent.post('/api/auth/register').send({ username: u, password: 'hunter2!!' });
  await pool.query('UPDATE users SET balance = 100000 WHERE username = $1', [u]);
  const p = (await request(app).get('/api/projects')).body.projects.find(x => x.status === 'open');
  await agent.post('/api/projects/' + p.slug + '/invest').send({ amount: p.minAmount });

  const res = await agent.get('/api/portfolio');
  assert.equal(res.status, 200);
  assert.equal(res.body.invested, p.minAmount);
  assert.ok(res.body.expectedReturn > p.minAmount);
  assert.equal(res.body.investments.length, 1);
  assert.ok(res.body.transactions.some(t => t.kind === 'investment'));
});

test('GET /api/portfolio requires auth', { skip: !HAS_DB }, async () => {
  assert.equal((await request(app).get('/api/portfolio')).status, 401);
});

test('GET /api/transactions returns user txns', { skip: !HAS_DB }, async () => {
  const agent = request.agent(app);
  const u = 'tx_' + crypto.randomBytes(4).toString('hex');
  await agent.post('/api/auth/register').send({ username: u, password: 'hunter2!!' });
  const res = await agent.get('/api/transactions');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.transactions));
});
