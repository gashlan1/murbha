# Deploying Murabaha + Nafath to Render

This guide takes you from a fresh local folder to a working live Nafath login.

---

## 1. Push the project to GitHub

```bash
cd /Users/botman/Downloads/murabaha-platform
git init
git add .
git commit -m "Initial: murabaha platform with Nafath proxy"
# Create an empty repo on github.com first, then:
git remote add origin git@github.com:<YOUR_USER>/murabaha-platform.git
git branch -M main
git push -u origin main
```

`.env` is gitignored, so your secrets don't go to GitHub.

---

## 2. Create the service on Render

1. Sign up at https://render.com (free, but plan upgrade required).
2. **New → Blueprint** → connect your GitHub → pick the `murabaha-platform` repo.
3. Render reads `render.yaml` and creates the service.
4. **Important:** upgrade the service to the **Standard** plan ($7/mo). The Free/Starter plans use **shared dynamic IPs** which will not work with Rabet's IP whitelist.

---

## 3. Set environment variables on Render

In the service dashboard → **Environment**, add:

| Key | Value |
|-----|-------|
| `NAFATH_APP_ID` | `fu5ofq88` |
| `NAFATH_APP_KEY` | `a79fe84a66f34f76bb63dbba04b7eaa2` |
| `NAFATH_BASE_URL` | `https://rabet-nafath.api.elm.sa` |
| `PORT` | `3000` |
| `NODE_VERSION` | `20` |

Save → Render redeploys automatically.

---

## 4. Find your outbound IP

After the first deploy succeeds, in Render:

**Service → Settings → scroll to "Outbound IPs"**

You will see one or more IPv4 addresses, e.g. `35.180.x.x`. Copy them all.

---

## 5. Whitelist the IP in Rabet portal

1. Log in to https://rabet.elm.sa
2. Go to **Subscriptions → Murabaha App** (the one with App ID `fu5ofq88`).
3. Find the **IP Whitelist / القائمة البيضاء للعناوين** section.
4. Add **every** Render outbound IP from step 4.
5. Save. Activation can take a few minutes on ELM's side.

Also confirm on this page:
- **Subscription status = Active / مفعّل** (not Pending)
- **Production environment** is selected (not just sandbox)
- The **service identifier** shown in the portal matches the `SERVICE` constant in `nafath-api.js` (currently `Murabaha_Login` — change in either place if needed).

---

## 6. Verify it works

```bash
# Replace with your actual Render URL
APP=https://murabaha-platform.onrender.com

# Health check
curl $APP/healthz
# → {"ok":true,"upstream":"https://rabet-nafath.api.elm.sa"}

# Real Nafath request (use a real Saudi national ID)
curl -X POST "$APP/api/v1/mfa/request?local=ar&requestId=test-$(date +%s)" \
  -H "Content-Type: application/json" \
  -d '{"nationalId":"1XXXXXXXXX","service":"Murabaha_Login"}'
# → {"transId":"...","random":"42"} on success
```

If you still get `403 Authentication failed`:
- Wait 5–10 minutes after IP whitelist save (ELM cache).
- Re-check the IP list — Render sometimes shows multiple IPs; ALL must be whitelisted.
- Confirm the subscription is **Active** and **Production**, not sandbox-only.

---

## 7. Test the real login flow

Open `https://<your-app>.onrender.com/auth.html` on your **phone** (not desktop — Nafath app will open):

1. Enter your real Saudi national ID (10 digits, starts with 1 or 2).
2. The screen shows a 2-digit random number.
3. The Nafath mobile app pops up with three numbers — tap the matching one.
4. Browser polls `/api/v1/mfa/request/status` every 3 s, completes when status = `COMPLETED`.

Done — you have live Nafath login.
