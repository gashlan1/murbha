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
  const u = 'pf_' + crypto.randomBytes(4).toString('hex');
  await agent.post('/api/auth/register').send({ username: u, password: 'hunter2!!' });
  if (balance != null) await pool.query('UPDATE users SET balance = $1 WHERE username = $2', [balance, u]);
  return agent;
}

test('GET /api/portfolio reflects an activated investment', { skip: !HAS_DB }, async () => {
  const agent = await makeUser(100000);
  const p = (await request(app).get('/api/projects')).body.projects.find(x => x.status === 'open');
  const invest = await agent.post('/api/projects/' + p.slug + '/invest').send({ amount: p.minAmount });
  const { contractId } = invest.body;
  await agent.post('/api/contracts/' + contractId + '/sign').send({ signature: 'فهد' });
  await agent.post('/api/contracts/' + contractId + '/pay').send({ method: 'wallet' });

  const res = await agent.get('/api/portfolio');
  assert.equal(res.status, 200);
  assert.equal(res.body.invested, p.minAmount);
  assert.ok(res.body.expectedReturn > p.minAmount);
  assert.equal(res.body.investments.length, 1);
  assert.ok(res.body.transactions.some(t => t.kind === 'invest_confirm'));
});

test('POST /api/portfolio/deposit raises balance + appears in transactions', { skip: !HAS_DB }, async () => {
  const agent = await makeUser(0);
  const res = await agent.post('/api/portfolio/deposit').send({ amount: 5000 });
  assert.equal(res.status, 200);
  assert.equal(res.body.balance, 5000);
  const txns = (await agent.get('/api/transactions')).body.transactions;
  assert.ok(txns.some(t => t.kind === 'deposit' && t.amount === 5000));
});

test('POST /api/portfolio/deposit below 100 -> 400', { skip: !HAS_DB }, async () => {
  const agent = await makeUser(0);
  const res = await agent.post('/api/portfolio/deposit').send({ amount: 50 });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_input');
});

test('POST /api/portfolio/withdraw lowers balance', { skip: !HAS_DB }, async () => {
  const agent = await makeUser(10000);
  const res = await agent.post('/api/portfolio/withdraw').send({ amount: 4000 });
  assert.equal(res.status, 200);
  assert.equal(res.body.balance, 6000);
  const txns = (await agent.get('/api/transactions')).body.transactions;
  assert.ok(txns.some(t => t.kind === 'withdraw' && t.amount === -4000));
});

test('POST /api/portfolio/withdraw over balance -> 400 insufficient', { skip: !HAS_DB }, async () => {
  const agent = await makeUser(1000);
  const res = await agent.post('/api/portfolio/withdraw').send({ amount: 5000 });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'insufficient');
});

test('deposit + withdraw require auth', { skip: !HAS_DB }, async () => {
  assert.equal((await request(app).post('/api/portfolio/deposit').send({ amount: 5000 })).status, 401);
  assert.equal((await request(app).post('/api/portfolio/withdraw').send({ amount: 1 })).status, 401);
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
