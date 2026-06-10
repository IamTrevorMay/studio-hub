import React from 'react';
import { colors, fontSizes, fontWeights } from '../../../lib/styleTokens';

// Tiny visual representation of an asset on the broadcast canvas. Just
// enough to tell things apart at a glance — image thumbnails, the first
// slideshow slide preview, or a colored type chip.

export default function WidgetCanvasPreview({ asset }) {
  if (!asset) return null;
  const a = asset;

  if (a.asset_type === 'image' && a.storage_path) {
    return (
      <img
        src={publicUrl(a.storage_path)} alt={a.name}
        style={{ width: '100%', height: '100%', objectFit: 'contain', background: 'rgba(0,0,0,0.4)' }}
      />
    );
  }
  if (a.asset_type === 'video' && a.storage_path) {
    return (
      <div style={chip('#ef4444')}>
        VIDEO · {a.name}
      </div>
    );
  }
  if (a.asset_type === 'slideshow') {
    const slides = (a.slideshow_config && a.slideshow_config.slides) || [];
    return (
      <div style={chip('#6366f1')}>
        SLIDESHOW · {slides.length} slides · {a.name}
      </div>
    );
  }
  if (a.asset_type === 'widget') {
    return <div style={chip('#22c55e')}>WIDGET · {a.name}</div>;
  }
  return <div style={chip('rgba(255,255,255,0.12)')}>{(a.asset_type || 'asset').toUpperCase()} · {a.name}</div>;
}

function publicUrl(path) {
  const base = process.env.REACT_APP_SUPABASE_URL || '';
  return `${base}/storage/v1/object/public/broadcast-assets/${encodeURI(path)}`;
}

function chip(bg) {
  return {
    width: '100%', height: '100%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: bg, color: '#fff',
    fontSize: fontSizes.xxs, fontWeight: fontWeights.bold,
    letterSpacing: '0.06em', textAlign: 'center', padding: 8,
    boxSizing: 'border-box',
  };
}
