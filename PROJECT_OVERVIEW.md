# Murabaha Platform (canonical / git-tracked copy)

## Purpose
Saudi Arabia Sharia-compliant Islamic investment crowdfunding platform ("منصة مُرابحة") aimed at Vision 2030. Provides a public-facing site (landing, projects, portfolio, investor profile), full legal/compliance pages (privacy, PDPL, Sharia fatwa, AML, KYC, risk, terms, complaints, cookies), and a 10-article Murabaha e-contract. Auth integrates with Saudi national Nafath identity (ELM/Rabet) via a server-side proxy.

This is the **canonical, git-tracked** copy of three siblings in `/Users/botman/projects/` (it is the only one with a `.git` directory and a working REST API in `lib/`). See `## Notes` for diffs.

## Tech Stack
- Frontend: vanilla HTML + CSS + JS (no framework). Arabic RTL, mobile-first, Cairo/Tajawal/Amiri fonts.
- Backend: Node.js 18+ pure-stdlib HTTP server (`server.js`), **zero npm dependencies**. Uses native `fetch`.
- REST API: hand-rolled router in `lib/api.js` mounted at `/app/*` with file-backed JSON store (`data/db.json`, seeded from `data/seed.json`) and signed-cookie sessions (`lib/session.js`).
- Nafath integration: server-side proxy injecting `APP-ID`/`APP-KEY` headers to `https://rabet-nafath.api.elm.sa` (MFA + OIDC flows).
- Deploy target: Render (`render.yaml`). PWA via `manifest.webmanifest`.

## Folder Structure
```
murabaha-platform/
├── .git/                       (git-tracked — only this copy has it)
├── .env / .env.example         Nafath credentials
├── .scripts/                   Python SEO/JSON-LD/a11y injectors
├── assets/                     site.css
├── data/                       db.json + seed.json (JSON-flat-file DB)
├── lib/                        api.js, db.js, session.js (REST backend)
├── README.md, DEPLOY.md
├── server.js                   Pure-Node HTTP server (static + proxy + /app API)
├── app.js                      Shared front-end JS
├── nafath-api.js               Browser SDK → calls same-origin proxy
├── render.yaml                 Render deploy blueprint
├── manifest.webmanifest, sitemap.xml, robots.txt, favicon.svg, og-image.svg
└── HTML pages (20):
    Core: hessa.html (landing), auth.html, projects.html, project.html,
          portfolio.html, profile.html, notifications.html, help.html, contract.html
    Legal: legal.html, privacy.html, data-protection.html, terms.html,
           risk.html, sharia.html, aml.html, kyc.html, complaints.html, cookies.html
```

## Key Files / Entry Points
- `/Users/botman/projects/murabaha-platform/server.js` — entry point. Loads `.env`, mounts `lib/api` at `/app/*`, proxies Nafath at `/api/v1/mfa/*` and `/stg/api/v2/oidc/*`, serves static at `/`.
- `/Users/botman/projects/murabaha-platform/lib/api.js` — REST handlers, Arabic error messages, JSON-DB CRUD.
- `/Users/botman/projects/murabaha-platform/lib/db.js` / `lib/session.js` — flat-file DB + signed cookies.
- `/Users/botman/projects/murabaha-platform/nafath-api.js` — browser SDK.
- `/Users/botman/projects/murabaha-platform/hessa.html` — default landing page (server redirects `/` → here).
- `/Users/botman/projects/murabaha-platform/data/seed.json`, `data/db.json` — data store.
- `/Users/botman/projects/murabaha-platform/render.yaml` — deploy blueprint.
- `/Users/botman/projects/murabaha-platform/DEPLOY.md` — step-by-step Render + Rabet whitelist guide.

## How to Run
```bash
cd /Users/botman/projects/murabaha-platform
cp .env.example .env   # already exists; edit if needed
node server.js         # no `npm install` — zero deps
open http://localhost:3000/hessa.html
```
Health check: `GET /healthz`. Outbound IP probe (for Rabet whitelist): `GET /myip`.

## Status
Working, deploy-ready for Render. Nafath credentials are present in `.env` and hard-coded as fallbacks in `server.js` (real-looking `fu5ofq88` APP ID + APP KEY) — these are production secrets in cleartext. Front-end is content-complete (legal pages, Sharia fatwa, contract). Backend is a flat-file JSON store, not a real DB. No tests.

## Notes
- **This is the only one of the three murabaha copies under git** (has `.git/`, `.env`, `assets/`, `data/`, `lib/`, `.scripts/`, `render.yaml`, `DEPLOY.md`, `sitemap.xml`, `robots.txt`, `favicon.svg`, `og-image.svg`, `app.js`).
- Architecturally distinct from `_1` and `_2`: pure-Node `http` server with zero deps and a real REST API at `/app/*`. Sibling copies use Express with a small static-server + stub endpoints.
- Hard-coded Nafath credentials in `server.js` lines 36-37 are a security concern.
- `package.json` declares no dependencies; `"main": "server.js"`.
