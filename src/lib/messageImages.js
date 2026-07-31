// Shared attachment helpers for Messages (DMs) + Channels — desktop and
// mobile. Keeps the four composer implementations consistent: same validation,
// same bucket, same upload path convention, same attachment JSON shape.
//
// Supports PNG/JPG images (compressed + dimensioned) and PDF documents
// (uploaded as-is, rendered as a downloadable file card).
//
// Attachment JSON (stored in the nullable `attachments` jsonb column on
// direct_messages / channel_messages):
//   images: { url, name, kind:'image', width?, height? }
//   pdfs:   { url, name, kind:'pdf', size? }
// Legacy rows predate `kind` — treat a missing kind as an image (see
// isPdfAttachment), which is what every pre-PDF attachment was.

import { supabase } from '../supabaseClient';

// Dedicated public bucket for message attachments (created in
// 20260723000000_message_attachments.sql). Public read; per-user write via
// RLS requiring the first path folder to equal auth.uid(). No MIME restriction
// on the bucket, so PDFs upload without any bucket change.
export const MESSAGE_IMAGE_BUCKET = 'message-attachments';

// For the hidden <input type="file"> accept attribute.
export const ATTACHMENT_ACCEPT = 'image/png,image/jpeg,application/pdf';
// Back-compat alias — existing importers used IMAGE_ACCEPT; PDFs are now allowed.
export const IMAGE_ACCEPT = ATTACHMENT_ACCEPT;

// Per-file size caps — friendly rejection above these.
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25MB (PDFs aren't recompressed)

const IMAGE_MIME = ['image/png', 'image/jpeg'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg'];
const PDF_MIME = 'application/pdf';

function extOf(name = '') {
  return (name.split('.').pop() || '').toLowerCase();
}

// True for a PDF File (by mime OR extension — some browsers omit the mime).
export function isPdfFile(file) {
  return file?.type === PDF_MIME || extOf(file?.name) === 'pdf';
}

// True for a stored attachment that's a PDF. Missing kind = legacy image.
export function isPdfAttachment(a) {
  return a?.kind === 'pdf' || (!a?.kind && extOf(a?.name) === 'pdf');
}

// One-line label for a message whose body is empty but that carries
// attachments (conversation-list previews, mention notifications). Returns ''
// for no attachments so callers can fall back.
export function attachmentPreviewLabel(attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (list.length === 0) return '';
  const anyPdf = list.some(isPdfAttachment);
  const anyImage = list.some((a) => !isPdfAttachment(a));
  if (anyImage && !anyPdf) return '📷 Photo';
  if (anyPdf && !anyImage) return '📄 PDF';
  return '📎 Attachment';
}

// Validate + partition a FileList/array into accepted files and a single
// human-friendly error string (null when everything passed). Accepts PNG/JPG
// images and PDFs; rejects on type and per-type size cap.
export function pickAttachmentFiles(files) {
  const accepted = [];
  const rejected = [];
  for (const file of Array.from(files || [])) {
    const isImage = IMAGE_MIME.includes(file.type) && IMAGE_EXT.includes(extOf(file.name));
    const isPdf = isPdfFile(file);
    if (!isImage && !isPdf) {
      rejected.push(`${file.name || 'file'} — only PNG, JPG, or PDF files are allowed`);
      continue;
    }
    const cap = isPdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
    if (file.size > cap) {
      rejected.push(`${file.name} — over ${Math.round(cap / (1024 * 1024))}MB`);
      continue;
    }
    accepted.push(file);
  }
  return { accepted, error: rejected.length ? rejected.join('\n') : null };
}

// Back-compat alias (now PDF-aware).
export const pickImageFiles = pickAttachmentFiles;

// Wrap a File in a preview object for the composer. Images get an object URL
// for a thumbnail; PDFs get kind:'pdf' and no URL (rendered as a card). Caller
// must revokePreview() when removing/sending to avoid leaking image URLs.
export function makeAttachmentPreview(file) {
  const pdf = isPdfFile(file);
  return {
    key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
    file,
    kind: pdf ? 'pdf' : 'image',
    url: pdf ? null : URL.createObjectURL(file),
  };
}

// Back-compat alias.
export const makeImagePreview = makeAttachmentPreview;

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
  if (!IMAGE_MIME.includes(file.type)) return file;
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

// Upload accepted Files to the message-attachments bucket. Path:
//   `${userId}/${scopeId}/${timestamp}-${rand}-${name}.${ext}`
// The leading userId folder satisfies the bucket's INSERT RLS
// ((storage.foldername(name))[1] = auth.uid()::text). Images are compressed
// client-side first and get width/height; PDFs upload as-is. Returns the
// attachment JSON array to store on the message row. Throws on first error.
export async function uploadMessageAttachments(files, { userId, scopeId }) {
  const out = [];
  for (const original of Array.from(files || [])) {
    const pdf = isPdfFile(original);
    const file = pdf ? original : await compressImage(original);
    const ext = extOf(original.name) || (pdf ? 'pdf' : 'png');
    const contentType = pdf ? PDF_MIME : file.type;
    const path = `${userId}/${scopeId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${sanitizeBase(original.name)}.${ext}`;
    const { error } = await supabase.storage
      .from(MESSAGE_IMAGE_BUCKET)
      .upload(path, file, { cacheControl: '3600', upsert: false, contentType });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from(MESSAGE_IMAGE_BUCKET).getPublicUrl(path);
    if (pdf) {
      out.push({ url: publicUrl, name: original.name, kind: 'pdf', size: original.size });
    } else {
      const dims = await readDimensions(file);
      out.push({ url: publicUrl, name: original.name, kind: 'image', ...dims });
    }
  }
  return out;
}

// Back-compat alias.
export const uploadMessageImages = uploadMessageAttachments;

// True when a drag event is carrying files. Uses Array.from so it also works on
// legacy Safari where DataTransfer.types is a DOMStringList (no .includes).
export function dragHasFiles(e) {
  return Array.from(e?.dataTransfer?.types || []).includes('Files');
}

// Force a download of a linked file. The <a download> attribute is ignored for
// cross-origin URLs (our public storage lives on a different origin), so fetch
// the bytes and save a same-origin object URL. Falls back to opening the URL in
// a new tab (where the user can still save it) if the fetch is blocked.
export async function downloadUrl(url, filename) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
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
