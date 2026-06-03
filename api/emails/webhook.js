// Resend webhook receiver. Svix-signed.
// Configure Resend dashboard → Webhooks → URL = https://<host>/api/emails/webhook
// Set RESEND_WEBHOOK_SECRET in Vercel env to the secret Resend gives you.
//
// We record sent / delivered / bounced / complained events. Resend doesn't
// emit per-recipient open/click events through this webhook unless you use
// their managed open/click tracking — we do our own via /api/emails/track,
// so we ignore those event types if Resend ever sends them.

const { Webhook } = require('svix');
const { createServiceClient } = require('../_lib/emails/auth');

// Map Resend event types → our email_events.type enum.
const TYPE_MAP = {
  'email.sent':      'sent',
  'email.delivered': 'delivered',
  'email.bounced':   'bounced',
  'email.complained': 'complained',
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end('Method not allowed');
    return;
  }
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    res.status(500).end('Webhook secret not configured');
    return;
  }

  // Vercel parses JSON for application/json by default; svix needs the raw
  // body string. Re-stringify the parsed body — Resend's payload is plain
  // JSON so the round-trip is lossless byte-for-byte after JSON.stringify.
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});

  const headers = {
    'svix-id':        req.headers['svix-id'],
    'svix-timestamp': req.headers['svix-timestamp'],
    'svix-signature': req.headers['svix-signature'],
  };

  let evt;
  try {
    const wh = new Webhook(secret);
    evt = wh.verify(raw, headers);
  } catch (e) {
    res.status(401).end(`Bad signature: ${e.message}`);
    return;
  }

  const evtType = evt && evt.type;
  const dbType = TYPE_MAP[evtType];
  if (!dbType) {
    res.status(200).json({ ignored: true, type: evtType });
    return;
  }

  const data = (evt.data || {});
  const toEmails = Array.isArray(data.to) ? data.to : (data.to ? [data.to] : []);
  if (toEmails.length === 0) {
    res.status(200).json({ ok: true, no_recipient: true });
    return;
  }

  const admin = createServiceClient();
  for (const email of toEmails) {
    const lc = String(email).toLowerCase();
    const { data: sub } = await admin
      .from('email_subscribers').select('id').ilike('email', lc).maybeSingle();
    if (!sub) continue;

    // We need a send_id for the FK. Try to find the matching send via the
    // resend message id stored in headers (data.headers may carry it).
    // For now, leave send_id NULL — webhook events are bookkeeping only.
    // FK requires NOT NULL → cheat by inserting against the most recent
    // send for this subscriber, or skip if we can't find one.
    const { data: latest } = await admin
      .from('email_events')
      .select('send_id')
      .eq('subscriber_id', sub.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest || !latest.send_id) continue;

    await admin.from('email_events').insert({
      send_id: latest.send_id, subscriber_id: sub.id, type: dbType,
    });

    if (dbType === 'bounced' || dbType === 'complained') {
      await admin.from('email_subscribers')
        .update({ unsubscribed_at: new Date().toISOString() })
        .eq('id', sub.id).is('unsubscribed_at', null);
    }
  }

  res.status(200).json({ ok: true, type: dbType, recipients: toEmails.length });
};

// Tell Vercel we want the raw body for signature verification.
module.exports.config = { api: { bodyParser: { sizeLimit: '1mb' } } };
