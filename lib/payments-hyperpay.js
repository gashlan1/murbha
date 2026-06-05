/**
 * HyperPay payment adapter — matches the surface of lib/payments.js mock.
 *
 * Activated when PAYMENT_PROVIDER=hyperpay AND the required env vars are set:
 *   HYPERPAY_BASE_URL      e.g. https://eu-test.oppwa.com (sandbox)
 *                          or  https://eu-prod.oppwa.com (production)
 *   HYPERPAY_ACCESS_TOKEN  Bearer token from HyperPay dashboard
 *   HYPERPAY_ENTITY_ID     Merchant entity ID
 *
 * Flow (simplified):
 *   tokenizeCard → POST /v1/registrations (server-to-server tokenization,
 *                  PAN/CVV never persisted by us)
 *   charge       → POST /v1/payments      (paymentType=DB, uses registration token)
 *   payout       → POST /v1/payments      (paymentType=CD for credit-to-card)
 *                  In KSA, bank payouts (IBAN) typically go through a separate
 *                  rail (mada / SARIE) — we return ok in the dev adapter and
 *                  flag this clearly for the production integration.
 *
 * Lazy-loaded by lib/payments.js when the provider switches to "hyperpay".
 * Falls back to mock behavior when the required env vars are missing, so
 * mis-configuration in production is loud (logs) but not crashy.
 */
'use strict';

const crypto = require('crypto');
const mock = require('./payments');

const cfg = () => ({
  base:   process.env.HYPERPAY_BASE_URL || '',
  token:  process.env.HYPERPAY_ACCESS_TOKEN || '',
  entity: process.env.HYPERPAY_ENTITY_ID || '',
});

const hpEnabled = () => {
  const c = cfg();
  return !!(c.base && c.token && c.entity);
};

const _post = async (path, params) => {
  const c = cfg();
  const body = new URLSearchParams({ entityId: c.entity, ...params });
  const r = await fetch(c.base + path, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + c.token,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: body.toString(),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
};

// Result codes that HyperPay considers successful (per their docs).
const SUCCESS_RE = /^(000\.000\.|000\.100\.1|000\.[36])/;

// ── tokenizeCard ────────────────────────────────────────────────
const tokenizeCard = async ({ pan, expMonth, expYear, cvv, holder }) => {
  if (!hpEnabled()) {
    console.warn('[hyperpay] env vars missing; using mock tokenization');
    return mock.mockProvider().tokenizeCard({ pan, expMonth, expYear, cvv, holder });
  }
  // Validate inputs with the same rules as mock first, then send to HyperPay.
  if (!mock.luhn(pan)) return { ok: false, error: 'invalid_card_number' };
  const res = await _post('/v1/registrations', {
    paymentBrand: mock.brandFromPan(pan).toUpperCase(),
    'card.number': mock.stripDigits(pan),
    'card.expiryMonth': String(expMonth).padStart(2, '0'),
    'card.expiryYear': String(expYear),
    'card.cvv': String(cvv || ''),
    'card.holder': (holder || '').trim(),
  });
  const code = res.data?.result?.code || '';
  if (!res.ok || !SUCCESS_RE.test(code)) {
    return { ok: false, error: code || 'tokenize_failed', detail: res.data?.result?.description };
  }
  return {
    ok: true,
    token: res.data.id,          // registration ID — opaque, single-merchant
    brand: mock.brandFromPan(pan),
    last4: mock.stripDigits(pan).slice(-4),
    expMonth: Number(expMonth),
    expYear: Number(expYear),
  };
};

// ── charge ─────────────────────────────────────────────────────
const charge = async ({ token, amount, currency = 'SAR', last4 }) => {
  if (!hpEnabled()) {
    console.warn('[hyperpay] env vars missing; using mock charge');
    return mock.mockProvider().charge({ token, amount, currency, last4 });
  }
  if (!token || amount <= 0) return { ok: false, error: 'invalid_input' };
  const res = await _post(`/v1/registrations/${encodeURIComponent(token)}/payments`, {
    amount: amount.toFixed(2),
    currency,
    paymentType: 'DB', // debit
  });
  const code = res.data?.result?.code || '';
  if (!res.ok || !SUCCESS_RE.test(code)) {
    return {
      ok: false,
      error: code === '800.100.151' || code === '800.100.156' ? 'declined' : (code || 'charge_failed'),
      detail: res.data?.result?.description,
    };
  }
  return {
    ok: true,
    ref: res.data.id,
    processedAt: res.data.timestamp || new Date().toISOString(),
  };
};

// ── payout ─────────────────────────────────────────────────────
// IBAN payouts in KSA usually go through SARIE / a different rail. The
// production wire here is intentionally a stub: it returns ok with a
// generated reference but flags that the actual rail must be wired in
// production. Use a treasury / batch-file integration when going live.
const payout = async ({ iban, amount, currency = 'SAR' }) => {
  if (!hpEnabled()) {
    return mock.mockProvider().payout({ iban, amount, currency });
  }
  if (!iban || !mock.isSaudiIban(iban)) return { ok: false, error: 'invalid_iban' };
  if (amount <= 0) return { ok: false, error: 'invalid_amount' };
  console.warn('[hyperpay] payout: production rail not wired — recording pending request only');
  return {
    ok: true,
    ref: 'po_hp_pending_' + crypto.randomBytes(8).toString('hex'),
    processedAt: new Date().toISOString(),
    note: 'queued; bank transfer rail (SARIE) is the actual payout path',
  };
};

module.exports = { name: 'hyperpay', tokenizeCard, charge, payout, hpEnabled };
