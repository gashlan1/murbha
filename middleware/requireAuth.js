const { getSessionUser } = require('../lib/auth');

const COOKIE = 'mrb_session';

// For page routes: redirect unauthenticated users to /login.
async function requireAuthPage(req, res, next) {
  const token = req.signedCookies?.[COOKIE];
  const user = await getSessionUser(token).catch(() => null);
  if (!user) return res.redirect('/login');
  req.user = user;
  next();
}

// For API routes: return 401 JSON.
async function requireAuthApi(req, res, next) {
  const token = req.signedCookies?.[COOKIE];
  const user = await getSessionUser(token).catch(() => null);
  if (!user) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
  req.user = user;
  next();
}

// For admin API routes: authenticate, then require role === 'admin'.
async function requireAdminApi(req, res, next) {
  const token = req.signedCookies?.[COOKIE];
  const user = await getSessionUser(token).catch(() => null);
  if (!user) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  req.user = user;
  next();
}

module.exports = { COOKIE, requireAuthPage, requireAuthApi, requireAdminApi };
