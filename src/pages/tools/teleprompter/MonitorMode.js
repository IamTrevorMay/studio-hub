import React, { useRef, useEffect, useCallback } from 'react';

export default function MonitorMode({ stream }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen();
    }
  }, []);

  if (!stream) {
    return (
      <div style={styles.empty}>
        <p style={styles.emptyText}>No camera stream available</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={styles.container}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={styles.video}
      />
      <button onClick={toggleFullscreen} style={styles.fullscreenBtn} title="Toggle fullscreen">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3" />
        </svg>
      </button>
    </div>
  );
}

const styles = {
  container: {
    flex: 1,
    position: 'relative',
    background: '#000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  video: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
  },
  fullscreenBtn: {
    position: 'absolute',
    bottom: '16px',
    right: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    border: 'none',
    borderRadius: '10px',
    background: 'rgba(0,0,0,0.6)',
    color: 'rgba(255,255,255,0.7)',
    cursor: 'pointer',
    transition: 'all 0.15s',
    backdropFilter: 'blur(8px)',
  },
  empty: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#000',
  },
  emptyText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: '14px',
  },
};
