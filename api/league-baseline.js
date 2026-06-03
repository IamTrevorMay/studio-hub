// api/league-baseline.js
// Vercel route: /api/league-baseline
//
// Proxies Triton's /api/league-baseline so the Heat Maps widget can fetch
// the league-average zMid/zSpan reference values same-origin.

const { proxyToTriton } = require('./_lib/tritonProxy');

module.exports = async (req, res) => {
  await proxyToTriton(req, res, '/api/league-baseline');
};
