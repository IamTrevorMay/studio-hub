import React from 'react';
import { colors } from '../lib/styleTokens';

// Chip-style multi-select of people, used by the research assignment modals
// (ResearchScopeModal, AlreadyResearchingModal). Lived in the old
// MemberAssignmentModal until that was folded into AssignmentModal.
export default function PeopleChips({ label, people, selected, onToggle }) {
  if (people.length === 0) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={styles.chipGroupLabel}>{label}</div>
      <div style={styles.chipWrap}>
        {people.map(p => {
          const on = selected.includes(p.id);
          return (
            <button key={p.id} onClick={() => onToggle(p.id)}
              style={{ ...styles.personChip, ...(on ? styles.personChipOn : {}) }}>
              {on ? '✓ ' : ''}{p.full_name || p.email}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  chipGroupLabel: { fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', margin: '2px 0 4px', letterSpacing: 0.4 },
  chipWrap: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  personChip: {
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
    color: 'rgba(255,255,255,0.7)', borderRadius: 999, padding: '5px 12px', fontSize: 12.5, cursor: 'pointer',
    fontFamily: 'inherit',
  },
  personChipOn: { background: colors.accentA25, border: '1px solid rgba(91, 143, 199,0.6)', color: colors.accentFgSoft, fontWeight: 600 },
};
