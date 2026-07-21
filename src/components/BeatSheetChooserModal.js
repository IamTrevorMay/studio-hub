import React, { useState } from 'react';

// Choose-at-push-time picker for pushing ad copy into a beat sheet.
// Presentational only: the parent owns the copy text + the push logic and
// supplies `onPick(sheetId)`. Archived sheets are excluded here as a safety
// net regardless of what the caller passes in.
export default function BeatSheetChooserModal({ open, beatSheets, onPick, onClose, pushing }) {
  const [search, setSearch] = useState('');
  if (!open) return null;

  const list = (beatSheets || []).filter(bs => !bs.is_archived && bs.folder !== 'archive');
  const q = search.trim().toLowerCase();
  const filtered = q ? list.filter(bs => (bs.title || '').toLowerCase().includes(q)) : list;

  return (
    <div style={s.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget && !pushing) onClose(); }}>
      <div style={s.modal} onMouseDown={e => e.stopPropagation()}>
        <div style={s.header}>
          <h3 style={s.title}>Push to Beat Sheet</h3>
          <button onClick={onClose} disabled={pushing} style={s.closeBtn}>Close</button>
        </div>
        <p style={s.sub}>
          Choose a beat sheet to push the ad copy into. Each deliverable gets its own “Ad Read” beat — re-pushing the same deliverable updates its beat in place, while other ad reads on the sheet stay put.
        </p>
        {list.length > 8 && (
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search beat sheets…"
            style={s.search}
          />
        )}
        <div style={s.list}>
          {filtered.length === 0 ? (
            <div style={s.empty}>No beat sheets found.</div>
          ) : (
            filtered.map(bs => (
              <button
                key={bs.id}
                disabled={pushing}
                onClick={() => onPick(bs.id)}
                style={{ ...s.item, cursor: pushing ? 'default' : 'pointer', opacity: pushing ? 0.6 : 1 }}
              >
                {bs.title || 'Untitled beat sheet'}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const s = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
  },
  modal: {
    background: '#1b2331', borderRadius: 14, width: '92vw', maxWidth: 460,
    maxHeight: '80vh', border: '1px solid rgba(255,255,255,0.1)',
    display: 'flex', flexDirection: 'column', fontFamily: 'DM Sans, sans-serif',
    padding: '18px 20px',
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { margin: 0, fontSize: 16, fontWeight: 600, color: '#fff' },
  closeBtn: {
    background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
    color: 'rgba(255,255,255,0.6)', borderRadius: 6, padding: '6px 12px',
    fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
  },
  sub: { margin: '10px 0 12px', fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 },
  search: {
    width: '100%', boxSizing: 'border-box', marginBottom: 10,
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, padding: '8px 10px', color: '#fff', fontSize: 13,
    fontFamily: 'inherit', outline: 'none',
  },
  list: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 },
  item: {
    width: '100%', textAlign: 'left', background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '10px 12px',
    color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
  },
  empty: { padding: '16px 12px', fontSize: 13, color: 'rgba(255,255,255,0.35)', textAlign: 'center' },
};
