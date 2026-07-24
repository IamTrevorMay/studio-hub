import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { getDisplayName } from '../../lib/displayName';
import { deriveHarborChannel } from '../../lib/harbor/signaling';
import CallStage from './CallStage';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamily } from '../../lib/styleTokens';
import { pill, button, sectionHeader } from '../../lib/styleRecipes';

// Staff-side call room at /harbor/room/<session_id>. Loads the session under
// RLS, shows a pre-join screen (so media only starts on an explicit click —
// which also satisfies autoplay-with-audio policies), then registers a
// 'producer' participant row and mounts the shared CallStage. Staff derive
// the signaling channel name from guest_token client-side; guests get the
// same name from the harbor-join edge function.

const STATUS_TONES = { scheduled: 'info', live: 'success', ended: 'danger' };
const STATUS_LABELS = { scheduled: 'Scheduled', live: 'Live', ended: 'Ended' };

export default function HarborRoom({ sessionId, onExit }) {
  const { profile } = useAuth();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [joinError, setJoinError] = useState(null);
  const [joining, setJoining] = useState(false);
  const [callInfo, setCallInfo] = useState(null); // { channelName, clientId, participantId }
  const [copied, setCopied] = useState(false);
  const participantIdRef = useRef(null);

  const fetchSession = useCallback(async () => {
    const { data, error } = await supabase
      .from('harbor_sessions')
      .select('id, title, status, guest_token, scheduled_at, started_at, ended_at')
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
      const channelName = await deriveHarborChannel(session.id, session.guest_token);
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

  const copyGuestLink = async () => {
    if (!session) return;
    const link = `${window.location.origin}/harbor/join/${session.guest_token}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Harbor: clipboard write failed:', err);
      window.prompt('Copy the guest link:', link); // eslint-disable-line no-alert
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
          canControlSession
          onUpdateSessionStatus={updateSessionStatus}
          onLeave={handleLeave}
          onPageUnload={stampLeft}
        />
      </div>
    );
  }

  // Pre-join screen.
  return (
    <div style={styles.page}>
      <div style={styles.panel}>
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
            </div>
          </>
        )}
        <button type="button" style={styles.backBtn} onClick={onExit}>
          &larr; Back to Harbor
        </button>
      </div>
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
};
