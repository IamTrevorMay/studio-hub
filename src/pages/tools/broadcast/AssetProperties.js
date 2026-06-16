import React, { useEffect, useRef, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import { updateAsset } from './api';
import SlideshowEditor from './SlideshowEditor';

// Right pane: form-driven editor for the selected asset. Debounced auto-save.

const TRANSITIONS = ['', 'fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'scale', 'instant'];

export default function AssetProperties({ project, asset, onSaved }) {
  const [draft, setDraft] = useState(asset);
  const [saving, setSaving] = useState('idle');
  const [error, setError] = useState(null);

  // Track the currently-selected asset id so an in-flight PATCH started
  // for asset X can't write its "saved" badge or fire onSaved after the
  // user has already switched to asset Y.
  const activeAssetIdRef = useRef(asset?.id || null);
  useEffect(() => { activeAssetIdRef.current = asset?.id || null; }, [asset?.id]);

  useEffect(() => { setDraft(asset); setSaving('idle'); setError(null); }, [asset?.id]);

  useEffect(() => {
    if (!draft || !asset) return;
    if (sameAsset(draft, asset)) return;
    const targetId = asset.id;
    const t = setTimeout(async () => {
      setSaving('saving');
      try {
        await updateAsset(targetId, sanitize(draft));
        if (activeAssetIdRef.current !== targetId) return;
        setSaving('saved');
        onSaved && onSaved();
      } catch (e) {
        if (activeAssetIdRef.current !== targetId) return;
        setSaving('error'); setError(e.message);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [draft, asset, onSaved]);

  if (!asset || !draft) {
    return <div style={styles.wrap}><div style={styles.empty}>Select an asset to edit.</div></div>;
  }

  const set = (patch) => setDraft({ ...draft, ...patch });

  return (
    <div style={styles.wrap}>
      <div style={styles.barRow}>
        <div style={styles.title}>{draft.name || '(untitled)'}</div>
        <span style={styles.saveBadge(saving)}>
          {saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : saving === 'error' ? 'Save failed' : ''}
        </span>
      </div>
      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.heading}>Basic</div>
      <Field label="Name"><Text value={draft.name} onChange={(v) => set({ name: v })} /></Field>
      <Field label="Type"><Text value={draft.asset_type} onChange={(v) => set({ asset_type: v })} /></Field>
      {draft.storage_path && (
        <Field label="Storage path">
          <Text value={draft.storage_path} onChange={(v) => set({ storage_path: v })} />
        </Field>
      )}

      <div style={styles.heading}>Canvas</div>
      <Row>
        <Field label="X"><Num value={draft.canvas_x} onChange={(v) => set({ canvas_x: v })} /></Field>
        <Field label="Y"><Num value={draft.canvas_y} onChange={(v) => set({ canvas_y: v })} /></Field>
      </Row>
      <Row>
        <Field label="Width"><Num value={draft.canvas_width} onChange={(v) => set({ canvas_width: v })} /></Field>
        <Field label="Height"><Num value={draft.canvas_height} onChange={(v) => set({ canvas_height: v })} /></Field>
      </Row>
      <Row>
        <Field label="Layer"><Num value={draft.layer} onChange={(v) => set({ layer: v })} /></Field>
        <Field label="Opacity (0..1)"><Num value={draft.opacity} onChange={(v) => set({ opacity: clamp01(v) })} step="0.01" /></Field>
      </Row>

      <div style={styles.heading}>Hotkey</div>
      <Row>
        <Field label="Key"><Text value={draft.hotkey_key} onChange={(v) => set({ hotkey_key: v })} /></Field>
        <Field label="Color (#hex)"><Text value={draft.hotkey_color} onChange={(v) => set({ hotkey_color: v })} /></Field>
      </Row>
      <Field label="Label"><Text value={draft.hotkey_label} onChange={(v) => set({ hotkey_label: v })} /></Field>
      <Field label="Trigger duration (sec)"><Num value={draft.trigger_duration} onChange={(v) => set({ trigger_duration: v || null })} /></Field>

      <div style={styles.heading}>Transitions</div>
      <Field label="Enter">
        <Select value={draft.enter_transition || ''} onChange={(v) => set({ enter_transition: v || null })} options={TRANSITIONS} />
      </Field>
      <Field label="Exit">
        <Select value={draft.exit_transition || ''} onChange={(v) => set({ exit_transition: v || null })} options={TRANSITIONS} />
      </Field>

      {draft.asset_type === 'slideshow' && (
        <SlideshowEditor
          project={project}
          asset={draft}
          onChange={(slideshow_config) => set({ slideshow_config })}
        />
      )}
    </div>
  );
}

// Compare only the fields the editor can mutate. JSON.stringify equality
// is fragile against key-order and date-string drift; a shallow key
// compare over EDITABLE_KEYS is both faster and reliable.
const EDITABLE_KEYS = [
  'name', 'asset_type', 'storage_path',
  'template_id', 'template_data', 'slideshow_config', 'scene_config', 'ad_config',
  'canvas_x', 'canvas_y', 'canvas_width', 'canvas_height',
  'layer', 'opacity',
  'enter_transition', 'exit_transition',
  'hotkey_key', 'hotkey_color', 'hotkey_label',
  'trigger_duration', 'sort_order',
];
function shallowEqValue(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'object' && typeof b === 'object') {
    // Fall back to stringify for nested config blobs (template_data,
    // slideshow_config, etc.) — they're small and shape-stable.
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}
function sameAsset(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  for (const k of EDITABLE_KEYS) {
    if (!shallowEqValue(a[k], b[k])) return false;
  }
  return true;
}
function sanitize(a) {
  if (!a) return null;
  const { created_at, updated_at, project_id, id, ...rest } = a;
  return rest;
}
function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

function Field({ label, children }) {
  return (
    <label style={styles.field}>
      <div style={styles.label}>{label}</div>
      {children}
    </label>
  );
}
function Row({ children }) {
  return <div style={{ display: 'flex', gap: spacing.sm }}>{children}</div>;
}
function Text({ value, onChange }) {
  return <input value={value || ''} onChange={(e) => onChange(e.target.value)} style={styles.input} />;
}
function Num({ value, onChange, step }) {
  return <input type="number" step={step || 1} value={value == null ? '' : value}
    onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} style={styles.input} />;
}
function Select({ value, onChange, options }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)} style={styles.input}>
      {options.map((o) => <option key={o || '__none'} value={o}>{o || '— none —'}</option>)}
    </select>
  );
}

const styles = {
  wrap: {
    flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', padding: spacing.lg,
    background: colors.bg, display: 'flex', flexDirection: 'column', gap: spacing.xs,
  },
  empty: { padding: spacing.huge, textAlign: 'center', color: colors.textSubtle, fontSize: fontSizes.sm },
  barRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${colors.border}`, paddingBottom: spacing.sm, marginBottom: spacing.sm },
  title: { fontSize: fontSizes.lg, fontWeight: fontWeights.semibold, color: colors.text },
  saveBadge: (s) => ({
    fontSize: fontSizes.xs,
    color: s === 'error' ? colors.danger.fg : colors.textSubtle,
  }),
  error: { padding: spacing.sm, background: colors.danger.bg, color: colors.danger.fg, border: `1px solid ${colors.danger.border}`, borderRadius: radii.sm, fontSize: fontSizes.xs },
  heading: {
    fontSize: fontSizes.xs, fontWeight: fontWeights.bold,
    color: colors.textSubtle, letterSpacing: '0.08em', textTransform: 'uppercase',
    marginTop: spacing.md, paddingBottom: spacing.xs, borderBottom: `1px solid ${colors.border}`,
  },
  field: { display: 'flex', flexDirection: 'column', gap: spacing.xs, marginTop: spacing.xs, flex: 1 },
  label: { fontSize: fontSizes.xs, color: colors.textMuted, fontWeight: fontWeights.medium },
  input: {
    padding: `${spacing.xs}px ${spacing.sm}px`, background: colors.bgInput,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.text, fontSize: fontSizes.sm, fontFamily: 'inherit', outline: 'none',
    width: '100%',
  },
};
