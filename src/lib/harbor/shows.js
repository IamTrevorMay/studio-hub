// Harbor shows — the reusable-room half of the staff side.
//
// A Show is a room you keep: one permanent guest link handed out once, and a
// new session underneath every time you record. Meetings are the other half —
// one-off sessions with no show and audio-only recording.
//
// Everything here runs under staff RLS (is_harbor_staff).

import { supabase } from '../../supabaseClient';
import { generateGuestToken } from './session';

/** A show's guest link is permanent — same shape as a session's. */
export function showJoinLink(token) {
  return `${window.location.origin}/harbor/join/${token}`;
}

export const SHOW_COLUMNS =
  'id, title, guest_token, max_participants, capture_quality, archived_at, created_at, updated_at';

export const SESSION_COLUMNS =
  'id, title, status, mode, show_id, guest_token, scheduled_at, started_at, ended_at, archived_at, created_at';

export const CAPTURE_QUALITY_LABELS = {
  best: 'High Quality (camera max)',
  '1080p': '1080p',
  '720p': '720p',
};

export async function listShows({ includeArchived = false } = {}) {
  let q = supabase.from('harbor_shows').select(SHOW_COLUMNS).order('created_at', { ascending: false });
  if (!includeArchived) q = q.is('archived_at', null);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getShow(showId) {
  const { data, error } = await supabase
    .from('harbor_shows')
    .select(SHOW_COLUMNS)
    .eq('id', showId)
    .single();
  if (error) throw error;
  return data;
}

export async function createShow({ title, captureQuality = 'best', createdBy = null }) {
  const { data, error } = await supabase
    .from('harbor_shows')
    .insert({
      title: (title || '').trim() || 'Untitled show',
      capture_quality: captureQuality,
      created_by: createdBy,
    })
    .select(SHOW_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

export async function renameShow(showId, title) {
  const { error } = await supabase
    .from('harbor_shows')
    .update({ title: (title || '').trim() || 'Untitled show' })
    .eq('id', showId);
  if (error) throw error;
}

/** Archive rather than delete — the recordings underneath outlive the room. */
export async function archiveShow(showId) {
  const { error } = await supabase
    .from('harbor_shows')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', showId);
  if (error) throw error;
}

export async function rotateShowGuestToken(showId) {
  const token = generateGuestToken();
  const { error } = await supabase
    .from('harbor_shows')
    .update({ guest_token: token })
    .eq('id', showId);
  if (error) throw error;
  return token;
}

/** Every recording made in a show, newest first. */
export async function listShowSessions(showId) {
  const { data, error } = await supabase
    .from('harbor_sessions')
    .select(SESSION_COLUMNS)
    .eq('show_id', showId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * Start a new recording in a show.
 *
 * The session inherits the show's seat cap so the DB's per-mode check and the
 * mesh agree, and copies the show's guest token so a guest who bookmarked the
 * link last week lands in this week's session.
 */
export async function createShowSession(show, { title } = {}) {
  const { data, error } = await supabase
    .from('harbor_sessions')
    .insert({
      title: (title || '').trim() || `${show.title} — ${new Date().toLocaleDateString()}`,
      mode: 'show',
      show_id: show.id,
      max_participants: show.max_participants,
      guest_token: show.guest_token,
    })
    .select(SESSION_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

/** One-off gathering: video call, audio-only recording, up to 6. */
export async function createMeeting({ title, maxParticipants = 6 }) {
  const { data, error } = await supabase
    .from('harbor_sessions')
    .insert({
      title: (title || '').trim() || 'Untitled meeting',
      mode: 'meeting',
      max_participants: Math.min(Math.max(maxParticipants, 2), 6),
    })
    .select(SESSION_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

export async function listMeetings() {
  const { data, error } = await supabase
    .from('harbor_sessions')
    .select(SESSION_COLUMNS)
    .eq('mode', 'meeting')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data || [];
}

/** Legacy standalone sessions — pre-Shows. Kept visible so nothing is lost. */
export async function listLegacySessions() {
  const { data, error } = await supabase
    .from('harbor_sessions')
    .select(SESSION_COLUMNS)
    .eq('mode', 'recording')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data || [];
}

// ── Downloads ──────────────────────────────────────────────────────────

export const QUALITY_LABELS = {
  master: 'High Quality',
  '1080p': '1080p',
  '720p': '720p',
};

// Order the download picker top-down by quality.
const QUALITY_RANK = { master: 0, '1080p': 1, '720p': 2 };

/**
 * Tracks for a session with their renditions attached.
 *
 * Renditions come from a separate table because a transcode can fail or be
 * regenerated independently of the master it came from.
 */
export async function listSessionTracks(sessionId) {
  const { data: tracks, error } = await supabase
    .from('harbor_tracks')
    .select(
      'id, kind, status, bytes_uploaded, duration_ms, nas_path, archived_at, created_at, ' +
        'harbor_participants ( display_name, role )',
    )
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  if (!tracks?.length) return [];

  const { data: rends, error: rErr } = await supabase
    .from('harbor_track_renditions')
    .select('id, track_id, quality, nas_path, bytes, width, height, status, error')
    .in('track_id', tracks.map((t) => t.id));
  if (rErr) throw rErr;

  const byTrack = new Map();
  for (const r of rends || []) {
    if (!byTrack.has(r.track_id)) byTrack.set(r.track_id, []);
    byTrack.get(r.track_id).push(r);
  }

  return tracks.map((t) => ({
    ...t,
    participantName: t.harbor_participants?.display_name || 'Participant',
    renditions: (byTrack.get(t.id) || []).sort(
      (a, b) => (QUALITY_RANK[a.quality] ?? 9) - (QUALITY_RANK[b.quality] ?? 9),
    ),
  }));
}

// The NAS lives behind the Express API on the always-on Mac, so downloads only
// resolve on the studio machine (or over a tunnel to it). Everywhere else the
// UI falls back to showing the path for Finder.
export const NAS_API_BASE = process.env.REACT_APP_NAS_API_URL || 'http://localhost:4400';

export function nasDownloadUrl(relPath) {
  if (!relPath) return null;
  return `${NAS_API_BASE}/api/nas/download?path=${encodeURIComponent(`/${relPath}`)}`;
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export function formatDuration(ms) {
  if (!ms) return null;
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
