import React, { useEffect, useRef } from 'react';

export default function ScriptEditor({ script, onChange, onClose }) {
  const textareaRef = useRef(null);

  useEffect(() => {
    if (textareaRef.current) textareaRef.current.focus();
  }, []);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

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
        <textarea
          ref={textareaRef}
          value={script}
          onChange={e => onChange(e.target.value)}
          placeholder="Paste or type your script here..."
          style={styles.textarea}
          spellCheck={false}
        />
        <div style={styles.footer}>
          <span style={styles.hint}>
            {script.length.toLocaleString()} characters
          </span>
          <button onClick={onClose} style={styles.doneBtn}>Done</button>
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
};
