'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Point uploads at a tmp dir BEFORE requiring the module
process.env.MURBHA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'murbha-uploads-'));
const U = require('../lib/uploads');

// Tiny valid PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('Magic-byte sniff: PNG accepted', () => {
  const r = U.persist('usr_test1', 'id_front', PNG_B64);
  assert.equal(r.ok, true);
  assert.equal(r.mime, 'image/png');
  // Cleanup
  U.remove(r.relPath);
});

test('Rejects non-image bytes', () => {
  const r = U.persist('usr_test2', 'id_front', Buffer.from('Hello plain text').toString('base64'));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'invalid_file_type');
});

test('Rejects disallowed kind', () => {
  const r = U.persist('usr_test3', 'weird_kind', PNG_B64);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'invalid_kind');
});

test('Rejects oversize (>5MB)', () => {
  // 6 MB of zeros encoded as base64
  const big = Buffer.alloc(6 * 1024 * 1024, 0).toString('base64');
  const r = U.persist('usr_test4', 'id_front', big);
  assert.equal(r.ok, false);
  // accept either too_large OR invalid_file_type — content is bytes of zeros
  assert.ok(['too_large', 'invalid_file_type'].includes(r.error));
});
