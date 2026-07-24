import React, { useState, useEffect, useRef, useCallback } from 'react';
import { LOCAL_MEDIA_CONSTRAINTS } from '../../lib/harbor/mesh';
import { createGuestRecorderTransport } from '../../lib/harbor/recorderTransports';
import CallStage from './CallStage';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamily } from '../../lib/styleTokens';
import { button, input, sectionHeader } from '../../lib/styleRecipes';

// PUBLIC guest join page at /harbor/join/<token> — served by App.js BEFORE
// the auth gate (same pattern as /careers), so it renders with no session,
// no AuthProvider, and no staff chrome. Guests authenticate with the session
// guest_token alone via the harbor-join edge function; the signaling channel
// then runs over Supabase Realtime broadcast using the public anon key
// (supabaseClient), with zero direct DB access.
//
// Single-column and flex-based — usable on phone viewports without a
// separate Mobile twin.

const JOIN_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/harbor-join`;

function getTokenFromPath() {
  const segments = window.location.pathname.replace(/^\/+/, '').split('/');
  if (segments[0] === 'harbor' && segments[1] === 'join' && segments[2]) return segments[2];
  return null;
}

// Refresh survival for anonymous guests: sessionStorage (tab-scoped, not
// durable user data) keeps { participantId, resumeKey, name } per token so a
// reload re-joins the SAME participant row via harbor-join — an admitted
// guest who refreshes skips the green room instead of inserting a fresh
// lobby row. resumeKey is the per-participant secret proving this tab owns
// the row (participant_id alone is channel-visible via presence); it never
// goes anywhere except harbor-join / harbor-track request bodies.
const STORAGE_PREFIX = 'harbor:join:';

function readStoredJoin(token) {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + token);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredJoin(token, data) {
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + token, JSON.stringify(data));
  } catch {
    /* storage may be unavailable (private mode) — refresh just re-lobbies */
  }
}

export default function HarborJoin() {
  const token = getTokenFromPath();
  const [phase, setPhase] = useState('setup'); // setup | call | done
  const [doneReason, setDoneReason] = useState('left'); // left | ended | removed
  const [name, setName] = useState(() => (token && readStoredJoin(token)?.name) || '');
  const [previewStream, setPreviewStream] = useState(null);
  const [mediaError, setMediaError] = useState(null);
  const [joinError, setJoinError] = useState(null);
  const [joining, setJoining] = useState(false);
  const [joinInfo, setJoinInfo] = useState(null); // { session, participantId, state, channel, clientId }
  const previewVideoRef = useRef(null);
  const streamRef = useRef(null);
  const handedOffRef = useRef(false); // stream ownership moved to CallStage's mesh

  useEffect(() => {
    document.title = 'Join call · Harbor · Mayday Studio';
  }, []);

  // Device check: request cam+mic on mount for the preview.
  const requestMedia = useCallback(async () => {
    setMediaError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(LOCAL_MEDIA_CONSTRAINTS);
      streamRef.current = stream;
      setPreviewStream(stream);
    } catch (err) {
      console.error('Harbor join: getUserMedia failed:', err);
      setMediaError(
        err?.name === 'NotAllowedError'
          ? 'Camera and microphone access was blocked. Allow access in your browser settings, then try again.'
          : 'Could not access your camera and microphone.',
      );
    }
  }, []);

  useEffect(() => {
    if (!token) return undefined;
    requestMedia();
    return () => {
      // Only stop tracks we still own — once in-call, CallStage's mesh owns
      // them and stops them on its own teardown.
      if (!handedOffRef.current && streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [token, requestMedia]);

  useEffect(() => {
    if (previewVideoRef.current && previewStream) {
      previewVideoRef.current.srcObject = previewStream;
    }
  }, [previewStream, phase]);

  const join = async () => {
    if (joining || !previewStream) return;
    setJoining(true);
    setJoinError(null);
    try {
      const clientId = crypto.randomUUID();
      // Re-join with the stored participant_id + resume_key (refresh
      // survival) — harbor-join returns the SAME row with state preserved,
      // or 404s if we were removed or the key doesn't match.
      const stored = readStoredJoin(token);
      const rejoin = stored?.participantId && stored?.resumeKey;
      const res = await fetch(JOIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          display_name: name.trim(),
          client_id: clientId,
          ...(rejoin
            ? { participant_id: stored.participantId, resume_key: stored.resumeKey }
            : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 404) setJoinError('This link is invalid, or the session has ended.');
        else if (res.status === 409) setJoinError('The session is full (4 participants max).');
        else setJoinError(body.error || 'Could not join the session. Try again.');
        return;
      }
      writeStoredJoin(token, {
        participantId: body.participant_id,
        resumeKey: body.resume_key,
        name: name.trim(),
      });
      handedOffRef.current = true;
      setJoinInfo({
        session: body.session,
        participantId: body.participant_id,
        resumeKey: body.resume_key,
        state: body.state || 'admitted',
        channel: body.channel,
        clientId,
      });
      setPhase('call');
    } catch (err) {
      console.error('Harbor join: request failed:', err);
      setJoinError('Network error — check your connection and try again.');
    } finally {
      setJoining(false);
    }
  };

  // Best-effort left_at stamp; guests can't touch the table directly.
  // resume_key required server-side (a presence-read pid can't grief us).
  const sendLeave = useCallback(() => {
    if (!joinInfo) return;
    const payload = JSON.stringify({
      token,
      action: 'leave',
      participant_id: joinInfo.participantId,
      resume_key: joinInfo.resumeKey,
    });
    // Raw string body: an application/json Blob needs a CORS preflight, which
    // sendBeacon can't do — Chrome returns false with no throw. text/plain is
    // safelisted, and harbor-join parses the body regardless of content type.
    let sent = false;
    try {
      sent = navigator.sendBeacon(JOIN_URL, payload);
    } catch {
      sent = false;
    }
    if (!sent) {
      fetch(JOIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  }, [joinInfo, token]);

  const handleLeave = (reason) => {
    sendLeave();
    setDoneReason(reason || 'left');
    setPhase('done');
  };

  // Lost-admit recovery: while CallStage sits in the lobby it polls this.
  // The harbor-join re-join path is idempotent (same row back, same
  // client_id, left_at already null) and authenticated by resume_key, so
  // it doubles as a state read: if the DB says 'admitted' but the targeted
  // admit signal got lost, the poll flips the guest into the call. Errors
  // return null (no info) — a rotated token 404s here but the signal path
  // still works, so the lobby never tears down on a failed poll.
  const checkAdmission = useCallback(async () => {
    if (!joinInfo?.participantId || !joinInfo?.resumeKey) return null;
    try {
      const res = await fetch(JOIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          display_name: name.trim(),
          client_id: joinInfo.clientId, // SAME id — presence/mesh keying must not drift
          participant_id: joinInfo.participantId,
          resume_key: joinInfo.resumeKey,
        }),
      });
      if (!res.ok) return null;
      const body = await res.json().catch(() => ({}));
      return body.state || null;
    } catch {
      return null; // transient network noise — keep waiting
    }
  }, [joinInfo, token, name]);

  if (!token) {
    return (
      <Shell>
        <h2 style={sectionHeader(2)}>Invalid link</h2>
        <p style={styles.mutedText}>This join link is missing its token. Ask for a fresh link.</p>
      </Shell>
    );
  }

  if (phase === 'call' && joinInfo) {
    return (
      <div style={styles.callPage}>
        <CallStage
          channelName={joinInfo.channel}
          clientId={joinInfo.clientId}
          displayName={name.trim()}
          role="guest"
          session={joinInfo.session}
          participantId={joinInfo.participantId}
          initialParticipantState={joinInfo.state}
          initialStream={previewStream}
          onLeave={handleLeave}
          onPageUnload={sendLeave}
          onCheckAdmission={checkAdmission}
          createRecorderTransport={() =>
            createGuestRecorderTransport({
              token,
              participantId: joinInfo.participantId,
              resumeKey: joinInfo.resumeKey,
            })
          }
        />
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <Shell>
        <h2 style={sectionHeader(2)}>
          {doneReason === 'removed'
            ? 'You were removed from this session'
            : doneReason === 'ended'
              ? 'The session has ended'
              : 'You left the call'}
        </h2>
        <p style={styles.mutedText}>
          {doneReason === 'removed'
            ? 'If your side was being recorded, give this tab a few seconds before closing so the last moments finish saving.'
            : 'Thanks for joining! If your side was being recorded, give this tab a few seconds before closing so the last moments finish saving.'}
        </p>
      </Shell>
    );
  }

  // ── Setup: device preview + display name ─────────────────────
  return (
    <Shell wide>
      <div style={styles.brand}>
        <div style={styles.tileMark}>H</div>
        <span style={styles.brandText}>Harbor · Mayday Studio</span>
      </div>
      <h1 style={styles.heading}>Join the session</h1>

      <div style={styles.previewBox}>
        {previewStream ? (
          <video ref={previewVideoRef} autoPlay playsInline muted style={styles.previewVideo} />
        ) : (
          <div style={styles.previewEmpty}>
            <span style={styles.mutedText}>
              {mediaError || 'Waiting for camera & microphone access…'}
            </span>
            {mediaError && (
              <button type="button" style={button({ variant: 'ghost', size: 'sm' })} onClick={requestMedia}>
                Try again
              </button>
            )}
          </div>
        )}
      </div>
      {previewStream && <p style={styles.okText}>Camera & mic look good — you're mirrored, guests see you normally.</p>}

      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        maxLength={80}
        style={styles.nameInput}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim() && previewStream) join();
        }}
      />
      {joinError && <p style={styles.errorText}>{joinError}</p>}
      <button
        type="button"
        style={button({ size: 'lg', disabled: joining || !name.trim() || !previewStream })}
        disabled={joining || !name.trim() || !previewStream}
        onClick={join}
      >
        {joining ? 'Joining…' : 'Join call'}
      </button>
    </Shell>
  );
}

function Shell({ children, wide = false }) {
  return (
    <div style={styles.page}>
      <div style={{ ...styles.shellPanel, maxWidth: wide ? 520 : 420 }}>{children}</div>
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
    padding: spacing.lg,
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
  shellPanel: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.lg,
    padding: spacing.xxl,
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.xl,
    boxSizing: 'border-box',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tileMark: {
    width: 32,
    height: 32,
    borderRadius: radii.md,
    background: colors.info.bg,
    border: `1px solid ${colors.info.border}`,
    color: colors.info.fg,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.bold,
    flexShrink: 0,
  },
  brandText: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    color: colors.textSubtle,
    letterSpacing: 0.3,
  },
  heading: {
    fontSize: fontSizes.displayLg,
    fontWeight: fontWeights.bold,
    margin: 0,
    letterSpacing: '-0.3px',
  },
  previewBox: {
    position: 'relative',
    width: '100%',
    aspectRatio: '16 / 9',
    background: colors.bgInput,
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  previewVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
    background: colors.bg,
    transform: 'scaleX(-1)',
  },
  previewEmpty: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    textAlign: 'center',
  },
  okText: {
    fontSize: fontSizes.sm,
    color: colors.success.fgSoft,
    margin: 0,
  },
  nameInput: {
    ...input({ size: 'lg' }),
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
};
