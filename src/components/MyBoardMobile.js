import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import BottomSheet from './mobile/BottomSheet';
import { mobileTokens } from '../utils/mobileTokens';

// Simplified MyBoard for mobile. Skips sprints, retros, drag-drop, week-nav.
// Focus: see tasks, add tasks, complete tasks, edit a task. Same `personal_tasks`
// table as the desktop component.

const STATUS_GROUPS = [
  { id: 'in_progress', label: 'In progress', accent: '#f59e0b', statuses: ['in_progress'] },
  { id: 'ready', label: 'Up next', accent: '#3b82f6', statuses: ['ready'] },
  { id: 'holding', label: 'Holding', accent: '#f97316', statuses: ['holding'] },
  { id: 'inbox', label: 'Inbox', accent: '#a78bfa', statuses: ['inbox'] },
  { id: 'backlog', label: 'Backlog', accent: '#64748b', statuses: ['backlog'] },
  { id: 'done', label: 'Done', accent: '#22c55e', statuses: ['done'] },
];

const PRIORITY_OPTIONS = [
  { value: '', label: 'None' },
  { value: '1', label: '1 pt' },
  { value: '3', label: '3 pts' },
  { value: '6', label: '6 pts' },
  { value: '10', label: '10 pts' },
  { value: '15', label: '15 pts' },
];
const POINT_COLORS = { '15': '#ef4444', '10': '#f97316', '6': '#f59e0b', '3': '#3b82f6', '1': '#6b7280' };

const STATUS_OPTIONS = [
  { value: 'inbox', label: 'Inbox' },
  { value: 'backlog', label: 'Backlog' },
  { value: 'ready', label: 'Ready' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'holding', label: 'Holding' },
  { value: 'done', label: 'Done' },
];

export default function MyBoardMobile({ profile }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTaskText, setNewTaskText] = useState('');
  const [editingTask, setEditingTask] = useState(null);
  const [collapsed, setCollapsed] = useState(() => ({ done: true, backlog: true }));
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const fetchTasks = useCallback(async () => {
    if (!profile?.id) return;
    const { data, error } = await supabase
      .from('personal_tasks')
      .select('*')
      .eq('created_by', profile.id)
      .neq('status', 'archived')
      .order('position', { ascending: true });
    if (!error) setTasks(data || []);
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  async function addTask() {
    if (!newTaskText.trim() || !profile?.id) return;
    const content = newTaskText.trim();
    const inboxTasks = tasks.filter((t) => t.status === 'inbox');
    const maxPos = inboxTasks.length ? Math.max(...inboxTasks.map((t) => t.position || 0)) : 0;
    setNewTaskText('');
    const optimistic = {
      id: `temp-${Date.now()}`,
      created_by: profile.id,
      content,
      status: 'inbox',
      priority: null,
      due_date: null,
      position: maxPos + 10,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setTasks((prev) => [...prev, optimistic]);
    try {
      const { error } = await supabase.from('personal_tasks').insert({
        created_by: profile.id,
        content,
        position: maxPos + 10,
      });
      if (error) throw error;
      fetchTasks();
    } catch (err) {
      console.error('Add task failed:', err);
      setTasks((prev) => prev.filter((t) => t.id !== optimistic.id));
      setNewTaskText(content);
    }
  }

  async function updateTask(id, updates) {
    const snapshot = tasksRef.current.find((t) => t.id === id);
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates, updated_at: new Date().toISOString() } : t)));
    try {
      const { error } = await supabase
        .from('personal_tasks')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    } catch (err) {
      console.error('Update task failed:', err);
      if (snapshot) setTasks((prev) => prev.map((t) => (t.id === id ? snapshot : t)));
    }
  }

  async function deleteTask(id) {
    const snapshot = tasksRef.current.find((t) => t.id === id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
    try {
      const { error } = await supabase.from('personal_tasks').delete().eq('id', id);
      if (error) throw error;
    } catch (err) {
      console.error('Delete task failed:', err);
      if (snapshot) setTasks((prev) => [...prev, snapshot]);
    }
  }

  function toggleDone(task) {
    if (task.status === 'done') {
      updateTask(task.id, { status: 'ready', completed_at: null });
    } else {
      updateTask(task.id, { status: 'done', completed_at: new Date().toISOString() });
    }
  }

  function toggleGroup(id) {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const grouped = STATUS_GROUPS.map((g) => ({
    ...g,
    items: tasks.filter((t) => g.statuses.includes(t.status)),
  })).filter((g) => g.items.length > 0 || ['in_progress', 'ready', 'inbox'].includes(g.id));

  return (
    <div style={styles.root}>
      <div style={styles.list}>
        {loading ? (
          <p style={styles.empty}>Loading…</p>
        ) : tasks.length === 0 ? (
          <div style={styles.emptyState}>
            <p style={styles.empty}>No tasks yet.</p>
            <p style={styles.emptyHint}>Add one below to get started.</p>
          </div>
        ) : (
          grouped.map((group) => {
            const isCollapsed = collapsed[group.id];
            return (
              <section key={group.id} style={styles.group}>
                <button onClick={() => toggleGroup(group.id)} style={styles.groupHeader}>
                  <span style={{ ...styles.groupDot, background: group.accent }} />
                  <span style={styles.groupLabel}>{group.label}</span>
                  <span style={styles.groupCount}>{group.items.length}</span>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" style={{ marginLeft: 'auto', transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s', color: 'rgba(255,255,255,0.4)' }}>
                    <path d="M3 5l4 4 4-4z" />
                  </svg>
                </button>
                {!isCollapsed && group.items.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onToggleDone={() => toggleDone(task)}
                    onTap={() => setEditingTask(task)}
                  />
                ))}
              </section>
            );
          })
        )}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); addTask(); }}
        style={{ ...styles.addBar, paddingBottom: `calc(${mobileTokens.space.md}px + ${mobileTokens.safeBottom})` }}
      >
        <input
          value={newTaskText}
          onChange={(e) => setNewTaskText(e.target.value)}
          placeholder="Add a task…"
          style={styles.addInput}
        />
        <button
          type="submit"
          disabled={!newTaskText.trim()}
          style={{ ...styles.addBtn, opacity: newTaskText.trim() ? 1 : 0.4 }}
          aria-label="Add task"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M10 4v12M4 10h12" strokeLinecap="round" />
          </svg>
        </button>
      </form>

      <BottomSheet
        open={!!editingTask}
        onClose={() => setEditingTask(null)}
        title="Edit task"
        maxHeight="90vh"
      >
        {editingTask && (
          <TaskEditForm
            task={editingTask}
            onSave={(updates) => { updateTask(editingTask.id, updates); setEditingTask(null); }}
            onDelete={() => { deleteTask(editingTask.id); setEditingTask(null); }}
            onCancel={() => setEditingTask(null)}
          />
        )}
      </BottomSheet>
    </div>
  );
}

function TaskRow({ task, onToggleDone, onTap }) {
  const isDone = task.status === 'done';
  const priorityColor = task.priority ? POINT_COLORS[task.priority] : null;
  return (
    <div style={{ ...styles.row, borderLeft: priorityColor ? `3px solid ${priorityColor}` : '3px solid transparent' }}>
      <button
        type="button"
        onClick={onToggleDone}
        style={{ ...styles.checkbox, ...(isDone ? styles.checkboxDone : {}) }}
        aria-label={isDone ? 'Mark as not done' : 'Mark as done'}
      >
        {isDone && (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M3 7l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      <button type="button" onClick={onTap} style={styles.rowBody}>
        <span style={{ ...styles.rowText, textDecoration: isDone ? 'line-through' : 'none', color: isDone ? 'rgba(255,255,255,0.4)' : '#e2e8f0' }}>
          {task.content}
        </span>
        {task.due_date && (
          <span style={styles.dueChip}>{formatDue(task.due_date)}</span>
        )}
      </button>
    </div>
  );
}

function TaskEditForm({ task, onSave, onDelete, onCancel }) {
  const [content, setContent] = useState(task.content || '');
  const [status, setStatus] = useState(task.status || 'inbox');
  const [priority, setPriority] = useState(task.priority || '');
  const [dueDate, setDueDate] = useState(task.due_date || '');

  function handleSave() {
    if (!content.trim()) return;
    onSave({
      content: content.trim(),
      status,
      priority: priority || null,
      due_date: dueDate || null,
      ...(status === 'done' && task.status !== 'done' ? { completed_at: new Date().toISOString() } : {}),
      ...(status !== 'done' && task.status === 'done' ? { completed_at: null } : {}),
    });
  }

  return (
    <div style={editStyles.form}>
      <Field label="Task">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          style={editStyles.textarea}
          autoFocus
        />
      </Field>
      <Field label="Status">
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={editStyles.input}>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
      <div style={{ display: 'flex', gap: mobileTokens.space.md }}>
        <Field label="Priority" style={{ flex: 1 }}>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} style={editStyles.input}>
            {PRIORITY_OPTIONS.map((o) => <option key={o.value || 'none'} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Due date" style={{ flex: 1 }}>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={editStyles.input} />
        </Field>
      </div>

      <div style={editStyles.actionRow}>
        <button type="button" onClick={onDelete} style={editStyles.deleteBtn}>Delete</button>
        <div style={{ display: 'flex', gap: mobileTokens.space.sm }}>
          <button type="button" onClick={onCancel} style={editStyles.cancelBtn}>Cancel</button>
          <button type="button" onClick={handleSave} disabled={!content.trim()} style={{ ...editStyles.saveBtn, opacity: content.trim() ? 1 : 0.5 }}>Save</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, style, children }) {
  return (
    <label style={{ ...editStyles.field, ...(style || {}) }}>
      <span style={editStyles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

function formatDue(iso) {
  const d = new Date(iso + 'T00:00:00');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayMs = 86400000;
  const diff = Math.round((d - today) / dayMs);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tmrw';
  if (diff === -1) return 'Yest';
  if (diff > 1 && diff < 7) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100%',
    background: '#0f0f1a',
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.md}px ${mobileTokens.space.xxxl}px`,
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.lg,
    WebkitOverflowScrolling: 'touch',
  },
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: mobileTokens.space.sm,
    width: '100%',
    padding: `${mobileTokens.space.sm}px ${mobileTokens.space.sm}px`,
    border: 'none',
    background: 'transparent',
    color: '#e2e8f0',
    fontFamily: 'inherit',
    fontSize: mobileTokens.font.sm,
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'left',
  },
  groupDot: {
    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
  },
  groupLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: mobileTokens.font.sm,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  groupCount: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.4)',
    fontWeight: 500,
  },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: mobileTokens.space.md,
    background: 'rgba(255,255,255,0.04)',
    borderRadius: mobileTokens.radius.md,
    padding: mobileTokens.space.md,
    minHeight: mobileTokens.tap,
  },
  checkbox: {
    minWidth: 24,
    width: 24,
    height: 24,
    borderRadius: 6,
    border: '1.5px solid rgba(255,255,255,0.3)',
    background: 'transparent',
    color: 'transparent',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
    padding: 0,
    WebkitTapHighlightColor: 'transparent',
  },
  checkboxDone: {
    background: '#22c55e',
    borderColor: '#22c55e',
    color: '#fff',
  },
  rowBody: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    background: 'transparent',
    border: 'none',
    color: '#e2e8f0',
    textAlign: 'left',
    cursor: 'pointer',
    fontFamily: 'inherit',
    padding: 0,
    minHeight: mobileTokens.tap - 8,
  },
  rowText: {
    fontSize: mobileTokens.font.md,
    lineHeight: 1.4,
    wordBreak: 'break-word',
  },
  dueChip: {
    display: 'inline-block',
    alignSelf: 'flex-start',
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.55)',
    background: 'rgba(255,255,255,0.06)',
    padding: '2px 8px',
    borderRadius: mobileTokens.radius.pill,
    fontWeight: 500,
  },
  empty: {
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    fontSize: mobileTokens.font.md,
    margin: 0,
  },
  emptyHint: {
    color: 'rgba(255,255,255,0.3)',
    textAlign: 'center',
    fontSize: mobileTokens.font.sm,
    margin: 0,
    marginTop: 4,
  },
  emptyState: {
    padding: `${mobileTokens.space.xxxl}px ${mobileTokens.space.lg}px`,
  },
  addBar: {
    position: 'sticky',
    bottom: 0,
    display: 'flex',
    gap: mobileTokens.space.sm,
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.md}px`,
    background: 'rgba(15,15,30,0.96)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  addInput: {
    flex: 1,
    height: mobileTokens.tap,
    padding: `0 ${mobileTokens.space.md}px`,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.base,
    outline: 'none',
    fontFamily: 'inherit',
  },
  addBtn: {
    minWidth: mobileTokens.tap,
    height: mobileTokens.tap,
    border: 'none',
    borderRadius: mobileTokens.radius.md,
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    color: '#fff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'inherit',
  },
};

const editStyles = {
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.lg,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  fieldLabel: {
    fontSize: mobileTokens.font.xs,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  input: {
    height: mobileTokens.tap,
    padding: `0 ${mobileTokens.space.md}px`,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.base,
    outline: 'none',
    fontFamily: 'inherit',
  },
  textarea: {
    padding: mobileTokens.space.md,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.base,
    outline: 'none',
    fontFamily: 'inherit',
    resize: 'vertical',
    minHeight: 72,
  },
  actionRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: mobileTokens.space.sm,
  },
  deleteBtn: {
    padding: `${mobileTokens.space.sm}px ${mobileTokens.space.md}px`,
    minHeight: mobileTokens.tap,
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.25)',
    borderRadius: mobileTokens.radius.md,
    color: '#fca5a5',
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  cancelBtn: {
    padding: `${mobileTokens.space.sm}px ${mobileTokens.space.md}px`,
    minHeight: mobileTokens.tap,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.md,
    color: '#e2e8f0',
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  saveBtn: {
    padding: `${mobileTokens.space.sm}px ${mobileTokens.space.lg}px`,
    minHeight: mobileTokens.tap,
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    border: 'none',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};
