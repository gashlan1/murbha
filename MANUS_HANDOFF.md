# Murabaha Platform — Complete Handoff Document

> Saudi Arabia Sharia-compliant Islamic investment crowdfunding platform (منصة مُرابحة).
> Vision 2030-aligned. Mobile-first, Arabic RTL, zero npm dependencies.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Folder Structure](#3-folder-structure)
4. [All Pages & Their Purpose](#4-all-pages--their-purpose)
5. [Backend Architecture](#5-backend-architecture)
6. [REST API Reference](#6-rest-api-reference)
7. [Authentication & Sessions](#7-authentication--sessions)
8. [KYC Flow](#8-kyc-flow)
9. [Investment Flow](#9-investment-flow)
10. [Data Model (db.json)](#10-data-model-dbjson)
11. [Frontend Runtime (app.js)](#11-frontend-runtime-appjs)
12. [Nafath Integration](#12-nafath-integration)
13. [Design System](#13-design-system)
14. [Environment Variables](#14-environment-variables)
15. [How to Run Locally](#15-how-to-run-locally)
16. [Deployment (Render)](#16-deployment-render)
17. [Known Bugs Fixed](#17-known-bugs-fixed)
18. [Security Notes](#18-security-notes)
19. [Test Credentials](#19-test-credentials)

---

## 1. Project Overview

**Murabaha** (مُرابحة) is a Sharia-compliant investment crowdfunding platform for Saudi Arabia. Investors browse real-estate and commercial projects, invest via a Murabaha contract (cost-plus-profit sale), sign electronically, and pay via Saudi payment methods (Mada, Apple Pay, STC Pay, urpay, Sadad).

Key regulatory/compliance features:
- Nafath national ID verification (ELM/Rabet API)
- 4-step KYC chain (email → mobile → national ID → national address)
- Admin approval gate before investor can invest
- 10-article Murabaha e-contract with electronic signature
- Sharia board fatwa (4 scholars)
- CMA-style risk disclosure, AML, PDPL privacy, KYC policy, complaints pages

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML + CSS + JS (no framework) |
| Direction | Arabic RTL throughout |
| Fonts | Cairo (display/headings), Tajawal (body), Amiri (fatwa quotes) |
| Numerals | Arabic-Indic (٠١٢٣٤٥٦٧٨٩) |
| Backend | Node.js 18+ pure `http` module, **zero npm dependencies** |
| API | Hand-rolled JSON router in `lib/api.js`, mounted at `/app/*` |
| Database | Flat-file JSON store (`data/db.json`), seeded from `data/seed.json` |
| Sessions | Signed HMAC cookies (`lib/session.js`), 30-day expiry |
| Auth | Nafath MFA + OIDC proxy (server-side, keys never in browser) |
| Deploy | Render (`render.yaml`), PWA via `manifest.webmanifest` |

---

## 3. Folder Structure

```
murabaha-platform/
├── server.js                  # Entry point: static + REST API + Nafath proxy
├── app.js                     # Shared front-end runtime (window.App)
├── nafath-api.js              # Browser Nafath SDK (calls same-origin proxy)
├── package.json               # No deps; engines: node >=18
├── render.yaml                # Render deploy blueprint
├── manifest.webmanifest       # PWA manifest
├── sitemap.xml
├── robots.txt
├── favicon.svg
├── og-image.svg
│
├── lib/
│   ├── api.js                 # All REST route handlers (~900 lines)
│   ├── db.js                  # Flat-file JSON store (atomic writes)
│   └── session.js             # Signed cookies + pbkdf2 password hashing
│
├── data/
│   ├── seed.json              # Initial DB seed (projects, admin user)
│   └── db.json                # Live runtime database (auto-created)
│
├── assets/
│   └── site.css               # Global stylesheet
│
├── .scripts/
│   └── inject_seo.py          # Python SEO/JSON-LD/a11y injectors
│
├── .env                       # Nafath credentials (gitignored)
├── .env.example               # Template
│
│   ── HTML Pages (27 total) ──
│
├── hessa.html                 # Landing page (/ redirects here)
├── signup.html                # New user registration
├── login.html                 # Login page
├── auth.html                  # Sign-in/register with Nafath option
├── verify-email.html          # KYC step 1: email OTP
├── verify-mobile.html         # KYC step 2: mobile OTP
├── verify-id.html             # KYC step 3: national ID upload/scan
├── verify-address.html        # KYC step 4: national address
├── projects.html              # Browse investment opportunities
├── project.html               # Project detail + invest sheet
├── contract.html              # Murabaha contract (10 articles) + e-sign
├── payment.html               # Payment page (post-signature)
├── portfolio.html             # Investor dashboard
├── profile.html               # Account settings
├── notifications.html         # Notifications center
├── help.html                  # Help/FAQ/WhatsApp support
├── admin.html                 # Admin panel (approve users, manage projects)
│
│   ── Legal Pages ──
│
├── legal.html                 # Combined legal hub (tabbed)
├── privacy.html               # Privacy Policy (PDPL compliant)
├── data-protection.html       # Data Retention & Protection
├── terms.html                 # Terms & Conditions
├── risk.html                  # Risk Disclosure (CMA-style)
├── sharia.html                # Sharia Fatwa (4 scholars)
├── aml.html                   # Anti-Money Laundering Policy
├── kyc.html                   # Know Your Customer Policy
├── complaints.html            # Complaints & Dispute Resolution
└── cookies.html               # Cookies Policy
```

---

## 4. All Pages & Their Purpose

### Core App Pages

| File | URL | Description |
|------|-----|-------------|
| `hessa.html` | `/` or `/hessa.html` | Landing page: hero, project teasers, trust indicators, waitlist signup, footer |
| `signup.html` | `/signup.html` | Registration form: name, email, phone, national ID, password |
| `login.html` | `/login.html` | Login form (email/phone + password) |
| `auth.html` | `/auth.html` | Combined auth page with Nafath MFA + OIDC options |
| `verify-email.html` | `/verify-email.html` | KYC step 1: enter 4-digit email OTP (dev code: `1234`) |
| `verify-mobile.html` | `/verify-mobile.html` | KYC step 2: enter 4-digit SMS OTP (dev code: `5678`) |
| `verify-id.html` | `/verify-id.html` | KYC step 3: upload national ID, simulated OCR scan |
| `verify-address.html` | `/verify-address.html` | KYC step 4: national address form (building no, postal, street, district, city; additional no optional) |
| `projects.html` | `/projects.html` | Grid of live and completed investment opportunities |
| `project.html` | `/project.html?id=<slug>` | Project detail: financials, documents, FAQ, invest bottom sheet |
| `contract.html` | `/contract.html?id=<contractId>` | 10-article Murabaha contract with consent checkboxes and typed-name e-signature |
| `payment.html` | `/payment.html?id=<contractId>` | Payment: order summary, payment method selector (Mada/Apple Pay/STC/urpay/Sadad/wallet), card form |
| `portfolio.html` | `/portfolio.html` | Dashboard: balance, total invested, expected return, investments list, transactions |
| `profile.html` | `/profile.html` | Account settings: personal info, password change, security, documents |
| `notifications.html` | `/notifications.html` | Notification center with read/unread management |
| `help.html` | `/help.html` | Help center: FAQ accordion, WhatsApp/phone CTA, contact form |
| `admin.html` | `/admin.html` | Admin panel: user approval/rejection, project creation, extension requests |

### Legal Pages

All are standalone pages linked from the footer.

| File | Description |
|------|-------------|
| `legal.html` | Tabbed hub linking to all legal pages |
| `privacy.html` | Privacy Policy — PDPL (Saudi Personal Data Protection Law) compliant |
| `data-protection.html` | Data Retention & Protection Policy |
| `terms.html` | Terms & Conditions |
| `risk.html` | Risk Disclosure — mandatory CMA-style |
| `sharia.html` | Sharia Fatwa — Sheikh Dr. Abdullah Al-Manea (chair) + 3 scholars, 3 contract types |
| `aml.html` | Anti-Money Laundering & Counter-Terrorism Financing Policy |
| `kyc.html` | Know Your Customer Policy |
| `complaints.html` | Complaints & Dispute Resolution (CMA requirements) |
| `cookies.html` | Cookies Policy |

---

## 5. Backend Architecture

### `server.js` — Entry Point

```
Request → server.js
  ├── GET /healthz            → JSON health check
  ├── GET /myip               → outbound IP (for Nafath whitelist)
  ├── /app/*                  → lib/api.js (REST API)
  ├── /api/v1/*               → Nafath proxy (MFA flow)
  ├── /stg/api/v2/oidc/*      → Nafath proxy (OIDC flow)
  └── *                       → static file server
```

- Loads `.env` via a tiny hand-rolled parser (no dotenv dep).
- Static server blocks access to `server.js`, `.env`, `data/`, `lib/`, `node_modules/`.
- `/` and extensionless URLs redirect to `hessa.html`.

### `lib/db.js` — Flat-File Store

- Single file: `data/db.json`.
- Auto-bootstraps from `data/seed.json` on first run.
- Write queue (`_writing` Promise chain) prevents concurrent write corruption.
- Atomic writes: write to `.tmp` then `fs.renameSync` to actual file.
- API: `get()`, `update(fn)`, `insert(table, row)`, `find(table, pred)`, `filter(table, pred)`, `all(table)`, `remove(table, pred)`, `patch(table, pred, changes)`.

### `lib/session.js` — Auth

- Cookie name: `mrb_sid`.
- Token format: `base64url(JSON payload) + "." + HMAC-SHA256`.
- Payload: `{ uid: userId, exp: timestamp }`.
- `SESSION_SECRET` from env; falls back to SHA-256 of a dev string (rotate in prod).
- Password hashing: `pbkdf2Sync` with 100,000 iterations, SHA-256, 32-byte output.
- Cookie flags: `HttpOnly; SameSite=Lax; Max-Age=2592000` (+ `Secure` in production).

---

## 6. REST API Reference

All endpoints are under `/app/`. All bodies and responses are JSON. Errors return `{ error: "code", message: "<arabic>" }`.

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/app/auth/register` | — | Register: `{ name, email, phone, nationalId, password }` → sets session cookie, returns `{ user, pendingApproval: true }` |
| `POST` | `/app/auth/login` | — | Login: `{ identifier, password }` → sets session cookie |
| `POST` | `/app/auth/logout` | ✓ | Clears session cookie |
| `GET` | `/app/auth/me` | — | Returns `{ user }` or `{ user: null }` |
| `POST` | `/app/auth/nafath` | — | Nafath callback: `{ nationalId, name }` → upserts user, sets session |
| `POST` | `/app/auth/verify-email` | ✓ | `{ code }` — accepts `"1234"` in dev |
| `POST` | `/app/auth/verify-mobile` | ✓ | `{ code }` — accepts `"5678"` in dev |
| `POST` | `/app/auth/verify-id` | ✓ | `{ nationalId }` — must match `/^[12]\d{9}$/` |
| `POST` | `/app/auth/verify-address` | ✓ | `{ buildingNo, postalCode, streetName, district, city, additionalNo? }` |

### Projects

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/app/projects` | — | All projects with `fundedPct` calculated |
| `GET` | `/app/projects/:id` | — | Single project by `id` or `slug` |

### Investments & Contracts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/app/projects/:id/invest` | ✓ | Create investment: `{ amount }` → creates both `investment` and `contract` records, returns `{ investmentId, contractId, amount }` |
| `GET` | `/app/contracts/:id` | ✓ | Get contract + associated project |
| `POST` | `/app/contracts/:id/sign` | ✓ | Sign contract: `{ signature }` → sets `contract.status = "signed"`, `investment.status = "pending_payment"` |
| `POST` | `/app/contracts/:id/pay` | ✓ | Pay: `{ method }` (mada/applepay/stcpay/urpay/sadad/wallet) → activates contract + investment, logs transaction |

### Portfolio

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/app/portfolio` | ✓ | Balance, totals, investments list, transactions (last 50) |
| `POST` | `/app/portfolio/deposit` | ✓ | `{ amount, method }` — adds to wallet balance |
| `POST` | `/app/portfolio/withdraw` | ✓ | `{ amount }` — deducts from wallet balance |

### Notifications

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/app/notifications` | ✓ | All notifications + unread count |
| `POST` | `/app/notifications/:id/read` | ✓ | Mark one as read |
| `POST` | `/app/notifications/read-all` | ✓ | Mark all as read |

### Profile

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `PATCH` | `/app/profile` | ✓ | Update: `{ name?, email?, phone?, locale?, avatar? }` |
| `POST` | `/app/profile/password` | ✓ | Change password: `{ oldPassword, newPassword }` |

### Other

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/app/waitlist` | — | `{ email }` or `{ phone }` — save to waitlist |
| `POST` | `/app/help/contact` | — | `{ subject, message, contact }` — create help request |

### Admin

| Method | Path | Admin | Description |
|--------|------|-------|-------------|
| `GET` | `/app/admin/users` | ✓ | All users (public fields) |
| `POST` | `/app/admin/users/approve` | ✓ | `{ userId }` → sets `approved: true`, sends notification |
| `POST` | `/app/admin/users/reject` | ✓ | `{ userId }` → deletes user |
| `POST` | `/app/admin/projects` | ✓ | Create or update project (upsert by `id`) |
| `POST` | `/app/admin/projects/:id/updates` | ✓ | Add project update + notify investors |
| `GET` | `/app/admin/extensions` | ✓ | All pending extension requests |
| `POST` | `/app/admin/extensions/:id/resolve` | ✓ | `{ approve: bool }` → approve/reject term extension |

### Arabic Error Codes

| Code | Arabic Message |
|------|---------------|
| `invalid_input` | البيانات المُدخلة غير صحيحة. |
| `email_taken` | هذا البريد مُسجّل بالفعل. |
| `phone_taken` | هذا الرقم مُسجّل بالفعل. |
| `bad_credentials` | بيانات الدخول غير صحيحة. |
| `unauthorized` | يجب تسجيل الدخول أولاً. |
| `not_found` | العنصر غير موجود. |
| `insufficient` | الرصيد غير كافٍ لإتمام العملية. |
| `closed` | هذه الفرصة الاستثمارية لم تعد مفتوحة. |
| `already_invested` | لقد استثمرت في هذه الفرصة من قبل. |
| `min_amount` | المبلغ أقل من الحد الأدنى للاستثمار. |
| `max_amount` | المبلغ يتجاوز الحد المتاح في الفرصة. |
| `unapproved_account` | حسابك بانتظار موافقة الإدارة. |

---

## 7. Authentication & Sessions

### Registration Flow

1. `POST /app/auth/register` → creates user with `kycStatus: "pending"`, `approved: false`.
2. Server sets `mrb_sid` signed cookie.
3. User is redirected to `verify-email.html` to begin KYC.

### Login Flow

1. `POST /app/auth/login` with `{ identifier, password }`.
2. Identifier can be email or phone (normalized).
3. If `kycStatus === "verified"` but `approved === false` → returns `403 unapproved_account`.
4. Admin users bypass the approval check.

### Session Cookie

```
mrb_sid=<base64url({"uid":"usr_...","exp":1234567890})>.<hmac>
HttpOnly; SameSite=Lax; Max-Age=2592000; Path=/
```

### User Roles

- `investor` — default role, must be approved to invest
- `admin` — bypasses approval, can access `/app/admin/*`

---

## 8. KYC Flow

The KYC chain must be completed in order. Each step updates `kycStatus`:

```
pending → email_verified → mobile_verified → id_verified → verified
```

After `verified`, the account waits for admin `approved: true` before the user can invest.

| Step | Page | API | Dev Code | Sets kycStatus |
|------|------|-----|----------|----------------|
| 1 | `verify-email.html` | `POST /app/auth/verify-email` | `1234` | `email_verified` |
| 2 | `verify-mobile.html` | `POST /app/auth/verify-mobile` | `5678` | `mobile_verified` |
| 3 | `verify-id.html` | `POST /app/auth/verify-id` | — | `id_verified` |
| 4 | `verify-address.html` | `POST /app/auth/verify-address` | — | `verified` |

**National Address fields:**
- `buildingNo` — required
- `postalCode` — required
- `streetName` — required
- `district` — required
- `city` — required
- `additionalNo` — **optional** (HTML `required` removed; backend does not enforce)

---

## 9. Investment Flow

```
projects.html → project.html → [invest bottom sheet] → contract.html → payment.html → portfolio.html
```

### Step-by-Step

1. **Browse** `projects.html` — fetches `GET /app/projects`.
2. **Select project** → `project.html?id=<slug>` — fetches `GET /app/projects/:id`.
3. **Open invest sheet** → enter amount → click "المتابعة لتوقيع العقد".
4. **POST** `/app/projects/:id/invest` with `{ amount }`.
   - Creates `investment` record: `status: "pending_signature"`, `expectedReturn` calculated as `amount * (1 + profitRate * termMonths/12)`.
   - Creates `contract` record: `status: "pending"`, stores `amount`, `profitRate`, `termMonths`.
   - Returns `{ investmentId, contractId, amount }`.
5. **Redirect** to `contract.html?id=<contractId>`.
6. **Read contract** → check all consent boxes → type full name → click sign.
7. **POST** `/app/contracts/:id/sign` with `{ signature: "<typed name>" }`.
   - Sets `contract.status = "signed"`, `investment.status = "pending_payment"`.
8. **Redirect** to `payment.html?id=<contractId>`.
9. **Select payment method** → fill card details → submit.
10. **POST** `/app/contracts/:id/pay` with `{ method }`.
    - Sets `contract.status = "active"`, `investment.status = "active"`.
    - Updates `project.raised` and `project.investorCount`.
    - Logs transaction. Sends simulated email to console.
11. **Redirect** to `portfolio.html`.

---

## 10. Data Model (db.json)

### Tables

#### `users`
```json
{
  "id": "usr_<hex>",
  "name": "string",
  "email": "string",
  "phone": "+966XXXXXXXXX",
  "nationalId": "string",
  "avatar": null,
  "role": "investor | admin",
  "locale": "ar",
  "nafathVerified": false,
  "approved": false,
  "balance": 0,
  "kycStatus": "pending | email_verified | mobile_verified | id_verified | verified",
  "createdAt": "ISO8601",
  "salt": "hex",
  "passwordHash": "hex"
}
```

#### `projects`
```json
{
  "id": "prj_<hex>",
  "slug": "string",
  "name": "string",
  "category": "string",
  "city": "string",
  "summary": "string",
  "description": "string",
  "image": "emoji or URL",
  "goal": 1000000,
  "raised": 0,
  "investorCount": 0,
  "minAmount": 1000,
  "profitRate": 0.08,
  "termMonths": 12,
  "status": "open | closed | completed",
  "openedAt": "ISO8601",
  "closesAt": "ISO8601",
  "guarantee": "string",
  "shariaApproval": "string",
  "documents": [{ "id": "doc_1", "name": "string", "type": "pdf" }],
  "faq": [],
  "totalProjectValue": 0,
  "opsCosts": 0,
  "otherCosts": 0,
  "minInvestors": 1,
  "maxInvestors": 1000,
  "extendable": false,
  "updates": [{ "id": "upd_<hex>", "date": "ISO8601", "title": "string", "body": "string" }]
}
```

#### `investments`
```json
{
  "id": "inv_<hex>",
  "userId": "usr_<hex>",
  "projectId": "prj_<hex>",
  "amount": 10000,
  "status": "pending_signature | pending_payment | active | completed",
  "expectedReturn": 10800,
  "contractId": "ctr_<hex>",
  "createdAt": "ISO8601",
  "signedAt": null,
  "extensionRequested": false,
  "extensionStatus": "pending | approved | rejected | null"
}
```

#### `contracts`
```json
{
  "id": "ctr_<hex>",
  "userId": "usr_<hex>",
  "projectId": "prj_<hex>",
  "investmentId": "inv_<hex>",
  "amount": 10000,
  "profitRate": 0.08,
  "termMonths": 12,
  "status": "pending | signed | active",
  "signature": null,
  "createdAt": "ISO8601",
  "signedAt": null
}
```

#### `transactions`
```json
{
  "id": "txn_<hex>",
  "userId": "usr_<hex>",
  "kind": "deposit | withdraw | invest_confirm",
  "amount": 10000,
  "ref": "method or investmentId",
  "description": "string",
  "createdAt": "ISO8601"
}
```

#### `notifications`
```json
{
  "id": "ntf_<hex>",
  "userId": "usr_<hex>",
  "kind": "welcome | invest | contract_signed | payment_completed | deposit | withdraw | kyc_completed | project_update | extension_request | extension_resolved | security | help",
  "title": "string",
  "body": "string",
  "meta": {},
  "read": false,
  "createdAt": "ISO8601"
}
```

#### Other tables
- `waitlist` — `{ id, contact, channel: "email|phone|other", createdAt }`
- `helpRequests` — `{ id, userId, subject, message, contact, status: "open", createdAt }`
- `sessions` — (reserved, currently unused; sessions are stateless cookies)

---

## 11. Frontend Runtime (app.js)

`window.App` is exposed by `app.js`, which must be loaded **without `defer`** (synchronously, before inline scripts run).

```javascript
window.App = {
  api(method, path, body?)     // fetch wrapper: throws on non-2xx with Arabic message
  me(force?)                   // current user (cached), null if not logged in
  meSync()                     // synchronous cache read
  requireAuth(redirect?)       // redirects to /login.html if not logged in
  logout()                     // POST /app/auth/logout + redirect to /hessa.html
  toast(msg, kind?)            // bottom toast: 'info' | 'success' | 'error' | 'warn'
  fmt: {
    sar(n)                     // format SAR amount with Arabic-Indic digits
    arNum(n)                   // convert western digits to Arabic-Indic
    date(iso)                  // Intl Arabic date
    dateTime(iso)              // Intl Arabic date + time
    relTime(iso)               // relative "منذ X دقيقة"
  }
  storage: { get, set, del }   // namespaced localStorage (prefix: mrb_)
  on(selector, event, handler) // delegated event listener
  qs(key)                      // URLSearchParams.get shorthand
  escapeHtml(s)                // XSS escape
  refreshHeader()              // re-wire header auth state
}
```

**Important:** `app.js` MUST be loaded as `<script src="app.js"></script>` (no `defer`). Loading with `defer` causes a race condition where inline page scripts call `App.api` before the module is ready.

---

## 12. Nafath Integration

### Proxy Architecture

Browser → `server.js` (injects `APP-ID`/`APP-KEY`) → ELM/Rabet upstream

The browser **never sees** the Nafath credentials. The same-origin proxy in `server.js` injects them server-side.

### Allowed Proxy Paths

```
/api/v1/mfa/request
/api/v1/mfa/request/status
/api/v1/mfa/jwk
/stg/api/v2/oidc/session
/stg/api/v2/oidc/jwt
/stg/api/v2/oidc/jwt/valid
```

### MFA Flow (mobile)

```
sendMfaRequest(nationalId)     → POST /api/v1/mfa/request?local=ar&requestId=<uuid>
  → { transId, random }        ← show random number to user
pollMfaStatus(transId)         → GET /api/v1/mfa/request/status?transId=<id>
  → { status: "COMPLETED" }    ← user tapped matching number in Nafath app
POST /app/auth/nafath           → server creates/links user, sets session
```

### OIDC Flow (web/desktop)

```
getOidcSession(nationalId)     → POST /stg/api/v2/oidc/session
  → { redirectUrl }            ← redirect browser
getJwt(code)                   → POST /stg/api/v2/oidc/jwt
validateJwt(jwt)               → POST /stg/api/v2/oidc/jwt/valid
POST /app/auth/nafath           → server creates/links user, sets session
```

### Service Identifier

The `service` field in Nafath requests is `"Murabaha_Login"`. This must match the service registered in the Rabet portal.

---

## 13. Design System

### Colors

```css
--ink:        #0d1612   /* main text */
--ink-soft:   #1f2a23
--paper:      #fbf6ea   /* cream background */
--paper-2:    #efe8d6
--green:      #0a4d36   /* primary brand */
--green-dark: #062b1e   /* deep brand / nav */
--green-soft: #14694e
--gold:       #b08840   /* accent */
--gold-light: #d4ac6e
--gold-soft:  #e8d3a8
--muted:      #6b7268
--red:        #b54935   /* error/danger */
```

### Typography

| Use | Font | Weight |
|-----|------|--------|
| Display / headings | Cairo | 900, 700, 600 |
| Body text | Tajawal | 800, 700, 500, 400, 300 |
| Fatwa / religious quotes | Amiri | 400 |

### Layout Principles

- **Mobile-first**: designed for 390px viewport, `@media (min-width: 768px)` for tablet/desktop.
- **RTL throughout**: `<html lang="ar" dir="rtl">` on every page.
- **iOS safe areas**: `env(safe-area-inset-*)` used for bottom nav and toasts.
- **Numerals**: all numbers displayed in Arabic-Indic via `App.fmt.arNum()`.

---

## 14. Environment Variables

| Variable | Required | Default in code | Description |
|----------|----------|-----------------|-------------|
| `NAFATH_APP_ID` | Yes (prod) | `fu5ofq88` | Rabet App ID |
| `NAFATH_APP_KEY` | Yes (prod) | `a79fe84a66f...` | Rabet App Key |
| `NAFATH_BASE_URL` | No | `https://rabet-nafath.api.elm.sa` | Nafath upstream base URL |
| `PORT` | No | `3000` | Server port |
| `SESSION_SECRET` | No | SHA-256 of dev string | HMAC key for session cookies — **rotate in production** |
| `NODE_ENV` | No | — | Set to `production` to add `Secure` flag to cookies |

`.env` file format (no library needed):
```
NAFATH_APP_ID=fu5ofq88
NAFATH_APP_KEY=a79fe84a66f34f76bb63dbba04b7eaa2
NAFATH_BASE_URL=https://rabet-nafath.api.elm.sa
PORT=3000
```

---

## 15. How to Run Locally

```bash
cd /path/to/murabaha-platform

# Copy env (already exists with dev credentials)
cp .env.example .env

# Start server (no npm install — zero dependencies)
node server.js

# Open in browser
open http://localhost:3000/hessa.html
```

**Useful endpoints while running:**
- `GET /healthz` → `{ ok: true, upstream: "..." }`
- `GET /myip` → `{ outboundIp: "x.x.x.x" }` (for Nafath IP whitelist)

**Dev OTP codes (hardcoded in `lib/api.js`):**
- Email OTP: `1234`
- Mobile OTP: `5678`

**Seed data** is at `data/seed.json`. Delete `data/db.json` and restart to reset to seed.

---

## 16. Deployment (Render)

### Prerequisites
- Node.js 18+ host
- Static outbound IP (Render Standard plan, $7/mo minimum)
- Rabet portal account with active subscription

### Steps

1. **Push to GitHub** (`.env` is gitignored — don't push secrets).

2. **Create service on Render:**
   - New → Blueprint → connect repo → Render reads `render.yaml`.
   - Upgrade to **Standard** plan for static outbound IP.

3. **Set env vars** in Render dashboard:
   ```
   NAFATH_APP_ID=fu5ofq88
   NAFATH_APP_KEY=a79fe84a66f34f76bb63dbba04b7eaa2
   NAFATH_BASE_URL=https://rabet-nafath.api.elm.sa
   PORT=3000
   NODE_VERSION=20
   SESSION_SECRET=<generate a random 64-char hex string>
   ```

4. **Get outbound IP:** Render dashboard → Service → Settings → Outbound IPs.

5. **Whitelist IP in Rabet portal** (https://rabet.elm.sa):
   - Subscriptions → your app → IP Whitelist → add all Render outbound IPs.
   - Confirm subscription status = **Active**, environment = **Production**.

6. **Verify:**
   ```bash
   curl https://your-app.onrender.com/healthz
   # → {"ok":true,"upstream":"https://rabet-nafath.api.elm.sa"}
   ```

### `render.yaml` Summary
```yaml
type: web | runtime: node | region: frankfurt
startCommand: node server.js
healthCheckPath: /healthz
plan: standard
NODE_VERSION: "20"
```

Frankfurt region is used for lowest latency to Saudi Arabia / ELM servers.

---

## 17. Known Bugs Fixed

Three bugs were identified and fixed during end-to-end client journey testing:

### Bug 1 — `defer` Race Condition (all pages)

**Problem:** `app.js` was loaded with `<script src="app.js" defer></script>`. Inline page scripts called `App.api()` synchronously at parse time — before `app.js` finished loading — causing `TypeError: App is undefined`. Symptom: projects list showed "تعذّر تحميل الفرص." error.

**Fix:** Removed `defer` from all 27 HTML files. `app.js` now loads synchronously, so `window.App` is available when inline scripts execute.

```html
<!-- Before -->
<script src="app.js" defer></script>
<!-- After -->
<script src="app.js"></script>
```

Also reverted a `DOMContentLoaded` wrapper in `projects.html` that was added as a workaround (no longer needed).

### Bug 2 — Expected Return Shows 0 (`payment.html`)

**Problem:** `payment.html` displayed "العائد المتوقع ٠ ر.س." because it read `_contract.expectedReturn`, but the `contracts` table does not store `expectedReturn` — only the `investments` table does.

**Fix:** Added a client-side fallback calculation in `payment.html`:

```javascript
// Before
document.getElementById('orderExpectedReturn').textContent = App.fmt.sar(_contract.expectedReturn);

// After
const _expRet = _contract.expectedReturn != null
  ? _contract.expectedReturn
  : _contract.amount * (1 + (_contract.profitRate || 0) * (_contract.termMonths || 12) / 12);
document.getElementById('orderExpectedReturn').textContent = App.fmt.sar(_expRet);
```

### Bug 3 — Optional Address Field Incorrectly Required (`verify-address.html`)

**Problem:** The "الرقم الإضافي" (additional number) field had `required` in HTML, but `POST /app/auth/verify-address` does not require it server-side. The form blocked submission if the field was left blank.

**Fix:** Removed `required` attribute and updated placeholder:

```html
<!-- Before -->
<input type="tel" id="additionalNoInput" placeholder="٤٤١٢" maxlength="4" required ... />
<!-- After -->
<input type="tel" id="additionalNoInput" placeholder="٤٤١٢ (اختياري)" maxlength="4" ... />
```

---

## 18. Security Notes

⚠️ **Before going to production, address these:**

1. **Nafath credentials in `server.js`** (lines 35–37) are hardcoded as fallbacks. Move to env-only with no in-code fallback.

2. **`SESSION_SECRET`** defaults to a predictable dev string. Set a random 64-char hex value in production via env var.

3. **`data/db.json`** is a flat file — not suitable for production load. Migrate to a real database (PostgreSQL, etc.).

4. **Dev OTP codes** (`1234` for email, `5678` for mobile) are hardcoded in `lib/api.js`. In production these should be real OTP generation + delivery.

5. **No rate limiting** on auth endpoints — add before going live.

6. **No HTTPS enforcement** in `server.js` — Render handles TLS termination, but verify the `Secure` cookie flag is active (`NODE_ENV=production`).

---

## 19. Test Credentials

Use these for local development and testing:

### New User Registration
| Field | Value |
|-------|-------|
| Name | سلطان التجريبي |
| Email | `test<timestamp>@murabaha.test` |
| Phone | `+966501234567` |
| National ID | `1099887766` |
| Password | `Passw0rd!23` |
| Email OTP | `1234` |
| Mobile OTP | `5678` |

### National Address (KYC Step 4)
| Field | Value |
|-------|-------|
| Building No | `1234` |
| Postal Code | `12345` |
| Street Name | الملك فهد |
| District | العليا |
| City | الرياض |
| Additional No | `5678` (optional) |

### Test Payment Card
| Field | Value |
|-------|-------|
| Name | Sultan Test |
| Card No | `4111 1111 1111 1111` |
| Expiry | `12/29` |
| CVV | `123` |

### Admin Access
The seed data (`data/seed.json`) includes an admin user. Check the seed file for admin credentials. Admin panel: `/admin.html`.

---

*Document generated from live codebase — `/Users/botman/projects/murabaha-platform/` — commit `e1cb79a`.*
