import React, { useState, useEffect } from 'react';
import backdropDismiss from '../lib/backdropDismiss';
import { colors } from '../lib/styleTokens';

// Prompt shown when completing a task flagged "Report Hours to Complete".
// Hours are required — the same rule is enforced in workflow-complete-task, so
// closing this dialog cancels the completion rather than skipping the number.
const QUICK_PICKS = [0.5, 1, 2, 4, 8];

export default function HoursPromptModal({ open, task, submitting, onCancel, onSubmit }) {
  const [hours, setHours] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setHours(task?.hours_spent != null ? String(task.hours_spent) : '');
      setError('');
    }
  }, [open, task]);

  if (!open) return null;

  const submit = () => {
    const n = Number(hours);
    if (!Number.isFinite(n) || n <= 0) {
      setError('Enter the hours you spent (e.g. 1.5).');
      return;
    }
    if (n > 500) {
      setError('That looks too high — 500 hours is the max.');
      return;
    }
    onSubmit(Math.round(n * 4) / 4);
  };

  return (
    <div style={styles.overlay} {...backdropDismiss(onCancel)}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <h2 style={styles.h2}>Report your hours</h2>
        <p style={styles.subtitle}>
          {task?.title
            ? <>How many hours did <strong style={{ color: 'rgba(255,255,255,0.75)' }}>{task.title}</strong> take?</>
            : 'How many hours did this task take?'}
        </p>

        <div style={styles.quickRow}>
          {QUICK_PICKS.map(h => (
            <button
              key={h}
              type="button"
              style={{ ...styles.quickBtn, ...(Number(hours) === h ? styles.quickBtnOn : null) }}
              onClick={() => { setHours(String(h)); setError(''); }}
            >
              {h}h
            </button>
          ))}
        </div>

        <div style={styles.inputWrap}>
          <input
            type="number"
            step="0.25"
            min="0.25"
            max="500"
            autoFocus
            value={hours}
            onChange={e => { setHours(e.target.value); setError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            placeholder="Hours"
            style={styles.input}
          />
          <span style={styles.unit}>hours</span>
        </div>
        <p style={styles.help}>Rounded to the nearest quarter hour. This is logged to payroll for the current pay period.</p>
        {error && <p style={styles.error}>{error}</p>}

        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onCancel} disabled={submitting}>Cancel</button>
          <button
            style={{ ...styles.submitBtn, opacity: submitting ? 0.5 : 1 }}
            onClick={submit}
            disabled={submitting}
          >
            {submitting ? 'Completing…' : 'Report & Complete'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
  },
  modal: {
    background: colors.bgHover, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14,
    width: 400, maxWidth: '92vw', padding: '22px 24px',
  },
  h2: { fontSize: 17, fontWeight: 700, color: '#fff', margin: 0 },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: '6px 0 16px', lineHeight: 1.45 },
  quickRow: { display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' },
  quickBtn: {
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
    color: 'rgba(255,255,255,0.7)', borderRadius: 999, padding: '5px 13px',
    fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
  },
  quickBtnOn: {
    background: colors.accent, borderColor: colors.accent, color: '#fff', fontWeight: 700,
  },
  inputWrap: { position: 'relative', display: 'flex', alignItems: 'center' },
  input: {
    width: '100%', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10, padding: '11px 62px 11px 13px', color: '#fff', fontSize: 15,
    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  },
  unit: {
    position: 'absolute', right: 13, fontSize: 12, color: 'rgba(255,255,255,0.35)', pointerEvents: 'none',
  },
  help: { fontSize: 11, color: 'rgba(255,255,255,0.35)', margin: '8px 0 0', lineHeight: 1.4 },
  error: { fontSize: 12, color: '#f87171', margin: '8px 0 0' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 },
  cancelBtn: {
    background: 'none', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)',
    borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
  },
  submitBtn: {
    background: colors.accent, border: 'none', color: '#fff', borderRadius: 8,
    padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  },
};
