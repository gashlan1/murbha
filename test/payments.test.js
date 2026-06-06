'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/payments');

test('Luhn: 4111 1111 1111 1111 valid', () => {
  assert.equal(P.luhn('4111111111111111'), true);
});
test('Luhn: same digits with 2 at end → invalid', () => {
  assert.equal(P.luhn('4111111111111112'), false);
});
test('Brand detection: 4xxx → visa, 5xxx → mastercard, 5y mada', () => {
  assert.equal(P.brandFromPan('4111111111111111'), 'visa');
  assert.equal(P.brandFromPan('5111111111111118'), 'mastercard');
  assert.equal(P.brandFromPan('5050000000000005'), 'mada');
});
test('Mask: keep last 4 only', () => {
  assert.equal(P.maskPan('4111111111111111'), '****1111');
});
test('Saudi IBAN: ISO 13616 mod-97 valid', () => {
  assert.equal(P.isSaudiIban('SA0380000000608010167519'), true);
});
test('Saudi IBAN: bad check digits → invalid', () => {
  assert.equal(P.isSaudiIban('SA0000000000000000000000'), false);
});
test('IBAN mask: leading 4 + trailing 4', () => {
  assert.equal(P.maskIban('SA0380000000608010167519'), 'SA03 **** **** **** 7519');
});

test('Provider tokenize accepts good card, declines bad', () => {
  const p = P.provider();
  const ok = p.tokenizeCard({ pan: '4111111111111111', expMonth: 12, expYear: 2029, cvv: '123', holder: 'Test User' });
  assert.equal(ok.ok, true);
  assert.equal(ok.brand, 'visa');
  assert.equal(ok.last4, '1111');
  const bad = p.tokenizeCard({ pan: '4111111111111112', expMonth: 12, expYear: 2029, cvv: '123', holder: 'Test User' });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'invalid_card_number');
});
test('Provider charge: declines last4=0000', () => {
  const p = P.provider();
  const r = p.charge({ token: 'tok_x', amount: 100, last4: '0000' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'declined');
});
