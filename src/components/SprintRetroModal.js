import React, { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function SprintRetroModal({ sprint, completedCount, completedPoints, rolledBackCount, onClose, onSaved }) {
  const [wentWell, setWentWell] = useState('');
  const [toImprove, setToImprove] = useState('');
  const [saving, setSaving] = useState(false);

  const dateRange = `${fmtDate(sprint.start_date)} – ${fmtDate(sprint.end_date)}`;

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('sprint_retros').insert({
        sprint_id: sprint.id,
        went_well: wentWell.trim(),
        to_improve: toImprove.trim(),
      });
      if (error) { alert('Failed to save retro: ' + error.message); return; }
      onSaved();
    } finally {
      setSaving(false); // release even if the insert throws (network), else button locks
    }
  }

  function handleSkip() {
    onSaved();
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', color: '#fff', fontWeight: 600 }}>Sprint Complete</h3>
          <button onClick={onClose} style={closeBtnStyle}>✕</button>
        </div>

        {/* Summary */}
        <div style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '10px', padding: '14px', marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '6px' }}>{dateRange}</div>
          <div style={{ display: 'flex', gap: '16px' }}>
            <div>
              <span style={{ fontSize: '22px', fontWeight: 700, color: '#22c55e' }}>{completedPoints || completedCount}</span>
              <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginLeft: '4px' }}>{completedPoints ? 'pts' : 'completed'}</span>
              {completedPoints > 0 && <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginLeft: '6px' }}>({completedCount} tasks)</span>}
            </div>
            {rolledBackCount > 0 && (
              <div>
                <span style={{ fontSize: '22px', fontWeight: 700, color: '#f59e0b' }}>{rolledBackCount}</span>
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginLeft: '4px' }}>→ backlog</span>
              </div>
            )}
          </div>
        </div>

        {/* Retro fields */}
        <div style={{ marginBottom: '12px' }}>
          <label style={labelStyle}>What went well?</label>
          <textarea
            value={wentWell}
            onChange={e => setWentWell(e.target.value)}
            rows={3}
            placeholder="Wins, good habits, things to keep doing..."
            style={textareaStyle}
          />
        </div>
        <div style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>What to improve?</label>
          <textarea
            value={toImprove}
            onChange={e => setToImprove(e.target.value)}
            rows={3}
            placeholder="Blockers, distractions, process changes..."
            style={textareaStyle}
          />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={handleSkip} style={skipBtnStyle}>Skip</button>
          <button onClick={handleSave} disabled={saving} style={saveBtnStyle}>
            {saving ? 'Saving...' : 'Save Retro'}
          </button>
        </div>
      </div>
    </div>
  );
}

function fmtDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};

const modalStyle = {
  background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '14px',
  padding: '24px', width: '480px', maxWidth: '90vw', maxHeight: '85vh', overflowY: 'auto',
};

const closeBtnStyle = {
  background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: '18px', cursor: 'pointer', padding: '4px 8px',
};

const labelStyle = {
  display: 'block', fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.45)',
  marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px',
};

const textareaStyle = {
  width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '8px', padding: '10px', color: '#fff', fontSize: '13px', outline: 'none',
  resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
};

const skipBtnStyle = {
  background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)',
  border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
  padding: '8px 16px', fontSize: '13px', cursor: 'pointer',
};

const saveBtnStyle = {
  background: '#6366f1', color: '#fff', border: 'none', borderRadius: '8px',
  padding: '8px 20px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
};
