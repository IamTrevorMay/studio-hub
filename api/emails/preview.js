// Render a template to HTML for in-app preview. Admin only.
//   POST /api/emails/preview
//     { template_id?, blocks?, subject?, branding?, settings?, sample_data?, resolve? }
//
//   - If template_id is supplied, blocks/subject/settings are loaded from the DB
//     unless overridden in the body.
//   - resolve=true → fetches real RSS data for bound blocks.
//   - Otherwise blocks render with sample_data + empty bindings.

const { requireAdmin, json, applyCors } = require('../_lib/emails/auth');
const { renderEmail } = require('../_lib/emails/renderEmail');
const { resolveAllBindings } = require('../_lib/emails/resolveBindings');

module.exports = async (req, res) => {
  applyCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const { admin } = ctx;

  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    let blocks = Array.isArray(body.blocks) ? body.blocks : null;
    let subject = body.subject;
    let settings = body.settings;
    let preheader = body.preheader;

    if (body.template_id) {
      const { data: tpl } = await admin
        .from('email_templates').select('*').eq('id', body.template_id).maybeSingle();
      if (tpl) {
        if (!blocks) blocks = Array.isArray(tpl.blocks) ? tpl.blocks : [];
        if (!subject) subject = tpl.subject || '';
        if (!preheader) preheader = tpl.preheader || '';
        if (!settings) {
          const { data: prod } = await admin
            .from('email_products').select('settings,name').eq('id', tpl.product_id).maybeSingle();
          if (prod) settings = (prod.settings && prod.settings.template) || {};
        }
      }
    }

    blocks = blocks || [];
    const data = body.resolve ? await resolveAllBindings(blocks) : (body.sample_data || {});
    const branding = body.branding || (settings && settings.branding) || {};

    const html = renderEmail({
      blocks,
      branding,
      settings: settings || {},
      data,
      subject: subject || '(no subject)',
      date: body.date || new Date().toISOString().slice(0, 10),
      unsubscribeUrl: '#preview-unsubscribe',
    });

    res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  } catch (e) {
    return json(res, 500, { error: e.message || String(e) });
  }
};
