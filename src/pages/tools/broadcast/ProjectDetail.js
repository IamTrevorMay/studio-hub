import React, { useEffect, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamily } from '../../../lib/styleTokens';
import ScenesPanel from './ScenesPanel';
import AssetsPanel from './AssetsPanel';
import MembersPanel from './MembersPanel';
import SessionsPanel from './SessionsPanel';
import { createSession, listSessions } from './api';

// Single-project view with inner tabs. "Go live" creates / resumes a
// broadcast_session for this project, then opens the producer console.

const TABS = [
  { k: 'scenes',   label: 'Scenes' },
  { k: 'assets',   label: 'Assets' },
  { k: 'members',  label: 'Members' },
  { k: 'sessions', label: 'Sessions' },
];

export default function ProjectDetail({ project, onChangeProject, onBack, onGoLive }) {
  const [mode, setMode] = useState('scenes');
  const [goingLive, setGoingLive] = useState(false);
  const [error, setError] = useState(null);

  async function handleGoLive() {
    setGoingLive(true); setError(null);
    try {
      // Resume the most recent already-live session, otherwise create a new one.
      const recent = await listSessions(project.id);
      const live = (recent.sessions || []).find((s) => s.is_live);
      if (live) {
        onGoLive(live);
      } else {
        const res = await createSession({ project_id: project.id, is_live: true });
        onGoLive(res.session);
      }
    } catch (e) { setError(e.message); }
    setGoingLive(false);
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <button onClick={onBack} style={styles.backBtn} title="All projects">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <span style={styles.title}>{project.name}</span>
        <span style={styles.rolePill}>{project._userRole}</span>

        <div style={styles.tabs}>
          {TABS.map((t) => (
            <button key={t.k} onClick={() => setMode(t.k)}
              style={{ ...styles.tab, ...(mode === t.k ? styles.tabActive : {}) }}>
              {t.label}
            </button>
          ))}
        </div>

        <button onClick={handleGoLive} disabled={goingLive} style={styles.liveBtn}>
          {goingLive ? 'Loading…' : 'Go live ►'}
        </button>
      </header>

      {error && <div style={styles.errorBar}>{error}</div>}

      <div style={styles.body}>
        {mode === 'scenes'   && <ScenesPanel project={project} onChangeProject={onChangeProject} />}
        {mode === 'assets'   && <AssetsPanel project={project} />}
        {mode === 'members'  && <MembersPanel project={project} />}
        {mode === 'sessions' && <SessionsPanel project={project} onResume={onGoLive} />}
      </div>
    </div>
  );
}

const styles = {
  container: { height: '100vh', display: 'flex', flexDirection: 'column', background: colors.bg, color: colors.text, fontFamily },
  header: {
    height: 52, flexShrink: 0, display: 'flex', alignItems: 'center',
    gap: spacing.md, padding: `0 ${spacing.lg}px`,
    borderBottom: `1px solid ${colors.border}`, background: colors.bgRaised,
  },
  backBtn: {
    width: 32, height: 32, border: 'none', background: 'transparent',
    color: colors.textMuted, cursor: 'pointer', borderRadius: radii.sm,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: fontSizes.lg, fontWeight: fontWeights.semibold, color: colors.text },
  rolePill: {
    padding: `${spacing.xs}px ${spacing.sm}px`, fontSize: fontSizes.xxs,
    color: colors.accentFg, background: colors.accentSoft, border: `1px solid ${colors.accentBorder}`,
    borderRadius: radii.pill, textTransform: 'uppercase', letterSpacing: '0.06em',
  },
  tabs: { marginLeft: 'auto', display: 'flex', gap: spacing.xs },
  tab: {
    padding: `${spacing.xs}px ${spacing.md}px`, fontSize: fontSizes.xs,
    fontWeight: fontWeights.medium, color: colors.textMuted, background: 'transparent',
    border: `1px solid ${colors.border}`, borderRadius: radii.sm, cursor: 'pointer', fontFamily: 'inherit',
  },
  tabActive: { color: colors.accentFg, background: colors.accentSoft, border: `1px solid ${colors.accentBorder}` },
  liveBtn: {
    padding: `${spacing.xs}px ${spacing.md}px`, background: colors.danger.fg,
    color: '#fff', border: 'none', borderRadius: radii.sm, cursor: 'pointer',
    fontSize: fontSizes.sm, fontWeight: fontWeights.semibold, fontFamily: 'inherit',
  },
  errorBar: { padding: spacing.sm, background: colors.danger.bg, color: colors.danger.fg, fontSize: fontSizes.xs, textAlign: 'center' },
  body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
};
