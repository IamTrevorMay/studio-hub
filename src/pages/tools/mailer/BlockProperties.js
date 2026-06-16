import React, { useState } from 'react';
import { Settings2, ChevronDown, ChevronRight } from 'lucide-react';

// Collapsible "Block properties" section for shared visual props:
// padding (top/right/bottom/left), background color, visibility.
// Used inside every block card after the type-specific fields.

const SIDES = ['top', 'right', 'bottom', 'left'];

export default function BlockProperties({ block, onChange }) {
  const [open, setOpen] = useState(false);

  const padding = block.padding || {};
  function setPad(side, raw) {
    const v = raw === '' ? null : Number(raw);
    if (raw !== '' && !Number.isFinite(v)) return;
    onChange({ padding: { ...padding, [side]: v } });
  }
  function setBg(v) { onChange({ background: v || null }); }
  function setVisible(v) { onChange({ visible: v }); }

  const isVisible = block.visible !== false;

  return (
    <div style={styles.wrap}>
      <button onClick={() => setOpen((o) => !o)} style={styles.header}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Settings2 size={12} />
        <span>Block properties</span>
        {!isVisible && <span style={styles.hiddenBadge}>hidden</span>}
      </button>

      {open && (
        <div style={styles.body}>
          <div style={styles.row}>
            <label style={styles.toggle}>
              <input
                type="checkbox"
                checked={isVisible}
                onChange={(e) => setVisible(e.target.checked)}
              />
              Visible
            </label>
          </div>

          <div style={styles.subLabel}>Padding (px)</div>
          <div style={styles.padGrid}>
            {SIDES.map((s) => (
              <label key={s} style={styles.padCell}>
                <span style={styles.padLabel}>{s[0].toUpperCase()}</span>
                <input
                  type="number"
                  value={padding[s] == null ? '' : padding[s]}
                  onChange={(e) => setPad(s, e.target.value)}
                  style={styles.input}
                  placeholder="0"
                />
              </label>
            ))}
          </div>

          <div style={styles.subLabel}>Background color</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="color"
              value={block.background || '#ffffff'}
              onChange={(e) => setBg(e.target.value)}
              style={styles.colorInput}
            />
            <input
              type="text"
              value={block.background || ''}
              onChange={(e) => setBg(e.target.value)}
              placeholder="#ffffff or transparent"
              style={{ ...styles.input, flex: 1 }}
            />
            <button onClick={() => setBg(null)} style={styles.clearBtn}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  wrap: { borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8, marginTop: 4 },
  header: {
    display: 'flex', alignItems: 'center', gap: 6,
    background: 'transparent', border: 'none',
    color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: 700,
    letterSpacing: 0.4, textTransform: 'uppercase',
    padding: 0, cursor: 'pointer', fontFamily: 'inherit',
  },
  hiddenBadge: {
    marginLeft: 6, padding: '1px 6px',
    background: 'rgba(239,68,68,0.12)', color: '#f87171',
    fontSize: 9, borderRadius: 4, textTransform: 'uppercase',
  },
  body: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 },
  row: { display: 'flex', gap: 8 },
  toggle: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(255,255,255,0.85)' },
  subLabel: { fontSize: 10, color: 'rgba(255,255,255,0.45)', fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' },
  padGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 },
  padCell: { display: 'flex', flexDirection: 'column', gap: 2 },
  padLabel: { fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: 700, textAlign: 'center' },
  input: {
    background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6, padding: '5px 8px', color: '#fff', fontSize: 12,
    outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', width: '100%',
  },
  colorInput: {
    width: 32, height: 30, padding: 0, background: 'transparent',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, cursor: 'pointer',
  },
  clearBtn: {
    background: 'transparent', color: 'rgba(255,255,255,0.5)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
    padding: '5px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
  },
};
