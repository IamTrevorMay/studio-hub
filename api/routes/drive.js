const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');

// POST /api/drive/upload
// Body: { clips: [{ id, title, type, outputFormat, assignee, driveFolder }] }
router.post('/upload', async (req, res) => {
  const { clips } = req.body;

  if (!Array.isArray(clips) || clips.length === 0) {
    return res.status(400).json({ error: 'clips array is required' });
  }

  const outputDir = process.env.VIDEO_OUTPUT_DIR;
  const credentialsPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

  if (!outputDir) return res.status(500).json({ error: 'VIDEO_OUTPUT_DIR not set in .env' });
  if (!credentialsPath) return res.status(500).json({ error: 'GOOGLE_SERVICE_ACCOUNT_PATH not set in .env' });
  if (!rootFolderId) return res.status(500).json({ error: 'GOOGLE_DRIVE_ROOT_FOLDER_ID not set in .env' });

  let driveClient;
  try {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

    if (clientId && clientSecret && refreshToken) {
      // Use OAuth2 (uploads as you, uses your Drive quota)
      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      driveClient = google.drive({ version: 'v3', auth: oauth2Client });
    } else {
      // Fallback to service account
      const auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ['https://www.googleapis.com/auth/drive'],
      });
      driveClient = google.drive({ version: 'v3', auth });
    }
  } catch (err) {
    return res.status(500).json({ error: `Google auth failed: ${err.message}` });
  }

  const results = [];
  const folderCache = {};

  for (const clip of clips) {
    const { id, title, outputFormat = 'mp4', driveFolder } = clip;

    const safeTitle = title.replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '_');
    const fileName = `${safeTitle}.${outputFormat}`;
    const localPath = path.join(outputDir, fileName);

    if (!fs.existsSync(localPath)) {
      results.push({ id, success: false, error: `Cut file not found: ${localPath}. Run Phase 1 (Cut) first.` });
      continue;
    }

    try {
      // Resolve or create the Drive folder path
      console.log(`[Drive] "${title}" → driveFolder: "${driveFolder || '(none)'}"`);
      const targetFolderId = await resolveFolder(driveClient, rootFolderId, driveFolder, folderCache);

      // Upload the file
      const uploadRes = await driveClient.files.create({
        requestBody: {
          name: fileName,
          parents: [targetFolderId],
        },
        media: {
          mimeType: outputFormat === 'mov' ? 'video/quicktime' : 'video/mp4',
          body: fs.createReadStream(localPath),
        },
        fields: 'id, webViewLink',
      });

      const driveLink = uploadRes.data.webViewLink || `https://drive.google.com/file/d/${uploadRes.data.id}/view`;
      results.push({ id, success: true, driveLink });
    } catch (err) {
      console.error(`[Drive] Upload failed for "${title}":`, err.message);
      results.push({ id, success: false, error: err.message });
    }
  }

  res.json({ results });
});

// Resolves a slash-separated folder path under the root folder, creating folders as needed
async function resolveFolder(drive, rootId, folderPath, cache) {
  if (!folderPath) return rootId;

  const parts = folderPath.split('/').map(s => s.trim()).filter(Boolean);
  let currentId = rootId;

  for (const part of parts) {
    const cacheKey = `${currentId}/${part}`;
    if (cache[cacheKey]) {
      currentId = cache[cacheKey];
      continue;
    }

    // Search for existing folder
    const searchRes = await drive.files.list({
      q: `'${currentId}' in parents and name = '${part}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    if (searchRes.data.files.length > 0) {
      currentId = searchRes.data.files[0].id;
    } else {
      // Create the folder
      const createRes = await drive.files.create({
        requestBody: {
          name: part,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [currentId],
        },
        fields: 'id',
        supportsAllDrives: true,
      });
      currentId = createRes.data.id;
    }

    cache[cacheKey] = currentId;
  }

  return currentId;
}

module.exports = router;
