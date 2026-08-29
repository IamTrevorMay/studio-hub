// api/triton-scores.js
// Vercel route: /api/triton-scores
//
// Proxies Triton's /api/scores so the News page's Scores tab shows the same
// scoreboard Triton does — same day boundary, same live fields (inning, outs,
// runners, current pitcher/batter, probables).
//
// Triton's route is public but sends no Access-Control-Allow-Origin, so a
// browser fetch straight to tritonapex.io would be blocked. Proxying makes it
// same-origin and adds Mayday-side auth.
//
// Query params are forwarded verbatim, so `?date=YYYY-MM-DD` works.

const { proxyToTriton } = require('./_lib/tritonProxy');

module.exports = async (req, res) => {
  await proxyToTriton(req, res, '/api/scores');
};
