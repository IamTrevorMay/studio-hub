// CRUD for broadcast_clip_markers. Markers are scoped to a session.
//   GET    /api/broadcast/clip-markers?session_id=<id>
//   POST   /api/broadcast/clip-markers  { session_id, title, start_time, end_time?, clip_type?, sort_order? }
//   PATCH  /api/broadcast/clip-markers?id=<id>
//   DELETE /api/broadcast/clip-markers?id=<id>

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
  const sessionId = req.query && req.query.session_id;

  try {
    async function resolveProject(sid) {
      const { data: s } = await admin
        .from('broadcast_sessions').select('project_id').eq('id', sid).maybeSingle();
      return s && s.project_id;
    }

    if (req.method === 'GET') {
      if (!sessionId) return json(res, 400, { error: 'session_id required' });
      const projectId = await resolveProject(sessionId);
      if (!projectId) return json(res, 404, { error: 'Session not found' });
      const level = await projectAccessLevel(admin, projectId, user.id);
      if (!canRead(level)) return json(res, 404, { error: 'Not found' });
      const { data, error } = await admin
        .from('broadcast_clip_markers').select('*').eq('session_id', sessionId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return json(res, 200, { markers: data || [] });
    }

    if (req.method === 'POST') {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      if (!body.session_id) return json(res, 400, { error: 'session_id required' });
      const projectId = await resolveProject(body.session_id);
      if (!projectId) return json(res, 404, { error: 'Session not found' });
      const level = await projectAccessLevel(admin, projectId, user.id);
      if (!canEdit(level)) return json(res, 403, { error: 'Forbidden' });

      const insert = {
        session_id: body.session_id,
        project_id: projectId,
        title: body.title || null,
        start_time: typeof body.start_time === 'number' ? body.start_time : null,
        end_time: typeof body.end_time === 'number' ? body.end_time : null,
        clip_type: body.clip_type || 'short',
        sort_order: typeof body.sort_order === 'number' ? body.sort_order : 0,
        created_by: user.id,
      };
      const { data, error } = await admin
        .from('broadcast_clip_markers').insert(insert).select().single();
      if (error) throw error;
      return json(res, 200, { marker: data });
    }

    if (req.method === 'PATCH') {
      if (!id) return json(res, 400, { error: 'id required' });
      const { data: existing } = await admin
        .from('broadcast_clip_markers').select('project_id').eq('id', id).maybeSingle();
      if (!existing) return json(res, 404, { error: 'Not found' });
      const level = await projectAccessLevel(admin, existing.project_id, user.id);
      if (!canEdit(level)) return json(res, 403, { error: 'Forbidden' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const update = {};
      for (const k of ['title', 'start_time', 'end_time', 'clip_type', 'sort_order']) {
        if (k in body) update[k] = body[k];
      }
      const { data, error } = await admin
        .from('broadcast_clip_markers').update(update).eq('id', id).select().single();
      if (error) throw error;
      return json(res, 200, { marker: data });
    }

    if (req.method === 'DELETE') {
      if (!id) return json(res, 400, { error: 'id required' });
      const { data: existing } = await admin
        .from('broadcast_clip_markers').select('project_id').eq('id', id).maybeSingle();
      if (!existing) return json(res, 404, { error: 'Not found' });
      const level = await projectAccessLevel(admin, existing.project_id, user.id);
      if (!canEdit(level)) return json(res, 403, { error: 'Forbidden' });
      const { error } = await admin.from('broadcast_clip_markers').delete().eq('id', id);
      if (error) throw error;
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return json(res, 500, { error: e.message || String(e) });
  }
};
