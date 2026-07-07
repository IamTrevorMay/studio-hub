// api/pitch-video.js
// Vercel route: /api/pitch-video
//
// Same-origin proxy for Triton's pitch video archive API (search + resolve
// of archived Baseball Savant clips on the Mayday Cloud NAS). Validates a
// Mayday JWT, then forwards the query string to Triton with the consumer
// key held server-side so the browser bundle never ships it.
//
// Accepts the same GET query params as Triton's /api/pitch-video
// (see Triton-Tools/docs/pitch-video-api.md): pitcher, batter,
// pitcher_name, batter_name, team, pitch_type, event, description,
// date_from, date_to, game_year, velo_min, velo_max, stand, p_throws,
// balls, strikes, inning, zone, only_archived, limit, offset — or
// play_id / game_pk+ab+pitch for single resolve.
//
// Required Vercel env var:
//   TRITON_PITCH_VIDEO_KEY — consumer key registered in Triton's
//   PITCH_VIDEO_API_KEYS (NOT prefixed REACT_APP_)

const { proxyToTriton } = require('./_lib/tritonProxy');

module.exports = async (req, res) => {
  const key = process.env.TRITON_PITCH_VIDEO_KEY;
  if (!key) {
    res.status(500).setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'TRITON_PITCH_VIDEO_KEY not configured on Vercel function' }));
    return;
  }
  return proxyToTriton(req, res, '/api/pitch-video', {
    upstreamHeaders: { Authorization: `Bearer ${key}` },
  });
};
