import React, { useCallback, useRef } from 'react';
import { PLAYBACK_SPEEDS } from './telestrationConstants';

function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return '00:00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * 30); // frame at 30fps
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

export default function Timeline({ videoController, annotations, onSelectAnnotation, onUpdateAnnotation, isYouTube }) {
  const {
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    togglePlay,
    seek,
    stepForward,
    stepBackward,
    setPlaybackRate,
  } = videoController;

  const scrubberRef = useRef(null);

  const handleScrub = useCallback((e) => {
    const bar = scrubberRef.current;
    if (!bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(pct * duration);
  }, [duration, seek]);

  const handleScrubDrag = useCallback((e) => {
    e.preventDefault();
    handleScrub(e);

    const onMove = (ev) => handleScrub(ev);
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [handleScrub]);

  // Drag annotation bar edges to adjust time
  const handleAnnotationEdgeDrag = useCallback((e, annId, edge) => {
    e.stopPropagation();
    e.preventDefault();
    const bar = scrubberRef.current;
    if (!bar || !duration || !onUpdateAnnotation) return;

    const onMove = (ev) => {
      const rect = bar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const time = pct * duration;
      onUpdateAnnotation(annId, { [edge]: time });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [duration, onUpdateAnnotation]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const hasAnnotations = annotations && annotations.length > 0;

  return (
    <div style={styles.container}>
      {/* Scrubber bar */}
      <div
        ref={scrubberRef}
        style={styles.scrubberTrack}
        onMouseDown={handleScrubDrag}
      >
        <div style={{ ...styles.scrubberFill, width: `${progress}%` }} />
        <div style={{ ...styles.scrubberHead, left: `${progress}%` }} />
      </div>

      {/* Annotation bars */}
      {hasAnnotations && (
        <div style={styles.annotationTrack}>
          {annotations.map(ann => {
            if (!duration) return null;
            const left = (ann.startTime / duration) * 100;
            const width = ((ann.endTime - ann.startTime) / duration) * 100;
            const isActive = currentTime >= ann.startTime && currentTime <= ann.endTime;
            return (
              <div
                key={ann.id}
                style={{
                  ...styles.annotationBar,
                  left: `${left}%`,
                  width: `${Math.max(0.3, width)}%`,
                  background: ann.color,
                  opacity: isActive ? 0.9 : 0.4,
                }}
                onClick={() => {
                  if (onSelectAnnotation) onSelectAnnotation(ann.id);
                  seek(ann.startTime);
                }}
                title={`${ann.type} (${formatTime(ann.startTime)} – ${formatTime(ann.endTime)})`}
              >
                {/* Left edge handle */}
                <div
                  style={styles.edgeHandle}
                  onMouseDown={(e) => handleAnnotationEdgeDrag(e, ann.id, 'startTime')}
                />
                {/* Right edge handle */}
                <div
                  style={{ ...styles.edgeHandle, left: 'auto', right: '-3px' }}
                  onMouseDown={(e) => handleAnnotationEdgeDrag(e, ann.id, 'endTime')}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Controls row */}
      <div style={styles.controls}>
        {/* Left: transport */}
        <div style={styles.transport}>
          <button
            onClick={stepBackward}
            disabled={isYouTube}
            style={{ ...styles.btn, ...(isYouTube ? styles.btnDisabled : {}) }}
            title={isYouTube ? 'Frame step unavailable for YouTube' : 'Previous frame'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
            </svg>
          </button>

          <button onClick={togglePlay} style={styles.playBtn} title={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <button
            onClick={stepForward}
            disabled={isYouTube}
            style={{ ...styles.btn, ...(isYouTube ? styles.btnDisabled : {}) }}
            title={isYouTube ? 'Frame step unavailable for YouTube' : 'Next frame'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
            </svg>
          </button>
        </div>

        {/* Center: time display */}
        <div style={styles.timeDisplay}>
          <span style={styles.currentTime}>{formatTime(currentTime)}</span>
          <span style={styles.timeSep}>/</span>
          <span style={styles.totalTime}>{formatTime(duration)}</span>
        </div>

        {/* Right: speed selector */}
        <div style={styles.speedGroup}>
          {PLAYBACK_SPEEDS.map(speed => (
            <button
              key={speed}
              onClick={() => setPlaybackRate(speed)}
              style={{
                ...styles.speedBtn,
                ...(playbackRate === speed ? styles.speedBtnActive : {}),
              }}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    padding: '0 16px 12px',
    flexShrink: 0,
  },
  scrubberTrack: {
    position: 'relative',
    height: '6px',
    background: 'rgba(255,255,255,0.08)',
    borderRadius: '3px',
    cursor: 'pointer',
    marginBottom: '4px',
  },
  scrubberFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: '100%',
    background: '#6366f1',
    borderRadius: '3px',
    pointerEvents: 'none',
  },
  scrubberHead: {
    position: 'absolute',
    top: '50%',
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    background: '#ffffff',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
    boxShadow: '0 0 4px rgba(0,0,0,0.4)',
  },
  annotationTrack: {
    position: 'relative',
    height: '10px',
    marginBottom: '8px',
  },
  annotationBar: {
    position: 'absolute',
    top: '1px',
    height: '8px',
    borderRadius: '3px',
    cursor: 'pointer',
    transition: 'opacity 0.12s',
    minWidth: '3px',
  },
  edgeHandle: {
    position: 'absolute',
    top: '-2px',
    left: '-3px',
    width: '6px',
    height: '12px',
    cursor: 'ew-resize',
    borderRadius: '2px',
    background: 'transparent',
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
  },
  transport: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  btn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.6)',
    cursor: 'pointer',
    padding: '6px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'color 0.15s',
  },
  btnDisabled: {
    opacity: 0.25,
    cursor: 'not-allowed',
  },
  playBtn: {
    background: 'rgba(255,255,255,0.08)',
    border: 'none',
    color: '#ffffff',
    cursor: 'pointer',
    padding: '8px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.15s',
  },
  timeDisplay: {
    fontFamily: "'DM Sans', monospace",
    fontSize: '13px',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  currentTime: {
    color: '#ffffff',
    fontVariantNumeric: 'tabular-nums',
  },
  timeSep: {
    color: 'rgba(255,255,255,0.25)',
  },
  totalTime: {
    color: 'rgba(255,255,255,0.4)',
    fontVariantNumeric: 'tabular-nums',
  },
  speedGroup: {
    display: 'flex',
    gap: '2px',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: '6px',
    padding: '2px',
  },
  speedBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.4)',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '12px',
    fontFamily: 'inherit',
    transition: 'color 0.15s, background 0.15s',
  },
  speedBtnActive: {
    background: 'rgba(255,255,255,0.1)',
    color: '#ffffff',
  },
};
