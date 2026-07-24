// Harbor signaling — a thin wrapper over Supabase Realtime broadcast channels.
//
// One non-private broadcast channel per session carries all WebRTC signaling
// ({offer|answer|ice}), room chatter ({hello|leave|state}), recording
// commands ({record|record-state}, Phase 2), and moderation signals
// ({admit|mute|request-unmute|remove}, Phase 3). Realtime presence tracks
// who's in the room with meta { name, role, state, participant_id }. Guests
// connect with the app's public anon key (no login, no DB reads); staff ride
// their normal session.
//
// Channel naming: `harbor:<session_id>:<secret>` where secret = the first 16
// hex chars of harbor_sessions.channel_secret. A session id alone is NOT
// enough to find the channel — you need the secret (guests get the full name
// from harbor-join; staff read channel_secret under RLS). channel_secret is
// deliberately a SEPARATE column from guest_token: rotating the guest link
// must never move the live channel. Mirrors channelName() in
// supabase/functions/harbor-join/index.ts — keep in sync.

import { supabase } from '../../supabaseClient';

const CHANNEL_SECRET_CHARS = 16;

export function harborChannelName(sessionId, channelSecret) {
  return `harbor:${sessionId}:${(channelSecret || '').slice(0, CHANNEL_SECRET_CHARS)}`;
}

function parsePresence(state, selfId) {
  const others = [];
  for (const [key, metas] of Object.entries(state || {})) {
    if (key === selfId) continue;
    const m = (metas && metas[0]) || {};
    others.push({
      clientId: key,
      name: m.name || 'Guest',
      role: m.role || 'guest',
      // Peers that predate the green room never broadcast state — treat them
      // as admitted so the mesh still forms.
      state: m.state || 'admitted',
      participantId: m.participant_id || null,
    });
  }
  return others;
}

/**
 * Join a session's signaling channel.
 *
 * Message envelope (broadcast event 'signal'):
 *   { type: 'offer'|'answer'|'ice'|'hello'|'leave'|'state'
 *          |'record'|'record-state'
 *          |'admit'|'mute'|'request-unmute'|'remove',
 *     from: clientId, to: clientId|null, ...typeSpecificFields }
 * `to` targets one peer; null fan-outs to the room. Filtering is client-side —
 * everyone on the channel receives everything, receivers drop what isn't
 * addressed to them. Channel membership (the channel secret) is the trust
 * boundary; producer-only commands are additionally checked against the
 * sender's presence-verified role on the receiving side.
 *
 * @param {object} opts
 * @param {string} opts.channelName   from harborChannelName / harbor-join
 * @param {string} opts.clientId      this tab's id (presence key)
 * @param {object} [opts.meta]        presence payload: { name, role, state, participant_id }
 * @param {(payload: object) => void} opts.onSignal    addressed messages
 * @param {(others: Array<{clientId,name,role,state,participantId}>) => void} [opts.onPresence]
 *        full remote roster on every presence sync
 * @param {(status: string) => void} [opts.onStatus]   channel status changes
 * @returns {{ send: (type, extra?, to?) => void,
 *             updatePresence: (patch: object) => void,
 *             leave: () => void }}
 */
export function joinSignalingChannel({
  channelName,
  clientId,
  meta = {},
  onSignal,
  onPresence,
  onStatus,
}) {
  let currentMeta = { ...meta };

  const channel = supabase.channel(channelName, {
    config: {
      broadcast: { self: false },
      presence: { key: clientId },
    },
  });

  channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
    if (!payload || payload.from === clientId) return;
    if (payload.to && payload.to !== clientId) return;
    onSignal?.(payload);
  });

  channel.on('presence', { event: 'sync' }, () => {
    onPresence?.(parsePresence(channel.presenceState(), clientId));
  });

  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      try {
        await channel.track({ ...currentMeta, client_id: clientId });
      } catch (err) {
        console.warn('harbor signaling: presence track failed', err);
      }
    }
    onStatus?.(status);
  });

  return {
    send(type, extra = {}, to = null) {
      try {
        channel.send({
          type: 'broadcast',
          event: 'signal',
          payload: { ...extra, type, from: clientId, to },
        });
      } catch (err) {
        console.warn('harbor signaling: send failed', err);
      }
    },
    /** Re-track presence with updated meta (e.g. state lobby → admitted).
     *  The merged meta also survives reconnect re-tracks. */
    updatePresence(patch) {
      currentMeta = { ...currentMeta, ...patch };
      try {
        const p = channel.track({ ...currentMeta, client_id: clientId });
        if (p && typeof p.catch === 'function') {
          p.catch((err) => console.warn('harbor signaling: presence update failed', err));
        }
      } catch (err) {
        console.warn('harbor signaling: presence update failed', err);
      }
    },
    leave() {
      try {
        channel.untrack();
      } catch {
        /* socket may already be gone */
      }
      supabase.removeChannel(channel);
    },
  };
}
