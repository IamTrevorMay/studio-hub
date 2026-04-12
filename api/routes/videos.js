const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath('/opt/homebrew/bin/ffmpeg');

// POST /api/videos/cut
// Body: { sourceFile: string, clips: [{ id, title, startTime, endTime, type, outputFormat }] }
router.post('/cut', async (req, res) => {
  const { sourceFile, clips } = req.body;

  if (!sourceFile || !Array.isArray(clips) || clips.length === 0) {
    return res.status(400).json({ error: 'sourceFile and clips array are required' });
  }

  const sourceDir = process.env.VIDEO_SOURCE_DIR;
  const outputDir = process.env.VIDEO_OUTPUT_DIR;

  if (!sourceDir || !outputDir) {
    return res.status(500).json({ error: 'VIDEO_SOURCE_DIR and VIDEO_OUTPUT_DIR must be set in .env' });
  }

  // Find the source file in the source directory
  const sourcePath = path.join(sourceDir, sourceFile);
  if (!fs.existsSync(sourcePath)) {
    return res.status(404).json({
      error: `Source file not found: ${sourcePath}\n\nMake sure the file is in VIDEO_SOURCE_DIR (${sourceDir})`,
    });
  }

  const results = [];

  for (const clip of clips) {
    const { id, title, startTime, endTime, outputFormat = 'mp4' } = clip;

    // Sanitize title for use as filename
    const safeTitle = title.replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '_');
    const outputFileName = `${safeTitle}.${outputFormat}`;
    const outputPath = path.join(outputDir, outputFileName);

    try {
      await cutClip(sourcePath, outputPath, startTime, endTime);
      results.push({ id, success: true, outputPath, outputFileName });
    } catch (err) {
      console.error(`[Cut] Failed for clip "${title}":`, err.message);
      results.push({ id, success: false, error: err.message });
    }
  }

  res.json({ results });
});

function cutClip(sourcePath, outputPath, startTime, endTime) {
  return new Promise((resolve, reject) => {
    ffmpeg(sourcePath)
      .setStartTime(startTime)
      .setDuration(getDurationSeconds(startTime, endTime))
      .output(outputPath)
      .outputOptions(['-c:v copy', '-c:a copy'])
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

function getDurationSeconds(startTime, endTime) {
  const start = parseTimestamp(startTime);
  const end = parseTimestamp(endTime);
  return end - start;
}

function parseTimestamp(ts) {
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

module.exports = router;
