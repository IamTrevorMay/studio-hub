require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const nasRouter = require('./routes/nas');

// Optional route modules — load if present
function tryRequire(mod) { try { return require(mod); } catch { return null; } }
const videosRouter = tryRequire('./routes/videos');
const driveRouter = tryRequire('./routes/drive');
const discordRouter = tryRequire('./routes/discord');
const kanbanRouter = tryRequire('./routes/kanban');

const app = express();
const PORT = process.env.PORT || 4400;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'mayday-postshow-api', port: PORT });
});

if (videosRouter) app.use('/api/videos', videosRouter);
if (driveRouter) app.use('/api/drive', driveRouter);
if (discordRouter) app.use('/api/discord', discordRouter);
if (kanbanRouter) app.use('/api/kanban', kanbanRouter);
app.use('/api/nas', nasRouter);

// Pitch video archive proxy (Vercel-style handler at api/pitch-video.js).
// Mounted here so local dev can exercise it; needs TRITON_PITCH_VIDEO_KEY
// in api/.env.
const pitchVideoHandler = tryRequire('./pitch-video');
if (pitchVideoHandler) app.all('/api/pitch-video', (req, res) => pitchVideoHandler(req, res));

// Triton player-search proxy (Vercel-style handler at api/triton-search.js).
// Used by PlayerSearchField + the Beat Sheets Find Assets modal; needs
// TRITON_SUPABASE_URL / TRITON_SUPABASE_ANON_KEY in api/.env for local dev.
const tritonSearchHandler = tryRequire('./triton-search');
if (tritonSearchHandler) app.all('/api/triton-search', (req, res) => tritonSearchHandler(req, res));

// Vercel-style serverless handlers live in api/broadcast/*.js as
// `module.exports = async (req, res) => {...}`. Mount each one at
// /api/broadcast/<name> so local dev exercises the same code path that
// runs in production. Add new files here and they show up
// automatically — no manual route table needed.
const broadcastDir = path.join(__dirname, 'broadcast');
if (fs.existsSync(broadcastDir)) {
  for (const file of fs.readdirSync(broadcastDir)) {
    if (!file.endsWith('.js')) continue;
    const slug = file.replace(/\.js$/, '');
    const handler = require(path.join(broadcastDir, file));
    if (typeof handler !== 'function') continue;
    app.all(`/api/broadcast/${slug}`, (req, res) => handler(req, res));
  }
}

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: err.message });
});

// Ensure output directory exists
const outputDir = process.env.VIDEO_OUTPUT_DIR;
if (outputDir && !fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`Created output directory: ${outputDir}`);
}

app.listen(PORT, () => {
  console.log(`\nMayday Post-Show API running on http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health\n`);
});
