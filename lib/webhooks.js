/**
 * Outbound webhook dispatcher.
 *
 * Subscriptions live in db.webhooks (admin manages). Each event triggers
 * a POST to every subscribed URL with an HMAC-SHA256 signature header
 * (X-Murbha-Signature) over the JSON body, using the per-subscription
 * `secret` stored on the row.
 *
 * Receivers verify with the same HMAC + their stored secret. Fire-and-
 * forget per send; failures are logged but don't block the request that
 * triggered the event.
 */
'use strict';

const crypto = require('crypto');

const ALLOWED_EVENTS = [
  'user.registered',
  'user.approved',
  'user.rejected',
  'kyc.completed',
  'investment.created',
  'contract.signed',
  'payment.completed',
  'payment.failed',
  'sanctions.hit',
];

const sign = (secret, body) =>
  crypto.createHmac('sha256', secret).update(body).digest('hex');

const dispatch = (db, event, payload) => {
  if (!ALLOWED_EVENTS.includes(event)) return;
  const subs = (db.get().webhooks || []).filter(w => w.events.includes(event) && !w.disabledAt);
  if (!subs.length) return;
  const json = JSON.stringify({ event, ts: new Date().toISOString(), data: payload });
  for (const s of subs) {
    const sig = sign(s.secret, json);
    fetch(s.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Murbha-Signature': sig,
        'X-Murbha-Event': event,
      },
      body: json,
      signal: AbortSignal.timeout(5000),
    }).then(async (r) => {
      if (!r.ok) console.warn(`[webhook] ${event} → ${s.url}: ${r.status}`);
      db.update(d => {
        const row = d.webhooks.find(x => x.id === s.id);
        if (row) { row.lastDeliveredAt = new Date().toISOString(); row.lastStatus = r.status; }
      }).catch(() => {});
    }).catch(e => {
      console.warn(`[webhook] ${event} → ${s.url}: ${e.message}`);
      db.update(d => {
        const row = d.webhooks.find(x => x.id === s.id);
        if (row) { row.lastDeliveryError = e.message; row.lastDeliveredAt = new Date().toISOString(); }
      }).catch(() => {});
    });
  }
};

module.exports = { ALLOWED_EVENTS, sign, dispatch };
