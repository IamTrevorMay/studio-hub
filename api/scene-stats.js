// api/scene-stats.js
// Vercel route: /api/scene-stats
//
// Proxies Triton's /api/scene-stats so the Top 5 Leaderboard, Player Stats,
// and Team Stats widgets can call same-origin with Mayday-side JWT auth
// instead of hitting tritonapex.io directly from the browser.

const { proxyToTriton } = require('./_lib/tritonProxy');

module.exports = async (req, res) => {
  await proxyToTriton(req, res, '/api/scene-stats');
};
