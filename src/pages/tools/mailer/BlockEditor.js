import React, { useState } from 'react';
import { BLOCK_TYPES } from './blockRenderer';

// Block-based editor. Renders a vertical list of block cards with per-
// type inline forms. Reorder via ↑/↓, delete via ×, add via the picker
// row at the bottom. The blocks array is fully controlled by the parent
// so undo/redo + autosave stay simple to wire later.

export default function BlockEditor({ blocks, onChange }) {
  const [adding, setAdding] = useState(false);

  function updateBlock(idx, patch) {
    const next = blocks.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  }
  function removeBlock(idx) {
    const next = blocks.slice();
    next.splice(idx, 1);
    onChange(next);
  }
  function moveBlock(idx, dir) {
    const target = idx + dir;
    if (target < 0 || target >= blocks.length) return;
    const next = blocks.slice();
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    onChange(next);
  }
  function addBlock(type) {
    const spec = BLOCK_TYPES.find((b) => b.type === type);
    if (!spec) return;
    onChange([...(blocks || []), { type, ...spec.defaults }]);
    setAdding(false);
  }

  return (
    <div style={styles.wrap}>
      {(blocks || []).length === 0 && (
        <div style={styles.empty}>No blocks yet. Pick one below to start.</div>
      )}
      {(blocks || []).map((b, i) => (
        <BlockCard
          key={i}
          block={b}
          index={i}
          isFirst={i === 0}
          isLast={i === blocks.length - 1}
          onChange={(patch) => updateBlock(i, patch)}
          onRemove={() => removeBlock(i)}
          onMove={(dir) => moveBlock(i, dir)}
        />
      ))}
      <div style={styles.addRow}>
        {adding ? (
          <div style={styles.addPalette}>
            {BLOCK_TYPES.map((t) => (
              <button key={t.type} onClick={() => addBlock(t.type)} style={styles.addPickBtn}>
                + {t.label}
              </button>
            ))}
            <button onClick={() => setAdding(false)} style={styles.cancelAddBtn}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} style={styles.addBtn}>+ Add block</button>
        )}
      </div>
    </div>
  );
}

function BlockCard({ block, index, isFirst, isLast, onChange, onRemove, onMove }) {
  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <span style={styles.cardType}>{block.type}</span>
        <span style={{ flex: 1 }} />
        <button title="Move up" disabled={isFirst} onClick={() => onMove(-1)} style={styles.iconBtn}>↑</button>
        <button title="Move down" disabled={isLast} onClick={() => onMove(1)} style={styles.iconBtn}>↓</button>
        <button title="Delete" onClick={onRemove} style={{ ...styles.iconBtn, color: '#f87171' }}>×</button>
      </div>
      <div style={styles.cardBody}>
        <BlockFields block={block} onChange={onChange} />
      </div>
    </div>
  );
}

function BlockFields({ block, onChange }) {
  switch (block.type) {
    case 'heading':
      return (
        <>
          <Row>
            <Field label="Text"><Input value={block.text} onChange={(v) => onChange({ text: v })} /></Field>
          </Row>
          <Row>
            <Field label="Level">
              <Select value={String(block.level || 2)} onChange={(v) => onChange({ level: Number(v) })} options={[['1', 'H1'], ['2', 'H2'], ['3', 'H3']]} />
            </Field>
            <Field label="Align">
              <Select value={block.align || 'left'} onChange={(v) => onChange({ align: v })} options={[['left', 'Left'], ['center', 'Center'], ['right', 'Right']]} />
            </Field>
          </Row>
        </>
      );
    case 'paragraph':
      return (
        <>
          <Field label="Text">
            <textarea value={block.text || ''} onChange={(e) => onChange({ text: e.target.value })} style={{ ...styles.input, minHeight: 90 }} />
          </Field>
          <Field label="Align">
            <Select value={block.align || 'left'} onChange={(v) => onChange({ align: v })} options={[['left', 'Left'], ['center', 'Center'], ['right', 'Right']]} />
          </Field>
        </>
      );
    case 'image':
      return (
        <>
          <Field label="Image URL"><Input value={block.src} onChange={(v) => onChange({ src: v })} placeholder="https://…/image.jpg" /></Field>
          <Row>
            <Field label="Alt text"><Input value={block.alt} onChange={(v) => onChange({ alt: v })} /></Field>
            <Field label="Width"><Input type="number" value={block.width} onChange={(v) => onChange({ width: Number(v) || null })} placeholder="600" /></Field>
          </Row>
          <Field label="Link URL (optional)"><Input value={block.href} onChange={(v) => onChange({ href: v })} placeholder="https://…" /></Field>
        </>
      );
    case 'button':
      return (
        <>
          <Row>
            <Field label="Label"><Input value={block.text} onChange={(v) => onChange({ text: v })} /></Field>
            <Field label="Align">
              <Select value={block.align || 'center'} onChange={(v) => onChange({ align: v })} options={[['left', 'Left'], ['center', 'Center'], ['right', 'Right']]} />
            </Field>
          </Row>
          <Field label="URL"><Input value={block.href} onChange={(v) => onChange({ href: v })} placeholder="https://…" /></Field>
        </>
      );
    case 'divider':
      return <div style={styles.note}>Renders a horizontal rule. No fields.</div>;
    case 'spacer':
      return (
        <Field label="Height (px)">
          <Input type="number" value={block.size || 16} onChange={(v) => onChange({ size: Number(v) || 16 })} />
        </Field>
      );
    case 'html':
      return (
        <Field label="Raw HTML">
          <textarea
            value={block.html || ''}
            onChange={(e) => onChange({ html: e.target.value })}
            style={{ ...styles.input, minHeight: 120, fontFamily: 'monospace', fontSize: 12 }}
            spellCheck={false}
          />
        </Field>
      );
    default:
      return <div style={styles.note}>Unknown block type: {block.type}</div>;
  }
}

// ─── Small primitives ──────────────────────────────────────────

function Row({ children }) { return <div style={{ display: 'flex', gap: 8 }}>{children}</div>; }
function Field({ label, children }) {
  return (
    <label style={styles.fieldWrap}>
      <span style={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}
function Input({ value, onChange, type, placeholder }) {
  return <input type={type || 'text'} value={value == null ? '' : value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={styles.input} />;
}
function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={styles.input}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 10 },
  empty: { padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 13, border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 8 },
  card: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  cardType: { fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: '#a5b4fc' },
  cardBody: { padding: 12, display: 'flex', flexDirection: 'column', gap: 10 },
  iconBtn: { background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)', borderRadius: 4, width: 24, height: 24, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  fieldWrap: { display: 'flex', flexDirection: 'column', gap: 3, flex: 1 },
  fieldLabel: { fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.45)', letterSpacing: 0.4, textTransform: 'uppercase' },
  input: { background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '7px 10px', color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', width: '100%', resize: 'vertical' },
  note: { fontSize: 12, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' },
  addRow: { paddingTop: 4 },
  addBtn: { width: '100%', padding: '10px', background: 'transparent', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 8, color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  addPalette: { display: 'flex', flexWrap: 'wrap', gap: 6, padding: 8, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 8 },
  addPickBtn: { background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)', color: '#c7d2fe', borderRadius: 6, padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  cancelAddBtn: { background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.5)', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' },
};
