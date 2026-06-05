'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/totp');

test('RFC 6238 vector: 287082 @ T=59', () => {
  // RFC 6238 Appendix B test key '12345678901234567890' (ASCII)
  const ascii = Buffer.from('12345678901234567890');
  const base32 = T.base32Encode(ascii).replace(/=+$/, '');
  assert.equal(T.totp(base32, 59000), '287082');
});
test('RFC 6238 vector: 081804 @ T=1111111109', () => {
  const ascii = Buffer.from('12345678901234567890');
  const base32 = T.base32Encode(ascii).replace(/=+$/, '');
  assert.equal(T.totp(base32, 1111111109000), '081804');
});
test('verifyTotp: accepts current ±30s window', () => {
  const secret = T.generateSecret();
  const code = T.totp(secret);
  assert.equal(T.verifyTotp(secret, code), true);
  assert.equal(T.verifyTotp(secret, '000000'), false);
  assert.equal(T.verifyTotp(secret, 'abcdef'), false);
  assert.equal(T.verifyTotp('', code), false);
});
test('generateSecret: 32 base32 chars (160 bits)', () => {
  const s = T.generateSecret();
  assert.match(s, /^[A-Z2-7]{32}$/);
});
