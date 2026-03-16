require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');

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
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'mayday-postshow-api', port: PORT });
});

if (videosRouter) app.use('/api/videos', videosRouter);
if (driveRouter) app.use('/api/drive', driveRouter);
if (discordRouter) app.use('/api/discord', discordRouter);
if (kanbanRouter) app.use('/api/kanban', kanbanRouter);
app.use('/api/nas', nasRouter);

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
