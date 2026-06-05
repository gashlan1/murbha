#!/usr/bin/env node
/**
 * One-shot migration: copy data/db.json into the Postgres murbha_db table.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node migrate-pg.js
 *
 * Idempotent: re-running just re-writes the row.
 */
'use strict';

const fs = require('fs');
const path = require('path');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

let PG;
try { PG = require('./lib/db-pg'); }
catch (e) { console.error('failed to load db-pg:', e.message); process.exit(1); }

const DB_FILE = path.join(__dirname, 'data', 'db.json');
const SEED_FILE = path.join(__dirname, 'data', 'seed.json');

const source = fs.existsSync(DB_FILE) ? DB_FILE : SEED_FILE;
const doc = JSON.parse(fs.readFileSync(source, 'utf8'));

(async () => {
  await PG.init();
  await PG.saveDoc(doc);
  console.log('[migrate] wrote', source, '→ murbha_db.main');
  await PG.close();
})().catch(err => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
