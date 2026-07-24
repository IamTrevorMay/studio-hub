// Harbor archiver — per-track pipeline: bucket chunks → one file on the NAS.
//
// Sequence (idempotent — safe to re-run after any crash):
//   1. List the track's chunk objects (paginated; the listing is the truth,
//      chunk_count is only a cross-check).
//   2. Stream every chunk, in index order, into <final>.partial (opened 'w',
//      so a leftover partial from a crashed run is simply overwritten).
//   3. Remux with `ffmpeg -c copy` when ffmpeg is on PATH (fixes the messy
//      duration/seek metadata concatenated fragmented containers have in
//      NLEs); otherwise plain-rename — raw concat is still a valid file.
//      Never transcodes.
//   4. Verify (skipped for -PARTIAL straggler salvage): chunk indexes must be
//      contiguous 0..n-1 AND the final size must be >= 95% of the client's
//      bytes_uploaded (remux can shave a little; a big shortfall means
//      missing data). Verify failure keeps the file for forensics, marks the
//      track 'failed', and does NOT purge chunks.
//   5. On success: track → status 'archived' + nas_path + archived_at, THEN
//      purge the chunk objects, then a nas_access_logs 'harbor_archive' row.
//
// Half files never look done: writes go to *.partial and only a successful
// remux/rename produces the final name.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { buildTrackTarget } = require('./naming');

const BUCKET = 'harbor-recordings';
const LIST_PAGE_SIZE = 1000;
const REMOVE_BATCH_SIZE = 200;
const VERIFY_MIN_RATIO = 0.95;
const CHUNK_NAME_RE = /^(\d{6})\.(mp4|webm)$/;

/** Probe once at startup — is ffmpeg on PATH? */
function probeFfmpeg() {
  try {
    return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

/** List a track's chunk objects, all pages, sorted by index.
 *  @returns [{ name, index, size, objectPath }] */
async function listChunkObjects(sb, storagePrefix) {
  const chunks = [];
  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const { data, error } = await sb.storage.from(BUCKET).list(storagePrefix, {
      limit: LIST_PAGE_SIZE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`storage list failed for ${storagePrefix}: ${error.message}`);
    for (const item of data || []) {
      const m = CHUNK_NAME_RE.exec(item.name);
      if (!m) continue; // not a chunk object
      chunks.push({
        name: item.name,
        index: parseInt(m[1], 10),
        size: Number(item.metadata?.size) || 0,
        objectPath: `${storagePrefix}/${item.name}`,
      });
    }
    if (!data || data.length < LIST_PAGE_SIZE) break;
  }
  chunks.sort((a, b) => a.index - b.index);
  return chunks;
}

/** Recursively list every object path under a prefix (for the session sweep).
 *  Storage "folders" come back with id === null. */
async function listAllObjectsUnder(sb, prefix) {
  const out = [];
  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const { data, error } = await sb.storage.from(BUCKET).list(prefix, {
      limit: LIST_PAGE_SIZE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`storage list failed for ${prefix}: ${error.message}`);
    for (const item of data || []) {
      const full = `${prefix}/${item.name}`;
      if (item.id === null || item.id === undefined) {
        out.push(...(await listAllObjectsUnder(sb, full)));
      } else {
        out.push(full);
      }
    }
    if (!data || data.length < LIST_PAGE_SIZE) break;
  }
  return out;
}

/** Delete object paths in batches; tolerates already-gone objects. */
async function removeObjects(sb, objectPaths, log) {
  for (let i = 0; i < objectPaths.length; i += REMOVE_BATCH_SIZE) {
    const batch = objectPaths.slice(i, i + REMOVE_BATCH_SIZE);
    const { error } = await sb.storage.from(BUCKET).remove(batch);
    if (error) {
      // Non-fatal: leftovers get caught by the session sweep on a later tick.
      log(`WARN storage remove batch failed (${batch.length} objects): ${error.message}`);
    }
  }
}

// -c copy is I/O-bound (seconds even for multi-GB files); a hung ffmpeg would
// otherwise hold the tick lock forever and deadlock the whole poller.
const FFMPEG_TIMEOUT_MS = 2 * 60 * 1000;
const FFMPEG_STDERR_CAP = 8 * 1024;

/** ffmpeg -c copy remux; resolves 'remux' or falls back to rename → 'concat'. */
async function remuxOrRename(partialPath, finalPath, ffmpegOk, log) {
  if (ffmpegOk) {
    const ok = await new Promise((resolve) => {
      const proc = spawn(
        'ffmpeg',
        ['-y', '-v', 'error', '-i', partialPath, '-c', 'copy', finalPath],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        log(`WARN ffmpeg remux timed out after ${FFMPEG_TIMEOUT_MS}ms — killing, falling back to raw concat`);
        proc.kill('SIGKILL');
      }, FFMPEG_TIMEOUT_MS);
      proc.stderr.on('data', (d) => {
        if (stderr.length < FFMPEG_STDERR_CAP) stderr += d;
      });
      proc.on('error', (err) => {
        clearTimeout(timer);
        log(`WARN ffmpeg spawn failed: ${err.message}`);
        resolve(false);
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0 && !timedOut) log(`WARN ffmpeg remux exited ${code}: ${stderr.slice(0, 500)}`);
        resolve(code === 0 && !timedOut);
      });
    });
    if (ok) {
      const stat = await fsp.stat(finalPath).catch(() => null);
      if (stat && stat.size > 0) {
        await fsp.unlink(partialPath).catch(() => {});
        return 'remux';
      }
      log('WARN ffmpeg produced an empty/missing file — falling back to raw concat');
    }
    // Remux failed — clear any half-written ffmpeg output before the rename.
    await fsp.unlink(finalPath).catch(() => {});
  }
  await fsp.rename(partialPath, finalPath);
  return 'concat';
}

/**
 * Archive one track. Never throws for per-track data problems — returns an
 * outcome object; only infrastructure errors (network, DB) propagate so the
 * caller's try/catch can retry on a later tick.
 *
 * @param {object} p
 * @param {object} p.sb            service-role supabase client
 * @param {string} p.fromStatus    row status this run expects ('complete', or
 *                                 'failed' for a just-finalized straggler) —
 *                                 all updates are keyed on it
 * @param {boolean} p.partial      straggler salvage: -PARTIAL name, no verify
 * @returns {{ outcome: 'archived'|'failed-verify'|'empty', relPath?, method?,
 *             chunkCount, listedBytes, finalBytes? }}
 */
async function archiveTrack({
  sb,
  assetsRoot,
  archiveDir,
  session,
  track,
  participantName,
  fromStatus,
  partial = false,
  ffmpegOk = false,
  log = () => {},
}) {
  const chunks = await listChunkObjects(sb, track.storage_prefix);
  const listedBytes = chunks.reduce((sum, c) => sum + c.size, 0);

  if (chunks.length === 0) {
    if (partial) {
      // Straggler with nothing landed — nothing to salvage; row stays 'failed'.
      log(`track ${track.id}: straggler has no chunks in storage — nothing to archive`);
      return { outcome: 'empty', chunkCount: 0, listedBytes: 0 };
    }
    // A 'complete' track with zero objects is data loss — same treatment as a
    // verify shortfall, minus the file (there is nothing to write).
    log(`ERROR track ${track.id}: status complete but no chunks in storage — marking failed`);
    await sb
      .from('harbor_tracks')
      .update({ status: 'failed' })
      .eq('id', track.id)
      .eq('status', fromStatus);
    return { outcome: 'failed-verify', chunkCount: 0, listedBytes: 0 };
  }

  const target = buildTrackTarget({ assetsRoot, archiveDir, session, track, participantName, partial });
  const partialPath = `${target.absPath}.partial`;

  // ── Download → temp file ─────────────────────────────────────
  await fsp.mkdir(target.absDir, { recursive: true });
  const fh = await fsp.open(partialPath, 'w'); // overwrite: idempotent retries
  try {
    for (const chunk of chunks) {
      const { data, error } = await sb.storage.from(BUCKET).download(chunk.objectPath);
      if (error) throw new Error(`chunk download failed (${chunk.objectPath}): ${error.message}`);
      await fh.write(Buffer.from(await data.arrayBuffer()));
    }
  } finally {
    await fh.close().catch(() => {});
  }

  // ── Remux (or raw concat) ────────────────────────────────────
  const method = await remuxOrRename(partialPath, target.absPath, ffmpegOk, log);
  const finalBytes = (await fsp.stat(target.absPath)).size;

  // ── Verify (skipped for straggler salvage) ───────────────────
  if (!partial) {
    const contiguous = chunks.every((c, i) => c.index === i);
    const expected = Number(track.bytes_uploaded) || listedBytes;
    const bigEnough = expected <= 0 || finalBytes >= expected * VERIFY_MIN_RATIO;
    if (!contiguous || !bigEnough) {
      log(
        `ERROR track ${track.id}: verify failed (contiguous=${contiguous}, ` +
          `final=${finalBytes}B, expected>=${Math.round(expected * VERIFY_MIN_RATIO)}B) — ` +
          `marking failed; file kept at ${target.relPath}; chunks NOT purged`,
      );
      await sb
        .from('harbor_tracks')
        .update({ status: 'failed', nas_path: target.relPath })
        .eq('id', track.id)
        .eq('status', fromStatus);
      return { outcome: 'failed-verify', relPath: target.relPath, method, chunkCount: chunks.length, listedBytes, finalBytes };
    }
  }

  // ── Success: flip the row, THEN purge chunks ─────────────────
  const { data: updated, error: updateErr } = await sb
    .from('harbor_tracks')
    .update({
      status: 'archived',
      nas_path: target.relPath,
      archived_at: new Date().toISOString(),
    })
    .eq('id', track.id)
    .eq('status', fromStatus)
    .select('id');
  if (updateErr) throw new Error(`track ${track.id} archive update failed: ${updateErr.message}`);
  if (!updated || updated.length === 0) {
    // Status moved under us (shouldn't happen post-grace) — don't purge.
    log(`WARN track ${track.id}: status was no longer '${fromStatus}' at archive time — chunks NOT purged`);
    return { outcome: 'archived', relPath: target.relPath, method, chunkCount: chunks.length, listedBytes, finalBytes };
  }

  await removeObjects(sb, chunks.map((c) => c.objectPath), log);

  const { error: logErr } = await sb.from('nas_access_logs').insert({
    user_id: null, // headless archiver — no acting user
    action: 'harbor_archive',
    nas_path: target.relPath,
    file_name: target.fileName,
  });
  if (logErr) log(`WARN nas_access_logs insert failed: ${logErr.message}`);

  return { outcome: 'archived', relPath: target.relPath, method, chunkCount: chunks.length, listedBytes, finalBytes };
}

module.exports = {
  BUCKET,
  probeFfmpeg,
  listChunkObjects,
  listAllObjectsUnder,
  removeObjects,
  archiveTrack,
};
