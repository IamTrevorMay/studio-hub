const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');

// Shared auth helper — returns { drive, sheets } Google API clients
function getGoogleClients() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const credentialsPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;

  let auth;
  if (clientId && clientSecret && refreshToken) {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    auth = oauth2Client;
  } else if (credentialsPath) {
    auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
    });
  } else {
    throw new Error('No Google credentials configured');
  }

  return {
    drive: google.drive({ version: 'v3', auth }),
    sheets: google.sheets({ version: 'v4', auth }),
  };
}

// POST /api/drive/upload
// Body: { clips: [{ id, title, type, outputFormat, assignee, driveFolder }] }
router.post('/upload', async (req, res) => {
  const { clips } = req.body;

  if (!Array.isArray(clips) || clips.length === 0) {
    return res.status(400).json({ error: 'clips array is required' });
  }

  const outputDir = process.env.VIDEO_OUTPUT_DIR;
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

  if (!outputDir) return res.status(500).json({ error: 'VIDEO_OUTPUT_DIR not set in .env' });
  if (!rootFolderId) return res.status(500).json({ error: 'GOOGLE_DRIVE_ROOT_FOLDER_ID not set in .env' });

  let driveClient;
  try {
    const clients = getGoogleClients();
    driveClient = clients.drive;
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

// GET /api/drive/folders?parentId=
// Lists child folders of a parent (or root if no parentId)
router.get('/folders', async (req, res) => {
  try {
    const { drive } = getGoogleClients();
    const parentId = req.query.parentId || process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || 'root';

    const result = await drive.files.list({
      q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
      orderBy: 'name',
      pageSize: 200,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    res.json({ folders: result.data.files || [] });
  } catch (err) {
    console.error('[Drive] List folders error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/drive/create-folder
// Body: { parentId, name }
router.post('/create-folder', async (req, res) => {
  try {
    const { drive } = getGoogleClients();
    const { parentId, name } = req.body;

    if (!name) return res.status(400).json({ error: 'name is required' });

    const parent = parentId || process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || 'root';
    const result = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parent],
      },
      fields: 'id, name',
      supportsAllDrives: true,
    });

    res.json({ id: result.data.id, name: result.data.name });
  } catch (err) {
    console.error('[Drive] Create folder error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/drive/create-sheet
// Body: { folderId, title, beats }
// Creates a formatted Google Sheet and moves it into the target Drive folder
router.post('/create-sheet', async (req, res) => {
  try {
    const { drive, sheets } = getGoogleClients();
    const { folderId, title, beats } = req.body;

    if (!folderId) return res.status(400).json({ error: 'folderId is required' });
    if (!title) return res.status(400).json({ error: 'title is required' });

    // Build rows: header + one row per beat
    const headerRow = ['Beat + Context', 'Graphics', 'Videos'];
    const dataRows = (beats || []).map(b => [
      [b.title || '', b.context || ''].filter(Boolean).join('\n'),
      (b.graphics || []).join('\n'),
      (b.videos || []).join('\n'),
    ]);

    // Create the spreadsheet
    const createRes = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title },
        sheets: [{
          properties: { title: 'Beat Sheet' },
          data: [{
            startRow: 0,
            startColumn: 0,
            rowData: [
              { values: headerRow.map(h => ({ userEnteredValue: { stringValue: h } })) },
              ...dataRows.map(row => ({
                values: row.map(cell => ({ userEnteredValue: { stringValue: cell } })),
              })),
            ],
          }],
        }],
      },
    });

    const spreadsheetId = createRes.data.spreadsheetId;
    const sheetId = createRes.data.sheets[0].properties.sheetId;

    // Format: column widths, text wrapping, bold header
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          // Column widths
          { updateDimensionProperties: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
            properties: { pixelSize: 400 },
            fields: 'pixelSize',
          }},
          { updateDimensionProperties: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 },
            properties: { pixelSize: 250 },
            fields: 'pixelSize',
          }},
          { updateDimensionProperties: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 },
            properties: { pixelSize: 250 },
            fields: 'pixelSize',
          }},
          // Text wrapping for all cells
          { repeatCell: {
            range: { sheetId },
            cell: { userEnteredFormat: { wrapStrategy: 'WRAP' } },
            fields: 'userEnteredFormat.wrapStrategy',
          }},
          // Bold header row
          { repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
                backgroundColor: { red: 0.15, green: 0.15, blue: 0.2 },
              },
            },
            fields: 'userEnteredFormat.textFormat.bold,userEnteredFormat.backgroundColor',
          }},
        ],
      },
    });

    // Move into target Drive folder
    const fileRes = await drive.files.get({
      fileId: spreadsheetId,
      fields: 'parents',
      supportsAllDrives: true,
    });
    const previousParents = (fileRes.data.parents || []).join(',');
    await drive.files.update({
      fileId: spreadsheetId,
      addParents: folderId,
      removeParents: previousParents,
      supportsAllDrives: true,
    });

    const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    res.json({ sheetUrl });
  } catch (err) {
    console.error('[Drive] Create sheet error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
