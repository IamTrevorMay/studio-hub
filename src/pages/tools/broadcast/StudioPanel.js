import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import {
  listScenes,
  listAssets,
  deleteAsset,
  listSceneAssets,
  createSceneAsset,
  updateSceneAsset,
  deleteSceneAsset,
} from './api';
import { supabase } from '../../../supabaseClient';
import AssetLibrary from './AssetLibrary';
import AssetProperties from './AssetProperties';

// Merged Layout + Assets panel.
// Top bar: scene picker.
// Left:    AssetLibrary (top) + placed-scene-asset list (bottom).
// Center:  1920×1080 canvas with drag/resize.
// Right:   selection-driven — asset defaults when a library asset is selected,
//          scene-asset overrides when a placed canvas item is selected.

const CANVAS_W = 1920;
const CANVAS_H = 1080;
const SAVE_DEBOUNCE_MS = 300;

export default function StudioPanel({ project }) {
  const [scenes, setScenes] = useState([]);
  const [assets, setAssets] = useState([]);
  const [sceneAssets, setSceneAssets] = useState([]);
  const [sceneId, setSceneId] = useState(null);
  // Selection: either a library asset or a placed scene asset, never both.
  const [selection, setSelection] = useState({ kind: null, id: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Track latest library-asset selection in a ref so async post-upload
  // handlers don't clobber the user's current choice.
  const selectedAssetIdRef = useRef(null);
  useEffect(() => {
    selectedAssetIdRef.current = selection.kind === 'asset' ? selection.id : null;
  }, [selection]);

  // ─── Loaders ────────────────────────────────────────────────
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

  const reloadAssets = useCallback(async () => {
    try { const res = await listAssets(project.id); setAssets(res.assets || []); }
    catch (e) { setError(e.message); }
  }, [project.id]);

  const loadSceneAssets = useCallback(async () => {
    if (!sceneId) { setSceneAssets([]); return; }
    try {
      const { sceneAssets: rows } = await listSceneAssets({ scene_id: sceneId });
      setSceneAssets(rows || []);
    } catch (e) { setError(e.message); }
  }, [sceneId]);

  useEffect(() => { loadProject(); /* eslint-disable-next-line */ }, [project.id]);
  useEffect(() => { loadSceneAssets(); }, [loadSceneAssets]);

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

  // ─── Derived ────────────────────────────────────────────────
  const assetsById = useMemo(() => {
    const m = new Map();
    for (const a of assets) m.set(a.id, a);
    return m;
  }, [assets]);

  const selectedAsset = useMemo(() => {
    if (selection.kind !== 'asset') return null;
    return assets.find((a) => a.id === selection.id) || null;
  }, [selection, assets]);

  const selectedSceneRow = useMemo(() => {
    if (selection.kind !== 'sceneAsset') return null;
    return sceneAssets.find((sa) => sa.id === selection.id) || null;
  }, [selection, sceneAssets]);

  const selectedSceneRowAsset = selectedSceneRow ? assetsById.get(selectedSceneRow.asset_id) : null;

  // ─── Scene asset CRUD ───────────────────────────────────────
  const pendingTimers = useRef(new Map());
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

  async function addAssetToScene(asset) {
    if (!sceneId) return;
    try {
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
      setSelection({ kind: 'sceneAsset', id: sceneAsset.id });
    } catch (e) { setError(e.message); }
  }

  async function removeFromScene(rowId) {
    try {
      await deleteSceneAsset(rowId);
      setSceneAssets((prev) => prev.filter((sa) => sa.id !== rowId));
      if (selection.kind === 'sceneAsset' && selection.id === rowId) {
        setSelection({ kind: null, id: null });
      }
    } catch (e) { setError(e.message); }
  }

  // ─── Library asset handlers ─────────────────────────────────
  async function handleDeleteAsset(asset) {
    if (!window.confirm(`Delete asset "${asset.name}"?`)) return;
    try {
      await deleteAsset(asset.id);
      if (selection.kind === 'asset' && selection.id === asset.id) {
        setSelection({ kind: null, id: null });
      }
      await reloadAssets();
    } catch (e) { setError(e.message); }
  }

  // ─── Keyboard ───────────────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.key === 'Escape') setSelection({ kind: null, id: null });
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection.kind === 'sceneAsset') {
        e.preventDefault();
        removeFromScene(selection.id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection]); // eslint-disable-line

  if (loading) return <div style={styles.empty}>Loading…</div>;

  return (
    <div style={styles.wrap}>
      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.topBar}>
        <label style={styles.topLabel}>Scene</label>
        <select
          value={sceneId || ''}
          onChange={(e) => { setSceneId(e.target.value); setSelection({ kind: null, id: null }); }}
          style={styles.select}
          disabled={scenes.length === 0}
        >
          {scenes.length === 0
            ? <option value="">No scenes — add one in Scenes tab</option>
            : scenes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span style={styles.hint}>
          {CANVAS_W}×{CANVAS_H} · {sceneAssets.length} placed · {assets.length} in library
        </span>
      </div>

      <div style={styles.body}>
        {/* LEFT: library (top) + placed list (bottom) */}
        <div style={styles.leftCol}>
          <div style={styles.leftSection}>
            <div style={styles.sectionHeader}>Asset library</div>
            <div style={styles.leftSectionBody}>
              <AssetLibrary
                embedded
                project={project}
                assets={assets}
                selectedId={selection.kind === 'asset' ? selection.id : null}
                loading={false}
                error={null}
                onSelect={(a) => setSelection({ kind: 'asset', id: a.id })}
                onDelete={handleDeleteAsset}
                onUploaded={reloadAssets}
                onCreated={async (created) => {
                  const selBefore = selectedAssetIdRef.current;
                  await reloadAssets();
                  if (selectedAssetIdRef.current === selBefore) {
                    setSelection({ kind: 'asset', id: created.id });
                  }
                }}
              />
            </div>
          </div>

          <div style={styles.leftSection}>
            <div style={styles.sectionHeader}>
              In this scene ({sceneAssets.length})
            </div>
            <div style={styles.leftSectionBody}>
              <PlacedList
                sceneAssets={sceneAssets}
                assetsById={assetsById}
                selectedId={selection.kind === 'sceneAsset' ? selection.id : null}
                onSelect={(id) => setSelection({ kind: 'sceneAsset', id })}
                onRemove={removeFromScene}
                palette={assets.filter((a) => !new Set(sceneAssets.map((sa) => sa.asset_id)).has(a.id))}
                onAdd={addAssetToScene}
                canAdd={!!sceneId}
              />
            </div>
          </div>
        </div>

        {/* CENTER: canvas */}
        {sceneId ? (
          <CanvasPane
            rows={sceneAssets}
            assetsById={assetsById}
            selectedId={selection.kind === 'sceneAsset' ? selection.id : null}
            onSelect={(id) => setSelection(id ? { kind: 'sceneAsset', id } : { kind: null, id: null })}
            onChange={queueSave}
          />
        ) : (
          <div style={styles.canvasEmpty}>
            No scene selected. Add a scene in the Scenes tab to start building a layout.
          </div>
        )}

        {/* RIGHT: selection-driven */}
        <div style={styles.rightCol}>
          {selection.kind === 'asset' && selectedAsset ? (
            <AssetProperties
              project={project}
              asset={selectedAsset}
              onSaved={async () => {
                const targetId = selectedAssetIdRef.current;
                await reloadAssets();
                if (selectedAssetIdRef.current !== targetId) return;
              }}
            />
          ) : selection.kind === 'sceneAsset' && selectedSceneRow ? (
            <ScenePropertiesPanel
              row={selectedSceneRow}
              asset={selectedSceneRowAsset}
              onChange={(patch) => queueSave(selectedSceneRow.id, patch)}
              onRemove={() => removeFromScene(selectedSceneRow.id)}
            />
          ) : (
            <div style={styles.rightEmpty}>
              Select an asset from the library to edit defaults,
              or click an item on the canvas to edit its placement in this scene.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Left-bottom: placed list + add-from-palette ────────────────

function PlacedList({ sceneAssets, assetsById, selectedId, onSelect, onRemove, palette, onAdd, canAdd }) {
  return (
    <div style={listStyles.wrap}>
      {sceneAssets.length === 0 ? (
        <div style={listStyles.hint}>Nothing placed yet. Add from below.</div>
      ) : (
        <div style={listStyles.list}>
          {sceneAssets
            .slice()
            .sort((a, b) => (a.override_layer ?? 0) - (b.override_layer ?? 0))
            .map((row) => {
              const asset = assetsById.get(row.asset_id);
              const isSelected = row.id === selectedId;
              return (
                <div
                  key={row.id}
                  onClick={() => onSelect(row.id)}
                  style={{ ...listStyles.row, ...(isSelected ? listStyles.rowActive : {}) }}
                >
                  <span style={listStyles.typeBadge}>
                    {(asset?.asset_type || '?').slice(0, 3).toUpperCase()}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={listStyles.name}>{asset?.name || '(missing)'}</div>
                    <div style={listStyles.meta}>
                      {row.is_visible ? 'visible' : 'hidden'} · layer {row.override_layer ?? asset?.layer ?? 0}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemove(row.id); }}
                    style={listStyles.removeBtn}
                    title="Remove from scene"
                  >×</button>
                </div>
              );
            })}
        </div>
      )}

      {canAdd && palette.length > 0 && (
        <>
          <div style={listStyles.subHeader}>Add to scene</div>
          <div style={listStyles.list}>
            {palette.map((a) => (
              <button key={a.id} onClick={() => onAdd(a)} style={listStyles.addItem}>
                <span style={listStyles.typeBadge}>{(a.asset_type || '?').slice(0, 3).toUpperCase()}</span>
                <span style={listStyles.name}>{a.name}</span>
                <span style={listStyles.plus}>+</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Canvas pane ────────────────────────────────────────────────

function CanvasPane({ rows, assetsById, selectedId, onSelect, onChange }) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(1);

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
    <div
      ref={wrapRef}
      style={styles.canvasWrap}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onSelect(null); }}
    >
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
        background: asset?.asset_type === 'image' && asset.storage_path ? '#000' : 'rgba(91, 143, 199,0.18)',
        border: isSelected ? '2px solid #8fb4d8' : '1px solid rgba(255,255,255,0.25)',
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
            background: colors.accentFg,
            border: '1px solid #1b2331',
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

// ─── Right pane: scene-asset override editor ────────────────────

function ScenePropertiesPanel({ row, asset, onChange, onRemove }) {
  const get = (key, defaultKey) =>
    row[`override_${key}`] != null
      ? row[`override_${key}`]
      : (asset && defaultKey ? asset[defaultKey] : '');

  function setNum(key, raw) {
    const v = raw === '' ? null : Number(raw);
    onChange({ [`override_${key}`]: Number.isFinite(v) || v === null ? v : null });
  }

  return (
    <div style={propStyles.wrap}>
      <div style={propStyles.title}>
        {asset?.name || '(missing asset)'}
        <span style={propStyles.subtitle}>scene override</span>
        <button onClick={onRemove} style={propStyles.removeBtn} title="Remove from scene">×</button>
      </div>

      <label style={propStyles.toggleRow}>
        <input
          type="checkbox"
          checked={!!row.is_visible}
          onChange={(e) => onChange({ is_visible: e.target.checked })}
        />
        Visible in this scene
      </label>

      <div style={propStyles.row}>
        <NumField label="X" value={get('x', 'canvas_x')} onChange={(v) => setNum('x', v)} />
        <NumField label="Y" value={get('y', 'canvas_y')} onChange={(v) => setNum('y', v)} />
      </div>
      <div style={propStyles.row}>
        <NumField label="W" value={get('width', 'canvas_width')} onChange={(v) => setNum('width', v)} />
        <NumField label="H" value={get('height', 'canvas_height')} onChange={(v) => setNum('height', v)} />
      </div>
      <div style={propStyles.row}>
        <NumField label="Layer" value={get('layer', 'layer')} onChange={(v) => setNum('layer', v)} />
        <NumField label="Opacity (0–1)" value={get('opacity', 'opacity')} onChange={(v) => setNum('opacity', v)} step="0.05" />
      </div>

      <button
        onClick={() => onChange({
          override_x: null, override_y: null,
          override_width: null, override_height: null,
          override_layer: null, override_opacity: null,
        })}
        style={propStyles.resetBtn}
      >
        Reset to asset defaults
      </button>
    </div>
  );
}

function NumField({ label, value, onChange, step }) {
  return (
    <label style={propStyles.numFieldWrap}>
      <span style={propStyles.numLabel}>{label}</span>
      <input
        type="number"
        value={value == null ? '' : value}
        step={step || 1}
        onChange={(e) => onChange(e.target.value)}
        style={propStyles.numInput}
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
  topLabel: { fontSize: fontSizes.xs, fontWeight: fontWeights.semibold, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  select: {
    background: colors.bgInput, color: colors.text,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    padding: `${spacing.xs}px ${spacing.sm}px`, fontSize: fontSizes.sm,
    fontFamily: 'inherit', outline: 'none', minWidth: 220,
  },
  hint: { marginLeft: 'auto', fontSize: fontSizes.xs, color: colors.textSubtle },

  body: { flex: 1, minHeight: 0, display: 'flex' },

  leftCol: {
    width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column',
    borderRight: `1px solid ${colors.border}`, background: colors.bgRaised,
    minHeight: 0,
  },
  leftSection: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
  sectionHeader: {
    padding: `${spacing.sm}px ${spacing.md}px`,
    fontSize: fontSizes.xxs, fontWeight: fontWeights.bold,
    color: colors.textSubtle, letterSpacing: 0.5, textTransform: 'uppercase',
    background: colors.bg, borderTop: `1px solid ${colors.border}`,
    borderBottom: `1px solid ${colors.border}`,
  },
  leftSectionBody: { flex: 1, minHeight: 0, overflow: 'auto' },

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
  canvasEmpty: {
    flex: 1, minWidth: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: spacing.lg, textAlign: 'center',
    color: colors.textSubtle, fontSize: fontSizes.sm, background: '#0a0a14',
  },

  rightCol: {
    width: 360, flexShrink: 0,
    borderLeft: `1px solid ${colors.border}`, background: colors.bg,
    display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden',
  },
  rightEmpty: { padding: spacing.lg, color: colors.textSubtle, fontSize: fontSizes.xs, fontStyle: 'italic' },
};

const listStyles = {
  wrap: { display: 'flex', flexDirection: 'column', padding: spacing.sm, gap: spacing.sm },
  hint: { padding: spacing.sm, fontSize: fontSizes.xs, color: colors.textSubtle, fontStyle: 'italic' },
  list: { display: 'flex', flexDirection: 'column', gap: 4 },
  subHeader: {
    fontSize: fontSizes.xxs, fontWeight: fontWeights.bold,
    color: colors.textSubtle, letterSpacing: 0.5, textTransform: 'uppercase',
    paddingTop: spacing.sm, borderTop: `1px solid ${colors.border}`,
  },
  row: {
    display: 'flex', alignItems: 'center', gap: spacing.sm,
    padding: spacing.xs, background: colors.bgInput,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    cursor: 'pointer',
  },
  rowActive: { background: colors.accentSoft, borderColor: colors.accentBorder },
  typeBadge: {
    padding: '2px 6px', fontSize: 9, fontWeight: fontWeights.bold,
    color: colors.accentFg, background: colors.accentSoft,
    border: `1px solid ${colors.accentBorder}`, borderRadius: radii.xs,
    flexShrink: 0,
  },
  name: { fontSize: fontSizes.sm, color: colors.text, fontWeight: fontWeights.medium, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  meta: { fontSize: fontSizes.xxs, color: colors.textSubtle },
  removeBtn: {
    width: 22, height: 22, borderRadius: radii.sm,
    background: 'transparent', border: `1px solid ${colors.border}`,
    color: colors.textMuted, cursor: 'pointer', fontSize: 12,
  },
  addItem: {
    display: 'flex', alignItems: 'center', gap: spacing.sm,
    padding: `${spacing.xs}px ${spacing.sm}px`,
    background: colors.bgInput, border: `1px solid ${colors.border}`,
    borderRadius: radii.sm, color: colors.text, fontSize: fontSizes.xs,
    fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
  },
  plus: { color: colors.accentFg, fontWeight: fontWeights.bold },
};

const propStyles = {
  wrap: {
    flex: 1, minHeight: 0, overflow: 'auto',
    display: 'flex', flexDirection: 'column', gap: spacing.sm,
    padding: spacing.lg,
  },
  title: {
    display: 'flex', alignItems: 'center', gap: spacing.sm,
    fontSize: fontSizes.lg, fontWeight: fontWeights.semibold, color: colors.text,
    paddingBottom: spacing.sm, borderBottom: `1px solid ${colors.border}`,
  },
  subtitle: {
    fontSize: fontSizes.xxs, color: colors.accentFg,
    background: colors.accentSoft, border: `1px solid ${colors.accentBorder}`,
    borderRadius: radii.pill, padding: `2px 8px`, textTransform: 'uppercase', letterSpacing: 0.4,
  },
  removeBtn: {
    marginLeft: 'auto', width: 24, height: 24,
    background: 'transparent', border: `1px solid ${colors.border}`,
    color: colors.danger.fg, borderRadius: radii.sm,
    cursor: 'pointer', fontSize: 14, lineHeight: 1, fontFamily: 'inherit',
  },
  toggleRow: { display: 'flex', alignItems: 'center', gap: spacing.xs, fontSize: fontSizes.xs, color: colors.text },
  row: { display: 'flex', gap: spacing.xs },
  numFieldWrap: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1 },
  numLabel: { fontSize: 10, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: fontWeights.bold },
  numInput: {
    background: colors.bgInput, color: colors.text,
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
