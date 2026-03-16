const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

const ASSETS_ROOT = process.env.ASSETS_ROOT || '/Volumes/May Server';

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

function getMimeType(ext) {
  const types = {
    mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo', mkv: 'video/x-matroska',
    mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    pdf: 'application/pdf', zip: 'application/zip',
  };
  return types[ext] || 'application/octet-stream';
}

// GET /api/nas/health — Check that the local SSD is mounted and accessible
router.get('/health', async (req, res) => {
  try {
    await fsp.access(ASSETS_ROOT, fs.constants.R_OK | fs.constants.W_OK);
    res.json({ connected: true, assetsRoot: ASSETS_ROOT });
  } catch (err) {
    res.json({ connected: false, error: `Cannot access ${ASSETS_ROOT}: ${err.message}` });
  }
});

// GET /api/nas/list?path=/video&sort=name&order=asc — List directory contents
router.get('/list', async (req, res) => {
  try {
    const requestedPath = req.query.path || '';
    const fullPath = sanitizePath(requestedPath, ASSETS_ROOT);
    const sort = req.query.sort || 'name';
    const order = req.query.order || 'asc';

    const entries = await fsp.readdir(fullPath, { withFileTypes: true });

    let items = (await Promise.all(entries.map(async (entry) => {
      try {
        const entryPath = path.join(fullPath, entry.name);
        const stat = await fsp.stat(entryPath);
        const isDir = entry.isDirectory();
        return {
          name: entry.name,
          path: path.relative(ASSETS_ROOT, entryPath),
          type: isDir ? 'directory' : 'file',
          size: stat.size,
          modified: stat.mtime.toISOString(),
          extension: isDir ? null : path.extname(entry.name).toLowerCase().slice(1) || null,
        };
      } catch {
        return null; // skip inaccessible entries
      }
    }))).filter(Boolean);

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
    const requestedPath = req.query.path;
    if (!requestedPath) return res.status(400).json({ error: 'path query param required' });
    const fullPath = sanitizePath(requestedPath, ASSETS_ROOT);

    const stat = await fsp.stat(fullPath);
    res.json({
      name: path.basename(fullPath),
      path: requestedPath,
      type: stat.isDirectory() ? 'directory' : 'file',
      size: stat.size,
      modified: stat.mtime.toISOString(),
      extension: path.extname(fullPath).toLowerCase().slice(1) || null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/nas/download?path=/video/ep42.mp4 — Stream file download
router.get('/download', async (req, res) => {
  try {
    const requestedPath = req.query.path;
    if (!requestedPath) return res.status(400).json({ error: 'path query param required' });
    const fullPath = sanitizePath(requestedPath, ASSETS_ROOT);
    const fileName = path.basename(fullPath);

    const stat = await fsp.stat(fullPath);
    if (stat.isDirectory()) {
      return res.status(400).json({ error: 'Cannot download a directory' });
    }

    const ext = path.extname(fileName).toLowerCase().slice(1);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', getMimeType(ext));
    res.setHeader('Content-Length', stat.size);

    const stream = fs.createReadStream(fullPath);
    stream.pipe(res);

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
    const targetPath = req.body.path || '';
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const destDir = sanitizePath(targetPath, ASSETS_ROOT);
    const destPath = path.join(destDir, req.file.originalname);

    // Ensure destination is still within assets root
    if (!destPath.startsWith(ASSETS_ROOT)) {
      return res.status(400).json({ error: 'Path traversal blocked' });
    }

    // Ensure target directory exists
    await fsp.mkdir(destDir, { recursive: true });
    await fsp.writeFile(destPath, req.file.buffer);

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
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'q query param required' });
    const dataset = req.query.dataset || '';
    const searchRoot = sanitizePath(dataset, ASSETS_ROOT);
    const lowerQuery = query.toLowerCase();

    async function walk(dir) {
      let results = [];
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return results; // skip inaccessible directories
      }
      for (const entry of entries) {
        try {
          const entryPath = path.join(dir, entry.name);
          const isDir = entry.isDirectory();

          if (entry.name.toLowerCase().includes(lowerQuery)) {
            const stat = await fsp.stat(entryPath);
            results.push({
              name: entry.name,
              path: path.relative(ASSETS_ROOT, entryPath),
              type: isDir ? 'directory' : 'file',
              size: stat.size,
              modified: stat.mtime.toISOString(),
              extension: isDir ? null : path.extname(entry.name).toLowerCase().slice(1) || null,
            });
          }

          if (isDir) {
            const subResults = await walk(entryPath);
            results = results.concat(subResults);
          }
        } catch {
          continue; // skip inaccessible entries
        }
      }
      return results;
    }

    const results = await walk(searchRoot);
    res.json({ query, results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
