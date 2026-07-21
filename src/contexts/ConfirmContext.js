import React, { createContext, useContext, useState, useCallback } from 'react';
import backdropDismiss from '../lib/backdropDismiss';

const ConfirmContext = createContext(null);

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null); // { message, resolve }

  const confirm = useCallback((message) => {
    return new Promise((resolve) => {
      setState({ message, resolve });
    });
  }, []);

  const handleYes = () => {
    state?.resolve(true);
    setState(null);
  };

  const handleNo = () => {
    state?.resolve(false);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div style={overlay} {...backdropDismiss(handleNo)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <p style={msg}>{state.message}</p>
            <div style={btnRow}>
              <button onClick={handleNo} style={cancelBtn}>Cancel</button>
              <button onClick={handleYes} style={confirmBtn}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

const overlay = {
  position: 'fixed', inset: 0, zIndex: 99999,
  background: 'rgba(0,0,0,0.6)', display: 'flex',
  alignItems: 'center', justifyContent: 'center',
};
const modal = {
  background: '#1b2331', border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: '14px', padding: '24px', maxWidth: '380px', width: '90%',
  boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
};
const msg = {
  color: '#e2e8f0', fontSize: '14px', lineHeight: 1.5, margin: '0 0 20px',
};
const btnRow = {
  display: 'flex', gap: '10px', justifyContent: 'flex-end',
};
const cancelBtn = {
  padding: '8px 18px', background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
  color: 'rgba(255,255,255,0.6)', fontSize: '13px', fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
};
const confirmBtn = {
  padding: '8px 18px', background: 'rgba(239,68,68,0.15)',
  border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px',
  color: '#ef4444', fontSize: '13px', fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
};
