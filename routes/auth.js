const express = require('express');
const rateLimit = require('express-rate-limit');
const { query } = require('../db/pool');
const { validateUsername, validatePassword } = require('../lib/validate');
const {
  hashPassword, verifyPassword, createSession, destroySession, SESSION_TTL_MS,
} = require('../lib/auth');
const { COOKIE, requireAuthApi } = require('../middleware/requireAuth');

const router = express.Router();

// Express 4 does not forward rejected promises from async handlers to the
// error middleware; wrap async handlers so DB failures reach the 500 handler.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  signed: true,
  path: '/',
  maxAge: SESSION_TTL_MS,
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'محاولات كثيرة. حاول لاحقاً.' },
});

router.post('/register', authLimiter, ah(async (req, res) => {
  const { username, password, full_name } = req.body || {};
  const uErr = validateUsername(username);
  const pErr = validatePassword(password);
  if (uErr || pErr) return res.status(400).json({ error: uErr || pErr });

  const exists = await query('SELECT 1 FROM users WHERE username = $1', [username]);
  if (exists.rowCount > 0) {
    return res.status(409).json({ error: 'اسم المستخدم مستخدم بالفعل' });
  }

  const hash = await hashPassword(password);
  const { rows } = await query(
    `INSERT INTO users (username, password_hash, full_name)
     VALUES ($1, $2, $3) RETURNING id, username, full_name`,
    [username, hash, full_name || null]
  );
  const user = rows[0];
  const session = await createSession(user.id);
  res.cookie(COOKIE, session.id, cookieOpts);
  res.status(201).json({ user });
}));

router.post('/login', authLimiter, ah(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
  }
  const { rows } = await query(
    'SELECT id, username, full_name, password_hash FROM users WHERE username = $1',
    [username]
  );
  const user = rows[0];
  const ok = user && (await verifyPassword(password, user.password_hash));
  if (!ok) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });

  const session = await createSession(user.id);
  res.cookie(COOKIE, session.id, cookieOpts);
  res.json({ user: { id: user.id, username: user.username, full_name: user.full_name } });
}));

router.post('/logout', ah(async (req, res) => {
  await destroySession(req.signedCookies?.[COOKIE]).catch(() => {});
  res.clearCookie(COOKIE, { ...cookieOpts, maxAge: undefined });
  res.json({ success: true });
}));

router.get('/me', requireAuthApi, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
