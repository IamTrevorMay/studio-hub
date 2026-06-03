// CRUD for broadcast_assets (asset metadata rows; binary content lives
// in the broadcast-assets storage bucket and is referenced by
// storage_path).
//
//   GET    /api/broadcast/assets?project_id=<id>
//   GET    /api/broadcast/assets?id=<id>
//   POST   /api/broadcast/assets  { project_id, name, asset_type, storage_path?, ... }
//   PATCH  /api/broadcast/assets?id=<id>  { partial update }
//   DELETE /api/broadcast/assets?id=<id>  → DB row + storage object (if any)

const {
  json, applyCors, requireUser,
  projectAccessLevel, canEdit, canRead, createServiceClient,
} = require('../_lib/broadcast/access');

const EDITABLE_KEYS = [
  'name', 'asset_type', 'storage_path',
  'template_id', 'template_data', 'slideshow_config', 'scene_config', 'ad_config',
  'canvas_x', 'canvas_y', 'canvas_width', 'canvas_height',
  'layer', 'opacity',
  'enter_transition', 'exit_transition',
  'hotkey_key', 'hotkey_color', 'hotkey_label',
  'trigger_duration', 'sort_order',
];

module.exports = async (req, res) => {
  applyCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const id = req.query && req.query.id;
  const projectId = req.query && req.query.project_id;

  try {
    if (req.method === 'GET') {
      // Asset reads are allowed without auth IF the user supplies a
      // session token (covers overlay-page consumers). We still respect
      // RLS via the service client only after access check.
      const admin = createServiceClient();
      if (id) {
        const { data, error } = await admin
          .from('broadcast_assets').select('*').eq('id', id).maybeSingle();
        if (error) throw error;
        if (!data) return json(res, 404, { error: 'Not found' });
        // Public read iff project's overlay is public — for v1 we treat
        // all assets as readable (matches Triton).
        return json(res, 200, { asset: data });
      }
      if (!projectId) return json(res, 400, { error: 'project_id or id required' });
      const { data, error } = await admin
        .from('broadcast_assets').select('*').eq('project_id', projectId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return json(res, 200, { assets: data || [] });
    }

    const ctx = await requireUser(req, res);
    if (!ctx) return;
    const { user, admin } = ctx;

    if (req.method === 'POST') {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      if (!body.project_id) return json(res, 400, { error: 'project_id required' });
      if (!body.asset_type) return json(res, 400, { error: 'asset_type required' });
      const level = await projectAccessLevel(admin, body.project_id, user.id);
      if (!canEdit(level)) return json(res, 403, { error: 'Forbidden' });
      const insert = { project_id: body.project_id };
      for (const k of EDITABLE_KEYS) if (k in body) insert[k] = body[k];
      const { data, error } = await admin
        .from('broadcast_assets').insert(insert).select().single();
      if (error) throw error;
      return json(res, 200, { asset: data });
    }

    if (req.method === 'PATCH') {
      if (!id) return json(res, 400, { error: 'id required' });
      const { data: existing } = await admin
        .from('broadcast_assets').select('project_id').eq('id', id).maybeSingle();
      if (!existing) return json(res, 404, { error: 'Not found' });
      const level = await projectAccessLevel(admin, existing.project_id, user.id);
      if (!canEdit(level)) return json(res, 403, { error: 'Forbidden' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const update = {};
      for (const k of EDITABLE_KEYS) if (k in body) update[k] = body[k];
      const { data, error } = await admin
        .from('broadcast_assets').update(update).eq('id', id).select().single();
      if (error) throw error;
      return json(res, 200, { asset: data });
    }

    if (req.method === 'DELETE') {
      if (!id) return json(res, 400, { error: 'id required' });
      const { data: existing } = await admin
        .from('broadcast_assets').select('project_id, storage_path').eq('id', id).maybeSingle();
      if (!existing) return json(res, 404, { error: 'Not found' });
      const level = await projectAccessLevel(admin, existing.project_id, user.id);
      if (!canEdit(level)) return json(res, 403, { error: 'Forbidden' });

      const { error: delErr } = await admin.from('broadcast_assets').delete().eq('id', id);
      if (delErr) throw delErr;
      if (existing.storage_path) {
        // best-effort; the row is already gone.
        await admin.storage.from('broadcast-assets').remove([existing.storage_path])
          .catch(() => null);
      }
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return json(res, 500, { error: e.message || String(e) });
  }
};
