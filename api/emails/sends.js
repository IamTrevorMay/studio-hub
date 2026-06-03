// Read-only list of email_sends with per-send event counts. Admin only.
//   GET /api/emails/sends?product_id=<id>
//   GET /api/emails/sends?id=<id>

const { requireAdmin, json, applyCors } = require('../_lib/emails/auth');

module.exports = async (req, res) => {
  applyCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const { admin } = ctx;
  const id = req.query && req.query.id;
  const productId = req.query && req.query.product_id;

  try {
    if (id) {
      const { data, error } = await admin
        .from('email_sends').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      const counts = data ? await fetchCounts(admin, [data.id]) : {};
      return json(res, 200, { send: data ? { ...data, counts: counts[data.id] || {} } : null });
    }
    const q = admin.from('email_sends').select('*').order('created_at', { ascending: false }).limit(200);
    if (productId) q.eq('product_id', productId);
    const { data, error } = await q;
    if (error) throw error;
    const ids = (data || []).map((s) => s.id);
    const counts = await fetchCounts(admin, ids);
    const rows = (data || []).map((s) => ({ ...s, counts: counts[s.id] || {} }));
    return json(res, 200, { sends: rows });
  } catch (e) {
    return json(res, 500, { error: e.message || String(e) });
  }
};

async function fetchCounts(admin, sendIds) {
  if (sendIds.length === 0) return {};
  const { data } = await admin
    .from('email_events').select('send_id, type').in('send_id', sendIds);
  const out = {};
  for (const row of (data || [])) {
    out[row.send_id] = out[row.send_id] || {};
    out[row.send_id][row.type] = (out[row.send_id][row.type] || 0) + 1;
  }
  return out;
}
