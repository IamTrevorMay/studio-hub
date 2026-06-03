// CRUD for email_templates. Admin only.
//   GET    /api/emails/templates?product_id=<id>           → list for product
//   GET    /api/emails/templates?id=<id>                    → one
//   POST   /api/emails/templates  { product_id, name?, subject?, preheader?, blocks? }
//   PATCH  /api/emails/templates?id=<id>  { name?, subject?, preheader?, blocks? }
//   DELETE /api/emails/templates?id=<id>

const { requireAdmin, json, applyCors } = require('../_lib/emails/auth');

module.exports = async (req, res) => {
  applyCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const { user, admin } = ctx;
  const id = req.query && req.query.id;
  const productId = req.query && req.query.product_id;

  try {
    if (req.method === 'GET') {
      if (id) {
        const { data, error } = await admin
          .from('email_templates').select('*').eq('id', id).maybeSingle();
        if (error) throw error;
        return json(res, 200, { template: data });
      }
      const q = admin.from('email_templates').select('*').order('updated_at', { ascending: false });
      if (productId) q.eq('product_id', productId);
      const { data, error } = await q;
      if (error) throw error;
      return json(res, 200, { templates: data || [] });
    }

    if (req.method === 'POST') {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      if (!body.product_id) return json(res, 400, { error: 'product_id required' });
      const { data, error } = await admin
        .from('email_templates')
        .insert({
          product_id: body.product_id,
          name: body.name || 'Untitled',
          subject: body.subject || '',
          preheader: body.preheader || null,
          blocks: Array.isArray(body.blocks) ? body.blocks : [],
          created_by: user.id,
        })
        .select()
        .single();
      if (error) throw error;
      return json(res, 200, { template: data });
    }

    if (req.method === 'PATCH') {
      if (!id) return json(res, 400, { error: 'id required' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const update = {};
      if (typeof body.name === 'string') update.name = body.name;
      if (typeof body.subject === 'string') update.subject = body.subject;
      if (typeof body.preheader === 'string' || body.preheader === null) update.preheader = body.preheader;
      if (Array.isArray(body.blocks)) update.blocks = body.blocks;
      const { data, error } = await admin
        .from('email_templates').update(update).eq('id', id).select().single();
      if (error) throw error;
      return json(res, 200, { template: data });
    }

    if (req.method === 'DELETE') {
      if (!id) return json(res, 400, { error: 'id required' });
      const { error } = await admin.from('email_templates').delete().eq('id', id);
      if (error) throw error;
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return json(res, 500, { error: e.message || String(e) });
  }
};
