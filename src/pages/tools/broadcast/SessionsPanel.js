import React, { useEffect, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import { listSessions, updateSession, deleteSession } from './api';

// Lists prior + current sessions. Resuming a live one opens the
// producer console (handled by parent via onResume). Ending a session
// flips is_live = false.

export default function SessionsPanel({ project, onResume }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true); setError(null);
    try { const res = await listSessions(project.id); setSessions(res.sessions || []); }
    catch (e) { setError(e.message); }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [project.id]);

  async function end(s) {
    if (!window.confirm('End this session?')) return;
    try { await updateSession(s.id, { is_live: false }); await load(); }
    catch (e) { setError(e.message); }
  }
  async function del(s) {
    if (!window.confirm(`Delete session ${s.channel_name}? Clip markers + chat replay are dropped too.`)) return;
    try { await deleteSession(s.id); await load(); }
    catch (e) { setError(e.message); }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.col}>
        <div style={styles.title}>Sessions</div>
        {error && <div style={styles.error}>{error}</div>}
        {loading ? (
          <div style={styles.empty}>Loading…</div>
        ) : sessions.length === 0 ? (
          <div style={styles.empty}>No sessions yet. Hit "Go live" to create one.</div>
        ) : (
          <div style={styles.list}>
            {sessions.map((s) => (
              <div key={s.id} style={styles.row}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.slug}>{s.channel_name}
                    {s.is_live && <span style={styles.livePill}>LIVE</span>}
                  </div>
                  <div style={styles.meta}>
                    Created {new Date(s.created_at).toLocaleString()}
                    {s.started_at ? ` · Started ${new Date(s.started_at).toLocaleString()}` : ''}
                    {s.ended_at ? ` · Ended ${new Date(s.ended_at).toLocaleString()}` : ''}
                  </div>
                </div>
                {s.is_live ? (
                  <>
                    <button onClick={() => onResume(s)} style={styles.primaryBtn}>Resume</button>
                    <button onClick={() => end(s)} style={styles.endBtn}>End</button>
                  </>
                ) : (
                  <button onClick={() => del(s)} style={styles.deleteBtn}>Delete</button>
                )}
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
  col: { width: '100%', maxWidth: 880, display: 'flex', flexDirection: 'column', gap: spacing.md },
  title: { fontSize: fontSizes.xl, fontWeight: fontWeights.semibold, color: colors.text },
  error: { padding: spacing.sm, background: colors.danger.bg, color: colors.danger.fg, border: `1px solid ${colors.danger.border}`, borderRadius: radii.sm, fontSize: fontSizes.xs },
  empty: { padding: spacing.huge, textAlign: 'center', color: colors.textSubtle, fontSize: fontSizes.sm },
  list: { display: 'flex', flexDirection: 'column', gap: spacing.sm },
  row: { display: 'flex', alignItems: 'center', gap: spacing.sm, padding: spacing.md, background: colors.bgRaised, border: `1px solid ${colors.border}`, borderRadius: radii.md },
  slug: { fontSize: fontSizes.md, fontWeight: fontWeights.semibold, color: colors.text, display: 'flex', alignItems: 'center', gap: spacing.sm },
  livePill: {
    padding: `${spacing.xs}px ${spacing.sm}px`, fontSize: fontSizes.xxs,
    color: colors.text, background: colors.danger.fg, borderRadius: radii.pill,
    fontWeight: fontWeights.bold, letterSpacing: '0.06em',
  },
  meta: { fontSize: fontSizes.xs, color: colors.textSubtle, marginTop: 2 },
  primaryBtn: {
    padding: `${spacing.xs}px ${spacing.md}px`, background: colors.accent,
    color: colors.text, border: 'none', borderRadius: radii.sm, cursor: 'pointer',
    fontSize: fontSizes.xs, fontWeight: fontWeights.medium, fontFamily: 'inherit',
  },
  endBtn: {
    padding: `${spacing.xs}px ${spacing.md}px`, background: 'transparent',
    border: `1px solid ${colors.danger.border}`, borderRadius: radii.sm,
    color: colors.danger.fg, cursor: 'pointer', fontSize: fontSizes.xs, fontFamily: 'inherit',
  },
  deleteBtn: {
    padding: `${spacing.xs}px ${spacing.md}px`, background: 'transparent',
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.textMuted, cursor: 'pointer', fontSize: fontSizes.xs, fontFamily: 'inherit',
  },
};
