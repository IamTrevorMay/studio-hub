import React, { useEffect, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import { updateAsset } from './api';

// Live editor for the selected widget asset's template_data jsonb.
// Overlay subscribers re-render on update via Realtime.
// We surface every top-level scalar in template_data as a text input so
// the producer can swap copy mid-show.

export default function TemplateDataPanel({ asset, onChanged }) {
  const [draft, setDraft] = useState(() => normalize(asset && asset.template_data));
  const [saving, setSaving] = useState('idle');
  const [error, setError] = useState(null);

  useEffect(() => {
    setDraft(normalize(asset && asset.template_data));
    setSaving('idle'); setError(null);
  }, [asset && asset.id]);

  if (!asset) {
    return <div style={styles.empty}>Pick a widget asset to edit live data.</div>;
  }

  async function save(next) {
    setDraft(next);
    setSaving('saving');
    try {
      await updateAsset(asset.id, { template_data: next });
      setSaving('saved');
      onChanged && onChanged();
    } catch (e) {
      setSaving('error'); setError(e.message);
    }
  }

  function setKey(k, v) { save({ ...draft, [k]: v }); }
  function addKey() {
    const key = window.prompt('New field name?');
    if (!key) return;
    if (key in draft) return;
    save({ ...draft, [key]: '' });
  }
  function delKey(k) {
    const next = { ...draft };
    delete next[k];
    save(next);
  }

  const entries = Object.entries(draft);

  return (
    <div style={styles.wrap}>
      <div style={styles.headerRow}>
        <div style={styles.title}>Template data</div>
        <span style={styles.saveBadge(saving)}>
          {saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : saving === 'error' ? 'Failed' : ''}
        </span>
      </div>
      {error && <div style={styles.error}>{error}</div>}

      {entries.length === 0 ? (
        <div style={styles.empty}>No fields yet. Add one to start.</div>
      ) : (
        entries.map(([k, v]) => (
          <div key={k} style={styles.row}>
            <span style={styles.key}>{k}</span>
            <input
              value={v == null ? '' : String(v)}
              onChange={(e) => setKey(k, e.target.value)}
              style={{ ...styles.input, flex: 1 }}
            />
            <button onClick={() => delKey(k)} style={styles.delBtn}>×</button>
          </div>
        ))
      )}
      <button onClick={addKey} style={styles.addBtn}>+ Add field</button>
    </div>
  );
}

function normalize(d) {
  if (!d || typeof d !== 'object') return {};
  // Only surface scalar values in the inline editor.
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    out[k] = (typeof v === 'object' && v !== null) ? JSON.stringify(v) : v;
  }
  return out;
}

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', gap: spacing.xs, padding: spacing.md, overflow: 'auto' },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: fontSizes.sm, fontWeight: fontWeights.semibold, color: colors.text },
  saveBadge: (s) => ({ fontSize: fontSizes.xxs, color: s === 'error' ? colors.danger.fg : colors.textSubtle }),
  error: { padding: spacing.xs, background: colors.danger.bg, color: colors.danger.fg, borderRadius: radii.sm, fontSize: fontSizes.xxs },
  empty: { padding: spacing.md, textAlign: 'center', color: colors.textSubtle, fontSize: fontSizes.xs },
  row: { display: 'flex', alignItems: 'center', gap: spacing.xs },
  key: { width: 100, fontFamily: 'monospace', fontSize: fontSizes.xxs, color: colors.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  input: {
    padding: `${spacing.xs}px ${spacing.sm}px`, background: colors.bgInput,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.text, fontSize: fontSizes.xs, fontFamily: 'inherit', outline: 'none',
  },
  delBtn: { width: 22, height: 22, borderRadius: radii.sm, background: 'transparent', border: `1px solid ${colors.border}`, color: colors.danger.fg, cursor: 'pointer', fontSize: 12 },
  addBtn: {
    alignSelf: 'flex-start',
    padding: `${spacing.xs}px ${spacing.sm}px`, background: 'transparent',
    border: `1px dashed ${colors.border}`, color: colors.textMuted,
    borderRadius: radii.sm, fontSize: fontSizes.xxs, cursor: 'pointer', fontFamily: 'inherit',
  },
};
