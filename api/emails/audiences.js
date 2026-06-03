// CRUD for email_audiences. Admin only.
//   GET    /api/emails/audiences?product_id=<id>  → list (with member counts)
//   POST   /api/emails/audiences  { product_id, name, description? }
//   PATCH  /api/emails/audiences?id=<id>  { name?, description? }
//   DELETE /api/emails/audiences?id=<id>

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
      const q = admin
        .from('email_audiences')
        .select('*, email_audience_members(count)')
        .order('created_at', { ascending: false });
      if (productId) q.eq('product_id', productId);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data || []).map((a) => ({
        ...a,
        member_count: (a.email_audience_members && a.email_audience_members[0]
          && a.email_audience_members[0].count) || 0,
        email_audience_members: undefined,
      }));
      return json(res, 200, { audiences: rows });
    }

    if (req.method === 'POST') {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      if (!body.product_id || !body.name) {
        return json(res, 400, { error: 'product_id + name required' });
      }
      const { data, error } = await admin
        .from('email_audiences')
        .insert({
          product_id: body.product_id,
          name: body.name,
          description: body.description || null,
          created_by: user.id,
        })
        .select().single();
      if (error) throw error;
      return json(res, 200, { audience: data });
    }

    if (req.method === 'PATCH') {
      if (!id) return json(res, 400, { error: 'id required' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const update = {};
      if (typeof body.name === 'string') update.name = body.name;
      if (typeof body.description === 'string' || body.description === null) update.description = body.description;
      const { data, error } = await admin
        .from('email_audiences').update(update).eq('id', id).select().single();
      if (error) throw error;
      return json(res, 200, { audience: data });
    }

    if (req.method === 'DELETE') {
      if (!id) return json(res, 400, { error: 'id required' });
      const { error } = await admin.from('email_audiences').delete().eq('id', id);
      if (error) throw error;
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return json(res, 500, { error: e.message || String(e) });
  }
};
