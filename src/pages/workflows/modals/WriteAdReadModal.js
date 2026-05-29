import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../../supabaseClient';

const AUTOSAVE_INTERVAL = 5000; // 5 seconds
const MAX_ROWS = 8;
const LINE_HEIGHT = 20; // approximate px per row

export default function WriteAdReadModal({ task, onClose }) {
  const deliverableId = task.related_entity_id;
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const dirtyRef = useRef(false);
  const textRef = useRef('');
  const textareaRef = useRef(null);

  // Load current ad copy from deliverable
  useEffect(() => {
    if (!deliverableId) { setLoading(false); return; }
    (async () => {
      const { data } = await supabase
        .from('sponsor_deliverables')
        .select('notes')
        .eq('id', deliverableId)
        .single();
      const val = data?.notes || '';
      setText(val);
      textRef.current = val;
      setLoading(false);
    })();
  }, [deliverableId]);

  // Save to DB
  const saveToDb = useCallback(async () => {
    if (!deliverableId || !dirtyRef.current) return;
    dirtyRef.current = false;
    setSaving(true);
    try {
      await supabase
        .from('sponsor_deliverables')
        .update({ notes: textRef.current || null, updated_at: new Date().toISOString() })
        .eq('id', deliverableId);
      setLastSaved(new Date());
    } catch (err) {
      console.error('Autosave failed:', err);
    } finally {
      setSaving(false);
    }
  }, [deliverableId]);

  // Periodic autosave
  useEffect(() => {
    const interval = setInterval(() => {
      if (dirtyRef.current) saveToDb();
    }, AUTOSAVE_INTERVAL);
    return () => clearInterval(interval);
  }, [saveToDb]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = MAX_ROWS * LINE_HEIGHT + 16; // +padding
    el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px';
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [text]);

  const handleChange = (e) => {
    const val = e.target.value;
    setText(val);
    textRef.current = val;
    dirtyRef.current = true;
  };

  const handleSaveAndClose = async () => {
    await saveToDb();
    onClose();
  };

  // Save on unmount / close
  useEffect(() => {
    return () => {
      if (dirtyRef.current && deliverableId) {
        // fire-and-forget final save
        supabase
          .from('sponsor_deliverables')
          .update({ notes: textRef.current || null, updated_at: new Date().toISOString() })
          .eq('id', deliverableId);
      }
    };
  }, [deliverableId]);

  const brandName = task.workflow_instance?.context?.brand_name || '';
  const deliverableTitle = task.title || '';

  return (
    <div style={modalStyles.overlay} onClick={handleSaveAndClose}>
      <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <div>
            <div style={modalStyles.title}>Write Ad Read</div>
            <div style={modalStyles.subtitle}>
              {deliverableTitle}{brandName ? ` \u2014 ${brandName}` : ''}
            </div>
          </div>
          <button style={modalStyles.closeBtn} onClick={handleSaveAndClose}>{'\u2715'}</button>
        </div>

        {loading ? (
          <div style={{ padding: '20px 0', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
            Loading...
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            placeholder="Write your ad read copy here..."
            autoFocus
            style={modalStyles.textarea}
          />
        )}

        <div style={modalStyles.footer}>
          <div style={modalStyles.saveStatus}>
            {saving && <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>Saving...</span>}
            {!saving && lastSaved && (
              <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>
                Saved {lastSaved.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
          </div>
          <button style={modalStyles.saveBtn} onClick={handleSaveAndClose}>
            Save &amp; Close
          </button>
        </div>
      </div>
    </div>
  );
}

const modalStyles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    background: '#15151f', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 16, padding: 20, width: 520, maxWidth: '90vw',
    boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: 700, color: '#fff' },
  subtitle: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  closeBtn: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)',
    fontSize: 16, cursor: 'pointer', padding: 4,
  },
  textarea: {
    width: '100%', boxSizing: 'border-box', padding: '10px 12px',
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, color: '#fff', fontSize: 14, lineHeight: '20px',
    fontFamily: 'inherit', resize: 'none', outline: 'none',
    minHeight: 60,
  },
  footer: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 14, marginTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  saveStatus: {
    minHeight: 16,
  },
  saveBtn: {
    padding: '8px 18px', borderRadius: 8, background: '#6366f1',
    border: 'none', color: '#fff', fontWeight: 600, fontSize: 13,
    cursor: 'pointer', fontFamily: 'inherit',
  },
};
