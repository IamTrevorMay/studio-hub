import React, { useState, useRef, useCallback } from 'react';
import { colors } from '../../../lib/styleTokens';

function parseYouTubeId(input) {
  if (!input) return null;
  const trimmed = input.trim();
  // Direct video ID (11 chars, alphanumeric + dash/underscore)
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    // youtu.be/VIDEO_ID
    if (url.hostname === 'youtu.be') return url.pathname.slice(1).split('/')[0] || null;
    // youtube.com/watch?v=VIDEO_ID
    if (url.hostname.includes('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v) return v;
      // youtube.com/embed/VIDEO_ID or youtube.com/shorts/VIDEO_ID
      const parts = url.pathname.split('/').filter(Boolean);
      if ((parts[0] === 'embed' || parts[0] === 'shorts') && parts[1]) return parts[1];
    }
  } catch {}
  return null;
}

export default function VideoSourcePanel({ onSourceSelected }) {
  const [dragging, setDragging] = useState(false);
  const [ytUrl, setYtUrl] = useState('');
  const [ytError, setYtError] = useState('');
  const fileInputRef = useRef(null);

  const handleFile = useCallback((file) => {
    if (!file || !file.type.startsWith('video/')) return;
    const url = URL.createObjectURL(file);
    onSourceSelected({ type: 'file', url, fileName: file.name, file });
  }, [onSourceSelected]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragging(false);
  }, []);

  const handleFileInput = useCallback((e) => {
    const file = e.target.files[0];
    handleFile(file);
  }, [handleFile]);

  const handleYouTubeSubmit = useCallback((e) => {
    e.preventDefault();
    const videoId = parseYouTubeId(ytUrl);
    if (!videoId) {
      setYtError('Could not find a valid YouTube video ID. Try pasting the full URL.');
      return;
    }
    setYtError('');
    onSourceSelected({ type: 'youtube', videoId, fileName: `YouTube (${videoId})` });
  }, [ytUrl, onSourceSelected]);

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.title}>Load Video</h2>
        <p style={styles.subtitle}>Upload footage or paste a YouTube link to begin annotating</p>

        {/* Drop zone */}
        <div
          style={{
            ...styles.dropZone,
            ...(dragging ? styles.dropZoneActive : {}),
          }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={styles.dropIcon}>
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span style={styles.dropText}>
            {dragging ? 'Drop video here' : 'Drag & drop a video file, or click to browse'}
          </span>
          <span style={styles.dropHint}>MP4, MOV, WebM supported</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileInput}
            style={{ display: 'none' }}
          />
        </div>

        {/* Divider */}
        <div style={styles.dividerRow}>
          <div style={styles.dividerLine} />
          <span style={styles.dividerText}>or</span>
          <div style={styles.dividerLine} />
        </div>

        {/* YouTube URL input */}
        <form onSubmit={handleYouTubeSubmit} style={styles.ytForm}>
          <div style={styles.ytInputRow}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={styles.ytIcon}>
              <path d="M22.54 6.42a2.78 2.78 0 00-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 00-1.94 2A29 29 0 001 11.75a29 29 0 00.46 5.33A2.78 2.78 0 003.4 19.13C5.12 19.56 12 19.56 12 19.56s6.88 0 8.6-.46a2.78 2.78 0 001.94-2 29 29 0 00.46-5.25 29 29 0 00-.46-5.43z" fill="#ef4444" />
              <path d="M9.75 15.02l5.75-3.27-5.75-3.27v6.54z" fill="#ffffff" />
            </svg>
            <input
              style={styles.ytInput}
              value={ytUrl}
              onChange={e => { setYtUrl(e.target.value); setYtError(''); }}
              placeholder="Paste YouTube URL or video ID"
            />
            <button type="submit" style={styles.ytBtn}>Load</button>
          </div>
          {ytError && <div style={styles.ytError}>{ytError}</div>}
          <div style={styles.ytHint}>
            Frame-by-frame and export are unavailable for YouTube videos
          </div>
        </form>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    padding: '40px',
  },
  card: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '16px',
    padding: '48px',
    maxWidth: '520px',
    width: '100%',
    textAlign: 'center',
  },
  title: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#ffffff',
    margin: '0 0 6px 0',
  },
  subtitle: {
    fontSize: '14px',
    color: 'rgba(255,255,255,0.4)',
    margin: '0 0 32px 0',
  },
  dropZone: {
    border: '2px dashed rgba(255,255,255,0.12)',
    borderRadius: '12px',
    padding: '48px 24px',
    cursor: 'pointer',
    transition: 'border-color 0.15s, background 0.15s',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
  },
  dropZoneActive: {
    borderColor: colors.accent,
    background: colors.accentA06,
  },
  dropIcon: {
    color: 'rgba(255,255,255,0.25)',
  },
  dropText: {
    fontSize: '14px',
    color: 'rgba(255,255,255,0.6)',
  },
  dropHint: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.25)',
  },
  dividerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    margin: '28px 0',
  },
  dividerLine: {
    flex: 1,
    height: '1px',
    background: 'rgba(255,255,255,0.08)',
  },
  dividerText: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.25)',
    textTransform: 'uppercase',
    fontWeight: 600,
    letterSpacing: '1px',
  },
  ytForm: {
    textAlign: 'left',
  },
  ytInputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  ytIcon: {
    flexShrink: 0,
  },
  ytInput: {
    flex: 1,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '14px',
    padding: '10px 14px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  ytBtn: {
    background: colors.accent,
    border: 'none',
    color: '#ffffff',
    cursor: 'pointer',
    padding: '10px 20px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 600,
    fontFamily: 'inherit',
    flexShrink: 0,
    transition: 'background 0.12s',
  },
  ytError: {
    fontSize: '12px',
    color: '#ef4444',
    marginTop: '8px',
    paddingLeft: '28px',
  },
  ytHint: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.2)',
    marginTop: '10px',
    paddingLeft: '28px',
  },
};
