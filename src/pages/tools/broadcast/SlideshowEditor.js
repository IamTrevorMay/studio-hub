import React from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';

// Edits broadcast_assets.slideshow_config. Shape: { slides: [{ id, content, duration_sec? }] }.
// Slides are arbitrary strings (URL, HTML snippet, or template var) —
// the overlay decides how to render them. Keeps the editor schema-agnostic.

export default function SlideshowEditor({ asset, onChange }) {
  const config = asset.slideshow_config || {};
  const slides = Array.isArray(config.slides) ? config.slides : [];

  function setSlides(next) {
    onChange({ ...config, slides: next });
  }
  function add() {
    setSlides([...slides, { id: cryptoId(), content: '', duration_sec: 6 }]);
  }
  function patch(i, p) {
    setSlides(slides.map((s, idx) => (idx === i ? { ...s, ...p } : s)));
  }
  function move(i, d) {
    const to = i + d;
    if (to < 0 || to >= slides.length) return;
    const next = slides.slice();
    const [item] = next.splice(i, 1);
    next.splice(to, 0, item);
    setSlides(next);
  }
  function remove(i) {
    setSlides(slides.filter((_, idx) => idx !== i));
  }

  return (
    <>
      <div style={styles.heading}>Slides</div>
      {slides.length === 0 && <div style={styles.empty}>No slides. Add one to get started.</div>}
      {slides.map((s, i) => (
        <div key={s.id || i} style={styles.row}>
          <div style={styles.idx}>{i + 1}</div>
          <textarea
            value={s.content || ''}
            onChange={(e) => patch(i, { content: e.target.value })}
            rows={2}
            placeholder="HTML / URL / template variable"
            style={{ ...styles.input, flex: 1, fontFamily: 'monospace', fontSize: fontSizes.xs }}
          />
          <input
            type="number"
            value={s.duration_sec ?? ''}
            onChange={(e) => patch(i, { duration_sec: e.target.value === '' ? null : Number(e.target.value) })}
            style={{ ...styles.input, width: 60 }}
            placeholder="sec"
            title="Duration (sec)"
          />
          <div style={styles.actions}>
            <button onClick={() => move(i, -1)} disabled={i === 0} style={styles.iconBtn}>↑</button>
            <button onClick={() => move(i, +1)} disabled={i === slides.length - 1} style={styles.iconBtn}>↓</button>
            <button onClick={() => remove(i)} style={{ ...styles.iconBtn, color: colors.danger.fg }}>×</button>
          </div>
        </div>
      ))}
      <button onClick={add} style={styles.addBtn}>+ Add slide</button>
    </>
  );
}

function cryptoId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

const styles = {
  heading: {
    fontSize: fontSizes.xs, fontWeight: fontWeights.bold,
    color: colors.textSubtle, letterSpacing: '0.08em', textTransform: 'uppercase',
    marginTop: spacing.md, paddingBottom: spacing.xs, borderBottom: `1px solid ${colors.border}`,
  },
  empty: { padding: spacing.md, textAlign: 'center', color: colors.textSubtle, fontSize: fontSizes.xs },
  row: { display: 'flex', gap: spacing.xs, alignItems: 'flex-start', padding: spacing.xs, background: colors.bgRaised, border: `1px solid ${colors.border}`, borderRadius: radii.sm, marginTop: spacing.xs },
  idx: { width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fontSizes.xxs, fontWeight: fontWeights.bold, color: colors.textMuted, background: colors.bgInput, borderRadius: radii.sm },
  input: {
    padding: `${spacing.xs}px ${spacing.sm}px`, background: colors.bgInput,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.text, fontSize: fontSizes.sm, fontFamily: 'inherit', outline: 'none',
  },
  actions: { display: 'flex', flexDirection: 'column', gap: 2 },
  iconBtn: {
    width: 22, height: 22, borderRadius: radii.sm,
    background: 'transparent', border: `1px solid ${colors.border}`,
    color: colors.textMuted, cursor: 'pointer', fontSize: 11,
  },
  addBtn: {
    marginTop: spacing.sm,
    padding: `${spacing.xs}px ${spacing.sm}px`, background: 'transparent',
    border: `1px dashed ${colors.border}`, color: colors.textMuted,
    borderRadius: radii.sm, fontSize: fontSizes.xs, cursor: 'pointer', fontFamily: 'inherit',
  },
};
