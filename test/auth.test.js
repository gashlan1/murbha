const { test } = require('node:test');
const assert = require('node:assert');
const { hashPassword, verifyPassword, newSessionToken } = require('../lib/auth');

test('hashPassword + verifyPassword round-trip', async () => {
  const hash = await hashPassword('hunter2!!');
  assert.notEqual(hash, 'hunter2!!');
  assert.equal(await verifyPassword('hunter2!!', hash), true);
  assert.equal(await verifyPassword('wrong', hash), false);
});

test('newSessionToken is 64 hex chars and unique', () => {
  const a = newSessionToken();
  const b = newSessionToken();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});
