'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Hermetic tmp dir BEFORE requiring backups
process.env.MURBHA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'murbha-backups-'));
fs.writeFileSync(path.join(process.env.MURBHA_DATA_DIR, 'db.json'), JSON.stringify({ users: [], hello: 'world' }));

const B = require('../lib/backups');

test('snapshotOnce writes a gzipped file', () => {
  const r = B.snapshotOnce();
  assert.ok(r);
  assert.ok(r.gzippedBytes > 0);
  assert.ok(r.originalBytes > r.gzippedBytes - 50); // gzip header overhead acceptable
  assert.ok(fs.existsSync(r.path));
});

test('prune removes nothing within retention', () => {
  const removed = B.prune();
  assert.equal(removed, 0);
});

test('isEnabled honors env', () => {
  delete process.env.BACKUPS_ENABLED;
  assert.equal(B.isEnabled(), false);
  process.env.BACKUPS_ENABLED = 'true';
  assert.equal(B.isEnabled(), true);
  delete process.env.BACKUPS_ENABLED;
});
