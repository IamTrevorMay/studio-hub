// Bearer CLOUD_API_KEY gate for routes that front the NAS filesystem.
//
// Every legitimate caller of this API already presents the key
// (supabase/functions/cloud-folders and invite-user send
// `Authorization: Bearer <CLOUD_API_KEY>`); the browser never calls this
// server directly. Fails closed: no key configured server-side → 503,
// wrong/missing bearer → 401.

const crypto = require('crypto');

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

module.exports = function requireCloudKey(req, res, next) {
  const expected = process.env.CLOUD_API_KEY;
  if (!expected) return res.status(503).json({ error: 'CLOUD_API_KEY not configured' });
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !timingSafeEqualStr(token, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
};
