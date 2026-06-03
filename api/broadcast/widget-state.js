// Persistent widget state per project. Read is public (overlay consumes
// it); writes require edit access. Real-time deltas come through
// Supabase Realtime on the broadcast_widget_state table.
//
//   GET   /api/broadcast/widget-state?project_id=<id>
//   PUT   /api/broadcast/widget-state  { project_id, state }
//   PATCH /api/broadcast/widget-state  { project_id, patch }   → shallow merge

const {
  json, applyCors, requireUser,
  projectAccessLevel, canEdit, createServiceClient,
} = require('../_lib/broadcast/access');

module.exports = async (req, res) => {
  applyCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    if (req.method === 'GET') {
      const projectId = req.query && req.query.project_id;
      if (!projectId) return json(res, 400, { error: 'project_id required' });
      const admin = createServiceClient();
      const { data, error } = await admin
        .from('broadcast_widget_state').select('*').eq('project_id', projectId).maybeSingle();
      if (error) throw error;
      return json(res, 200, { state: data ? data.state : {}, updated_at: data && data.updated_at });
    }

    const ctx = await requireUser(req, res);
    if (!ctx) return;
    const { user, admin } = ctx;
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    if (!body.project_id) return json(res, 400, { error: 'project_id required' });
    const level = await projectAccessLevel(admin, body.project_id, user.id);
    if (!canEdit(level)) return json(res, 403, { error: 'Forbidden' });

    if (req.method === 'PUT') {
      const newState = body.state && typeof body.state === 'object' ? body.state : {};
      const { data, error } = await admin
        .from('broadcast_widget_state')
        .upsert({ project_id: body.project_id, state: newState }, { onConflict: 'project_id' })
        .select().single();
      if (error) throw error;
      return json(res, 200, { state: data.state });
    }

    if (req.method === 'PATCH') {
      const patch = body.patch && typeof body.patch === 'object' ? body.patch : {};
      const { data: existing } = await admin
        .from('broadcast_widget_state').select('state').eq('project_id', body.project_id).maybeSingle();
      const merged = { ...((existing && existing.state) || {}), ...patch };
      const { data, error } = await admin
        .from('broadcast_widget_state')
        .upsert({ project_id: body.project_id, state: merged }, { onConflict: 'project_id' })
        .select().single();
      if (error) throw error;
      return json(res, 200, { state: data.state });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return json(res, 500, { error: e.message || String(e) });
  }
};
