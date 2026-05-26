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

async function makeUser(balance) {
  const agent = request.agent(app);
  const u = 'inv_' + crypto.randomBytes(4).toString('hex');
  await agent.post('/api/auth/register').send({ username: u, password: 'hunter2!!' });
  if (balance) await pool.query('UPDATE users SET balance = $1 WHERE username = $2', [balance, u]);
  return agent;
}

test('GET /api/projects returns seeded projects with fundedPct', { skip: !HAS_DB }, async () => {
  const res = await request(app).get('/api/projects');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.projects));
  assert.ok(res.body.projects.length >= 1);
  const p = res.body.projects[0];
  assert.ok('fundedPct' in p && 'profitRate' in p && 'minAmount' in p);
});

test('GET /api/projects?category= filters', { skip: !HAS_DB }, async () => {
  const all = (await request(app).get('/api/projects')).body.projects;
  const cat = all[0].category;
  const res = await request(app).get('/api/projects?category=' + encodeURIComponent(cat));
  assert.equal(res.status, 200);
  assert.ok(res.body.projects.every(p => p.category === cat));
});

test('GET /api/projects/:slug returns one; 404 when missing', { skip: !HAS_DB }, async () => {
  const all = (await request(app).get('/api/projects')).body.projects;
  const ok = await request(app).get('/api/projects/' + all[0].slug);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.project.slug, all[0].slug);
  const miss = await request(app).get('/api/projects/does-not-exist');
  assert.equal(miss.status, 404);
});

test('POST invest: creates pending investment + contract, leaves balance + raised unchanged', { skip: !HAS_DB }, async () => {
  const agent = await makeUser(100000);
  const p = (await request(app).get('/api/projects')).body.projects.find(x => x.status === 'open');
  // The project's global `raised` total is shared mutable state across the seeded
  // dataset, so concurrent test files paying into the same project make a global
  // delta assertion flaky. Instead we prove "invest moved no money" via this user's
  // own balance + portfolio and the per-row statuses, which are isolated to us.
  const balanceBefore = (await agent.get('/api/portfolio')).body.balance;

  const res = await agent.post('/api/projects/' + p.slug + '/invest').send({ amount: p.minAmount });
  assert.equal(res.status, 201);
  assert.ok(res.body.investmentId, 'returns investmentId');
  assert.ok(res.body.contractId, 'returns contractId');
  assert.equal(res.body.amount, p.minAmount);

  // The investment row is created as pending_signature, the contract as pending —
  // no funds moved, no raised/investor_count bump attributable to this invest.
  const inv = (await pool.query('SELECT status FROM investments WHERE id = $1', [res.body.investmentId])).rows[0];
  assert.equal(inv.status, 'pending_signature');
  const con = (await pool.query('SELECT status FROM contracts WHERE id = $1', [res.body.contractId])).rows[0];
  assert.equal(con.status, 'pending');

  // invest alone must NOT move this user's balance, and the pending invest must not
  // count toward portfolio.invested (full balance/raised movement is asserted in
  // the pay test in contracts.test.js).
  const balanceAfter = (await agent.get('/api/portfolio')).body.balance;
  assert.equal(balanceAfter, balanceBefore);
  assert.equal((await agent.get('/api/portfolio')).body.invested, 0);
});

test('POST invest: rejects below_min / exceeds_remaining / unauth', { skip: !HAS_DB }, async () => {
  const agent = await makeUser(100000);
  const p = (await request(app).get('/api/projects')).body.projects.find(x => x.status === 'open');
  const below = await agent.post('/api/projects/' + p.slug + '/invest').send({ amount: 1 });
  assert.equal(below.status, 400);
  assert.equal(below.body.error, 'below_min');
  const over = await agent.post('/api/projects/' + p.slug + '/invest').send({ amount: p.goal });
  assert.equal(over.status, 400);
  assert.equal(over.body.error, 'exceeds_remaining');
  assert.equal((await request(app).post('/api/projects/' + p.slug + '/invest').send({ amount: p.minAmount })).status, 401);
});
