import React from 'react';

// Uniform chart legend. Items: { label, color, value? }. When value is present
// it renders inline so the legend doubles as a compact data table.
export default function Legend({ items, style }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', ...style }}>
      {(items || []).map((it) => (
        <span key={it.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: it.color, flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{it.label}</span>
          {it.value != null && (
            <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{it.value}</span>
          )}
        </span>
      ))}
    </div>
  );
}
