import React from 'react';
import { TYPE_OPTIONS, SUBTYPE_MAP } from './organizeConstants';

export default function MetadataFields({ meta, onChange, layout = 'vertical' }) {
  const subtypes = meta.type ? SUBTYPE_MAP[meta.type] || [] : [];
  const isHorizontal = layout === 'horizontal';

  const wrapperStyle = isHorizontal
    ? { display: 'flex', gap: '8px', alignItems: 'center', flex: 1 }
    : { display: 'flex', flexDirection: 'column', gap: '8px' };

  return (
    <div style={wrapperStyle}>
      <input
        type="text"
        value={meta.title || ''}
        onChange={e => onChange({ ...meta, title: e.target.value })}
        placeholder="Title"
        style={styles.input}
      />
      <select
        value={meta.type || ''}
        onChange={e => {
          const newType = e.target.value;
          onChange({ ...meta, type: newType, subtype: '' });
        }}
        style={styles.select}
      >
        <option value="">Type...</option>
        {TYPE_OPTIONS.map(t => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <select
        value={meta.subtype || ''}
        onChange={e => onChange({ ...meta, subtype: e.target.value })}
        style={styles.select}
        disabled={!meta.type}
      >
        <option value="">Subtype...</option>
        {subtypes.map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      {meta.type && (
        <input
          type="text"
          value={meta.description || ''}
          onChange={e => onChange({ ...meta, description: e.target.value })}
          placeholder="Description"
          style={styles.input}
        />
      )}
    </div>
  );
}

const styles = {
  input: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    padding: '6px 10px',
    color: '#e2e8f0',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
    minWidth: 0,
    flex: 1,
  },
  select: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    padding: '6px 10px',
    color: '#e2e8f0',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
    cursor: 'pointer',
    minWidth: '100px',
  },
};
