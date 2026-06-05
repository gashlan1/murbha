'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SMS = require('../lib/sms');

test('normPhone: 05XXXXXXXX → +966', () => {
  assert.equal(SMS.normPhone('0501234567'), '+966501234567');
});
test('normPhone: 5XXXXXXXX → +966', () => {
  assert.equal(SMS.normPhone('501234567'), '+966501234567');
});
test('normPhone: 966XXXXXXXXX → +', () => {
  assert.equal(SMS.normPhone('966501234567'), '+966501234567');
});
test('normPhone: 00966 → +', () => {
  assert.equal(SMS.normPhone('00966501234567'), '+966501234567');
});
test('normPhone: already +966 stays', () => {
  assert.equal(SMS.normPhone('+966501234567'), '+966501234567');
});

test('otpTemplate includes the code', () => {
  const t = SMS.otpTemplate('123456');
  assert.ok(t.includes('123456'));
  assert.ok(t.includes('مُرابحة'));
});

test('send dry-runs to mock when no provider set', async () => {
  const r = await SMS.send({ to: '+966500000000', text: 'hello' });
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, true);
});
