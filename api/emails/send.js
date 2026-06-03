// Send an email blast. Admin only.
//
//   POST /api/emails/send
//     {
//       template_id,
//       audience_id?,           // omit if test_emails is supplied
//       test_emails?: string[], // ad-hoc test recipients
//       subject_override?,
//       scheduled_at?           // ISO timestamp; if future, just persists + bails (cron drains)
//     }
//
//   Returns { send: <row>, sent, failed }.
//
//   For sends > MAX_SYNC recipients, returns 202 with status=sending and
//   spawns no further work — the cron drainer will catch the unfinished
//   row on its next pass. (Vercel hobby tier has a 60s fn cap.)

const { Resend } = require('resend');
const { requireAdmin, json, applyCors, createServiceClient } = require('../_lib/emails/auth');
const { renderEmail } = require('../_lib/emails/renderEmail');
const { resolveAllBindings } = require('../_lib/emails/resolveBindings');
const { injectTracking, buildBaseUrl } = require('../_lib/emails/trackInject');
const { makeUnsubToken } = require('../_lib/emails/tokens');

const MAX_SYNC = 200;

module.exports = async (req, res) => {
  applyCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const { user, admin } = ctx;

  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    if (!body.template_id) return json(res, 400, { error: 'template_id required' });
    if (!body.audience_id && !(Array.isArray(body.test_emails) && body.test_emails.length > 0)) {
      return json(res, 400, { error: 'audience_id or test_emails[] required' });
    }

    const { data: tpl, error: tplErr } = await admin
      .from('email_templates').select('*').eq('id', body.template_id).maybeSingle();
    if (tplErr) throw tplErr;
    if (!tpl) return json(res, 404, { error: 'template not found' });

    const { data: product } = await admin
      .from('email_products').select('*').eq('id', tpl.product_id).maybeSingle();
    if (!product) return json(res, 404, { error: 'product not found' });

    const subject = body.subject_override || tpl.subject || '(no subject)';
    const settings = (product.settings && product.settings.template) || {};
    const branding = (product.settings && product.settings.branding) || {};

    // Create send row first so we have an id for tracking links.
    const scheduledAt = body.scheduled_at ? new Date(body.scheduled_at).toISOString() : null;
    const future = scheduledAt && new Date(scheduledAt).getTime() > Date.now() + 60_000;

    const { data: sendRow, error: insErr } = await admin
      .from('email_sends').insert({
        product_id: tpl.product_id,
        template_id: tpl.id,
        audience_id: body.audience_id || null,
        subject,
        status: future ? 'scheduled' : 'sending',
        scheduled_at: scheduledAt,
        recipient_count: 0,
        created_by: user.id,
      }).select().single();
    if (insErr) throw insErr;

    if (future) {
      return json(res, 200, { send: sendRow, scheduled: true });
    }

    const result = await drainSend(admin, sendRow, {
      product, tpl, subject, settings, branding,
      testEmails: body.test_emails || null,
      req,
    });
    return json(res, 200, { send: result.send, sent: result.sent, failed: result.failed });
  } catch (e) {
    return json(res, 500, { error: e.message || String(e) });
  }
};

// Exposed so the cron drainer can call into the exact same path.
async function drainSend(admin, sendRow, opts) {
  const { product, tpl, subject, settings, branding, testEmails, req } = opts;

  const recipients = testEmails
    ? await materializeTestRecipients(admin, testEmails)
    : await fetchAudienceRecipients(admin, sendRow.audience_id);

  if (recipients.length === 0) {
    await admin.from('email_sends').update({
      status: 'sent', sent_at: new Date().toISOString(), recipient_count: 0,
    }).eq('id', sendRow.id);
    return { send: sendRow, sent: 0, failed: 0 };
  }

  await admin.from('email_sends').update({
    status: 'sending',
    recipient_count: recipients.length,
  }).eq('id', sendRow.id);

  const fromName = branding.fromName || product.name || 'Mayday';
  const fromEmail = branding.fromEmail || process.env.RESEND_FROM_EMAIL;
  if (!fromEmail) {
    await admin.from('email_sends').update({
      status: 'failed',
      error_message: 'RESEND_FROM_EMAIL not configured (or branding.fromEmail missing)',
    }).eq('id', sendRow.id);
    throw new Error('RESEND_FROM_EMAIL not configured');
  }
  const replyTo = branding.replyTo || null;
  const from = `${fromName} <${fromEmail}>`;

  const resend = new Resend(process.env.RESEND_API_KEY);
  if (!process.env.RESEND_API_KEY) {
    await admin.from('email_sends').update({
      status: 'failed', error_message: 'RESEND_API_KEY missing',
    }).eq('id', sendRow.id);
    throw new Error('RESEND_API_KEY missing');
  }

  // Resolve bindings once for the whole send (RSS feed for all recipients).
  const data = await resolveAllBindings(Array.isArray(tpl.blocks) ? tpl.blocks : []);
  const baseHtml = renderEmail({
    blocks: Array.isArray(tpl.blocks) ? tpl.blocks : [],
    branding,
    settings,
    data,
    subject,
    date: new Date().toISOString().slice(0, 10),
    unsubscribeUrl: '__UNSUB__', // per-recipient swap below
  });
  const baseUrl = buildBaseUrl(req);

  let sent = 0, failed = 0;
  const eventRows = [];

  // Honor MAX_SYNC for cold sends; the cron drainer will be invoked per
  // batch separately.
  const batch = recipients.slice(0, MAX_SYNC);
  const remainder = recipients.length - batch.length;

  for (const r of batch) {
    const unsubToken = makeUnsubToken(r.id);
    const unsubUrl = `${baseUrl}/api/emails/unsubscribe?t=${unsubToken}`;
    let html = baseHtml.replace(/__UNSUB__/g, unsubUrl);
    html = injectTracking(html, sendRow.id, r.id, { baseUrl });

    try {
      const result = await resend.emails.send({
        from,
        to: [r.email],
        subject,
        html,
        reply_to: replyTo || undefined,
        headers: {
          'List-Unsubscribe': `<${unsubUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      });
      if (result.error) throw new Error(result.error.message || String(result.error));
      eventRows.push({ send_id: sendRow.id, subscriber_id: r.id, type: 'sent' });
      sent++;
    } catch (e) {
      eventRows.push({ send_id: sendRow.id, subscriber_id: r.id, type: 'bounced' });
      failed++;
      // eslint-disable-next-line no-console
      console.error('[emails/send] resend failed for', r.email, ':', e.message);
    }
  }

  if (eventRows.length > 0) {
    // Chunk in case the page is large.
    for (let i = 0; i < eventRows.length; i += 500) {
      await admin.from('email_events').insert(eventRows.slice(i, i + 500));
    }
  }

  const final = remainder > 0 ? 'sending' : 'sent';
  await admin.from('email_sends').update({
    status: final,
    sent_at: remainder > 0 ? null : new Date().toISOString(),
  }).eq('id', sendRow.id);

  return { send: { ...sendRow, status: final, sent_at: remainder > 0 ? null : new Date().toISOString() }, sent, failed };
}

async function fetchAudienceRecipients(admin, audienceId) {
  if (!audienceId) return [];
  const { data, error } = await admin
    .from('email_audience_members')
    .select('email_subscribers!inner(id, email, unsubscribed_at)')
    .eq('audience_id', audienceId);
  if (error) throw error;
  const rows = (data || [])
    .map((m) => m.email_subscribers)
    .filter((s) => s && s.email && !s.unsubscribed_at);
  // De-dup by id (safety).
  const seen = new Set();
  return rows.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

async function materializeTestRecipients(admin, emails) {
  const out = [];
  for (const raw of emails) {
    const email = String(raw || '').trim().toLowerCase();
    if (!email) continue;
    const { data: existing } = await admin
      .from('email_subscribers').select('*').ilike('email', email).maybeSingle();
    if (existing) {
      if (!existing.unsubscribed_at) out.push(existing);
      continue;
    }
    const { data: created } = await admin
      .from('email_subscribers')
      .insert({ email, name: null, confirmed: true, confirmed_at: new Date().toISOString(), metadata: { source: 'test' } })
      .select().single();
    if (created) out.push(created);
  }
  return out;
}

module.exports.drainSend = drainSend;

// Allow other server-side modules to reuse the recipient resolver.
module.exports.fetchAudienceRecipients = fetchAudienceRecipients;
