// Harbor renditions — the 720p / 1080p / High Quality downloads.
//
// The master is whatever the camera actually gave us, archived as-is by
// trackPipeline.js. Renditions are H.264/AAC mp4 transcodes made from that
// master on the always-on Mac.
//
// Two rules:
//
//   1. NEVER UPSCALE. A rendition taller than the master is not created at
//      all — its row is dropped rather than left pending forever. A 720p
//      capture offers exactly one download, and that is the honest answer.
//   2. Transcoding is slow and must never block archiving. Rendition rows are
//      written as 'pending' when a track archives; this module drains that
//      queue one file at a time on later ticks, so a 30-minute encode can't
//      hold the archiver's lock.

const fsp = require('fs/promises');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { buildRenditionTarget } = require('./naming');

// Ladder, tallest first. 'master' is the archived original and is recorded as
// a rendition row for free so the UI has one uniform list to render.
const LADDER = [
  { quality: '1080p', height: 1080 },
  { quality: '720p', height: 720 },
];

// A 30-minute 1080p encode runs several minutes at preset veryfast. Well past
// that means something is wrong; kill it and let the next tick retry.
const ENCODE_TIMEOUT_MS = 45 * 60 * 1000;
const PROBE_TIMEOUT_MS = 30 * 1000;

function ffprobeDimensions(absPath) {
  try {
    const out = spawnSync(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
       '-of', 'csv=p=0:s=x', absPath],
      { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS },
    );
    if (out.status !== 0) return null;
    const [w, h] = String(out.stdout).trim().split('x').map((n) => parseInt(n, 10));
    if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
    return { width: w, height: h };
  } catch {
    return null;
  }
}

/**
 * Queue rendition rows for a freshly archived track.
 *
 * Called from trackPipeline after a successful verify. Audio tracks get a
 * master row only — there is nothing to scale. Video tracks get a master row
 * plus every ladder rung strictly shorter than the source.
 */
async function queueRenditions({ sb, track, relPath, absPath, log = () => {} }) {
  const rows = [{ track_id: track.id, quality: 'master', nas_path: relPath, status: 'ready' }];

  if (track.kind === 'video') {
    const dims = ffprobeDimensions(absPath);
    if (!dims) {
      log(`WARN track ${track.id}: could not probe dimensions — master only`);
    } else {
      rows[0].width = dims.width;
      rows[0].height = dims.height;
      for (const rung of LADDER) {
        // Strictly shorter: a 1080p master doesn't get a pointless 1080p copy.
        if (dims.height > rung.height) {
          rows.push({ track_id: track.id, quality: rung.quality, status: 'pending' });
        }
      }
      log(
        `track ${track.id}: ${dims.width}x${dims.height} master, ` +
          `${rows.length - 1} rendition(s) queued`,
      );
    }
  }

  try {
    const bytes = (await fsp.stat(absPath)).size;
    rows[0].bytes = bytes;
  } catch {
    /* stat is a nicety, not a requirement */
  }

  const { error } = await sb
    .from('harbor_track_renditions')
    .upsert(rows, { onConflict: 'track_id,quality' });
  if (error) log(`WARN track ${track.id}: could not queue renditions: ${error.message}`);
}

function encode(srcAbs, dstAbs, height) {
  return new Promise((resolve) => {
    const proc = spawn(
      'ffmpeg',
      [
        '-y', '-v', 'error',
        '-i', srcAbs,
        // -2 keeps width even (H.264 requires it) while preserving aspect.
        '-vf', `scale=-2:${height}`,
        '-c:v', 'libx264',
        '-preset', 'veryfast', // this box also serves the app; don't hog it
        '-crf', '21',
        '-pix_fmt', 'yuv420p', // QuickTime/Premiere compatibility
        '-movflags', '+faststart',
        '-c:a', 'aac', '-b:a', '160k',
        dstAbs,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, ENCODE_TIMEOUT_MS);
    proc.stderr.on('data', (d) => {
      if (stderr.length < 8192) stderr += d;
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return resolve({ ok: false, error: `timed out after ${ENCODE_TIMEOUT_MS}ms` });
      resolve(code === 0 ? { ok: true } : { ok: false, error: stderr.slice(0, 400) || `exit ${code}` });
    });
  });
}

/**
 * Encode up to `limit` pending renditions. Returns a summary for the tick log.
 *
 * One at a time on purpose: these run on the same Mac that serves the app and
 * Post-Show, and a parallel encode farm would make both crawl.
 */
async function processPendingRenditions({ sb, assetsRoot, limit = 2, log = () => {} }) {
  const summary = { encoded: 0, failed: 0, skipped: 0 };

  const { data: pending, error } = await sb
    .from('harbor_track_renditions')
    .select('id, track_id, quality, status')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) {
    log(`WARN could not list pending renditions: ${error.message}`);
    return summary;
  }
  if (!pending?.length) return summary;

  for (const rend of pending) {
    // Master path comes from the track, which is the only source of truth for
    // where the file actually landed.
    const { data: track, error: tErr } = await sb
      .from('harbor_tracks')
      .select('id, nas_path, status')
      .eq('id', rend.track_id)
      .maybeSingle();
    if (tErr || !track?.nas_path) {
      log(`WARN rendition ${rend.id}: master not archived yet — leaving pending`);
      summary.skipped += 1;
      continue;
    }

    const srcAbs = path.resolve(assetsRoot, track.nas_path);
    try {
      await fsp.access(srcAbs);
    } catch {
      await sb.from('harbor_track_renditions')
        .update({ status: 'failed', error: 'master file missing on NAS' })
        .eq('id', rend.id).eq('status', 'pending');
      summary.failed += 1;
      continue;
    }

    const target = buildRenditionTarget({
      masterRelPath: track.nas_path,
      assetsRoot,
      quality: rend.quality,
    });
    const height = LADDER.find((l) => l.quality === rend.quality)?.height;
    if (!height) {
      summary.skipped += 1;
      continue;
    }

    // Claim it so a second process can't pick up the same row.
    const { data: claimed } = await sb
      .from('harbor_track_renditions')
      .update({ status: 'encoding' })
      .eq('id', rend.id)
      .eq('status', 'pending')
      .select('id');
    if (!claimed?.length) {
      summary.skipped += 1;
      continue;
    }

    log(`encoding ${rend.quality}: ${target.relPath}`);
    const tmp = `${target.absPath}.partial`;
    const result = await encode(srcAbs, tmp, height);

    if (!result.ok) {
      await fsp.unlink(tmp).catch(() => {});
      await sb.from('harbor_track_renditions')
        .update({ status: 'failed', error: String(result.error).slice(0, 500) })
        .eq('id', rend.id);
      log(`ERROR rendition ${rend.quality} failed: ${result.error}`);
      summary.failed += 1;
      continue;
    }

    // Only rename onto the real path once the encode succeeded, so a partial
    // file is never mistaken for a finished download.
    await fsp.rename(tmp, target.absPath);
    const bytes = (await fsp.stat(target.absPath)).size;
    const dims = ffprobeDimensions(target.absPath);

    await sb.from('harbor_track_renditions').update({
      status: 'ready',
      nas_path: target.relPath,
      bytes,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
    }).eq('id', rend.id);

    log(`rendition ready: ${target.relPath} (${(bytes / 1048576).toFixed(1)} MB)`);
    summary.encoded += 1;
  }

  return summary;
}

module.exports = { queueRenditions, processPendingRenditions, LADDER };
