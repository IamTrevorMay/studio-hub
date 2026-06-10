// CRUD for broadcast_scenes.
//   GET    /api/broadcast/scenes?project_id=<id>
//   POST   /api/broadcast/scenes  { project_id, name?, sort_order?, hotkey_*? }
//   PATCH  /api/broadcast/scenes?id=<id>  { name?, sort_order?, hotkey_*?, transition_override? }
//   DELETE /api/broadcast/scenes?id=<id>

const {
  json, applyCors, requireUser,
  projectAccessLevel, canEdit, canRead,
} = require('../_lib/broadcast/access');

module.exports = async (req, res) => {
  applyCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const ctx = await requireUser(req, res);
  if (!ctx) return;
  const { user, admin } = ctx;
  const id = req.query && req.query.id;
  const projectId = req.query && req.query.project_id;

  try {
    if (req.method === 'GET') {
      if (!projectId) return json(res, 400, { error: 'project_id required' });
      const level = await projectAccessLevel(admin, projectId, user.id);
      if (!canRead(level)) return json(res, 404, { error: 'Not found' });
      const { data, error } = await admin
        .from('broadcast_scenes').select('*').eq('project_id', projectId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return json(res, 200, { scenes: data || [] });
    }

    if (req.method === 'POST') {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      if (!body.project_id) return json(res, 400, { error: 'project_id required' });
      const level = await projectAccessLevel(admin, body.project_id, user.id);
      if (!canEdit(level)) return json(res, 403, { error: 'Forbidden' });
      const insert = {
        project_id: body.project_id,
        name: body.name || 'Scene',
        sort_order: typeof body.sort_order === 'number' ? body.sort_order : 0,
        hotkey_key: body.hotkey_key || null,
        hotkey_color: body.hotkey_color || null,
        enter_transition: body.enter_transition || null,
        exit_transition: body.exit_transition || null,
        transition_override: body.transition_override || null,
      };
      const { data, error } = await admin
        .from('broadcast_scenes').insert(insert).select().single();
      if (error) throw error;
      return json(res, 200, { scene: data });
    }

    if (req.method === 'PATCH') {
      if (!id) return json(res, 400, { error: 'id required' });
      const { data: existing } = await admin
        .from('broadcast_scenes').select('project_id').eq('id', id).maybeSingle();
      if (!existing) return json(res, 404, { error: 'Not found' });
      const level = await projectAccessLevel(admin, existing.project_id, user.id);
      if (!canEdit(level)) return json(res, 403, { error: 'Forbidden' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const update = pickKeys(body, [
        'name', 'sort_order',
        'hotkey_key', 'hotkey_color',
        'enter_transition', 'exit_transition', 'transition_override',
      ]);
      const { data, error } = await admin
        .from('broadcast_scenes').update(update).eq('id', id).select().single();
      if (error) throw error;
      return json(res, 200, { scene: data });
    }

    if (req.method === 'DELETE') {
      if (!id) return json(res, 400, { error: 'id required' });
      const { data: existing } = await admin
        .from('broadcast_scenes').select('project_id').eq('id', id).maybeSingle();
      if (!existing) return json(res, 404, { error: 'Not found' });
      const level = await projectAccessLevel(admin, existing.project_id, user.id);
      if (!canEdit(level)) return json(res, 403, { error: 'Forbidden' });
      const { error } = await admin.from('broadcast_scenes').delete().eq('id', id);
      if (error) throw error;
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return json(res, 500, { error: e.message || String(e) });
  }
};

function pickKeys(obj, keys) {
  const out = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}
