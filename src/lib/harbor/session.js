// Harbor session helpers — guest-link building & rotation (staff side).
//
// guest_token is the tokenized join-link credential. Rotation regenerates it
// under staff RLS: old links 404 in harbor-join immediately, while the live
// signaling channel — named from the separate harbor_sessions.channel_secret
// (see signaling.js) — and every connected peer stay untouched. Only future
// joins are affected.
//
// Entropy: 32 random bytes → 64 hex chars (256 bits), matching the format
// and exceeding the ~244 bits of the DB column default (two v4 UUIDs).

import { supabase } from '../../supabaseClient';

export function generateGuestToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function guestJoinLink(token) {
  return `${window.location.origin}/harbor/join/${token}`;
}

/** Regenerate a session's guest link under staff RLS. Returns the new token. */
export async function rotateGuestToken(sessionId) {
  const token = generateGuestToken();
  const { error } = await supabase
    .from('harbor_sessions')
    .update({ guest_token: token })
    .eq('id', sessionId);
  if (error) throw error;
  return token;
}
