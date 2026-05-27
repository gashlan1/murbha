/**
 * ┌────────────────────────────────────────────────────┐
 * │     مُرابحة — Murbha Platform Server               │
 * │     Express.js — Production Ready                   │
 * └────────────────────────────────────────────────────┘
 */

require('dotenv').config();
const express    = require('express');
const path       = require('path');
const compression = require('compression');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const cookieParser = require('cookie-parser');
const authRoutes   = require('./routes/auth');
const { requireAuthPage, requireAdminPage } = require('./middleware/requireAuth');
const { query }    = require('./db/pool');
const mailer       = require('./lib/mailer');

const app  = express();
const PORT = process.env.PORT || 3000;
const ENV  = process.env.NODE_ENV || 'development';

// Fail fast: a predictable cookie-signing secret in production means forgeable
// sessions. Require SESSION_SECRET to be set explicitly when NODE_ENV=production.
if (ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production');
}

// ─── Security ───────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      styleSrc:    ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "fonts.gstatic.com"],
      fontSrc:     ["'self'", "fonts.gstatic.com", "fonts.googleapis.com"],
      imgSrc:      ["'self'", "data:", "https:"],
      connectSrc:  ["'self'"],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ─── Middleware ──────────────────────────────────────────
app.use(compression());
app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: true }));
app.use(cookieParser(process.env.SESSION_SECRET || 'dev-secret'));
app.use(morgan(ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Static files ────────────────────────────────────────
app.use(express.static(path.join(__dirname), {
  maxAge: ENV === 'production' ? '1d' : 0,
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// ─── API Routes ──────────────────────────────────────────

/**
 * Health check
 */
app.get('/api/health', (req, res) => {
  res.json({
    status:    'ok',
    platform:  'مُرابحة',
    version:   '1.0.0',
    env:       ENV,
    timestamp: new Date().toISOString(),
  });
});


const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clientIp = (req) => (req.headers['x-forwarded-for']?.toString().split(',')[0].trim()
  || req.socket?.remoteAddress || null);

/**
 * Contact form — persists every submission, then best-effort notifies the
 * operator inbox via SMTP (when SMTP_HOST/USER/PASS are set in env).
 * The user always gets a success response if the row was stored.
 */
app.post('/api/contact', async (req, res) => {
  const name    = String(req.body?.name    ?? '').trim();
  const email   = String(req.body?.email   ?? '').trim() || null;
  const message = String(req.body?.message ?? '').trim();
  const type    = String(req.body?.type    ?? '').trim() || null;
  if (!name || !message) return res.status(400).json({ error: 'الاسم والرسالة مطلوبان' });
  if (email && !EMAIL_RE.test(email))
    return res.status(400).json({ error: 'البريد الإلكتروني غير صحيح' });

  try {
    const { rows } = await query(
      `INSERT INTO contact_submissions (name, email, type, message, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
      [name, email, type, message, clientIp(req), req.headers['user-agent']?.slice(0, 500) || null]
    );
    const submission = rows[0];

    // Fire-and-forget notification. If SMTP isn't configured, we just log.
    mailer.send({
      subject: `[Murbha contact] ${type || 'inquiry'} — ${name}`,
      text: `Name: ${name}\nEmail: ${email ?? '(none)'}\nType: ${type ?? '(none)'}\n\n${message}\n\n— id ${submission.id}`,
      replyTo: email || undefined,
    }).then((r) => {
      if (r.sent) query(`UPDATE contact_submissions SET notified_at = now() WHERE id = $1`, [submission.id]).catch(() => {});
      else console.log('[Contact]', { id: submission.id, name, email, type, smtp: r.reason });
    }).catch(() => { /* swallow */ });

    return res.json({ success: true, id: submission.id, message: 'تم استلام رسالتك. سنتواصل معك قريباً.' });
  } catch (e) {
    console.error('[Contact] db error:', e.message);
    return res.status(500).json({ error: 'تعذّر استلام الرسالة. حاول لاحقاً.' });
  }
});

/**
 * Newsletter signup — idempotent on email. Re-subscribing flips status back
 * to 'active'. List can be exported to Mailchimp/ConvertKit later without
 * dedupe work.
 */
app.post('/api/newsletter', async (req, res) => {
  const email  = String(req.body?.email  ?? '').trim().toLowerCase();
  const source = String(req.body?.source ?? '').trim() || null;
  if (!email || !EMAIL_RE.test(email))
    return res.status(400).json({ error: 'البريد الإلكتروني غير صحيح' });

  try {
    const { rows } = await query(
      `INSERT INTO newsletter_subscribers (email, source, ip, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (email) DO UPDATE
         SET status = 'active', source = COALESCE(EXCLUDED.source, newsletter_subscribers.source)
       RETURNING id, (xmax = 0) AS inserted`,
      [email, source, clientIp(req)]
    );
    return res.json({ success: true, id: rows[0].id, alreadySubscribed: !rows[0].inserted });
  } catch (e) {
    console.error('[Newsletter] db error:', e.message);
    return res.status(500).json({ error: 'تعذّر التسجيل. حاول لاحقاً.' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/projects', require('./routes/projects'));
app.use('/api/contracts', require('./routes/contracts'));
app.use('/api', require('./routes/portfolio'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/investments', require('./routes/investments'));

// ─── Page Routes ────────────────────────────────────────
// Explicit HTML routes (clean URLs)
const pageRoutes = {
  '/':              'hessa.html',
  '/home':          'hessa.html',
  '/projects':      'projects.html',
  '/project':       'project.html',
  '/portfolio':     'portfolio.html',
  '/profile':       'profile.html',
  '/login':         'auth.html',
  '/register':      'auth.html',
  '/signup':        'auth.html',
  '/notifications': 'notifications.html',
  '/help':          'help.html',
  '/support':       'help.html',
  '/contract':      'contract.html',
  '/payment':       'payment.html',
  '/verify-email':  'verify-email.html',
  '/verify-mobile': 'verify-mobile.html',
  '/verify-id':     'verify-id.html',
  '/verify-address':'verify-address.html',
  '/legal':         'legal.html',
  '/privacy':       'privacy.html',
  '/terms':         'terms.html',
  '/risk':          'risk.html',
  '/sharia':        'sharia.html',
  '/aml':           'aml.html',
  '/kyc':           'kyc.html',
  '/complaints':    'complaints.html',
  '/data-protection': 'data-protection.html',
  '/cookies':       'cookies.html',
};

const PRIVATE = new Set([
  '/portfolio', '/profile', '/notifications', '/contract', '/payment',
  '/verify-email', '/verify-mobile', '/verify-id', '/verify-address',
]);

Object.entries(pageRoutes).forEach(([route, file]) => {
  const handlers = PRIVATE.has(route) ? [requireAuthPage] : [];
  app.get(route, ...handlers, (req, res) => {
    res.sendFile(path.join(__dirname, file));
  });
});

// Admin portal — gated specifically by role (not in pageRoutes/PRIVATE).
app.get('/admin', requireAdminPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ─── 404 ────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '404.html'));
});

// ─── Error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.stack);
  res.status(500).json({ error: 'خطأ داخلي في الخادم' });
});

// ─── Start ──────────────────────────────────────────────
// Only listen when run directly (`node server.js`), not when imported by tests.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════╗
║   مُرابحة Platform — Server Running   ║
╠══════════════════════════════════════╣
║  URL:  http://localhost:${PORT}          ║
║  ENV:  ${ENV.padEnd(29)}║
╚══════════════════════════════════════╝
  `);
  });
}

module.exports = app;
