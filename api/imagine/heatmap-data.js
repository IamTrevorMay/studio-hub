// api/imagine/heatmap-data.js
// Vercel route: /api/imagine/heatmap-data
//
// Proxies Triton's /api/imagine/heatmap-data so the Heat Maps + Heat Map
// Overlays widgets can call same-origin (avoids CORS) while Triton stays
// the system of record for the underlying pitches data.

const { proxyToTriton } = require('../_lib/tritonProxy');

module.exports = async (req, res) => {
  await proxyToTriton(req, res, '/api/imagine/heatmap-data');
};
