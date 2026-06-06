// api/headshot.js
// Vercel route: /api/headshot
//
// Fetches an MLB player headshot (or arbitrary allow-listed image URL) and
// re-serves it with permissive CORS headers so the Imagine canvas renderer
// can draw it without tainting the canvas. Canvas taint blocks the export
// `toBlob()` with SecurityError, so every player-image card export fails
// otherwise.
//
// Query params:
//   id    — MLB player id (preferred). Builds the standard headshot URL.
//   url   — Optional override; only allowed for hosts on `ALLOWED_HOSTS`.
//
// No auth: headshots are public CDN assets. Rate-limited by Vercel's
// regional cap; if abuse becomes a concern, gate with the Mayday JWT.

const ALLOWED_HOSTS = new Set([
  'img.mlbstatic.com',
  'midfield.mlbstatic.com',
  'mlb-photos.mlbstatic.com',
]);

function headshotUrlForId(id) {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${id}/headshot/67/current`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let target = null;
  const id = req.query?.id || new URL(req.url, 'http://x').searchParams.get('id');
  const url = req.query?.url || new URL(req.url, 'http://x').searchParams.get('url');
  if (id && /^\d{1,8}$/.test(String(id))) {
    target = headshotUrlForId(id);
  } else if (url) {
    try {
      const u = new URL(url);
      if (ALLOWED_HOSTS.has(u.host)) target = u.toString();
    } catch { /* fall through */ }
  }
  if (!target) return res.status(400).json({ error: 'invalid id or url' });

  let upstream;
  try {
    upstream = await fetch(target, { signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    return res.status(502).json({ error: `headshot fetch failed: ${err.message}` });
  }
  if (!upstream.ok) {
    return res.status(upstream.status).json({ error: `upstream ${upstream.status}` });
  }
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
  res.status(200).send(buf);
};
