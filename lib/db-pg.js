/**
 * Postgres-backed key-value store for the DB document.
 *
 * Schema: a single row `murbha_db(id='main', doc JSONB, updated_at)`.
 * On write, we replace the whole `doc`. This is the JSON-on-disk model
 * lifted to Postgres for durability — no schema churn per table, and it
 * survives Render restarts where local disk doesn't persist.
 *
 * To switch to per-table schemas later, swap this adapter without
 * changing the caller (lib/db.js exposes the same surface).
 *
 * Active when DATABASE_URL is set AND `pg` is installed.
 */
'use strict';

let Pool = null;
try { Pool = require('pg').Pool; } catch { Pool = null; }

const isEnabled = () => !!(process.env.DATABASE_URL && Pool);

let _pool = null;
const pool = () => {
  if (_pool) return _pool;
  _pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30_000,
    ssl: process.env.DATABASE_SSL === 'disable'
      ? false
      : { rejectUnauthorized: false },
  });
  return _pool;
};

const init = async () => {
  await pool().query(`
    CREATE TABLE IF NOT EXISTS murbha_db (
      id          TEXT PRIMARY KEY,
      doc         JSONB NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

const loadDoc = async () => {
  const r = await pool().query("SELECT doc FROM murbha_db WHERE id = 'main' LIMIT 1");
  return r.rows[0]?.doc || null;
};

const saveDoc = async (doc) => {
  await pool().query(
    `INSERT INTO murbha_db (id, doc, updated_at)
     VALUES ('main', $1::jsonb, now())
     ON CONFLICT (id) DO UPDATE
       SET doc = EXCLUDED.doc, updated_at = now()`,
    [JSON.stringify(doc)]
  );
};

const close = async () => {
  if (_pool) { await _pool.end(); _pool = null; }
};

module.exports = { isEnabled, init, loadDoc, saveDoc, close };
