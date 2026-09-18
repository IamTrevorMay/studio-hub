import React from 'react';
import { CONTRACTOR_SPECIALTIES } from '../lib/rolePermissions';
import { colors } from '../lib/styleTokens';

// Multi-select chip row for contractor specialties (profiles.specialties).
// `value` is an array of specialty keys; `onChange` receives the new array.
// Order in the stored array follows CONTRACTOR_SPECIALTIES so display is
// stable no matter what order chips were clicked.
export default function SpecialtyPicker({ value = [], onChange, disabled = false, compact = false }) {
  const selected = new Set(Array.isArray(value) ? value : []);

  function toggle(key) {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange(CONTRACTOR_SPECIALTIES.map(s => s.value).filter(v => next.has(v)));
  }

  return (
    <div style={{ ...styles.row, ...(compact ? styles.rowCompact : {}) }} role="group" aria-label="Specialties">
      {CONTRACTOR_SPECIALTIES.map(s => {
        const on = selected.has(s.value);
        return (
          <button
            key={s.value}
            type="button"
            onClick={() => toggle(s.value)}
            disabled={disabled}
            aria-pressed={on}
            style={{
              ...styles.chip,
              ...(compact ? styles.chipCompact : {}),
              ...(on ? styles.chipOn : {}),
              ...(disabled ? styles.chipDisabled : {}),
            }}
          >
            {on ? '✓ ' : ''}{s.label}
          </button>
        );
      })}
    </div>
  );
}

const styles = {
  row: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  rowCompact: { gap: 4 },
  chip: {
    padding: '6px 12px',
    background: colors.whiteA03,
    border: `1px solid ${colors.border}`,
    borderRadius: 999,
    color: colors.textSubtle,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    lineHeight: 1.2,
  },
  chipCompact: { padding: '4px 10px', fontSize: 11 },
  chipOn: {
    background: colors.accentA15,
    border: `1px solid ${colors.accentA45}`,
    color: colors.accentFg,
  },
  chipDisabled: { cursor: 'default', opacity: 0.7 },
};
