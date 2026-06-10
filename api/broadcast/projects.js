// CRUD for broadcast_projects.
//   GET    /api/broadcast/projects                  → list (owned + member-of + admin sees all)
//   GET    /api/broadcast/projects?id=<id>          → one (must have read access)
//   POST   /api/broadcast/projects                  → create (producer/admin)
//   PATCH  /api/broadcast/projects?id=<id>          → update (edit access)
//   DELETE /api/broadcast/projects?id=<id>          → delete (owner or admin)

const {
  json, applyCors, requireUser, requireProducer,
  projectAccessLevel, canEdit, canRead,
} = require('../_lib/broadcast/access');

module.exports = async (req, res) => {
  applyCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const id = req.query && req.query.id;

  try {
    if (req.method === 'GET') {
      const ctx = await requireUser(req, res);
      if (!ctx) return;
      const { user, profile, admin } = ctx;

      if (id) {
        const level = await projectAccessLevel(admin, id, user.id);
        if (!canRead(level)) return json(res, 404, { error: 'Not found' });
        const { data, error } = await admin
          .from('broadcast_projects').select('*').eq('id', id).maybeSingle();
        if (error) throw error;
        return json(res, 200, { project: data ? { ...data, _userRole: level } : null });
      }

      // List path: admins see everything, others see owned + member-of.
      const isAdminTier = profile && ['admin','director_creative','director_comms'].includes(profile.role);
      if (isAdminTier) {
        const { data, error } = await admin
          .from('broadcast_projects').select('*').order('updated_at', { ascending: false });
        if (error) throw error;
        return json(res, 200, {
          projects: (data || []).map((p) => ({
            ...p, _userRole: p.user_id === user.id ? 'owner' : 'producer',
          })),
        });
      }

      const [{ data: owned }, { data: memberRows }] = await Promise.all([
        admin.from('broadcast_projects').select('*').eq('user_id', user.id)
          .order('updated_at', { ascending: false }),
        admin.from('broadcast_project_members')
          .select('project_id, role, broadcast_projects(*)')
          .ilike('email', profile ? profile.email : '__no_match__'),
      ]);
      const map = new Map();
      for (const p of (owned || [])) map.set(p.id, { ...p, _userRole: 'owner' });
      for (const m of (memberRows || [])) {
        if (!m.broadcast_projects) continue;
        if (!map.has(m.broadcast_projects.id)) {
          map.set(m.broadcast_projects.id, { ...m.broadcast_projects, _userRole: m.role });
        }
      }
      const projects = Array.from(map.values())
        .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
      return json(res, 200, { projects });
    }

    if (req.method === 'POST') {
      const ctx = await requireProducer(req, res);
      if (!ctx) return;
      const { user, admin } = ctx;
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      if (!body.name) return json(res, 400, { error: 'name required' });
      const { data, error } = await admin.from('broadcast_projects').insert({
        name: body.name,
        description: body.description || null,
        fps: body.fps || 30,
        settings: body.settings || {},
        user_id: user.id,
      }).select().single();
      if (error) throw error;
      return json(res, 200, { project: { ...data, _userRole: 'owner' } });
    }

    if (req.method === 'PATCH') {
      if (!id) return json(res, 400, { error: 'id required' });
      const ctx = await requireUser(req, res);
      if (!ctx) return;
      const { user, admin } = ctx;
      const level = await projectAccessLevel(admin, id, user.id);
      if (!canEdit(level)) return json(res, 403, { error: 'Forbidden' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const update = {};
      if (typeof body.name === 'string') update.name = body.name;
      if (typeof body.description === 'string' || body.description === null) update.description = body.description;
      if (typeof body.fps === 'number') update.fps = body.fps;
      if (body.settings && typeof body.settings === 'object') update.settings = body.settings;
      const { data, error } = await admin
        .from('broadcast_projects').update(update).eq('id', id).select().single();
      if (error) throw error;
      return json(res, 200, { project: { ...data, _userRole: level } });
    }

    if (req.method === 'DELETE') {
      if (!id) return json(res, 400, { error: 'id required' });
      const ctx = await requireUser(req, res);
      if (!ctx) return;
      const { user, profile, admin } = ctx;
      const { data: project } = await admin
        .from('broadcast_projects').select('user_id').eq('id', id).maybeSingle();
      if (!project) return json(res, 404, { error: 'Not found' });
      const isAdminTier = profile && ['admin','director_creative','director_comms'].includes(profile.role);
      if (!isAdminTier && project.user_id !== user.id) {
        return json(res, 403, { error: 'Only the owner or an admin can delete' });
      }
      const { error } = await admin.from('broadcast_projects').delete().eq('id', id);
      if (error) throw error;
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return json(res, 500, { error: e.message || String(e) });
  }
};
