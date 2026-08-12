import React, { useState } from 'react';
import MemberAssignmentModal from './MemberAssignmentModal';
import ContractorAssignmentModal from './ContractorAssignmentModal';
import { colors } from '../lib/styleTokens';

// "+ Assignment" dropdown — hands out a one-off member task or a paid
// contractor assignment. Self-contained (button + menu + both modals) so it can
// sit anywhere; it lives in the Dashboard's My Tasks header for admin-tier
// users. Callers gate on their own role check.
export default function AssignmentMenuButton({
  onCreated, showToast, currentUserId, buttonStyle, compact = false,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [memberOpen, setMemberOpen] = useState(false);
  const [contractorOpen, setContractorOpen] = useState(false);

  const handleCreated = (...args) => {
    if (onCreated) onCreated(...args);
  };

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        style={{ ...styles.btn, ...(compact ? styles.btnCompact : null), ...buttonStyle }}
        onClick={() => setMenuOpen(v => !v)}
      >
        + Assignment
        <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.7 }}>▾</span>
      </button>

      {menuOpen && (
        <>
          <div style={styles.backdrop} onClick={() => setMenuOpen(false)} />
          <div style={styles.menu}>
            <button
              style={styles.menuItem}
              onClick={() => { setMenuOpen(false); setMemberOpen(true); }}
            >
              <div style={styles.menuLabel}>Member</div>
              <div style={styles.menuDesc}>Team member — one-off task</div>
            </button>
            <button
              style={styles.menuItem}
              onClick={() => { setMenuOpen(false); setContractorOpen(true); }}
            >
              <div style={styles.menuLabel}>Contractor</div>
              <div style={styles.menuDesc}>Contractor — paid assignment</div>
            </button>
          </div>
        </>
      )}

      <MemberAssignmentModal
        open={memberOpen}
        onClose={() => setMemberOpen(false)}
        onCreated={handleCreated}
        showToast={showToast}
      />
      <ContractorAssignmentModal
        open={contractorOpen}
        onClose={() => setContractorOpen(false)}
        onCreated={handleCreated}
        showToast={showToast}
        currentUserId={currentUserId}
      />
    </div>
  );
}

const styles = {
  btn: {
    background: colors.accent,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'flex',
    alignItems: 'center',
  },
  btnCompact: {
    padding: '5px 12px',
    fontSize: 12,
    borderRadius: 6,
  },
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 998,
  },
  menu: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 6,
    minWidth: 260,
    background: colors.bgHover,
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10,
    padding: 6,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    zIndex: 999,
  },
  menuItem: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'none',
    border: 'none',
    borderRadius: 6,
    padding: '10px 12px',
    color: '#fff',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  menuLabel: {
    fontSize: 14,
    fontWeight: 700,
    color: '#fff',
  },
  menuDesc: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 2,
  },
};
