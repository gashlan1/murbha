'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SAN = require('../lib/sanctions');

test('Clean name returns clean: true', async () => {
  const r = await SAN.screen({ name: 'Mohammed Al-Sultan', nationality: 'SA' });
  assert.equal(r.ok, true);
  assert.equal(r.clean, true);
  assert.equal(r.hits.length, 0);
});

test('Mock watchlist hit fires', async () => {
  const r = await SAN.screen({ name: 'Test Sanctioned Person', nationality: 'XX' });
  assert.equal(r.clean, false);
  assert.ok(r.hits.length >= 1);
  assert.equal(r.hits[0].category, 'sanctioned');
});

test('PEP category surfaces', async () => {
  const r = await SAN.screen({ name: 'Mock Pep Example', nationality: 'XX' });
  assert.equal(r.clean, false);
  assert.equal(r.hits[0].category, 'pep');
});

test('Provider name reported', async () => {
  const r = await SAN.screen({ name: 'Anyone', nationality: 'SA' });
  assert.equal(r.provider, 'mock');
});
