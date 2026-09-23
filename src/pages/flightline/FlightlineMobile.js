import React, { useEffect, useMemo, useState } from 'react';
import FullScreenSheet from '../../components/mobile/FullScreenSheet';
import { mobileTokens, mobileTapButton } from '../../utils/mobileTokens';
import { colors } from '../../lib/styleTokens';
import { FLIGHTLINE } from '../../lib/suiteApps';
import { FLIGHTLINE_ORIGIN, flightline } from '../../lib/flightline';

// Flightline on the phone: a READ-ONLY progress check for operators who are
// away from the studio. Opened from the mobile drawer's Flightline row
// (AppLayoutMobile → MobileDrawer.onOpenFlightline). Two levels:
//   1. Projects — one card per Flightline project with a finished-clips bar,
//      what's processing right now (clip name + live %), and recent uploads.
//   2. Clips — tap a project for every clip: state + live %, the worker task
//      behind it (analysis / render / refit, queued / running / failed), who
//      holds the editing lease, latest export status, and who uploaded it when.
// Data: GET /api/dashboard (projects[].counts, tasks[], leases[], workers[])
// plus GET /api/jobs?project_id=… for every project, so the overview can name
// clips — the pilot has a handful of projects, so that fan-out is cheap.
// Uploads are only visible once they finish streaming to the studio (the
// service keeps in-flight bytes in a .partial file it doesn't report), so an
// "upload" here means "landed and waiting for / getting a worker".
// Nothing here writes: approving, uploading and creating projects stay on the
// desktop Dashboard and the Mac app. Access is the Flightline service's call —
// an account without a grant gets the service's own error, not a blank page.

const POLL_MS = 10000;
const RECENT_UPLOAD_SECONDS = 24 * 3600;
const MAX_ACTIVITY_ROWS = 3;

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
const PENDING_STATES = new Set(['queued']);

// service_tasks.operation → label (worker.py enqueues these four).
const OPERATION_LABELS = { analysis: 'Analysis', render: 'Render', refit: 'Refit', restore: 'Restore' };

export function projectProgress(project) {
  const total = project?.clip_count || 0;
  const done = DONE_STATES.reduce((n, key) => n + (project?.counts?.[key] || 0), 0);
  return { done, total, ratio: total ? Math.min(1, done / total) : 0 };
}

export function jobState(job) {
  return job?.approval ? 'approved' : (job?.status || 'queued');
}

// Task rows from /dashboard for one clip, newest first. `active` is what the
// worker pool is doing (or about to do) for it; `failed` the last failure.
export function jobTaskSummary(tasks, jobId) {
  const own = (tasks || []).filter(t => t.job_id === jobId).sort((a, b) => (b.created || 0) - (a.created || 0));
  return {
    active: own.find(t => t.status === 'running') || own.find(t => t.status === 'queued') || null,
    failed: own.find(t => t.status === 'failed') || null,
  };
}

export function latestExport(job) {
  const exports = job?.exports || [];
  return exports.length ? exports[exports.length - 1] : null;
}

function pct(fraction) {
  return `${Math.round((typeof fraction === 'number' ? fraction : 0) * 100)}%`;
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

// Service timestamps are epoch seconds (Python time.time()).
export function timeAgo(epochSeconds, now = Date.now() / 1000) {
  if (!epochSeconds) return '';
  const s = Math.max(0, now - epochSeconds);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function exportLabel(record) {
  if (!record) return null;
  switch (record.status) {
    case 'queued': return 'Export queued';
    case 'rendering': return `Exporting ${pct(record.progress)}`;
    case 'complete': return `Export ready${record.resolution ? ` · ${record.resolution}` : ''}${record.format ? ` ${record.format}` : ''}`;
    case 'error': return `Export failed${record.message ? `: ${record.message}` : ''}`;
    case 'expired': return 'Export expired';
    default: return `Export ${record.status}`;
  }
}

function exportColor(record) {
  if (!record) return FLIGHTLINE.muted;
  if (record.status === 'error') return colors.danger.fg;
  if (record.status === 'complete') return FLIGHTLINE.accentBright;
  if (record.status === 'rendering' || record.status === 'queued') return FLIGHTLINE.accent;
  return FLIGHTLINE.muted;
}

// One line describing the worker side of a clip: lease first (a human is on
// it), then the live/queued task, then the last failure.
function processingLine(job, tasks, leases) {
  const lease = (leases || []).find(l => l.job_id === job.id);
  if (lease) return { text: `Editing now · ${lease.username}`, color: colors.warning.fg };
  const { active, failed } = jobTaskSummary(tasks, job.id);
  if (active) {
    const op = OPERATION_LABELS[active.operation] || active.operation;
    if (active.status === 'running') {
      return { text: `${op} running · ${pct(active.progress)}${active.message ? ` · ${active.message}` : ''}`, color: FLIGHTLINE.accent };
    }
    return { text: `${op} queued${active.attempts > 1 ? ` · attempt ${active.attempts}` : ''}`, color: FLIGHTLINE.muted };
  }
  if (failed && (job.status === 'error' || job.status === 'interrupted')) {
    const op = OPERATION_LABELS[failed.operation] || failed.operation;
    return { text: `${op} failed${failed.error ? ` · ${failed.error}` : ''}`, color: colors.danger.fg };
  }
  return null;
}

function uploadLine(job) {
  if (job.origin !== 'upload') return null;
  return `Uploaded by ${job.uploaded_by || 'unknown'} · ${timeAgo(job.created)}`;
}

export default function FlightlineMobile({ open, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [jobsByProject, setJobsByProject] = useState({}); // projectId → jobs[]
  const [selected, setSelected] = useState(null); // project row from data.projects

  // Dashboard + per-project jobs poll while the sheet is open. Closing drops
  // everything so the next open starts fresh (and the interval never outlives
  // the sheet). A project whose /jobs call fails keeps its last known list.
  useEffect(() => {
    if (!open) {
      setData(null); setError(''); setSelected(null); setJobsByProject({}); setUpdatedAt(null);
      return undefined;
    }
    if (!FLIGHTLINE_ORIGIN) return undefined;
    let active = true;
    const refresh = async () => {
      let result;
      try {
        result = await flightline('/dashboard');
      } catch (e) {
        if (active) { setData(null); setError(e.message); }
        return;
      }
      if (!active) return;
      setData(result); setError(''); setUpdatedAt(Date.now());
      // Keep the open project's card fresh (counts move as clips finish).
      setSelected(prev => (prev ? result.projects.find(p => p.id === prev.id) || null : prev));
      const lists = await Promise.all(result.projects.map(p =>
        flightline(`/jobs?project_id=${encodeURIComponent(p.id)}`).then(jobs => [p.id, jobs]).catch(() => null)));
      if (!active) return;
      setJobsByProject(prev => {
        const next = { ...prev };
        lists.forEach(entry => { if (entry) next[entry[0]] = entry[1]; });
        return next;
      });
    };
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => { active = false; clearInterval(timer); };
  }, [open]);

  const tasks = data?.tasks || [];
  const leases = data?.leases || [];
  const running = useMemo(() => tasks.filter(t => t.status === 'running').length, [tasks]);
  const queued = useMemo(() => tasks.filter(t => t.status === 'queued').length, [tasks]);
  const workers = data?.workers?.length || 0;

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
        <ClipList project={selected} jobs={jobsByProject[selected.id]} tasks={tasks} leases={leases} />
      ) : (
        <>
          <div style={styles.statusStrip}>
            <Stat label="Processing" value={running} live={running > 0} />
            <Stat label="Queued" value={queued} />
            <Stat label="Workers" value={workers} warn={workers === 0 && (running + queued) > 0} />
            <Stat label="Media" value={data.host?.media_online ? 'Online' : 'Offline'} warn={!data.host?.media_online} />
          </div>
          {workers === 0 && queued > 0 && (
            <div style={{ ...styles.notice, borderColor: 'rgba(248,113,113,0.35)' }}>
              <div style={styles.noticeTitle}>No workers online</div>
              <div style={styles.noticeBody}>{queued} task{queued === 1 ? '' : 's'} waiting. Nothing will process until a worker comes back.</div>
            </div>
          )}

          {data.projects.length === 0 ? (
            <div style={styles.muted}>No projects yet.</div>
          ) : (
            <div style={styles.list}>
              {data.projects.map(project => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  jobs={jobsByProject[project.id]}
                  tasks={tasks}
                  leases={leases}
                  onOpen={() => setSelected(project)}
                />
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

function ProjectCard({ project, jobs, tasks, leases, onOpen }) {
  const { done, total, ratio } = projectProgress(project);
  const counts = project.counts || {};
  const chips = STATE_ORDER.filter(key => counts[key] > 0);

  // What's moving in this project right now: live clips first, then queued.
  const activity = (jobs || [])
    .filter(job => LIVE_STATES.has(jobState(job)) || PENDING_STATES.has(jobState(job)) || leases.some(l => l.job_id === job.id))
    .sort((a, b) => {
      const rank = job => (leases.some(l => l.job_id === job.id) ? 0 : LIVE_STATES.has(jobState(job)) ? 1 : 2);
      return rank(a) - rank(b) || (b.updated || 0) - (a.updated || 0);
    });

  const now = Date.now() / 1000;
  const uploads = (jobs || [])
    .filter(job => job.origin === 'upload' && (now - (job.created || 0)) < RECENT_UPLOAD_SECONDS)
    .sort((a, b) => (b.created || 0) - (a.created || 0));
  const failed = (jobs || []).filter(job => ['error', 'interrupted'].includes(jobState(job))).length;

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

      {jobs === undefined ? (
        <div style={styles.cardMeta}>Loading clips…</div>
      ) : (
        <>
          <div style={styles.section}>
            <div style={styles.sectionLabel}>Processing</div>
            {activity.length === 0 ? (
              <div style={styles.cardMeta}>{failed ? `Idle · ${failed} clip${failed === 1 ? '' : 's'} need attention` : 'Idle'}</div>
            ) : (
              <>
                {activity.slice(0, MAX_ACTIVITY_ROWS).map(job => {
                  const line = processingLine(job, tasks, leases);
                  const state = jobState(job);
                  const live = LIVE_STATES.has(state) && typeof job.progress === 'number';
                  return (
                    <div key={job.id} style={styles.activityRow}>
                      <div style={styles.activityHead}>
                        <span style={styles.activityName}>{job.name}</span>
                        <span style={{ ...styles.stateLabel, color: stateColor(state) }}>
                          {STATE_LABELS[state] || state}{live ? ` ${pct(job.progress)}` : ''}
                        </span>
                      </div>
                      {live && <ProgressBar ratio={job.progress} />}
                      {line && <div style={{ ...styles.cardMeta, color: line.color }}>{line.text}</div>}
                    </div>
                  );
                })}
                {activity.length > MAX_ACTIVITY_ROWS && (
                  <div style={styles.cardMeta}>+{activity.length - MAX_ACTIVITY_ROWS} more in the queue</div>
                )}
              </>
            )}
          </div>

          <div style={styles.section}>
            <div style={styles.sectionLabel}>Uploads · last 24h</div>
            <div style={styles.cardMeta}>
              {uploads.length === 0
                ? 'None'
                : `${uploads.length} landed · latest by ${uploads[0].uploaded_by || 'unknown'} ${timeAgo(uploads[0].created)}`}
            </div>
          </div>
        </>
      )}
      <span style={styles.chevron} aria-hidden="true">›</span>
    </button>
  );
}

function ClipList({ project, jobs, tasks, leases }) {
  const { done, total, ratio } = projectProgress(project);
  const sorted = (jobs || []).slice().sort((a, b) => {
    const rank = job => {
      const state = jobState(job);
      if (leases.some(l => l.job_id === job.id)) return 0;
      if (LIVE_STATES.has(state)) return 1;
      if (state === 'error' || state === 'interrupted') return 2;
      if (PENDING_STATES.has(state)) return 3;
      return 4;
    };
    return rank(a) - rank(b) || (b.updated || 0) - (a.updated || 0);
  });
  return (
    <>
      <div style={styles.projectSummary}>
        <ProgressBar ratio={ratio} />
        <div style={styles.cardMeta}>{total === 0 ? 'No clips yet' : `${done}/${total} clips finished`}</div>
      </div>
      {jobs === undefined ? (
        <div style={styles.muted}>Loading clips…</div>
      ) : sorted.length === 0 ? (
        <div style={styles.muted}>No footage in this project yet.</div>
      ) : (
        <div style={styles.list}>
          {sorted.map(job => {
            const state = jobState(job);
            const live = LIVE_STATES.has(state) && typeof job.progress === 'number';
            const line = processingLine(job, tasks, leases);
            const upload = uploadLine(job);
            const exportRecord = latestExport(job);
            return (
              <div key={job.id} style={{ ...styles.card, cursor: 'default' }}>
                <div style={styles.cardHead}>
                  <span style={styles.cardTitle}>{job.name}</span>
                  <span style={{ ...styles.stateLabel, color: stateColor(state) }}>
                    {STATE_LABELS[state] || state}{live ? ` ${pct(job.progress)}` : ''}
                  </span>
                </div>
                {live && <ProgressBar ratio={job.progress} />}
                {job.message && !live && !line && <div style={styles.cardMeta}>{job.message}</div>}
                {live && job.message && <div style={styles.cardMeta}>{job.message}</div>}
                {line && <div style={{ ...styles.cardMeta, color: line.color }}>{line.text}</div>}
                {job.error && state === 'error' && !line && <div style={{ ...styles.cardMeta, color: colors.danger.fg }}>{job.error}</div>}
                {exportRecord && (
                  <div style={{ ...styles.cardMeta, color: exportColor(exportRecord) }}>{exportLabel(exportRecord)}</div>
                )}
                <div style={styles.cardMeta}>
                  {job.assigned_to ? `Reviewer: ${job.assigned_to}` : 'Unassigned'}
                  {upload ? ` · ${upload}` : ''}
                </div>
              </div>
            );
          })}
        </div>
      )}
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
  cardMeta: { fontSize: mobileTokens.font.sm, color: FLIGHTLINE.muted, lineHeight: 1.35 },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.xs,
    paddingTop: mobileTokens.space.sm,
    borderTop: `1px solid ${FLIGHTLINE.line}`,
  },
  sectionLabel: {
    fontFamily: FLIGHTLINE.mono,
    fontSize: 9,
    letterSpacing: '1.2px',
    textTransform: 'uppercase',
    color: FLIGHTLINE.muted,
  },
  activityRow: { display: 'flex', flexDirection: 'column', gap: 4 },
  activityHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: mobileTokens.space.md },
  activityName: { fontSize: mobileTokens.font.sm, color: '#e3e8df', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
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
    top: mobileTokens.space.md,
    fontSize: 22,
    lineHeight: 1,
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
