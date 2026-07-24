// Harbor signaling — a thin wrapper over Supabase Realtime broadcast channels.
//
// One non-private broadcast channel per session carries all WebRTC signaling
// ({offer|answer|ice}) plus room chatter ({hello|leave|state}), and Realtime
// presence tracks who's in the room. Guests connect with the app's public
// anon key (no login, no DB reads); staff ride their normal session.
//
// Channel naming: `harbor:<session_id>:<secret>` where secret = first 16 hex
// chars of sha256(guest_token). A session id alone is NOT enough to find the
// channel — you need the token (guests get the full name from harbor-join;
// staff derive it because RLS lets them read guest_token). Mirrors
// channelSecret() in supabase/functions/harbor-join/index.ts.

import { supabase } from '../../supabaseClient';

export async function deriveHarborChannel(sessionId, guestToken) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(guestToken));
  const secret = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
  return `harbor:${sessionId}:${secret}`;
}

function parsePresence(state, selfId) {
  const others = [];
  for (const [key, metas] of Object.entries(state || {})) {
    if (key === selfId) continue;
    const m = (metas && metas[0]) || {};
    others.push({ clientId: key, name: m.name || 'Guest', role: m.role || 'guest' });
  }
  return others;
}

/**
 * Join a session's signaling channel.
 *
 * Message envelope (broadcast event 'signal'):
 *   { type: 'offer'|'answer'|'ice'|'hello'|'leave'|'state',
 *     from: clientId, to: clientId|null, ...typeSpecificFields }
 * `to` targets one peer (offer/answer/ice); null fan-outs to the room
 * (hello/leave/state). Filtering is client-side — everyone on the channel
 * receives everything, receivers drop what isn't addressed to them.
 *
 * @param {object} opts
 * @param {string} opts.channelName   from deriveHarborChannel / harbor-join
 * @param {string} opts.clientId      this tab's id (presence key)
 * @param {object} [opts.meta]        presence payload: { name, role }
 * @param {(payload: object) => void} opts.onSignal    addressed messages
 * @param {(others: Array<{clientId,name,role}>) => void} [opts.onPresence]
 *        full remote roster on every presence sync
 * @param {(status: string) => void} [opts.onStatus]   channel status changes
 * @returns {{ send: (type, extra?, to?) => void, leave: () => void }}
 */
export function joinSignalingChannel({
  channelName,
  clientId,
  meta = {},
  onSignal,
  onPresence,
  onStatus,
}) {
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
        await channel.track({ ...meta, client_id: clientId });
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
