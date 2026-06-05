/**
 * ┌──────────────────────────────────────────────────────────┐
 * │   Murabaha — Full-Stack Server                            │
 * │   - Static front-end                                       │
 * │   - REST API at /app/*  (auth, projects, investments…)    │
 * │   - Nafath proxy at /api/v1/mfa/* and /stg/api/v2/oidc/*   │
 * └──────────────────────────────────────────────────────────┘
 *
 * Run:   node server.js
 * Reqs:  Node.js 18+ (uses global fetch)
 */

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

// ─── Load .env (tiny parser, no deps) ─────────────────────────────
(() => {
  const envFile = path.join(__dirname, '.env');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
})();

// after env is loaded, require modules that may read env
const api = require('./lib/api');
const S   = require('./lib/session');

if (process.env.NODE_ENV === 'production') {
  for (const k of ['NAFATH_APP_ID', 'NAFATH_APP_KEY', 'NAFATH_BASE_URL']) {
    if (!process.env[k]) throw new Error(`[server] ${k} env var is required in production`);
  }
}

const CONFIG = {
  PORT:     parseInt(process.env.PORT, 10) || 3000,
  APP_ID:   process.env.NAFATH_APP_ID  || 'fu5ofq88',                              // staging fallback (dev only; required in prod)
  APP_KEY:  process.env.NAFATH_APP_KEY || 'a79fe84a66f34f76bb63dbba04b7eaa2',      // staging fallback (dev only; required in prod)
  BASE_URL: process.env.NAFATH_BASE_URL || 'https://rabet-nafath.api.elm.sa',
  STATIC_DIR: __dirname,
};

console.log('[murabaha] Starting…');
console.log('[murabaha] Nafath upstream:', CONFIG.BASE_URL);
console.log('[murabaha] APP_ID:', CONFIG.APP_ID.slice(0, 4) + '****');

// ─── Allow-list of upstream paths we proxy to Nafath ──────────────
const NAFATH_PREFIXES = [
  '/api/v1/mfa/request',
  '/api/v1/mfa/request/status',
  '/api/v1/mfa/jwk',
  '/stg/api/v2/oidc/session',
  '/stg/api/v2/oidc/jwt',
  '/stg/api/v2/oidc/jwt/valid',
];

const isNafathPath = (p) =>
  NAFATH_PREFIXES.some(prefix => p === prefix || p.startsWith(prefix + '?') || p.startsWith(prefix + '/'));

// ─── MIME map ─────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml':  'application/xml; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
  '.ttf':  'font/ttf',
};

const readRawBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end',  () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

// ─── Nafath proxy (server → ELM) ──────────────────────────────────
const proxyNafath = async (req, res, parsed) => {
  if (!isNafathPath(parsed.path)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'forbidden_path' }));
  }

  const upstreamUrl = CONFIG.BASE_URL + parsed.path;
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readRawBody(req);

  const headers = {
    'Content-Type': 'application/json',
    'Accept':       'application/json',
    'APP-ID':       CONFIG.APP_ID,
    'APP-KEY':      CONFIG.APP_KEY,
    'app_id':       CONFIG.APP_ID,
    'app_key':      CONFIG.APP_KEY,
  };

  console.log(`[nafath] ${req.method} ${parsed.path}`);

  try {
    const upstream = await fetch(upstreamUrl, { method: req.method, headers, body });
    const buf = Buffer.from(await upstream.arrayBuffer());
    const ct  = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
    res.writeHead(upstream.status, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch (err) {
    console.error('[nafath] upstream error:', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'upstream_unreachable', detail: err.message }));
  }
};

// ─── Static file handler ──────────────────────────────────────────
const serveStatic = (req, res, parsed) => {
  let p = decodeURIComponent(parsed.pathname);
  if (p === '/' || p === '') p = '/hessa.html';

  // strip trailing slashes for /foo/ → /foo.html
  if (p.endsWith('/')) p = p.slice(0, -1) + '.html';
  // allow extensionless URLs: /portfolio → /portfolio.html
  if (!path.extname(p) && !p.includes('.')) p = p + '.html';

  const resolved = path.normalize(path.join(CONFIG.STATIC_DIR, p));
  if (!resolved.startsWith(CONFIG.STATIC_DIR)) {
    res.writeHead(403); return res.end('forbidden');
  }
  const base = path.basename(resolved);
  if (base === 'server.js' || base === '.env' || base.startsWith('.')) {
    res.writeHead(404); return res.end('not found');
  }
  // do not expose internal folders
  const rel = path.relative(CONFIG.STATIC_DIR, resolved);
  if (rel.startsWith('data' + path.sep) || rel.startsWith('lib' + path.sep) || rel === 'data' || rel === 'lib' || rel.startsWith('node_modules' + path.sep)) {
    res.writeHead(404); return res.end('not found');
  }

  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) {
      const fb = path.join(CONFIG.STATIC_DIR, '404.html');
      fs.stat(fb, (e2, st2) => {
        if (!e2 && st2.isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          fs.createReadStream(fb).pipe(res);
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not found: ' + p);
        }
      });
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    fs.createReadStream(resolved).pipe(res);
  });
};

// ─── Security headers ─────────────────────────────────────────────
// Applied on every response BEFORE the route handler writes headers, so
// res.writeHead() in handlers preserves them via Node's behaviour
// (setHeader before writeHead persists; writeHead with an object
// overrides only those names). We use setHeader for the security set.
const IS_PROD = process.env.NODE_ENV === 'production';
const applySecurityHeaders = (res) => {
  if (IS_PROD) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()');
  // CSP: tight defaults; allow inline scripts/styles (lots of inline today;
  // tighten in a future pass once hashes/nonces are wired). Google Fonts
  // and the Nafath upstream are the only outbound origins we expect.
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "img-src 'self' data: blob:; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "script-src 'self' 'unsafe-inline'; " +
    "connect-src 'self' https://api.resend.com https://rabet-nafath.api.elm.sa https://ifconfig.me; " +
    "worker-src 'self'; " +
    "manifest-src 'self'; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'"
  );
};

// ─── Server ───────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  try {
    applySecurityHeaders(res);
    const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    parsed.path = parsed.pathname + parsed.search; // back-compat with old url.parse shape used elsewhere

    // Issue CSRF cookie on every GET (incl. static pages, health, etc.)
    // so the frontend has one ready before it makes any state-changing call.
    if (req.method === 'GET') S.setCsrfCookieIfMissing(req, res);

    // health check
    if (parsed.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, upstream: CONFIG.BASE_URL }));
    }

    // outbound IP (for Nafath whitelist)
    if (parsed.pathname === '/myip') {
      try {
        const r = await fetch('https://ifconfig.me/ip');
        const ip = (await r.text()).trim();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ outboundIp: ip }));
      } catch(e) {
        res.writeHead(500); return res.end(JSON.stringify({ error: e.message }));
      }
    }

    // REST API for the platform
    if (parsed.pathname.startsWith('/app/')) {
      return api.handle(req, res, parsed);
    }

    // Dynamic sitemap subdocuments live at root for crawlers but go through api
    if (parsed.pathname === '/sitemap-projects.xml') {
      return api.handle(req, res, parsed);
    }

    // Short URL: /p/<slug> → /project.html?id=<slug>
    const shortMatch = parsed.pathname.match(/^\/p\/([a-z0-9\-_%أ-ي]+)\/?$/i);
    if (shortMatch) {
      const slug = decodeURIComponent(shortMatch[1]);
      res.writeHead(302, { 'Location': '/project.html?id=' + encodeURIComponent(slug) });
      return res.end();
    }

    // Nafath upstream proxy
    if (parsed.pathname.startsWith('/api/v1/') || parsed.pathname.startsWith('/stg/')) {
      return proxyNafath(req, res, parsed);
    }

    return serveStatic(req, res, parsed);
  } catch (e) {
    console.error('[server] unhandled:', e);
    if (!res.headersSent) {
      // Serve the branded 500.html for HTML/page navigation, JSON for API.
      const acceptsHtml = (req.headers['accept'] || '').includes('text/html');
      const isApi = req.url && req.url.startsWith('/app/');
      if (acceptsHtml && !isApi) {
        const fb = path.join(CONFIG.STATIC_DIR, '500.html');
        fs.stat(fb, (err, st) => {
          if (!err && st.isFile()) {
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
            fs.createReadStream(fb).pipe(res);
          } else {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('internal error');
          }
        });
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'server', message: 'internal error' }));
      }
    }
  }
});

(async () => {
  const db = require('./lib/db');
  if (db.ready && typeof db.ready.then === 'function') {
    try { await db.ready; }
    catch (e) { console.error('[server] db init failed:', e.message); }
  }
  // Auto-snapshot data/db.json on a timer (opt-in via BACKUPS_ENABLED).
  try { require('./lib/backups').start(); } catch (e) { console.error('[server] backups init failed:', e.message); }
  // Daily admin digest (opt-in via DIGEST_ENABLED).
  try {
    const digest = require('./lib/digest');
    const mailer = require('./lib/mailer');
    digest.start({ db: require('./lib/db'), mailer });
  } catch (e) { console.error('[server] digest init failed:', e.message); }
  server.listen(CONFIG.PORT, () => {
    console.log(`[murabaha] ✅ Ready on http://localhost:${CONFIG.PORT}`);
    console.log(`[murabaha]    Open:  http://localhost:${CONFIG.PORT}/hessa.html`);
  });
})();
