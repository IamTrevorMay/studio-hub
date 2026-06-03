// Per-recipient open + click tracking. Public endpoint.
//
//   GET /api/emails/track?t=<token>&p=1            → records open, returns 1x1 GIF
//   GET /api/emails/track?t=<token>&u=<encoded>     → records click, 302 to <u>
//
// Token covers (send_id, subscriber_id) so a recipient can't fabricate
// events for other recipients.

const { createServiceClient } = require('../_lib/emails/auth');
const { verifyRecipientToken } = require('../_lib/emails/tokens');

const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'
);

module.exports = async (req, res) => {
  // CORS not needed — these are loaded by email clients directly.
  if (req.method !== 'GET') {
    res.status(405).end('Method not allowed');
    return;
  }
  const q = req.query || {};
  const token = q.t;
  const verified = verifyRecipientToken(token);
  if (!verified) {
    sendPixel(res);
    return;
  }

  let admin;
  try {
    admin = createServiceClient();
  } catch {
    sendPixel(res);
    return;
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;
  const ua = req.headers['user-agent'] || null;

  if (q.p === '1') {
    // Open
    try {
      await admin.from('email_events').insert({
        send_id: verified.sendId,
        subscriber_id: verified.subscriberId,
        type: 'opened',
        ip, user_agent: ua,
      });
    } catch { /* ignore */ }
    sendPixel(res);
    return;
  }

  if (q.u) {
    // Click — record then redirect
    const target = String(q.u);
    try {
      await admin.from('email_events').insert({
        send_id: verified.sendId,
        subscriber_id: verified.subscriberId,
        type: 'clicked',
        url: target,
        ip, user_agent: ua,
      });
    } catch { /* ignore */ }
    if (!/^https?:\/\//i.test(target)) {
      res.status(400).end('Bad target');
      return;
    }
    res.statusCode = 302;
    res.setHeader('Location', target);
    res.setHeader('Cache-Control', 'no-store');
    res.end();
    return;
  }

  sendPixel(res);
};

function sendPixel(res) {
  res.status(200);
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.end(PIXEL);
}
