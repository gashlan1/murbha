const { test } = require('node:test');
const assert = require('node:assert');
const {
  validateUsername, validatePassword, validateMobile, validateEmail, normalizeMobile,
} = require('../lib/validate');

test('username: accepts 3-32 alphanumeric/underscore', () => {
  assert.equal(validateUsername('aliahmad'), null);
  assert.equal(validateUsername('ali_123'), null);
});

test('username: rejects too short, bad chars, empty', () => {
  assert.ok(validateUsername('ab'));
  assert.ok(validateUsername('has space'));
  assert.ok(validateUsername(''));
  assert.ok(validateUsername(null));
});

test('password: requires >= 8 chars', () => {
  assert.equal(validatePassword('hunter2!!'), null);
  assert.ok(validatePassword('short'));
  assert.ok(validatePassword(''));
});

// ─── normalizeMobile ─────────────────────────────────────

test('normalizeMobile: accepts every canonical Saudi format', () => {
  assert.equal(normalizeMobile('+966512345678'), '+966512345678');
  assert.equal(normalizeMobile('966512345678'),  '+966512345678');
  assert.equal(normalizeMobile('00966512345678'),'+966512345678');
  assert.equal(normalizeMobile('0512345678'),    '+966512345678');
  assert.equal(normalizeMobile('512345678'),     '+966512345678');
});

test('normalizeMobile: tolerates whitespace, dashes, and Arabic-Indic digits', () => {
  assert.equal(normalizeMobile('+966 51-234 5678'), '+966512345678');
  assert.equal(normalizeMobile('٠٥١٢٣٤٥٦٧٨'),       '+966512345678');
});

test('normalizeMobile: rejects malformed input', () => {
  // Saudi mobiles always start with 5 after country code.
  assert.equal(normalizeMobile('0412345678'), null);
  assert.equal(normalizeMobile('05123'),      null);
  assert.equal(normalizeMobile(null),         null);
  assert.equal(normalizeMobile(966512345678), null); // non-string
});

test('validateMobile: returns null on valid, error string on invalid', () => {
  assert.equal(validateMobile('0512345678'), null);
  assert.ok(typeof validateMobile('bad') === 'string');
});

// ─── validateEmail ───────────────────────────────────────

test('validateEmail: accepts well-formed addresses', () => {
  assert.equal(validateEmail('user@example.com'), null);
  assert.equal(validateEmail('first.last+tag@sub.example.co'), null);
});

test('validateEmail: rejects malformed and overlong addresses', () => {
  assert.ok(validateEmail('no-at-sign'));
  assert.ok(validateEmail('two@@signs.com'));
  assert.ok(validateEmail('spaces in@email.com'));
  assert.ok(validateEmail(null));
  assert.ok(validateEmail('a'.repeat(250) + '@b.co')); // > 254 chars
});
