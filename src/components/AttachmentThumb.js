import React from 'react';
import { colors, fontSizes, fontWeights, spacing } from '../lib/styleTokens';
import { isPdfAttachment } from '../lib/messageImages';

// Square attachment thumbnail for the composer + edit preview boxes. Fills its
// parent container (the parent sizes the box). Images render as a cover image;
// PDFs render a compact card with a PDF badge + (space permitting) the name.
export default function AttachmentThumb({ url, name, kind }) {
  if (isPdfAttachment({ kind, name })) {
    return (
      <div style={styles.pdfCard} title={name || 'PDF'}>
        <span style={styles.pdfGlyph}>PDF</span>
        {name && <span style={styles.pdfName}>{name}</span>}
      </div>
    );
  }
  return <img src={url} alt={name || 'attachment'} style={styles.img} />;
}

const styles = {
  img: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  pdfCard: {
    width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 2, padding: spacing.xs,
    boxSizing: 'border-box', background: colors.bgInput, textAlign: 'center', overflow: 'hidden',
  },
  pdfGlyph: {
    fontSize: fontSizes.xxs, fontWeight: fontWeights.bold, letterSpacing: 0.5,
    color: colors.danger.fgSoft,
  },
  pdfName: {
    fontSize: 9, lineHeight: 1.1, color: colors.textMuted,
    maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
};
