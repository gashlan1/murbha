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

async function userWithNotif() {
  const agent = request.agent(app);
  const u = 'nf_' + crypto.randomBytes(4).toString('hex');
  await agent.post('/api/auth/register').send({ username: u, password: 'hunter2!!' });
  const { rows } = await pool.query('SELECT id FROM users WHERE username=$1', [u]);
  await pool.query("INSERT INTO notifications (user_id,title,body,type) VALUES ($1,'مرحبا','نص','welcome')", [rows[0].id]);
  return agent;
}

test('list + mark read', { skip: !HAS_DB }, async () => {
  const agent = await userWithNotif();
  const list = await agent.get('/api/notifications');
  assert.equal(list.status, 200);
  assert.equal(list.body.notifications.length, 1);
  assert.equal(list.body.notifications[0].read, false);
  const id = list.body.notifications[0].id;
  assert.equal((await agent.post('/api/notifications/' + id + '/read')).status, 200);
  const after = await agent.get('/api/notifications');
  assert.equal(after.body.notifications[0].read, true);
});

test('read-all + auth required', { skip: !HAS_DB }, async () => {
  const agent = await userWithNotif();
  assert.equal((await agent.post('/api/notifications/read-all')).status, 200);
  assert.equal((await request(app).get('/api/notifications')).status, 401);
});
