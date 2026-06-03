// Scheduled-send drainer. Called by pg_cron (or Vercel Cron) every minute.
//
// Authentication: bearer = CRON_SECRET (same convention as the rest of the
// app's cron-only endpoints).
//
// Picks up email_sends rows where status='scheduled' AND scheduled_at <= now
// (oldest first), then drains them via the same code path as a synchronous
// send. Also resumes status='sending' rows that stalled (e.g. fn timed out
// mid-batch).

const { createServiceClient } = require('../_lib/emails/auth');
const { drainSend } = require('./send');

module.exports = async (req, res) => {
  const auth = req.headers['authorization'] || '';
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  let admin;
  try { admin = createServiceClient(); }
  catch (e) {
    res.status(500).json({ error: e.message });
    return;
  }

  const now = new Date().toISOString();
  const stalledCutoff = new Date(Date.now() - 5 * 60_000).toISOString();

  // Due scheduled sends + stalled sending sends.
  const { data: dueRows } = await admin
    .from('email_sends')
    .select('*')
    .or(`and(status.eq.scheduled,scheduled_at.lte.${now}),and(status.eq.sending,updated_at.lte.${stalledCutoff})`)
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .limit(5);

  const drained = [];
  for (const sendRow of (dueRows || [])) {
    try {
      const { data: tpl } = await admin
        .from('email_templates').select('*').eq('id', sendRow.template_id).maybeSingle();
      if (!tpl) { drained.push({ id: sendRow.id, skipped: 'no template' }); continue; }
      const { data: product } = await admin
        .from('email_products').select('*').eq('id', sendRow.product_id).maybeSingle();
      if (!product) { drained.push({ id: sendRow.id, skipped: 'no product' }); continue; }

      const settings = (product.settings && product.settings.template) || {};
      const branding = (product.settings && product.settings.branding) || {};

      const result = await drainSend(admin, sendRow, {
        product, tpl, subject: sendRow.subject, settings, branding,
        testEmails: null, req,
      });
      drained.push({ id: sendRow.id, sent: result.sent, failed: result.failed, status: result.send.status });
    } catch (e) {
      drained.push({ id: sendRow.id, error: e.message });
      await admin.from('email_sends').update({
        status: 'failed', error_message: e.message,
      }).eq('id', sendRow.id);
    }
  }

  res.status(200).json({ drained });
};
