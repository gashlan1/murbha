# Murabaha Platform — Copy `_1` (Express variant, with node_modules)

## Purpose
A second variant of the Saudi Sharia-compliant Murabaha investment platform. Same product story as the canonical `murabaha-platform/` (Arabic RTL landing, projects, portfolio, profile, full legal pages, Nafath login), but a **different backend implementation** and a different deployment target (Vercel/Netlify vs. Render).

## Tech Stack
- Frontend: same vanilla-HTML+CSS+JS pages as the canonical copy, with extra files: `index.html` (redirect/entry), `shared.css`, `shared.js`, `sw.js` (service worker / PWA), `404.html`, `site.webmanifest`.
- Backend: **Express 4** (`server.js`) with `helmet`, `compression`, `cors`, `morgan`, `dotenv`, `node-fetch`. Real npm dependencies installed in `node_modules/`.
- Deploy: `vercel.json` + `netlify.toml` configs (Vercel/Netlify-targeted, not Render).
- Dev: `nodemon`. No DB layer, no `/app/*` REST API, no Nafath proxy implementation — just static serving + a couple of stub endpoints (`/api/health`, `/api/contact`, `/api/newsletter`).

## Folder Structure
```
murabaha-platform_1/
├── .env.example, .gitignore
├── README.md
├── 404.html, index.html
├── server.js                Express app (security headers, CSP, page routes)
├── package.json / package-lock.json / node_modules/
├── shared.css, shared.js, sw.js, site.webmanifest
├── nafath-api.js            (6 KB — smaller/older than canonical's 13 KB)
├── netlify.toml, vercel.json
└── HTML pages: hessa, auth, projects, project, portfolio, profile,
   notifications, help, contract, legal, privacy, data-protection,
   terms, risk, sharia, aml, kyc, complaints, cookies (same set as canonical)
```

## Key Files / Entry Points
- `/Users/botman/projects/murabaha-platform_1/server.js` — Express entry. Defines a CSP allowing `api.murbha.com`, clean-URL page routes (`/login` → `auth.html`, etc.), and 3 stub API endpoints.
- `/Users/botman/projects/murabaha-platform_1/index.html` — landing entry (not present in canonical).
- `/Users/botman/projects/murabaha-platform_1/shared.css`, `shared.js` — design system + utilities (Toast, Sheet, `toArabic`, `formatCurrency`, etc.). Not present in canonical.
- `/Users/botman/projects/murabaha-platform_1/sw.js` — PWA service worker (canonical has no SW).
- `/Users/botman/projects/murabaha-platform_1/nafath-api.js` — smaller Nafath SDK; no server-side proxy backs it here.

## How to Run
```bash
cd /Users/botman/projects/murabaha-platform_1
npm install       # required — has Express + deps
cp .env.example .env
npm start         # node server.js → http://localhost:3000
# or: npm run dev (nodemon)
```

## Status
Express scaffold with security middleware in place but **no real backend functionality** — Nafath proxy is not implemented server-side (front-end SDK has nothing same-origin to call), and `/api/contact` / `/api/newsletter` are stub `console.log` endpoints with `TODO: integrate with SendGrid/Mailchimp` comments. Front-end is content-complete and richer than canonical (has `shared.css`/`shared.js`/`sw.js`/`index.html`/`404.html`).

## Notes — Relationship to other copies
Per `diff -rq`:
- **NOT a duplicate** of the canonical `murabaha-platform/`. Substantially different:
  - Different backend (Express + deps vs. pure-Node zero-deps).
  - Extra files: `index.html`, `404.html`, `shared.css`, `shared.js`, `sw.js`, `site.webmanifest`, `netlify.toml`, `vercel.json`, `package-lock.json`, `node_modules/`.
  - Missing from canonical: `assets/`, `data/`, `lib/` (no REST API), `.scripts/`, `render.yaml`, `DEPLOY.md`, `app.js`, `sitemap.xml`, `robots.txt`, `favicon.svg`, `og-image.svg`, `.git/`, `.env`.
  - Every shared HTML file differs in content/size from canonical.
- **Compared to `_2`**: identical `server.js`, `package.json`, `README.md`, `.env.example`, `.gitignore`, `404.html`, `index.html`, `shared.css`, `shared.js`, `sw.js`, `site.webmanifest`, `netlify.toml`, `vercel.json`, `package-lock.json`. Every HTML page (auth, projects, hessa, etc.) **differs**. `_2` adds an `app.js` (not in `_1`); `_1` has `node_modules/` (not in `_2`). `nafath-api.js` differs in size (6 KB here vs 13 KB in `_2`).
- Best read as: `_1` and `_2` are two snapshots of the same Express-based fork at different points (likely `_1` is earlier — its `nafath-api.js` is half the size, and it has the installed `node_modules/`); canonical is a separate, more complete pure-Node implementation.
