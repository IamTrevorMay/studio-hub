// CRUD for broadcast_project_members. Edit access required.
//   GET    /api/broadcast/project-members?project_id=<id>           → members + owner
//   POST   /api/broadcast/project-members  { project_id, email, role }   → add
//   PATCH  /api/broadcast/project-members?id=<id>  { role }              → change role
//   DELETE /api/broadcast/project-members?id=<id>                        → remove

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

      const [{ data: project }, { data: members }] = await Promise.all([
        admin.from('broadcast_projects').select('user_id').eq('id', projectId).maybeSingle(),
        admin.from('broadcast_project_members')
          .select('*').eq('project_id', projectId).order('created_at', { ascending: true }),
      ]);
      let ownerEmail = null;
      if (project && project.user_id) {
        const { data: ownerProfile } = await admin
          .from('profiles').select('email').eq('id', project.user_id).maybeSingle();
        ownerEmail = ownerProfile ? ownerProfile.email : null;
      }
      return json(res, 200, { members: members || [], owner_email: ownerEmail });
    }

    if (req.method === 'POST') {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      if (!body.project_id || !body.email) {
        return json(res, 400, { error: 'project_id + email required' });
      }
      const level = await projectAccessLevel(admin, body.project_id, user.id);
      if (!canEdit(level)) return json(res, 403, { error: 'Forbidden' });
      const role = body.role === 'producer' ? 'producer' : 'viewer';
      const { data, error } = await admin.from('broadcast_project_members').insert({
        project_id: body.project_id,
        email: String(body.email).trim().toLowerCase(),
        role, invited_by: user.id,
      }).select().single();
      if (error) throw error;
      return json(res, 200, { member: data });
    }

    if (req.method === 'PATCH') {
      if (!id) return json(res, 400, { error: 'id required' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const { data: existing } = await admin
        .from('broadcast_project_members').select('project_id').eq('id', id).maybeSingle();
      if (!existing) return json(res, 404, { error: 'Not found' });
      const level = await projectAccessLevel(admin, existing.project_id, user.id);
      if (!canEdit(level)) return json(res, 403, { error: 'Forbidden' });
      const role = body.role === 'producer' ? 'producer' : 'viewer';
      const { data, error } = await admin
        .from('broadcast_project_members').update({ role }).eq('id', id).select().single();
      if (error) throw error;
      return json(res, 200, { member: data });
    }

    if (req.method === 'DELETE') {
      if (!id) return json(res, 400, { error: 'id required' });
      const { data: existing } = await admin
        .from('broadcast_project_members').select('project_id').eq('id', id).maybeSingle();
      if (!existing) return json(res, 404, { error: 'Not found' });
      const level = await projectAccessLevel(admin, existing.project_id, user.id);
      if (!canEdit(level)) return json(res, 403, { error: 'Forbidden' });
      const { error } = await admin.from('broadcast_project_members').delete().eq('id', id);
      if (error) throw error;
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return json(res, 500, { error: e.message || String(e) });
  }
};
