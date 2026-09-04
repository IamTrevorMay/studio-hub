import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { rotateGuestToken, guestJoinLink } from '../../lib/harbor/session';
import {
  listShows,
  createShow,
  listMeetings,
  createMeeting,
  listLegacySessions,
  CAPTURE_QUALITY_LABELS,
} from '../../lib/harbor/shows';
import useVisibilityRefresh from '../../hooks/useVisibilityRefresh';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamily } from '../../lib/styleTokens';
import { pill, button, input, card, sectionHeader } from '../../lib/styleRecipes';

// Harbor app home (staff side). Two things you can make:
//
//   Shows    — reusable rooms with a permanent guest link. Recording one
//              creates a session underneath, so a show keeps its own history.
//              4 seats, video, quality tiers on download.
//   Meetings — one-off gatherings. Video call, audio-only recording, 6 seats.
//
// Legacy standalone sessions (mode='recording') predate this split and get
// their own tab so nothing recorded before it becomes unreachable.
//
// Guests never see this page — they enter via the public /harbor/join/<token>
// route served before the auth gate (HarborJoin.js).

const STATUS_TONES = { scheduled: 'info', live: 'success', ended: 'danger' };
const STATUS_LABELS = { scheduled: 'Scheduled', live: 'Live', ended: 'Ended' };

const TABS = [
  { key: 'shows', label: 'Shows' },
  { key: 'meetings', label: 'Meetings' },
];

export default function HarborHome({ onOpenRoom, onOpenShow, onBackToLauncher }) {
  const { profile } = useAuth();
  const [tab, setTab] = useState('shows');

  const [shows, setShows] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [legacy, setLegacy] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [rotatingId, setRotatingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const fetchAll = useCallback(async () => {
    try {
      const [s, m, l] = await Promise.all([listShows(), listMeetings(), listLegacySessions()]);
      setShows(s);
      setMeetings(m);
      setLegacy(l);
      setLoadError(null);
    } catch (err) {
      console.error('Harbor: failed to load:', err);
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);
  useVisibilityRefresh(fetchAll);

  const handleCreate = async (e) => {
    e?.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      if (tab === 'shows') {
        const show = await createShow({ title: newTitle, createdBy: profile?.id });
        setShows((prev) => [show, ...prev]);
        setNewTitle('');
        onOpenShow?.(show.id);
      } else {
        const meeting = await createMeeting({ title: newTitle });
        setMeetings((prev) => [meeting, ...prev]);
        setNewTitle('');
        onOpenRoom?.(meeting.id);
      }
    } catch (err) {
      console.error('Harbor: create failed:', err);
      setLoadError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async (id, token) => {
    const link = guestJoinLink(token);
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2000);
    } catch (err) {
      console.error('Harbor: clipboard write failed:', err);
      window.prompt('Copy the guest link:', link); // eslint-disable-line no-alert
    }
  };

  // Old links 404 immediately in harbor-join; the live signaling channel is
  // named from channel_secret, so connected guests are untouched.
  const rotateLink = async (session) => {
    if (rotatingId) return;
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      `Generate a new guest link for "${session.title}"? The old link stops working immediately. Guests already connected are not affected.`,
    );
    if (!ok) return;
    setRotatingId(session.id);
    try {
      const newToken = await rotateGuestToken(session.id);
      const patch = (list) =>
        list.map((s) => (s.id === session.id ? { ...s, guest_token: newToken } : s));
      setMeetings(patch);
      setLegacy(patch);
      setCopiedId((cur) => (cur === session.id ? null : cur)); // a stale "Copied!" would lie
    } catch (err) {
      console.error('Harbor: guest link rotation failed:', err);
      setLoadError(err.message);
    } finally {
      setRotatingId(null);
    }
  };

  // Cascades to participants + tracks. The DB refuses if any recording is
  // still in the capture buffer (harbor_sessions_guard_delete).
  const deleteSession = async (session) => {
    if (deletingId) return;
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      `Delete "${session.title}"? This permanently removes the session and its recording data. This cannot be undone.`,
    );
    if (!ok) return;
    setDeletingId(session.id);
    try {
      const { error } = await supabase.from('harbor_sessions').delete().eq('id', session.id);
      if (error) throw error;
      const drop = (list) => list.filter((s) => s.id !== session.id);
      setMeetings(drop);
      setLegacy(drop);
    } catch (err) {
      console.error('Harbor: failed to delete session:', err);
      // The delete guard's message explains itself — surface it verbatim.
      setLoadError(err.message);
    } finally {
      setDeletingId(null);
    }
  };

  const showLegacy = legacy.length > 0;
  const tabs = showLegacy ? [...TABS, { key: 'legacy', label: 'Older sessions' }] : TABS;

  return (
    <div style={styles.page}>
      <div style={styles.inner}>
        <div style={styles.brandRow}>
          <div style={styles.brandLeft}>
            <div style={styles.tileMark}>H</div>
            <div>
              <h1 style={styles.title}>Harbor</h1>
              <p style={styles.tagline}>Podcast &amp; remote recording</p>
            </div>
          </div>
          {onBackToLauncher && (
            <button type="button" onClick={onBackToLauncher} style={button({ variant: 'ghost', size: 'sm' })}>
              &larr; Apps
            </button>
          )}
        </div>

        <div style={styles.tabRow}>
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={tab === t.key ? styles.tabOn : styles.tab}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab !== 'legacy' && (
          <>
            <form onSubmit={handleCreate} style={styles.createRow}>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={tab === 'shows' ? 'New show name…' : 'New meeting title…'}
                maxLength={120}
                style={styles.createInput}
              />
              <button type="submit" style={button({ disabled: creating })} disabled={creating}>
                {creating ? 'Creating…' : tab === 'shows' ? 'Create show' : 'Start meeting'}
              </button>
            </form>
            <p style={styles.hint}>
              {tab === 'shows'
                ? 'A show is a room you keep — one permanent guest link, and a new recording every time you use it. Up to 4 people, full video.'
                : 'A meeting is a one-off. Everyone is on camera, but only audio is recorded. Up to 6 people.'}
            </p>
          </>
        )}

        {loadError && <div style={styles.errorBox}>{loadError}</div>}

        {loading ? (
          <p style={styles.emptyText}>Loading…</p>
        ) : tab === 'shows' ? (
          <ShowList shows={shows} onOpenShow={onOpenShow} copiedId={copiedId} onCopy={copyLink} />
        ) : (
          <SessionList
            sessions={tab === 'meetings' ? meetings : legacy}
            emptyTitle={tab === 'meetings' ? 'No meetings yet' : 'No older sessions'}
            emptyBody={
              tab === 'meetings'
                ? 'Start a meeting, copy the guest link, and everyone joins from the browser.'
                : 'Standalone sessions recorded before Shows existed would appear here.'
            }
            onOpenRoom={onOpenRoom}
            onCopy={copyLink}
            onRotate={rotateLink}
            onDelete={deleteSession}
            copiedId={copiedId}
            rotatingId={rotatingId}
            deletingId={deletingId}
          />
        )}
      </div>
    </div>
  );
}

function ShowList({ shows, onOpenShow, copiedId, onCopy }) {
  if (shows.length === 0) {
    return (
      <div style={styles.emptyCard}>
        <h2 style={sectionHeader(2)}>No shows yet</h2>
        <p style={styles.emptyText}>
          Create a show for anything you record more than once — a podcast, a series, a weekly. Its
          guest link never changes.
        </p>
      </div>
    );
  }
  return (
    <div style={styles.list}>
      {shows.map((s) => (
        <div key={s.id} style={styles.sessionCard}>
          <div style={styles.sessionInfo}>
            <div style={styles.sessionTitleRow}>
              <span style={styles.sessionTitle}>{s.title}</span>
              <span style={pill('info')}>Show</span>
            </div>
            <span style={styles.sessionMeta}>
              {s.max_participants} seats · video ·{' '}
              {CAPTURE_QUALITY_LABELS[s.capture_quality] || s.capture_quality}
            </span>
          </div>
          <div style={styles.sessionActions}>
            <button
              type="button"
              style={button({ variant: 'ghost', size: 'sm' })}
              onClick={() => onCopy(s.id, s.guest_token)}
            >
              {copiedId === s.id ? 'Copied!' : 'Copy guest link'}
            </button>
            <button type="button" style={button({ size: 'sm' })} onClick={() => onOpenShow?.(s.id)}>
              Open show
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function SessionList({
  sessions,
  emptyTitle,
  emptyBody,
  onOpenRoom,
  onCopy,
  onRotate,
  onDelete,
  copiedId,
  rotatingId,
  deletingId,
}) {
  if (sessions.length === 0) {
    return (
      <div style={styles.emptyCard}>
        <h2 style={sectionHeader(2)}>{emptyTitle}</h2>
        <p style={styles.emptyText}>{emptyBody}</p>
      </div>
    );
  }
  return (
    <div style={styles.list}>
      {sessions.map((s) => (
        <div key={s.id} style={styles.sessionCard}>
          <div style={styles.sessionInfo}>
            <div style={styles.sessionTitleRow}>
              <span style={styles.sessionTitle}>{s.title}</span>
              {s.mode === 'meeting' && <span style={pill('default')}>Audio only</span>}
              <span style={pill(STATUS_TONES[s.status] || 'info')}>
                {STATUS_LABELS[s.status] || s.status}
              </span>
              {s.archived_at && <span style={pill('success')}>On NAS</span>}
            </div>
            <span style={styles.sessionMeta}>
              Created {new Date(s.created_at).toLocaleDateString()}
              {s.started_at ? ` · started ${new Date(s.started_at).toLocaleString()}` : ''}
              {s.ended_at ? ` · ended ${new Date(s.ended_at).toLocaleString()}` : ''}
            </span>
          </div>
          <div style={styles.sessionActions}>
            {s.status !== 'ended' && (
              <button
                type="button"
                style={button({ variant: 'ghost', size: 'sm' })}
                onClick={() => onCopy(s.id, s.guest_token)}
              >
                {copiedId === s.id ? 'Copied!' : 'Copy guest link'}
              </button>
            )}
            {s.status !== 'ended' && (
              <button
                type="button"
                style={button({ variant: 'ghost', size: 'sm', disabled: rotatingId === s.id })}
                disabled={rotatingId === s.id}
                onClick={() => onRotate(s)}
              >
                {rotatingId === s.id ? 'Rotating…' : 'New guest link'}
              </button>
            )}
            <button
              type="button"
              style={button({ size: 'sm', disabled: s.status === 'ended' })}
              disabled={s.status === 'ended'}
              onClick={() => onOpenRoom?.(s.id)}
            >
              Open room
            </button>
            <button
              type="button"
              style={button({ variant: 'danger', size: 'sm', disabled: deletingId === s.id })}
              disabled={deletingId === s.id}
              onClick={() => onDelete(s)}
            >
              {deletingId === s.id ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      ))}
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
  inner: {
    width: '100%',
    maxWidth: 760,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.lg,
  },
  brandRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  brandLeft: { display: 'flex', alignItems: 'center', gap: spacing.lg },
  tileMark: {
    width: 52,
    height: 52,
    borderRadius: radii.lg,
    background: colors.info.bg,
    border: `1px solid ${colors.info.border}`,
    color: colors.info.fg,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: fontSizes.display,
    fontWeight: fontWeights.bold,
    flexShrink: 0,
  },
  title: {
    fontSize: fontSizes.displayLg,
    fontWeight: fontWeights.bold,
    margin: 0,
    letterSpacing: '-0.3px',
  },
  tagline: { fontSize: fontSizes.md, color: colors.info.fgSoft, margin: 0 },
  tabRow: {
    display: 'flex',
    gap: spacing.xs,
    borderBottom: `1px solid ${colors.border}`,
    paddingBottom: spacing.xs,
  },
  tab: {
    background: 'transparent',
    border: 'none',
    color: colors.textSubtle,
    fontFamily,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    padding: `${spacing.xs}px ${spacing.md}px`,
    borderRadius: radii.sm,
    cursor: 'pointer',
  },
  tabOn: {
    background: colors.accentSoft,
    border: 'none',
    color: colors.accentFg,
    fontFamily,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    padding: `${spacing.xs}px ${spacing.md}px`,
    borderRadius: radii.sm,
    cursor: 'pointer',
  },
  createRow: { display: 'flex', gap: spacing.sm, flexWrap: 'wrap' },
  createInput: { ...input(), flex: 1, minWidth: 200 },
  hint: { fontSize: fontSizes.xs, color: colors.textSubtle, margin: 0 },
  errorBox: {
    padding: spacing.md,
    borderRadius: radii.md,
    background: colors.danger.bg,
    border: `1px solid ${colors.danger.border}`,
    color: colors.danger.fg,
    fontSize: fontSizes.sm,
  },
  list: { display: 'flex', flexDirection: 'column', gap: spacing.sm },
  sessionCard: {
    ...card(),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  sessionInfo: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 },
  sessionTitleRow: { display: 'flex', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  sessionTitle: { fontSize: fontSizes.md, fontWeight: fontWeights.semibold },
  sessionMeta: { fontSize: fontSizes.xs, color: colors.textSubtle },
  sessionActions: { display: 'flex', gap: spacing.xs, flexWrap: 'wrap' },
  emptyCard: { ...card(), padding: spacing.lg },
  emptyText: { fontSize: fontSizes.sm, color: colors.textSubtle, margin: 0 },
};
