#!/usr/bin/env node
// Harbor manual recovery — rebuild a session's tracks from their storage
// chunks WITHOUT running the archiver.
//
// The archiver is the normal path and does this automatically. This is the
// break-glass tool for when it can't: the session never reached 'ended', the
// always-on Mac was down, a track failed verify, or you simply want the files
// in hand before trusting anything to purge them.
//
// The one thing it will not do is delete. The archiver purges chunks after a
// successful verify; this script does the useful half (download → concat →
// remux → verify) and leaves the bucket and every database row untouched, so
// running it is always safe even when the chunks are the only copy.
//
// Output goes to exactly the path the archiver would have chosen, so a later
// archive run overwrites with identical bytes instead of making a duplicate.
//
//   node api/harbor/rescue.js <session_id>
//   node api/harbor/rescue.js <session_id> --track <track_id>   # just one
//
// Requires the same env as the archiver: SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, ASSETS_ROOT. HARBOR_ARCHIVE_ENABLED is NOT
// required — this is manual by definition.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const fsp = require('fs/promises');
const { spawn, spawnSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const { buildTrackTarget } = require('./naming');

const BUCKET = 'harbor-recordings';
const CHUNK_NAME_RE = /^(\d{6})\.(mp4|webm)$/;
const LIST_PAGE_SIZE = 1000;
const VERIFY_MIN_RATIO = 0.95; // same tolerance as trackPipeline.js

function usage(msg) {
  if (msg) console.error(`error: ${msg}\n`);
  console.error('usage: node api/harbor/rescue.js <session_id> [--track <track_id>]');
  process.exit(msg ? 1 : 0);
}

const argv = process.argv.slice(2);
if (!argv.length || argv.includes('--help') || argv.includes('-h')) usage();
const SESSION_ID = argv[0];
const trackFlag = argv.indexOf('--track');
const ONLY_TRACK = trackFlag !== -1 ? argv[trackFlag + 1] : null;
if (trackFlag !== -1 && !ONLY_TRACK) usage('--track needs a track id');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) usage('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from api/.env');

const sb = createClient(SUPABASE_URL, SERVICE_KEY);
const ASSETS_ROOT = process.env.ASSETS_ROOT || '/Volumes/May Server';
const ARCHIVE_DIR = process.env.HARBOR_ARCHIVE_DIR || 'Harbor';

const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;

/** List a track's chunk objects, all pages, sorted by index. */
async function listChunks(prefix) {
  const chunks = [];
  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const { data, error } = await sb.storage
      .from(BUCKET)
      .list(prefix, { limit: LIST_PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`storage list failed for ${prefix}: ${error.message}`);
    for (const item of data || []) {
      const m = CHUNK_NAME_RE.exec(item.name);
      if (!m) continue; // not a chunk object
      chunks.push({
        index: parseInt(m[1], 10),
        size: Number(item.metadata?.size) || 0,
        objectPath: `${prefix}/${item.name}`,
      });
    }
    if (!data || data.length < LIST_PAGE_SIZE) break;
  }
  chunks.sort((a, b) => a.index - b.index);
  return chunks;
}

/** Stream copy, never transcode — same invocation as trackPipeline.js. Gives
 *  the file clean duration/seek metadata so it scrubs properly in Premiere. */
function remux(from, to) {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-y', '-v', 'error', '-i', from, '-c', 'copy', to], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      if (stderr.length < 8192) stderr += d;
    });
    proc.on('error', (err) => {
      console.log(`    ffmpeg spawn failed: ${err.message} — falling back to raw concat`);
      resolve(false);
    });
    proc.on('close', (code) => {
      if (code !== 0) console.log(`    ffmpeg exited ${code}: ${stderr.slice(0, 300)}`);
      resolve(code === 0);
    });
  });
}

(async () => {
  const ffmpegOk = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  console.log(`── Harbor rescue ────────────────────────────────────`);
  console.log(`  root=${ASSETS_ROOT}  dir=${ARCHIVE_DIR}`);
  console.log(`  ffmpeg=${ffmpegOk ? 'yes (remux -c copy)' : 'NO — raw concat'}`);

  const { data: session, error: sErr } = await sb
    .from('harbor_sessions')
    .select('id, title, status, created_at, ended_at')
    .eq('id', SESSION_ID)
    .single();
  if (sErr) throw new Error(`session lookup failed: ${sErr.message}`);

  let q = sb
    .from('harbor_tracks')
    .select('id, participant_id, kind, storage_prefix, status, chunk_count, bytes_uploaded, mime_type, nas_path')
    .eq('session_id', SESSION_ID)
    .order('created_at');
  if (ONLY_TRACK) q = q.eq('id', ONLY_TRACK);
  const { data: tracks, error: tErr } = await q;
  if (tErr) throw new Error(`track lookup failed: ${tErr.message}`);
  if (!tracks.length) throw new Error('no matching tracks for that session');

  const { data: parts } = await sb
    .from('harbor_participants')
    .select('id, display_name')
    .eq('session_id', SESSION_ID);
  const nameOf = new Map((parts || []).map((p) => [p.id, p.display_name]));

  console.log(`  session "${session.title}" (${session.status}) — ${tracks.length} track(s)\n`);

  const results = [];
  for (const track of tracks) {
    const who = nameOf.get(track.participant_id) || 'participant';
    const target = buildTrackTarget({
      assetsRoot: ASSETS_ROOT,
      archiveDir: ARCHIVE_DIR,
      session,
      track,
      participantName: who,
      partial: false,
    });

    console.log(`▶ ${who} (${track.kind}) → ${target.relPath}`);
    if (track.nas_path) console.log(`  note: already archived at ${track.nas_path} — rebuilding anyway`);

    const chunks = await listChunks(track.storage_prefix);
    if (!chunks.length) {
      console.log('  no chunks in storage — skipping\n');
      results.push({ relPath: target.relPath, ok: false, reason: 'no chunks' });
      continue;
    }
    const listedBytes = chunks.reduce((n, c) => n + c.size, 0);
    console.log(`  ${chunks.length} chunks, ${mb(listedBytes)}`);

    await fsp.mkdir(target.absDir, { recursive: true });
    // Write beside the target, never onto it, until the file is whole.
    const tmp = `${target.absPath}.rescue.partial`;
    const fh = await fsp.open(tmp, 'w');
    let done = 0;
    try {
      for (const c of chunks) {
        const { data, error } = await sb.storage.from(BUCKET).download(c.objectPath);
        if (error) throw new Error(`chunk download failed (${c.objectPath}): ${error.message}`);
        await fh.write(Buffer.from(await data.arrayBuffer()));
        if (++done % 50 === 0) process.stdout.write(`  …${done}/${chunks.length}\r`);
      }
    } finally {
      await fh.close().catch(() => {});
    }
    console.log(`  downloaded ${done}/${chunks.length}          `);

    let method = 'concat';
    if (ffmpegOk && (await remux(tmp, target.absPath))) {
      method = 'remux';
      await fsp.unlink(tmp).catch(() => {});
    } else {
      await fsp.rename(tmp, target.absPath);
    }

    const finalBytes = (await fsp.stat(target.absPath)).size;
    const contiguous = chunks.every((c, i) => c.index === i);
    const expected = Number(track.bytes_uploaded) || listedBytes;
    const bigEnough = expected <= 0 || finalBytes >= expected * VERIFY_MIN_RATIO;
    const ok = contiguous && bigEnough;

    console.log(
      `  ${method} → ${mb(finalBytes)} · contiguous=${contiguous} · size ok=${bigEnough} ${ok ? '✅' : '❌'}\n`,
    );
    results.push({ relPath: target.relPath, ok, finalBytes, contiguous, bigEnough });
  }

  console.log('── summary ──────────────────────────────────────────');
  for (const r of results) {
    console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.relPath}${r.finalBytes ? `  ${mb(r.finalBytes)}` : `  (${r.reason})`}`);
  }
  console.log('\nChunks left in Supabase. No database rows changed.');
  console.log('Verify playback, then let the archiver purge — or purge by hand.');

  if (results.some((r) => !r.ok)) process.exitCode = 1;
})().catch((err) => {
  console.error(`rescue failed: ${err.message}`);
  process.exit(1);
});
