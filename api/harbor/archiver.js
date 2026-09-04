// Harbor Phase 4 — NAS archival poller.
//
// Runs INSIDE the api/ Express process on the always-on Mac (the only machine
// that can write ASSETS_ROOT). Opt-in via HARBOR_ARCHIVE_ENABLED=1 so other
// environments running this API never try to archive.
//
// Every tick (default 5 min):
//   1. Candidate sessions: status 'ended', archived_at null, ended_at older
//      than the 6h upload grace (a guest flush may still be running inside it).
//   2. Stragglers (tracks still 'recording'/'uploading' past grace) are
//      finalized 'failed' with chunk_count/bytes reset to what actually
//      landed, then salvage-archived with a -PARTIAL filename (no verify).
//   3. 'complete' tracks run the full pipeline (see trackPipeline.js).
//   4. When every track is terminal ('archived' or 'failed'), leftover
//      session objects are swept from the bucket — EXCEPT objects under a
//      'failed' track's prefix, which stay downloadable in the app for
//      partial recovery/forensics — and the session gets archived_at.
//
// Concurrency: one session at a time, one track at a time (this box also
// serves files), and a module-level lock so overlapping ticks can't
// double-run. Every step is idempotent: temp files are overwritten, storage
// deletes tolerate missing objects, row updates are keyed on current status —
// a failed attempt simply retries on the next tick.
//
// CLI (uses api/.env):
//   node api/harbor/archiver.js --dry-run   read-only plan for current DB state
//   node api/harbor/archiver.js --once      one real tick (requires
//                                           HARBOR_ARCHIVE_ENABLED=1)

const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const {
  probeFfmpeg,
  listChunkObjects,
  listAllObjectsUnder,
  removeObjects,
  archiveTrack,
} = require('./trackPipeline');
const { buildTrackTarget } = require('./naming');

// Keep in sync with ENDED_GRACE_MS in supabase/functions/harbor-track/index.ts
// — harbor-track accepts guest uploads this long after a session ends, so
// archiving earlier could race a live flush.
const ENDED_GRACE_MS = 6 * 60 * 60 * 1000;

const DEFAULT_POLL_MS = 5 * 60 * 1000;
const MIN_POLL_MS = 60 * 1000;

function getConfig() {
  const pollRaw = parseInt(process.env.HARBOR_ARCHIVE_POLL_MS || '', 10);
  return {
    enabled: process.env.HARBOR_ARCHIVE_ENABLED === '1' || process.env.HARBOR_ARCHIVE_ENABLED === 'true',
    assetsRoot: process.env.ASSETS_ROOT || '/Volumes/May Server',
    archiveDir: process.env.HARBOR_ARCHIVE_DIR || 'Harbor',
    pollMs: Number.isFinite(pollRaw) ? Math.max(pollRaw, MIN_POLL_MS) : DEFAULT_POLL_MS,
  };
}

// Same service-client pattern as routes/nas.js.
function getSupabaseServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function log(msg) {
  console.log(`[Harbor] ${msg}`);
}

// ── Status (exposed via GET /api/harbor/archive-status) ─────────
let tickInFlight = false;
let ffmpegOk = null; // probed once on first use
let lastTick = null; // { at, durationMs, dryRun, sessions, archived, failed, swept, errors }

function getArchiverStatus() {
  const cfg = getConfig();
  return {
    enabled: cfg.enabled,
    assetsRoot: cfg.assetsRoot,
    archiveDir: cfg.archiveDir,
    pollMs: cfg.pollMs,
    ffmpegAvailable: ffmpegOk,
    tickInFlight,
    lastTick,
  };
}

// ── One session ──────────────────────────────────────────────────
async function processSession(sb, cfg, session, summary) {
  const { data: tracks, error: tracksErr } = await sb
    .from('harbor_tracks')
    .select(
      'id, session_id, participant_id, kind, status, chunk_count, bytes_uploaded, mime_type, storage_prefix, nas_path, harbor_participants(display_name)',
    )
    .eq('session_id', session.id)
    .order('created_at', { ascending: true });
  if (tracksErr) throw new Error(`load tracks failed: ${tracksErr.message}`);

  // A show session files under its show's folder, so resolve it once here
  // rather than per track.
  let show = null;
  if (session.show_id) {
    const { data, error } = await sb
      .from('harbor_shows')
      .select('id, title')
      .eq('id', session.show_id)
      .maybeSingle();
    if (error) log(`WARN show lookup failed for session ${session.id}: ${error.message}`);
    show = data || null;
  }

  const terminal = new Set(['archived', 'failed']);
  let sessionHadErrors = false;

  for (const track of tracks || []) {
    const participantName = track.harbor_participants?.display_name || 'participant';
    try {
      if (track.status === 'recording' || track.status === 'uploading') {
        // ── Straggler: finalize failed, then salvage what landed ──
        if (!track.storage_prefix) {
          // No prefix means no chunks could ever have landed.
          await sb
            .from('harbor_tracks')
            .update({ status: 'failed', completed_at: new Date().toISOString() })
            .eq('id', track.id)
            .in('status', ['recording', 'uploading']);
          track.status = 'failed';
          continue;
        }
        const chunks = await listChunkObjects(sb, track.storage_prefix);
        const listedBytes = chunks.reduce((s, c) => s + c.size, 0);
        const { data: finalized, error: finalizeErr } = await sb
          .from('harbor_tracks')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            chunk_count: chunks.length, // truth from the bucket, not the last progress ping
            bytes_uploaded: listedBytes,
          })
          .eq('id', track.id)
          .in('status', ['recording', 'uploading'])
          .select('id');
        if (finalizeErr) throw new Error(`straggler finalize failed: ${finalizeErr.message}`);
        if (!finalized || finalized.length === 0) {
          // The client finalized it in the window between our read and write —
          // let the next tick see the fresh state.
          log(`track ${track.id}: state changed during straggler finalize — deferring to next tick`);
          sessionHadErrors = true;
          continue;
        }
        track.status = 'failed';
        log(
          `track ${track.id} (${participantName}/${track.kind}): straggler past grace — ` +
            `finalized failed with ${chunks.length} landed chunks (${listedBytes}B); salvaging -PARTIAL`,
        );
        const result = await archiveTrack({
          sb,
          assetsRoot: cfg.assetsRoot,
          archiveDir: cfg.archiveDir,
          session,
          show,
          track,
          participantName,
          fromStatus: 'failed',
          partial: true,
          ffmpegOk,
          log,
        });
        if (result.outcome === 'archived') {
          track.status = 'archived';
          summary.archived += 1;
          log(`track ${track.id}: PARTIAL archived via ${result.method} → ${result.relPath}`);
        } else {
          // 'empty' (nothing landed) stays 'failed' — terminal; chunks (none) kept.
          summary.failed += 1;
        }
      } else if (track.status === 'complete') {
        const result = await archiveTrack({
          sb,
          assetsRoot: cfg.assetsRoot,
          archiveDir: cfg.archiveDir,
          session,
          show,
          track,
          participantName,
          fromStatus: 'complete',
          partial: false,
          ffmpegOk,
          log,
        });
        track.status = result.outcome === 'archived' ? 'archived' : 'failed';
        if (result.outcome === 'archived') {
          summary.archived += 1;
          log(
            `track ${track.id} (${participantName}/${track.kind}): archived via ${result.method} → ` +
              `${result.relPath} (${result.chunkCount} chunks, ${result.finalBytes}B)`,
          );
        } else {
          summary.failed += 1;
        }
      }
      // 'failed' rows (client-finalized) are left alone: their chunks stay in
      // the bucket, downloadable from the app for partial recovery.
    } catch (err) {
      // One bad track never blocks the session's others; a non-terminal row
      // retries naturally next tick.
      sessionHadErrors = true;
      summary.errors.push(`track ${track.id}: ${err.message}`);
      log(`ERROR track ${track.id} (${session.title}): ${err.message}`);
    }
  }

  const allTerminal = (tracks || []).every((t) => terminal.has(t.status));
  if (!allTerminal || sessionHadErrors) return; // not done — next tick continues

  // ── Sweep leftovers + stamp the session ────────────────────────
  // Failed tracks keep their chunks (partial recovery in the app) — protect
  // their prefixes from the sweep.
  const protectedPrefixes = (tracks || [])
    .filter((t) => t.status === 'failed' && t.storage_prefix)
    .map((t) => `${t.storage_prefix}/`);
  const leftovers = await listAllObjectsUnder(sb, session.id);
  const toSweep = leftovers.filter((obj) => !protectedPrefixes.some((p) => obj.startsWith(p)));
  if (toSweep.length > 0) {
    await removeObjects(sb, toSweep, log);
  }

  const { error: stampErr } = await sb
    .from('harbor_sessions')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', session.id)
    .is('archived_at', null);
  if (stampErr) throw new Error(`session stamp failed: ${stampErr.message}`);

  summary.sessions += 1;
  summary.swept += toSweep.length;
  log(
    `session "${session.title}" (${session.id}) archived: ` +
      `${(tracks || []).filter((t) => t.status === 'archived').length} archived, ` +
      `${(tracks || []).filter((t) => t.status === 'failed').length} failed, ` +
      `${toSweep.length} leftover objects swept` +
      (protectedPrefixes.length ? `, ${protectedPrefixes.length} failed-track prefixes preserved` : ''),
  );
}

// ── One tick ─────────────────────────────────────────────────────
async function runArchiveTick() {
  if (tickInFlight) {
    log('tick skipped — previous tick still running');
    return null;
  }
  tickInFlight = true;
  const startedAt = Date.now();
  const summary = { sessions: 0, archived: 0, failed: 0, swept: 0, renditions: null, errors: [] };
  try {
    const cfg = getConfig();
    const sb = getSupabaseServiceClient();
    if (!sb) {
      log('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — tick aborted');
      return null;
    }
    if (ffmpegOk === null) {
      ffmpegOk = probeFfmpeg();
      log(`ffmpeg ${ffmpegOk ? 'found on PATH — remuxing with -c copy' : 'NOT found — raw concat only'}`);
    }

    const cutoff = new Date(Date.now() - ENDED_GRACE_MS).toISOString();
    const { data: sessions, error: sessionsErr } = await sb
      .from('harbor_sessions')
      .select('id, title, status, mode, show_id, ended_at, created_at, archived_at')
      .eq('status', 'ended')
      .is('archived_at', null)
      .not('ended_at', 'is', null)
      .lt('ended_at', cutoff)
      .order('ended_at', { ascending: true });
    if (sessionsErr) throw new Error(`candidate query failed: ${sessionsErr.message}`);

    for (const session of sessions || []) {
      try {
        await processSession(sb, cfg, session, summary);
      } catch (err) {
        summary.errors.push(`session ${session.id}: ${err.message}`);
        log(`ERROR session ${session.id} ("${session.title}"): ${err.message}`);
      }
    }

    // Download ladder. Runs after archiving so a long encode never delays
    // getting recordings off the capture buffer, and only a couple per tick
    // because this Mac also serves the app.
    try {
      const rend = await processPendingRenditions({
        sb,
        assetsRoot: cfg.assetsRoot,
        limit: 2,
        log,
      });
      summary.renditions = rend;
    } catch (err) {
      summary.errors.push(`renditions: ${err.message}`);
      log(`ERROR rendition pass: ${err.message}`);
    }

    return summary;
  } finally {
    lastTick = {
      at: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      ...summary,
    };
    tickInFlight = false;
  }
}

// ── Poller entry (called from api/server.js) ─────────────────────
function startHarborArchiver() {
  const cfg = getConfig();
  if (!cfg.enabled) {
    log('archiver disabled (set HARBOR_ARCHIVE_ENABLED=1 on the always-on Mac to enable)');
    return false;
  }
  if (!getSupabaseServiceClient()) {
    log('archiver enabled but SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — not starting');
    return false;
  }
  log(
    `archiver started: root=${cfg.assetsRoot} dir=${cfg.archiveDir} ` +
      `poll=${Math.round(cfg.pollMs / 1000)}s grace=${ENDED_GRACE_MS / 3600000}h`,
  );
  // First tick shortly after boot, then steady polling.
  setTimeout(() => runArchiveTick().catch((err) => log(`ERROR tick: ${err.message}`)), 15 * 1000);
  setInterval(() => runArchiveTick().catch((err) => log(`ERROR tick: ${err.message}`)), cfg.pollMs);
  return true;
}

// ── Dry run: read-only plan for current DB state ─────────────────
async function dryRun() {
  const cfg = getConfig();
  const sb = getSupabaseServiceClient();
  if (!sb) {
    console.log('Dry run needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (api/.env).');
    process.exitCode = 1;
    return;
  }
  const ff = probeFfmpeg();
  console.log('── Harbor archiver dry run ──────────────────────────');
  console.log(`  enabled=${cfg.enabled}  root=${cfg.assetsRoot}  dir=${cfg.archiveDir}`);
  console.log(`  poll=${Math.round(cfg.pollMs / 1000)}s  grace=${ENDED_GRACE_MS / 3600000}h  ffmpeg=${ff ? 'yes (remux -c copy)' : 'no (raw concat)'}`);

  const { data: sessions, error } = await sb
    .from('harbor_sessions')
    .select('id, title, status, mode, show_id, ended_at, created_at, archived_at')
    .eq('status', 'ended')
    .is('archived_at', null)
    .order('ended_at', { ascending: true });
  if (error) throw new Error(`session query failed: ${error.message}`);

  if (!sessions || sessions.length === 0) {
    console.log('  No ended, unarchived sessions. Nothing to do.');
    return;
  }

  for (const session of sessions) {
    const endedMs = session.ended_at ? new Date(session.ended_at).getTime() : null;
    const graceLeft = endedMs === null ? null : endedMs + ENDED_GRACE_MS - Date.now();
    const eligible = endedMs !== null && graceLeft <= 0;
    console.log(`\nSession "${session.title}" (${session.id})`);
    console.log(`  ended_at=${session.ended_at || 'NULL (never eligible — needs a manual ended_at)'}`);
    console.log(
      `  ${eligible ? 'ELIGIBLE this tick' : `waiting — grace ends ${new Date(endedMs + ENDED_GRACE_MS).toISOString()} (${Math.ceil(graceLeft / 60000)} min)`}`,
    );

    const { data: tracks, error: tErr } = await sb
      .from('harbor_tracks')
      .select('id, kind, status, chunk_count, bytes_uploaded, mime_type, storage_prefix, nas_path, harbor_participants(display_name)')
      .eq('session_id', session.id)
      .order('created_at', { ascending: true });
    if (tErr) throw new Error(`track query failed: ${tErr.message}`);

    const failedPrefixes = [];
    for (const track of tracks || []) {
      const name = track.harbor_participants?.display_name || 'participant';
      const straggler = track.status === 'recording' || track.status === 'uploading';
      const chunks = track.storage_prefix ? await listChunkObjects(sb, track.storage_prefix) : [];
      const listedBytes = chunks.reduce((s, c) => s + c.size, 0);
      const line = `  track ${track.id.slice(0, 8)} ${name}/${track.kind} status=${track.status} ` +
        `chunks(db=${track.chunk_count}, listed=${chunks.length}) bytes(db=${track.bytes_uploaded}, listed=${listedBytes})`;
      if (track.status === 'complete' || straggler) {
        const target = buildTrackTarget({
          assetsRoot: cfg.assetsRoot,
          archiveDir: cfg.archiveDir,
          session,
          track,
          participantName: name,
          partial: straggler,
        });
        const contiguous = chunks.every((c, i) => c.index === i);
        console.log(line);
        console.log(
          `    → ${straggler ? 'finalize failed + salvage -PARTIAL (no verify)' : `archive (verify: contiguous=${contiguous}, need >= ${Math.round((Number(track.bytes_uploaded) || listedBytes) * 0.95)}B)`}`,
        );
        console.log(`    → ${target.absPath}`);
        console.log(`    → then purge ${chunks.length} chunk objects; nas_path="${target.relPath}"`);
      } else if (track.status === 'failed') {
        failedPrefixes.push(`${track.storage_prefix}/`);
        console.log(line);
        console.log('    → left alone (failed): chunks preserved for in-app partial download');
      } else {
        console.log(line);
        console.log(`    → already ${track.status}`);
      }
    }

    const leftovers = await listAllObjectsUnder(sb, session.id);
    const trackPrefixes = (tracks || []).filter((t) => t.storage_prefix).map((t) => `${t.storage_prefix}/`);
    const orphanObjects = leftovers.filter((o) => !trackPrefixes.some((p) => o.startsWith(p)));
    const protectedCount = leftovers.filter((o) => failedPrefixes.some((p) => o.startsWith(p))).length;
    console.log(
      `  sweep plan: ${leftovers.length} objects under session prefix; ` +
        `${orphanObjects.length} orphaned (no track row) would be swept; ` +
        `${protectedCount} under failed tracks would be preserved`,
    );
    if (orphanObjects.length > 0) {
      for (const o of orphanObjects.slice(0, 10)) console.log(`    orphan: ${o}`);
    }
  }
  console.log('\nDry run complete — no rows updated, no objects written or deleted.');
}

module.exports = { startHarborArchiver, runArchiveTick, getArchiverStatus, ENDED_GRACE_MS };

// ── CLI ──────────────────────────────────────────────────────────
if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const args = process.argv.slice(2);
  if (args.includes('--once')) {
    if (!getConfig().enabled) {
      console.log('Refusing a real tick: set HARBOR_ARCHIVE_ENABLED=1 first (or use --dry-run).');
      process.exitCode = 1;
    } else {
      runArchiveTick()
        .then((s) => console.log(`[Harbor] tick done: ${JSON.stringify(s)}`))
        .catch((err) => {
          console.error('[Harbor] tick failed:', err.message);
          process.exitCode = 1;
        });
    }
  } else {
    // Default is the safe path.
    dryRun().catch((err) => {
      console.error('[Harbor] dry run failed:', err.message);
      process.exitCode = 1;
    });
  }
}
