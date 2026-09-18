import React, { useState } from 'react';
import AssignmentModal from './AssignmentModal';
import { colors } from '../lib/styleTokens';

// "+ Assignment" button — opens the unified AssignmentModal (members and
// contractors in one list; the task type picks the field set). Self-contained
// so it can sit anywhere; it lives in the Dashboard's My Tasks header for
// admin-tier users. Callers gate on their own role check.
export default function AssignmentMenuButton({
  onCreated, showToast, currentUserId, buttonStyle, compact = false,
}) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        style={{ ...styles.btn, ...(compact ? styles.btnCompact : null), ...buttonStyle }}
        onClick={() => setOpen(true)}
      >
        + Assignment
      </button>

      <AssignmentModal
        open={open}
        onClose={() => setOpen(false)}
        onCreated={(...args) => { if (onCreated) onCreated(...args); }}
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
};
