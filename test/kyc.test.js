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

async function makeUser() {
  const agent = request.agent(app);
  const u = 'kyc_' + crypto.randomBytes(4).toString('hex');
  await agent.post('/api/auth/register').send({ username: u, password: 'hunter2!!' });
  return { agent, username: u };
}

test('full KYC chain advances kyc_status to verified', { skip: !HAS_DB }, async () => {
  const { agent } = await makeUser();

  // verify-email: wrong code -> 400 invalid_code
  let r = await agent.post('/api/auth/verify-email').send({ code: '0000' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid_code');

  // verify-email: correct -> email_verified
  r = await agent.post('/api/auth/verify-email').send({ code: '1234' });
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.equal(r.body.kycStatus, 'email_verified');

  // verify-mobile: wrong -> 400
  r = await agent.post('/api/auth/verify-mobile').send({ code: '0000' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid_code');

  // verify-mobile: correct -> mobile_verified
  r = await agent.post('/api/auth/verify-mobile').send({ code: '5678' });
  assert.equal(r.status, 200);
  assert.equal(r.body.kycStatus, 'mobile_verified');

  // verify-id: bad (out of range) -> 400 invalid_id
  r = await agent.post('/api/auth/verify-id').send({ nationalId: '3000000000' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid_id');

  // verify-id: bad (non-numeric) -> 400 invalid_id
  r = await agent.post('/api/auth/verify-id').send({ nationalId: 'abc' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid_id');

  // verify-id: good -> id_verified
  r = await agent.post('/api/auth/verify-id').send({ nationalId: '1099887766' });
  assert.equal(r.status, 200);
  assert.equal(r.body.kycStatus, 'id_verified');

  // verify-address: missing field -> 400 invalid_address
  r = await agent.post('/api/auth/verify-address').send({
    buildingNo: '1234', postalCode: '12345', streetName: 'الملك فهد', district: 'العليا',
    // city missing
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid_address');

  // verify-address: full -> verified
  r = await agent.post('/api/auth/verify-address').send({
    buildingNo: '1234', postalCode: '12345', streetName: 'الملك فهد',
    district: 'العليا', city: 'الرياض',
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.kycStatus, 'verified');

  // me reflects final kycStatus
  const me = await agent.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.kycStatus, 'verified');

  // a notification was inserted on completion
  const { rows } = await pool.query(
    "SELECT 1 FROM notifications WHERE title = 'اكتمل التحقق من الهوية والعنوان الوطني'"
  );
  assert.ok(rows.length >= 1, 'completion notification inserted');
});

test('verify-id stores national_id', { skip: !HAS_DB }, async () => {
  const { agent, username } = await makeUser();
  await agent.post('/api/auth/verify-id').send({ nationalId: '2011223344' });
  const { rows } = await pool.query('SELECT national_id, kyc_status FROM users WHERE username = $1', [username]);
  assert.equal(rows[0].national_id, '2011223344');
  assert.equal(rows[0].kyc_status, 'id_verified');
});

test('all 4 KYC endpoints require auth -> 401 when logged out', { skip: !HAS_DB }, async () => {
  assert.equal((await request(app).post('/api/auth/verify-email').send({ code: '1234' })).status, 401);
  assert.equal((await request(app).post('/api/auth/verify-mobile').send({ code: '5678' })).status, 401);
  assert.equal((await request(app).post('/api/auth/verify-id').send({ nationalId: '1099887766' })).status, 401);
  assert.equal((await request(app).post('/api/auth/verify-address').send({
    buildingNo: '1', postalCode: '12345', streetName: 's', district: 'd', city: 'c',
  })).status, 401);
});
