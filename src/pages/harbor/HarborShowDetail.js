import React, { useState, useEffect, useCallback } from 'react';
import useVisibilityRefresh from '../../hooks/useVisibilityRefresh';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamily } from '../../lib/styleTokens';
import { pill, button, input, sectionHeader } from '../../lib/styleRecipes';
import {
  getShow,
  listShowSessions,
  createShowSession,
  listSessionTracks,
  rotateShowGuestToken,
  renameShow,
  showJoinLink,
  QUALITY_LABELS,
  CAPTURE_QUALITY_LABELS,
  nasDownloadUrl,
  formatBytes,
  formatDuration,
} from '../../lib/harbor/shows';

// One show: its permanent guest link, and every recording made in it.
//
// The download ladder lives here rather than in the room, because renditions
// are produced by the archiver on the always-on Mac minutes-to-hours after a
// recording ends — they simply do not exist while you're still in the call.

const STATUS_TONES = { scheduled: 'info', live: 'success', ended: 'danger' };
const STATUS_LABELS = { scheduled: 'Scheduled', live: 'Live', ended: 'Ended' };

export default function HarborShowDetail({ showId, onOpenRoom, onBack }) {
  const [show, setShow] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [expanded, setExpanded] = useState(null); // sessionId whose files are open
  const [tracksBySession, setTracksBySession] = useState({});

  const load = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([getShow(showId), listShowSessions(showId)]);
      setShow(s);
      setSessions(list);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [showId]);

  useEffect(() => {
    load();
  }, [load]);
  // Renditions land while you're on another tab — refresh on return.
  useVisibilityRefresh(load);

  const openFiles = async (sessionId) => {
    if (expanded === sessionId) {
      setExpanded(null);
      return;
    }
    setExpanded(sessionId);
    if (tracksBySession[sessionId]) return;
    try {
      const tracks = await listSessionTracks(sessionId);
      setTracksBySession((prev) => ({ ...prev, [sessionId]: tracks }));
    } catch (err) {
      setError(err.message);
    }
  };

  const startRecording = async () => {
    if (creating || !show) return;
    setCreating(true);
    try {
      const session = await createShowSession(show);
      setSessions((prev) => [session, ...prev]);
      onOpenRoom?.(session.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async () => {
    if (!show) return;
    try {
      await navigator.clipboard.writeText(showJoinLink(show.guest_token));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Could not copy — check clipboard permissions.');
    }
  };

  const rotate = async () => {
    if (!show || rotating) return;
    setRotating(true);
    try {
      const token = await rotateShowGuestToken(show.id);
      setShow((prev) => ({ ...prev, guest_token: token }));
    } catch (err) {
      setError(err.message);
    } finally {
      setRotating(false);
    }
  };

  const saveTitle = async (e) => {
    e.preventDefault();
    if (!draftTitle.trim()) return;
    try {
      await renameShow(show.id, draftTitle);
      setShow((prev) => ({ ...prev, title: draftTitle.trim() }));
      setRenaming(false);
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.inner}>
          <p style={styles.muted}>Loading show…</p>
        </div>
      </div>
    );
  }

  if (!show) {
    return (
      <div style={styles.page}>
        <div style={styles.inner}>
          <button type="button" onClick={onBack} style={button({ variant: 'ghost', size: 'sm' })}>
            &larr; Shows
          </button>
          <div style={styles.errorBox}>{error || 'Show not found.'}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.inner}>
        <button type="button" onClick={onBack} style={{ ...button({ variant: 'ghost', size: 'sm' }), alignSelf: 'flex-start' }}>
          &larr; Shows
        </button>

        <div style={styles.header}>
          {renaming ? (
            <form onSubmit={saveTitle} style={styles.renameRow}>
              <input
                autoFocus
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                maxLength={120}
                style={{ ...input(), flex: 1, minWidth: 200 }}
              />
              <button type="submit" style={button({ size: 'sm' })}>Save</button>
              <button type="button" style={button({ variant: 'ghost', size: 'sm' })} onClick={() => setRenaming(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <div style={styles.titleRow}>
              <h1 style={styles.title}>{show.title}</h1>
              <button
                type="button"
                style={button({ variant: 'ghost', size: 'sm' })}
                onClick={() => {
                  setDraftTitle(show.title);
                  setRenaming(true);
                }}
              >
                Rename
              </button>
            </div>
          )}
          <p style={styles.meta}>
            Show · up to {show.max_participants} people · video ·{' '}
            {CAPTURE_QUALITY_LABELS[show.capture_quality] || show.capture_quality}
          </p>
        </div>

        {error && <div style={styles.errorBox}>{error}</div>}

        <div style={styles.actionRow}>
          <button type="button" style={button({ disabled: creating })} disabled={creating} onClick={startRecording}>
            {creating ? 'Starting…' : 'Start a recording'}
          </button>
          <button type="button" style={button({ variant: 'ghost', size: 'sm' })} onClick={copyLink}>
            {copied ? 'Copied!' : 'Copy guest link'}
          </button>
          <button
            type="button"
            style={button({ variant: 'ghost', size: 'sm', disabled: rotating })}
            disabled={rotating}
            onClick={rotate}
            title="Old links stop working immediately. Anyone already in a call stays connected."
          >
            {rotating ? 'Rotating…' : 'New guest link'}
          </button>
        </div>
        <p style={styles.hint}>
          The guest link is permanent — hand it out once and it works for every recording in this show.
        </p>

        <div>
          <h2 style={sectionHeader(2)}>Recordings</h2>
          {sessions.length === 0 ? (
            <div style={styles.emptyCard}>
              <p style={styles.muted}>
                Nothing recorded yet. Hit &ldquo;Start a recording&rdquo; to open the room.
              </p>
            </div>
          ) : (
            <div style={styles.list}>
              {sessions.map((s) => (
                <div key={s.id} style={styles.card}>
                  <div style={styles.cardRow}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={styles.cardTitleRow}>
                        <span style={styles.cardTitle}>{s.title}</span>
                        <span style={pill(STATUS_TONES[s.status] || 'info')}>
                          {STATUS_LABELS[s.status] || s.status}
                        </span>
                        {s.archived_at && <span style={pill('success')}>On NAS</span>}
                      </div>
                      <div style={styles.cardMeta}>
                        {new Date(s.created_at).toLocaleDateString()}
                        {s.ended_at ? ` · ended ${new Date(s.ended_at).toLocaleTimeString()}` : ''}
                      </div>
                    </div>
                    <div style={styles.cardActions}>
                      <button type="button" style={button({ variant: 'ghost', size: 'sm' })} onClick={() => openFiles(s.id)}>
                        {expanded === s.id ? 'Hide files' : 'Files'}
                      </button>
                      {s.status !== 'ended' && (
                        <button type="button" style={button({ size: 'sm' })} onClick={() => onOpenRoom?.(s.id)}>
                          Open room
                        </button>
                      )}
                    </div>
                  </div>

                  {expanded === s.id && (
                    <TrackFiles tracks={tracksBySession[s.id]} archived={!!s.archived_at} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Per-person files, with whatever download qualities exist for each. */
function TrackFiles({ tracks, archived }) {
  if (!tracks) return <p style={styles.muted}>Loading files…</p>;
  if (tracks.length === 0) return <p style={styles.muted}>No recordings captured in this session.</p>;

  return (
    <div style={styles.files}>
      {tracks.map((t) => (
        <div key={t.id} style={styles.fileRow}>
          <div style={styles.fileHead}>
            <span style={styles.fileName}>
              {t.participantName} · {t.kind}
            </span>
            <span style={styles.fileMeta}>
              {formatDuration(t.duration_ms) || formatBytes(t.bytes_uploaded)}
            </span>
          </div>

          {!archived || !t.nas_path ? (
            <p style={styles.pendingNote}>
              {t.status === 'archived'
                ? 'Archived, but the file path is missing.'
                : 'Still in the capture buffer — downloads appear once the archiver moves this to the NAS.'}
            </p>
          ) : t.renditions.length === 0 ? (
            <p style={styles.pendingNote}>Preparing downloads…</p>
          ) : (
            <div style={styles.qualityRow}>
              {t.renditions.map((r) => {
                const ready = r.status === 'ready' && r.nas_path;
                const label = QUALITY_LABELS[r.quality] || r.quality;
                if (!ready) {
                  return (
                    <span key={r.id} style={styles.qualityPending} title={r.error || ''}>
                      {label} · {r.status === 'failed' ? 'failed' : 'encoding…'}
                    </span>
                  );
                }
                return (
                  <a
                    key={r.id}
                    href={nasDownloadUrl(r.nas_path)}
                    style={styles.qualityLink}
                    title={r.nas_path}
                  >
                    {label}
                    {r.height ? ` · ${r.height}p` : ''} · {formatBytes(r.bytes)}
                  </a>
                );
              })}
            </div>
          )}
        </div>
      ))}
      <p style={styles.hint}>
        Downloads stream from the studio Mac. Off that machine, use the file path on the NAS instead.
      </p>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: colors.bg,
    fontFamily,
    color: colors.text,
    display: 'flex',
    justifyContent: 'center',
    padding: spacing.xxl,
    boxSizing: 'border-box',
  },
  inner: { width: '100%', maxWidth: 760, display: 'flex', flexDirection: 'column', gap: spacing.lg },
  header: { display: 'flex', flexDirection: 'column', gap: spacing.xs },
  titleRow: { display: 'flex', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  renameRow: { display: 'flex', gap: spacing.sm, flexWrap: 'wrap', alignItems: 'center' },
  title: { fontSize: fontSizes.displayLg, fontWeight: fontWeights.bold, margin: 0, letterSpacing: '-0.3px' },
  meta: { fontSize: fontSizes.sm, color: colors.textSubtle, margin: 0 },
  actionRow: { display: 'flex', gap: spacing.sm, flexWrap: 'wrap' },
  hint: { fontSize: fontSizes.xs, color: colors.textSubtle, margin: 0 },
  muted: { fontSize: fontSizes.sm, color: colors.textSubtle, margin: 0 },
  list: { display: 'flex', flexDirection: 'column', gap: spacing.sm, marginTop: spacing.sm },
  card: {
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.md,
    padding: spacing.md,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.sm,
  },
  cardRow: { display: 'flex', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  cardTitleRow: { display: 'flex', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  cardTitle: { fontSize: fontSizes.md, fontWeight: fontWeights.semibold },
  cardMeta: { fontSize: fontSizes.xs, color: colors.textSubtle, marginTop: 2 },
  cardActions: { display: 'flex', gap: spacing.xs, flexWrap: 'wrap' },
  emptyCard: {
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginTop: spacing.sm,
  },
  files: {
    borderTop: `1px solid ${colors.border}`,
    paddingTop: spacing.sm,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.sm,
  },
  fileRow: { display: 'flex', flexDirection: 'column', gap: spacing.xs },
  fileHead: { display: 'flex', alignItems: 'baseline', gap: spacing.sm, flexWrap: 'wrap' },
  fileName: { fontSize: fontSizes.sm, fontWeight: fontWeights.semibold },
  fileMeta: { fontSize: fontSizes.xs, color: colors.textSubtle },
  qualityRow: { display: 'flex', gap: spacing.xs, flexWrap: 'wrap' },
  qualityLink: {
    fontSize: fontSizes.xs,
    padding: `${spacing.xs}px ${spacing.sm}px`,
    borderRadius: radii.sm,
    border: `1px solid ${colors.accentBorder}`,
    background: colors.accentSoft,
    color: colors.accentFg,
    textDecoration: 'none',
  },
  qualityPending: {
    fontSize: fontSizes.xs,
    padding: `${spacing.xs}px ${spacing.sm}px`,
    borderRadius: radii.sm,
    border: `1px solid ${colors.border}`,
    color: colors.textSubtle,
  },
  pendingNote: { fontSize: fontSizes.xs, color: colors.textSubtle, margin: 0 },
  errorBox: {
    padding: spacing.md,
    borderRadius: radii.md,
    background: colors.danger.bg,
    border: `1px solid ${colors.danger.border}`,
    color: colors.danger.fg,
    fontSize: fontSizes.sm,
  },
};
