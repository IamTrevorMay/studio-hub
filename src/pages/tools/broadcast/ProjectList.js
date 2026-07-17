import React, { useEffect, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import { listProjects, createProject, deleteProject } from './api';
import { clickableKeyProps } from '../../../lib/styleRecipes';

// Lists broadcast projects the current user owns or is a member of.
// Producer/admin tier can create new projects from the inline form at
// the top of the column.

export default function ProjectList({ onOpen }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', fps: 30 });
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await listProjects();
      setProjects(res.projects || []);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setCreating(true); setError(null);
    try {
      const res = await createProject({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        fps: Number(form.fps) || 30,
      });
      setForm({ name: '', description: '', fps: 30 });
      await load();
      if (res.project) onOpen(res.project);
    } catch (e) { setError(e.message); }
    setCreating(false);
  }

  async function handleDelete(p, e) {
    e.stopPropagation();
    if (!window.confirm(`Delete "${p.name}"? This cascades to scenes, assets, and sessions.`)) return;
    try { await deleteProject(p.id); await load(); }
    catch (e) { setError(e.message); }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.col}>
        <form onSubmit={handleCreate} style={styles.createForm}>
          <div style={styles.createTitle}>New project</div>
          <input
            placeholder="Show name" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            style={styles.input} required
          />
          <input
            placeholder="Description (optional)" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            style={styles.input}
          />
          <input
            type="number" placeholder="FPS (default 30)" value={form.fps}
            onChange={(e) => setForm({ ...form, fps: e.target.value })}
            style={styles.input}
          />
          <button type="submit" disabled={creating} style={styles.primaryBtn}>
            {creating ? 'Creating…' : 'Create project'}
          </button>
        </form>

        {error && <div style={styles.error}>{error}</div>}
        <div style={styles.list}>
          {loading ? (
            <div style={styles.empty}>Loading…</div>
          ) : projects.length === 0 ? (
            <div style={styles.empty}>No broadcast projects yet.</div>
          ) : (
            projects.map((p) => (
              <div key={p.id} {...clickableKeyProps(() => onOpen(p))} onClick={() => onOpen(p)} style={styles.card}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.cardName}>{p.name}</div>
                  <div style={styles.cardMeta}>
                    {p._userRole}
                    {p.description ? ` · ${p.description}` : ''}
                    {p.fps ? ` · ${p.fps} fps` : ''}
                    {' · '}Updated {new Date(p.updated_at).toLocaleString()}
                  </div>
                </div>
                <button onClick={(e) => handleDelete(p, e)} style={styles.deleteBtn} title="Delete">×</button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  wrap: { flex: 1, overflow: 'auto', padding: spacing.xxl, display: 'flex', justifyContent: 'center' },
  col: { width: '100%', maxWidth: 720, display: 'flex', flexDirection: 'column', gap: spacing.lg },
  createForm: {
    display: 'flex', flexDirection: 'column', gap: spacing.sm,
    padding: spacing.lg, background: colors.bgRaised,
    border: `1px solid ${colors.border}`, borderRadius: radii.md,
  },
  createTitle: { fontSize: fontSizes.sm, fontWeight: fontWeights.semibold, color: colors.textMuted },
  input: {
    padding: `${spacing.sm}px ${spacing.md}px`, background: colors.bgInput,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.text, fontSize: fontSizes.sm, fontFamily: 'inherit', outline: 'none',
  },
  primaryBtn: {
    padding: `${spacing.sm}px ${spacing.lg}px`, background: colors.accent,
    color: '#fff', border: 'none', borderRadius: radii.sm, cursor: 'pointer',
    fontSize: fontSizes.sm, fontWeight: fontWeights.medium, fontFamily: 'inherit',
    alignSelf: 'flex-start',
  },
  error: {
    padding: spacing.md, background: colors.danger.bg, color: colors.danger.fg,
    border: `1px solid ${colors.danger.border}`, borderRadius: radii.sm, fontSize: fontSizes.sm,
  },
  list: { display: 'flex', flexDirection: 'column', gap: spacing.sm },
  empty: { padding: spacing.xxl, textAlign: 'center', color: colors.textSubtle, fontSize: fontSizes.sm },
  card: {
    padding: spacing.md, background: colors.bgRaised,
    border: `1px solid ${colors.border}`, borderRadius: radii.md,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  cardName: { fontSize: fontSizes.md, fontWeight: fontWeights.semibold, color: colors.text },
  cardMeta: { fontSize: fontSizes.xs, color: colors.textSubtle, marginTop: 2 },
  deleteBtn: {
    width: 28, height: 28, borderRadius: radii.sm,
    background: 'transparent', border: `1px solid ${colors.border}`,
    color: colors.textMuted, cursor: 'pointer', fontSize: 16,
  },
};
