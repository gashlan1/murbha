/**
 * Tiny file-backed JSON store.
 * - One file (data/db.json), atomic writes via temp + rename.
 * - In-process queue so concurrent writes don't clobber each other.
 * - Auto-bootstraps from data/seed.json on first run.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, '..', 'data');
const DB_FILE   = path.join(DATA_DIR, 'db.json');
const SEED_FILE = path.join(DATA_DIR, 'seed.json');

const EMPTY = {
  users:         [],
  sessions:      [],
  projects:      [],
  investments:   [],
  contracts:     [],
  transactions:  [],
  notifications: [],
  waitlist:      [],
  helpRequests:  [],
};

let _cache = null;
let _writing = Promise.resolve();

const _ensureDir = () => {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
};

const _load = () => {
  _ensureDir();
  if (fs.existsSync(DB_FILE)) {
    try {
      _cache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      console.error('[db] db.json corrupted, falling back to seed:', e.message);
      _cache = null;
    }
  }
  if (!_cache && fs.existsSync(SEED_FILE)) {
    _cache = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
    _persistSync();
    console.log('[db] bootstrapped from seed.json');
  }
  if (!_cache) {
    _cache = JSON.parse(JSON.stringify(EMPTY));
    _persistSync();
  }
  // ensure every table exists even if seed is partial
  for (const k of Object.keys(EMPTY)) if (!_cache[k]) _cache[k] = [];
  return _cache;
};

const _persistSync = () => {
  _ensureDir();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(_cache, null, 2));
  fs.renameSync(tmp, DB_FILE);
};

const get = () => _cache || _load();

/** Run a mutator function with exclusive access; persist after. */
const update = (fn) => {
  _writing = _writing.then(async () => {
    const db = get();
    await fn(db);
    _persistSync();
  }).catch(err => {
    console.error('[db] update error:', err);
  });
  return _writing;
};

const insert = (table, row) => update(db => {
  db[table].push(row);
});

const find = (table, predicate) => get()[table].find(predicate);

const filter = (table, predicate) => get()[table].filter(predicate);

const all = (table) => [...get()[table]];

const remove = (table, predicate) => update(db => {
  db[table] = db[table].filter(r => !predicate(r));
});

const patch = (table, predicate, changes) => update(db => {
  for (const row of db[table]) {
    if (predicate(row)) Object.assign(row, typeof changes === 'function' ? changes(row) : changes);
  }
});

// init on require
_load();

module.exports = { get, update, insert, find, filter, all, remove, patch };
