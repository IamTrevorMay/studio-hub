import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { getDisplayName } from '../../lib/displayName';
import { harborChannelName } from '../../lib/harbor/signaling';
import { rotateGuestToken, guestJoinLink } from '../../lib/harbor/session';
import { chunkPath, containerExt, HARBOR_RECORDINGS_BUCKET } from '../../lib/harbor/recorder';
import { createStaffRecorderTransport } from '../../lib/harbor/recorderTransports';
import CallStage from './CallStage';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamily, fontFamilyMono } from '../../lib/styleTokens';
import { pill, button, sectionHeader } from '../../lib/styleRecipes';

// Staff-side call room at /harbor/room/<session_id>. Loads the session under
// RLS, shows a pre-join screen (so media only starts on an explicit click —
// which also satisfies autoplay-with-audio policies), then registers a
// 'producer' participant row and mounts the shared CallStage. Staff build
// the signaling channel name from channel_secret (read under RLS); guests
// get the same name from the harbor-join edge function. The channel is NOT
// derived from guest_token, so rotating the guest link ("New guest link")
// never disturbs a live call.
//
// Phase 2: the pre-join screen also hosts the Recordings panel (harbor_tracks
// for this session — status, size, duration, per-track download). Staff-only
// by construction: guests never see this page.
//
// Phase 3: staff joins stay auto-admitted (state 'admitted' on insert). The
// green room / moderation DB writes live here (admit/remove callbacks passed
// to CallStage) so the shared stage stays free of supabase imports.

const STATUS_TONES = { scheduled: 'info', live: 'success', ended: 'danger' };
const STATUS_LABELS = { scheduled: 'Scheduled', live: 'Live', ended: 'Ended' };

const TRACK_STATUS_TONES = {
  recording: 'danger',
  uploading: 'warning',
  complete: 'success',
  failed: 'danger',
  archived: 'default', // neutral outline pill — terminal, calm
};
const TRACK_STATUS_LABELS = {
  recording: 'Recording',
  uploading: 'Uploading',
  complete: 'Complete',
  failed: 'Failed',
  archived: 'Archived',
};

function formatBytes(n) {
  if (!n || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return null;
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function safeFilePart(s) {
  return (
    (s || '')
      .replace(/[^\w\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'harbor'
  );
}

export default function HarborRoom({ sessionId, onExit }) {
  const { profile } = useAuth();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [joinError, setJoinError] = useState(null);
  const [joining, setJoining] = useState(false);
  const [callInfo, setCallInfo] = useState(null); // { channelName, clientId, participantId }
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const participantIdRef = useRef(null);

  const fetchSession = useCallback(async () => {
    const { data, error } = await supabase
      .from('harbor_sessions')
      .select('id, title, status, guest_token, channel_secret, scheduled_at, started_at, ended_at')
      .eq('id', sessionId)
      .maybeSingle();
    if (error) console.error('Harbor: failed to load session:', error);
    setSession(data || null);
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  const displayName = getDisplayName(profile) || profile?.full_name || 'Producer';

  const joinCall = async () => {
    if (!session || joining) return;
    setJoining(true);
    setJoinError(null);
    try {
      const clientId = crypto.randomUUID();
      const channelName = harborChannelName(session.id, session.channel_secret);
      const { data: participant, error } = await supabase
        .from('harbor_participants')
        .insert({
          session_id: session.id,
          display_name: displayName,
          role: 'producer',
          state: 'admitted',
          user_id: profile?.id,
          client_id: clientId,
        })
        .select('id')
        .single();
      if (error) throw error;
      participantIdRef.current = participant.id;
      setCallInfo({ channelName, clientId, participantId: participant.id });
    } catch (err) {
      console.error('Harbor: join failed:', err);
      setJoinError(err.message || 'Could not join the room.');
    } finally {
      setJoining(false);
    }
  };

  const stampLeft = useCallback(() => {
    const pid = participantIdRef.current;
    if (!pid) return;
    participantIdRef.current = null;
    // Fire and forget — leaving must never block navigation.
    supabase
      .from('harbor_participants')
      .update({ left_at: new Date().toISOString() })
      .eq('id', pid)
      .is('left_at', null)
      .then(({ error }) => {
        if (error) console.warn('Harbor: left_at stamp failed:', error);
      });
  }, []);

  const handleLeave = useCallback(() => {
    stampLeft();
    setCallInfo(null);
    fetchSession(); // status may have changed (e.g. we just ended it)
  }, [stampLeft, fetchSession]);

  const updateSessionStatus = useCallback(
    async (next) => {
      const patch = { status: next };
      if (next === 'live') patch.started_at = new Date().toISOString();
      if (next === 'ended') patch.ended_at = new Date().toISOString();
      const { error } = await supabase.from('harbor_sessions').update(patch).eq('id', sessionId);
      if (error) throw error;
      setSession((prev) => (prev ? { ...prev, ...patch } : prev));
    },
    [sessionId],
  );

  // Green-room admit: lobby → admitted under staff RLS. The 'lobby' guard
  // makes double-admits (two producers clicking at once) a no-op.
  const admitParticipant = useCallback(
    async (participantId) => {
      const { error } = await supabase
        .from('harbor_participants')
        .update({ state: 'admitted' })
        .eq('id', participantId)
        .eq('session_id', sessionId)
        .eq('state', 'lobby');
      if (error) throw error;
    },
    [sessionId],
  );

  // Remove: state → removed + left_at stamped (frees the seat and anchors
  // harbor-track's post-removal upload grace window).
  const removeParticipant = useCallback(
    async (participantId) => {
      const { error } = await supabase
        .from('harbor_participants')
        .update({ state: 'removed', left_at: new Date().toISOString() })
        .eq('id', participantId)
        .eq('session_id', sessionId);
      if (error) throw error;
    },
    [sessionId],
  );

  const copyGuestLink = async () => {
    if (!session) return;
    const link = guestJoinLink(session.guest_token);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Harbor: clipboard write failed:', err);
      window.prompt('Copy the guest link:', link); // eslint-disable-line no-alert
    }
  };

  // Rotate the guest link: old links 404 immediately; the live channel and
  // connected guests are untouched (channel_secret is a separate column).
  const rotateLink = async () => {
    if (!session || rotating) return;
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      'Generate a new guest link? The old link stops working immediately. Guests already connected are not affected.',
    );
    if (!ok) return;
    setRotating(true);
    try {
      const newToken = await rotateGuestToken(session.id);
      setSession((prev) => (prev ? { ...prev, guest_token: newToken } : prev));
      setCopied(false); // the old "Copied!" would now be a lie
    } catch (err) {
      console.error('Harbor: guest link rotation failed:', err);
      setJoinError(err.message || 'Could not rotate the guest link.');
    } finally {
      setRotating(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.page}>
        <p style={styles.mutedText}>Loading session…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div style={styles.page}>
        <div style={styles.panel}>
          <h2 style={sectionHeader(2)}>Session not found</h2>
          <p style={styles.mutedText}>It may have been deleted, or the link is wrong.</p>
          <button type="button" style={button({ variant: 'ghost' })} onClick={onExit}>
            &larr; Back to Harbor
          </button>
        </div>
      </div>
    );
  }

  // In-call: full-bleed CallStage.
  if (callInfo) {
    return (
      <div style={styles.callPage}>
        <CallStage
          channelName={callInfo.channelName}
          clientId={callInfo.clientId}
          displayName={displayName}
          role="producer"
          session={session}
          participantId={callInfo.participantId}
          canControlSession
          onUpdateSessionStatus={updateSessionStatus}
          onAdmitParticipant={admitParticipant}
          onRemoveParticipant={removeParticipant}
          onLeave={handleLeave}
          onPageUnload={stampLeft}
          createRecorderTransport={() =>
            createStaffRecorderTransport({
              sessionId: session.id,
              participantId: callInfo.participantId,
            })
          }
        />
      </div>
    );
  }

  // Pre-join screen + tracks panel.
  return (
    <div style={styles.pageScroll}>
      <div style={styles.column}>
        <div style={{ ...styles.panel, maxWidth: '100%' }}>
          <div style={styles.titleRow}>
            <h1 style={styles.title}>{session.title}</h1>
            <span style={pill(STATUS_TONES[session.status] || 'info')}>
              {STATUS_LABELS[session.status] || session.status}
            </span>
          </div>
          {session.status === 'ended' ? (
            <p style={styles.mutedText}>This session has ended.</p>
          ) : (
            <>
              <p style={styles.mutedText}>
                Joining starts your camera and microphone. Up to 4 participants (you + 3 guests).
              </p>
              {joinError && <p style={styles.errorText}>{joinError}</p>}
              <div style={styles.actionRow}>
                <button
                  type="button"
                  style={button({ size: 'lg', disabled: joining })}
                  disabled={joining}
                  onClick={joinCall}
                >
                  {joining ? 'Joining…' : 'Join call'}
                </button>
                <button type="button" style={button({ variant: 'ghost' })} onClick={copyGuestLink}>
                  {copied ? 'Copied!' : 'Copy guest link'}
                </button>
                <button
                  type="button"
                  style={button({ variant: 'ghost', disabled: rotating })}
                  disabled={rotating}
                  onClick={rotateLink}
                >
                  {rotating ? 'Rotating…' : 'New guest link'}
                </button>
              </div>
            </>
          )}
          <button type="button" style={styles.backBtn} onClick={onExit}>
            &larr; Back to Harbor
          </button>
        </div>
        <TracksPanel sessionId={session.id} sessionTitle={session.title} />
      </div>
    </div>
  );
}

// ── Recordings panel (Phase 2) ───────────────────────────────────
// Lists harbor_tracks for the session; live via postgres_changes (the Phase 2
// migration added harbor_tracks to the realtime publication, and staff RLS
// read makes the events visible) — chosen over polling because progress rows
// update every ~15s during a recording. Download = fetch chunks in order,
// concat into one Blob (sequential timeslice chunks of a single MediaRecorder
// stream concatenate into a valid webm), save as
// <session-title>-<participant>-<kind>.webm.
function TracksPanel({ sessionId, sessionTitle }) {
  const [tracks, setTracks] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [downloading, setDownloading] = useState({}); // trackId → progress label
  const [dlError, setDlError] = useState(null);
  const [copiedPathId, setCopiedPathId] = useState(null); // trackId of last-copied NAS path

  const fetchTracks = useCallback(async () => {
    const { data, error } = await supabase
      .from('harbor_tracks')
      .select(
        'id, kind, status, bytes_uploaded, chunk_count, duration_ms, mime_type, storage_prefix, nas_path, archived_at, created_at, harbor_participants(display_name, role)',
      )
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('Harbor: failed to load tracks:', error);
      return;
    }
    setTracks(data || []);
    setLoaded(true);
  }, [sessionId]);

  useEffect(() => {
    fetchTracks();
    const channel = supabase
      .channel(`harbor-tracks-${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'harbor_tracks', filter: `session_id=eq.${sessionId}` },
        () => fetchTracks(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchTracks, sessionId]);

  const downloadTrack = async (track) => {
    if (downloading[track.id] || !track.storage_prefix) return;
    setDlError(null);
    const participantName = track.harbor_participants?.display_name;
    const ext = containerExt(track.mime_type);
    const baseMimeType = (track.mime_type || 'video/webm').split(';')[0];
    const fileName = `${safeFilePart(sessionTitle)}-${safeFilePart(participantName)}-${track.kind}.${ext}`;

    // Long tracks are large (~1.2GB/hour): stream chunks straight to disk via
    // the File System Access API where available. The Blob-concat fallback
    // holds the whole track in memory, which OOMs a tab around 1-2GB — warn
    // before attempting it on big tracks.
    let writable = null;
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: 'Recording', accept: { [baseMimeType]: [`.${ext}`] } }],
        });
        writable = await handle.createWritable();
      } catch (err) {
        if (err?.name === 'AbortError') return; // user cancelled the picker
        writable = null; // picker unavailable/failed — fall back to Blob path
      }
    }
    if (!writable && track.bytes_uploaded > 1.2e9) {
      const proceed = window.confirm(
        'This recording is large and your browser cannot stream it to disk — the tab may run out of memory. Try Chrome for large tracks. Download anyway?',
      );
      if (!proceed) return;
    }

    setDownloading((prev) => ({ ...prev, [track.id]: 'Preparing…' }));
    try {
      const parts = writable ? null : [];
      let savedChunks = 0;
      for (let i = 0; i < track.chunk_count; i += 1) {
        const { data, error } = await supabase.storage
          .from(HARBOR_RECORDINGS_BUCKET)
          .download(chunkPath(track.storage_prefix, i, ext));
        if (error) {
          // Failed tracks are partial by nature — chunk_count can overstate
          // what actually landed. Save the contiguous prefix instead of
          // bailing, and tell the user exactly how much they're getting.
          if (track.status === 'failed' && i > 0) {
            console.warn(`Harbor: chunk ${i} missing on failed track — saving ${i} chunks`);
            break;
          }
          throw error;
        }
        if (writable) await writable.write(data);
        else parts.push(data);
        savedChunks = i + 1;
        // eslint-disable-next-line no-loop-func
        setDownloading((prev) => ({ ...prev, [track.id]: `${i + 1}/${track.chunk_count}` }));
      }
      if (savedChunks < track.chunk_count) {
        const secs = Math.round((savedChunks * 5000) / 1000);
        setDlError(
          `Partial recovery: ${savedChunks} of ${track.chunk_count} chunks were saved (~${secs}s of recording). The rest never reached storage.`,
        );
      }
      if (writable) {
        await writable.close();
        writable = null;
      } else {
        const blob = new Blob(parts, { type: baseMimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    } catch (err) {
      console.error('Harbor: track download failed:', err);
      setDlError(`Download failed: ${err.message || 'unknown error'}`);
      if (writable) await writable.abort().catch(() => {});
    } finally {
      setDownloading((prev) => {
        const next = { ...prev };
        delete next[track.id];
        return next;
      });
    }
  };

  const copyNasPath = async (track) => {
    try {
      await navigator.clipboard.writeText(track.nas_path);
      setCopiedPathId(track.id);
      setTimeout(() => setCopiedPathId((cur) => (cur === track.id ? null : cur)), 2000);
    } catch (err) {
      console.error('Harbor: clipboard write failed:', err);
      window.prompt('Copy the NAS path:', track.nas_path); // eslint-disable-line no-alert
    }
  };

  if (!loaded || tracks.length === 0) return null; // nothing recorded yet

  return (
    <div style={styles.tracksPanel}>
      <h2 style={sectionHeader(3)}>Recordings</h2>
      {dlError && <p style={styles.errorText}>{dlError}</p>}
      {tracks.map((track) => {
        const duration = formatDuration(track.duration_ms);
        // Archived tracks live on the NAS — cloud chunks are purged, so no
        // download; the NAS path is the pointer. Failed tracks keep whatever
        // chunks landed (partial recovery).
        const canDownload =
          (track.status === 'complete' || track.status === 'failed') && track.chunk_count > 0;
        return (
          <div key={track.id} style={styles.trackRow}>
            <div style={styles.trackInfo}>
              <span style={styles.trackName}>
                {track.harbor_participants?.display_name || 'Unknown'}
              </span>
              <span style={styles.trackMeta}>
                {track.kind} · {formatBytes(track.bytes_uploaded)}
                {duration ? ` · ${duration}` : ''}
                {track.status !== 'complete' && track.status !== 'archived'
                  ? ` · ${track.chunk_count} chunks`
                  : ''}
              </span>
              {track.status === 'archived' && track.nas_path && (
                <span style={styles.nasPathRow} title="Archived to NAS — cloud chunks purged">
                  <span style={styles.nasPath}>{track.nas_path}</span>
                  <button
                    type="button"
                    style={button({ variant: 'ghost', size: 'sm' })}
                    onClick={() => copyNasPath(track)}
                  >
                    {copiedPathId === track.id ? 'Copied!' : 'Copy path'}
                  </button>
                </span>
              )}
            </div>
            <span
              style={pill(TRACK_STATUS_TONES[track.status] || 'info')}
              title={track.status === 'archived' ? 'Archived to NAS' : undefined}
            >
              {TRACK_STATUS_LABELS[track.status] || track.status}
            </span>
            {canDownload && (
              <button
                type="button"
                style={button({ variant: 'secondary', size: 'sm', disabled: !!downloading[track.id] })}
                disabled={!!downloading[track.id]}
                onClick={() => downloadTrack(track)}
              >
                {downloading[track.id]
                  ? `Fetching ${downloading[track.id]}`
                  : track.status === 'failed'
                    ? 'Download partial'
                    : 'Download'}
              </button>
            )}
          </div>
        );
      })}
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
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    boxSizing: 'border-box',
  },
  callPage: {
    minHeight: '100vh',
    background: colors.bg,
    fontFamily,
    color: colors.text,
    display: 'flex',
    flexDirection: 'column',
    padding: spacing.lg,
    boxSizing: 'border-box',
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.lg,
    padding: spacing.xxxl,
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.xl,
    maxWidth: 480,
    width: '100%',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  title: {
    fontSize: fontSizes.display,
    fontWeight: fontWeights.bold,
    margin: 0,
  },
  mutedText: {
    fontSize: fontSizes.md,
    color: colors.textMuted,
    margin: 0,
    lineHeight: 1.6,
  },
  errorText: {
    fontSize: fontSizes.md,
    color: colors.danger.fgSoft,
    margin: 0,
  },
  actionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  backBtn: {
    ...button({ variant: 'ghost', size: 'sm' }),
    alignSelf: 'flex-start',
  },
  // Pre-join + tracks: same page shell but top-aligned so a long recordings
  // list scrolls instead of clipping (flex-center overflows at the top).
  pageScroll: {
    minHeight: '100vh',
    background: colors.bg,
    fontFamily,
    color: colors.text,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    padding: spacing.xxl,
    boxSizing: 'border-box',
  },
  column: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.lg,
    width: '100%',
    maxWidth: 560,
  },
  tracksPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.md,
    padding: spacing.xxl,
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.xl,
  },
  trackRow: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    padding: `${spacing.sm}px 0`,
    borderBottom: `1px solid ${colors.border}`,
    flexWrap: 'wrap',
  },
  trackInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.xs,
    flex: 1,
    minWidth: 0,
  },
  trackName: {
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
    color: colors.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  trackMeta: {
    fontSize: fontSizes.sm,
    color: colors.textSubtle,
  },
  nasPathRow: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  nasPath: {
    fontSize: fontSizes.sm,
    fontFamily: fontFamilyMono,
    color: colors.textMuted,
    wordBreak: 'break-all',
    userSelect: 'all', // one click selects the whole path
  },
};
