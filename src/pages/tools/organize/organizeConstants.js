export const TYPE_OPTIONS = ['Video', 'Image', 'Graphic', 'Audio', 'VFX'];

export const SUBTYPE_MAP = {
  Video: ['A-Roll', 'B-Roll', 'VO'],
  Image: ['Text', 'Diagram', 'Photo'],
  Graphic: ['Overlay', 'Background', 'Bar', 'Lower Third'],
  Audio: ['Music', 'ADR/VO', 'SFX'],
  VFX: ['Preset', 'Motion', 'After Effects'],
};

export const SUPPORTED_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'avif',
  'mov', 'mp4',
  'wav', 'mp3',
]);

export const VIDEO_EXTENSIONS = new Set(['mov', 'mp4']);
export const AUDIO_EXTENSIONS = new Set(['wav', 'mp3']);
export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'avif']);

export function getFileExtension(name) {
  return (name.split('.').pop() || '').toLowerCase();
}

export function sanitizeFilename(title) {
  return title
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    || 'Untitled';
}

export function getMediaCategory(ext) {
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return null;
}
