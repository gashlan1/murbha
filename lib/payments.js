/**
 * Payment provider abstraction.
 *
 * The active provider is chosen via PAYMENT_PROVIDER (mock|hyperpay|moyasar).
 * Each adapter exposes the same surface so swapping providers is a config
 * change, not a code change.
 *
 * Today the only adapter is `mock`, which:
 *   - simulates a tokenized card (PAN never leaves the request)
 *   - validates the IBAN format (SA + 22 digits) and Luhn-checks card PAN
 *   - mock-approves charges/withdrawals unless the card ends in '0000'
 *
 * To go live: implement hyperpay.js / moyasar.js with the same shape,
 * set PAYMENT_PROVIDER=hyperpay in the Render env, and provide the
 * provider's API keys. No callsite changes needed.
 */
'use strict';

const crypto = require('crypto');

// ── shared helpers ───────────────────────────────────────────────
const stripDigits = (s) => (s || '').replace(/\D/g, '');

// Luhn check for card PANs
const luhn = (pan) => {
  const s = stripDigits(pan);
  if (s.length < 12 || s.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let n = Number(s[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
};

const brandFromPan = (pan) => {
  const s = stripDigits(pan);
  if (/^4/.test(s)) return 'visa';
  if (/^5[1-5]/.test(s) || /^2[2-7]/.test(s)) return 'mastercard';
  if (/^3[47]/.test(s)) return 'amex';
  if (/^(50|56|57|58|6[0-9])/.test(s)) return 'mada';
  return 'card';
};

const maskPan = (pan) => {
  const s = stripDigits(pan);
  if (s.length < 8) return '****';
  return '****' + s.slice(-4);
};

// Saudi IBAN: SA + 2 check + 20 digits (24 total)
const isSaudiIban = (iban) => {
  const s = (iban || '').toUpperCase().replace(/\s/g, '');
  if (!/^SA\d{22}$/.test(s)) return false;
  // ISO 13616 mod-97 check
  const rearranged = s.slice(4) + s.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => (c.charCodeAt(0) - 55).toString());
  let rem = 0;
  for (const ch of numeric) {
    rem = (rem * 10 + Number(ch)) % 97;
  }
  return rem === 1;
};

const maskIban = (iban) => {
  const s = (iban || '').toUpperCase().replace(/\s/g, '');
  if (s.length < 8) return '****';
  return s.slice(0, 4) + ' **** **** **** ' + s.slice(-4);
};

// ── Mock provider ────────────────────────────────────────────────
const mockProvider = {
  name: 'mock',

  // returns { ok, token, brand, last4, expMonth, expYear } | { ok:false, error }
  tokenizeCard: ({ pan, expMonth, expYear, cvv, holder }) => {
    const s = stripDigits(pan);
    if (!luhn(s)) return { ok: false, error: 'invalid_card_number' };
    const m = Number(expMonth), y = Number(expYear);
    if (!(m >= 1 && m <= 12)) return { ok: false, error: 'invalid_expiry' };
    if (!(y >= 2026 && y <= 2050)) return { ok: false, error: 'invalid_expiry' };
    const now = new Date();
    if (y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth() + 1)) {
      return { ok: false, error: 'card_expired' };
    }
    if (!/^\d{3,4}$/.test(String(cvv || ''))) return { ok: false, error: 'invalid_cvv' };
    if (!holder || holder.trim().length < 2) return { ok: false, error: 'invalid_holder' };
    // tokenize: random opaque string; the PAN never leaves this function
    const token = 'tok_' + crypto.randomBytes(16).toString('hex');
    return { ok: true, token, brand: brandFromPan(s), last4: s.slice(-4), expMonth: m, expYear: y };
  },

  // returns { ok, ref } | { ok:false, error }
  charge: ({ token, amount, currency = 'SAR', last4 }) => {
    if (!token || amount <= 0) return { ok: false, error: 'invalid_input' };
    // simulated decline: card last4 == 0000
    if (last4 === '0000') return { ok: false, error: 'declined' };
    return { ok: true, ref: 'ch_' + crypto.randomBytes(10).toString('hex'), processedAt: new Date().toISOString() };
  },

  // returns { ok, ref } | { ok:false, error }
  payout: ({ token, iban, amount, currency = 'SAR' }) => {
    if (!iban && !token) return { ok: false, error: 'invalid_input' };
    if (iban && !isSaudiIban(iban)) return { ok: false, error: 'invalid_iban' };
    if (amount <= 0) return { ok: false, error: 'invalid_amount' };
    return { ok: true, ref: 'po_' + crypto.randomBytes(10).toString('hex'), processedAt: new Date().toISOString() };
  },
};

const PROVIDERS = { mock: mockProvider };
// Lazy-load HyperPay so it never crashes the import for setups without env vars
let _hyperpayLoaded = false;
const provider = () => {
  const name = process.env.PAYMENT_PROVIDER || 'mock';
  if (name === 'hyperpay' && !_hyperpayLoaded) {
    try { PROVIDERS.hyperpay = require('./payments-hyperpay'); _hyperpayLoaded = true; }
    catch (e) { console.error('[payments] failed to load hyperpay adapter:', e.message); }
  }
  return PROVIDERS[name] || mockProvider;
};
// Direct mock access — used by adapters as a fallback when their own creds
// aren't configured. Bypasses the provider env lookup so we don't recurse.
const mockProviderDirect = () => mockProvider;

module.exports = {
  provider,
  mockProvider: mockProviderDirect,
  // utilities reused by routes
  luhn,
  brandFromPan,
  maskPan,
  isSaudiIban,
  maskIban,
  stripDigits,
};
