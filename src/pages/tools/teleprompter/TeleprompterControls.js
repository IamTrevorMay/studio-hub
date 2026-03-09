import React from 'react';

export default function TeleprompterControls({
  isPlaying,
  onPlayPause,
  onReset,
  onCountdownStart,
  speed,
  onSpeedChange,
  fontSize,
  onFontSizeChange,
  mirrored,
  onMirrorToggle,
  textOpacity,
  onOpacityChange,
  margins,
  onMarginsChange,
  layout,
  onLayoutToggle,
  onFullscreen,
  onEditScript,
  countdown,
}) {
  return (
    <div style={styles.bar}>
      {/* Playback controls */}
      <div style={styles.group}>
        {countdown !== null ? (
          <span style={styles.countdownLabel}>{countdown}</span>
        ) : (
          <>
            <button onClick={onPlayPause} style={styles.btn} title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}>
              {isPlaying ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7L8 5z" /></svg>
              )}
            </button>
            <button onClick={onCountdownStart} style={styles.btn} title="Start with countdown">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
              </svg>
            </button>
            <button onClick={onReset} style={styles.btn} title="Reset to top (R)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12a9 9 0 119 9M3 12V4m0 8h8" />
              </svg>
            </button>
          </>
        )}
      </div>

      <div style={styles.divider} />

      {/* Speed */}
      <div style={styles.group}>
        <span style={styles.label}>Speed</span>
        <button onClick={() => onSpeedChange(Math.max(1, speed - 1))} style={styles.smBtn}>-</button>
        <span style={styles.value}>{speed}</span>
        <button onClick={() => onSpeedChange(Math.min(10, speed + 1))} style={styles.smBtn}>+</button>
      </div>

      <div style={styles.divider} />

      {/* Font size */}
      <div style={styles.group}>
        <span style={styles.label}>Font</span>
        <button onClick={() => onFontSizeChange(Math.max(16, fontSize - 2))} style={styles.smBtn}>-</button>
        <span style={styles.value}>{fontSize}px</span>
        <button onClick={() => onFontSizeChange(Math.min(72, fontSize + 2))} style={styles.smBtn}>+</button>
      </div>

      <div style={styles.divider} />

      {/* Toggles */}
      <div style={styles.group}>
        <button
          onClick={onMirrorToggle}
          style={{ ...styles.btn, ...(mirrored ? styles.btnActive : {}) }}
          title="Mirror text (M)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3H5a2 2 0 00-2 2v14a2 2 0 002 2h3M16 3h3a2 2 0 012 2v14a2 2 0 01-2 2h-3M12 2v20" />
          </svg>
        </button>
        <button
          onClick={onLayoutToggle}
          style={{ ...styles.btn, ...(layout === 'side-by-side' ? styles.btnActive : {}) }}
          title={layout === 'overlay' ? 'Side-by-side layout' : 'Overlay layout'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M12 3v18" />
          </svg>
        </button>
      </div>

      <div style={styles.divider} />

      {/* Opacity */}
      <div style={styles.group}>
        <span style={styles.label}>Opacity</span>
        <input
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          value={textOpacity}
          onChange={e => onOpacityChange(parseFloat(e.target.value))}
          style={styles.slider}
        />
      </div>

      <div style={styles.divider} />

      {/* Margins */}
      <div style={styles.group}>
        <span style={styles.label}>Margin</span>
        <button onClick={() => onMarginsChange(Math.max(0, margins - 5))} style={styles.smBtn}>-</button>
        <span style={styles.value}>{margins}%</span>
        <button onClick={() => onMarginsChange(Math.min(40, margins + 5))} style={styles.smBtn}>+</button>
      </div>

      <div style={{ flex: 1 }} />

      {/* Right-side actions */}
      <div style={styles.group}>
        <button onClick={onEditScript} style={styles.actionBtn}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          Script
        </button>
        <button onClick={onFullscreen} style={styles.btn} title="Fullscreen">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3" />
          </svg>
        </button>
      </div>
    </div>
  );
}

const styles = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 16px',
    background: 'rgba(15,15,30,0.95)',
    borderTop: '1px solid rgba(255,255,255,0.08)',
    flexShrink: 0,
  },
  group: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  divider: {
    width: '1px',
    height: '24px',
    background: 'rgba(255,255,255,0.08)',
    flexShrink: 0,
  },
  label: {
    fontSize: '11px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  value: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#e2e8f0',
    minWidth: '32px',
    textAlign: 'center',
  },
  btn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '34px',
    height: '34px',
    border: 'none',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.6)',
    cursor: 'pointer',
    transition: 'all 0.15s',
    fontFamily: 'inherit',
  },
  btnActive: {
    background: 'rgba(99,102,241,0.2)',
    color: '#a5b4fc',
  },
  smBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '26px',
    height: '26px',
    border: 'none',
    borderRadius: '6px',
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '14px',
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  actionBtn: {
    display: 'flex',
    alignItems: 'center',
    padding: '7px 14px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.04)',
    color: '#e2e8f0',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  slider: {
    width: '80px',
    accentColor: '#6366f1',
  },
  countdownLabel: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#a5b4fc',
    minWidth: '100px',
    textAlign: 'center',
  },
};
