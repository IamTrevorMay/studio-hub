// Harbor archiver debug/status route.
//
// GET /api/harbor/archive-status?limit=10
//   → archiver runtime state (enabled, ffmpeg, last tick summary) + the most
//     recent ended sessions with per-track statuses and NAS paths.
//
// Auth: bearer CLOUD_API_KEY — the same credential the cloud-folders edge
// function already presents to this API (`Authorization: Bearer <key>`).
// Fails closed: no key configured server-side → 503, wrong/missing bearer
// → 401. (The nas/* routes predate this and carry no in-route gate; new
// routes should not repeat that.)

const express = require('express');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { getArchiverStatus } = require('../harbor/archiver');

const router = express.Router();

function getSupabaseServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

router.use((req, res, next) => {
  const expected = process.env.CLOUD_API_KEY;
  if (!expected) return res.status(503).json({ error: 'CLOUD_API_KEY not configured' });
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !timingSafeEqualStr(token, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
});

// GET /api/harbor/archive-status
router.get('/archive-status', async (req, res) => {
  try {
    const sb = getSupabaseServiceClient();
    if (!sb) return res.status(503).json({ error: 'Supabase service client not configured' });

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const { data: sessions, error } = await sb
      .from('harbor_sessions')
      .select(
        'id, title, status, ended_at, archived_at, harbor_tracks(id, kind, status, chunk_count, bytes_uploaded, nas_path, archived_at)',
      )
      .eq('status', 'ended')
      .order('ended_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);

    res.json({ archiver: getArchiverStatus(), sessions: sessions || [] });
  } catch (err) {
    console.error('[Harbor] archive-status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
