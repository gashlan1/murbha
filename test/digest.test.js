'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../lib/digest');

const mkDb = (rows) => ({
  all: (t) => rows[t] || [],
  filter: (t, fn) => (rows[t] || []).filter(fn),
});

test('summary counts pending approval (kyc verified, !approved, !rejected)', () => {
  const db = mkDb({
    users: [
      { id: 'u1', role: 'investor', approved: false, rejected: false, kycStatus: 'verified', createdAt: new Date().toISOString(), name: 'A', email: 'a@x' },
      { id: 'u2', role: 'investor', approved: true,  rejected: false, kycStatus: 'verified', createdAt: new Date().toISOString() },
      { id: 'u3', role: 'investor', approved: false, rejected: true,  kycStatus: 'verified', createdAt: new Date().toISOString() },
      { id: 'a1', role: 'admin',    approved: false, rejected: false, kycStatus: 'verified', createdAt: new Date().toISOString() },
    ],
    investments: [],
  });
  const s = D.buildSummary(db);
  assert.equal(s.pendingApprovalCount, 1);
});

test('summary counts pending qualifications', () => {
  const db = mkDb({
    users: [
      { id: 'u1', role: 'investor', qualificationRequest: { status: 'pending' }, createdAt: new Date().toISOString() },
      { id: 'u2', role: 'investor', qualificationRequest: { status: 'approved' }, createdAt: new Date().toISOString() },
    ],
    investments: [],
  });
  const s = D.buildSummary(db);
  assert.equal(s.pendingQualifyCount, 1);
});

test('summary counts unreviewed sanctions hits', () => {
  const db = mkDb({
    users: [
      { id: 'u1', role: 'investor', sanctionsScreen: { clean: false }, createdAt: new Date().toISOString() },
      { id: 'u2', role: 'investor', sanctionsScreen: { clean: false }, sanctionsReviewedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
      { id: 'u3', role: 'investor', sanctionsScreen: { clean: true },  createdAt: new Date().toISOString() },
    ],
    investments: [],
  });
  const s = D.buildSummary(db);
  assert.equal(s.sanctionsHitsCount, 1);
});

test('summary counts 24h investments', () => {
  const now = Date.now();
  const db = mkDb({
    users: [],
    investments: [
      { amount: 5000, createdAt: new Date(now - 60_000).toISOString() },
      { amount: 1000, createdAt: new Date(now - 30 * 60_000).toISOString() },
      { amount: 99999, createdAt: new Date(now - 48 * 3600_000).toISOString() }, // 48h ago
    ],
  });
  const s = D.buildSummary(db);
  assert.equal(s.recentInvestmentsCount, 2);
  assert.equal(s.recentInvestmentsSum, 6000);
});
