# Phase 1: Core Investing + User Dashboard (port canonical logic → _1 Postgres)

**Date:** 2026-05-26
**Status:** Approved (direction); spec pending user review
**Context:** The canonical `murbha-platform/` already implements the full data-backed app on pure-Node + JSON-file storage. This phase ports its **core investing slice** into `murbha-platform_1`'s Express + PostgreSQL + username/password stack, reusing the canonical's proven API contract, business logic, seed data, and `app.js` front-end runtime. Later phases: contracts/payments (2), admin portal (3), KYC chain (4).

## Goals
1. Real data model for projects/investments/transactions/notifications in Postgres.
2. REST endpoints (catalog + invest + portfolio + notifications) reusing the canonical's logic, translated to parameterized SQL + the existing `requireAuth`.
3. Replace `_1`'s mock front-ends for projects/project/portfolio/notifications with the canonical's wired pages, rebased onto `_1` (username/password, `/api/*`, murbaha.com brand, a11y fixes already in `_1`).
4. Seed Postgres with the canonical's projects + demo data so the UI renders immediately.

## Non-Goals (later phases)
- Contracts (sign), payments (deposit/withdraw/pay) — Phase 2.
- Admin portal + ROI calc + extensions — Phase 3.
- KYC verify chain (email/mobile/id/address) — Phase 4.
- Nafath. Auth stays username/password (already shipped in `_1`).

## API convention decision
Unify on `_1`'s existing `/api/*` + username/password auth. The canonical's `app.js` calls `App.api('/app/...')`; we rebase it to `/api/...` and to `_1`'s auth shape (`{username,password}`, `GET /api/auth/me` → `{user}`). This avoids running two auth surfaces and keeps the auth we already built and tested.

## Data model (extend `db/schema.sql`, idempotent)
- `projects`: `id UUID pk`, `slug citext unique`, `name`, `category`, `city`, `banner_color`, `summary`, `description`, `target_amount numeric`, `raised_amount numeric default 0`, `expected_return_pct numeric`, `term_months int`, `min_investment numeric`, `total_value numeric`, `status text default 'open'` (open|funded|closed), `created_at timestamptz default now()`
- `investments`: `id UUID pk`, `user_id → users`, `project_id → projects`, `amount numeric`, `expected_return_pct numeric` (snapshot), `status text default 'active'` (active|completed), `created_at`
- `transactions`: `id UUID pk`, `user_id → users`, `kind text` (deposit|investment|profit|withdrawal), `amount numeric`, `project_id UUID null → projects`, `description text`, `created_at`
- `notifications`: `id UUID pk`, `user_id → users`, `title`, `body`, `type text`, `read boolean default false`, `created_at`
- Add `users.balance numeric default 0` (canonical tracks a wallet balance; needed for portfolio + future deposit/withdraw). Seed demo user with an opening balance + deposit transaction.
- Indexes: `investments(user_id)`, `investments(project_id)`, `transactions(user_id)`, `notifications(user_id)`.

## Endpoints (Express routers, parameterized SQL)
Public (no auth):
- `GET /api/projects` (+ `?category=`) → list of open projects
- `GET /api/projects/:slug` → project detail

Auth (`requireAuthApi`):
- `POST /api/projects/:slug/invest` `{amount}` → in ONE DB transaction: validate `amount ≥ min_investment`, `amount ≤ target-raised`, and `amount ≤ user.balance`; insert `investment` + `transaction(kind=investment)`; `projects.raised_amount += amount`; `users.balance -= amount`. Return updated portfolio summary. Errors: 400 `below_min`/`exceeds_remaining`/`insufficient_balance`.
- `GET /api/portfolio` → `{ balance, invested, expectedReturn, expectedProfit, investments:[{...project join}], transactions:[...] }` (mirrors canonical's `/app/portfolio` shape so the ported page works unchanged)
- `GET /api/transactions` → user's transactions, newest first
- `GET /api/notifications` → user's notifications; `POST /api/notifications/:id/read` → mark read; `POST /api/notifications/read-all`

## Front-end (port canonical's wired pages onto `_1`)
- Bring `app.js` from canonical → `_1`, rebased: base path `/api`, auth via `{username,password}`, keep `App.api/me/requireAuth/logout/toast/fmt`. Load it on the data pages.
- Replace `_1`'s mock `projects.html`, `project.html`, `portfolio.html`, `notifications.html` with the canonical's wired versions, then apply `_1`'s standing changes: murbaha.com brand, viewport without `user-scalable=no`, `:focus-visible` + `prefers-reduced-motion`, and `shared.css`/`shared.js` includes if the page uses them.
- Keep the dashboard's richer tiles (contracts/reports buttons) visible but pointing to Phase-2/“coming soon” toasts where the backend isn't built yet.
- `requireAuth` on the client redirects to `/login`; server already gates these page routes via `requireAuthPage`.

## Seed (`db/seed.js`, `npm run seed`)
Translate canonical `data/seed.json` → Postgres: insert the projects (slug, name, category, city, amounts, return, term, min, status), give the demo user (`demo`/existing) an opening `balance` + a seed deposit transaction and 1–2 notifications. Idempotent (truncate the four tables + reset balance, or upsert by slug). Safe to re-run.

## Testing (node:test + supertest, against docker Postgres)
- `GET /api/projects` returns seeded projects; `?category=` filters; `:slug` 404s when missing.
- `invest` happy path: balance and raised_amount move by `amount`, an investment + transaction row are created, portfolio reflects it.
- `invest` rejects: below min (400), exceeds remaining (400), exceeds balance (400), unauthenticated (401).
- `portfolio` aggregation: invested = sum, expectedReturn = amount-weighted.
- notifications: list, mark-read flips `read`, read-all.
- All skip cleanly when `DATABASE_URL` unset (match existing test pattern).

## Files
- Modify: `db/schema.sql` (4 tables + `users.balance`), `server.js` (mount new routers + load app.js where needed)
- Create: `db/seed.js`; `routes/projects.js`, `routes/portfolio.js`, `routes/notifications.js`; `lib/portfolio.js` (aggregation helper); `app.js` (ported runtime); `test/projects.test.js`, `test/portfolio.test.js`, `test/notifications.test.js`
- Replace: `projects.html`, `project.html`, `portfolio.html`, `notifications.html` (canonical wired versions, rebranded + a11y)
- Modify: `package.json` (`"seed": "node db/seed.js"`)

## Done criteria
- Logged-in demo user sees seeded projects, can invest (balance + raised update, appears in portfolio), sees transactions + notifications — all from Postgres, no mock data on those pages.
- `npm test` green with DB; clean skip without.
- `docker compose up --build` + `npm run migrate && npm run seed` yields a working investing flow.
