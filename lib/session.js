/**
 * Stateless signed-cookie sessions + password hashing.
 * Uses only node:crypto — zero deps.
 */
'use strict';

const crypto = require('crypto');
const db     = require('./db');

const SECRET = process.env.SESSION_SECRET
  || crypto.createHash('sha256').update('murabaha-dev-secret-rotate-me').digest('hex');

const COOKIE_NAME = 'mrb_sid';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/** sign(payload) → "<base64url(payload)>.<hex hmac>" */
const sign = (payload) => {
  const json = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac  = crypto.createHmac('sha256', SECRET).update(json).digest('hex');
  return `${json}.${mac}`;
};

/** verify(token) → payload | null */
const verify = (token) => {
  if (!token || typeof token !== 'string') return null;
  const [json, mac] = token.split('.');
  if (!json || !mac) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(json).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(expected, 'hex'))) return null;
  } catch { return null; }
  try {
    const payload = JSON.parse(Buffer.from(json, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
};

/** Parse Cookie header → { name: value } */
const parseCookies = (header) => {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = decodeURIComponent(part.slice(eq + 1).trim());
    if (k) out[k] = v;
  }
  return out;
};

/** Extract userId from req cookie, or null. */
const userIdFromReq = (req) => {
  const cookies = parseCookies(req.headers.cookie);
  const payload = verify(cookies[COOKIE_NAME]);
  return payload?.uid || null;
};

/** Fetch the current user (or null) */
const currentUser = (req) => {
  const uid = userIdFromReq(req);
  if (!uid) return null;
  const u = db.find('users', x => x.id === uid);
  return u ? publicUser(u) : null;
};

/** Strip secrets before returning a user object */
const publicUser = (u) => {
  if (!u) return null;
  const { passwordHash, salt, ...safe } = u;
  return safe;
};

/** Set the session cookie on the response. */
const setSessionCookie = (res, userId) => {
  const exp = Date.now() + COOKIE_MAX_AGE * 1000;
  const token = sign({ uid: userId, exp });
  const isProd = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}${isProd ? '; Secure' : ''}`
  );
};

const clearSessionCookie = (res) => {
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
};

// ─── Password hashing (pbkdf2) ─────────────────────────────────────
const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100_000, 32, 'sha256').toString('hex');
  return { salt, passwordHash: hash };
};

const verifyPassword = (password, salt, hash) => {
  if (!password || !salt || !hash) return false;
  const candidate = crypto.pbkdf2Sync(password, salt, 100_000, 32, 'sha256').toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'));
  } catch { return false; }
};

const newId = (prefix = '') =>
  prefix + crypto.randomBytes(8).toString('hex');

module.exports = {
  COOKIE_NAME,
  sign, verify,
  parseCookies,
  userIdFromReq,
  currentUser,
  publicUser,
  setSessionCookie,
  clearSessionCookie,
  hashPassword,
  verifyPassword,
  newId,
};
