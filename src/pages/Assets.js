import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';


const API_BASE = process.env.REACT_APP_API_URL || 'https://assets.maydaystudio.net';

const DATASETS = [
  { key: 'video', label: 'Video', color: '#6366f1', icon: 'M4 4h12a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zM9 8l4 2.5L9 13V8z' },
  { key: 'audio', label: 'Audio', color: '#8b5cf6', icon: 'M9 2v14M5 6v8M1 9v2M13 6v8M17 9v2' },
  { key: 'images', label: 'Images', color: '#ec4899', icon: 'M2 4h14a2 2 0 012 2v8a2 2 0 01-2 2H2a2 2 0 01-2-2V6a2 2 0 012-2zM5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM14 14l-3-3-5 5' },
  { key: 'projects', label: 'Projects', color: '#f59e0b', icon: 'M4 4h5l2 2h5a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z' },
];

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0)} ${sizes[i]}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getFileIcon(extension) {
  const ext = (extension || '').toLowerCase();
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext)) return 'audio';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (['psd', 'ai', 'prproj', 'aep', 'drp', 'fcpx'].includes(ext)) return 'project';
  if (['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext)) return 'doc';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive';
  return 'file';
}

export default function Assets() {
  const { profile, refreshKey } = useAuth();
  const [nasStatus, setNasStatus] = useState(null); // null=loading, true=connected, false=offline
  const [currentPath, setCurrentPath] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [viewMode, setViewMode] = useState('grid');
  const [error, setError] = useState(null);

  // Health check on mount
  const checkHealth = useCallback(async () => {
    setNasStatus(null);
    try {
      const res = await fetch(`${API_BASE}/api/nas/health`);
      const data = await res.json();
      setNasStatus(data.connected === true);
    } catch {
      setNasStatus(false);
    }
  }, []);

  useEffect(() => { checkHealth(); }, [checkHealth, refreshKey]);

  // Fetch directory listing
  const loadSeqRef = useRef(0);
  const fetchListing = useCallback(async (dirPath) => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ path: dirPath || '', sort: sortBy, order: sortOrder });
      const res = await fetch(`${API_BASE}/api/nas/list?${params}`);
      const data = await res.json();
      if (seq !== loadSeqRef.current) return; // a newer navigation superseded this
      if (data.error) throw new Error(data.error);
      setItems(data.items || []);
    } catch (err) {
      if (seq !== loadSeqRef.current) return; // a newer navigation superseded this
      setError(err.message);
      setItems([]);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [sortBy, sortOrder]);

  useEffect(() => {
    if (currentPath !== null) {
      fetchListing(currentPath);
    }
  }, [currentPath, fetchListing]);
  useVisibilityRefresh(useCallback(() => {
    if (currentPath !== null) fetchListing(currentPath);
  }, [currentPath, fetchListing]));

  // Search
  async function handleSearch(e) {
    e.preventDefault();
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    setLoading(true);
    setError(null);
    try {
      const dataset = currentPath ? currentPath.split('/')[0] : '';
      const params = new URLSearchParams({ q: searchQuery, dataset });
      const res = await fetch(`${API_BASE}/api/nas/search?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSearchResults(data.results || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function clearSearch() {
    setSearchQuery('');
    setSearchResults(null);
  }

  // Navigate into a directory
  function navigateTo(itemPath) {
    setSelectedFile(null);
    setSearchResults(null);
    setSearchQuery('');
    setCurrentPath(itemPath);
  }

  // Go back
  function goBack() {
    if (!currentPath) return;
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length <= 1) {
      setCurrentPath(null);
    } else {
      parts.pop();
      setCurrentPath(parts.join('/'));
    }
    setSelectedFile(null);
    setSearchResults(null);
    setSearchQuery('');
  }

  // Download
  function handleDownload(filePath) {
    const params = new URLSearchParams({ path: filePath });
    if (profile?.id) params.set('user_id', profile.id);
    window.open(`${API_BASE}/api/nas/download?${params}`, '_blank');
  }

  // Breadcrumb segments
  function getBreadcrumbs() {
    if (!currentPath) return [];
    return currentPath.split('/').filter(Boolean);
  }

  // ─── RENDER: File Detail View ───
  if (selectedFile) {
    const isImage = IMAGE_EXTENSIONS.includes((selectedFile.extension || '').toLowerCase());
    return (
      <div style={s.page}>
        <div style={s.header}>
          <button onClick={() => setSelectedFile(null)} style={s.backBtn}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 2L4 8l6 6" />
            </svg>
            Back
          </button>
          <h1 style={s.title}>{selectedFile.name}</h1>
        </div>
        <div style={s.detailCard}>
          {isImage && (
            <div style={s.previewArea}>
              <img
                src={`${API_BASE}/api/nas/download?path=${encodeURIComponent(selectedFile.path)}`}
                alt={selectedFile.name}
                style={s.previewImg}
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            </div>
          )}
          <div style={s.detailMeta}>
            <div style={s.detailRow}><span style={s.detailLabel}>Name</span><span>{selectedFile.name}</span></div>
            <div style={s.detailRow}><span style={s.detailLabel}>Path</span><span style={{ opacity: 0.6, fontSize: '13px' }}>/{selectedFile.path}</span></div>
            <div style={s.detailRow}><span style={s.detailLabel}>Size</span><span>{formatBytes(selectedFile.size)}</span></div>
            <div style={s.detailRow}><span style={s.detailLabel}>Modified</span><span>{formatDate(selectedFile.modified)}</span></div>
            {selectedFile.extension && (
              <div style={s.detailRow}><span style={s.detailLabel}>Type</span><span>.{selectedFile.extension.toUpperCase()}</span></div>
            )}
          </div>
          <button onClick={() => handleDownload(selectedFile.path)} style={s.downloadBtn}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 2v9M4 8l4 4 4-4M2 13h12" />
            </svg>
            Download File
          </button>
        </div>
      </div>
    );
  }

  // ─── RENDER: Dataset Grid (home) ───
  if (currentPath === null) {
    return (
      <div style={s.page}>
        <div style={s.header}>
          <h1 style={s.title}>Asset Library</h1>
          <div style={s.statusDot}>
            {nasStatus === null ? (
              <span style={{ ...s.dot, background: '#f59e0b' }} />
            ) : nasStatus ? (
              <span style={{ ...s.dot, background: '#22c55e' }} />
            ) : (
              <span style={{ ...s.dot, background: '#ef4444' }} />
            )}
            <span style={s.statusText}>
              {nasStatus === null ? 'Checking...' : nasStatus ? 'NAS Connected' : 'NAS Offline'}
            </span>
            {nasStatus === false && (
              <button onClick={checkHealth} style={s.retryBtn}>Retry</button>
            )}
          </div>
        </div>
        <p style={s.subtitle}>Browse and download files from the YOTA Master server.</p>
        <div style={s.datasetGrid}>
          {DATASETS.map(ds => (
            <button
              key={ds.key}
              onClick={() => nasStatus && navigateTo(ds.key)}
              style={{
                ...s.datasetCard,
                opacity: nasStatus ? 1 : 0.5,
                cursor: nasStatus ? 'pointer' : 'not-allowed',
              }}
            >
              <div style={{ ...s.datasetStripe, background: ds.color }} />
              <div style={s.datasetContent}>
                <svg width="28" height="28" viewBox="0 0 20 20" fill="none" stroke={ds.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d={ds.icon} />
                </svg>
                <span style={s.datasetLabel}>{ds.label}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ─── RENDER: Directory Listing ───
  const breadcrumbs = getBreadcrumbs();
  const displayItems = searchResults || items;

  return (
    <div style={s.page}>
      <div style={s.header}>
        <button onClick={goBack} style={s.backBtn}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 2L4 8l6 6" />
          </svg>
          Back
        </button>
        <div style={s.breadcrumbs}>
          <button onClick={() => { setCurrentPath(null); clearSearch(); }} style={s.breadcrumbBtn}>Assets</button>
          {breadcrumbs.map((seg, i) => (
            <React.Fragment key={i}>
              <span style={s.breadcrumbSep}>/</span>
              <button
                onClick={() => { navigateTo(breadcrumbs.slice(0, i + 1).join('/')); clearSearch(); }}
                style={{
                  ...s.breadcrumbBtn,
                  ...(i === breadcrumbs.length - 1 ? { color: '#e2e8f0' } : {}),
                }}
              >
                {seg}
              </button>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div style={s.toolbar}>
        <form onSubmit={handleSearch} style={s.searchForm}>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search files..."
            style={s.searchInput}
          />
          {searchResults && (
            <button type="button" onClick={clearSearch} style={s.clearSearchBtn}>Clear</button>
          )}
        </form>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={s.sortSelect}>
          <option value="name">Name</option>
          <option value="size">Size</option>
          <option value="modified">Modified</option>
        </select>
        <button onClick={() => setSortOrder(o => o === 'asc' ? 'desc' : 'asc')} style={s.sortOrderBtn} title="Toggle sort order">
          {sortOrder === 'asc' ? '\u2191' : '\u2193'}
        </button>
        <button onClick={() => setViewMode(v => v === 'grid' ? 'list' : 'grid')} style={s.viewToggle} title="Toggle view">
          {viewMode === 'grid' ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="1" y="1" width="6" height="6" rx="1" /><rect x="9" y="1" width="6" height="6" rx="1" />
              <rect x="1" y="9" width="6" height="6" rx="1" /><rect x="9" y="9" width="6" height="6" rx="1" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="1" y="2" width="14" height="3" rx="1" /><rect x="1" y="7" width="14" height="3" rx="1" />
              <rect x="1" y="12" width="14" height="3" rx="1" />
            </svg>
          )}
        </button>
      </div>

      {error && <div style={s.errorMsg}>{error}</div>}

      {loading ? (
        <div style={s.loadingMsg}>Loading...</div>
      ) : displayItems.length === 0 ? (
        <div style={s.emptyMsg}>{searchResults ? 'No results found.' : 'This folder is empty.'}</div>
      ) : viewMode === 'grid' ? (
        <div style={s.fileGrid}>
          {displayItems.map((item, i) => (
            <button
              key={i}
              onClick={() => item.type === 'directory' ? navigateTo(item.path) : setSelectedFile(item)}
              style={s.fileCard}
            >
              <FileIcon type={item.type === 'directory' ? 'folder' : getFileIcon(item.extension)} />
              <div style={s.fileName}>{item.name}</div>
              <div style={s.fileMeta}>
                {item.type === 'directory' ? 'Folder' : formatBytes(item.size)}
                {item.modified ? ` \u00B7 ${formatDate(item.modified)}` : ''}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div style={s.fileList}>
          {displayItems.map((item, i) => (
            <button
              key={i}
              onClick={() => item.type === 'directory' ? navigateTo(item.path) : setSelectedFile(item)}
              style={s.fileListRow}
            >
              <FileIcon type={item.type === 'directory' ? 'folder' : getFileIcon(item.extension)} />
              <span style={s.fileListName}>{item.name}</span>
              <span style={s.fileListSize}>{item.type === 'directory' ? '—' : formatBytes(item.size)}</span>
              <span style={s.fileListDate}>{formatDate(item.modified)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FileIcon({ type }) {
  const colors = {
    folder: '#f59e0b',
    video: '#6366f1',
    audio: '#8b5cf6',
    image: '#ec4899',
    project: '#22c55e',
    doc: '#3b82f6',
    archive: '#64748b',
    file: '#94a3b8',
  };
  const color = colors[type] || colors.file;
  const paths = {
    folder: 'M4 4h5l2 2h5a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z',
    video: 'M4 4h10a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zM8 8l4 2.5L8 13V8z',
    audio: 'M9 2v14M5 6v8M1 9v2M13 6v8M17 9v2',
    image: 'M2 4h14a2 2 0 012 2v8a2 2 0 01-2 2H2V6a2 2 0 012-2zM5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
    project: 'M4 4h5l2 2h5a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z',
    doc: 'M4 2h8l4 4v10a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2zM12 2v4h4M6 9h6M6 12h4',
    archive: 'M4 2h10a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2zM8 6v4M6 8h4',
    file: 'M4 2h8l4 4v10a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2zM12 2v4h4',
  };
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d={paths[type] || paths.file} />
    </svg>
  );
}

const s = {
  page: {
    padding: '32px 40px',
    maxWidth: '1200px',
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '8px',
  },
  title: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#e2e8f0',
    margin: 0,
  },
  subtitle: {
    fontSize: '14px',
    color: 'rgba(255,255,255,0.4)',
    margin: '0 0 28px',
  },
  statusDot: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginLeft: 'auto',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    display: 'inline-block',
  },
  statusText: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.5)',
  },
  retryBtn: {
    padding: '4px 10px',
    border: '1px solid rgba(99,102,241,0.3)',
    borderRadius: '6px',
    background: 'rgba(99,102,241,0.1)',
    color: '#a5b4fc',
    fontSize: '12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  // Dataset grid
  datasetGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '16px',
  },
  datasetCard: {
    display: 'flex',
    flexDirection: 'column',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '14px',
    background: 'rgba(255,255,255,0.03)',
    overflow: 'hidden',
    transition: 'all 0.15s',
    fontFamily: 'inherit',
    color: '#e2e8f0',
    textAlign: 'left',
  },
  datasetStripe: {
    height: '4px',
    width: '100%',
  },
  datasetContent: {
    padding: '24px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  datasetLabel: {
    fontSize: '16px',
    fontWeight: 600,
  },
  // Back / breadcrumbs
  backBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.6)',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    flexShrink: 0,
  },
  breadcrumbs: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    overflow: 'hidden',
  },
  breadcrumbBtn: {
    padding: '2px 4px',
    border: 'none',
    background: 'transparent',
    color: 'rgba(255,255,255,0.45)',
    fontSize: '14px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  breadcrumbSep: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: '14px',
  },
  // Toolbar
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '20px',
    marginTop: '12px',
  },
  searchForm: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: 1,
  },
  searchInput: {
    flex: 1,
    padding: '8px 14px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.04)',
    color: '#e2e8f0',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  clearSearchBtn: {
    padding: '6px 12px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  sortSelect: {
    padding: '8px 10px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.04)',
    color: '#e2e8f0',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
    cursor: 'pointer',
  },
  sortOrderBtn: {
    padding: '8px 10px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    background: 'transparent',
    color: '#e2e8f0',
    fontSize: '14px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  viewToggle: {
    padding: '8px 10px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
  },
  // File grid
  fileGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: '12px',
  },
  fileCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    padding: '20px 14px',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px',
    background: 'rgba(255,255,255,0.02)',
    color: '#e2e8f0',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'center',
    transition: 'all 0.12s',
  },
  fileName: {
    fontSize: '13px',
    fontWeight: 500,
    wordBreak: 'break-word',
    lineHeight: 1.3,
  },
  fileMeta: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.35)',
  },
  // File list
  fileList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  fileListRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 14px',
    border: 'none',
    borderRadius: '8px',
    background: 'transparent',
    color: '#e2e8f0',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    transition: 'background 0.1s',
    width: '100%',
  },
  fileListName: {
    flex: 1,
    fontSize: '13px',
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  fileListSize: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.4)',
    width: '80px',
    textAlign: 'right',
  },
  fileListDate: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.35)',
    width: '100px',
    textAlign: 'right',
  },
  // Detail view
  detailCard: {
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '14px',
    background: 'rgba(255,255,255,0.03)',
    padding: '24px',
    marginTop: '16px',
  },
  previewArea: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '20px',
    background: 'rgba(0,0,0,0.3)',
    borderRadius: '10px',
    padding: '16px',
  },
  previewImg: {
    maxWidth: '100%',
    maxHeight: '400px',
    borderRadius: '8px',
    objectFit: 'contain',
  },
  detailMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginBottom: '20px',
  },
  detailRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontSize: '14px',
    color: '#e2e8f0',
  },
  detailLabel: {
    width: '80px',
    fontSize: '12px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    flexShrink: 0,
  },
  downloadBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 20px',
    border: 'none',
    borderRadius: '10px',
    background: '#6366f1',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  // States
  errorMsg: {
    padding: '12px 16px',
    borderRadius: '10px',
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.2)',
    color: '#fca5a5',
    fontSize: '13px',
    marginBottom: '16px',
  },
  loadingMsg: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: '14px',
    textAlign: 'center',
    padding: '48px 0',
  },
  emptyMsg: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: '14px',
    textAlign: 'center',
    padding: '48px 0',
  },
};
