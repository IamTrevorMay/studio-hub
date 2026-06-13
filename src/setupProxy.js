// CRA dev-server proxy. Forwards /api/* to the local Express server
// (api/server.js) on port 4400 so the broadcast routes — and any other
// Vercel-style handlers — are reachable from the browser during
// development. In production Vercel serves these directly.

const { createProxyMiddleware } = require('http-proxy-middleware');

const TARGET = process.env.LOCAL_API_URL || 'http://localhost:4400';

module.exports = function (app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: TARGET,
      changeOrigin: true,
      ws: false,
      logLevel: 'warn',
    }),
  );
};
