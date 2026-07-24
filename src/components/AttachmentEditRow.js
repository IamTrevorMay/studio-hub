import React, { useRef } from 'react';
import { colors, radii, spacing, fontSizes } from '../lib/styleTokens';
import { IMAGE_ACCEPT } from '../lib/messageImages';

// The row of removable image thumbnails + "add image" button shown while
// editing a message. Driven by the useAttachmentEdit hook so all four chat page
// twins share identical add/remove-while-editing behavior and styling.
export default function AttachmentEditRow({ editState }) {
  const { kept, previews, addFiles, removeKept, removePreview } = editState;
  const inputRef = useRef(null);

  return (
    <div style={styles.row}>
      {kept.map(a => (
        <div key={a.url} style={styles.thumb}>
          <img src={a.url} alt={a.name || 'attachment'} style={styles.img} />
          <button type="button" style={styles.remove} onClick={() => removeKept(a.url)} aria-label="Remove image">✕</button>
        </div>
      ))}
      {previews.map(p => (
        <div key={p.key} style={styles.thumb}>
          <img src={p.url} alt={p.file.name} style={styles.img} />
          <button type="button" style={styles.remove} onClick={() => removePreview(p.key)} aria-label="Remove image">✕</button>
        </div>
      ))}
      <button type="button" style={styles.addBtn} onClick={() => inputRef.current?.click()} title="Add image" aria-label="Add image">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        style={{ display: 'none' }}
        onChange={(e) => { addFiles(e.target.files); if (inputRef.current) inputRef.current.value = ''; }}
      />
    </div>
  );
}

const styles = {
  row: {
    display: 'flex', flexWrap: 'wrap', gap: spacing.sm,
    margin: `${spacing.sm}px 0`,
  },
  thumb: {
    position: 'relative', width: 56, height: 56, borderRadius: radii.md,
    overflow: 'hidden', border: `1px solid ${colors.borderStrong}`,
  },
  img: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  remove: {
    position: 'absolute', top: 2, right: 2, width: 18, height: 18,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: colors.bgOverlay, border: 'none', borderRadius: radii.circle,
    color: colors.white, fontSize: fontSizes.xxs, cursor: 'pointer', lineHeight: 1, padding: 0,
  },
  addBtn: {
    width: 56, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: colors.bgInput, border: `1px dashed ${colors.borderStrong}`,
    borderRadius: radii.md, color: colors.textMuted, cursor: 'pointer',
  },
};
