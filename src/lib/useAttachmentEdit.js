import { useState, useCallback, useEffect, useRef } from 'react';
import { pickImageFiles, makeImagePreview, revokePreview } from './messageImages';

// Manages the image-attachment state for editing a message: which existing
// attachments are kept, and which new files have been added. Used by all four
// chat page twins so add/remove-image-while-editing behaves identically.
//
// Returns:
//   kept          — existing attachments still attached ([{ url, name, ... }])
//   previews      — newly added, not-yet-uploaded images ([{ key, file, url }])
//   addFiles      — (FileList) validate + append new images (alerts on reject)
//   removeKept    — (url) drop an existing attachment
//   removePreview — (key) drop a newly added image (revokes its object URL)
//   buildPayload  — () => { keptAttachments, newFiles, removedUrls } for onEdit
//   hasImages     — kept or previews present
//   changed       — attachments differ from the original set
//   reset         — restore to the original set (revokes pending previews)
export default function useAttachmentEdit(originalAttachments) {
  const original = Array.isArray(originalAttachments) ? originalAttachments : [];
  const [kept, setKept] = useState(original);
  const [previews, setPreviews] = useState([]);
  const previewsRef = useRef(previews);
  previewsRef.current = previews;

  const addFiles = useCallback((fileList) => {
    const { accepted, error } = pickImageFiles(fileList);
    if (error) alert(error);
    if (accepted.length) setPreviews(prev => [...prev, ...accepted.map(makeImagePreview)]);
  }, []);

  const removeKept = useCallback((url) => {
    setKept(prev => prev.filter(a => a.url !== url));
  }, []);

  const removePreview = useCallback((key) => {
    setPreviews(prev => {
      const hit = prev.find(p => p.key === key);
      if (hit) revokePreview(hit);
      return prev.filter(p => p.key !== key);
    });
  }, []);

  const reset = useCallback(() => {
    previewsRef.current.forEach(revokePreview);
    setPreviews([]);
    setKept(Array.isArray(originalAttachments) ? originalAttachments : []);
  }, [originalAttachments]);

  const buildPayload = useCallback(() => {
    const keptUrls = new Set(kept.map(a => a.url));
    return {
      keptAttachments: kept,
      newFiles: previews.map(p => p.file),
      removedUrls: original.map(a => a.url).filter(u => !keptUrls.has(u)),
    };
  }, [kept, previews, original]);

  const changed = kept.length !== original.length || previews.length > 0;
  const hasImages = kept.length > 0 || previews.length > 0;

  // Revoke any pending preview URLs on unmount.
  useEffect(() => () => { previewsRef.current.forEach(revokePreview); }, []);

  return { kept, previews, addFiles, removeKept, removePreview, buildPayload, hasImages, changed, reset };
}
