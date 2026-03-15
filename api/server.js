require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');

const videosRouter = require('./routes/videos');
const driveRouter = require('./routes/drive');
const discordRouter = require('./routes/discord');
const kanbanRouter = require('./routes/kanban');
const nasRouter = require('./routes/nas');

const app = express();
const PORT = process.env.PORT || 4400;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'mayday-postshow-api', port: PORT });
});

app.use('/api/videos', videosRouter);
app.use('/api/drive', driveRouter);
app.use('/api/discord', discordRouter);
app.use('/api/kanban', kanbanRouter);
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
