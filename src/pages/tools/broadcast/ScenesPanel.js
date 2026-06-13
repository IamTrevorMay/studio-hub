import React, { useEffect, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import { listScenes, createScene, updateScene, deleteScene } from './api';

// Scene CRUD for a project. Hotkey + transition fields edited inline.

export default function ScenesPanel({ project }) {
  const [scenes, setScenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { const res = await listScenes(project.id); setScenes(res.scenes || []); }
    catch (e) { setError(e.message); }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [project.id]);

  async function handleCreate() {
    setCreating(true); setError(null);
    try {
      await createScene({
        project_id: project.id,
        name: 'New scene',
        sort_order: scenes.length,
      });
      await load();
    } catch (e) { setError(e.message); }
    setCreating(false);
  }

  async function handleUpdate(scene, patch) {
    // Snapshot the row so we can revert immediately if the server rejects
    // the change; a follow-up load() reconciles with the authoritative state
    // but the user shouldn't keep seeing the unsaved value in the meantime.
    const prev = scenes.find((s) => s.id === scene.id);
    setScenes(scenes.map((s) => (s.id === scene.id ? { ...s, ...patch } : s)));
    try { await updateScene(scene.id, patch); }
    catch (e) {
      setError(e.message);
      if (prev) setScenes((cur) => cur.map((s) => (s.id === scene.id ? prev : s)));
      load().catch(() => null);
    }
  }

  async function handleDelete(scene) {
    if (!window.confirm(`Delete scene "${scene.name}"?`)) return;
    try { await deleteScene(scene.id); await load(); }
    catch (e) { setError(e.message); }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.col}>
        <div style={styles.headerRow}>
          <div style={styles.title}>Scenes</div>
          <button onClick={handleCreate} disabled={creating} style={styles.primaryBtn}>
            {creating ? 'Adding…' : '+ Scene'}
          </button>
        </div>
        {error && <div style={styles.error}>{error}</div>}
        {loading ? (
          <div style={styles.empty}>Loading…</div>
        ) : scenes.length === 0 ? (
          <div style={styles.empty}>No scenes yet.</div>
        ) : (
          <div style={styles.list}>
            {scenes.map((s) => (
              <div key={s.id} style={styles.row}>
                <input
                  value={s.name}
                  onChange={(e) => handleUpdate(s, { name: e.target.value })}
                  style={{ ...styles.input, flex: 2 }}
                />
                <input
                  placeholder="Hotkey (e.g. F1)" value={s.hotkey_key || ''}
                  onChange={(e) => handleUpdate(s, { hotkey_key: e.target.value || null })}
                  style={{ ...styles.input, width: 110 }}
                />
                <input
                  placeholder="Color #hex" value={s.hotkey_color || ''}
                  onChange={(e) => handleUpdate(s, { hotkey_color: e.target.value || null })}
                  style={{ ...styles.input, width: 110 }}
                />
                <input
                  type="number" placeholder="Sort" value={s.sort_order}
                  onChange={(e) => handleUpdate(s, { sort_order: Number(e.target.value) || 0 })}
                  style={{ ...styles.input, width: 70 }}
                />
                <button onClick={() => handleDelete(s)} style={styles.deleteBtn}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  wrap: { flex: 1, overflow: 'auto', padding: spacing.xxl, display: 'flex', justifyContent: 'center' },
  col: { width: '100%', maxWidth: 920, display: 'flex', flexDirection: 'column', gap: spacing.md },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: fontSizes.xl, fontWeight: fontWeights.semibold, color: colors.text },
  primaryBtn: {
    padding: `${spacing.sm}px ${spacing.lg}px`, background: colors.accent,
    color: '#fff', border: 'none', borderRadius: radii.sm, cursor: 'pointer',
    fontSize: fontSizes.sm, fontWeight: fontWeights.medium, fontFamily: 'inherit',
  },
  error: { padding: spacing.sm, background: colors.danger.bg, color: colors.danger.fg, border: `1px solid ${colors.danger.border}`, borderRadius: radii.sm, fontSize: fontSizes.xs },
  empty: { padding: spacing.huge, textAlign: 'center', color: colors.textSubtle, fontSize: fontSizes.sm },
  list: { display: 'flex', flexDirection: 'column', gap: spacing.xs },
  row: { display: 'flex', gap: spacing.xs, alignItems: 'center', padding: spacing.sm, background: colors.bgRaised, border: `1px solid ${colors.border}`, borderRadius: radii.sm },
  input: {
    padding: `${spacing.xs}px ${spacing.sm}px`, background: colors.bgInput,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.text, fontSize: fontSizes.sm, fontFamily: 'inherit', outline: 'none',
  },
  deleteBtn: {
    width: 28, height: 28, borderRadius: radii.sm,
    background: 'transparent', border: `1px solid ${colors.border}`,
    color: colors.danger.fg, cursor: 'pointer', fontSize: 14,
  },
};
