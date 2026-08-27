import React, { useEffect, useState } from 'react';
import { VIEW_AS } from '../supabaseClient';
import { endViewAs } from '../lib/viewAs';

// Fixed bar pinned to the top of a "View as…" preview tab. Loud on purpose:
// this tab is reading production data as someone else, and it must never be
// mistaken for the admin's own session.
export default function ViewAsBanner() {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    if (!VIEW_AS.active || !VIEW_AS.expiresAt) return undefined;
    function tick() {
      const ms = VIEW_AS.expiresAt * 1000 - Date.now();
      if (ms <= 0) {
        setRemaining('expired');
        return;
      }
      const mins = Math.floor(ms / 60000);
      setRemaining(mins >= 1 ? `${mins}m left` : '<1m left');
    }
    tick();
    const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, []);

  if (!VIEW_AS.active) return null;

  const name = VIEW_AS.target?.full_name || 'another user';
  const role = VIEW_AS.target?.role;

  return (
    <div style={styles.bar}>
      <span style={styles.dot} />
      <span style={styles.text}>
        Viewing as <strong style={styles.name}>{name}</strong>
        {role ? <span style={styles.role}>{role}</span> : null}
        <span style={styles.readonly}>read-only preview</span>
      </span>
      {remaining ? <span style={styles.timer}>{remaining}</span> : null}
      <button style={styles.exit} onClick={endViewAs}>Exit preview</button>
    </div>
  );
}

const BAR_HEIGHT = 36;

export const VIEW_AS_BAR_HEIGHT = BAR_HEIGHT;

const styles = {
  bar: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    height: `${BAR_HEIGHT}px`,
    zIndex: 100000,
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '0 14px',
    background: 'linear-gradient(90deg, #b45309, #d97706)',
    color: '#fff',
    fontFamily: "'DM Sans', sans-serif",
    fontSize: '13px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.35)',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#fff',
    flexShrink: 0,
  },
  text: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 },
  name: { fontWeight: 600 },
  role: {
    padding: '1px 7px',
    borderRadius: '999px',
    background: 'rgba(0,0,0,0.22)',
    fontSize: '11px',
    textTransform: 'capitalize',
  },
  readonly: { opacity: 0.85, fontSize: '12px' },
  timer: { marginLeft: 'auto', opacity: 0.85, fontSize: '12px', whiteSpace: 'nowrap' },
  exit: {
    background: 'rgba(0,0,0,0.28)',
    border: '1px solid rgba(255,255,255,0.35)',
    color: '#fff',
    borderRadius: '6px',
    padding: '5px 12px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  },
};
