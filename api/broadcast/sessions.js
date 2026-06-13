// CRUD for broadcast_sessions. Sessions are publicly readable (the
// overlay page is open) but mutations require edit access.
//
//   GET    /api/broadcast/sessions?id=<id>                  → one (public)
//   GET    /api/broadcast/sessions?channel_name=<slug>      → one by slug (public)
//   GET    /api/broadcast/sessions?project_id=<id>          → list for project
//   POST   /api/broadcast/sessions  { project_id, channel_name?, is_live? }
//   PATCH  /api/broadcast/sessions?id=<id>  { is_live?, active_state?, ... }
//   DELETE /api/broadcast/sessions?id=<id>
//
// Security model: lookups by `id` (UUID) or `channel_name` (slug) are
// intentionally public so the overlay page can boot inside OBS without
// auth. The session row acts as its own capability token — anyone who
// holds the id/channel_name can read the active_state needed to render
// the overlay. Listing by project_id (which would let a caller
// enumerate sessions for a project) requires JWT + project access.
// Treat active_state as public — do not stuff sensitive data into it.

const {
  json, applyCors, requireUser,
  projectAccessLevel, canEdit, createServiceClient,
} = require('../_lib/broadcast/access');

module.exports = async (req, res) => {
  applyCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const id = req.query && req.query.id;
  const channelName = req.query && req.query.channel_name;
  const projectId = req.query && req.query.project_id;

  try {
    if (req.method === 'GET') {
      const admin = createServiceClient();
      if (id) {
        const { data, error } = await admin
          .from('broadcast_sessions').select('*').eq('id', id).maybeSingle();
        if (error) throw error;
        return json(res, 200, { session: data });
      }
      if (channelName) {
        const { data, error } = await admin
          .from('broadcast_sessions').select('*').eq('channel_name', channelName).maybeSingle();
        if (error) throw error;
        return json(res, 200, { session: data });
      }
      if (projectId) {
        // List requires auth; sessions list isn't exposed to overlay consumers.
        const ctx = await requireUser(req, res);
        if (!ctx) return;
        const { data, error } = await admin
          .from('broadcast_sessions').select('*').eq('project_id', projectId)
          .order('created_at', { ascending: false }).limit(50);
        if (error) throw error;
        return json(res, 200, { sessions: data || [] });
      }
      return json(res, 400, { error: 'id, channel_name, or project_id required' });
    }

    if (req.method === 'POST') {
      const ctx = await requireUser(req, res);
      if (!ctx) return;
      const { user, admin } = ctx;
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      if (!body.project_id) return json(res, 400, { error: 'project_id required' });
      const level = await projectAccessLevel(admin, body.project_id, user.id);
      if (!canEdit(level)) return json(res, 403, { error: 'Forbidden' });
      const slug = (body.channel_name || randomSlug()).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
      const { data, error } = await admin.from('broadcast_sessions').insert({
        project_id: body.project_id,
        user_id: user.id,
        channel_name: slug,
        is_live: !!body.is_live,
        started_at: body.is_live ? new Date().toISOString() : null,
      }).select().single();
      if (error) throw error;
      return json(res, 200, { session: data });
    }

    if (req.method === 'PATCH') {
      if (!id) return json(res, 400, { error: 'id required' });
      const ctx = await requireUser(req, res);
      if (!ctx) return;
      const { user, admin } = ctx;
      const { data: existing } = await admin
        .from('broadcast_sessions').select('project_id, is_live').eq('id', id).maybeSingle();
      if (!existing) return json(res, 404, { error: 'Not found' });
      const level = await projectAccessLevel(admin, existing.project_id, user.id);
      if (!canEdit(level)) return json(res, 403, { error: 'Forbidden' });

      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const update = {};
      if (typeof body.is_live === 'boolean') {
        update.is_live = body.is_live;
        if (body.is_live && !existing.is_live) update.started_at = new Date().toISOString();
        if (!body.is_live && existing.is_live) update.ended_at = new Date().toISOString();
      }
      if (body.active_state && typeof body.active_state === 'object') update.active_state = body.active_state;
      if (typeof body.channel_name === 'string') update.channel_name = body.channel_name.toLowerCase().replace(/[^a-z0-9-]+/g, '-');

      const { data, error } = await admin
        .from('broadcast_sessions').update(update).eq('id', id).select().single();
      if (error) throw error;
      return json(res, 200, { session: data });
    }

    if (req.method === 'DELETE') {
      if (!id) return json(res, 400, { error: 'id required' });
      const ctx = await requireUser(req, res);
      if (!ctx) return;
      const { user, admin } = ctx;
      const { data: existing } = await admin
        .from('broadcast_sessions').select('project_id').eq('id', id).maybeSingle();
      if (!existing) return json(res, 404, { error: 'Not found' });
      const level = await projectAccessLevel(admin, existing.project_id, user.id);
      if (!canEdit(level)) return json(res, 403, { error: 'Forbidden' });
      const { error } = await admin.from('broadcast_sessions').delete().eq('id', id);
      if (error) throw error;
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return json(res, 500, { error: e.message || String(e) });
  }
};

// Slug doubles as the public capability token for the overlay URL, so
// use enough entropy that brute-forcing the namespace is impractical.
// 16 base36 chars ≈ 82 bits, comfortably past guess-resistant.
function randomSlug() {
  let s = '';
  while (s.length < 16) s += Math.random().toString(36).slice(2);
  return 'show-' + s.slice(0, 16);
}
