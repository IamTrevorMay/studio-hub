// api/triton-sso.js
// Vercel route: /api/triton-sso
//
// The Mayday half of Triton's "Continue with Mayday Studio" SSO. The
// /triton-sso page in the app calls this with the user's Mayday JWT; we
// verify the session, sign a 60-second HMAC assertion for the user's email,
// and hand back the Triton redirect URL. Triton's receiving endpoint
// (Triton-Tools: app/api/auth/mayday/route.ts, contract in that repo's
// docs/mayday-sso.md) verifies the signature and mints the Triton session.
// Passwords never leave Mayday.
//
// Env:
//   TRITON_SSO_SECRET — shared HMAC secret; must equal Triton's
//                       MAYDAY_SSO_SECRET.
//   TRITON_SSO_TARGET — Triton's receiving endpoint. Defaults to prod.
//
// Clients (external customers) are refused — SSO is for the team, and a
// fresh Triton account comes with Research access.

const { createHmac } = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
const TRITON_SSO_TARGET = process.env.TRITON_SSO_TARGET || 'https://tritonapex.io/api/auth/mayday';

const ALLOWED_ROLES = new Set(['admin', 'director', 'member', 'contractor']);

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.TRITON_SSO_SECRET;
  if (!secret) return res.status(500).json({ error: 'SSO not configured' });
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Supabase env missing' });
  }

  // Verify the caller's Mayday session (same pattern as api/_lib/broadcast/access.js).
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user || !user.email) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Role gate + display name; the user's own profile row is readable under RLS.
  const { data: profile } = await userClient
    .from('profiles')
    .select('role, full_name')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || !ALLOWED_ROLES.has(profile.role)) {
    return res.status(403).json({ error: 'Triton SSO is not available for this account' });
  }

  // Sign the assertion exactly per Triton's docs/mayday-sso.md: iat is unix
  // seconds, Triton rejects anything older than 60s, so sign per request.
  const payload = Buffer.from(JSON.stringify({
    email: user.email,
    name: profile.full_name || undefined,
    iat: Math.floor(Date.now() / 1000),
  })).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');

  return res.status(200).json({ url: `${TRITON_SSO_TARGET}?token=${payload}.${sig}` });
};
