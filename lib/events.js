/**
 * In-process pub/sub for SSE delivery.
 *
 * Routes call `emit(userId, event, data)` after a state change; SSE
 * handlers subscribe with `subscribe(userId, send)` and the server
 * fan-outs to every active connection for that user. Admin connections
 * also receive every event (used for the dashboard live counters).
 *
 * For multi-instance / horizontal scaling: swap this for Redis pub/sub
 * with the same surface — no callsite changes needed.
 */
'use strict';

const _userSubs  = new Map(); // userId → Set<send>
const _adminSubs = new Set(); // Set<send> (each admin connection)

const _safeWrite = (send, payload) => {
  try { send(payload); }
  catch { /* res closed */ }
};

const subscribe = (userId, send, { isAdmin = false } = {}) => {
  if (!_userSubs.has(userId)) _userSubs.set(userId, new Set());
  _userSubs.get(userId).add(send);
  if (isAdmin) _adminSubs.add(send);
  return () => {
    _userSubs.get(userId)?.delete(send);
    _adminSubs.delete(send);
  };
};

const emit = (userId, event, data) => {
  const payload = { event, data, at: Date.now() };
  const subs = _userSubs.get(userId);
  if (subs) for (const s of subs) _safeWrite(s, payload);
  // Admins always see everything (for live dashboard)
  for (const s of _adminSubs) _safeWrite(s, payload);
};

// Broadcast to all admins only.
const broadcastAdmin = (event, data) => {
  const payload = { event, data, at: Date.now() };
  for (const s of _adminSubs) _safeWrite(s, payload);
};

const stats = () => ({
  userCount: _userSubs.size,
  totalConnections: [..._userSubs.values()].reduce((s, set) => s + set.size, 0),
  adminConnections: _adminSubs.size,
});

module.exports = { subscribe, emit, broadcastAdmin, stats };
