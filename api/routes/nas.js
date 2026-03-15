const express = require('express');
const router = express.Router();
const path = require('path');
const fetch = require('node-fetch');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

function getTrueNASConfig() {
  const apiUrl = process.env.TRUENAS_API_URL;
  const apiKey = process.env.TRUENAS_API_KEY;
  const assetsRoot = process.env.TRUENAS_ASSETS_ROOT;
  if (!apiUrl || !apiKey || !assetsRoot) {
    throw new Error('Missing TrueNAS env vars (TRUENAS_API_URL, TRUENAS_API_KEY, TRUENAS_ASSETS_ROOT)');
  }
  return { apiUrl, apiKey, assetsRoot };
}

function sanitizePath(requestedPath, assetsRoot) {
  const resolved = path.resolve(assetsRoot, requestedPath || '');
  if (!resolved.startsWith(assetsRoot)) {
    throw new Error('Path traversal blocked');
  }
  return resolved;
}

function getSupabaseServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function nasHeaders(apiKey) {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

// GET /api/nas/health — Check TrueNAS connectivity
router.get('/health', async (req, res) => {
  try {
    const { apiUrl, apiKey } = getTrueNASConfig();
    const response = await fetch(`${apiUrl}/system/info`, {
      headers: nasHeaders(apiKey),
    });
    if (!response.ok) {
      return res.json({ connected: false, error: `TrueNAS responded ${response.status}` });
    }
    const info = await response.json();
    res.json({
      connected: true,
      hostname: info.hostname,
      version: info.version,
      uptime_seconds: info.uptime_seconds,
    });
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

// GET /api/nas/list?path=/video&sort=name&order=asc — List directory contents
router.get('/list', async (req, res) => {
  try {
    const { apiUrl, apiKey, assetsRoot } = getTrueNASConfig();
    const requestedPath = req.query.path || '';
    const fullPath = sanitizePath(requestedPath, assetsRoot);
    const sort = req.query.sort || 'name';
    const order = req.query.order || 'asc';

    const response = await fetch(`${apiUrl}/filesystem/listdir`, {
      method: 'POST',
      headers: nasHeaders(apiKey),
      body: JSON.stringify({ path: fullPath }),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `TrueNAS error: ${text}` });
    }

    let items = await response.json();

    // Map to a clean shape
    items = items.map(item => ({
      name: item.name,
      path: path.relative(assetsRoot, item.path),
      type: item.type === 'DIRECTORY' ? 'directory' : 'file',
      size: item.size || 0,
      modified: item.mtime?.$date || item.mtime || null,
      extension: item.type !== 'DIRECTORY' ? path.extname(item.name).toLowerCase().slice(1) : null,
    }));

    // Sort
    items.sort((a, b) => {
      // Directories first
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      let cmp = 0;
      if (sort === 'size') cmp = a.size - b.size;
      else if (sort === 'modified') cmp = new Date(a.modified || 0) - new Date(b.modified || 0);
      else cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      return order === 'desc' ? -cmp : cmp;
    });

    res.json({ path: requestedPath || '/', items });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/nas/stat?path=/video/ep42.mp4 — Get single file metadata
router.get('/stat', async (req, res) => {
  try {
    const { apiUrl, apiKey, assetsRoot } = getTrueNASConfig();
    const requestedPath = req.query.path;
    if (!requestedPath) return res.status(400).json({ error: 'path query param required' });
    const fullPath = sanitizePath(requestedPath, assetsRoot);

    const response = await fetch(`${apiUrl}/filesystem/stat`, {
      method: 'POST',
      headers: nasHeaders(apiKey),
      body: JSON.stringify({ path: fullPath }),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `TrueNAS error: ${text}` });
    }

    const stat = await response.json();
    res.json({
      name: path.basename(fullPath),
      path: requestedPath,
      type: stat.type === 'DIRECTORY' ? 'directory' : 'file',
      size: stat.size || 0,
      modified: stat.mtime?.$date || stat.mtime || null,
      extension: path.extname(fullPath).toLowerCase().slice(1) || null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/nas/download?path=/video/ep42.mp4 — Stream file download
router.get('/download', async (req, res) => {
  try {
    const { apiUrl, apiKey, assetsRoot } = getTrueNASConfig();
    const requestedPath = req.query.path;
    if (!requestedPath) return res.status(400).json({ error: 'path query param required' });
    const fullPath = sanitizePath(requestedPath, assetsRoot);
    const fileName = path.basename(fullPath);

    const response = await fetch(`${apiUrl}/filesystem/get`, {
      method: 'POST',
      headers: nasHeaders(apiKey),
      body: JSON.stringify({ path: fullPath }),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `TrueNAS error: ${text}` });
    }

    // Set download headers
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    if (response.headers.get('content-type')) {
      res.setHeader('Content-Type', response.headers.get('content-type'));
    }
    if (response.headers.get('content-length')) {
      res.setHeader('Content-Length', response.headers.get('content-length'));
    }

    // Stream — no memory buffering
    response.body.pipe(res);

    // Log access asynchronously
    const userId = req.query.user_id;
    if (userId) {
      const sb = getSupabaseServiceClient();
      if (sb) {
        sb.from('nas_access_logs').insert({
          user_id: userId,
          action: 'download',
          nas_path: requestedPath,
          file_name: fileName,
        }).then(() => {}).catch(err => console.error('[NAS] Log error:', err.message));
      }
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/nas/upload — Upload file via multipart form
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { apiUrl, apiKey, assetsRoot } = getTrueNASConfig();
    const targetPath = req.body.path || '';
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const destDir = sanitizePath(targetPath, assetsRoot);
    const destPath = path.join(destDir, req.file.originalname);

    // Ensure destination is still within assets root
    if (!destPath.startsWith(assetsRoot)) {
      return res.status(400).json({ error: 'Path traversal blocked' });
    }

    const response = await fetch(`${apiUrl}/filesystem/put`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/octet-stream',
        'X-TrueNAS-Path': destPath,
      },
      body: req.file.buffer,
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `TrueNAS error: ${text}` });
    }

    // Log access
    const userId = req.body.user_id;
    if (userId) {
      const sb = getSupabaseServiceClient();
      if (sb) {
        sb.from('nas_access_logs').insert({
          user_id: userId,
          action: 'upload',
          nas_path: path.join(targetPath, req.file.originalname),
          file_name: req.file.originalname,
        }).then(() => {}).catch(err => console.error('[NAS] Log error:', err.message));
      }
    }

    res.json({ success: true, path: path.join(targetPath, req.file.originalname) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/nas/search?q=episode&dataset=video — Search files by name
router.get('/search', async (req, res) => {
  try {
    const { apiUrl, apiKey, assetsRoot } = getTrueNASConfig();
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'q query param required' });
    const dataset = req.query.dataset || '';
    const searchRoot = sanitizePath(dataset, assetsRoot);

    // List all files recursively and filter by name
    const response = await fetch(`${apiUrl}/filesystem/listdir`, {
      method: 'POST',
      headers: nasHeaders(apiKey),
      body: JSON.stringify({ path: searchRoot }),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `TrueNAS error: ${text}` });
    }

    let items = await response.json();
    const lowerQuery = query.toLowerCase();

    items = items
      .filter(item => item.name.toLowerCase().includes(lowerQuery))
      .map(item => ({
        name: item.name,
        path: path.relative(assetsRoot, item.path),
        type: item.type === 'DIRECTORY' ? 'directory' : 'file',
        size: item.size || 0,
        modified: item.mtime?.$date || item.mtime || null,
        extension: item.type !== 'DIRECTORY' ? path.extname(item.name).toLowerCase().slice(1) : null,
      }));

    res.json({ query, results: items });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
