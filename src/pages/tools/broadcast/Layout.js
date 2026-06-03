import React, { useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamily } from '../../../lib/styleTokens';
import ProjectList from './ProjectList';
import ProjectDetail from './ProjectDetail';
import ProducerConsole from './ProducerConsole';

// Top-level Broadcast tool. Two states:
//   - browsing the project list
//   - inside a single project (which itself has internal tabs:
//     Scenes / Assets / Members / Sessions / Live)
// "Live" inside a project opens the full-screen ProducerConsole for the
// most recent session (creating one on demand).

export default function Layout({ onBack }) {
  const [project, setProject] = useState(null);
  const [producerSession, setProducerSession] = useState(null);

  if (producerSession) {
    return (
      <ProducerConsole
        project={project}
        session={producerSession}
        onClose={() => setProducerSession(null)}
      />
    );
  }

  if (project) {
    return (
      <ProjectDetail
        project={project}
        onChangeProject={setProject}
        onBack={() => setProject(null)}
        onGoLive={(session) => setProducerSession(session)}
      />
    );
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <button onClick={onBack} style={styles.backBtn} title="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <span style={styles.headerTitle}>Broadcast</span>
        <span style={styles.subtle}>Live show controller</span>
      </header>
      <div style={styles.body}>
        <ProjectList onOpen={setProject} />
      </div>
    </div>
  );
}

const styles = {
  container: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: colors.bg,
    color: colors.text,
    fontFamily,
  },
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
  headerTitle: { fontSize: fontSizes.lg, fontWeight: fontWeights.semibold, color: colors.text },
  subtle: { fontSize: fontSizes.xs, color: colors.textSubtle },
  body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
};
