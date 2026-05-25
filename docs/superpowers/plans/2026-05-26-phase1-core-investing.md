# Phase 1: Core Investing + User Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make projects/invest/portfolio/notifications real in `murabaha-platform_1` — backed by PostgreSQL, ported from the canonical `murabaha-platform`'s proven `/app/*` logic, on `_1`'s Express + username/password stack.

**Architecture:** Add four tables (`projects`, `investments`, `transactions`, `notifications`) + a `users.balance` column. New Express routers under `/api/*` return the canonical's camelCase JSON shape so the ported front-end runtime (`app.js`) and pages work. Invest is **simplified for Phase 1**: it immediately creates an `active` investment, debits balance, bumps `raised`, and records a transaction — all in one DB transaction. (Canonical's contract→sign→pay chain is deferred to Phase 2, which will refactor invest to insert a `pending_signature` step.)

**Tech Stack:** Express 4, PostgreSQL 16 (`pg`), `node:test` + `supertest`. DB at `postgres://murabaha:murabaha@localhost:5432/murabaha`. Existing: `db/pool.js` (`{pool, query}`), `lib/auth.js`, `middleware/requireAuth.js` (`requireAuthApi`, `requireAuthPage`), auth at `/api/auth`.

---

## File Structure
- Modify: `db/schema.sql` (4 tables + `users.balance`)
- Create: `db/seed.js`, `lib/dto.js` (row→DTO mappers), `lib/portfolio.js` (aggregation)
- Create: `routes/projects.js`, `routes/portfolio.js`, `routes/notifications.js`
- Modify: `server.js` (mount routers)
- Create: `app.js` (ported front-end runtime), tests under `test/`
- Replace: `projects.html`, `project.html`, `portfolio.html`, `notifications.html` (ported, rebranded)
- Modify: `package.json` (`"seed"` script)

---

### Task 1: Schema — projects/investments/transactions/notifications + balance

**Files:** Modify `db/schema.sql`

- [ ] **Step 1: Append tables to `db/schema.sql`** (after the existing `sessions` block; all idempotent)

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS balance NUMERIC NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS projects (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           CITEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  category       TEXT,
  city           TEXT,
  summary        TEXT,
  description    TEXT,
  goal           NUMERIC NOT NULL,
  raised         NUMERIC NOT NULL DEFAULT 0,
  min_amount     NUMERIC NOT NULL DEFAULT 1000,
  profit_rate    NUMERIC NOT NULL DEFAULT 0.08,
  term_months    INT NOT NULL DEFAULT 12,
  investor_count INT NOT NULL DEFAULT 0,
  total_value    NUMERIC,
  status         TEXT NOT NULL DEFAULT 'open',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS investments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  amount          NUMERIC NOT NULL,
  profit_rate     NUMERIC NOT NULL,
  expected_return NUMERIC NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  amount      NUMERIC NOT NULL,
  project_id  UUID REFERENCES projects(id) ON DELETE SET NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT,
  type       TEXT,
  read       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_investments_user    ON investments(user_id);
CREATE INDEX IF NOT EXISTS idx_investments_project ON investments(project_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user   ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user  ON notifications(user_id);
```

- [ ] **Step 2: Run migration**

Run: `DATABASE_URL=postgres://murabaha:murabaha@localhost:5432/murabaha node db/migrate.js`
Expected: `[migrate] schema applied`

- [ ] **Step 3: Verify**

Run: `docker compose exec -T db psql -U murabaha -d murabaha -c "\dt"`
Expected: `projects`, `investments`, `transactions`, `notifications` listed alongside `users`, `sessions`.

- [ ] **Step 4: Commit**
```bash
git add db/schema.sql
git -c user.email=dev@murbaha.com -c user.name=murbaha commit -m "feat: schema for projects/investments/transactions/notifications + users.balance"
```

---

### Task 2: Seed data

**Files:** Create `db/seed.js`; Modify `package.json`

- [ ] **Step 1: Create `db/seed.js`**

```js
require('dotenv').config();
const { pool } = require('./pool');

const PROJECTS = [
  ['aircraft-cleaning','عقد تنظيف وتجهيز الطائرات — مطار جدة','تشغيل وصيانة','جدة',4000000,1200000,5000,0.115,12,'open'],
  ['riyadh-mall-expansion','توسعة مجمّع تجاري — الرياض','عقاري تجاري','الرياض',5000000,3250000,1000,0.094,18,'open'],
  ['jeddah-logistics-fleet','أسطول لوجستي — جدة','نقل ولوجستيات','جدة',3000000,1820000,1000,0.108,24,'open'],
  ['eastern-solar-farm','محطة طاقة شمسية — المنطقة الشرقية','طاقة متجددة','الدمام',8000000,6400000,5000,0.085,36,'open'],
  ['makkah-residential-tower','برج سكني — مكة المكرّمة','عقاري سكني','مكة المكرّمة',12000000,9600000,2000,0.115,24,'open'],
  ['neom-supplier-financing','تمويل مورّد — نيوم','تمويل تجاري','نيوم',1500000,1500000,1000,0.092,6,'funded'],
  ['alangary-om-1','تشغيل وصيانة مجمع المعذر السكني — الرياض','تشغيل وصيانة (O&M)','الرياض',4000000,4000000,1000,0.112,12,'completed'],
  ['alangary-om-2','تشغيل وصيانة شبكة مياه مجمع الصناعات — الجبيل','تشغيل وصيانة (O&M)','الجبيل',2500000,2500000,1000,0.098,18,'completed'],
  ['alangary-om-3','صيانة أنظمة التكييف المركزي لفنادق الحمراء — جدة','تشغيل وصيانة (O&M)','جدة',3200000,3200000,1000,0.105,12,'completed'],
  ['alangary-om-4','تشغيل وصيانة المحطة الفرعية للكهرباء — المدينة المنورة','تشغيل وصيانة (O&M)','المدينة المنورة',5500000,5500000,1000,0.118,12,'completed'],
  ['alangary-om-5','صيانة الأنظمة الميكانيكية لمستشفى دار السلام — الدمام','تشغيل وصيانة (O&M)','الدمام',4800000,4800000,1000,0.102,24,'completed'],
];

async function seed() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('TRUNCATE investments, transactions, notifications RESTART IDENTITY CASCADE');
    await c.query('DELETE FROM projects');
    for (const [slug,name,category,city,goal,raised,min,rate,term,status] of PROJECTS) {
      await c.query(
        `INSERT INTO projects (slug,name,category,city,goal,raised,min_amount,profit_rate,term_months,status,total_value)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$5)`,
        [slug,name,category,city,goal,raised,min,rate,term,status]
      );
    }
    // Demo user: opening balance + deposit + welcome notification (no-op if user absent)
    const u = await c.query("SELECT id FROM users WHERE username = 'demo'");
    if (u.rowCount > 0) {
      const uid = u.rows[0].id;
      await c.query('UPDATE users SET balance = 50000 WHERE id = $1', [uid]);
      await c.query(
        `INSERT INTO transactions (user_id,kind,amount,description) VALUES ($1,'deposit',50000,'إيداع افتتاحي عبر مدى')`, [uid]);
      await c.query(
        `INSERT INTO notifications (user_id,title,body,type) VALUES ($1,'أهلاً بك في مُرابحة','تم إيداع رصيدك الافتتاحي. تصفّح الفرص وابدأ الاستثمار.','welcome')`, [uid]);
    }
    await c.query('COMMIT');
    console.log(`[seed] ${PROJECTS.length} projects inserted`);
  } catch (e) {
    await c.query('ROLLBACK'); throw e;
  } finally {
    c.release(); await pool.end();
  }
}

seed().catch(err => { console.error('[seed] failed:', err.message); process.exit(1); });
```

- [ ] **Step 2: Add the script to `package.json`** (in `"scripts"`)
```json
    "seed": "node db/seed.js",
```

- [ ] **Step 3: Run it**

Run: `DATABASE_URL=postgres://murabaha:murabaha@localhost:5432/murabaha node db/seed.js`
Expected: `[seed] 11 projects inserted`

- [ ] **Step 4: Verify**

Run: `docker compose exec -T db psql -U murabaha -d murabaha -c "SELECT count(*) FROM projects; SELECT slug,status FROM projects LIMIT 3;"`
Expected: count = 11.

- [ ] **Step 5: Commit**
```bash
git add db/seed.js package.json
git -c user.email=dev@murbaha.com -c user.name=murbaha commit -m "feat: seed 11 projects + demo balance/notification"
```

---

### Task 3: DTO mappers + project catalog API (TDD)

**Files:** Create `lib/dto.js`, `routes/projects.js`, `test/projects.test.js`

- [ ] **Step 1: Create `lib/dto.js`**

```js
// Map a projects row (snake_case) to the canonical camelCase DTO the front-end expects.
function projectDTO(row) {
  if (!row) return null;
  const goal = Number(row.goal);
  const raised = Number(row.raised);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    city: row.city,
    summary: row.summary,
    description: row.description,
    goal,
    raised,
    minAmount: Number(row.min_amount),
    profitRate: Number(row.profit_rate),
    termMonths: row.term_months,
    investorCount: row.investor_count,
    totalValue: row.total_value != null ? Number(row.total_value) : null,
    status: row.status,
    fundedPct: goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : 0,
  };
}

function investmentDTO(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    amount: Number(row.amount),
    profitRate: Number(row.profit_rate),
    expectedReturn: Number(row.expected_return),
    status: row.status,
    createdAt: row.created_at,
    project: row.p_name ? { id: row.project_id, name: row.p_name, slug: row.p_slug, status: row.p_status } : null,
  };
}

function txnDTO(row) {
  return {
    id: row.id, kind: row.kind, amount: Number(row.amount),
    projectId: row.project_id, description: row.description, createdAt: row.created_at,
  };
}

module.exports = { projectDTO, investmentDTO, txnDTO };
```

- [ ] **Step 2: Write failing test `test/projects.test.js`**

```js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const HAS_DB = !!process.env.DATABASE_URL;

let app, pool;
before(async () => {
  if (!HAS_DB) return;
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
  app = require('../server');
  ({ pool } = require('../db/pool'));
});
after(async () => { if (HAS_DB && pool) await pool.end(); });

test('GET /api/projects returns seeded projects with fundedPct', { skip: !HAS_DB }, async () => {
  const res = await request(app).get('/api/projects');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.projects));
  assert.ok(res.body.projects.length >= 1);
  const p = res.body.projects[0];
  assert.ok('fundedPct' in p && 'profitRate' in p && 'minAmount' in p);
});

test('GET /api/projects?category= filters', { skip: !HAS_DB }, async () => {
  const all = (await request(app).get('/api/projects')).body.projects;
  const cat = all[0].category;
  const res = await request(app).get('/api/projects?category=' + encodeURIComponent(cat));
  assert.equal(res.status, 200);
  assert.ok(res.body.projects.every(p => p.category === cat));
});

test('GET /api/projects/:slug returns one; 404 when missing', { skip: !HAS_DB }, async () => {
  const all = (await request(app).get('/api/projects')).body.projects;
  const ok = await request(app).get('/api/projects/' + all[0].slug);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.project.slug, all[0].slug);
  const miss = await request(app).get('/api/projects/does-not-exist');
  assert.equal(miss.status, 404);
});
```

- [ ] **Step 3: Run → FAIL** (router not mounted): `DATABASE_URL=postgres://murabaha:murabaha@localhost:5432/murabaha SESSION_SECRET=test node --test test/projects.test.js`

- [ ] **Step 4: Create `routes/projects.js`** (invest is added in Task 4; this task = catalog only)

```js
const express = require('express');
const { query } = require('../db/pool');
const { projectDTO } = require('../lib/dto');

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/', ah(async (req, res) => {
  const { category } = req.query;
  const params = [];
  let sql = 'SELECT * FROM projects';
  if (category) { params.push(category); sql += ' WHERE category = $1'; }
  sql += ' ORDER BY (status = \'open\') DESC, created_at DESC';
  const { rows } = await query(sql, params);
  res.json({ projects: rows.map(projectDTO) });
}));

router.get('/:slug', ah(async (req, res) => {
  const { rows } = await query('SELECT * FROM projects WHERE slug = $1', [req.params.slug]);
  if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ project: projectDTO(rows[0]) });
}));

module.exports = router;
```

- [ ] **Step 5: Mount in `server.js`** — after the `app.use('/api/auth', authRoutes);` line add:
```js
app.use('/api/projects', require('./routes/projects'));
```

- [ ] **Step 6: Run → PASS** (same command as Step 3). Expected: 3 tests pass.

- [ ] **Step 7: Commit**
```bash
git add lib/dto.js routes/projects.js test/projects.test.js server.js
git -c user.email=dev@murbaha.com -c user.name=murbaha commit -m "feat: project catalog API (list/filter/detail) with tests"
```

---

### Task 4: Invest API (TDD)

**Files:** Modify `routes/projects.js`, `test/projects.test.js`

- [ ] **Step 1: Add failing invest tests to `test/projects.test.js`**

```js
const crypto = require('node:crypto');
async function makeUser(app) {
  const agent = request.agent(app);
  const u = 'inv_' + crypto.randomBytes(4).toString('hex');
  await agent.post('/api/auth/register').send({ username: u, password: 'hunter2!!' });
  // give them balance directly for the test
  await pool.query("UPDATE users SET balance = 100000 WHERE username = $1", [u]);
  return agent;
}

test('POST invest: happy path moves balance + raised, creates rows', { skip: !HAS_DB }, async () => {
  const agent = await makeUser(app);
  const p = (await request(app).get('/api/projects')).body.projects.find(x => x.status === 'open');
  const before = p.raised;
  const res = await agent.post('/api/projects/' + p.slug + '/invest').send({ amount: p.minAmount });
  assert.equal(res.status, 201);
  assert.equal(res.body.portfolio.invested, p.minAmount);
  const after = (await request(app).get('/api/projects/' + p.slug)).body.project;
  assert.equal(after.raised, before + p.minAmount);
});

test('POST invest: rejects below min / over remaining / over balance / unauth', { skip: !HAS_DB }, async () => {
  const agent = await makeUser(app);
  const p = (await request(app).get('/api/projects')).body.projects.find(x => x.status === 'open');
  assert.equal((await agent.post('/api/projects/' + p.slug + '/invest').send({ amount: 1 })).status, 400);
  assert.equal((await agent.post('/api/projects/' + p.slug + '/invest').send({ amount: p.goal })).status, 400); // over remaining or balance
  assert.equal((await request(app).post('/api/projects/' + p.slug + '/invest').send({ amount: p.minAmount })).status, 401);
});
```

- [ ] **Step 2: Run → FAIL** (invest route missing → 404 not 201).

- [ ] **Step 3a: Create `lib/portfolio.js`** (invest's response needs it; Task 5 reuses it)

```js
const { query } = require('../db/pool');
const { investmentDTO, txnDTO } = require('./dto');

async function buildPortfolio(userId) {
  const u = await query('SELECT balance FROM users WHERE id = $1', [userId]);
  const inv = await query(
    `SELECT i.*, p.name AS p_name, p.slug AS p_slug, p.status AS p_status
       FROM investments i JOIN projects p ON p.id = i.project_id
      WHERE i.user_id = $1 ORDER BY i.created_at DESC`, [userId]);
  const txn = await query(
    'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [userId]);

  let invested = 0, expectedReturn = 0;
  for (const r of inv.rows) {
    if (r.status === 'active' || r.status === 'completed') {
      invested += Number(r.amount);
      expectedReturn += Number(r.expected_return);
    }
  }
  return {
    balance: Number(u.rows[0]?.balance || 0),
    invested,
    expectedReturn,
    expectedProfit: expectedReturn - invested,
    investments: inv.rows.map(investmentDTO),
    transactions: txn.rows.map(txnDTO),
  };
}

module.exports = { buildPortfolio };
```

- [ ] **Step 3b: Add invest handler to `routes/projects.js`** — add requires at top:
```js
const { requireAuthApi } = require('../middleware/requireAuth');
const { buildPortfolio } = require('../lib/portfolio');
```
and add this route before `module.exports`:
```js
router.post('/:slug/invest', requireAuthApi, ah(async (req, res) => {
  const amount = Number(req.body?.amount);
  const client = await require('../db/pool').pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: prows } = await client.query('SELECT * FROM projects WHERE slug = $1 FOR UPDATE', [req.params.slug]);
    const p = prows[0];
    if (!p) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'not_found' }); }
    if (p.status !== 'open') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'closed' }); }
    if (!(amount > 0) || amount < Number(p.min_amount)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'below_min' }); }
    if (amount > Number(p.goal) - Number(p.raised)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'exceeds_remaining' }); }

    const { rows: urows } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    if (amount > Number(urows[0].balance)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'insufficient_balance' }); }

    const rate = Number(p.profit_rate);
    const expectedReturn = amount * (1 + rate * Number(p.term_months) / 12);
    await client.query(
      `INSERT INTO investments (user_id,project_id,amount,profit_rate,expected_return,status)
       VALUES ($1,$2,$3,$4,$5,'active')`,
      [req.user.id, p.id, amount, rate, expectedReturn]);
    await client.query(
      `INSERT INTO transactions (user_id,kind,amount,project_id,description)
       VALUES ($1,'investment',$2,$3,$4)`,
      [req.user.id, amount, p.id, 'استثمار في ' + p.name]);
    await client.query('UPDATE projects SET raised = raised + $1, investor_count = investor_count + 1 WHERE id = $2', [amount, p.id]);
    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [amount, req.user.id]);
    await client.query('COMMIT');

    const portfolio = await buildPortfolio(req.user.id);
    res.status(201).json({ portfolio });
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally {
    client.release();
  }
}));
```

- [ ] **Step 4: Run → PASS**. Command: `DATABASE_URL=postgres://murabaha:murabaha@localhost:5432/murabaha SESSION_SECRET=test node --test test/projects.test.js`

- [ ] **Step 5: Commit**
```bash
git add lib/portfolio.js routes/projects.js test/projects.test.js
git -c user.email=dev@murbaha.com -c user.name=murbaha commit -m "feat: invest endpoint (transactional) + portfolio aggregation lib"
```

---

### Task 5: Portfolio aggregation + endpoints (TDD)

**Files:** Use `lib/portfolio.js` (already created in Task 4); Create `routes/portfolio.js`, `test/portfolio.test.js`; Modify `server.js`

- [ ] **Step 1: Confirm `lib/portfolio.js` exists** (created in Task 4). If missing, create it with the `buildPortfolio` code from Task 4 Step 3a.

- [ ] **Step 2: Write failing test `test/portfolio.test.js`**

```js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const crypto = require('node:crypto');
const HAS_DB = !!process.env.DATABASE_URL;

let app, pool;
before(async () => {
  if (!HAS_DB) return;
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
  app = require('../server');
  ({ pool } = require('../db/pool'));
});
after(async () => { if (HAS_DB && pool) await pool.end(); });

test('GET /api/portfolio reflects an investment', { skip: !HAS_DB }, async () => {
  const agent = request.agent(app);
  const u = 'pf_' + crypto.randomBytes(4).toString('hex');
  await agent.post('/api/auth/register').send({ username: u, password: 'hunter2!!' });
  await pool.query("UPDATE users SET balance = 100000 WHERE username = $1", [u]);
  const p = (await request(app).get('/api/projects')).body.projects.find(x => x.status === 'open');
  await agent.post('/api/projects/' + p.slug + '/invest').send({ amount: p.minAmount });

  const res = await agent.get('/api/portfolio');
  assert.equal(res.status, 200);
  assert.equal(res.body.invested, p.minAmount);
  assert.ok(res.body.expectedReturn > p.minAmount);
  assert.equal(res.body.investments.length, 1);
  assert.ok(res.body.transactions.some(t => t.kind === 'investment'));
});

test('GET /api/portfolio requires auth', { skip: !HAS_DB }, async () => {
  assert.equal((await request(app).get('/api/portfolio')).status, 401);
});

test('GET /api/transactions returns user txns', { skip: !HAS_DB }, async () => {
  const agent = request.agent(app);
  const u = 'tx_' + crypto.randomBytes(4).toString('hex');
  await agent.post('/api/auth/register').send({ username: u, password: 'hunter2!!' });
  const res = await agent.get('/api/transactions');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.transactions));
});
```

- [ ] **Step 3: Run → FAIL** (routes missing).

- [ ] **Step 4: Create `routes/portfolio.js`**

```js
const express = require('express');
const { query } = require('../db/pool');
const { requireAuthApi } = require('../middleware/requireAuth');
const { buildPortfolio } = require('../lib/portfolio');
const { txnDTO } = require('../lib/dto');

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/portfolio', requireAuthApi, ah(async (req, res) => {
  res.json(await buildPortfolio(req.user.id));
}));

router.get('/transactions', requireAuthApi, ah(async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [req.user.id]);
  res.json({ transactions: rows.map(txnDTO) });
}));

module.exports = router;
```

- [ ] **Step 5: Mount in `server.js`** — after the projects mount add:
```js
app.use('/api', require('./routes/portfolio'));
```

- [ ] **Step 6: Run → PASS**: `DATABASE_URL=... SESSION_SECRET=test node --test test/portfolio.test.js`

- [ ] **Step 7: Commit**
```bash
git add routes/portfolio.js test/portfolio.test.js server.js
git -c user.email=dev@murbaha.com -c user.name=murbaha commit -m "feat: /api/portfolio and /api/transactions endpoints"
```

---

### Task 6: Notifications API (TDD)

**Files:** Create `routes/notifications.js`, `test/notifications.test.js`; Modify `server.js`

- [ ] **Step 1: Write failing test `test/notifications.test.js`**

```js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const crypto = require('node:crypto');
const HAS_DB = !!process.env.DATABASE_URL;

let app, pool;
before(async () => {
  if (!HAS_DB) return;
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
  app = require('../server');
  ({ pool } = require('../db/pool'));
});
after(async () => { if (HAS_DB && pool) await pool.end(); });

async function userWithNotif() {
  const agent = request.agent(app);
  const u = 'nf_' + crypto.randomBytes(4).toString('hex');
  await agent.post('/api/auth/register').send({ username: u, password: 'hunter2!!' });
  const { rows } = await pool.query('SELECT id FROM users WHERE username=$1', [u]);
  await pool.query("INSERT INTO notifications (user_id,title,body,type) VALUES ($1,'مرحبا','نص','welcome')", [rows[0].id]);
  return agent;
}

test('list + mark read', { skip: !HAS_DB }, async () => {
  const agent = await userWithNotif();
  const list = await agent.get('/api/notifications');
  assert.equal(list.status, 200);
  assert.equal(list.body.notifications.length, 1);
  assert.equal(list.body.notifications[0].read, false);
  const id = list.body.notifications[0].id;
  assert.equal((await agent.post('/api/notifications/' + id + '/read')).status, 200);
  const after = await agent.get('/api/notifications');
  assert.equal(after.body.notifications[0].read, true);
});

test('read-all + auth required', { skip: !HAS_DB }, async () => {
  const agent = await userWithNotif();
  assert.equal((await agent.post('/api/notifications/read-all')).status, 200);
  assert.equal((await request(app).get('/api/notifications')).status, 401);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Create `routes/notifications.js`**

```js
const express = require('express');
const { query } = require('../db/pool');
const { requireAuthApi } = require('../middleware/requireAuth');

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/', requireAuthApi, ah(async (req, res) => {
  const { rows } = await query(
    'SELECT id,title,body,type,read,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
  res.json({ notifications: rows });
}));

router.post('/read-all', requireAuthApi, ah(async (req, res) => {
  await query('UPDATE notifications SET read=true WHERE user_id=$1', [req.user.id]);
  res.json({ success: true });
}));

router.post('/:id/read', requireAuthApi, ah(async (req, res) => {
  await query('UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ success: true });
}));

module.exports = router;
```

- [ ] **Step 4: Mount in `server.js`** — after the portfolio mount:
```js
app.use('/api/notifications', require('./routes/notifications'));
```

- [ ] **Step 5: Run → PASS**, then full suite:
`DATABASE_URL=postgres://murabaha:murabaha@localhost:5432/murabaha SESSION_SECRET=test node --test`
Expected: all tests pass (auth + projects + portfolio + notifications).

- [ ] **Step 6: Commit**
```bash
git add routes/notifications.js test/notifications.test.js server.js
git -c user.email=dev@murbaha.com -c user.name=murbaha commit -m "feat: notifications API (list/read/read-all)"
```

---

### Task 7: Front-end runtime `app.js` (ported from canonical, rebased)

**Files:** Create `app.js` (in project root)

Port `/Users/botman/projects/murabaha-platform/app.js` into this repo with three rebases. Read the canonical file first.

- [ ] **Step 1: Copy the canonical `app.js`** to this repo root, then apply:
  1. **Base path:** its `api()` calls hit absolute paths like `/app/...`. Leave the helper generic, but ensure all call sites in the ported HTML pages use `/api/...` (handled in Task 8). No change needed inside `api()` itself beyond confirming it prefixes nothing (it takes a full path).
  2. **Auth shape:** `App.me()` should GET `/api/auth/me` and read `data.user`. `App.logout()` should POST `/api/auth/logout`. Update those paths to `/api/auth/*`.
  3. **Login fields:** any login helper must send `{ username, password }` (not `{ identifier }`) to match `_1`'s auth.

- [ ] **Step 2: Sanity check** — `node -e "require('./app.js')"` will fail on `window` (browser code); instead verify with: `node --check app.js` → no syntax errors.

- [ ] **Step 3: Commit**
```bash
git add app.js
git -c user.email=dev@murbaha.com -c user.name=murbaha commit -m "feat: port app.js front-end runtime (rebased to /api + username/password)"
```

---

### Task 8: Wire the data pages (ported + rebranded)

**Files:** Replace `projects.html`, `project.html`, `portfolio.html`, `notifications.html`

For each page, port the canonical's wired version and apply `_1`'s standing changes. Do ONE page per commit; verify each in the browser before moving on.

- [ ] **Step 1: For each of the four pages**, copy the canonical version (`/Users/botman/projects/murabaha-platform/<page>`) into `_1`, then:
  1. Rebase every `App.api('/app/...')` / fetch path to `/api/...` (projects→`/api/projects`, project detail→`/api/projects/:slug`, invest→`/api/projects/:slug/invest`, portfolio→`/api/portfolio`, transactions→`/api/transactions`, notifications→`/api/notifications`).
  2. Ensure `<script src="app.js" defer></script>` is present.
  3. Apply `_1` brand/a11y: brand text "Murbaha"/`murbaha.com` (keep Arabic مُرابحة), viewport meta WITHOUT `maximum-scale`/`user-scalable=no`, and confirm the `:focus-visible` + `prefers-reduced-motion` rules exist (they're in `shared.css`; if the page doesn't load `shared.css`, add the same inline block used in `auth.html`).
  4. For dashboard tiles whose backend is Phase 2 (عقودي/contracts, التقارير/reports, سحب/withdraw, deposit), wire them to `App.toast('قريباً')` (coming soon) rather than a dead link.

- [ ] **Step 2: Smoke-test each page against the running server**
```bash
docker compose up -d db
DATABASE_URL=postgres://murabaha:murabaha@localhost:5432/murabaha SESSION_SECRET=devsecret PORT=3014 node server.js &
SV=$!; sleep 1.5
curl -s -c /tmp/j.txt -X POST http://localhost:3014/api/auth/register -H 'Content-Type: application/json' -d '{"username":"smoke","password":"hunter2!!"}' >/dev/null
docker compose exec -T db psql -U murabaha -d murabaha -c "UPDATE users SET balance=100000 WHERE username='smoke';" >/dev/null
echo "projects page has data hook:"; curl -s http://localhost:3014/projects | grep -c "app.js"
echo "portfolio page gated:"; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3014/portfolio
kill $SV 2>/dev/null
```
Then open in a browser, log in as `smoke`/`hunter2!!`, and confirm: projects list renders from API, a project detail loads, investing updates the portfolio, notifications list renders.

- [ ] **Step 3: Commit per page** (4 commits)
```bash
git add projects.html && git -c user.email=dev@murbaha.com -c user.name=murbaha commit -m "feat: wire projects.html to /api/projects"
git add project.html && git -c user.email=dev@murbaha.com -c user.name=murbaha commit -m "feat: wire project.html detail + invest"
git add portfolio.html && git -c user.email=dev@murbaha.com -c user.name=murbaha commit -m "feat: wire portfolio.html dashboard to /api/portfolio"
git add notifications.html && git -c user.email=dev@murbaha.com -c user.name=murbaha commit -m "feat: wire notifications.html to /api/notifications"
```

---

### Task 9: Docs + final verification

**Files:** Modify `README.md`

- [ ] **Step 1: Update README run steps** to include seeding:
```
docker compose up -d db
npm install
npm run migrate
npm run seed
npm start
```

- [ ] **Step 2: Full suite green**
Run: `DATABASE_URL=postgres://murabaha:murabaha@localhost:5432/murabaha SESSION_SECRET=test node --test`
Expected: all tests pass (auth, projects+invest, portfolio, notifications).

- [ ] **Step 3: Clean-skip without DB**
Run: `env -u DATABASE_URL node --test`
Expected: integration tests skipped, unit tests pass, 0 failures.

- [ ] **Step 4: End-to-end browser check** — log in as the seeded `demo`/`demo12345` user (balance 50,000 from seed), invest in an open project, confirm portfolio shows the investment + reduced balance + a transaction, and the welcome notification appears.

- [ ] **Step 5: Commit**
```bash
git add README.md
git -c user.email=dev@murbaha.com -c user.name=murbaha commit -m "docs: add seed step to run instructions"
```

---

## Done criteria
- Seeded projects render on `/projects` and `/project` from Postgres (no mock).
- Logged-in user can invest; balance + raised + investment + transaction all update atomically; `/portfolio` reflects it; rejections (below_min/exceeds_remaining/insufficient_balance/401) return correct codes.
- Notifications list + mark-read work.
- `npm test` green with DB; clean skip without.
- Dashboard contracts/reports/withdraw tiles show a "coming soon" toast (Phase 2 hooks).
