const { test } = require('node:test');
const assert = require('node:assert');
const { validateUsername, validatePassword } = require('../lib/validate');

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
