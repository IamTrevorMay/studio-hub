// Harbor archiver — target-path construction + name sanitization.
//
// Layout on the NAS (all under ASSETS_ROOT, default '/Volumes/May Server'):
//   <ASSETS_ROOT>/<HARBOR_ARCHIVE_DIR>/<yyyy-mm-dd> <session title>/
//     <participant display_name>-<kind>-<track_id first 8>[-PARTIAL].<ext>
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
 *  supabase/functions/harbor-track/index.ts. Keep in sync. */
function containerExt(mimeType) {
  return (mimeType || '').startsWith('video/mp4') ? 'mp4' : 'webm';
}

/**
 * Build the archive target for one track.
 * @returns {{ relDir, relPath, absDir, absPath, fileName }} — rel* are
 *   relative to assetsRoot (the stored nas_path convention), abs* are on-disk.
 */
function buildTrackTarget({
  assetsRoot,
  archiveDir,
  session, // { title, ended_at, created_at }
  track, // { id, kind, mime_type }
  participantName,
  partial = false,
}) {
  const dateStamp = ptDateStamp(session.ended_at || session.created_at);
  const folder = `${dateStamp} ${sanitizeSegment(session.title, 'session')}`;
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

module.exports = { sanitizeSegment, ptDateStamp, containerExt, buildTrackTarget };
