// Shared image-attachment helpers for Messages (DMs) + Channels — desktop and
// mobile. Keeps the four composer implementations consistent: same validation,
// same bucket, same upload path convention, same attachment JSON shape.
//
// Attachment JSON (stored in the nullable `attachments` jsonb column on
// direct_messages / channel_messages): [{ url, name, width?, height? }].

import { supabase } from '../supabaseClient';

// Dedicated public bucket for message images (created in
// 20260723000000_message_attachments.sql). Public read; per-user write via
// RLS requiring the first path folder to equal auth.uid().
export const MESSAGE_IMAGE_BUCKET = 'message-attachments';

// For the hidden <input type="file"> accept attribute.
export const IMAGE_ACCEPT = 'image/png,image/jpeg';

// 10MB cap per image — friendly rejection above this.
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME = ['image/png', 'image/jpeg'];
const ALLOWED_EXT = ['png', 'jpg', 'jpeg'];

function extOf(name = '') {
  return (name.split('.').pop() || '').toLowerCase();
}

// Validate + partition a FileList/array into accepted images and a single
// human-friendly error string (null when everything passed). Rejects on both
// extension AND mime type, and enforces the size cap.
export function pickImageFiles(files) {
  const accepted = [];
  const rejected = [];
  for (const file of Array.from(files || [])) {
    const okType = ALLOWED_MIME.includes(file.type) && ALLOWED_EXT.includes(extOf(file.name));
    if (!okType) { rejected.push(`${file.name || 'file'} — only PNG or JPG images are allowed`); continue; }
    if (file.size > MAX_IMAGE_BYTES) { rejected.push(`${file.name} — over 10MB`); continue; }
    accepted.push(file);
  }
  return { accepted, error: rejected.length ? rejected.join('\n') : null };
}

// Wrap a File in a preview object with an object URL for thumbnail display.
// Caller must revokePreview() when removing/sending to avoid leaking URLs.
export function makeImagePreview(file) {
  return {
    key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
    file,
    url: URL.createObjectURL(file),
  };
}

export function revokePreview(preview) {
  if (preview?.url) { try { URL.revokeObjectURL(preview.url); } catch { /* noop */ } }
}

function sanitizeBase(name = 'image') {
  const base = name.replace(/\.[^.]+$/, '');
  return (base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60)) || 'image';
}

// Read a File's natural pixel dimensions (best-effort; resolves {} on failure).
function readDimensions(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve({}); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

// Downscale + re-encode a large image before upload so we're not storing 10MB
// originals. Caps the longest edge at ~2048px and re-encodes (JPEG at 0.85,
// PNG lossless to preserve alpha). Returns the original File untouched when it's
// already small enough or if anything fails — never throws.
export async function compressImage(file, { maxEdge = 2048, jpegQuality = 0.85 } = {}) {
  if (!ALLOWED_MIME.includes(file.type)) return file;
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // undecodable → upload as-is
  }
  try {
    const { width, height } = bitmap;
    const longest = Math.max(width, height);
    const scale = longest > maxEdge ? maxEdge / longest : 1;
    // Small, already-reasonable images (no downscale, under ~1.5MB): skip re-encode.
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    const quality = file.type === 'image/jpeg' ? jpegQuality : undefined;
    const blob = await new Promise((res) => canvas.toBlob(res, file.type, quality));
    if (!blob) return file;
    // Don't inflate an already-optimized image we didn't downscale.
    if (scale === 1 && blob.size >= file.size) return file;
    return new File([blob], file.name, { type: file.type, lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    bitmap.close?.();
  }
}

// Upload accepted image Files to the message-attachments bucket. Path:
//   `${userId}/${scopeId}/${timestamp}-${rand}-${name}.${ext}`
// The leading userId folder satisfies the bucket's INSERT RLS
// ((storage.foldername(name))[1] = auth.uid()::text). Each image is compressed
// client-side first. Returns the attachment JSON array to store on the message
// row. Throws on the first upload error.
export async function uploadMessageImages(files, { userId, scopeId }) {
  const out = [];
  for (const original of Array.from(files || [])) {
    const file = await compressImage(original);
    const ext = extOf(original.name) || 'png';
    const path = `${userId}/${scopeId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${sanitizeBase(original.name)}.${ext}`;
    const { error } = await supabase.storage
      .from(MESSAGE_IMAGE_BUCKET)
      .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from(MESSAGE_IMAGE_BUCKET).getPublicUrl(path);
    const dims = await readDimensions(file);
    out.push({ url: publicUrl, name: original.name, ...dims });
  }
  return out;
}

// True when a drag event is carrying files. Uses Array.from so it also works on
// legacy Safari where DataTransfer.types is a DOMStringList (no .includes).
export function dragHasFiles(e) {
  return Array.from(e?.dataTransfer?.types || []).includes('Files');
}

// Extract the in-bucket object path from a public storage URL.
export function attachmentPathFromUrl(url) {
  if (!url) return null;
  const marker = `/object/public/${MESSAGE_IMAGE_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  try {
    return decodeURIComponent(url.slice(idx + marker.length).split('?')[0]);
  } catch {
    return url.slice(idx + marker.length).split('?')[0];
  }
}

// Remove storage objects for the given attachment URLs. Client-side, so it only
// succeeds for objects the caller owns (the storage DELETE RLS) — used from the
// EDIT path, where the editor is always the message owner. Best-effort.
export async function removeMessageImagesByUrl(urls) {
  const paths = (urls || []).map(attachmentPathFromUrl).filter(Boolean);
  if (paths.length === 0) return;
  await supabase.storage.from(MESSAGE_IMAGE_BUCKET).remove(paths);
}

// Delete a message and, if it has image attachments, its storage objects too
// (no orphans). Messages without attachments delete directly; messages with
// attachments route through the `cleanup-message-attachments` edge function,
// which re-uses the table's delete RLS to authorize and service-role-removes the
// objects (so a channel admin deleting another user's image also cleans up).
export async function deleteMessageAndAttachments({ table, message }) {
  const hasAttachments = Array.isArray(message?.attachments) && message.attachments.length > 0;
  if (!hasAttachments) {
    const { error } = await supabase.from(table).delete().eq('id', message.id);
    if (error) throw error;
    return;
  }
  const { data, error } = await supabase.functions.invoke('cleanup-message-attachments', {
    body: { table, message_id: message.id },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
}
