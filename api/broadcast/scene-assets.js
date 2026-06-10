// CRUD for broadcast_scene_assets (link rows between scenes and assets).
//   GET    /api/broadcast/scene-assets?scene_id=<id>            → per-scene
//   GET    /api/broadcast/scene-assets?project_id=<id>          → all in project
//   POST   /api/broadcast/scene-assets  { scene_id, asset_id, ... overrides }
//   PATCH  /api/broadcast/scene-assets?id=<id>  { is_visible?, override_* }
//   DELETE /api/broadcast/scene-assets?id=<id>

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
  const sceneId = req.query && req.query.scene_id;
  const projectId = req.query && req.query.project_id;

  try {
    if (req.method === 'GET') {
      let accessProjectId = projectId;
      if (!accessProjectId && sceneId) {
        const { data: sc } = await admin
          .from('broadcast_scenes').select('project_id').eq('id', sceneId).maybeSingle();
        accessProjectId = sc && sc.project_id;
      }
      if (!accessProjectId) return json(res, 400, { error: 'scene_id or project_id required' });
      const level = await projectAccessLevel(admin, accessProjectId, user.id);
      if (!canRead(level)) return json(res, 404, { error: 'Not found' });

      let q = admin.from('broadcast_scene_assets').select('*');
      if (sceneId) {
        q = q.eq('scene_id', sceneId);
      } else {
        const { data: scenes } = await admin
          .from('broadcast_scenes').select('id').eq('project_id', accessProjectId);
        const ids = (scenes || []).map((s) => s.id);
        if (ids.length === 0) return json(res, 200, { sceneAssets: [] });
        q = q.in('scene_id', ids);
      }
      const { data, error } = await q;
      if (error) throw error;
      return json(res, 200, { sceneAssets: data || [] });
    }

    if (req.method === 'POST') {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      if (!body.scene_id || !body.asset_id) {
        return json(res, 400, { error: 'scene_id + asset_id required' });
      }
      const { data: scene } = await admin
        .from('broadcast_scenes').select('project_id').eq('id', body.scene_id).maybeSingle();
      if (!scene) return json(res, 404, { error: 'scene not found' });
      const level = await projectAccessLevel(admin, scene.project_id, user.id);
      if (!canEdit(level)) return json(res, 403, { error: 'Forbidden' });
      const insert = {
        scene_id: body.scene_id, asset_id: body.asset_id,
        is_visible: body.is_visible !== false,
        override_x: body.override_x ?? null,
        override_y: body.override_y ?? null,
        override_width: body.override_width ?? null,
        override_height: body.override_height ?? null,
        override_layer: body.override_layer ?? null,
        override_opacity: body.override_opacity ?? null,
      };
      const { data, error } = await admin
        .from('broadcast_scene_assets').insert(insert).select().single();
      if (error) throw error;
      return json(res, 200, { sceneAsset: data });
    }

    if (req.method === 'PATCH') {
      if (!id) return json(res, 400, { error: 'id required' });
      const { data: existing } = await admin
        .from('broadcast_scene_assets').select('scene_id').eq('id', id).maybeSingle();
      if (!existing) return json(res, 404, { error: 'Not found' });
      const { data: scene } = await admin
        .from('broadcast_scenes').select('project_id').eq('id', existing.scene_id).maybeSingle();
      const level = await projectAccessLevel(admin, scene && scene.project_id, user.id);
      if (!canEdit(level)) return json(res, 403, { error: 'Forbidden' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const update = pickKeys(body, [
        'is_visible',
        'override_x', 'override_y',
        'override_width', 'override_height',
        'override_layer', 'override_opacity',
      ]);
      const { data, error } = await admin
        .from('broadcast_scene_assets').update(update).eq('id', id).select().single();
      if (error) throw error;
      return json(res, 200, { sceneAsset: data });
    }

    if (req.method === 'DELETE') {
      if (!id) return json(res, 400, { error: 'id required' });
      const { data: existing } = await admin
        .from('broadcast_scene_assets').select('scene_id').eq('id', id).maybeSingle();
      if (!existing) return json(res, 404, { error: 'Not found' });
      const { data: scene } = await admin
        .from('broadcast_scenes').select('project_id').eq('id', existing.scene_id).maybeSingle();
      const level = await projectAccessLevel(admin, scene && scene.project_id, user.id);
      if (!canEdit(level)) return json(res, 403, { error: 'Forbidden' });
      const { error } = await admin.from('broadcast_scene_assets').delete().eq('id', id);
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
