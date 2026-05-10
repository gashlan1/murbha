# منصة مُرابحة — Murabaha Platform

A Saudi Arabia-focused Islamic investment crowdfunding platform.
Built for Vision 2030 — Sharia-compliant, mobile-first, Arabic RTL.

---

## Project Files

### Core App Pages
| File | Description |
|------|-------------|
| `hessa.html` | Main landing page — hero, projects, trust, footer |
| `auth.html` | Sign in / Register — 8 methods including live Nafath API |
| `projects.html` | Browse all investment opportunities |
| `project.html` | Project detail — calculator, Q&A, invest flow |
| `portfolio.html` | Investor dashboard — balance, investments, transactions |
| `profile.html` | Account settings — security, documents, preferences |
| `notifications.html` | Notifications center |
| `help.html` | Help center — WhatsApp, phone, FAQ |
| `contract.html` | Murabaha contract — 10 articles, Nafath e-signature |

### Legal Documents (Standalone Pages)
| File | Description |
|------|-------------|
| `legal.html` | Combined legal hub with tab navigation |
| `privacy.html` | Privacy Policy — PDPL compliant |
| `data-protection.html` | Data Retention & Protection Policy |
| `terms.html` | Terms & Conditions |
| `risk.html` | Risk Disclosure — mandatory CMA-style |
| `sharia.html` | Sharia Fatwa — 4 scholars, 3 contract types |
| `aml.html` | Anti-Money Laundering Policy |
| `kyc.html` | Know Your Customer Policy |
| `complaints.html` | Complaints & Dispute Resolution |
| `cookies.html` | Cookies Policy |

### Backend & API Integration
| File | Description |
|------|-------------|
| `server.js` | Node.js backend — serves static files + secure Nafath proxy |
| `nafath-api.js` | Browser SDK — calls the same-origin proxy (no keys exposed) |
| `package.json` | Node project manifest |
| `.env.example` | Template for credentials & upstream URL |

---

## Nafath API Credentials (Rabet / ELM)
Credentials live **only on the server** in `.env` (never in browser code).
- **App ID / Key:** issued via [rabet.elm.sa](https://rabet.elm.sa)
- **Production upstream:** `https://rabet-nafath.api.elm.sa`
- **Mock / sandbox:** `https://mock-service.api.elm.sa/nafath`

Swap upstream by editing `NAFATH_BASE_URL` in `.env` — no browser code change needed.

## Nafath Integration Flows
1. **MFA Flow** (mobile): `sendMfaRequest()` → show random number → `pollMfaStatus()`
2. **OIDC Flow** (web): `getOidcSession()` → redirect → `getJwt()` → `validateJwt()`

---

## Design System
- **Colors:** Deep green `#062b1e`, Gold `#b08840`, Cream `#fbf6ea`
- **Fonts:** Cairo (display 900), Tajawal (body), Amiri (fatwa quotes)
- **Direction:** RTL Arabic throughout
- **Numerals:** Arabic-Indic (٠١٢٣٤٥٦٧٨٩)
- **Breakpoints:** Mobile-first, `@media (min-width: 768px)` for desktop

## Key Saudi Features
- Nafath national ID verification (live API)
- Arabic-Indic numerals throughout
- Hijri date in header
- Company-focused branding (pre-launch): coming-soon hero + waitlist capture; real opportunities to be announced after regulatory approval
- Saudi payment methods: Mada, Apple Pay, STC Pay, urpay, Sadad
- Sharia board: Sheikh Dr. Abdullah Al-Manea (chair) + 3 scholars
- RTL-first layout with iOS safe area support

## How to Run
Requires **Node.js 18+** (uses native `fetch`).

```bash
# 1. Configure credentials
cp .env.example .env
# edit .env and set NAFATH_APP_ID / NAFATH_APP_KEY / NAFATH_BASE_URL

# 2. Start the server (no npm install needed — zero dependencies)
node server.js

# 3. Open in browser
open http://localhost:3000/hessa.html
```

### Endpoints exposed by `server.js`
| Path | Purpose |
|------|---------|
| `/` (and any `*.html`) | Static front-end pages |
| `/api/v1/mfa/*` | Proxied to ELM — MFA flow |
| `/stg/api/v2/oidc/*` | Proxied to ELM — OIDC web flow |
| `/healthz` | Health probe (returns upstream URL) |

The proxy injects `APP-ID` / `APP-KEY` headers server-side, so the browser never sees credentials and CORS is a non-issue.

---

## Deployment
1. Upload all files to your host (Render, Railway, Fly, VPS, etc.)
2. Set environment variables (`NAFATH_APP_ID`, `NAFATH_APP_KEY`, `NAFATH_BASE_URL`, `PORT`)
3. Start command: `node server.js`
4. Whitelist your server's egress IP in the Rabet portal for production
5. Set `NAFATH_BASE_URL=https://rabet-nafath.api.elm.sa` for production

© 2026 Murabaha Financial — Saudi Arabia 🇸🇦
