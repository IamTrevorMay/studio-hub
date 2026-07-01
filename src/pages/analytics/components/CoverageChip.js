import React from 'react';
import { PLATFORM_META, COVERAGE_META } from '../constants';

// A muted chip that states how complete a platform's data actually is, so a
// partial platform (Twitch live-only, Substack reach-only, Twitter followers-
// only) can't be misread as fully tracked. Renders nothing for fully-tracked
// platforms (no caveat needed) and for unknown platforms.
export default function CoverageChip({ platform, style }) {
  const cov = PLATFORM_META[platform]?.coverage;
  if (!cov || cov === 'full') return null;
  const meta = COVERAGE_META[cov];
  if (!meta) return null;
  return (
    <span title={meta.note} style={{ ...chip, ...style }}>
      {meta.label}
    </span>
  );
}

const chip = {
  display: 'inline-block',
  padding: '1px 6px',
  borderRadius: 6,
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: '0.3px',
  textTransform: 'uppercase',
  color: '#a6741c',
  background: 'rgba(201,138,43,0.12)',
  border: '1px solid rgba(201,138,43,0.30)',
  whiteSpace: 'nowrap',
  cursor: 'help',
};
