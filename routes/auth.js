const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { query } = require('../db/pool');
const {
  validateUsername, validatePassword, validateMobile, validateEmail, normalizeMobile,
} = require('../lib/validate');
const {
  hashPassword, verifyPassword, createSession, destroySession, SESSION_TTL_MS,
} = require('../lib/auth');
const { COOKIE, requireAuthApi } = require('../middleware/requireAuth');
const mailer = require('../lib/mailer');

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

// ─── KYC verification chain ──────────────────────────────
// Each step advances users.kyc_status. Demo codes mirror the canonical flow.

router.post('/verify-email', requireAuthApi, ah(async (req, res) => {
  const code = String(req.body?.code || '').trim();
  if (code !== '1234') {
    return res.status(400).json({ error: 'invalid_code', message: 'رمز التحقق من البريد الإلكتروني غير صحيح' });
  }
  await query("UPDATE users SET kyc_status = 'email_verified' WHERE id = $1", [req.user.id]);
  res.json({ success: true, kycStatus: 'email_verified' });
}));

router.post('/verify-mobile', requireAuthApi, ah(async (req, res) => {
  const code = String(req.body?.code || '').trim();
  if (code !== '5678') {
    return res.status(400).json({ error: 'invalid_code', message: 'رمز التحقق من رقم الجوال غير صحيح' });
  }
  await query("UPDATE users SET kyc_status = 'mobile_verified' WHERE id = $1", [req.user.id]);
  res.json({ success: true, kycStatus: 'mobile_verified' });
}));

router.post('/verify-id', requireAuthApi, ah(async (req, res) => {
  const nationalId = String(req.body?.nationalId || '').trim();
  if (!/^[12]\d{9}$/.test(nationalId)) {
    return res.status(400).json({ error: 'invalid_id', message: 'رقم الهوية الوطنية أو الإقامة غير صحيح' });
  }
  await query("UPDATE users SET national_id = $1, kyc_status = 'id_verified' WHERE id = $2", [nationalId, req.user.id]);
  res.json({ success: true, kycStatus: 'id_verified' });
}));

router.post('/verify-address', requireAuthApi, ah(async (req, res) => {
  const { buildingNo, postalCode, streetName, district, city } = req.body || {};
  if (!buildingNo || !postalCode || !streetName || !district || !city) {
    return res.status(400).json({ error: 'invalid_address', message: 'يرجى ملء جميع الحقول المطلوبة للعنوان الوطني' });
  }
  await query("UPDATE users SET kyc_status = 'verified' WHERE id = $1", [req.user.id]);
  await query(
    `INSERT INTO notifications (user_id,title,body,type)
     VALUES ($1,'اكتمل التحقق من الهوية والعنوان الوطني','تم استلام بيانات التحقق بنجاح وهي قيد المراجعة والموافقة من الإدارة.','kyc')`,
    [req.user.id]);
  res.json({ success: true, kycStatus: 'verified' });
}));

// ─── Mobile-based auth (password + OTP fallback) ──────────
// Saudi-market UX: phone is the primary identifier. Username/password still
// works for legacy accounts. OTP codes are 4-digit, expire in 10 min, single-use.

const OTP_TTL_MS = 10 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;

const otpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'محاولات كثيرة. حاول لاحقاً.' },
});

// Always log the message so dev flows are testable without a real provider,
// then best-effort deliver via SMTP / SMS gateway when configured.
function sendSms(mobile, body) {
  // eslint-disable-next-line no-console
  console.log(`[SMS → ${mobile}] ${body}`);
  // TODO: wire to a real SMS gateway (Unifonic, Twilio, etc.). Until then,
  // the console log is the dev delivery channel.
}

async function sendEmail(to, subject, text) {
  // eslint-disable-next-line no-console
  console.log(`[EMAIL → ${to}] ${subject}\n${text}`);
  try {
    await mailer.send({ to, subject, text });
  } catch {
    // mailer.send already swallows errors; this guards against unexpected throws.
  }
}

router.post('/register-mobile', authLimiter, ah(async (req, res) => {
  const { mobile, password, full_name } = req.body || {};
  const m = normalizeMobile(mobile);
  if (!m) return res.status(400).json({ error: 'رقم الجوال غير صالح' });
  const pErr = validatePassword(password);
  if (pErr) return res.status(400).json({ error: pErr });

  const exists = await query('SELECT 1 FROM users WHERE mobile = $1', [m]);
  if (exists.rowCount > 0) return res.status(409).json({ error: 'رقم الجوال مسجّل بالفعل' });

  const hash = await hashPassword(password);
  // Synthesize a username from the mobile so the legacy NOT NULL+UNIQUE
  // username column stays satisfied for mobile-first signups.
  const username = 'm_' + m.replace(/[^0-9]/g, '');
  const { rows } = await query(
    `INSERT INTO users (username, password_hash, full_name, mobile)
     VALUES ($1, $2, $3, $4) RETURNING id, username, full_name, mobile`,
    [username, hash, full_name || null, m]
  );
  const user = rows[0];
  const session = await createSession(user.id);
  res.cookie(COOKIE, session.id, cookieOpts);
  res.status(201).json({ user });
}));

router.post('/login-mobile', authLimiter, ah(async (req, res) => {
  const { mobile, password } = req.body || {};
  const m = normalizeMobile(mobile);
  if (!m || !password) return res.status(400).json({ error: 'رقم الجوال وكلمة المرور مطلوبان' });
  const { rows } = await query(
    'SELECT id, username, full_name, password_hash FROM users WHERE mobile = $1',
    [m]
  );
  const user = rows[0];
  const ok = user && (await verifyPassword(password, user.password_hash));
  if (!ok) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });

  const session = await createSession(user.id);
  res.cookie(COOKIE, session.id, cookieOpts);
  res.json({ user: { id: user.id, username: user.username, full_name: user.full_name } });
}));

// Request a 4-digit OTP for login / signup / password reset.
router.post('/otp/request', otpLimiter, ah(async (req, res) => {
  const { mobile, purpose } = req.body || {};
  const m = normalizeMobile(mobile);
  if (!m) return res.status(400).json({ error: 'رقم الجوال غير صالح' });
  if (!['login', 'signup', 'reset'].includes(purpose)) {
    return res.status(400).json({ error: 'غرض غير معروف' });
  }
  // For login/reset, the mobile must be registered. For signup it must NOT exist.
  const exists = await query('SELECT 1 FROM users WHERE mobile = $1', [m]);
  if (purpose === 'signup' && exists.rowCount > 0) {
    return res.status(409).json({ error: 'رقم الجوال مسجّل بالفعل' });
  }
  if ((purpose === 'login' || purpose === 'reset') && exists.rowCount === 0) {
    // Quiet success to avoid mobile-number enumeration; still spend a slot.
    return res.json({ success: true });
  }

  const code = String(crypto.randomInt(1000, 10000));
  const codeHash = await hashPassword(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await query(
    `INSERT INTO otp_codes (mobile, code_hash, purpose, expires_at) VALUES ($1, $2, $3, $4)`,
    [m, codeHash, purpose, expiresAt]
  );
  sendSms(m, `Murbha verification code: ${code}`);
  res.json({ success: true });
}));

// Helper: finds the latest unused, unexpired OTP for a mobile+purpose, verifies the code,
// marks it used, and returns true. Returns false on failure.
async function consumeOtp(mobile, purpose, code) {
  const { rows } = await query(
    `SELECT id, code_hash FROM otp_codes
     WHERE mobile = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [mobile, purpose]
  );
  const row = rows[0];
  if (!row) return false;
  const ok = await verifyPassword(String(code), row.code_hash);
  if (!ok) return false;
  await query('UPDATE otp_codes SET used_at = now() WHERE id = $1', [row.id]);
  return true;
}

// Verify an OTP and create a session (login path) or create the account (signup path).
router.post('/otp/verify', authLimiter, ah(async (req, res) => {
  const { mobile, code, purpose, full_name } = req.body || {};
  const m = normalizeMobile(mobile);
  if (!m || !code) return res.status(400).json({ error: 'بيانات غير مكتملة' });
  if (!['login', 'signup'].includes(purpose)) {
    return res.status(400).json({ error: 'غرض غير معروف' });
  }
  const ok = await consumeOtp(m, purpose, code);
  if (!ok) return res.status(400).json({ error: 'رمز التحقق غير صحيح أو منتهي' });

  let user;
  if (purpose === 'signup') {
    const username = 'm_' + m.replace(/[^0-9]/g, '');
    // Random hash so the column stays non-null. Mobile-OTP accounts log in via OTP.
    const placeholderHash = await hashPassword(crypto.randomBytes(16).toString('hex'));
    const { rows } = await query(
      `INSERT INTO users (username, password_hash, full_name, mobile)
       VALUES ($1, $2, $3, $4) RETURNING id, username, full_name, mobile`,
      [username, placeholderHash, full_name || null, m]
    );
    user = rows[0];
  } else {
    const { rows } = await query(
      'SELECT id, username, full_name FROM users WHERE mobile = $1', [m]
    );
    user = rows[0];
    if (!user) return res.status(404).json({ error: 'الحساب غير موجود' });
  }

  const session = await createSession(user.id);
  res.cookie(COOKIE, session.id, cookieOpts);
  res.json({ user });
}));

// ─── Password reset (email + SMS) ─────────────────────────
// Request stage. Always returns 200 so we don't leak whether the
// identifier exists in our DB.

router.post('/password-reset/request', authLimiter, ah(async (req, res) => {
  const { channel, identifier } = req.body || {};
  if (!['email', 'sms'].includes(channel) || typeof identifier !== 'string') {
    return res.status(400).json({ error: 'بيانات غير صحيحة' });
  }

  if (channel === 'email') {
    const eErr = validateEmail(identifier);
    if (eErr) return res.status(400).json({ error: eErr });
    const { rows } = await query('SELECT id FROM users WHERE email = $1', [identifier]);
    const user = rows[0];
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + RESET_TTL_MS);
      await query(
        `INSERT INTO password_resets (user_id, token, channel, expires_at) VALUES ($1, $2, 'email', $3)`,
        [user.id, token, expiresAt]
      );
      const link = `${req.protocol}://${req.get('host')}/reset-password?token=${token}`;
      sendEmail(identifier, 'Reset your Murbha password',
        `Use this one-time link within 30 minutes to set a new password:\n${link}\n\nIf you didn't request this, ignore the message.`);
    }
    return res.json({ success: true });
  }

  // SMS reset — use the OTP table with purpose='reset'.
  const m = normalizeMobile(identifier);
  if (!m) return res.status(400).json({ error: 'رقم الجوال غير صالح' });
  const { rows } = await query('SELECT id FROM users WHERE mobile = $1', [m]);
  if (rows.length === 0) return res.json({ success: true });

  const code = String(crypto.randomInt(1000, 10000));
  const codeHash = await hashPassword(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await query(
    `INSERT INTO otp_codes (mobile, code_hash, purpose, expires_at) VALUES ($1, $2, 'reset', $3)`,
    [m, codeHash, expiresAt]
  );
  sendSms(m, `Murbha password reset code: ${code}`);
  res.json({ success: true });
}));

// Confirm a password reset by consuming an email token OR an SMS OTP, then setting the new password.
router.post('/password-reset/confirm', authLimiter, ah(async (req, res) => {
  const { channel, token, mobile, code, new_password } = req.body || {};
  const pErr = validatePassword(new_password);
  if (pErr) return res.status(400).json({ error: pErr });

  let userId = null;
  if (channel === 'email') {
    if (typeof token !== 'string' || !token) return res.status(400).json({ error: 'الرمز مطلوب' });
    const { rows } = await query(
      `SELECT id, user_id FROM password_resets
       WHERE token = $1 AND used_at IS NULL AND expires_at > now()
       LIMIT 1`,
      [token]
    );
    const row = rows[0];
    if (!row) return res.status(400).json({ error: 'الرابط غير صالح أو منتهي' });
    await query('UPDATE password_resets SET used_at = now() WHERE id = $1', [row.id]);
    userId = row.user_id;
  } else if (channel === 'sms') {
    const m = normalizeMobile(mobile);
    if (!m || !code) return res.status(400).json({ error: 'بيانات غير مكتملة' });
    const ok = await consumeOtp(m, 'reset', code);
    if (!ok) return res.status(400).json({ error: 'رمز التحقق غير صحيح أو منتهي' });
    const { rows } = await query('SELECT id FROM users WHERE mobile = $1', [m]);
    if (rows.length === 0) return res.status(404).json({ error: 'الحساب غير موجود' });
    userId = rows[0].id;
  } else {
    return res.status(400).json({ error: 'بيانات غير صحيحة' });
  }

  const hash = await hashPassword(new_password);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);
  // Invalidate every active session for the user so a leaked cookie is dead.
  await query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  res.json({ success: true });
}));

module.exports = router;
