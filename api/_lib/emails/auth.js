// Shared auth + supabase client helpers for the Vercel email routes.
//
// Pattern from api/imagine-render.js — validate the user-supplied JWT
// via supabase.auth.getUser(), then check role via the profiles table.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function createUserClient(authHeader) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase URL/anon key missing on Vercel function env');
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
}

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase URL/service-role key missing on Vercel function env');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// Validate JWT, check admin role. Returns { user, supabase, admin } on
// success or null after writing 401/403 (caller should just return).
async function requireAdmin(req, res) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    json(res, 401, { error: 'Unauthorized' });
    return null;
  }
  let supabase;
  try {
    supabase = createUserClient(authHeader);
  } catch (e) {
    json(res, 500, { error: e.message });
    return null;
  }
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    json(res, 401, { error: 'Unauthorized' });
    return null;
  }
  const admin = createServiceClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || profile.role !== 'admin') {
    json(res, 403, { error: 'Admin role required' });
    return null;
  }
  return { user, supabase, admin };
}

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, apikey');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
}

module.exports = { json, createUserClient, createServiceClient, requireAdmin, applyCors };
