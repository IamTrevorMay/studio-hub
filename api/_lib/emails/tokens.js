// Per-subscriber unsubscribe token + per-recipient click/open tokens.
// HMAC-SHA256 keyed with EMAIL_LINK_SECRET. Verified on the inbound
// tracking endpoints so links don't have to round-trip through the DB.

const crypto = require('crypto');

function getSecret() {
  const s = process.env.EMAIL_LINK_SECRET;
  if (!s) throw new Error('EMAIL_LINK_SECRET not set');
  return s;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signParts(parts) {
  const payload = parts.join('.');
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest();
  return `${payload}.${b64url(sig)}`;
}

function verifyParts(token, expectedPartCount) {
  if (!token || typeof token !== 'string') return null;
  const segs = token.split('.');
  if (segs.length !== expectedPartCount + 1) return null;
  const sig = segs.pop();
  const payload = segs.join('.');
  const want = b64url(crypto.createHmac('sha256', getSecret()).update(payload).digest());
  if (!safeEq(sig, want)) return null;
  return segs;
}

function safeEq(a, b) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Unsubscribe — token covers subscriber_id only
function makeUnsubToken(subscriberId) {
  return signParts(['u', subscriberId]);
}
function verifyUnsubToken(token) {
  const parts = verifyParts(token, 2);
  if (!parts || parts[0] !== 'u') return null;
  return parts[1];
}

// Click/Open — token covers send_id + subscriber_id
function makeRecipientToken(sendId, subscriberId) {
  return signParts(['r', sendId, subscriberId]);
}
function verifyRecipientToken(token) {
  const parts = verifyParts(token, 3);
  if (!parts || parts[0] !== 'r') return null;
  return { sendId: parts[1], subscriberId: parts[2] };
}

module.exports = {
  makeUnsubToken, verifyUnsubToken,
  makeRecipientToken, verifyRecipientToken,
};
