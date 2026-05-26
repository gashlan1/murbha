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
  const u = 'ct_' + crypto.randomBytes(4).toString('hex');
  await agent.post('/api/auth/register').send({ username: u, password: 'hunter2!!' });
  if (balance != null) await pool.query('UPDATE users SET balance = $1 WHERE username = $2', [balance, u]);
  return agent;
}

async function openProject() {
  return (await request(app).get('/api/projects')).body.projects.find(x => x.status === 'open');
}

test('full cycle: invest -> get -> sign -> pay (wallet) activates investment', { skip: !HAS_DB }, async () => {
  const agent = await makeUser(100000);
  const p = await openProject();
  const amount = p.minAmount;
  const balBefore = (await agent.get('/api/portfolio')).body.balance;
  const raisedBefore = (await request(app).get('/api/projects/' + p.slug)).body.project.raised;

  const invest = await agent.post('/api/projects/' + p.slug + '/invest').send({ amount });
  assert.equal(invest.status, 201);
  const { contractId } = invest.body;

  // GET contract (owner)
  const got = await agent.get('/api/contracts/' + contractId);
  assert.equal(got.status, 200);
  assert.equal(got.body.contract.id, contractId);
  assert.equal(got.body.contract.status, 'pending');
  assert.equal(got.body.contract.amount, amount);
  assert.ok(got.body.project, 'returns project');
  assert.equal(got.body.project.slug, p.slug);

  // Non-UUID -> 404
  assert.equal((await agent.get('/api/contracts/not-a-uuid')).status, 404);

  // Another user cannot read it -> 404
  const other = await makeUser(0);
  assert.equal((await other.get('/api/contracts/' + contractId)).status, 404);

  // Sign
  const signed = await agent.post('/api/contracts/' + contractId + '/sign').send({ signature: 'فهد العنزي' });
  assert.equal(signed.status, 200);
  assert.equal(signed.body.contract.status, 'signed');
  const inv = await pool.query('SELECT status FROM investments WHERE id = $1', [got.body.contract.investmentId]);
  assert.equal(inv.rows[0].status, 'pending_payment');

  // Pay with wallet
  const paid = await agent.post('/api/contracts/' + contractId + '/pay').send({ method: 'wallet' });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.contract.status, 'active');

  // balance debited by amount, raised increased, investment active
  const balAfter = (await agent.get('/api/portfolio')).body.balance;
  assert.equal(balAfter, balBefore - amount);
  const proj = (await request(app).get('/api/projects/' + p.slug)).body.project;
  assert.equal(proj.raised, raisedBefore + amount);
  const portfolio = (await agent.get('/api/portfolio')).body;
  assert.equal(portfolio.invested, amount);
  assert.ok(portfolio.transactions.some(t => t.kind === 'invest_confirm' && t.amount === -amount));

  // Pay again -> alreadyPaid
  const again = await agent.post('/api/contracts/' + contractId + '/pay').send({ method: 'wallet' });
  assert.equal(again.status, 200);
  assert.equal(again.body.alreadyPaid, true);
});

test('sign with empty signature -> 400; unauth -> 401', { skip: !HAS_DB }, async () => {
  const agent = await makeUser(100000);
  const p = await openProject();
  const invest = await agent.post('/api/projects/' + p.slug + '/invest').send({ amount: p.minAmount });
  const { contractId } = invest.body;

  const empty = await agent.post('/api/contracts/' + contractId + '/sign').send({ signature: '   ' });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error, 'invalid_input');

  assert.equal((await request(app).get('/api/contracts/' + contractId)).status, 401);
  assert.equal((await request(app).post('/api/contracts/' + contractId + '/sign').send({ signature: 'x' })).status, 401);
});

test('sign again returns alreadySigned; pay before sign -> 400', { skip: !HAS_DB }, async () => {
  const agent = await makeUser(100000);
  const p = await openProject();
  const invest = await agent.post('/api/projects/' + p.slug + '/invest').send({ amount: p.minAmount });
  const { contractId } = invest.body;

  // pay before signing -> invalid_input
  const earlyPay = await agent.post('/api/contracts/' + contractId + '/pay').send({ method: 'wallet' });
  assert.equal(earlyPay.status, 400);
  assert.equal(earlyPay.body.error, 'invalid_input');

  await agent.post('/api/contracts/' + contractId + '/sign').send({ signature: 'فهد' });
  const second = await agent.post('/api/contracts/' + contractId + '/sign').send({ signature: 'فهد' });
  assert.equal(second.status, 200);
  assert.equal(second.body.alreadySigned, true);
});

test('pay with wallet but insufficient balance -> 400 insufficient', { skip: !HAS_DB }, async () => {
  const agent = await makeUser(0);
  const p = await openProject();
  const invest = await agent.post('/api/projects/' + p.slug + '/invest').send({ amount: p.minAmount });
  const { contractId } = invest.body;
  await agent.post('/api/contracts/' + contractId + '/sign').send({ signature: 'فهد' });
  const paid = await agent.post('/api/contracts/' + contractId + '/pay').send({ method: 'wallet' });
  assert.equal(paid.status, 400);
  assert.equal(paid.body.error, 'insufficient');
});

test('pay with non-wallet method (mada) activates without debiting balance', { skip: !HAS_DB }, async () => {
  const agent = await makeUser(0);
  const p = await openProject();
  const invest = await agent.post('/api/projects/' + p.slug + '/invest').send({ amount: p.minAmount });
  const { contractId } = invest.body;
  await agent.post('/api/contracts/' + contractId + '/sign').send({ signature: 'فهد' });
  const paid = await agent.post('/api/contracts/' + contractId + '/pay').send({ method: 'mada' });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.contract.status, 'active');
  const portfolio = (await agent.get('/api/portfolio')).body;
  assert.equal(portfolio.balance, 0);
  assert.equal(portfolio.invested, p.minAmount);
  assert.ok(portfolio.transactions.some(t => t.kind === 'invest_confirm' && t.amount === 0));
});
