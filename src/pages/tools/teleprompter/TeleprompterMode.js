import React, { useRef, useEffect, useState, useCallback } from 'react';
import useTeleprompterScroll from './useTeleprompterScroll';
import TeleprompterControls from './TeleprompterControls';
import ScriptEditor from './ScriptEditor';

export default function TeleprompterMode({
  stream,
  script,
  onScriptChange,
  settings,
  onSettingsChange,
}) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const countdownRef = useRef(null);

  const { speed, fontSize, mirrored, textOpacity, margins, layout } = settings;

  const { scrollRef, resetScroll } = useTeleprompterScroll(speed, isPlaying);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Cleanup countdown on unmount
  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const togglePlay = useCallback(() => {
    if (countdown !== null) return;
    setIsPlaying(prev => !prev);
  }, [countdown]);

  const handleReset = useCallback(() => {
    setIsPlaying(false);
    setCountdown(null);
    if (countdownRef.current) clearInterval(countdownRef.current);
    resetScroll();
  }, [resetScroll]);

  const handleCountdownStart = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    resetScroll();
    let c = settings.countdownSeconds;
    setCountdown(c);
    countdownRef.current = setInterval(() => {
      c -= 1;
      if (c <= 0) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
        setCountdown(null);
        setIsPlaying(true);
      } else {
        setCountdown(c);
      }
    }, 1000);
  }, [isPlaying, settings.countdownSeconds, resetScroll]);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen();
    }
  }, []);

  const updateSetting = useCallback((key, value) => {
    onSettingsChange(prev => ({ ...prev, [key]: value }));
  }, [onSettingsChange]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e) {
      if (showEditor) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowUp':
          e.preventDefault();
          updateSetting('speed', Math.min(10, speed + 1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          updateSetting('speed', Math.max(1, speed - 1));
          break;
        case 'ArrowRight':
          e.preventDefault();
          updateSetting('fontSize', Math.min(72, fontSize + 2));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          updateSetting('fontSize', Math.max(16, fontSize - 2));
          break;
        case 'm':
        case 'M':
          updateSetting('mirrored', !mirrored);
          break;
        case 'r':
        case 'R':
          handleReset();
          break;
        case 'Escape':
          if (document.fullscreenElement) document.exitFullscreen();
          break;
        default:
          break;
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [showEditor, togglePlay, updateSetting, speed, fontSize, mirrored, handleReset]);

  const isSideBySide = layout === 'side-by-side';
  const marginPct = `${margins}%`;

  return (
    <div ref={containerRef} style={styles.container}>
      <div style={{
        ...styles.mainArea,
        flexDirection: isSideBySide ? 'row' : 'column',
      }}>
        {/* Camera feed */}
        <div style={{
          ...styles.cameraArea,
          ...(isSideBySide ? { width: '50%', height: '100%' } : { width: '100%', height: '100%' }),
          position: isSideBySide ? 'relative' : 'absolute',
          inset: isSideBySide ? undefined : 0,
          zIndex: isSideBySide ? 1 : 0,
        }}>
          {stream ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={styles.video}
            />
          ) : (
            <div style={styles.noCamera}>No camera</div>
          )}
        </div>

        {/* Scrolling text */}
        <div
          ref={scrollRef}
          style={{
            ...styles.textArea,
            ...(isSideBySide
              ? { width: '50%', position: 'relative', background: 'rgba(0,0,0,0.85)' }
              : { position: 'absolute', inset: 0, zIndex: 1, background: 'transparent' }),
          }}
        >
          {/* Top spacer so text starts from bottom */}
          <div style={{ height: '60vh', flexShrink: 0 }} />
          <div style={{
            padding: `0 ${marginPct}`,
            fontSize: `${fontSize}px`,
            lineHeight: 1.5,
            fontWeight: 500,
            color: settings.textColor,
            opacity: textOpacity,
            transform: mirrored ? 'scaleX(-1)' : 'none',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {script || (
              <span style={{ opacity: 0.3, fontSize: '24px' }}>
                Click "Script" to add your text...
              </span>
            )}
          </div>
          {/* Bottom spacer */}
          <div style={{ height: '70vh', flexShrink: 0 }} />
        </div>
      </div>

      <TeleprompterControls
        isPlaying={isPlaying}
        onPlayPause={togglePlay}
        onReset={handleReset}
        onCountdownStart={handleCountdownStart}
        speed={speed}
        onSpeedChange={v => updateSetting('speed', v)}
        fontSize={fontSize}
        onFontSizeChange={v => updateSetting('fontSize', v)}
        mirrored={mirrored}
        onMirrorToggle={() => updateSetting('mirrored', !mirrored)}
        textOpacity={textOpacity}
        onOpacityChange={v => updateSetting('textOpacity', v)}
        margins={margins}
        onMarginsChange={v => updateSetting('margins', v)}
        layout={layout}
        onLayoutToggle={() => updateSetting('layout', layout === 'overlay' ? 'side-by-side' : 'overlay')}
        onFullscreen={toggleFullscreen}
        onEditScript={() => setShowEditor(true)}
        countdown={countdown}
      />

      {showEditor && (
        <ScriptEditor
          script={script}
          onChange={onScriptChange}
          onClose={() => setShowEditor(false)}
        />
      )}
    </div>
  );
}

const styles = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    background: '#000',
    overflow: 'hidden',
  },
  mainArea: {
    flex: 1,
    display: 'flex',
    position: 'relative',
    overflow: 'hidden',
  },
  cameraArea: {
    background: '#000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
  noCamera: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: '14px',
  },
  textArea: {
    overflow: 'auto',
    scrollBehavior: 'auto',
    /* Hide scrollbar */
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
  },
};
