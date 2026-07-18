import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { colors } from '../lib/styleTokens';

export default function SprintGoals({ goals, sprintId, onUpdate }) {
  const [newGoalText, setNewGoalText] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');

  async function addGoal() {
    if (!newGoalText.trim() || goals.length >= 3) return;
    const position = goals.length;
    const { error } = await supabase.from('sprint_goals').insert({
      sprint_id: sprintId,
      text: newGoalText.trim(),
      position,
    });
    if (!error) {
      setNewGoalText('');
      onUpdate();
    }
  }

  async function toggleGoal(goal) {
    const { error } = await supabase
      .from('sprint_goals')
      .update({ is_complete: !goal.is_complete })
      .eq('id', goal.id);
    if (!error) onUpdate();
  }

  async function saveEdit(goalId) {
    if (!editText.trim()) return;
    const { error } = await supabase
      .from('sprint_goals')
      .update({ text: editText.trim() })
      .eq('id', goalId);
    if (!error) {
      setEditingId(null);
      onUpdate();
    }
  }

  async function deleteGoal(goalId) {
    const { error } = await supabase.from('sprint_goals').delete().eq('id', goalId);
    if (!error) onUpdate();
  }

  return (
    <div>
      <div style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
        Sprint Goals
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {[...goals].sort((a, b) => a.position - b.position).map(goal => (
          <div key={goal.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => toggleGoal(goal)}
              style={{
                width: '18px', height: '18px', borderRadius: '4px', border: '1.5px solid',
                borderColor: goal.is_complete ? '#5b8fc7' : 'rgba(255,255,255,0.2)',
                background: goal.is_complete ? '#5b8fc7' : 'transparent',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, padding: 0,
              }}
            >
              {goal.is_complete && <span style={{ color: '#fff', fontSize: '11px', lineHeight: 1 }}>✓</span>}
            </button>
            {editingId === goal.id ? (
              <input
                value={editText}
                onChange={e => setEditText(e.target.value)}
                onBlur={() => saveEdit(goal.id)}
                onKeyDown={e => { if (e.key === 'Enter') saveEdit(goal.id); if (e.key === 'Escape') setEditingId(null); }}
                autoFocus
                style={{
                  flex: 1, background: colors.whiteA05, border: '1px solid rgba(91, 143, 199,0.3)',
                  borderRadius: '6px', padding: '4px 8px', color: '#fff', fontSize: '13px', outline: 'none',
                }}
              />
            ) : (
              <span
                onClick={() => { setEditingId(goal.id); setEditText(goal.text); }}
                style={{
                  flex: 1, fontSize: '13px', cursor: 'pointer',
                  color: goal.is_complete ? 'rgba(255,255,255,0.35)' : '#e2e8f0',
                  textDecoration: goal.is_complete ? 'line-through' : 'none',
                }}
              >
                {goal.text}
              </span>
            )}
            <button
              onClick={() => deleteGoal(goal.id)}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: '14px', padding: '2px 4px' }}
            >
              ×
            </button>
          </div>
        ))}
        {goals.length < 3 && (
          <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
            <input
              value={newGoalText}
              onChange={e => setNewGoalText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addGoal()}
              placeholder="Add a goal..."
              style={{
                flex: 1, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '6px', padding: '4px 8px', color: '#fff', fontSize: '12px', outline: 'none',
              }}
            />
            <button
              onClick={addGoal}
              disabled={!newGoalText.trim()}
              style={{
                background: colors.accentA15, color: colors.accentFg, border: '1px solid rgba(91, 143, 199,0.2)',
                borderRadius: '6px', padding: '4px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                opacity: newGoalText.trim() ? 1 : 0.4,
              }}
            >
              +
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
