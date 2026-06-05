'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const WH = require('../lib/webhooks');

test('sign produces stable HMAC-SHA256', () => {
  const sig1 = WH.sign('secret', '{"a":1}');
  const sig2 = WH.sign('secret', '{"a":1}');
  assert.equal(sig1, sig2);
  assert.match(sig1, /^[a-f0-9]{64}$/);
});

test('sign differs with different secrets', () => {
  const a = WH.sign('s1', 'x');
  const b = WH.sign('s2', 'x');
  assert.notEqual(a, b);
});

test('ALLOWED_EVENTS contains the expected set', () => {
  for (const e of ['user.registered','user.approved','contract.signed','sanctions.hit']) {
    assert.ok(WH.ALLOWED_EVENTS.includes(e), `missing event ${e}`);
  }
});
