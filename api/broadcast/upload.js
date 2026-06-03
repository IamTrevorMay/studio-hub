// Helper for the in-browser tus-js-client uploader.
//
// Returns the Supabase Storage resumable-upload endpoint, the headers
// the client needs (Bearer + apikey + x-upsert), and the storage path
// to use. Also logs any upload >100 MB to the server console for the
// audit trail the decisions doc calls for.
//
//   POST /api/broadcast/upload
//     { project_id, file_name, file_size?, content_type? }
//   → { endpoint, headers, bucket, path }
//
// The actual tus PUT happens directly from the browser to Supabase, so
// we never proxy the bytes through Vercel. Files up to 5 GB are
// supported by Supabase Pro out of the box.

const {
  json, applyCors, requireUser,
  projectAccessLevel, canEdit,
} = require('../_lib/broadcast/access');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
const HUGE_FILE_THRESHOLD = 100 * 1024 * 1024; // 100 MB

module.exports = async (req, res) => {
  applyCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const ctx = await requireUser(req, res);
  if (!ctx) return;
  const { user, admin } = ctx;
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  if (!body.project_id || !body.file_name) {
    return json(res, 400, { error: 'project_id + file_name required' });
  }
  const level = await projectAccessLevel(admin, body.project_id, user.id);
  if (!canEdit(level)) return json(res, 403, { error: 'Forbidden' });

  const safeName = String(body.file_name)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 200);
  const stamp = Date.now().toString(36);
  const path = `${body.project_id}/${stamp}-${safeName}`;

  if (typeof body.file_size === 'number' && body.file_size > HUGE_FILE_THRESHOLD) {
    // eslint-disable-next-line no-console
    console.warn('[broadcast/upload] large upload', {
      project_id: body.project_id, user_id: user.id, path,
      size_bytes: body.file_size, content_type: body.content_type || null,
    });
  }

  // The client uses the session's user JWT for the Bearer; the Vercel
  // function passes through the same auth header so it stays attached
  // to the storage call. The anon key is required as x-apikey.
  const headers = {
    Authorization: req.headers['authorization'],
    apikey: SUPABASE_ANON_KEY,
    'x-upsert': 'true',
  };

  return json(res, 200, {
    endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
    headers,
    bucket: 'broadcast-assets',
    path,
    public_url: `${SUPABASE_URL}/storage/v1/object/public/broadcast-assets/${encodeURI(path)}`,
  });
};
