// Harbor archiver — target-path construction + name sanitization.
//
// Layout on the NAS (all under ASSETS_ROOT, default '/Volumes/May Server'):
//
//   Show     <ARCHIVE_DIR>/<show title>/<yyyy-mm-dd> <session title>/
//   Meeting  <ARCHIVE_DIR>/Meetings/<yyyy-mm-dd> <session title>/
//   Legacy   <ARCHIVE_DIR>/<yyyy-mm-dd> <session title>/
//
//     <participant display_name>-<kind>-<track_id first 8>[-PARTIAL].<ext>
//     <participant display_name>-<kind>-<track_id first 8>-1080p.<ext>   (rendition)
//
// A show groups its recordings under one folder so a season browses as a
// season. Meetings share a single folder because they are one-offs with no
// series to belong to. Legacy sessions keep the original flat layout so
// nothing already on disk moves.
//
// The date is the session's end date in America/Los_Angeles — a show recorded
// on the evening of the 23rd PT files under the 23rd, not the UTC 24th
// (PT-vs-UTC boundary convention, see src/lib/ptDate.js for the app-side twin).
//
// nas_path values stored on harbor_tracks (and in nas_access_logs) are
// RELATIVE to ASSETS_ROOT — the same convention the /api/nas/* routes use.

const path = require('path');

/**
 * Sanitize one path segment (folder or file-name part). Extends the spirit of
 * routes/nas.js#sanitizePath (which guards traversal on full paths) to
 * user-supplied NAMES: strips path separators and shell-hostile characters,
 * collapses whitespace, trims leading dots (hidden-file guard), caps length.
 * Keeps spaces — these folders are for humans browsing a Finder window.
 */
function sanitizeSegment(name, fallback = 'untitled') {
  const cleaned = String(name || '')
    .replace(/[/\\:*?"<>|]/g, ' ') // path separators + Windows-reserved
    .replace(/[\x00-\x1f\x7f]/g, '') // control chars
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '') // no hidden files / '..'
    .slice(0, 80)
    .trim();
  return cleaned || fallback;
}

/** yyyy-mm-dd for a timestamp, in America/Los_Angeles. */
function ptDateStamp(isoOrDate) {
  const d = isoOrDate ? new Date(isoOrDate) : new Date();
  // en-CA formats as yyyy-mm-dd.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Container extension for a recording mime — mirrors containerExt() in
 *  src/lib/harbor/recorder.js and chunkPath() in
 *  supabase/functions/harbor-track/index.ts. Keep in sync.
 *  Meetings record audio only, so an mp4-family audio recording files as .m4a
 *  rather than .mp4 — Finder and Premiere both treat it more sensibly. */
function containerExt(mimeType) {
  const m = mimeType || '';
  if (m.startsWith('audio/mp4')) return 'm4a';
  if (m.startsWith('audio/')) return 'webm';
  return m.startsWith('video/mp4') ? 'mp4' : 'webm';
}

/** Folder a session's files belong in, relative to the archive dir. */
function sessionFolder({ session, show }) {
  const dateStamp = ptDateStamp(session.ended_at || session.created_at);
  const dated = `${dateStamp} ${sanitizeSegment(session.title, 'session')}`;
  if (session.mode === 'show' && show) {
    return path.join(sanitizeSegment(show.title, 'show'), dated);
  }
  if (session.mode === 'meeting') {
    return path.join('Meetings', dated);
  }
  return dated;
}

/**
 * Build the archive target for one track.
 * @returns {{ relDir, relPath, absDir, absPath, fileName }} — rel* are
 *   relative to assetsRoot (the stored nas_path convention), abs* are on-disk.
 */
function buildTrackTarget({
  assetsRoot,
  archiveDir,
  session, // { title, mode, ended_at, created_at }
  show = null, // { title } when session.mode === 'show'
  track, // { id, kind, mime_type }
  participantName,
  partial = false,
}) {
  const folder = sessionFolder({ session, show });
  const ext = containerExt(track.mime_type);
  const fileName = [
    sanitizeSegment(participantName, 'participant'),
    track.kind,
    String(track.id).slice(0, 8) + (partial ? '-PARTIAL' : ''),
  ].join('-') + `.${ext}`;

  const relDir = path.join(sanitizeSegment(archiveDir, 'Harbor'), folder);
  const relPath = path.join(relDir, fileName);
  const absDir = path.resolve(assetsRoot, relDir);
  const absPath = path.resolve(assetsRoot, relPath);

  // Same belt-and-suspenders traversal guard as routes/nas.js#sanitizePath —
  // sanitizeSegment should make escape impossible, but never trust one layer.
  if (!absPath.startsWith(path.resolve(assetsRoot))) {
    throw new Error(`Path traversal blocked for track ${track.id}: ${absPath}`);
  }

  return { relDir, relPath, absDir, absPath, fileName };
}

/**
 * Path for a derived download. Sits beside its master with a quality suffix,
 * so a folder shows every version of a take together.
 * @returns {{ relPath, absPath, fileName }}
 */
function buildRenditionTarget({ masterRelPath, assetsRoot, quality }) {
  const dir = path.dirname(masterRelPath);
  const ext = path.extname(masterRelPath);
  const base = path.basename(masterRelPath, ext);
  // Renditions are always H.264/AAC in mp4 — a webm master still yields an
  // mp4 download, which is what editors and browsers actually want.
  const fileName = `${base}-${quality}.mp4`;
  const relPath = path.join(dir, fileName);
  const absPath = path.resolve(assetsRoot, relPath);
  if (!absPath.startsWith(path.resolve(assetsRoot))) {
    throw new Error(`Path traversal blocked for rendition: ${absPath}`);
  }
  return { relPath, absPath, fileName };
}

module.exports = {
  sanitizeSegment,
  ptDateStamp,
  containerExt,
  sessionFolder,
  buildTrackTarget,
  buildRenditionTarget,
};
