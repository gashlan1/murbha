# Design: Username/Password Auth on PostgreSQL (remove Nafath)

**Date:** 2026-05-25
**Status:** Approved
**Scope:** Replace the client-side Nafath login with a real server-side
username/password auth backed by PostgreSQL, fix the related security findings,
and keep app data (projects/portfolio) as static front-end mock data for now.

## Goals

1. Remove Nafath entirely (client SDK, secrets, dead MFA flow).
2. Real authentication: username + password, bcrypt-hashed, stored in Postgres.
3. Server-issued `httpOnly` cookie sessions stored in a Postgres `sessions` table.
4. Server-side route protection for the private pages.
5. Resolve the security findings from the review (secrets in client, client-only
   auth, CSP, CORS, dependency vulns, service-worker caching).
6. Ship a reproducible local stack: SQL schema, migration runner, docker-compose.

## Non-Goals

- No migration of projects/portfolio/investment data to Postgres (stays mock).
- No email/OTP/2FA, no password reset email flow (future work).
- No full extraction of inline page scripts (CSP `'unsafe-inline'` for scripts
  stays; the XSS sink in Toast is fixed instead).

## Architecture

New backend layer added to the existing Express app:

```
db/
  schema.sql        users + sessions tables (idempotent CREATE ... IF NOT EXISTS)
  migrate.js        applies schema.sql against DATABASE_URL
  pool.js           single pg Pool, exported query helper
lib/
  auth.js           bcryptjs hash/verify; session create / verify / destroy
  validate.js       username + password validation rules
routes/
  auth.js           Express router mounted at /api/auth
middleware/
  requireAuth.js    resolves session cookie -> sessions row -> req.user
server.js           wires middleware, router, protected page gating
Dockerfile          app image (node:20-alpine)
docker-compose.yml  app + postgres:16 with DATABASE_URL wired
```

### Data model

`users`
- `id` UUID primary key (`gen_random_uuid()`)
- `username` CITEXT UNIQUE NOT NULL (case-insensitive)
- `password_hash` TEXT NOT NULL
- `full_name` TEXT NULL
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()

`sessions`
- `id` TEXT primary key (random 32-byte hex token)
- `user_id` UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
- `expires_at` TIMESTAMPTZ NOT NULL (created_at + 7 days)
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()
- index on `user_id`

`citext` and `pgcrypto` extensions enabled in schema.sql.

### Auth flow

- `POST /api/auth/register` — validate input, reject duplicate username, bcrypt
  hash (cost 12), insert user, create session, set cookie, return `{user}`.
- `POST /api/auth/login` — look up user, `bcrypt.compare`; on success create
  session + set cookie; on failure return generic 401 (no user-enumeration).
- `POST /api/auth/logout` — delete session row, clear cookie.
- `GET /api/auth/me` — return `{user}` for a valid session, else 401.

### Session cookie

- Name `mrb_session`, value = session token.
- `httpOnly: true`, `sameSite: 'lax'`, `secure: ENV === 'production'`, `path: '/'`,
  `maxAge` = 7 days. Signed via `cookie-parser` with `SESSION_SECRET`.

### Route protection

`requireAuth` reads `mrb_session`, looks up a non-expired session, attaches
`req.user`. Applied to the private page routes: `/portfolio`, `/profile`,
`/notifications`, `/contract`. No valid session -> 302 redirect to `/login`.
Public pages (landing, legal, projects list, auth) stay open.

## Front-end changes

- Delete `nafath-api.js`; remove its `<script>` tag and all Nafath sheets/flow JS
  from `auth.html`.
- Rebuild the login and register forms to post `username` + `password` to
  `/api/auth/*` with `fetch(..., { credentials: 'include' })`.
- On success, redirect to `/portfolio` (or `/hessa`).
- Add a logout control (calls `POST /api/auth/logout`) on the profile page.
- Remove Nafath from `sw.js` STATIC_ASSETS and from `vercel.json` headers.

## Security fixes (maps to review findings)

- **#1/#2/#3** resolved by removing Nafath + server sessions + `requireAuth`.
- **#4** CSP `connect-src` reduced to `'self'` (all calls are same-origin).
- **#5** Toast/error output uses `textContent`, not `innerHTML`.
- **#6** App is a stateful Node+Postgres service: add Dockerfile + docker-compose
  as the supported deploy path; remove the misleading serverless `/api/*`
  mappings from `netlify.toml`/`vercel.json` and document Node hosting.
- **#8** CORS locked to same-origin via `CORS_ORIGIN` env, `credentials: true`.
- **#9** `npm audit fix` (express/qs); add `pg`, `bcryptjs`, `cookie-parser`,
  `express-rate-limit`.
- **#10** Service worker already moved to stale-while-revalidate (done in the
  UI pass); confirm `/api/*` stays uncached.
- Add `express-rate-limit` on `/api/auth/login` and `/register` (brute-force).

## Configuration

`.env.example` updated:
```
PORT=3000
NODE_ENV=development
DATABASE_URL=postgres://murbha:murbha@localhost:5432/murbha
SESSION_SECRET=change-me-in-production
CORS_ORIGIN=http://localhost:3000
```

## Testing (TDD)

- Runner: `node:test` + `supertest`.
- Unit (`lib/auth`, `lib/validate`): hash round-trips, wrong password fails,
  username/password validation rules, session token shape + expiry.
- Integration (routes, against the docker Postgres test DB): register -> login ->
  me -> logout cycle; duplicate username rejected; bad credentials 401;
  `requireAuth` redirects unauthenticated page requests to `/login`; rate-limit
  trips after N failed logins.
- Tests skip gracefully (not fail) when `DATABASE_URL` is unset.

## New dependencies

Prod: `pg`, `bcryptjs`, `cookie-parser`, `express-rate-limit`.
Dev: `supertest`.

## Deploy

Primary: Node service + managed Postgres (docker-compose locally; Render/Railway/
Fly/any Node host in prod). Static-only hosts (Netlify/Vercel static) can preview
the front end but cannot run auth; this is documented, and the broken serverless
`/api/*` mappings are removed.
