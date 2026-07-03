import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';

function escapeHtml(text) {
  const el = document.createElement('span');
  el.textContent = text;
  return el.innerHTML;
}

function sanitizePastedHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  function processNode(node) {
    if (node.nodeType === 3) return escapeHtml(node.textContent);
    if (node.nodeType !== 1) return '';
    const tag = node.tagName.toLowerCase();
    const children = Array.from(node.childNodes).map(processNode).join('');
    if (tag === 'br') return '<br>';
    const outputTag = tag === 'div' ? 'p' : tag;
    if (['p', 'div', 'ul', 'ol', 'li'].includes(tag)) {
      let attrs = '';
      if (outputTag === 'p') {
        const align = node.style && node.style.textAlign;
        if (align && align !== 'start' && align !== 'left') {
          attrs = ` style="text-align:${align}"`;
        }
      }
      return `<${outputTag}${attrs}>${children}</${outputTag}>`;
    }
    return children;
  }

  return processNode(doc.body);
}

export function ensureHtml(text) {
  if (!text) return '';
  if (/<(p|ul|ol|li|div|br)\b/i.test(text)) return text;
  return text.split('\n').map(line => `<p>${escapeHtml(line) || '<br>'}</p>`).join('');
}

export default function ScriptEditor({ script, onChange, onClose }) {
  const { profile } = useAuth();
  const editorRef = useRef(null);
  const isInternalChange = useRef(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [savedScripts, setSavedScripts] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);

  // Sync script prop to editor (skip when change came from user input)
  useEffect(() => {
    if (isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    if (editorRef.current) {
      editorRef.current.innerHTML = ensureHtml(script);
    }
  }, [script]);

  useEffect(() => {
    if (editorRef.current) editorRef.current.focus();
  }, []);

  // One-time migration: move localStorage scripts to Supabase
  useEffect(() => {
    if (!profile?.id) return;
    const MIGRATED_KEY = 'studio-hub-teleprompter-scripts-migrated';
    if (localStorage.getItem(MIGRATED_KEY)) return;
    try {
      const raw = localStorage.getItem('studio-hub-teleprompter-scripts');
      const old = raw ? JSON.parse(raw) : [];
      if (old.length > 0) {
        const rows = old.map(s => ({
          user_id: profile.id,
          name: s.name,
          content: s.text,
          created_at: new Date(s.savedAt).toISOString(),
        }));
        supabase.from('teleprompter_scripts').insert(rows).then(({ error }) => {
          if (!error) {
            localStorage.setItem(MIGRATED_KEY, '1');
            localStorage.removeItem('studio-hub-teleprompter-scripts');
          } else {
            console.error('Script migration error:', error);
          }
        });
      } else {
        localStorage.setItem(MIGRATED_KEY, '1');
      }
    } catch { /* ignore parse errors */ }
  }, [profile?.id]);

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

  const refreshLibrary = async () => {
    setLibraryLoading(true);
    const { data, error } = await supabase
      .from('teleprompter_scripts')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) console.error('Load scripts error:', error);
    setSavedScripts(data || []);
    setLibraryLoading(false);
  };

  const handleSave = async () => {
    const name = prompt('Script name:');
    if (!name || !name.trim()) return;
    if (!profile?.id) return alert('You must be logged in to save scripts.');
    const { error } = await supabase.from('teleprompter_scripts').insert({
      user_id: profile.id,
      name: name.trim(),
      content: script,
    });
    if (error) {
      console.error('Save script error:', error);
      alert('Failed to save script.');
    }
  };

  const handleOpenLibrary = () => {
    refreshLibrary();
    setShowLibrary(true);
  };

  const handleLoad = (s) => {
    onChange(s.content);
    setShowLibrary(false);
  };

  const handleDelete = async (id) => {
    await supabase.from('teleprompter_scripts').delete().eq('id', id);
    refreshLibrary();
  };

  const formatDate = (ts) => {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const handleNew = () => {
    onChange('');
    if (editorRef.current) editorRef.current.innerHTML = '';
  };

  const handlePaste = (e) => {
    const html = e.clipboardData.getData('text/html');
    if (html) {
      e.preventDefault();
      const clean = sanitizePastedHtml(html);
      document.execCommand('insertHTML', false, clean);
    }
  };

  const handleInput = () => {
    if (editorRef.current) {
      isInternalChange.current = true;
      let html = editorRef.current.innerHTML;
      if (html === '<br>' || html === '<div><br></div>') html = '';
      onChange(html);
    }
  };

  const getCharCount = () => {
    if (editorRef.current) return editorRef.current.textContent.length;
    return script.replace(/<[^>]*>/g, '').length;
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

        <div style={{ ...styles.editorWrapper, display: showLibrary ? 'none' : 'flex' }}>
          <div
            ref={editorRef}
            contentEditable
            onInput={handleInput}
            onPaste={handlePaste}
            style={styles.editor}
            spellCheck={false}
            suppressContentEditableWarning
          />
          {!script && (
            <div style={styles.placeholder}>Paste or type your script here...</div>
          )}
        </div>

        <div style={{ ...styles.libraryContainer, display: showLibrary ? 'flex' : 'none' }}>
          <div style={styles.libraryHeader}>
            <span style={styles.libraryTitle}>Saved Scripts</span>
            <button onClick={() => setShowLibrary(false)} style={styles.libraryBackBtn}>
              Back to Editor
            </button>
          </div>
          {libraryLoading ? (
            <div style={styles.emptyLibrary}>Loading...</div>
          ) : savedScripts.length === 0 ? (
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
                      {formatDate(s.created_at)} &middot; {(s.content || '').replace(/<[^>]*>/g, '').length.toLocaleString()} chars
                    </span>
                  </div>
                  <div style={styles.scriptActions}>
                    <button onClick={() => handleLoad(s)} style={styles.loadBtn}>Load</button>
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

        <div style={styles.footer}>
          <span style={styles.hint}>
            {getCharCount().toLocaleString()} characters
          </span>
          <div style={styles.footerActions}>
            <button onClick={handleNew} style={styles.secondaryBtn}>New</button>
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
    background: 'rgba(0,0,0,0.85)',
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
  editorWrapper: {
    flex: 1,
    position: 'relative',
    margin: '16px 20px',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    overflow: 'hidden',
  },
  editor: {
    flex: 1,
    padding: '16px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '10px',
    color: '#e2e8f0',
    fontSize: '15px',
    lineHeight: 1.7,
    fontFamily: "'DM Sans', sans-serif",
    outline: 'none',
    overflowY: 'auto',
  },
  placeholder: {
    position: 'absolute',
    top: '16px',
    left: '16px',
    color: 'rgba(255,255,255,0.25)',
    fontSize: '15px',
    fontFamily: "'DM Sans', sans-serif",
    lineHeight: 1.7,
    pointerEvents: 'none',
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
    overflowX: 'hidden',
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
    overflowX: 'hidden',
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
