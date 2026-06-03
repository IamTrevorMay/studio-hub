// CRUD for email_products. Admin only.
//   GET    /api/emails/products          → list
//   GET    /api/emails/products?id=<id>  → one
//   POST   /api/emails/products          → create  { name, slug, description?, settings? }
//   PATCH  /api/emails/products?id=<id>  → update  { name?, slug?, description?, settings? }
//   DELETE /api/emails/products?id=<id>  → delete (cascades to templates/audiences/sends)

const { requireAdmin, json, applyCors } = require('../_lib/emails/auth');

module.exports = async (req, res) => {
  applyCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const { user, admin } = ctx;
  const id = req.query && req.query.id;

  try {
    if (req.method === 'GET') {
      if (id) {
        const { data, error } = await admin
          .from('email_products').select('*').eq('id', id).maybeSingle();
        if (error) throw error;
        return json(res, 200, { product: data });
      }
      const { data, error } = await admin
        .from('email_products').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return json(res, 200, { products: data || [] });
    }

    if (req.method === 'POST') {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      if (!body.name || !body.slug) return json(res, 400, { error: 'name + slug required' });
      const { data, error } = await admin
        .from('email_products')
        .insert({
          name: body.name,
          slug: body.slug,
          description: body.description || null,
          settings: body.settings || {},
          created_by: user.id,
        })
        .select()
        .single();
      if (error) throw error;
      return json(res, 200, { product: data });
    }

    if (req.method === 'PATCH') {
      if (!id) return json(res, 400, { error: 'id required' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const update = {};
      if (typeof body.name === 'string') update.name = body.name;
      if (typeof body.slug === 'string') update.slug = body.slug;
      if (typeof body.description === 'string' || body.description === null) update.description = body.description;
      if (body.settings && typeof body.settings === 'object') update.settings = body.settings;
      const { data, error } = await admin
        .from('email_products').update(update).eq('id', id).select().single();
      if (error) throw error;
      return json(res, 200, { product: data });
    }

    if (req.method === 'DELETE') {
      if (!id) return json(res, 400, { error: 'id required' });
      const { error } = await admin.from('email_products').delete().eq('id', id);
      if (error) throw error;
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return json(res, 500, { error: e.message || String(e) });
  }
};
