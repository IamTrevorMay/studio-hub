import React, { useEffect, useState } from 'react';
import FullScreenSheet from '../../components/mobile/FullScreenSheet';
import { mobileTokens, mobileTapButton } from '../../utils/mobileTokens';
import { colors } from '../../lib/styleTokens';
import { FLIGHTLINE } from '../../lib/suiteApps';
import { FLIGHTLINE_ORIGIN, flightline } from '../../lib/flightline';

// Flightline on the phone: a READ-ONLY progress check for operators who are
// away from the studio. Opened from the mobile drawer's Flightline row
// (AppLayoutMobile → MobileDrawer.onOpenFlightline). Two levels:
//   1. Projects — one card per Flightline project with a finished-clips bar
//      and per-state counts (from GET /api/dashboard → projects[].counts).
//   2. Clips — tap a project for its jobs (GET /api/jobs?project_id=…) with
//      each clip's state, live % while analyzing/rendering, reviewer, message.
// Nothing here writes: approving, uploading and creating projects stay on the
// desktop Dashboard and the Mac app. Access is the Flightline service's call —
// an account without a grant gets the service's own error, not a blank page.

const POLL_MS = 10000;

// Clips the studio considers finished for the project bar.
const DONE_STATES = ['approved', 'rendered'];

// Job/state vocabulary from the Flightline service (server.py + service/app.py
// `projects()`): `approval` on a job overrides its status as 'approved', and a
// completed export of the approved revision counts as 'rendered'.
const STATE_LABELS = {
  queued: 'Queued',
  processing: 'Analyzing',
  rendering: 'Rendering',
  ready: 'Ready for review',
  approved: 'Approved',
  rendered: 'Rendered',
  complete: 'Complete',
  error: 'Error',
  interrupted: 'Interrupted',
  cancelled: 'Cancelled',
};
const STATE_ORDER = ['error', 'interrupted', 'processing', 'rendering', 'queued', 'ready', 'approved', 'rendered', 'complete', 'cancelled'];
const LIVE_STATES = new Set(['processing', 'rendering']);

export function projectProgress(project) {
  const total = project?.clip_count || 0;
  const done = DONE_STATES.reduce((n, key) => n + (project?.counts?.[key] || 0), 0);
  return { done, total, ratio: total ? Math.min(1, done / total) : 0 };
}

export function jobState(job) {
  return job?.approval ? 'approved' : (job?.status || 'queued');
}

function stateColor(state) {
  if (state === 'error' || state === 'interrupted') return colors.danger.fg;
  if (state === 'cancelled') return FLIGHTLINE.muted;
  if (LIVE_STATES.has(state)) return FLIGHTLINE.accent;
  if (DONE_STATES.includes(state) || state === 'complete') return FLIGHTLINE.accentBright;
  if (state === 'ready') return colors.warning.fg;
  return FLIGHTLINE.text;
}

function formatClock(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function FlightlineMobile({ open, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [selected, setSelected] = useState(null); // project row from data.projects
  const [jobs, setJobs] = useState(null);
  const [jobsError, setJobsError] = useState('');

  // Dashboard poll while the sheet is open. Closing drops everything so the
  // next open starts fresh (and the interval never outlives the sheet).
  useEffect(() => {
    if (!open) {
      setData(null); setError(''); setSelected(null); setJobs(null); setJobsError(''); setUpdatedAt(null);
      return undefined;
    }
    if (!FLIGHTLINE_ORIGIN) return undefined;
    let active = true;
    const refresh = async () => {
      try {
        const result = await flightline('/dashboard');
        if (!active) return;
        setData(result); setError(''); setUpdatedAt(Date.now());
        // Keep the open project's card fresh (counts move as clips finish).
        setSelected(prev => (prev ? result.projects.find(p => p.id === prev.id) || null : prev));
      } catch (e) {
        if (active) { setData(null); setError(e.message); }
      }
    };
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => { active = false; clearInterval(timer); };
  }, [open]);

  // Clip poll for the drilled-in project.
  const selectedId = selected?.id || '';
  useEffect(() => {
    setJobs(null); setJobsError('');
    if (!open || !selectedId) return undefined;
    let active = true;
    const refresh = () => flightline(`/jobs?project_id=${encodeURIComponent(selectedId)}`)
      .then(result => { if (active) { setJobs(result); setJobsError(''); } })
      .catch(e => { if (active) setJobsError(e.message); });
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => { active = false; clearInterval(timer); };
  }, [open, selectedId]);

  const activeJobs = data ? data.tasks.filter(t => ['queued', 'running'].includes(t.status)).length : 0;

  return (
    <FullScreenSheet
      open={open}
      onClose={selected ? () => setSelected(null) : onClose}
      title={selected ? selected.name : 'Flightline'}
      backLabel={selected ? 'Projects' : undefined}
      rightAction={<img src={FLIGHTLINE.logo} alt="" width="26" height="26" style={styles.headerLogo} draggable={false} />}
    >
      {!FLIGHTLINE_ORIGIN ? (
        <div style={styles.notice}>
          <div style={styles.noticeTitle}>Your workspace is being connected.</div>
          <div style={styles.noticeBody}>Flightline will appear here when the studio connection is ready.</div>
        </div>
      ) : error && !data ? (
        <div role="alert" style={{ ...styles.notice, borderColor: 'rgba(248,113,113,0.35)' }}>
          <div style={styles.noticeTitle}>Flightline unavailable</div>
          <div style={styles.noticeBody}>{error}</div>
        </div>
      ) : !data ? (
        <div style={styles.muted}>Connecting to your studio…</div>
      ) : selected ? (
        <ClipList project={selected} jobs={jobs} error={jobsError} />
      ) : (
        <>
          <div style={styles.statusStrip}>
            <Stat label="Projects" value={data.projects.length} />
            <Stat label="Active jobs" value={activeJobs} live={activeJobs > 0} />
            <Stat label="Workers" value={data.workers.length} />
            <Stat label="Media" value={data.host?.media_online ? 'Online' : 'Offline'} warn={!data.host?.media_online} />
          </div>

          {data.projects.length === 0 ? (
            <div style={styles.muted}>No projects yet.</div>
          ) : (
            <div style={styles.list}>
              {data.projects.map(project => (
                <ProjectCard key={project.id} project={project} onOpen={() => setSelected(project)} />
              ))}
            </div>
          )}
        </>
      )}

      {data && (
        <div style={styles.footer}>
          Read-only · refreshes every {POLL_MS / 1000}s{updatedAt ? ` · updated ${formatClock(updatedAt)}` : ''}
        </div>
      )}
    </FullScreenSheet>
  );
}

function Stat({ label, value, live, warn }) {
  return (
    <div style={styles.stat}>
      <div style={{ ...styles.statValue, color: warn ? colors.danger.fg : live ? FLIGHTLINE.accent : FLIGHTLINE.text }}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

function ProgressBar({ ratio, color }) {
  return (
    <div style={styles.barTrack} aria-hidden="true">
      <div style={{ ...styles.barFill, width: `${Math.round(ratio * 100)}%`, background: color || FLIGHTLINE.accent }} />
    </div>
  );
}

function ProjectCard({ project, onOpen }) {
  const { done, total, ratio } = projectProgress(project);
  const counts = project.counts || {};
  const chips = STATE_ORDER.filter(key => counts[key] > 0);
  return (
    <button onClick={onOpen} style={styles.card} aria-label={`${project.name} — ${done} of ${total} clips finished`}>
      <div style={styles.cardHead}>
        <span style={styles.cardTitle}>{project.name}</span>
        <span style={styles.cardPct}>{total ? `${Math.round(ratio * 100)}%` : '—'}</span>
      </div>
      <ProgressBar ratio={ratio} />
      <div style={styles.cardMeta}>{total === 0 ? 'No clips yet' : `${done}/${total} clips finished`}</div>
      {chips.length > 0 && (
        <div style={styles.chips}>
          {chips.map(key => (
            <span key={key} style={{ ...styles.chip, color: stateColor(key) }}>
              {counts[key]} {STATE_LABELS[key] || key}
            </span>
          ))}
        </div>
      )}
      <span style={styles.chevron} aria-hidden="true">›</span>
    </button>
  );
}

function ClipList({ project, jobs, error }) {
  const { done, total } = projectProgress(project);
  return (
    <>
      <div style={styles.projectSummary}>
        <ProgressBar ratio={projectProgress(project).ratio} />
        <div style={styles.cardMeta}>{total === 0 ? 'No clips yet' : `${done}/${total} clips finished`}</div>
      </div>
      {error && <div role="alert" style={{ ...styles.notice, borderColor: 'rgba(248,113,113,0.35)' }}>{error}</div>}
      {!jobs && !error ? (
        <div style={styles.muted}>Loading clips…</div>
      ) : jobs && jobs.length === 0 ? (
        <div style={styles.muted}>No footage in this project yet.</div>
      ) : jobs ? (
        <div style={styles.list}>
          {jobs.map(job => {
            const state = jobState(job);
            const live = LIVE_STATES.has(state) && typeof job.progress === 'number';
            return (
              <div key={job.id} style={{ ...styles.card, cursor: 'default' }}>
                <div style={styles.cardHead}>
                  <span style={styles.cardTitle}>{job.name}</span>
                  <span style={{ ...styles.stateLabel, color: stateColor(state) }}>
                    {STATE_LABELS[state] || state}{live ? ` ${Math.round(job.progress * 100)}%` : ''}
                  </span>
                </div>
                {live && <ProgressBar ratio={job.progress} />}
                <div style={styles.cardMeta}>
                  {job.assigned_to ? `Reviewer: ${job.assigned_to}` : 'Unassigned'}
                  {job.message ? ` · ${job.message}` : ''}
                  {job.error ? ` · ${job.error}` : ''}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

const styles = {
  headerLogo: { display: 'block', borderRadius: 7 },
  statusStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: mobileTokens.space.sm,
    marginBottom: mobileTokens.space.lg,
  },
  stat: {
    background: FLIGHTLINE.panel,
    border: `1px solid ${FLIGHTLINE.line}`,
    borderRadius: mobileTokens.radius.md,
    padding: `${mobileTokens.space.sm}px ${mobileTokens.space.xs}px`,
    textAlign: 'center',
  },
  statValue: { fontSize: mobileTokens.font.lg, fontWeight: 700 },
  statLabel: {
    fontFamily: FLIGHTLINE.mono,
    fontSize: 9,
    letterSpacing: '1.2px',
    textTransform: 'uppercase',
    color: FLIGHTLINE.muted,
    marginTop: 2,
  },
  list: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.sm },
  card: {
    ...mobileTapButton,
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    gap: mobileTokens.space.sm,
    width: '100%',
    textAlign: 'left',
    background: FLIGHTLINE.panel,
    border: `1px solid ${FLIGHTLINE.line}`,
    borderRadius: mobileTokens.radius.lg,
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.xxl}px ${mobileTokens.space.md}px ${mobileTokens.space.lg}px`,
    color: FLIGHTLINE.text,
  },
  cardHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: mobileTokens.space.md },
  cardTitle: { fontSize: mobileTokens.font.base, fontWeight: 600, color: '#e3e8df', overflow: 'hidden', textOverflow: 'ellipsis' },
  cardPct: { fontFamily: FLIGHTLINE.mono, fontSize: mobileTokens.font.sm, color: FLIGHTLINE.accent, flexShrink: 0 },
  stateLabel: { fontFamily: FLIGHTLINE.mono, fontSize: mobileTokens.font.xs, flexShrink: 0, textAlign: 'right' },
  cardMeta: { fontSize: mobileTokens.font.sm, color: FLIGHTLINE.muted },
  chips: { display: 'flex', flexWrap: 'wrap', gap: mobileTokens.space.xs },
  chip: {
    fontFamily: FLIGHTLINE.mono,
    fontSize: 10,
    letterSpacing: '0.6px',
    textTransform: 'uppercase',
    padding: '3px 7px',
    borderRadius: mobileTokens.radius.pill,
    background: 'rgba(255,255,255,0.04)',
    border: `1px solid ${FLIGHTLINE.line}`,
  },
  chevron: {
    position: 'absolute',
    right: mobileTokens.space.md,
    top: '50%',
    transform: 'translateY(-55%)',
    fontSize: 22,
    color: FLIGHTLINE.muted,
  },
  barTrack: { height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3, transition: 'width 0.3s ease' },
  projectSummary: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.sm, marginBottom: mobileTokens.space.lg },
  notice: {
    background: FLIGHTLINE.panel,
    border: `1px solid ${FLIGHTLINE.line}`,
    borderRadius: mobileTokens.radius.lg,
    padding: mobileTokens.space.lg,
    color: FLIGHTLINE.text,
    marginBottom: mobileTokens.space.md,
  },
  noticeTitle: { fontSize: mobileTokens.font.base, fontWeight: 600, marginBottom: 4 },
  noticeBody: { fontSize: mobileTokens.font.sm, color: FLIGHTLINE.muted },
  muted: { color: FLIGHTLINE.muted, fontSize: mobileTokens.font.md, padding: `${mobileTokens.space.md}px 0` },
  footer: {
    marginTop: mobileTokens.space.xl,
    fontFamily: FLIGHTLINE.mono,
    fontSize: 10,
    letterSpacing: '0.6px',
    color: FLIGHTLINE.muted,
    textAlign: 'center',
  },
};
