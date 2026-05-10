/**
 * ┌─────────────────────────────────────────────┐
 * │   Murabaha — Nafath Backend Proxy            │
 * │   - Hides APP_ID / APP_KEY from the browser   │
 * │   - Bypasses CORS by relaying server→server   │
 * │   - Serves the static front-end              │
 * └─────────────────────────────────────────────┘
 *
 * Run:   node server.js
 * Reqs:  Node.js 18+ (uses global fetch)
 */

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

// ─── Load .env (tiny parser, no deps) ─────────────────────────────
(() => {
  const envFile = path.join(__dirname, '.env');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
})();

const CONFIG = {
  PORT:     parseInt(process.env.PORT, 10) || 3000,
  APP_ID:   process.env.NAFATH_APP_ID  || 'fu5ofq88',
  APP_KEY:  process.env.NAFATH_APP_KEY || 'a79fe84a66f34f76bb63dbba04b7eaa2',
  BASE_URL: process.env.NAFATH_BASE_URL || 'https://rabet-nafath.api.elm.sa',
  STATIC_DIR: __dirname,
};

console.log('[murabaha] Starting…');
console.log('[murabaha] Nafath upstream:', CONFIG.BASE_URL);
console.log('[murabaha] APP_ID:', CONFIG.APP_ID.slice(0, 4) + '****');

// ─── Allow-list of upstream paths we proxy ────────────────────────
const ALLOWED_PREFIXES = [
  '/api/v1/mfa/request',
  '/api/v1/mfa/request/status',
  '/api/v1/mfa/jwk',
  '/stg/api/v2/oidc/session',
  '/stg/api/v2/oidc/jwt',
  '/stg/api/v2/oidc/jwt/valid',
];

const isAllowed = (p) => ALLOWED_PREFIXES.some(prefix => p === prefix || p.startsWith(prefix + '?') || p.startsWith(prefix + '/'));

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

// ─── Read whole request body ──────────────────────────────────────
const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end',  () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

// ─── Proxy handler (server → ELM) ─────────────────────────────────
const proxy = async (req, res, parsed) => {
  if (!isAllowed(parsed.path)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'forbidden_path' }));
  }

  const upstreamUrl = CONFIG.BASE_URL + parsed.path;
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);

  const headers = {
    'Content-Type': 'application/json',
    'Accept':       'application/json',
    'APP-ID':       CONFIG.APP_ID,
    'APP-KEY':      CONFIG.APP_KEY,
    'app_id':       CONFIG.APP_ID,
    'app_key':      CONFIG.APP_KEY,
  };

  console.log(`[proxy] ${req.method} ${parsed.path}`);

  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body,
    });

    const buf = Buffer.from(await upstream.arrayBuffer());
    const ct  = upstream.headers.get('content-type') || 'application/json; charset=utf-8';

    res.writeHead(upstream.status, {
      'Content-Type': ct,
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  } catch (err) {
    console.error('[proxy] upstream error:', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'upstream_unreachable', detail: err.message }));
  }
};

// ─── Static file handler ──────────────────────────────────────────
const serveStatic = (req, res, parsed) => {
  let p = decodeURIComponent(parsed.pathname);
  if (p === '/' || p === '') p = '/hessa.html';

  // prevent path traversal
  const resolved = path.normalize(path.join(CONFIG.STATIC_DIR, p));
  if (!resolved.startsWith(CONFIG.STATIC_DIR)) {
    res.writeHead(403); return res.end('forbidden');
  }

  // server.js, .env etc. should never be served
  const base = path.basename(resolved);
  if (base === 'server.js' || base === '.env' || base.startsWith('.')) {
    res.writeHead(404); return res.end('not found');
  }

  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found: ' + p);
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(resolved).pipe(res);
  });
};

// ─── Server ───────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url);

  // outbound IP for Nafath whitelist
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

  // health check
  if (parsed.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, upstream: CONFIG.BASE_URL }));
  }

  // proxy: anything starting with /api/ or /stg/
  if (parsed.pathname.startsWith('/api/') || parsed.pathname.startsWith('/stg/')) {
    return proxy(req, res, parsed);
  }

  return serveStatic(req, res, parsed);
});

server.listen(CONFIG.PORT, () => {
  console.log(`[murabaha] ✅ Ready on http://localhost:${CONFIG.PORT}`);
  console.log(`[murabaha]    Open:  http://localhost:${CONFIG.PORT}/hessa.html`);
});
