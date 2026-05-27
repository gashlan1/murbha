const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const crypto = require('node:crypto');
const { hashPassword } = require('../lib/auth');
const HAS_DB = !!process.env.DATABASE_URL;

let app, pool;
before(async () => {
  if (!HAS_DB) return;
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
  app = require('../server');
  ({ pool } = require('../db/pool'));
  // Ensure the seeded admin exists, idempotently. Another test file
  // (routes.test.js) wipes the users table, and test files run in a
  // nondeterministic order, so re-assert the admin here.
  const hash = await hashPassword('admin12345');
  await pool.query(
    `INSERT INTO users (username, password_hash, full_name, role, approved)
     VALUES ('admin', $1, 'مدير المنصة', 'admin', true)
     ON CONFLICT (username) DO UPDATE SET role = 'admin', approved = true`,
    [hash]
  );
});
after(async () => { if (HAS_DB && pool) await pool.end(); });

async function makeUser(balance) {
  const agent = request.agent(app);
  const u = 'adm_' + crypto.randomBytes(4).toString('hex');
  await agent.post('/api/auth/register').send({ username: u, password: 'hunter2!!' });
  if (balance != null) await pool.query('UPDATE users SET balance = $1 WHERE username = $2', [balance, u]);
  return { agent, username: u };
}

async function adminAgent() {
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/login').send({ username: 'admin', password: 'admin12345' });
  assert.equal(r.status, 200, 'admin login should succeed (run `npm run seed`)');
  return agent;
}

async function openProject() {
  return (await request(app).get('/api/projects')).body.projects.find(x => x.status === 'open');
}

// Create an ACTIVE investment for `agent` via invest -> sign -> pay (mada).
async function makeActiveInvestment(agent) {
  const p = await openProject();
  const invest = await agent.post('/api/projects/' + p.slug + '/invest').send({ amount: p.minAmount });
  const { contractId, investmentId } = invest.body;
  await agent.post('/api/contracts/' + contractId + '/sign').send({ signature: 'فهد' });
  await agent.post('/api/contracts/' + contractId + '/pay').send({ method: 'mada' });
  return { investmentId, project: p };
}

test('admin endpoints reject non-admin (403) and unauth (401)', { skip: !HAS_DB }, async () => {
  const { agent } = await makeUser(0);
  assert.equal((await agent.get('/api/admin/stats')).status, 403);
  assert.equal((await agent.get('/api/admin/users')).status, 403);
  assert.equal((await request(app).get('/api/admin/stats')).status, 401);
  assert.equal((await request(app).get('/api/admin/users')).status, 401);
});

test('admin stats returns expected shape', { skip: !HAS_DB }, async () => {
  const admin = await adminAgent();
  const r = await admin.get('/api/admin/stats');
  assert.equal(r.status, 200);
  for (const k of ['investors', 'pendingExtensions', 'fundingNeeded', 'projectCount']) {
    assert.equal(typeof r.body[k], 'number', `stats.${k} is a number`);
  }
  assert.ok(r.body.projectCount > 0);
});

test('admin users list includes the admin', { skip: !HAS_DB }, async () => {
  const admin = await adminAgent();
  const r = await admin.get('/api/admin/users');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.users));
  const a = r.body.users.find(u => u.username === 'admin');
  assert.ok(a, 'admin appears in user list');
  assert.equal(a.role, 'admin');
});

test('admin creates a project -> 201 and it appears in public listing', { skip: !HAS_DB }, async () => {
  const admin = await adminAgent();
  const name = 'Test Project ' + crypto.randomBytes(3).toString('hex');
  const r = await admin.post('/api/admin/projects').send({
    name, category: 'تشغيل وصيانة', city: 'الرياض',
    goal: 1000000, minAmount: 5000, profitRate: 0.1, termMonths: 12,
    summary: 'مشروع تجريبي', totalValue: 1200000,
  });
  assert.equal(r.status, 201);
  assert.ok(r.body.project);
  assert.equal(r.body.project.status, 'open');
  assert.equal(r.body.project.raised, 0);
  const slug = r.body.project.slug;
  assert.ok(slug, 'has a slug');

  const list = (await request(app).get('/api/projects')).body.projects;
  assert.ok(list.some(p => p.slug === slug), 'new project appears in public listing');

  // invalid input -> 400
  const bad = await admin.post('/api/admin/projects').send({ name: 'x', goal: 0, minAmount: 1, profitRate: 0.1, termMonths: 12 });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_input');
});

test('admin can PATCH a project', { skip: !HAS_DB }, async () => {
  const admin = await adminAgent();
  const created = await admin.post('/api/admin/projects').send({
    name: 'Patch Me ' + crypto.randomBytes(3).toString('hex'),
    goal: 500000, minAmount: 1000, profitRate: 0.08, termMonths: 6,
  });
  const id = created.body.project.id;
  const r = await admin.patch('/api/admin/projects/' + id).send({ status: 'funded', goal: 600000 });
  assert.equal(r.status, 200);
  assert.equal(r.body.project.status, 'funded');
  assert.equal(r.body.project.goal, 600000);
});

test('approve/reject flips approved flag', { skip: !HAS_DB }, async () => {
  const admin = await adminAgent();
  const { username } = await makeUser(0);
  const id = (await pool.query('SELECT id FROM users WHERE username = $1', [username])).rows[0].id;

  const rej = await admin.post('/api/admin/users/' + id + '/reject').send({});
  assert.equal(rej.status, 200);
  assert.equal(rej.body.user.approved, false);

  const app2 = await admin.post('/api/admin/users/' + id + '/approve').send({});
  assert.equal(app2.status, 200);
  assert.equal(app2.body.user.approved, true);

  // malformed id -> 404
  assert.equal((await admin.post('/api/admin/users/not-a-uuid/approve').send({})).status, 404);
});

test('user requests extension -> admin sees + resolves it', { skip: !HAS_DB }, async () => {
  const { agent } = await makeUser(0);
  const { investmentId } = await makeActiveInvestment(agent);

  const req1 = await agent.post('/api/investments/' + investmentId + '/extend').send({ months: 6 });
  assert.equal(req1.status, 201);
  const extId = req1.body.extensionId;
  assert.ok(extId);

  // owner-only: another user cannot extend it
  const other = await makeUser(0);
  assert.equal((await other.agent.post('/api/investments/' + investmentId + '/extend').send({ months: 6 })).status, 404);

  const admin = await adminAgent();
  const list = await admin.get('/api/admin/extensions');
  assert.equal(list.status, 200);
  const found = list.body.extensions.find(e => e.id === extId);
  assert.ok(found, 'admin sees the pending extension');
  assert.equal(found.months, 6);

  const resolved = await admin.post('/api/admin/extensions/' + extId + '/resolve').send({ decision: 'approved' });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.extension.status, 'approved');

  const after = (await pool.query('SELECT status, resolved_at FROM investment_extensions WHERE id = $1', [extId])).rows[0];
  assert.equal(after.status, 'approved');
  assert.ok(after.resolved_at);
});
