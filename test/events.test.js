'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const EV = require('../lib/events');

test('subscribe + emit delivers to that user only', () => {
  const u1 = [], u2 = [];
  const r1 = EV.subscribe('u1', (p) => u1.push(p));
  const r2 = EV.subscribe('u2', (p) => u2.push(p));
  EV.emit('u1', 'test', { x: 1 });
  assert.equal(u1.length, 1);
  assert.equal(u1[0].event, 'test');
  assert.deepEqual(u1[0].data, { x: 1 });
  assert.equal(u2.length, 0);
  r1(); r2();
});

test('admin subscribers receive all events', () => {
  const admin = [];
  const user = [];
  const ra = EV.subscribe('admin1', (p) => admin.push(p), { isAdmin: true });
  const ru = EV.subscribe('user1', (p) => user.push(p));
  EV.emit('user1', 'notification', { foo: 1 });
  assert.equal(user.length, 1);
  assert.equal(admin.length, 1);
  ra(); ru();
});

test('release stops delivery', () => {
  const got = [];
  const r = EV.subscribe('u', (p) => got.push(p));
  EV.emit('u', 'e', {});
  assert.equal(got.length, 1);
  r();
  EV.emit('u', 'e', {});
  assert.equal(got.length, 1);
});

test('stats returns connection counts', () => {
  const r1 = EV.subscribe('s1', () => {});
  const r2 = EV.subscribe('s1', () => {});
  const r3 = EV.subscribe('s2', () => {});
  const s = EV.stats();
  assert.ok(s.totalConnections >= 3);
  r1(); r2(); r3();
});
