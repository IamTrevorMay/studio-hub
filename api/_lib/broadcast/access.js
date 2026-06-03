// Shared auth + access-check helpers for the Vercel broadcast routes.
//
// Three guarantees the helpers in this file give you:
//   1. requireUser → 401 if no valid JWT in Authorization header.
//   2. requireProducer → 403 if user isn't admin/producer (used by
//      project creation routes).
//   3. checkProjectAccess → resolves the user's effective role on a
//      specific project ('owner'|'producer'|'viewer'|'none'). Sources
//      from the SQL helper public.broadcast_project_access_level so the
//      logic stays in one place.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, apikey');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
}

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase service-role env missing');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function createUserClient(authHeader) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase anon env missing');
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
}

// Validates JWT and resolves the user's profile.role. Returns
// { user, profile, admin } or null after writing a 401.
async function requireUser(req, res) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    json(res, 401, { error: 'Unauthorized' });
    return null;
  }
  let userClient;
  try { userClient = createUserClient(authHeader); }
  catch (e) { json(res, 500, { error: e.message }); return null; }

  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) { json(res, 401, { error: 'Unauthorized' }); return null; }

  const admin = createServiceClient();
  const { data: profile } = await admin
    .from('profiles').select('id, role, email').eq('id', user.id).maybeSingle();
  return { user, profile: profile || null, admin };
}

const PRODUCER_TIER_ROLES = new Set([
  'admin', 'producer', 'director_creative', 'director_comms',
]);

// 403 if not producer-tier.
async function requireProducer(req, res) {
  const ctx = await requireUser(req, res);
  if (!ctx) return null;
  if (!ctx.profile || !PRODUCER_TIER_ROLES.has(ctx.profile.role)) {
    json(res, 403, { error: 'Producer role required' });
    return null;
  }
  return ctx;
}

// Resolves the project access level for a user, by calling the SQL
// helper. Returns one of 'owner' | 'producer' | 'viewer' | 'none'.
async function projectAccessLevel(admin, projectId, userId) {
  const { data, error } = await admin.rpc('broadcast_project_access_level', {
    p_project_id: projectId, p_uid: userId,
  });
  if (error) return 'none';
  return data || 'none';
}

function canEdit(level) {
  return level === 'owner' || level === 'producer';
}
function canRead(level) {
  return level === 'owner' || level === 'producer' || level === 'viewer';
}

module.exports = {
  json, applyCors,
  createServiceClient, createUserClient,
  requireUser, requireProducer,
  projectAccessLevel, canEdit, canRead,
  PRODUCER_TIER_ROLES,
};
