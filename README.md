# منصة مُرابحة — Murbaha Investment Platform

> A Saudi Sharia-compliant investment platform for Vision 2030 projects — start from SAR 500

---

## Quick Start

Requires Node 18+ and PostgreSQL. The app uses Postgres for username/password
auth (httpOnly cookie sessions), so a database must be running.

```bash
# 1. Copy environment variables
cp .env.example .env

# 2. Start PostgreSQL (local dev via docker-compose)
docker compose up -d db

# 3. Install dependencies
npm install

# 4. Apply the database schema
npm run migrate

# 5. Start the server
npm start
# → http://localhost:3000

# Development (auto-reload)
npm run dev
```

Or run the whole stack (app + database) in containers:

```bash
docker compose up --build
```

> Deploy target: a Node host with PostgreSQL (Render / Railway / Fly / docker).
> Static-only hosting (Netlify/Vercel static) can preview the front end but
> cannot run `/api/auth`.

---

## Project Structure

```
murabaha-platform/
│
├── ─── Core Pages ───────────────────────────────
│   ├── index.html              Entry point (redirects to hessa.html)
│   ├── hessa.html              🏠 Main landing page
│   ├── auth.html               🔐 Sign in / Register (8 methods)
│   ├── projects.html           📋 Browse investment opportunities
│   ├── project.html            📊 Project detail + invest flow
│   ├── portfolio.html          💼 Investor dashboard
│   ├── profile.html            👤 Account settings
│   ├── notifications.html      🔔 Notifications center
│   ├── help.html               💬 Help & FAQ
│   ├── contract.html           📄 Murabaha contract + e-sign
│   └── 404.html                ❌ Not found page
│
├── ─── Legal Pages ──────────────────────────────
│   ├── legal.html              Hub — all legal docs
│   ├── privacy.html            Privacy Policy (PDPL)
│   ├── data-protection.html    Data Retention Policy
│   ├── terms.html              Terms & Conditions
│   ├── risk.html               Risk Disclosure
│   ├── sharia.html             Sharia Fatwa
│   ├── aml.html                Anti-Money Laundering
│   ├── kyc.html                Know Your Customer
│   ├── complaints.html         Complaints Policy
│   └── cookies.html            Cookies Policy
│
├── ─── Shared Assets ────────────────────────────
│   ├── shared.css              Design system (variables, components)
│   ├── shared.js               Common utilities (toast, sheet, nav)
│   └── 
│
├── ─── Infrastructure ───────────────────────────
│   ├── server.js               Express server (API proxy, routing)
│   ├── sw.js                   Service Worker (offline/PWA)
│   ├── site.webmanifest        PWA manifest
│   ├── package.json            Dependencies & scripts
│   ├── .env.example            Environment variables template
│   ├── vercel.json             Vercel deployment config
│   └── netlify.toml            Netlify deployment config
```

---

## Features

### Authentication (auth.html)
8 sign-in/register methods:
- **Nafath** — live API (MFA + OIDC web flows)
- **Absher** — government portal
- **Phone + OTP** — SMS verification
- **Email + Password** — with show/hide toggle
- **Face ID / Biometric** — native WebAuthn
- **Apple ID** — Sign in with Apple
- **Google** — Sign in with Google
- **QR Code** — scan to login
- **Invitation code** — referral with SAR 25 bonus

### Nafath API Integration (
```js
// MFA Flow
const { random } = await NafathAPI.sendMfaRequest('1000000000');
// → show random number to user in Nafath app
const cancel = NafathAPI.pollMfaStatus({
  onCompleted: () => redirect('/portfolio'),
  onRejected:  err => toast.error(err.nameAr),
});

// OIDC Web Flow
const { url } = await NafathAPI.getOidcSession();
window.location.href = url; // redirect to Nafath
// On callback:
await NafathAPI.handleOidcCallback({ onSuccess: ({ token }) => saveToken(token) });
```

### Design System (shared.css)
- CSS variables: green/gold palette, safe areas, breakpoints
- Components: cards, buttons, pills, progress bars, callouts, sheets
- Tab bar, sticky header, toasts, spinners
- RTL-first, Arabic-Indic numerals
- Responsive: mobile-first → 768px desktop breakpoint

### Shared Utilities (shared.js)
```js
Toast.success('تم الحفظ');      // Green toast
Toast.error('حدث خطأ');         // Red toast
Sheet.open('nafath-login');      // Open bottom sheet
openSheet('name') / closeSheet() // Global shorthand
toArabic(1234)                   // → '١٢٣٤'
formatCurrency(25000)            // → '٢٥,٠٠٠ ر.س'
shareProject('روشن')             // Native share API
copyToClipboard(text)            // Clipboard API
```

---

