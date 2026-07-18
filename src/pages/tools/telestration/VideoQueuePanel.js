import React, { useRef, useState, useEffect, useCallback } from 'react';
import { colors } from '../../../lib/styleTokens';

function generateVideoThumbnail(file) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(file);
    video.src = url;
    video.onloadeddata = () => {
      video.currentTime = Math.min(1, video.duration * 0.1);
    };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const thumb = canvas.toDataURL('image/jpeg', 0.7);
      URL.revokeObjectURL(url);
      resolve(thumb);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
  });
}

export default function VideoQueuePanel({ videos, selectedId, onSelect, onAdd, onRemove }) {
  const fileInputRef = useRef(null);
  const [showYtInput, setShowYtInput] = useState(false);
  const [ytUrl, setYtUrl] = useState('');
  const [ytError, setYtError] = useState('');
  const [thumbnails, setThumbnails] = useState({});

  // Generate thumbnails for file-type videos that don't have one yet
  useEffect(() => {
    videos.forEach(v => {
      if (thumbnails[v.id]) return;
      if (v.source.type === 'youtube' && v.source.videoId) {
        setThumbnails(prev => ({
          ...prev,
          [v.id]: `https://img.youtube.com/vi/${v.source.videoId}/mqdefault.jpg`,
        }));
      } else if (v.source.type === 'file' && v.source.file) {
        generateVideoThumbnail(v.source.file).then(thumb => {
          if (thumb) setThumbnails(prev => ({ ...prev, [v.id]: thumb }));
        });
      }
    });
  }, [videos, thumbnails]);

  function handleFiles(e) {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('video/'));
    if (files.length > 0) onAdd(files);
    e.target.value = '';
  }

  const handleYouTubeSubmit = useCallback((e) => {
    e.preventDefault();
    if (!ytUrl.trim()) return;
    const videoId = parseYouTubeId(ytUrl);
    if (!videoId) {
      setYtError('Invalid YouTube URL or ID');
      return;
    }
    setYtError('');
    setYtUrl('');
    setShowYtInput(false);
    onAdd(null, { type: 'youtube', videoId, fileName: `YouTube (${videoId})` });
  }, [ytUrl, onAdd]);

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>Videos ({videos.length})</span>
        <div style={styles.headerBtns}>
          <button
            style={styles.addBtn}
            onClick={() => fileInputRef.current?.click()}
            title="Add video files"
          >
            + File
          </button>
          <button
            style={{
              ...styles.addBtn,
              ...(showYtInput ? styles.addBtnActive : {}),
            }}
            onClick={() => setShowYtInput(prev => !prev)}
            title="Add YouTube video"
          >
            YT
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="video/*"
          style={{ display: 'none' }}
          onChange={handleFiles}
        />
      </div>

      {showYtInput && (
        <form onSubmit={handleYouTubeSubmit} style={styles.ytForm}>
          <input
            style={styles.ytInput}
            value={ytUrl}
            onChange={e => { setYtUrl(e.target.value); setYtError(''); }}
            placeholder="YouTube URL or ID"
            autoFocus
          />
          <button type="submit" style={styles.ytBtn}>Add</button>
          {ytError && <div style={styles.ytError}>{ytError}</div>}
        </form>
      )}

      <div style={styles.list}>
        {videos.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <polygon points="10 9 15 12 10 15" fill="rgba(255,255,255,0.2)" stroke="none" />
              </svg>
            </div>
            <span style={styles.emptyText}>No videos loaded</span>
          </div>
        ) : (
          videos.map(v => (
            <div
              key={v.id}
              style={{
                ...styles.card,
                ...(v.id === selectedId ? styles.cardSelected : {}),
              }}
              onClick={() => onSelect(v.id)}
            >
              <div style={styles.thumbWrap}>
                {thumbnails[v.id] ? (
                  <img
                    src={thumbnails[v.id]}
                    alt={v.name}
                    style={styles.thumb}
                    draggable={false}
                  />
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <polygon points="10 9 15 12 10 15" fill="rgba(255,255,255,0.15)" stroke="none" />
                  </svg>
                )}
              </div>
              <div style={styles.cardBottom}>
                <div style={styles.cardName} title={v.name}>{v.name}</div>
                <button
                  style={styles.deleteBtn}
                  onClick={(e) => { e.stopPropagation(); onRemove(v.id); }}
                  title="Remove video"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function parseYouTubeId(input) {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname === 'youtu.be') return url.pathname.slice(1).split('/')[0] || null;
    if (url.hostname.includes('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v) return v;
      const parts = url.pathname.split('/').filter(Boolean);
      if ((parts[0] === 'embed' || parts[0] === 'shorts') && parts[1]) return parts[1];
    }
  } catch { /* ignore */ }
  return null;
}

const styles = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    background: 'rgba(255,255,255,0.02)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  headerTitle: {
    flex: 1,
    fontSize: '12px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  headerBtns: {
    display: 'flex',
    gap: '4px',
  },
  addBtn: {
    background: colors.accentA15,
    border: '1px solid rgba(91, 143, 199,0.3)',
    color: colors.accentFg,
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '5px',
    fontSize: '11px',
    fontFamily: 'inherit',
    fontWeight: 600,
    transition: 'background 0.12s',
  },
  addBtnActive: {
    background: colors.accentA30,
  },
  ytForm: {
    padding: '8px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  ytInput: {
    flex: 1,
    minWidth: 0,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '5px',
    color: '#ffffff',
    padding: '5px 8px',
    fontSize: '11px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  ytBtn: {
    background: colors.accent,
    border: 'none',
    color: '#ffffff',
    cursor: 'pointer',
    padding: '5px 10px',
    borderRadius: '5px',
    fontSize: '11px',
    fontFamily: 'inherit',
    fontWeight: 600,
  },
  ytError: {
    width: '100%',
    fontSize: '10px',
    color: '#f87171',
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    padding: '32px 16px',
    textAlign: 'center',
  },
  emptyIcon: {
    opacity: 0.5,
  },
  emptyText: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.25)',
  },
  card: {
    background: 'none',
    border: '2px solid transparent',
    borderRadius: '8px',
    cursor: 'pointer',
    padding: '6px',
    textAlign: 'left',
    transition: 'border-color 0.12s, background 0.12s',
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
    width: '100%',
  },
  cardSelected: {
    borderColor: colors.accent,
    background: colors.accentA08,
  },
  thumbWrap: {
    width: '100%',
    aspectRatio: '16/9',
    background: 'rgba(0,0,0,0.4)',
    borderRadius: '4px',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  cardBottom: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  cardName: {
    flex: 1,
    fontSize: '11px',
    color: 'rgba(255,255,255,0.5)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    padding: '0 2px',
  },
  deleteBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.25)',
    cursor: 'pointer',
    padding: '2px',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'color 0.12s',
  },
};
