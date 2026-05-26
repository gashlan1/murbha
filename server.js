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
const { requireAuthPage } = require('./middleware/requireAuth');

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


/**
 * Contact form endpoint (stub — wire to email service)
 */
app.post('/api/contact', (req, res) => {
  const { name, email, message, type } = req.body;
  if (!name || !message) {
    return res.status(400).json({ error: 'الاسم والرسالة مطلوبان' });
  }
  // TODO: integrate with SendGrid / SES / SMTP
  console.log('[Contact]', { name, email, message, type });
  res.json({ success: true, message: 'تم استلام رسالتك. سنتواصل معك قريباً.' });
});

/**
 * Newsletter signup (stub)
 */
app.post('/api/newsletter', (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'البريد الإلكتروني غير صحيح' });
  }
  // TODO: integrate with Mailchimp / ConvertKit
  console.log('[Newsletter]', email);
  res.json({ success: true });
});

app.use('/api/auth', authRoutes);
app.use('/api/projects', require('./routes/projects'));
app.use('/api/contracts', require('./routes/contracts'));
app.use('/api', require('./routes/portfolio'));
app.use('/api/notifications', require('./routes/notifications'));

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

const PRIVATE = new Set(['/portfolio', '/profile', '/notifications', '/contract', '/payment']);

Object.entries(pageRoutes).forEach(([route, file]) => {
  const handlers = PRIVATE.has(route) ? [requireAuthPage] : [];
  app.get(route, ...handlers, (req, res) => {
    res.sendFile(path.join(__dirname, file));
  });
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
