import React, { useState } from 'react';
import { TYPE_OPTIONS, SUBTYPE_MAP } from './organizeConstants';

export default function BatchBar({ selectedCount, totalCount, onApply, onClear, onSelectAll }) {
  const [batchType, setBatchType] = useState('');
  const [batchSubtype, setBatchSubtype] = useState('');

  const subtypes = batchType ? SUBTYPE_MAP[batchType] || [] : [];

  function handleTypeChange(newType) {
    setBatchType(newType);
    setBatchSubtype('');
  }

  function handleApply() {
    if (!batchType) return;
    onApply({ type: batchType, subtype: batchSubtype });
    setBatchType('');
    setBatchSubtype('');
  }

  return (
    <div style={styles.bar}>
      <div style={styles.left}>
        <div style={styles.countBadge}>{selectedCount}</div>
        <span style={styles.countLabel}>
          {selectedCount === 1 ? 'file selected' : 'files selected'}
        </span>
      </div>

      <div style={styles.center}>
        <select
          value={batchType}
          onChange={e => handleTypeChange(e.target.value)}
          style={styles.select}
        >
          <option value="">Set category…</option>
          {TYPE_OPTIONS.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <select
          value={batchSubtype}
          onChange={e => setBatchSubtype(e.target.value)}
          disabled={!batchType}
          style={{ ...styles.select, ...(batchType ? {} : styles.selectDisabled) }}
          title={batchType ? 'Subtype (optional)' : 'Select a category first'}
        >
          <option value="">Subtype (optional)</option>
          {subtypes.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <button
          onClick={handleApply}
          disabled={!batchType}
          style={{ ...styles.applyBtn, ...(!batchType ? styles.applyBtnDisabled : {}) }}
          title={batchType ? 'Apply to selected files' : 'Choose a category first'}
        >
          Apply to {selectedCount}
        </button>
      </div>

      <div style={styles.right}>
        {selectedCount < totalCount && (
          <button onClick={onSelectAll} style={styles.ghostBtn}>
            Select all {totalCount}
          </button>
        )}
        <button onClick={onClear} style={styles.clearBtn}>
          Clear selection
        </button>
      </div>
    </div>
  );
}

const styles = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '10px 16px',
    background: 'rgba(99,102,241,0.08)',
    border: '1px solid rgba(99,102,241,0.2)',
    borderRadius: '10px',
    marginBottom: '12px',
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexShrink: 0,
  },
  countBadge: {
    background: '#6366f1',
    color: '#fff',
    fontSize: '12px',
    fontWeight: 700,
    minWidth: '22px',
    height: '22px',
    borderRadius: '11px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 6px',
  },
  countLabel: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#a5b4fc',
  },
  center: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: 1,
    justifyContent: 'center',
  },
  select: {
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(99,102,241,0.25)',
    borderRadius: '7px',
    padding: '6px 10px',
    color: '#e2e8f0',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
    cursor: 'pointer',
    minWidth: '140px',
  },
  selectDisabled: {
    opacity: 0.45,
    cursor: 'not-allowed',
  },
  applyBtn: {
    padding: '6px 16px',
    background: '#6366f1',
    border: 'none',
    borderRadius: '7px',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'opacity 0.12s',
    whiteSpace: 'nowrap',
  },
  applyBtnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexShrink: 0,
  },
  ghostBtn: {
    padding: '6px 12px',
    background: 'none',
    border: '1px solid rgba(99,102,241,0.25)',
    borderRadius: '7px',
    color: '#a5b4fc',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  clearBtn: {
    padding: '6px 12px',
    background: 'none',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '7px',
    color: 'rgba(255,255,255,0.45)',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
};
