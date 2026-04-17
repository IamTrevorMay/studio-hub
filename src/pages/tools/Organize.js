import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SUPPORTED_EXTENSIONS, getFileExtension, getMediaCategory, sanitizeFilename } from './organize/organizeConstants';
import { readMetadata, writeMetadata, readBackup, writeBackup, deleteBackup, writeXmpSidecar, removeXmpSidecar } from './organize/organizeStorage';
import OrganizeToolbar from './organize/OrganizeToolbar';
import FileGrid from './organize/FileGrid';
import FileList from './organize/FileList';
import MediaPreview from './organize/MediaPreview';
import BatchBar from './organize/BatchBar';

function isSupported() {
  return typeof window.showDirectoryPicker === 'function';
}

async function scanDirectory(dirHandle, basePath = '') {
  const files = [];
  for await (const [name, handle] of dirHandle) {
    if (name.startsWith('_organize')) continue;
    const path = basePath ? `${basePath}/${name}` : name;
    if (handle.kind === 'file') {
      const ext = getFileExtension(name);
      if (SUPPORTED_EXTENSIONS.has(ext)) {
        const file = await handle.getFile();
        const thumbUrl = URL.createObjectURL(file);
        files.push({
          name,
          nameNoExt: name.replace(/\.[^.]+$/, ''),
          path,
          ext,
          handle,
          dirHandle,
          thumbUrl,
          size: file.size,
        });
      }
    } else if (handle.kind === 'directory') {
      const subFiles = await scanDirectory(handle, path);
      files.push(...subFiles);
    }
  }
  return files;
}

function isMetaComplete(meta) {
  return meta && meta.type && meta.subtype && meta.title;
}

async function getOrCreateSubdir(rootHandle, pathParts) {
  let current = rootHandle;
  for (const part of pathParts) {
    current = await current.getDirectoryHandle(part, { create: true });
  }
  return current;
}

async function getSubdir(rootHandle, pathParts) {
  let current = rootHandle;
  for (const part of pathParts) {
    try {
      current = await current.getDirectoryHandle(part);
    } catch {
      return null;
    }
  }
  return current;
}

async function removeEmptyDirs(rootHandle, path) {
  const parts = path.split('/');
  for (let i = parts.length - 1; i >= 0; i--) {
    const parentParts = parts.slice(0, i);
    const dirName = parts[i];
    const parent = parentParts.length > 0
      ? await getSubdir(rootHandle, parentParts)
      : rootHandle;
    if (!parent) break;
    try {
      const dir = await parent.getDirectoryHandle(dirName);
      let empty = true;
      for await (const _ of dir) { empty = false; break; }
      if (empty) {
        await parent.removeEntry(dirName);
      } else {
        break;
      }
    } catch {
      break;
    }
  }
}

export default function Organize({ onBack }) {
  const [dirHandle, setDirHandle] = useState(null);
  const [files, setFiles] = useState([]);
  const [metadata, setMetadata] = useState({});
  const [viewMode, setViewMode] = useState('grid');
  const [previewFile, setPreviewFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [hasBackup, setHasBackup] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState(new Set());
  const saveTimer = useRef(null);

  const saveMetadata = useCallback((meta) => {
    if (!dirHandle) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      writeMetadata(dirHandle, meta).catch(console.error);
    }, 1000);
  }, [dirHandle]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  async function pickFolder() {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      setDirHandle(handle);
      setLoading(true);
      const [scannedFiles, savedMeta, backup] = await Promise.all([
        scanDirectory(handle),
        readMetadata(handle),
        readBackup(handle),
      ]);
      setFiles(scannedFiles);
      setMetadata(savedMeta);
      setHasBackup(!!backup);
      setSelectedPaths(new Set());
      setLoading(false);
    } catch (err) {
      if (err.name !== 'AbortError') console.error(err);
      setLoading(false);
    }
  }

  function handleMetaChange(filePath, meta) {
    setMetadata(prev => {
      const next = { ...prev, [filePath]: meta };
      saveMetadata(next);
      return next;
    });
  }

  function handleToggleSelect(filePath) {
    setSelectedPaths(prev => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }

  function handleSelectAll() {
    setSelectedPaths(new Set(files.map(f => f.path)));
  }

  function handleDeselectAll() {
    setSelectedPaths(new Set());
  }

  function handleBatchUpdate({ type, subtype }) {
    setMetadata(prev => {
      const next = { ...prev };
      for (const path of selectedPaths) {
        const existing = next[path] || {};
        next[path] = {
          ...existing,
          type,
          ...(subtype ? { subtype } : {}),
        };
      }
      saveMetadata(next);
      return next;
    });
    setSelectedPaths(new Set());
  }

  async function handleOrganize() {
    if (!dirHandle || organizing) return;
    setOrganizing(true);
    try {
      // Build backup of current locations
      const backup = {};
      const toMove = [];
      for (const file of files) {
        const meta = metadata[file.path];
        if (isMetaComplete(meta)) {
          const newName = sanitizeFilename(meta.title) + '.' + file.ext;
          backup[file.path] = {
            type: meta.type,
            subtype: meta.subtype,
            originalName: file.name,
            newName,
          };
          toMove.push(file);
        }
      }
      if (toMove.length === 0) { setOrganizing(false); return; }

      await writeBackup(dirHandle, backup);
      setHasBackup(true);

      // Move and rename files, write XMP sidecars
      for (const file of toMove) {
        const meta = metadata[file.path];
        const info = backup[file.path];
        const destParts = [meta.type, meta.subtype];
        const destDir = await getOrCreateSubdir(dirHandle, destParts);
        const destPath = `${meta.type}/${meta.subtype}/${info.newName}`;

        // Skip if already in correct location with correct name
        if (file.path === destPath) {
          await writeXmpSidecar(destDir, info.newName, meta);
          continue;
        }

        // Read file data, write to new location with new name, remove old
        const fileData = await file.handle.getFile();
        const newHandle = await destDir.getFileHandle(info.newName, { create: true });
        const writable = await newHandle.createWritable();
        await writable.write(await fileData.arrayBuffer());
        await writable.close();

        // Write XMP sidecar next to the organized file
        await writeXmpSidecar(destDir, info.newName, meta);

        // Remove from original location
        const origParts = file.path.split('/');
        const origName = origParts.pop();
        const origParent = origParts.length > 0
          ? await getSubdir(dirHandle, origParts)
          : dirHandle;
        if (origParent) {
          await origParent.removeEntry(origName);
          if (origParts.length > 0) {
            await removeEmptyDirs(dirHandle, origParts.join('/'));
          }
        }

        // Update metadata key
        setMetadata(prev => {
          const next = { ...prev };
          if (file.path !== destPath) {
            next[destPath] = next[file.path];
            delete next[file.path];
          }
          return next;
        });
      }

      // Rescan
      const scannedFiles = await scanDirectory(dirHandle);
      setFiles(scannedFiles);
      // Save updated metadata
      setMetadata(prev => {
        writeMetadata(dirHandle, prev).catch(console.error);
        return prev;
      });
    } catch (err) {
      console.error('Organize error:', err);
    }
    setOrganizing(false);
  }

  async function handleRevert() {
    if (!dirHandle) return;
    setOrganizing(true);
    try {
      const backup = await readBackup(dirHandle);
      if (!backup) { setOrganizing(false); return; }

      // For each entry in backup, move from Type/Subtype/newName back to original path with original name
      for (const [origPath, info] of Object.entries(backup)) {
        const currentName = info.newName || origPath.split('/').pop();
        const currentPath = `${info.type}/${info.subtype}/${currentName}`;
        const currentParts = [info.type, info.subtype];
        const currentParent = await getSubdir(dirHandle, currentParts);

        if (!currentParent) continue;

        let fileHandle;
        try {
          fileHandle = await currentParent.getFileHandle(currentName);
        } catch {
          continue; // file not found at expected location
        }

        // Remove XMP sidecar from organized location
        await removeXmpSidecar(currentParent, currentName);

        // Read and write to original location with original name
        const origParts = origPath.split('/');
        const origName = origParts.pop();
        const origParent = origParts.length > 0
          ? await getOrCreateSubdir(dirHandle, origParts)
          : dirHandle;

        if (origPath === currentPath) continue;

        const fileData = await fileHandle.getFile();
        const newHandle = await origParent.getFileHandle(origName, { create: true });
        const writable = await newHandle.createWritable();
        await writable.write(await fileData.arrayBuffer());
        await writable.close();

        // Remove from organized location
        await currentParent.removeEntry(currentName);
        if (currentParts.length > 0) {
          await removeEmptyDirs(dirHandle, currentParts.join('/'));
        }

        // Update metadata key
        setMetadata(prev => {
          const next = { ...prev };
          if (next[currentPath] && currentPath !== origPath) {
            next[origPath] = next[currentPath];
            delete next[currentPath];
          }
          return next;
        });
      }

      await deleteBackup(dirHandle);
      setHasBackup(false);

      // Rescan
      const scannedFiles = await scanDirectory(dirHandle);
      setFiles(scannedFiles);
      setMetadata(prev => {
        writeMetadata(dirHandle, prev).catch(console.error);
        return prev;
      });
    } catch (err) {
      console.error('Revert error:', err);
    }
    setOrganizing(false);
  }

  const completeCount = files.filter(f => isMetaComplete(metadata[f.path])).length;

  if (!isSupported()) {
    return (
      <div style={styles.page}>
        <div style={styles.topBar}>
          <button onClick={onBack} style={styles.backBtn}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M10 3L5 8l5 5" /></svg>
            Back
          </button>
        </div>
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
          </div>
          <h3 style={styles.emptyTitle}>Browser Not Supported</h3>
          <p style={styles.emptyText}>
            Organize requires the File System Access API, available in Chrome and Edge.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.topBar}>
        <button onClick={onBack} style={styles.backBtn}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M10 3L5 8l5 5" /></svg>
          Back
        </button>
        <h1 style={styles.title}>Organize</h1>
        <button onClick={pickFolder} style={styles.folderBtn}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4h5l2 2h5a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z" />
          </svg>
          {dirHandle ? 'Change Folder' : 'Open Folder'}
        </button>
      </div>

      {loading && (
        <div style={styles.emptyState}>
          <p style={styles.emptyText}>Scanning files...</p>
        </div>
      )}

      {!loading && !dirHandle && (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
              <path d="M4 4h5l2 2h5a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z" />
            </svg>
          </div>
          <h3 style={styles.emptyTitle}>Select a Folder</h3>
          <p style={styles.emptyText}>
            Choose a folder with media files to organize them by type.
          </p>
        </div>
      )}

      {!loading && dirHandle && files.length === 0 && (
        <div style={styles.emptyState}>
          <h3 style={styles.emptyTitle}>No Media Files Found</h3>
          <p style={styles.emptyText}>
            No supported files (png, jpg, avif, mov, mp4, wav, mp3) were found in the selected folder.
          </p>
        </div>
      )}

      {!loading && dirHandle && files.length > 0 && (
        <>
          <OrganizeToolbar
            fileCount={files.length}
            completeCount={completeCount}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onOrganize={handleOrganize}
            onRevert={handleRevert}
            hasBackup={hasBackup}
            organizing={organizing}
          />
          {selectedPaths.size > 0 && (
            <BatchBar
              selectedCount={selectedPaths.size}
              totalCount={files.length}
              onApply={handleBatchUpdate}
              onClear={handleDeselectAll}
              onSelectAll={handleSelectAll}
            />
          )}
          {viewMode === 'grid' ? (
            <FileGrid
              files={files}
              metadata={metadata}
              onMetaChange={handleMetaChange}
              onPreview={setPreviewFile}
              selectedPaths={selectedPaths}
              onToggleSelect={handleToggleSelect}
            />
          ) : (
            <FileList
              files={files}
              metadata={metadata}
              onMetaChange={handleMetaChange}
              onPreview={setPreviewFile}
              selectedPaths={selectedPaths}
              onToggleSelect={handleToggleSelect}
            />
          )}
        </>
      )}

      {previewFile && (
        <MediaPreview file={previewFile} onClose={() => setPreviewFile(null)} />
      )}
    </div>
  );
}

const styles = {
  page: {
    padding: '32px 40px',
    height: '100%',
    overflow: 'auto',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '16px',
  },
  backBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    color: 'rgba(255,255,255,0.6)',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  title: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#fff',
    margin: 0,
    flex: 1,
  },
  folderBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 16px',
    background: 'rgba(99,102,241,0.1)',
    border: '1px solid rgba(99,102,241,0.25)',
    borderRadius: '8px',
    color: '#a5b4fc',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '80px 20px',
    textAlign: 'center',
  },
  emptyIcon: {
    marginBottom: '16px',
  },
  emptyTitle: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#e2e8f0',
    margin: '0 0 8px',
  },
  emptyText: {
    fontSize: '14px',
    color: 'rgba(255,255,255,0.4)',
    margin: 0,
    maxWidth: '360px',
  },
};
