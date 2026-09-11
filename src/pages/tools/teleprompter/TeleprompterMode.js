import React, { useRef, useEffect, useState, useCallback } from 'react';
import useTeleprompterScroll from './useTeleprompterScroll';
import usePedalScroll from './usePedalScroll';
import TeleprompterControls from './TeleprompterControls';
import ScriptEditor, { ensureHtml } from './ScriptEditor';
import DOMPurify from 'dompurify';
import { supabase } from '../../../supabaseClient';
import { colors } from '../../../lib/styleTokens';

const SELECTED_SCRIPT_KEY = 'teleprompter-selected-script-id';

// Persistent library rail on the right: every saved script, the loaded one
// highlighted. Clicking a row loads it into the prompter. Hidden in focus
// mode; refreshKey re-fetches after the editor drawer saves/deletes.
function ScriptsPanel({ selectedId, onSelect, refreshKey }) {
  const [scripts, setScripts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, script }

  async function deleteScript(s) {
    setCtxMenu(null);
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${s.name}"? This can't be undone.`)) return;
    const { error } = await supabase.from('teleprompter_scripts').delete().eq('id', s.id);
    if (error) { console.error('Delete script error:', error); return; }
    setScripts((prev) => prev.filter((x) => x.id !== s.id));
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from('teleprompter_scripts')
        .select('id, name, content, created_at')
        .order('created_at', { ascending: false });
      if (!alive) return;
      if (error) console.error('Load scripts error:', error);
      setScripts(data || []);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [refreshKey]);

  return (
    <div style={panelStyles.panel}>
      <div style={panelStyles.header}>Scripts</div>
      <div style={panelStyles.list}>
        {loading ? (
          <div style={panelStyles.empty}>Loading…</div>
        ) : scripts.length === 0 ? (
          <div style={panelStyles.empty}>No saved scripts yet.</div>
        ) : scripts.map((s) => {
          const active = s.id === selectedId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s)}
              onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, script: s }); }}
              style={{ ...panelStyles.item, ...(active ? panelStyles.itemActive : {}) }}
              title={active ? 'Currently loaded' : 'Load this script'}
            >
              <span style={{ ...panelStyles.itemName, ...(active ? { color: colors.accentFg } : {}) }}>{s.name}</span>
              <span style={panelStyles.itemMeta}>
                {new Date(s.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            </button>
          );
        })}
      </div>

      {ctxMenu && (
        <div
          style={panelStyles.ctxOverlay}
          onClick={() => setCtxMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}
        >
          <div
            style={{
              ...panelStyles.ctxMenu,
              left: Math.min(ctxMenu.x, (window.innerWidth || 1200) - 180),
              top: Math.min(ctxMenu.y, (window.innerHeight || 800) - 70),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button style={panelStyles.ctxItem} onClick={() => deleteScript(ctxMenu.script)}>
              Delete script
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const panelStyles = {
  panel: {
    width: '224px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(15,15,30,0.95)',
    borderLeft: '1px solid rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  header: {
    padding: '12px 14px 8px',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.6px',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.4)',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  list: { flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px' },
  empty: { padding: '12px 8px', fontSize: '12px', color: 'rgba(255,255,255,0.3)' },
  item: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '2px',
    padding: '8px 10px',
    borderRadius: '8px',
    border: '1px solid transparent',
    background: 'transparent',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    width: '100%',
    boxSizing: 'border-box',
  },
  itemActive: {
    background: colors.accentA15,
    border: `1px solid ${colors.accentBorder}`,
  },
  itemName: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#e2e8f0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
  },
  itemMeta: { fontSize: '10px', color: 'rgba(255,255,255,0.35)' },
  ctxOverlay: { position: 'fixed', inset: 0, zIndex: 999 },
  ctxMenu: {
    position: 'fixed',
    zIndex: 1000,
    background: '#1b2331',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '10px',
    padding: 4,
    minWidth: 150,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  ctxItem: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'none',
    border: 'none',
    borderRadius: 6,
    padding: '8px 12px',
    color: '#f87171',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};

export default function TeleprompterMode({
  stream,
  script,
  onScriptChange,
  settings,
  onSettingsChange,
  focusMode,
  onFocusModeChange,
}) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [selectedScriptId, setSelectedScriptId] = useState(() => {
    try { return localStorage.getItem(SELECTED_SCRIPT_KEY) || null; } catch { return null; }
  });
  const [libRefresh, setLibRefresh] = useState(0);

  const handleSelectScript = useCallback((s) => {
    onScriptChange(s.content || '');
    setSelectedScriptId(s.id);
    try { localStorage.setItem(SELECTED_SCRIPT_KEY, s.id); } catch { /* ignore */ }
  }, [onScriptChange]);
  const [countdown, setCountdown] = useState(null);
  const countdownRef = useRef(null);
  const [controlsVisible, setControlsVisible] = useState(false);
  const hideTimerRef = useRef(null);

  const { speed, fontSize, mirrored, textOpacity, margins, layout, fontFamily, textAlign, showCamera } = settings;

  const { scrollRef, resetScroll } = useTeleprompterScroll(speed, isPlaying);
  usePedalScroll(scrollRef);

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
    onFocusModeChange(prev => !prev);
  }, [onFocusModeChange]);

  // Exit focus mode when exiting browser fullscreen via Escape
  useEffect(() => {
    function onFsChange() {
      if (!document.fullscreenElement && focusMode) {
        onFocusModeChange(false);
      }
    }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [focusMode, onFocusModeChange]);

  // Mouse hover to reveal controls in focus mode
  useEffect(() => {
    if (!focusMode) {
      setControlsVisible(false);
      return;
    }
    function handleMouseMove(e) {
      const nearBottom = e.clientY > window.innerHeight - 80;
      if (nearBottom) {
        setControlsVisible(true);
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
      }
    }
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      clearTimeout(hideTimerRef.current);
    };
  }, [focusMode]);

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
        case 'c':
        case 'C':
          updateSetting('showCamera', !showCamera);
          break;
        case 'm':
        case 'M':
          updateSetting('mirrored', !mirrored);
          break;
        case 'r':
        case 'R':
          handleReset();
          break;
        case 'f':
        case 'F':
          onFocusModeChange(prev => !prev);
          break;
        case 'Escape':
          if (focusMode) {
            onFocusModeChange(false);
          }
          if (document.fullscreenElement) document.exitFullscreen();
          break;
        default:
          break;
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [showEditor, togglePlay, updateSetting, speed, fontSize, mirrored, showCamera, handleReset, focusMode, onFocusModeChange]);

  const isSideBySide = layout === 'side-by-side';
  const marginPct = `${margins}%`;

  return (
    <div ref={containerRef} style={styles.container}>
      <div style={styles.bodyRow}>
      <div style={{
        ...styles.mainArea,
        flexDirection: isSideBySide ? 'row' : 'column',
      }}>
        {/* Camera feed */}
        {showCamera && (
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
        )}

        {/* Scrolling text */}
        <div
          ref={scrollRef}
          style={{
            ...styles.textArea,
            ...(isSideBySide
              ? { width: showCamera ? '50%' : '100%', position: 'relative', background: 'rgba(0,0,0,0.85)' }
              : { position: 'absolute', inset: 0, zIndex: 1, background: showCamera ? 'transparent' : '#000' }),
          }}
        >
          {/* Top spacer so text starts from bottom */}
          <div style={{ height: '60vh', flexShrink: 0 }} />
          <style>{`
            .teleprompter-script ul, .teleprompter-script ol {
              text-align: left;
              padding-left: 1.5em;
              margin: 0.3em 0;
            }
            .teleprompter-script li { margin-bottom: 0.2em; }
            .teleprompter-script p { margin: 0.2em 0; }
          `}</style>
          <div className="teleprompter-script" style={{
            padding: `0 ${marginPct}`,
            fontSize: `${fontSize}px`,
            lineHeight: 1.5,
            fontWeight: 500,
            fontFamily: fontFamily || 'sans-serif',
            textAlign: textAlign || 'center',
            color: settings.textColor,
            opacity: textOpacity,
            transform: mirrored ? 'scaleX(-1)' : 'none',
            wordBreak: 'break-word',
          }}>
            {script ? (
              <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(ensureHtml(script))}} />
            ) : (
              <span style={{ opacity: 0.3, fontSize: '24px' }}>
                Click "Script" to add your text...
              </span>
            )}
          </div>
          {/* Bottom spacer */}
          <div style={{ height: '70vh', flexShrink: 0 }} />
        </div>
      </div>

      {/* Script library rail — persists beside the prompter, gone in focus mode */}
      {!focusMode && (
        <ScriptsPanel
          selectedId={selectedScriptId}
          onSelect={handleSelectScript}
          refreshKey={libRefresh}
        />
      )}
      </div>

      {(!focusMode || controlsVisible) && (
        <div style={focusMode ? { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10 } : undefined}>
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
            textColor={settings.textColor}
            onTextColorChange={v => updateSetting('textColor', v)}
            fontFamily={fontFamily}
            onFontFamilyChange={v => updateSetting('fontFamily', v)}
            textAlign={textAlign}
            onTextAlignChange={v => updateSetting('textAlign', v)}
            textOpacity={textOpacity}
            onOpacityChange={v => updateSetting('textOpacity', v)}
            margins={margins}
            onMarginsChange={v => updateSetting('margins', v)}
            showCamera={showCamera}
            onCameraToggle={() => updateSetting('showCamera', !showCamera)}
            layout={layout}
            onLayoutToggle={() => updateSetting('layout', layout === 'overlay' ? 'side-by-side' : 'overlay')}
            onFullscreen={toggleFullscreen}
            onEditScript={() => setShowEditor(true)}
            countdown={countdown}
          />
        </div>
      )}

      {showEditor && (
        <ScriptEditor
          script={script}
          onChange={onScriptChange}
          onClose={() => { setShowEditor(false); setLibRefresh((n) => n + 1); }}
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
  bodyRow: {
    flex: 1,
    display: 'flex',
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
