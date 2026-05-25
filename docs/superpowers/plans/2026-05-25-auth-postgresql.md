# Username/Password Auth on PostgreSQL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the client-side Nafath login with server-side username/password auth backed by PostgreSQL, using httpOnly cookie sessions, and fix the related security findings.

**Architecture:** Express keeps serving the static pages, but gains a `db/` layer (pg Pool + SQL schema + migration runner), a `lib/` auth layer (bcryptjs + session tokens), an `/api/auth` router, and a `requireAuth` middleware that gates the private page routes. Sessions live in a Postgres `sessions` table; the browser only ever holds an httpOnly cookie. Nafath is removed entirely.

**Tech Stack:** Node 20+, Express 4, PostgreSQL 16, `pg`, `bcryptjs`, `cookie-parser`, `express-rate-limit`; tests with `node:test` + `supertest`; local stack via docker-compose.

---

## File Structure

- Create: `db/schema.sql`, `db/pool.js`, `db/migrate.js`
- Create: `lib/validate.js`, `lib/auth.js`
- Create: `middleware/requireAuth.js`
- Create: `routes/auth.js`
- Create: `docker-compose.yml`, `Dockerfile`, `.dockerignore`
- Create: `test/validate.test.js`, `test/auth.test.js`, `test/routes.test.js`
- Modify: `server.js` (mount cookie-parser, CORS lockdown, CSP, router, page gating)
- Modify: `package.json` (deps + scripts), `.env.example`
- Modify: `auth.html` (remove Nafath, add username/password forms)
- Modify: `profile.html` (logout button), `shared.js` (safe Toast rendering)
- Modify: `sw.js`, `vercel.json`, `netlify.toml`, `README.md`
- Delete: `nafath-api.js`

---

### Task 0: Initialize git (this project is not a repo yet)

**Files:** none (repo init)

- [ ] **Step 1: Init repo and make a baseline commit**

```bash
cd /Users/botman/projects/murabaha-platform_1
git init
printf "node_modules/\n.env\n.DS_Store\n" > .gitignore   # only if not already present
git add -A
git commit -m "chore: baseline before auth/postgres work"
git checkout -b feat/auth-postgres
```

Expected: a new repo on branch `feat/auth-postgres` with one baseline commit.

---

### Task 1: Add dependencies and fix audit

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime + dev deps**

```bash
npm install pg@^8.11.5 bcryptjs@^2.4.3 cookie-parser@^1.4.6 express-rate-limit@^7.4.0
npm install --save-dev supertest@^7.0.0
```

- [ ] **Step 2: Fix the known vulns**

```bash
npm audit fix
```

Expected: express/qs bumped; `npm audit` reports 0 (or only unfixable) vulns.

- [ ] **Step 3: Add scripts to package.json**

In `package.json` `"scripts"`, add:

```json
    "migrate": "node db/migrate.js",
    "test": "node --test"
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add pg/bcryptjs/cookie-parser/rate-limit, fix audit"
```

---

### Task 2: Local Postgres + env config

**Files:**
- Create: `docker-compose.yml`, `Dockerfile`, `.dockerignore`
- Modify: `.env.example`

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: murabaha
      POSTGRES_PASSWORD: murabaha
      POSTGRES_DB: murabaha
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U murabaha"]
      interval: 5s
      timeout: 5s
      retries: 5

  app:
    build: .
    environment:
      NODE_ENV: production
      PORT: 3000
      DATABASE_URL: postgres://murabaha:murabaha@db:5432/murabaha
      SESSION_SECRET: change-me-in-production
      CORS_ORIGIN: http://localhost:3000
    ports:
      - "3000:3000"
    depends_on:
      db:
        condition: service_healthy
    command: sh -c "node db/migrate.js && node server.js"

volumes:
  pgdata:
```

- [ ] **Step 2: Write `Dockerfile`**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 3: Write `.dockerignore`**

```
node_modules
.env
.git
.DS_Store
docs
test
```

- [ ] **Step 4: Update `.env.example`**

Replace the SMTP block; final contents:

```
# مُرابحة Platform — Environment Variables
PORT=3000
NODE_ENV=development

# PostgreSQL
DATABASE_URL=postgres://murabaha:murabaha@localhost:5432/murabaha

# Auth
SESSION_SECRET=change-me-in-production
CORS_ORIGIN=http://localhost:3000
```

- [ ] **Step 5: Start the DB for development**

```bash
docker compose up -d db
docker compose ps
```

Expected: `db` container healthy, listening on 5432.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml Dockerfile .dockerignore .env.example
git commit -m "feat: add docker-compose postgres + env config"
```

---

### Task 3: Database schema, pool, and migration runner

**Files:**
- Create: `db/schema.sql`, `db/pool.js`, `db/migrate.js`

- [ ] **Step 1: Write `db/schema.sql`**

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      CITEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
```

- [ ] **Step 2: Write `db/pool.js`**

```js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};
```

- [ ] **Step 3: Write `db/migrate.js`**

```js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[migrate] schema applied');
  await pool.end();
}

migrate().catch(err => {
  console.error('[migrate] failed:', err.message);
  process.exit(1);
});
```

- [ ] **Step 4: Run the migration**

```bash
DATABASE_URL=postgres://murabaha:murabaha@localhost:5432/murabaha node db/migrate.js
```

Expected: prints `[migrate] schema applied`.

- [ ] **Step 5: Verify tables exist**

```bash
docker compose exec db psql -U murabaha -d murabaha -c "\dt"
```

Expected: `users` and `sessions` listed.

- [ ] **Step 6: Commit**

```bash
git add db/
git commit -m "feat: postgres schema, pool, and migration runner"
```

---

### Task 4: Input validation (TDD)

**Files:**
- Create: `lib/validate.js`
- Test: `test/validate.test.js`

- [ ] **Step 1: Write the failing test**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { validateUsername, validatePassword } = require('../lib/validate');

test('username: accepts 3-32 alphanumeric/underscore', () => {
  assert.equal(validateUsername('aliahmad'), null);
  assert.equal(validateUsername('ali_123'), null);
});

test('username: rejects too short, bad chars, empty', () => {
  assert.ok(validateUsername('ab'));
  assert.ok(validateUsername('has space'));
  assert.ok(validateUsername(''));
  assert.ok(validateUsername(null));
});

test('password: requires >= 8 chars', () => {
  assert.equal(validatePassword('hunter2!!'), null);
  assert.ok(validatePassword('short'));
  assert.ok(validatePassword(''));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/validate.test.js`
Expected: FAIL — cannot find module `../lib/validate`.

- [ ] **Step 3: Write `lib/validate.js`**

```js
// Returns null when valid, or an Arabic error string when invalid.
function validateUsername(username) {
  if (typeof username !== 'string') return 'اسم المستخدم مطلوب';
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
    return 'اسم المستخدم يجب أن يكون ٣-٣٢ حرفاً (أحرف وأرقام و_ فقط)';
  }
  return null;
}

function validatePassword(password) {
  if (typeof password !== 'string') return 'كلمة المرور مطلوبة';
  if (password.length < 8) return 'كلمة المرور يجب أن تكون ٨ أحرف على الأقل';
  return null;
}

module.exports = { validateUsername, validatePassword };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/validate.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/validate.js test/validate.test.js
git commit -m "feat: username/password validation with tests"
```

---

### Task 5: Auth library — hashing + sessions (TDD)

**Files:**
- Create: `lib/auth.js`
- Test: `test/auth.test.js`

- [ ] **Step 1: Write the failing test**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { hashPassword, verifyPassword, newSessionToken } = require('../lib/auth');

test('hashPassword + verifyPassword round-trip', async () => {
  const hash = await hashPassword('hunter2!!');
  assert.notEqual(hash, 'hunter2!!');
  assert.equal(await verifyPassword('hunter2!!', hash), true);
  assert.equal(await verifyPassword('wrong', hash), false);
});

test('newSessionToken is 64 hex chars and unique', () => {
  const a = newSessionToken();
  const b = newSessionToken();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/auth.test.js`
Expected: FAIL — cannot find module `../lib/auth`.

- [ ] **Step 3: Write `lib/auth.js`**

```js
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
    `SELECT u.id, u.username, u.full_name
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/auth.test.js`
Expected: PASS (the two pure-function tests; DB-backed functions are exercised in Task 8 integration tests).

- [ ] **Step 5: Commit**

```bash
git add lib/auth.js test/auth.test.js
git commit -m "feat: auth lib — bcrypt hashing and session helpers"
```

---

### Task 6: requireAuth middleware

**Files:**
- Create: `middleware/requireAuth.js`

- [ ] **Step 1: Write `middleware/requireAuth.js`**

```js
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

module.exports = { COOKIE, requireAuthPage, requireAuthApi };
```

- [ ] **Step 2: Commit**

```bash
git add middleware/requireAuth.js
git commit -m "feat: requireAuth middleware (page redirect + api 401)"
```

---

### Task 7: Auth routes (register/login/logout/me) with rate limiting

**Files:**
- Create: `routes/auth.js`

- [ ] **Step 1: Write `routes/auth.js`**

```js
const express = require('express');
const rateLimit = require('express-rate-limit');
const { query } = require('../db/pool');
const { validateUsername, validatePassword } = require('../lib/validate');
const {
  hashPassword, verifyPassword, createSession, destroySession, SESSION_TTL_MS,
} = require('../lib/auth');
const { COOKIE, requireAuthApi } = require('../middleware/requireAuth');

const router = express.Router();

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

router.post('/register', authLimiter, async (req, res) => {
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
});

router.post('/login', authLimiter, async (req, res) => {
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
});

router.post('/logout', async (req, res) => {
  await destroySession(req.signedCookies?.[COOKIE]).catch(() => {});
  res.clearCookie(COOKIE, { ...cookieOpts, maxAge: undefined });
  res.json({ success: true });
});

router.get('/me', requireAuthApi, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add routes/auth.js
git commit -m "feat: /api/auth register/login/logout/me with rate limiting"
```

---

### Task 8: Wire backend into server.js + integration tests (TDD)

**Files:**
- Modify: `server.js`
- Test: `test/routes.test.js`

- [ ] **Step 1: Write the failing integration test**

```js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

// These tests need a database. Skip cleanly if DATABASE_URL is unset.
const HAS_DB = !!process.env.DATABASE_URL;

let app, pool;
before(async () => {
  if (!HAS_DB) return;
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
  app = require('../server');
  ({ pool } = require('../db/pool'));
  await pool.query('DELETE FROM sessions');
  await pool.query('DELETE FROM users');
});
after(async () => { if (HAS_DB && pool) await pool.end(); });

test('register -> me -> logout cycle', { skip: !HAS_DB }, async () => {
  const agent = request.agent(app);
  const reg = await agent.post('/api/auth/register')
    .send({ username: 'tester1', password: 'hunter2!!' });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.user.username, 'tester1');

  const me = await agent.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.username, 'tester1');

  const out = await agent.post('/api/auth/logout');
  assert.equal(out.status, 200);

  const me2 = await agent.get('/api/auth/me');
  assert.equal(me2.status, 401);
});

test('duplicate username rejected', { skip: !HAS_DB }, async () => {
  const a = request.agent(app);
  await a.post('/api/auth/register').send({ username: 'dup', password: 'hunter2!!' });
  const res = await request(app).post('/api/auth/register')
    .send({ username: 'dup', password: 'hunter2!!' });
  assert.equal(res.status, 409);
});

test('bad credentials return 401', { skip: !HAS_DB }, async () => {
  const res = await request(app).post('/api/auth/login')
    .send({ username: 'nobody', password: 'whatever1' });
  assert.equal(res.status, 401);
});

test('unauthenticated /portfolio redirects to /login', { skip: !HAS_DB }, async () => {
  const res = await request(app).get('/portfolio').redirects(0);
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/login');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL=postgres://murabaha:murabaha@localhost:5432/murabaha node --test test/routes.test.js`
Expected: FAIL — `/api/auth/register` returns 404 (router not mounted yet).

- [ ] **Step 3: Modify `server.js` — add requires near the top**

After the existing `const morgan = require('morgan');` line, add:

```js
const cookieParser = require('cookie-parser');
const authRoutes   = require('./routes/auth');
const { requireAuthPage } = require('./middleware/requireAuth');
```

- [ ] **Step 4: Tighten CSP connect-src in `server.js`**

Replace the `connectSrc` directive (it currently lists `https://api.murbaha.com`) with same-origin only:

```js
      connectSrc:  ["'self'"],
```

- [ ] **Step 5: Lock down CORS + add cookie parser in `server.js`**

Replace `app.use(cors());` with:

```js
app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: true }));
app.use(cookieParser(process.env.SESSION_SECRET || 'dev-secret'));
```

- [ ] **Step 6: Mount the auth router in `server.js`**

Immediately before the `// ─── Page Routes ───` comment, add:

```js
app.use('/api/auth', authRoutes);
```

- [ ] **Step 7: Gate private page routes in `server.js`**

Replace the `Object.entries(pageRoutes).forEach(...)` block with a version that
applies `requireAuthPage` to private routes:

```js
const PRIVATE = new Set(['/portfolio', '/profile', '/notifications', '/contract']);

Object.entries(pageRoutes).forEach(([route, file]) => {
  const handlers = PRIVATE.has(route) ? [requireAuthPage] : [];
  app.get(route, ...handlers, (req, res) => {
    res.sendFile(path.join(__dirname, file));
  });
});
```

- [ ] **Step 8: Run the integration tests**

Run: `DATABASE_URL=postgres://murabaha:murabaha@localhost:5432/murabaha SESSION_SECRET=test-secret node --test test/routes.test.js`
Expected: PASS (4 tests).

- [ ] **Step 9: Run the full suite**

Run: `DATABASE_URL=postgres://murabaha:murabaha@localhost:5432/murabaha SESSION_SECRET=test-secret node --test`
Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add server.js test/routes.test.js
git commit -m "feat: wire auth router, cookie sessions, CORS/CSP lockdown, page gating"
```

---

### Task 9: Remove Nafath

**Files:**
- Delete: `nafath-api.js`
- Modify: `auth.html`, `sw.js`, `vercel.json`

- [ ] **Step 1: Delete the Nafath SDK**

```bash
git rm nafath-api.js
```

- [ ] **Step 2: Remove the Nafath script tag from `auth.html`**

Delete this line (near line 15):

```html
<script src="nafath-api.js" defer></script>
```

- [ ] **Step 3: Remove Nafath JS from `auth.html`**

In the `<script>` block at the bottom of `auth.html`, delete `startNafathFlow`,
`cancelFlow`, `_setStatus`, `_startCountdown`, the `_cancelPoll`/`_cdTimer` state,
and the `DOMContentLoaded` handler that calls `NafathAPI.handleOidcCallback`.
These are replaced by the form handlers in Task 10. Also remove the Nafath/Absher
`.sheet` markup blocks (`#sheet-nafath-login`, `#sheet-nafath-register`,
`#sheet-absher`) from the page body.

- [ ] **Step 4: Remove the Nafath header from `vercel.json`**

Delete the object in `"headers"` whose `"source"` is `"/nafath-api.js"`.

- [ ] **Step 5: Confirm sw.js has no Nafath reference**

```bash
grep -n nafath sw.js || echo "clean"
```

Expected: `clean` (sw.js never cached nafath-api.js).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: remove Nafath login (SDK, flow JS, config)"
```

---

### Task 10: Wire the username/password forms in auth.html

**Files:**
- Modify: `auth.html`

- [ ] **Step 1: Replace the login method list with a username/password form**

In `#loginMode`, replace the Nafath/Face-ID/OTP method buttons with:

```html
<form id="loginForm" class="auth-form" autocomplete="on">
  <label for="loginUsername">اسم المستخدم</label>
  <input id="loginUsername" name="username" type="text" autocomplete="username"
         inputmode="latin" style="direction:ltr" required />
  <label for="loginPassword">كلمة المرور</label>
  <input id="loginPassword" name="password" type="password"
         autocomplete="current-password" style="direction:ltr" required />
  <p class="form-error" id="loginError" style="color:var(--red);font-size:12px;min-height:16px"></p>
  <button type="submit" class="btn btn-primary btn-block">تسجيل الدخول</button>
</form>
```

- [ ] **Step 2: Replace the register block with a register form**

In `#registerMode`, replace its contents with:

```html
<form id="registerForm" class="auth-form" autocomplete="on">
  <label for="regFullName">الاسم الكامل</label>
  <input id="regFullName" name="full_name" type="text" autocomplete="name" />
  <label for="regUsername">اسم المستخدم</label>
  <input id="regUsername" name="username" type="text" autocomplete="username"
         inputmode="latin" style="direction:ltr" required />
  <label for="regPassword">كلمة مرور قوية</label>
  <input id="regPassword" name="password" type="password"
         autocomplete="new-password" placeholder="٨ أحرف على الأقل"
         style="direction:ltr" required />
  <p class="form-error" id="regError" style="color:var(--red);font-size:12px;min-height:16px"></p>
  <button type="submit" class="btn btn-primary btn-block">إنشاء حساب</button>
</form>
```

- [ ] **Step 3: Add the form handlers to the `<script>` block in `auth.html`**

```js
async function postJSON(url, data) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const err = document.getElementById('loginError');
  err.textContent = '';
  const { ok, body } = await postJSON('/api/auth/login', {
    username: f.username.value.trim(),
    password: f.password.value,
  });
  if (ok) { window.location.href = '/portfolio'; }
  else { err.textContent = body.error || 'تعذّر تسجيل الدخول'; }
});

document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const err = document.getElementById('regError');
  err.textContent = '';
  const { ok, body } = await postJSON('/api/auth/register', {
    username: f.username.value.trim(),
    password: f.password.value,
    full_name: f.full_name.value.trim(),
  });
  if (ok) { window.location.href = '/portfolio'; }
  else { err.textContent = body.error || 'تعذّر إنشاء الحساب'; }
});
```

- [ ] **Step 4: Manual verification**

```bash
docker compose up -d db
DATABASE_URL=postgres://murabaha:murabaha@localhost:5432/murabaha SESSION_SECRET=dev npm start
```
Visit `http://localhost:3000/login`, register a user, confirm redirect to
`/portfolio`, reload `/portfolio` (stays in), then POST `/api/auth/logout` and
confirm `/portfolio` redirects to `/login`.

- [ ] **Step 5: Commit**

```bash
git add auth.html
git commit -m "feat: username/password login + register forms wired to API"
```

---

### Task 11: Make Toast rendering safe + add logout control

**Files:**
- Modify: `shared.js`, `profile.html`

- [ ] **Step 1: Replace the markup-string assignment in `shared.js` Toast.show**

Around line 70, the toast currently builds its content from an HTML string
(`el` is populated with a markup string interpolating `message`). Replace that
single line with safe DOM construction so server/error text can never inject markup:

```js
    const iconEl = document.createElement('span');
    iconEl.style.fontSize = '16px';
    iconEl.textContent = icon;
    const msgEl = document.createElement('span');
    msgEl.textContent = message;
    el.append(iconEl, msgEl);
```

- [ ] **Step 2: Add a logout helper to `shared.js`**

Append near the other exposed globals:

```js
async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } finally {
    window.location.href = '/login';
  }
}
window.logout = logout;
```

- [ ] **Step 3: Add a logout button to `profile.html`**

Add a button wired to logout (place it with the other profile actions):

```html
<button class="btn btn-outline btn-block" onclick="logout()">تسجيل الخروج</button>
```

- [ ] **Step 4: Commit**

```bash
git add shared.js profile.html
git commit -m "fix: safe Toast text rendering; add logout control"
```

---

### Task 12: Deploy config + docs cleanup

**Files:**
- Modify: `netlify.toml`, `vercel.json`, `README.md`

- [ ] **Step 1: Remove the dead serverless API mapping from `netlify.toml`**

Delete the `[[redirects]]` block whose `from = "/api/*"` (it points at a
non-existent Netlify function). Add a comment near the top:

```toml
# NOTE: this app now requires a Node server + PostgreSQL for /api/auth.
# Netlify static hosting can preview the front end only. Deploy the server
# to a Node host (Render/Railway/Fly) or via docker-compose.
```

- [ ] **Step 2: Remove the `/api/(.*)` route from `vercel.json`**

Delete `{ "src": "/api/(.*)", "dest": "/server.js" }` (a long-lived Express
`app.listen` server is not a Vercel serverless function). Leave the static
routes. The static preview no longer advertises a working API.

- [ ] **Step 3: Update `README.md` run instructions**

Replace the run section with the docker-compose flow:

````markdown
## Run (local)

```bash
cp .env.example .env
docker compose up -d db          # start PostgreSQL
npm install
npm run migrate                  # apply schema
npm start                        # http://localhost:3000
```

Or run the whole stack in containers:

```bash
docker compose up --build
```
````

- [ ] **Step 4: Run the full test suite one more time**

Run: `DATABASE_URL=postgres://murabaha:murabaha@localhost:5432/murabaha SESSION_SECRET=test node --test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add netlify.toml vercel.json README.md
git commit -m "docs: node+postgres deploy path; drop dead serverless API mappings"
```

---

## Done criteria

- `npm test` passes (with DB up); validation + auth unit tests pass without a DB.
- Registering and logging in sets an httpOnly `mrb_session` cookie; `/portfolio`,
  `/profile`, `/notifications`, `/contract` redirect to `/login` when logged out.
- No `nafath-api.js`, no Nafath references in `auth.html`/`vercel.json`.
- `npm audit` clean; CSP `connect-src 'self'`; CORS restricted with credentials.
- `docker compose up --build` brings up db + app and serves a working login.
```
