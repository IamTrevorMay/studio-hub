// CRUD for email_subscribers + audience membership. Admin only.
//
// Subscribers are global (not scoped to a product) — audience membership
// is what associates them to a product's sends.
//
//   GET    /api/emails/subscribers                          → list (latest 500)
//   GET    /api/emails/subscribers?audience_id=<id>          → list in audience
//   GET    /api/emails/subscribers?q=<search>                → search by email
//   POST   /api/emails/subscribers  { email, name?, audience_id?, confirmed? }
//   PATCH  /api/emails/subscribers?id=<id>  { name?, confirmed?, metadata? }
//   DELETE /api/emails/subscribers?id=<id>           → hard-delete the subscriber
//   POST   /api/emails/subscribers?op=add-to-audience      { subscriber_id, audience_id }
//   POST   /api/emails/subscribers?op=remove-from-audience { subscriber_id, audience_id }
//   POST   /api/emails/subscribers?op=bulk-import          { audience_id, rows: [{email,name?}] }

const { requireAdmin, json, applyCors } = require('../_lib/emails/auth');

const MAX_BULK = 5000;

module.exports = async (req, res) => {
  applyCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const { admin } = ctx;
  const id = req.query && req.query.id;
  const op = req.query && req.query.op;
  const audienceId = req.query && req.query.audience_id;
  const search = req.query && req.query.q;

  try {
    if (req.method === 'GET') {
      if (audienceId) {
        const { data, error } = await admin
          .from('email_audience_members')
          .select('subscriber_id, added_at, email_subscribers(id, email, name, confirmed, unsubscribed_at, metadata)')
          .eq('audience_id', audienceId)
          .order('added_at', { ascending: false })
          .limit(2000);
        if (error) throw error;
        const rows = (data || []).map((m) => ({
          ...m.email_subscribers,
          added_at: m.added_at,
        })).filter((r) => r && r.id);
        return json(res, 200, { subscribers: rows });
      }
      let q = admin
        .from('email_subscribers').select('*')
        .order('created_at', { ascending: false }).limit(500);
      if (search) q = q.ilike('email', `%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return json(res, 200, { subscribers: data || [] });
    }

    if (req.method === 'POST' && !op) {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      if (!body.email) return json(res, 400, { error: 'email required' });
      const sub = await upsertSubscriber(admin, body);
      if (body.audience_id) {
        await admin.from('email_audience_members').upsert(
          { audience_id: body.audience_id, subscriber_id: sub.id },
          { onConflict: 'audience_id,subscriber_id' }
        );
      }
      return json(res, 200, { subscriber: sub });
    }

    if (req.method === 'POST' && op === 'add-to-audience') {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      if (!body.subscriber_id || !body.audience_id) {
        return json(res, 400, { error: 'subscriber_id + audience_id required' });
      }
      const { error } = await admin.from('email_audience_members').upsert(
        { audience_id: body.audience_id, subscriber_id: body.subscriber_id },
        { onConflict: 'audience_id,subscriber_id' }
      );
      if (error) throw error;
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && op === 'remove-from-audience') {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      if (!body.subscriber_id || !body.audience_id) {
        return json(res, 400, { error: 'subscriber_id + audience_id required' });
      }
      const { error } = await admin.from('email_audience_members').delete()
        .eq('audience_id', body.audience_id).eq('subscriber_id', body.subscriber_id);
      if (error) throw error;
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && op === 'bulk-import') {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (rows.length === 0) return json(res, 400, { error: 'rows[] required' });
      if (rows.length > MAX_BULK) {
        return json(res, 400, { error: `rows[] capped at ${MAX_BULK}` });
      }
      let added = 0, skipped = 0;
      const subscriberIds = [];
      for (const row of rows) {
        if (!row || !row.email) { skipped++; continue; }
        try {
          const sub = await upsertSubscriber(admin, row);
          subscriberIds.push(sub.id);
          added++;
        } catch {
          skipped++;
        }
      }
      if (body.audience_id && subscriberIds.length > 0) {
        const links = subscriberIds.map((sid) => ({
          audience_id: body.audience_id, subscriber_id: sid,
        }));
        await admin.from('email_audience_members')
          .upsert(links, { onConflict: 'audience_id,subscriber_id' });
      }
      return json(res, 200, { added, skipped, total: rows.length });
    }

    if (req.method === 'PATCH') {
      if (!id) return json(res, 400, { error: 'id required' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const update = {};
      if (typeof body.name === 'string' || body.name === null) update.name = body.name;
      if (typeof body.confirmed === 'boolean') {
        update.confirmed = body.confirmed;
        update.confirmed_at = body.confirmed ? new Date().toISOString() : null;
      }
      if (body.metadata && typeof body.metadata === 'object') update.metadata = body.metadata;
      const { data, error } = await admin
        .from('email_subscribers').update(update).eq('id', id).select().single();
      if (error) throw error;
      return json(res, 200, { subscriber: data });
    }

    if (req.method === 'DELETE') {
      if (!id) return json(res, 400, { error: 'id required' });
      const { error } = await admin.from('email_subscribers').delete().eq('id', id);
      if (error) throw error;
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return json(res, 500, { error: e.message || String(e) });
  }
};

// Find-or-create a subscriber by lowercased email.
async function upsertSubscriber(admin, row) {
  const email = String(row.email).trim().toLowerCase();
  if (!email) throw new Error('email empty');
  const { data: existing } = await admin
    .from('email_subscribers').select('*')
    .ilike('email', email).maybeSingle();
  if (existing) {
    const patch = {};
    if (row.name && existing.name !== row.name) patch.name = row.name;
    if (row.metadata && typeof row.metadata === 'object') patch.metadata = row.metadata;
    if (Object.keys(patch).length > 0) {
      const { data: updated } = await admin
        .from('email_subscribers').update(patch).eq('id', existing.id).select().single();
      return updated || existing;
    }
    return existing;
  }
  const insert = {
    email,
    name: row.name || null,
    metadata: (row.metadata && typeof row.metadata === 'object') ? row.metadata : {},
    confirmed: row.confirmed !== false,
    confirmed_at: row.confirmed !== false ? new Date().toISOString() : null,
  };
  const { data, error } = await admin
    .from('email_subscribers').insert(insert).select().single();
  if (error) throw error;
  return data;
}
