import React, { useEffect, useRef, useState } from 'react';
import { loadSavedScripts, saveScriptToLibrary, deleteSavedScript } from './teleprompterStorage';

export default function ScriptEditor({ script, onChange, onClose }) {
  const textareaRef = useRef(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [savedScripts, setSavedScripts] = useState([]);

  useEffect(() => {
    if (textareaRef.current) textareaRef.current.focus();
  }, []);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') {
        if (showLibrary) {
          setShowLibrary(false);
        } else {
          onClose();
        }
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, showLibrary]);

  const refreshLibrary = () => setSavedScripts(loadSavedScripts());

  const handleSave = () => {
    const name = prompt('Script name:');
    if (!name || !name.trim()) return;
    saveScriptToLibrary(name.trim(), script);
  };

  const handleOpenLibrary = () => {
    refreshLibrary();
    setShowLibrary(true);
  };

  const handleLoad = (text) => {
    onChange(text);
    setShowLibrary(false);
  };

  const handleDelete = (id) => {
    deleteSavedScript(id);
    refreshLibrary();
  };

  const formatDate = (ts) => {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>Edit Script</span>
          <button onClick={onClose} style={styles.closeBtn} title="Close (Esc)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {showLibrary ? (
          <div style={styles.libraryContainer}>
            <div style={styles.libraryHeader}>
              <span style={styles.libraryTitle}>Saved Scripts</span>
              <button onClick={() => setShowLibrary(false)} style={styles.libraryBackBtn}>
                Back to Editor
              </button>
            </div>
            {savedScripts.length === 0 ? (
              <div style={styles.emptyLibrary}>
                No saved scripts yet. Write a script and click Save.
              </div>
            ) : (
              <div style={styles.scriptList}>
                {savedScripts.map(s => (
                  <div key={s.id} style={styles.scriptItem}>
                    <div style={styles.scriptInfo}>
                      <span style={styles.scriptName}>{s.name}</span>
                      <span style={styles.scriptMeta}>
                        {formatDate(s.savedAt)} &middot; {s.text.length.toLocaleString()} chars
                      </span>
                    </div>
                    <div style={styles.scriptActions}>
                      <button onClick={() => handleLoad(s.text)} style={styles.loadBtn}>Load</button>
                      <button onClick={() => handleDelete(s.id)} style={styles.deleteBtn} title="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={script}
            onChange={e => onChange(e.target.value)}
            placeholder="Paste or type your script here..."
            style={styles.textarea}
            spellCheck={false}
          />
        )}

        <div style={styles.footer}>
          <span style={styles.hint}>
            {script.length.toLocaleString()} characters
          </span>
          <div style={styles.footerActions}>
            <button onClick={handleOpenLibrary} style={styles.secondaryBtn}>Load</button>
            <button onClick={handleSave} style={styles.secondaryBtn}>Save</button>
            <button onClick={onClose} style={styles.doneBtn}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 900,
    display: 'flex',
    justifyContent: 'flex-end',
  },
  panel: {
    width: '480px',
    maxWidth: '100vw',
    height: '100%',
    background: '#1a1a2e',
    borderLeft: '1px solid rgba(255,255,255,0.1)',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    flexShrink: 0,
  },
  title: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#e2e8f0',
  },
  closeBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    border: 'none',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
  },
  textarea: {
    flex: 1,
    margin: '16px 20px',
    padding: '16px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '10px',
    color: '#e2e8f0',
    fontSize: '15px',
    lineHeight: 1.7,
    fontFamily: "'DM Sans', sans-serif",
    resize: 'none',
    outline: 'none',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 20px',
    borderTop: '1px solid rgba(255,255,255,0.08)',
    flexShrink: 0,
  },
  hint: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.3)',
  },
  footerActions: {
    display: 'flex',
    gap: '8px',
  },
  secondaryBtn: {
    padding: '8px 16px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#e2e8f0',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  doneBtn: {
    padding: '8px 20px',
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  // Library styles
  libraryContainer: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  libraryHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  libraryTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#a5b4fc',
  },
  libraryBackBtn: {
    padding: '5px 12px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    color: 'rgba(255,255,255,0.6)',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  emptyLibrary: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'rgba(255,255,255,0.25)',
    fontSize: '14px',
    padding: '40px 20px',
    textAlign: 'center',
  },
  scriptList: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 12px',
  },
  scriptItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.03)',
    marginBottom: '6px',
    border: '1px solid rgba(255,255,255,0.05)',
  },
  scriptInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minWidth: 0,
    flex: 1,
  },
  scriptName: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#e2e8f0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  scriptMeta: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.3)',
  },
  scriptActions: {
    display: 'flex',
    gap: '6px',
    marginLeft: '12px',
    flexShrink: 0,
  },
  loadBtn: {
    padding: '5px 12px',
    background: 'rgba(99,102,241,0.15)',
    border: '1px solid rgba(99,102,241,0.3)',
    borderRadius: '6px',
    color: '#a5b4fc',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  deleteBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    border: 'none',
    borderRadius: '6px',
    background: 'rgba(239,68,68,0.1)',
    color: 'rgba(239,68,68,0.6)',
    cursor: 'pointer',
  },
};
