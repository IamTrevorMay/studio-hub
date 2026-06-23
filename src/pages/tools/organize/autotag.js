// AI auto-labeling client helpers for the Organize tool.
//
// For each file we build a small payload for the `organize-autotag` edge fn:
//   - image  → a downscaled JPEG thumbnail (base64)
//   - video  → a downscaled JPEG keyframe (base64) + duration
//   - audio  → duration only (Claude labels audio from filename + duration)
// then call the edge fn in small batches and return a map keyed by file.path.
//
// Thumbnails are downscaled before upload to keep request size / vision token
// cost down — the model only needs a representative frame, not full res.

import { callEdgeFn } from '../../../lib/edgeFn';
import { getMediaCategory } from './organizeConstants';

const MAX_DIM = 768;   // longest edge sent to the model
const JPEG_QUALITY = 0.8;
const BATCH_SIZE = 6;  // files per edge-fn request (server caps at 12)
const VIDEO_TIMEOUT_MS = 8000;
const AUDIO_TIMEOUT_MS = 6000;

function drawToBase64(source, width, height) {
  if (!width || !height) return null;
  const scale = Math.min(1, MAX_DIM / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  return dataUrl.split(',')[1] || null;
}

async function imageThumb(file) {
  const bitmap = await createImageBitmap(file);
  try {
    return drawToBase64(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close?.();
  }
}

function videoFrameAndDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    video.src = url;

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(result);
    };

    const timer = setTimeout(() => finish({ imageBase64: null, durationSec: null }), VIDEO_TIMEOUT_MS);

    video.onloadeddata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : null;
      const grab = () => {
        clearTimeout(timer);
        let imageBase64 = null;
        try {
          imageBase64 = drawToBase64(video, video.videoWidth, video.videoHeight);
        } catch { /* leave null */ }
        finish({ imageBase64, durationSec: duration });
      };
      video.onseeked = grab;
      // Seek ~10% in (capped at 1s) to skip black intro frames.
      const seekTo = Math.min(1, (duration || 2) * 0.1);
      try {
        video.currentTime = seekTo;
      } catch {
        grab();
      }
    };
    video.onerror = () => { clearTimeout(timer); finish({ imageBase64: null, durationSec: null }); };
  });
}

function audioDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.src = url;
    let settled = false;
    const finish = (d) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(d);
    };
    const timer = setTimeout(() => finish(null), AUDIO_TIMEOUT_MS);
    audio.onloadedmetadata = () => { clearTimeout(timer); finish(Number.isFinite(audio.duration) ? audio.duration : null); };
    audio.onerror = () => { clearTimeout(timer); finish(null); };
  });
}

async function buildItem(file) {
  const category = getMediaCategory(file.ext);
  const base = { id: file.path, name: file.name, ext: file.ext, category };
  try {
    const data = await file.handle.getFile();
    if (category === 'image') {
      return { ...base, imageBase64: await imageThumb(data) };
    }
    if (category === 'video') {
      const { imageBase64, durationSec } = await videoFrameAndDuration(data);
      return { ...base, imageBase64, durationSec };
    }
    if (category === 'audio') {
      return { ...base, durationSec: await audioDuration(data) };
    }
  } catch (err) {
    console.warn('Auto-tag: failed to build item for', file.path, err);
  }
  return base;
}

// Tag a list of files. Returns { [file.path]: { type, subtype, title, description,
// confidence, error? } }. onProgress is called after each batch with { done, total }.
export async function autotagFiles(files, onProgress) {
  const results = {};
  let done = 0;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const chunk = files.slice(i, i + BATCH_SIZE);
    const items = await Promise.all(chunk.map(buildItem));
    const resp = await callEdgeFn('organize-autotag', { items });
    for (const r of (resp.results || [])) {
      if (r && r.id) results[r.id] = r;
    }
    done += chunk.length;
    onProgress?.({ done: Math.min(done, files.length), total: files.length });
  }
  return results;
}
