const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query } = require('../db/pool');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}

function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function newSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function createSession(userId) {
  const id = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await query(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)',
    [id, userId, expiresAt]
  );
  return { id, expiresAt };
}

async function getSessionUser(token) {
  if (!token) return null;
  const { rows } = await query(
    `SELECT u.id, u.username, u.full_name, u.role, u.approved,
            u.kyc_status AS "kycStatus", u.national_id AS "nationalId"
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [token]
  );
  return rows[0] || null;
}

async function destroySession(token) {
  if (!token) return;
  await query('DELETE FROM sessions WHERE id = $1', [token]);
}

module.exports = {
  SESSION_TTL_MS,
  hashPassword,
  verifyPassword,
  newSessionToken,
  createSession,
  getSessionUser,
  destroySession,
};
