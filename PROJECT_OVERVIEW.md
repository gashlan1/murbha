# Murbha Platform — `murbha-platform_1`

## Purpose
A Saudi Sharia-compliant Murabaha investment platform — Arabic-first RTL with an English toggle, Vision 2030 project catalog, full investor flow (deposit → invest → contract sign → pay), portfolio dashboard, KYC verification, and an admin portal. Investors start from SAR 500.

## Tech Stack
- **Frontend**: vanilla HTML + CSS + JS, RTL-first, bilingual via `i18n.js`. Shared utilities in `shared.css` / `shared.js` + Nafath SDK in `nafath-api.js`. PWA via `sw.js`.
- **Backend**: **Express 4** (`server.js`) + `helmet` / `compression` / `cors` / `morgan` / `cookie-parser` / `dotenv`. Cookie-session auth (`bcryptjs` + `pg`), six REST routers under `/api/*`, optional `nodemailer` for SMTP notifications.
- **Database**: **PostgreSQL 16** via `pg`. Schema in `db/schema.sql`, applied by `db/migrate.js`, seed in `db/seed.js`. Tables: `users`, `sessions`, `projects`, `investments`, `transactions`, `notifications`, `contracts`, `investment_extensions`, `contact_submissions`, `newsletter_subscribers`.
- **Tests**: `node:test` + `supertest` — 43 tests, all green.
- **Deploy**: `vercel.json` + `netlify.toml` + `docker-compose.yml` (Node + Postgres). Static-only hosts (Netlify/Vercel static) can preview the front-end but can't run `/api/*`.

## Folder Structure
```
murbha-platform_1/
├── server.js                     Express entry — mounts routers, page routes, CSP
├── i18n.js                       AR (default) + EN translation table
├── nafath-api.js                 Nafath SDK (client-side; no server proxy yet)
├── package.json
├── docker-compose.yml            Node + Postgres for local dev
│
├── db/
│   ├── schema.sql                All tables + indexes (idempotent)
│   ├── migrate.js                Applies schema.sql to DATABASE_URL
│   ├── seed.js                   11 projects + demo user + opening balance
│   └── pool.js                   pg pool + { query } helper
│
├── lib/
│   ├── auth.js                   bcrypt + session-token helpers
│   ├── dto.js                    Row → DTO mappers (snake_case → camelCase)
│   ├── portfolio.js              Portfolio aggregation
│   └── mailer.js                 nodemailer wrapper (SMTP optional)
│
├── middleware/requireAuth.js     requireAuthApi / requireAuthPage / Admin variants
│
├── routes/
│   ├── auth.js                   /api/auth/register, login, logout, me
│   ├── projects.js               /api/projects (list, detail, invest)
│   ├── contracts.js              /api/contracts (get, sign, pay)
│   ├── portfolio.js              /api/portfolio, /deposit, /withdraw
│   ├── notifications.js          /api/notifications (list, mark read)
│   ├── admin.js                  /api/admin (stats, users, projects, extensions)
│   └── investments.js            /api/investments/:id/extend
│
├── test/                         9 suites — auth, validate, projects, portfolio,
│                                 notifications, contracts, kyc, admin, routes,
│                                 contact-newsletter
│
└── HTML pages (AR-default + EN via i18n)
    hessa · auth · projects · project · portfolio · profile · notifications
    contract · payment · kyc · admin · help · plus legal/policy pages
```

## REST API (mounted under `/api/*`)
- `POST /api/auth/{register,login,logout}`, `GET /api/auth/me`
- `GET  /api/projects`, `GET /api/projects/:slug`, `POST /api/projects/:slug/invest`
- `GET  /api/contracts/:id`, `POST /api/contracts/:id/sign`, `POST /api/contracts/:id/pay`
- `GET  /api/portfolio`, `POST /api/portfolio/deposit`, `POST /api/portfolio/withdraw`
- `GET  /api/notifications`, `POST /api/notifications/:id/read`
- `GET  /api/admin/stats|users|projects|extensions`, `POST /api/investments/:id/extend`
- `POST /api/contact`, `POST /api/newsletter`
- `GET  /api/health`

## How to Run
```bash
# 1. Postgres
docker compose up -d db

# 2. App
cp .env.example .env
npm install
npm run migrate         # apply schema
npm run seed            # 11 projects + demo user + opening balance
npm start               # http://localhost:3000

# or run everything in containers
docker compose up --build

# tests
DATABASE_URL=postgres://murbha:murbha@localhost:5432/murbha \
SESSION_SECRET=test npm test
```

## Status — what's shipped (43 tests green)
- ✅ **Auth** (bcrypt + cookie sessions, register/login/logout)
- ✅ **Projects catalog + invest** (creates pending investment + contract; debits balance on pay)
- ✅ **Contracts: sign → pay** (transactional consistency)
- ✅ **Portfolio aggregation** + deposit / withdraw
- ✅ **Notifications**
- ✅ **KYC**: fields on users, verify endpoints, UI
- ✅ **Admin portal**: role-gated, full stats/users/projects/extensions API
- ✅ **Investment extensions**: investor request → admin approve
- ✅ **Bilingual AR / EN** across landing, projects list, and project detail
- ✅ **Contact + newsletter** persist to Postgres; optional SMTP notification when `SMTP_*` env is set

## Remaining gaps before production
- **Nafath server-side proxy** — the front-end SDK has no same-origin endpoint to call; verification flow stays client-side until a proxy is added.
- **Real SMTP credentials** — `/api/contact` notification falls back to console-logging until `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` are set.
- **Newsletter vendor sync** — list is captured in Postgres; export-to-Mailchimp/ConvertKit is not wired.

## Relationship to other copies
- `~/projects/murbha-platform` (canonical, pure-Node) is now the older/simpler reference.
- `~/projects/murbha-platform_2` is an earlier snapshot of this fork without the Postgres backend.
- `_1` is the current main work — Express + Postgres + tests.
