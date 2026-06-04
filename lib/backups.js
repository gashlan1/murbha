/**
 * Periodic snapshot of data/db.json.
 *
 * Active when BACKUPS_ENABLED=true. Default interval is 6 hours;
 * override with BACKUP_INTERVAL_MIN. Retention is 14 days; override
 * with BACKUP_RETENTION_DAYS. Files land in data/uploads/backups/
 * (already gitignored) as gzipped JSON.
 *
 * For Render: backups still live on the same ephemeral disk — useful
 * for in-VM recovery from a bad write, but not durable across deploys.
 * The proper durability path is Postgres (lib/db-pg.js). Use this as a
 * safety net, not a replacement.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DATA_DIR    = process.env.MURBHA_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE     = path.join(DATA_DIR, 'db.json');
const BACKUPS_DIR = path.join(DATA_DIR, 'uploads', 'backups');

const INTERVAL_MS = Math.max(1, parseInt(process.env.BACKUP_INTERVAL_MIN || '360', 10)) * 60_000;
const RETENTION_DAYS = Math.max(1, parseInt(process.env.BACKUP_RETENTION_DAYS || '14', 10));
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60_000;

const isEnabled = () => process.env.BACKUPS_ENABLED === 'true';

const _ensureDir = () => {
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true, mode: 0o700 });
};

const snapshotOnce = () => {
  if (!fs.existsSync(DB_FILE)) return null;
  _ensureDir();
  const buf = fs.readFileSync(DB_FILE);
  const gz  = zlib.gzipSync(buf, { level: 9 });
  const name = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json.gz';
  const out = path.join(BACKUPS_DIR, name);
  fs.writeFileSync(out, gz, { mode: 0o600 });
  return { path: out, originalBytes: buf.length, gzippedBytes: gz.length };
};

const prune = () => {
  if (!fs.existsSync(BACKUPS_DIR)) return 0;
  let removed = 0;
  const cutoff = Date.now() - RETENTION_MS;
  for (const name of fs.readdirSync(BACKUPS_DIR)) {
    if (!name.endsWith('.json.gz')) continue;
    const p = path.join(BACKUPS_DIR, name);
    try {
      const st = fs.statSync(p);
      if (st.mtimeMs < cutoff) { fs.unlinkSync(p); removed++; }
    } catch {}
  }
  return removed;
};

let _timer = null;
const start = () => {
  if (_timer) return;
  if (!isEnabled()) {
    console.log('[backups] disabled (set BACKUPS_ENABLED=true to enable)');
    return;
  }
  // First snapshot 1 minute after boot, then every INTERVAL_MS.
  const tick = () => {
    try {
      const r = snapshotOnce();
      if (r) console.log(`[backups] snapshot ${(r.gzippedBytes/1024).toFixed(1)} KB → ${path.basename(r.path)}`);
      const pruned = prune();
      if (pruned) console.log(`[backups] pruned ${pruned} expired snapshot(s)`);
    } catch (e) {
      console.error('[backups] tick failed:', e.message);
    }
  };
  setTimeout(tick, 60_000);
  _timer = setInterval(tick, INTERVAL_MS);
  _timer.unref?.();
  console.log(`[backups] enabled, interval ${INTERVAL_MS/60_000}m, retention ${RETENTION_DAYS}d`);
};

const stop = () => { if (_timer) { clearInterval(_timer); _timer = null; } };

module.exports = { isEnabled, snapshotOnce, prune, start, stop };
