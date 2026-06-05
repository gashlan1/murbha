/**
 * Web Push (VAPID) skeleton.
 *
 * On-device flow: the service worker subscribes to push, POSTs the
 * PushSubscription to /app/push/subscribe; the server stores the
 * subscription for that user. Sending a push from the server requires
 * encrypting the payload with the subscription's keys and POSTing to
 * the push endpoint with a VAPID-signed Authorization header.
 *
 * Full encryption per RFC 8291 is ~150 lines of crypto. To keep this
 * skeleton dependency-free for now, `sendPush` is a dry-run that logs
 * the message. Wire `web-push` (npm) or implement RFC 8291 directly
 * before production.
 *
 * Env:
 *   VAPID_PUBLIC_KEY   base64url-encoded P-256 public key
 *   VAPID_PRIVATE_KEY  base64url-encoded P-256 private key
 *   VAPID_SUBJECT      mailto: or https: URL identifying the sender
 *
 * Generate a keypair with:
 *   node -e "const c=require('crypto');const k=c.generateKeyPairSync('ec',{namedCurve:'P-256'});
 *   const pub=k.publicKey.export({format:'jwk'});const prv=k.privateKey.export({format:'jwk'});
 *   const b64u=s=>Buffer.from(s,'base64').toString('base64url');
 *   console.log('PUBLIC:', b64u(Buffer.concat([Buffer.from([0x04]),Buffer.from(pub.x,'base64'),Buffer.from(pub.y,'base64')]).toString('base64')));
 *   console.log('PRIVATE:', prv.d);"
 */
'use strict';

const isConfigured = () =>
  !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);

const publicKey = () => process.env.VAPID_PUBLIC_KEY || '';

const sendPush = async ({ subscription, payload }) => {
  if (!isConfigured()) {
    console.log('[push] (dry-run; VAPID not configured) →', subscription?.endpoint?.slice(0, 60), payload);
    return { ok: true, dryRun: true };
  }
  // Production: replace with web-push library OR an RFC 8291 implementation.
  // The wire-up is intentional dry-run while the project is pre-launch so
  // we don't ship half-implemented payload encryption.
  console.warn('[push] VAPID configured but encryption not implemented; logging only');
  console.log('[push]', subscription?.endpoint?.slice(0, 60), payload);
  return { ok: true, dryRun: true, note: 'wire web-push or RFC 8291 before production' };
};

module.exports = { isConfigured, publicKey, sendPush };
