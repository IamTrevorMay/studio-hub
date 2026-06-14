import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import {
  listScenes,
  listAssets,
  listSceneAssets,
  createSceneAsset,
  updateSceneAsset,
  deleteSceneAsset,
} from './api';
import { supabase } from '../../../supabaseClient';

// Per-scene canvas editor. Each scene gets its own placement of assets
// via broadcast_scene_assets rows — position/size/layer/opacity are
// per-scene overrides on top of the asset's defaults (null = fall back
// to asset). Drag to move, corner handles to resize, click to select,
// delete to remove from the scene. Debounced auto-save keeps every
// edit in sync without a separate Save button.
//
// Coordinate system: a 1920×1080 base canvas, scaled to fit the
// editor pane via a CSS transform. All persisted coords are in base
// canvas units so the overlay can render them 1:1 inside OBS.

const CANVAS_W = 1920;
const CANVAS_H = 1080;
const SAVE_DEBOUNCE_MS = 300;

export default function SceneEditor({ project }) {
  const [scenes, setScenes] = useState([]);
  const [assets, setAssets] = useState([]);
  const [sceneAssets, setSceneAssets] = useState([]); // rows for the currently-selected scene
  const [sceneId, setSceneId] = useState(null);
  const [selectedSceneAssetId, setSelectedSceneAssetId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ─── Load scenes + assets + (selected) scene_assets ─────────
  const loadProject = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [sRes, aRes] = await Promise.all([
        listScenes(project.id),
        listAssets(project.id),
      ]);
      const next = sRes.scenes || [];
      setScenes(next);
      setAssets(aRes.assets || []);
      if (!sceneId && next.length > 0) setSceneId(next[0].id);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [project.id, sceneId]);

  const loadSceneAssets = useCallback(async () => {
    if (!sceneId) { setSceneAssets([]); return; }
    try {
      const { sceneAssets: rows } = await listSceneAssets({ scene_id: sceneId });
      setSceneAssets(rows || []);
    } catch (e) { setError(e.message); }
  }, [sceneId]);

  useEffect(() => { loadProject(); /* eslint-disable-next-line */ }, [project.id]);
  useEffect(() => { loadSceneAssets(); }, [loadSceneAssets]);

  // Live-refresh on scene_assets writes so a producer editing on another
  // device (or the live overlay updating itself) reflects here.
  useEffect(() => {
    if (!sceneId) return;
    const ch = supabase
      .channel(`bsa-${sceneId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public',
        table: 'broadcast_scene_assets',
        filter: `scene_id=eq.${sceneId}`,
      }, loadSceneAssets)
      .subscribe();
    return () => {
      ch.unsubscribe().catch(() => null);
      supabase.removeChannel(ch);
    };
  }, [sceneId, loadSceneAssets]);

  // ─── Asset palette: which assets aren't yet in this scene ───
  const assetsById = useMemo(() => {
    const m = new Map();
    for (const a of assets) m.set(a.id, a);
    return m;
  }, [assets]);
  const placedAssetIds = useMemo(
    () => new Set(sceneAssets.map((sa) => sa.asset_id)),
    [sceneAssets],
  );
  const palette = useMemo(
    () => assets.filter((a) => !placedAssetIds.has(a.id)),
    [assets, placedAssetIds],
  );

  // ─── Debounced PATCH per row ────────────────────────────────
  const pendingTimers = useRef(new Map()); // id → timeout
  const queueSave = useCallback((rowId, patch) => {
    setSceneAssets((prev) => prev.map((sa) => sa.id === rowId ? { ...sa, ...patch } : sa));
    const existing = pendingTimers.current.get(rowId);
    if (existing) clearTimeout(existing);
    const t = setTimeout(async () => {
      pendingTimers.current.delete(rowId);
      try { await updateSceneAsset(rowId, patch); }
      catch (e) { setError(e.message); loadSceneAssets(); }
    }, SAVE_DEBOUNCE_MS);
    pendingTimers.current.set(rowId, t);
  }, [loadSceneAssets]);

  useEffect(() => () => {
    for (const t of pendingTimers.current.values()) clearTimeout(t);
  }, []);

  // ─── Palette → add to scene ─────────────────────────────────
  async function addAssetToScene(asset) {
    try {
      // Seed the override position from the asset's own canvas_* so the
      // first placement isn't (0,0). Producer can then drag/resize from
      // a reasonable starting point.
      const { sceneAsset } = await createSceneAsset({
        scene_id: sceneId,
        asset_id: asset.id,
        is_visible: true,
        override_x: asset.canvas_x ?? 100,
        override_y: asset.canvas_y ?? 100,
        override_width: asset.canvas_width ?? 480,
        override_height: asset.canvas_height ?? 270,
        override_layer: asset.layer ?? null,
        override_opacity: asset.opacity ?? null,
      });
      setSceneAssets((prev) => [...prev, sceneAsset]);
      setSelectedSceneAssetId(sceneAsset.id);
    } catch (e) { setError(e.message); }
  }

  async function removeFromScene(rowId) {
    try {
      await deleteSceneAsset(rowId);
      setSceneAssets((prev) => prev.filter((sa) => sa.id !== rowId));
      if (selectedSceneAssetId === rowId) setSelectedSceneAssetId(null);
    } catch (e) { setError(e.message); }
  }

  const selectedRow = useMemo(
    () => sceneAssets.find((sa) => sa.id === selectedSceneAssetId) || null,
    [sceneAssets, selectedSceneAssetId],
  );
  const selectedAsset = selectedRow ? assetsById.get(selectedRow.asset_id) : null;

  // Keyboard: Delete removes selected, Esc deselects.
  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (e.key === 'Escape') setSelectedSceneAssetId(null);
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedSceneAssetId) {
        e.preventDefault();
        removeFromScene(selectedSceneAssetId);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedSceneAssetId]); // eslint-disable-line

  if (loading) return <div style={styles.empty}>Loading…</div>;
  if (scenes.length === 0) {
    return <div style={styles.empty}>No scenes yet. Add one in the Scenes tab first.</div>;
  }

  return (
    <div style={styles.wrap}>
      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.topBar}>
        <label style={styles.label}>Scene</label>
        <select
          value={sceneId || ''}
          onChange={(e) => { setSceneId(e.target.value); setSelectedSceneAssetId(null); }}
          style={styles.select}
        >
          {scenes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span style={styles.canvasHint}>{CANVAS_W}×{CANVAS_H} · {sceneAssets.length} asset{sceneAssets.length === 1 ? '' : 's'}</span>
      </div>

      <div style={styles.body}>
        <CanvasPane
          rows={sceneAssets}
          assetsById={assetsById}
          selectedId={selectedSceneAssetId}
          onSelect={setSelectedSceneAssetId}
          onChange={queueSave}
        />
        <PalettePane
          palette={palette}
          selectedAsset={selectedAsset}
          selectedRow={selectedRow}
          onAdd={addAssetToScene}
          onChange={queueSave}
          onRemove={removeFromScene}
        />
      </div>
    </div>
  );
}

// ─── Canvas pane (drag + resize) ────────────────────────────────

function CanvasPane({ rows, assetsById, selectedId, onSelect, onChange }) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(1);

  // Fit the 1920×1080 base canvas inside the pane on resize.
  useEffect(() => {
    function measure() {
      const el = wrapRef.current;
      if (!el) return;
      const padding = 32;
      const w = el.clientWidth - padding;
      const h = el.clientHeight - padding;
      const s = Math.min(w / CANVAS_W, h / CANVAS_H);
      setScale(s > 0 ? s : 0.2);
    }
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} style={styles.canvasWrap} onMouseDown={(e) => { if (e.target === e.currentTarget) onSelect(null); }}>
      <div
        style={{
          ...styles.canvas,
          width: CANVAS_W,
          height: CANVAS_H,
          transform: `scale(${scale})`,
        }}
        onMouseDown={(e) => { if (e.target === e.currentTarget) onSelect(null); }}
      >
        {rows
          .slice()
          .sort((a, b) => (a.override_layer ?? 0) - (b.override_layer ?? 0))
          .map((row) => (
            <CanvasItem
              key={row.id}
              row={row}
              asset={assetsById.get(row.asset_id)}
              isSelected={row.id === selectedId}
              scale={scale}
              onSelect={() => onSelect(row.id)}
              onChange={(patch) => onChange(row.id, patch)}
            />
          ))}
      </div>
    </div>
  );
}

function CanvasItem({ row, asset, isSelected, scale, onSelect, onChange }) {
  const x = row.override_x ?? asset?.canvas_x ?? 0;
  const y = row.override_y ?? asset?.canvas_y ?? 0;
  const w = row.override_width ?? asset?.canvas_width ?? 480;
  const h = row.override_height ?? asset?.canvas_height ?? 270;
  const opacity = (row.override_opacity ?? asset?.opacity ?? 1);

  // Pointer drag → updates override_x/y. Use a ref to track start.
  function onPointerDown(e) {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect();
    const startX = e.clientX, startY = e.clientY;
    const baseX = x, baseY = y;
    function onMove(ev) {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      onChange({
        override_x: Math.round(baseX + dx),
        override_y: Math.round(baseY + dy),
      });
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function onResizeDown(corner) {
    return (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      onSelect();
      const startX = e.clientX, startY = e.clientY;
      const base = { x, y, w, h };
      function onMove(ev) {
        const dx = (ev.clientX - startX) / scale;
        const dy = (ev.clientY - startY) / scale;
        let nx = base.x, ny = base.y, nw = base.w, nh = base.h;
        if (corner.includes('e')) nw = Math.max(20, base.w + dx);
        if (corner.includes('s')) nh = Math.max(20, base.h + dy);
        if (corner.includes('w')) { nw = Math.max(20, base.w - dx); nx = base.x + (base.w - nw); }
        if (corner.includes('n')) { nh = Math.max(20, base.h - dy); ny = base.y + (base.h - nh); }
        onChange({
          override_x: Math.round(nx),
          override_y: Math.round(ny),
          override_width: Math.round(nw),
          override_height: Math.round(nh),
        });
      }
      function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };
  }

  const dim = !row.is_visible;
  return (
    <div
      onPointerDown={onPointerDown}
      style={{
        position: 'absolute',
        left: x, top: y, width: w, height: h,
        background: asset?.asset_type === 'image' && asset.storage_path
          ? '#000'
          : 'rgba(99,102,241,0.18)',
        border: isSelected
          ? '2px solid #818cf8'
          : '1px solid rgba(255,255,255,0.25)',
        outline: dim ? '2px dashed rgba(239,68,68,0.5)' : 'none',
        opacity: dim ? 0.45 : opacity,
        boxSizing: 'border-box',
        cursor: 'move',
        userSelect: 'none',
      }}
    >
      <CanvasItemPreview asset={asset} />
      <div style={{
        position: 'absolute', left: 4, top: 4,
        padding: '2px 6px', borderRadius: 3,
        background: 'rgba(0,0,0,0.6)', color: '#fff',
        fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
        pointerEvents: 'none',
      }}>
        {asset?.name || 'asset'}
        {!row.is_visible && ' · hidden'}
      </div>
      {isSelected && ['nw', 'ne', 'sw', 'se'].map((corner) => (
        <div
          key={corner}
          onPointerDown={onResizeDown(corner)}
          style={{
            position: 'absolute',
            width: 12, height: 12,
            background: '#818cf8',
            border: '1px solid #1a1a2e',
            ...(corner.includes('n') ? { top: -6 } : { bottom: -6 }),
            ...(corner.includes('w') ? { left: -6 } : { right: -6 }),
            cursor: `${corner}-resize`,
          }}
        />
      ))}
    </div>
  );
}

function CanvasItemPreview({ asset }) {
  if (!asset) return null;
  if (asset.asset_type === 'image' && asset.storage_path) {
    const supaUrl = process.env.REACT_APP_SUPABASE_URL;
    const src = `${supaUrl}/storage/v1/object/public/broadcast-assets/${encodeURI(asset.storage_path)}`;
    return <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} />;
  }
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: 600,
      letterSpacing: 0.5, textTransform: 'uppercase', pointerEvents: 'none',
    }}>
      {asset.asset_type}
    </div>
  );
}

// ─── Right sidebar: palette + properties ────────────────────────

function PalettePane({ palette, selectedAsset, selectedRow, onAdd, onChange, onRemove }) {
  return (
    <div style={styles.sidebar}>
      {selectedRow ? (
        <PropertiesPanel
          row={selectedRow}
          asset={selectedAsset}
          onChange={(patch) => onChange(selectedRow.id, patch)}
          onRemove={() => onRemove(selectedRow.id)}
        />
      ) : (
        <div style={styles.hint}>Select an asset on the canvas to edit its placement.</div>
      )}

      <div style={styles.paletteHeader}>Asset palette</div>
      <div style={styles.paletteList}>
        {palette.length === 0 ? (
          <div style={styles.hint}>All assets already placed.</div>
        ) : (
          palette.map((a) => (
            <button key={a.id} onClick={() => onAdd(a)} style={styles.paletteItem}>
              <span style={styles.paletteType}>{(a.asset_type || '?').slice(0, 3).toUpperCase()}</span>
              <span style={styles.paletteName}>{a.name}</span>
              <span style={styles.paletteAdd}>+</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function PropertiesPanel({ row, asset, onChange, onRemove }) {
  const get = (key, defaultKey) =>
    row[`override_${key}`] != null
      ? row[`override_${key}`]
      : (asset && defaultKey ? asset[defaultKey] : '');

  function setNum(key, raw) {
    const v = raw === '' ? null : Number(raw);
    onChange({ [`override_${key}`]: Number.isFinite(v) || v === null ? v : null });
  }

  return (
    <div style={styles.props}>
      <div style={styles.propsTitle}>
        {asset?.name || '(missing asset)'}
        <button onClick={onRemove} style={styles.removeBtn} title="Remove from scene">×</button>
      </div>

      <label style={styles.toggleRow}>
        <input
          type="checkbox"
          checked={!!row.is_visible}
          onChange={(e) => onChange({ is_visible: e.target.checked })}
        />
        Visible in this scene
      </label>

      <div style={styles.row}>
        <NumField label="X" value={get('x', 'canvas_x')} onChange={(v) => setNum('x', v)} />
        <NumField label="Y" value={get('y', 'canvas_y')} onChange={(v) => setNum('y', v)} />
      </div>
      <div style={styles.row}>
        <NumField label="W" value={get('width', 'canvas_width')} onChange={(v) => setNum('width', v)} />
        <NumField label="H" value={get('height', 'canvas_height')} onChange={(v) => setNum('height', v)} />
      </div>
      <div style={styles.row}>
        <NumField label="Layer" value={get('layer', 'layer')} onChange={(v) => setNum('layer', v)} />
        <NumField label="Opacity (0–1)" value={get('opacity', 'opacity')} onChange={(v) => setNum('opacity', v)} step="0.05" />
      </div>

      <button
        onClick={() => onChange({
          override_x: null, override_y: null,
          override_width: null, override_height: null,
          override_layer: null, override_opacity: null,
        })}
        style={styles.resetBtn}
      >
        Reset to asset defaults
      </button>
    </div>
  );
}

function NumField({ label, value, onChange, step }) {
  return (
    <label style={styles.numFieldWrap}>
      <span style={styles.numLabel}>{label}</span>
      <input
        type="number"
        value={value == null ? '' : value}
        step={step || 1}
        onChange={(e) => onChange(e.target.value)}
        style={styles.numInput}
      />
    </label>
  );
}

// ─── Styles ─────────────────────────────────────────────────────

const styles = {
  wrap: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: colors.bg },
  empty: { padding: 40, textAlign: 'center', color: colors.textSubtle, fontSize: fontSizes.sm },
  error: { padding: spacing.sm, background: colors.danger.bg, color: colors.danger.fg, fontSize: fontSizes.xs, borderBottom: `1px solid ${colors.danger.border}` },
  topBar: {
    display: 'flex', alignItems: 'center', gap: spacing.sm,
    padding: `${spacing.sm}px ${spacing.lg}px`,
    borderBottom: `1px solid ${colors.border}`, background: colors.bgRaised,
  },
  label: { fontSize: fontSizes.xs, fontWeight: fontWeights.semibold, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  select: {
    background: colors.bgInput, color: colors.text,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    padding: `${spacing.xs}px ${spacing.sm}px`, fontSize: fontSizes.sm,
    fontFamily: 'inherit', outline: 'none', minWidth: 220,
  },
  canvasHint: { marginLeft: 'auto', fontSize: fontSizes.xs, color: colors.textSubtle },
  body: { flex: 1, minHeight: 0, display: 'flex' },

  canvasWrap: {
    flex: 1, minWidth: 0, position: 'relative',
    background: '#0a0a14', overflow: 'hidden',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  canvas: {
    position: 'relative',
    background: '#000',
    transformOrigin: 'center center',
    boxShadow: '0 0 0 1px rgba(255,255,255,0.1)',
    flexShrink: 0,
  },

  sidebar: {
    width: 320, flexShrink: 0, padding: spacing.md,
    borderLeft: `1px solid ${colors.border}`, background: colors.bgRaised,
    display: 'flex', flexDirection: 'column', gap: spacing.md, overflowY: 'auto',
  },
  hint: { fontSize: fontSizes.xs, color: colors.textSubtle, fontStyle: 'italic' },

  paletteHeader: {
    fontSize: fontSizes.xxs, fontWeight: fontWeights.bold,
    color: colors.textSubtle, letterSpacing: 0.5, textTransform: 'uppercase',
    paddingBottom: spacing.xs, borderBottom: `1px solid ${colors.border}`,
  },
  paletteList: { display: 'flex', flexDirection: 'column', gap: spacing.xs },
  paletteItem: {
    display: 'flex', alignItems: 'center', gap: spacing.sm,
    padding: `${spacing.xs}px ${spacing.sm}px`,
    background: colors.bgInput, border: `1px solid ${colors.border}`,
    borderRadius: radii.sm, color: colors.text, fontSize: fontSizes.xs,
    fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
  },
  paletteType: {
    padding: '2px 6px', fontSize: 9, fontWeight: fontWeights.bold,
    color: colors.accentFg, background: colors.accentSoft,
    border: `1px solid ${colors.accentBorder}`, borderRadius: radii.xs,
    flexShrink: 0,
  },
  paletteName: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  paletteAdd: { color: colors.accentFg, fontWeight: fontWeights.bold },

  props: {
    display: 'flex', flexDirection: 'column', gap: spacing.sm,
    padding: spacing.sm, background: colors.bgInput,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
  },
  propsTitle: {
    display: 'flex', alignItems: 'center', gap: spacing.sm,
    fontSize: fontSizes.sm, fontWeight: fontWeights.semibold, color: colors.text,
  },
  removeBtn: {
    marginLeft: 'auto', width: 22, height: 22,
    background: 'transparent', border: `1px solid ${colors.border}`,
    color: colors.danger.fg, borderRadius: radii.sm,
    cursor: 'pointer', fontSize: 14, lineHeight: 1, fontFamily: 'inherit',
  },
  toggleRow: { display: 'flex', alignItems: 'center', gap: spacing.xs, fontSize: fontSizes.xs, color: colors.text },
  row: { display: 'flex', gap: spacing.xs },
  numFieldWrap: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1 },
  numLabel: { fontSize: 10, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: fontWeights.bold },
  numInput: {
    background: colors.bgRaised, color: colors.text,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    padding: `${spacing.xs}px ${spacing.sm}px`, fontSize: fontSizes.xs,
    fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box',
  },
  resetBtn: {
    padding: `${spacing.xs}px ${spacing.sm}px`, background: 'transparent',
    border: `1px solid ${colors.border}`, color: colors.textMuted,
    borderRadius: radii.sm, fontSize: fontSizes.xxs, cursor: 'pointer',
    fontFamily: 'inherit',
  },
};
