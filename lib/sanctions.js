/**
 * Sanctions / PEP screening.
 *
 * Provider abstraction. Today's only adapter is `mock` which uses a small
 * built-in watchlist for testing. To go live: implement complyadvantage.js
 * or trulioo.js with the same surface and set SANCTIONS_PROVIDER.
 *
 * Triggered automatically when KYC is completed; admins are notified of
 * any hit so they can review before approval.
 *
 * Env:
 *   SANCTIONS_PROVIDER       mock | complyadvantage | trulioo (default: mock)
 *   COMPLYADVANTAGE_API_KEY  ComplyAdvantage REST key
 *   TRULIOO_USERNAME / TRULIOO_PASSWORD
 */
'use strict';

// Mock watchlist — used by the mock adapter so tests can exercise the
// "hit" path without external calls. Don't add real people here.
const MOCK_WATCHLIST = [
  { name: 'Test Sanctioned Person', nationality: 'XX', lists: ['mock-test'] },
  { name: 'Mock Pep Example',       nationality: 'XX', lists: ['mock-pep'], category: 'pep' },
];

const _normName = (s) => (s || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '') // strip combining marks
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s]/gu, '')
  .replace(/\s+/g, ' ')
  .trim();

// Jaro-Winkler-ish fuzzy match (simplified): name token overlap ratio.
const _fuzzyScore = (a, b) => {
  const ta = new Set(_normName(a).split(' '));
  const tb = new Set(_normName(b).split(' '));
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  ta.forEach(t => { if (tb.has(t)) common++; });
  return common / Math.max(ta.size, tb.size);
};

// ── Mock adapter ────────────────────────────────────────────────
const mockScreen = async ({ name, nationality, dob }) => {
  const hits = [];
  for (const entry of MOCK_WATCHLIST) {
    const score = _fuzzyScore(name, entry.name);
    if (score >= 0.7) {
      hits.push({
        match: entry.name,
        score: Math.round(score * 100) / 100,
        lists: entry.lists,
        category: entry.category || 'sanctioned',
      });
    }
  }
  return {
    ok: true,
    provider: 'mock',
    checkedAt: new Date().toISOString(),
    hits,
    clean: hits.length === 0,
  };
};

// ── ComplyAdvantage stub ────────────────────────────────────────
// Real wire-up: POST https://api.complyadvantage.com/searches with
// fuzziness + lists + filters. See docs.complyadvantage.com.
const complyadvantageScreen = async ({ name, nationality, dob }) => {
  const key = process.env.COMPLYADVANTAGE_API_KEY;
  if (!key) {
    console.warn('[sanctions] COMPLYADVANTAGE_API_KEY missing; using mock');
    return mockScreen({ name, nationality, dob });
  }
  try {
    const r = await fetch('https://api.complyadvantage.com/searches?api_key=' + encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        search_term: name,
        fuzziness: 0.5,
        filters: { types: ['sanction', 'warning', 'pep'] },
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { ok: false, provider: 'complyadvantage', error: data?.message || 'request_failed', hits: [], clean: false };
    }
    const hits = (data?.content?.data?.hits || []).map(h => ({
      match: h.doc?.name,
      score: h.match_status === 'true_positive' ? 1.0 : 0.85,
      lists: (h.doc?.types || []).map(String),
      category: (h.doc?.types || []).includes('pep') ? 'pep' : 'sanctioned',
      complyId: h.doc?.id,
    }));
    return { ok: true, provider: 'complyadvantage', checkedAt: new Date().toISOString(), hits, clean: hits.length === 0 };
  } catch (e) {
    console.error('[sanctions-comply] error:', e.message);
    return { ok: false, provider: 'complyadvantage', error: e.message, hits: [], clean: false };
  }
};

const screen = (input) => {
  const p = process.env.SANCTIONS_PROVIDER || 'mock';
  if (p === 'complyadvantage') return complyadvantageScreen(input);
  return mockScreen(input);
};

module.exports = { screen };
