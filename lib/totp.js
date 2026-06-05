/**
 * RFC 6238 TOTP (HMAC-SHA1, 30s step, 6 digits) — zero deps.
 * Used for admin 2FA. Secrets are base32 strings stored on the user record.
 */
'use strict';

const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // RFC 4648 base32

const base32Encode = (buf) => {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  while (out.length % 8) out += '=';
  return out;
};

const base32Decode = (s) => {
  s = (s || '').toUpperCase().replace(/=+$/, '').replace(/[^A-Z2-7]/g, '');
  const bytes = [];
  let bits = 0, value = 0;
  for (const ch of s) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
};

const generateSecret = () => base32Encode(crypto.randomBytes(20)).replace(/=+$/, '');

const hotp = (secret, counter) => {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  // 8-byte big-endian counter
  for (let i = 7; i >= 0; i--) { buf[i] = counter & 0xff; counter = Math.floor(counter / 256); }
  const mac = crypto.createHmac('sha1', key).update(buf).digest();
  const off = mac[mac.length - 1] & 0x0f;
  const code =
    ((mac[off] & 0x7f) << 24) |
    ((mac[off + 1] & 0xff) << 16) |
    ((mac[off + 2] & 0xff) << 8) |
    (mac[off + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
};

const totp = (secret, ts = Date.now()) => hotp(secret, Math.floor(ts / 30_000));

/** Verify against current step and ±1 (±30s) to tolerate clock skew. */
const verifyTotp = (secret, code) => {
  if (!secret || !code) return false;
  const trimmed = String(code).replace(/\s/g, '');
  if (!/^\d{6}$/.test(trimmed)) return false;
  const now = Math.floor(Date.now() / 30_000);
  for (const window of [now - 1, now, now + 1]) {
    if (hotp(secret, window) === trimmed) return true;
  }
  return false;
};

const otpauthUri = (secret, account, issuer = 'Murbha') => {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
};

module.exports = { generateSecret, totp, hotp, verifyTotp, otpauthUri, base32Encode, base32Decode };
