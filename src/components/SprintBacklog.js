import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { colors } from '../lib/styleTokens';

const POINT_COLORS = { '15': '#ef4444', '10': '#f97316', '6': '#f59e0b', '3': '#3b82f6', '1': '#6b7280' };
const POINT_OPTIONS = [
  { value: '', label: '—' },
  { value: '1', label: '1' },
  { value: '3', label: '3' },
  { value: '6', label: '6' },
  { value: '10', label: '10' },
  { value: '15', label: '15' },
];
const CATEGORY_OPTIONS = [
  { value: 'administration', label: 'Admin', color: '#3b82f6' },
  { value: 'creative', label: 'Creative', color: '#ec4899' },
  { value: 'production', label: 'Production', color: '#22c55e' },
  { value: 'business_development', label: 'Biz Dev', color: '#f97316' },
  { value: 'communication', label: 'Comms', color: '#f59e0b' },
  { value: 'software', label: 'Software', color: '#8b5cf6' },
  { value: 'ad', label: 'Ad', color: '#f59e0b' },
  { value: 'social', label: 'Social', color: '#06b6d4' },
];
const CATEGORY_COLORS = {};
CATEGORY_OPTIONS.forEach(c => { CATEGORY_COLORS[c.value] = c.color; });

export default function SprintBacklog({ profile, activeSprint, onTasksChanged, boardVersion }) {
  const [tasks, setTasks] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [newTaskText, setNewTaskText] = useState('');

  const fetchBacklog = useCallback(async () => {
    if (!profile?.id) return;
    const { data, error } = await supabase
      .from('personal_tasks')
      .select('*')
      .eq('created_by', profile.id)
      .eq('status', 'backlog')
      .order('priority', { ascending: false, nullsFirst: false })
      .order('position', { ascending: true });
    if (!error) setTasks(data || []);
  }, [profile?.id]);

  useEffect(() => { fetchBacklog(); }, [fetchBacklog, boardVersion]);

  const addingRef = useRef(false);
  async function addTask() {
    if (!newTaskText.trim() || !profile?.id || addingRef.current) return; // guard fast double-Enter
    addingRef.current = true;
    try {
      const maxPos = tasks.length > 0 ? Math.max(...tasks.map(t => t.position || 0)) : 0;
      const { error } = await supabase.from('personal_tasks').insert({
        created_by: profile.id,
        content: newTaskText.trim(),
        status: 'backlog',
        position: maxPos + 10,
      });
      if (!error) {
        setNewTaskText('');
        fetchBacklog();
      }
    } finally {
      addingRef.current = false;
    }
  }

  async function updateTask(taskId, updates) {
    const { error } = await supabase
      .from('personal_tasks')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', taskId);
    if (!error) fetchBacklog();
  }

  async function addToSprint(task) {
    if (!activeSprint) return;
    const { error } = await supabase
      .from('personal_tasks')
      .update({ status: 'ready', sprint_id: activeSprint.id, updated_at: new Date().toISOString() })
      .eq('id', task.id);
    if (!error) {
      fetchBacklog();
      if (onTasksChanged) onTasksChanged();
    }
  }

  async function deleteTask(taskId) {
    const { error } = await supabase.from('personal_tasks').delete().eq('id', taskId);
    if (!error) fetchBacklog();
  }

  // Compute total backlog points
  const totalPoints = tasks.reduce((sum, t) => sum + (parseInt(t.priority) || 0), 0);

  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '14px', marginTop: '14px' }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Backlog
        </span>
        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)' }}>
          ({tasks.length}{totalPoints > 0 ? ` · ${totalPoints} pts` : ''})
        </span>
        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', marginLeft: 'auto', transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'rotate(0)' }}>
          ▼
        </span>
      </div>

      {expanded && (
        <div style={{ marginTop: '10px' }}>
          {/* Add task input */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
            <input
              value={newTaskText}
              onChange={e => setNewTaskText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addTask()}
              placeholder="Add to backlog..."
              style={{
                flex: 1, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '6px', padding: '6px 10px', color: '#fff', fontSize: '12px', outline: 'none',
              }}
            />
            <button
              onClick={addTask}
              disabled={!newTaskText.trim()}
              style={{
                background: colors.accentA15, color: colors.accentFg, border: '1px solid rgba(91, 143, 199,0.2)',
                borderRadius: '6px', padding: '6px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                opacity: newTaskText.trim() ? 1 : 0.4,
              }}
            >
              + Add
            </button>
          </div>

          {/* Task list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '300px', overflowY: 'auto' }}>
            {tasks.map(task => (
              <div key={task.id} style={taskRowStyle}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', color: '#e2e8f0', lineHeight: '1.4', wordBreak: 'break-word' }}>
                    {task.content}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* Points selector */}
                    <select
                      value={task.priority || ''}
                      onChange={e => updateTask(task.id, { priority: e.target.value || null })}
                      style={{
                        ...inlineSelectStyle,
                        color: task.priority ? (POINT_COLORS[task.priority] || '#fff') : 'rgba(255,255,255,0.3)',
                      }}
                    >
                      {POINT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.value ? `${o.label} pt` : '— pts'}</option>)}
                    </select>
                    {/* Category selector */}
                    <select
                      value={task.category || 'administration'}
                      onChange={e => updateTask(task.id, { category: e.target.value })}
                      style={{
                        ...inlineSelectStyle,
                        color: CATEGORY_COLORS[task.category] || 'rgba(255,255,255,0.3)',
                      }}
                    >
                      {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                  {activeSprint && (
                    <button onClick={() => addToSprint(task)} style={actionBtnStyle} title="Add to sprint">
                      →
                    </button>
                  )}
                  <button onClick={() => deleteTask(task.id)} style={{ ...actionBtnStyle, color: 'rgba(255,255,255,0.2)' }} title="Delete">
                    ×
                  </button>
                </div>
              </div>
            ))}
            {tasks.length === 0 && (
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.25)', padding: '8px 0', textAlign: 'center' }}>
                No backlog items yet
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const taskRowStyle = {
  display: 'flex', alignItems: 'center', gap: '8px',
  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)',
  borderRadius: '8px', padding: '8px 10px',
};

const actionBtnStyle = {
  background: 'rgba(91, 143, 199,0.12)', color: '#8fb4d8', border: '1px solid rgba(91, 143, 199,0.2)',
  borderRadius: '6px', padding: '2px 8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
  lineHeight: 1,
};

const inlineSelectStyle = {
  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '4px', padding: '2px 4px', fontSize: '10px', fontWeight: 600,
  outline: 'none', cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none',
};
