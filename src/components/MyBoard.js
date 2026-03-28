import React, { useState, useEffect, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { supabase } from '../supabaseClient';

const COLUMNS = [
  { id: 'inbox', label: 'Inbox', color: '#a78bfa' },
  { id: 'backlog', label: 'Backlog', color: '#f97316' },
  { id: 'today', label: 'Today', color: '#f59e0b' },
  { id: 'this_week', label: 'This Week', color: '#3b82f6' },
  { id: 'done', label: 'Done', color: '#22c55e' },
];

const CATEGORY_OPTIONS = [
  { value: 'administration', label: 'Administration', color: '#3b82f6' },
  { value: 'business_development', label: 'Business Dev', color: '#f97316' },
  { value: 'communication', label: 'Communication', color: '#f59e0b' },
  { value: 'creative', label: 'Creative', color: '#ec4899' },
  { value: 'production', label: 'Production', color: '#22c55e' },
];

const SUBCATEGORY_OPTIONS = [
  { value: 'task', label: 'Task' },
  { value: 'idea', label: 'Idea' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'document', label: 'Document' },
];

const PROJECT_STATUSES = ['concept', 'script', 'production', 'edit', 'review', 'published'];

const EVENT_TYPE_COLORS = {
  deadline: '#ef4444', meeting: '#3b82f6', live_recording: '#22c55e',
  filming: '#f59e0b', video_post: '#a855f7', unavailable: '#6b7280',
  sponsor: '#10b981',
};
const EVENT_TYPE_LABELS = {
  deadline: 'Deadline', meeting: 'Meeting', live_recording: 'Live/Recording',
  filming: 'Filming', video_post: 'Video Post', unavailable: 'Unavailable',
  sponsor: 'Sponsor',
};
const EVENT_TYPE_ICONS = {
  deadline: '\u23F0', meeting: '\uD83D\uDC65', live_recording: '\uD83D\uDD34',
  filming: '\uD83C\uDFAC', video_post: '\uD83D\uDCF9', unavailable: '\uD83D\uDEAB',
  sponsor: '\uD83E\uDD1D',
};

const POINT_COLORS = { '15': '#ef4444', '10': '#f97316', '6': '#f59e0b', '3': '#3b82f6', '1': '#6b7280' };
const PRIORITY_OPTIONS = [
  { value: null, label: 'None', points: 0 },
  { value: '1', label: '1 pt', points: 1 },
  { value: '3', label: '3 pts', points: 3 },
  { value: '6', label: '6 pts', points: 6 },
  { value: '10', label: '10 pts', points: 10 },
  { value: '15', label: '15 pts', points: 15 },
];

// ─── TaskCard ───────────────────────────────────────────────
function TaskCard({ task, index, onClick, projectsMap, campaignsMap, activeSprint }) {
  const cat = CATEGORY_OPTIONS.find(c => c.value === task.category);
  const subcat = SUBCATEGORY_OPTIONS.find(c => c.value === task.subcategory);
  const priorityColor = task.priority ? POINT_COLORS[task.priority] : null;
  const inSprint = activeSprint && task.sprint_id === activeSprint.id;

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => onClick(task)}
          style={{
            ...cardStyle,
            borderLeft: priorityColor ? `3px solid ${priorityColor}` : '3px solid transparent',
            ...(inSprint ? { borderRight: '3px solid #6366f1' } : {}),
            ...(snapshot.isDragging ? { boxShadow: '0 8px 24px rgba(0,0,0,0.4)', border: '1px solid rgba(99,102,241,0.3)', borderLeft: priorityColor ? `3px solid ${priorityColor}` : '3px solid rgba(99,102,241,0.3)' } : {}),
            ...provided.draggableProps.style,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
            <div style={{ fontSize: '13px', color: '#e2e8f0', lineHeight: '1.4', wordBreak: 'break-word', flex: 1 }}>
              {task.content}
            </div>
            {task.priority && (
              <span style={{ fontSize: '10px', fontWeight: 700, color: POINT_COLORS[task.priority], flexShrink: 0, lineHeight: '1.4' }}>
                {task.priority}pt
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
            {inSprint && (
              <span style={{ fontSize: '9px', padding: '1px 5px', borderRadius: '4px', background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', fontWeight: 700, letterSpacing: '0.3px' }}>
                SPRINT
              </span>
            )}
            {cat && (
              <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: `${cat.color}22`, color: cat.color, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {cat.label}
              </span>
            )}
            {subcat && (
              <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>
                {subcat.label}
              </span>
            )}
            {task.due_date && (
              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
                {new Date(task.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}
            {task.project_id && projectsMap[task.project_id] && (
              <span style={{ fontSize: '10px', color: '#a5b4fc', background: 'rgba(99,102,241,0.15)', padding: '1px 5px', borderRadius: '4px' }}>
                {projectsMap[task.project_id]}
              </span>
            )}
            {task.campaign_id && campaignsMap[task.campaign_id] && (
              <span style={{ fontSize: '10px', color: '#10b981', background: 'rgba(16,185,129,0.15)', padding: '1px 5px', borderRadius: '4px' }}>
                {campaignsMap[task.campaign_id]}
              </span>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
}

// ─── ScheduleCard (auto-generated from calendar events) ────
function ScheduleCard({ event, index, onClick }) {
  const typeColor = EVENT_TYPE_COLORS[event.event_type] || '#6b7280';
  const typeLabel = EVENT_TYPE_LABELS[event.event_type] || event.event_type;
  const typeIcon = EVENT_TYPE_ICONS[event.event_type] || '';

  let timeStr = 'All day';
  if (!event.all_day) {
    const start = new Date(event.start_date);
    const end = new Date(event.end_date);
    const fmt = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    timeStr = `${fmt(start)} – ${fmt(end)}`;
  }

  return (
    <Draggable draggableId={`sched-${event.id}`} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => onClick(event)}
          style={{
            ...cardStyle,
            borderLeft: `3px solid ${typeColor}`,
            background: `${typeColor}0a`,
            opacity: 0.95,
            ...(snapshot.isDragging ? { boxShadow: '0 8px 24px rgba(0,0,0,0.4)', border: `1px solid ${typeColor}40` } : {}),
            ...provided.draggableProps.style,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
            <span style={{ fontSize: '12px' }}>{typeIcon}</span>
            <span style={{ fontSize: '13px', color: '#e2e8f0', lineHeight: '1.4', fontWeight: 500 }}>
              {event.title}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '10px', padding: '1px 6px', borderRadius: '4px',
              background: `${typeColor}22`, color: typeColor,
              fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px',
            }}>
              {typeLabel}
            </span>
            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
              {timeStr}
            </span>
          </div>
        </div>
      )}
    </Draggable>
  );
}

// ─── EventDetailModal ───────────────────────────────────────
function EventDetailModal({ event, onClose, onSave, onDelete }) {
  const isGoogle = event.source === 'google';
  const formatDTLocal = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const [form, setForm] = useState({
    title: event.title || '',
    event_type: event.event_type || 'meeting',
    all_day: event.all_day || false,
    start_local: formatDTLocal(event.start_date),
    end_local: formatDTLocal(event.end_date),
  });

  function handleSave() {
    onSave(event.id, {
      title: form.title.trim(),
      event_type: form.event_type,
      all_day: form.all_day,
      start_date: form.start_local ? new Date(form.start_local).toISOString() : event.start_date,
      end_date: form.end_local ? new Date(form.end_local).toISOString() : event.end_date,
    });
    onClose();
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', color: '#fff', fontWeight: 600 }}>
            {isGoogle ? 'Event Details' : 'Edit Event'}
          </h3>
          <button onClick={onClose} style={closeBtnStyle}>✕</button>
        </div>

        {isGoogle && (
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginBottom: '12px', fontStyle: 'italic' }}>
            Synced from Google Calendar — edit in Google Calendar to make changes
          </div>
        )}

        <label style={labelStyle}>Title</label>
        <input
          value={form.title}
          onChange={e => setForm({ ...form, title: e.target.value })}
          disabled={isGoogle}
          style={{ ...inputStyle, opacity: isGoogle ? 0.6 : 1 }}
        />

        <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Event Type</label>
            <select
              value={form.event_type}
              onChange={e => setForm({ ...form, event_type: e.target.value })}
              disabled={isGoogle}
              style={{ ...inputStyle, opacity: isGoogle ? 0.6 : 1 }}
            >
              {Object.entries(EVENT_TYPE_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', paddingBottom: '2px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'rgba(255,255,255,0.6)', fontSize: '13px', cursor: isGoogle ? 'default' : 'pointer' }}>
              <input
                type="checkbox"
                checked={form.all_day}
                onChange={e => setForm({ ...form, all_day: e.target.checked })}
                disabled={isGoogle}
              />
              All Day
            </label>
          </div>
        </div>

        {!form.all_day && (
          <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Start</label>
              <input
                type="datetime-local"
                value={form.start_local}
                onChange={e => setForm({ ...form, start_local: e.target.value })}
                disabled={isGoogle}
                style={{ ...inputStyle, opacity: isGoogle ? 0.6 : 1 }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>End</label>
              <input
                type="datetime-local"
                value={form.end_local}
                onChange={e => setForm({ ...form, end_local: e.target.value })}
                disabled={isGoogle}
                style={{ ...inputStyle, opacity: isGoogle ? 0.6 : 1 }}
              />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: isGoogle ? 'flex-end' : 'space-between', marginTop: '20px' }}>
          {!isGoogle && (
            <button onClick={() => { onDelete(event.id); onClose(); }} style={deleteBtnStyle}>Delete</button>
          )}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={onClose} style={cancelBtnStyle}>{isGoogle ? 'Close' : 'Cancel'}</button>
            {!isGoogle && (
              <button onClick={handleSave} disabled={!form.title.trim()} style={{ ...saveBtnStyle, opacity: form.title.trim() ? 1 : 0.4 }}>Save</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── TaskDetailModal ────────────────────────────────────────
function TaskDetailModal({ task, onClose, onSave, onDelete, projects, concepts, campaigns, activeSprint, onMoveToBacklog }) {
  const [form, setForm] = useState({
    content: task.content,
    category: task.category || 'administration',
    subcategory: task.subcategory || 'task',
    priority: task.priority || null,
    due_date: task.due_date || '',
    project_id: task.project_id || '',
    concept_id: task.concept_id || '',
    campaign_id: task.campaign_id || '',
  });

  function handleSave() {
    onSave(task.id, {
      content: form.content.trim(),
      category: form.category,
      subcategory: form.subcategory,
      priority: form.priority || null,
      due_date: form.due_date || null,
      project_id: form.project_id || null,
      concept_id: form.concept_id || null,
      campaign_id: form.campaign_id || null,
    });
    onClose();
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', color: '#fff', fontWeight: 600 }}>Edit Task</h3>
          <button onClick={onClose} style={closeBtnStyle}>✕</button>
        </div>

        {/* Content */}
        <label style={labelStyle}>Content</label>
        <textarea
          value={form.content}
          onChange={e => setForm({ ...form, content: e.target.value })}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
        />

        {/* Category + Subcategory + Priority row */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Category</label>
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} style={inputStyle}>
              {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Subcategory</label>
            <select value={form.subcategory} onChange={e => setForm({ ...form, subcategory: e.target.value })} style={inputStyle}>
              {SUBCATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Priority</label>
            <select value={form.priority || ''} onChange={e => setForm({ ...form, priority: e.target.value || null })} style={inputStyle}>
              {PRIORITY_OPTIONS.map(o => <option key={o.value || 'none'} value={o.value || ''}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {/* Due date */}
        <div style={{ marginTop: '12px' }}>
          <label style={labelStyle}>Due Date</label>
          <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} style={inputStyle} />
        </div>

        {/* Project link */}
        <div style={{ marginTop: '12px' }}>
          <label style={labelStyle}>Project</label>
          <select value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value })} style={inputStyle}>
            <option value="">None</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {/* Concept link */}
        <div style={{ marginTop: '12px' }}>
          <label style={labelStyle}>Concept</label>
          <select value={form.concept_id} onChange={e => setForm({ ...form, concept_id: e.target.value })} style={inputStyle}>
            <option value="">None</option>
            {concepts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* Sponsor Campaign link */}
        <div style={{ marginTop: '12px' }}>
          <label style={labelStyle}>Sponsor Campaign</label>
          <select value={form.campaign_id} onChange={e => setForm({ ...form, campaign_id: e.target.value })} style={inputStyle}>
            <option value="">None</option>
            {campaigns.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>

        {/* Sprint / Backlog controls */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' }}>
          {task.status !== 'backlog' && (
            <button
              onClick={() => { onMoveToBacklog(task.id); onClose(); }}
              style={{ background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '6px', padding: '6px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
            >
              Move to Backlog
            </button>
          )}
          {activeSprint && !task.sprint_id && task.status !== 'backlog' && (
            <button
              onClick={() => { onSave(task.id, { sprint_id: activeSprint.id }); onClose(); }}
              style={{ background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '6px', padding: '6px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
            >
              Add to Sprint
            </button>
          )}
          {activeSprint && task.sprint_id === activeSprint.id && (
            <span style={{ fontSize: '10px', padding: '4px 10px', borderRadius: '6px', background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
              🏃 In Sprint
              <button
                onClick={() => { onSave(task.id, { sprint_id: null }); onClose(); }}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: '12px', padding: '0 2px' }}
              >
                ×
              </button>
            </span>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '14px' }}>
          <button onClick={() => { onDelete(task.id); onClose(); }} style={deleteBtnStyle}>Delete</button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={onClose} style={cancelBtnStyle}>Cancel</button>
            <button onClick={handleSave} disabled={!form.content.trim()} style={{ ...saveBtnStyle, opacity: form.content.trim() ? 1 : 0.4 }}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MyBoard (main export) ──────────────────────────────────
export default function MyBoard({ profile, onNavigate, todayEvents = [], onBoardChange, sprintVersion }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTaskText, setNewTaskText] = useState('');
  const [editingTask, setEditingTask] = useState(null);
  const [projects, setProjects] = useState([]);
  const [concepts, setConcepts] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [showAllDone, setShowAllDone] = useState(false);
  const [eventColumns, setEventColumns] = useState({});
  const [editingEvent, setEditingEvent] = useState(null);
  const [eventOverrides, setEventOverrides] = useState({});
  const [activeSprint, setActiveSprint] = useState(null);

  // ── Fetch active sprint ──
  useEffect(() => {
    if (!profile?.id) return;
    supabase
      .from('sprints')
      .select('id')
      .eq('user_id', profile.id)
      .eq('status', 'active')
      .maybeSingle()
      .then(({ data }) => { if (data) setActiveSprint(data); });
  }, [profile?.id]);

  // Merge local overrides into events and compute column placement
  const mergedEvents = todayEvents.map(evt => ({ ...evt, ...(eventOverrides[evt.id] || {}) }));

  const getColumnEvents = useCallback((columnId) => {
    return mergedEvents.filter(evt => (eventColumns[evt.id] || 'today') === columnId);
  }, [mergedEvents, eventColumns]);

  const projectsMap = {};
  projects.forEach(p => { projectsMap[p.id] = p.name; });
  const campaignsMap = {};
  campaigns.forEach(c => { campaignsMap[c.id] = c.label; });

  // ── Fetch tasks ──
  const fetchTasks = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const { data, error } = await supabase
        .from('personal_tasks')
        .select('*')
        .eq('created_by', profile.id)
        .order('position', { ascending: true });
      if (error) throw error;
      setTasks(data || []);
    } catch (err) {
      console.error('Error fetching personal tasks:', err);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  // ── Fetch projects + concepts + campaigns for linking ──
  useEffect(() => {
    async function fetchMeta() {
      const [projRes, concRes, campRes] = await Promise.all([
        supabase.from('projects').select('id, name').eq('is_archived', false).order('name'),
        supabase.from('concepts').select('id, name').order('name'),
        supabase.from('sponsor_campaigns').select('id, name, sponsor_id, sponsors(name)').order('name'),
      ]);
      if (projRes.data) setProjects(projRes.data);
      if (concRes.data) setConcepts(concRes.data);
      if (campRes.data) setCampaigns(campRes.data.map(c => ({
        id: c.id, name: c.name, sponsor_id: c.sponsor_id,
        label: `${c.sponsors?.name || 'Sponsor'} — ${c.name}`,
      })));
    }
    fetchMeta();
  }, []);

  useEffect(() => {
    if (profile?.id) fetchTasks();
  }, [profile?.id, fetchTasks, sprintVersion]);

  // ── Quick capture ──
  async function addTask() {
    if (!newTaskText.trim() || !profile?.id) return;
    const content = newTaskText.trim();

    // Calculate next position in inbox
    const inboxTasks = tasks.filter(t => t.status === 'inbox');
    const maxPos = inboxTasks.length > 0 ? Math.max(...inboxTasks.map(t => t.position)) : 0;

    const tempTask = {
      id: `temp-${Date.now()}`,
      created_by: profile.id,
      content,
      category: 'task',
      priority: null,
      status: 'inbox',
      due_date: null,
      project_id: null,
      concept_id: null,
      position: maxPos + 10,
      completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setNewTaskText('');
    setTasks(prev => [...prev, tempTask]);

    try {
      const { error } = await supabase.from('personal_tasks').insert({
        created_by: profile.id,
        content,
        position: maxPos + 10,
      });
      if (error) throw error;
      fetchTasks();
    } catch (err) {
      console.error('Error adding task:', err);
      setTasks(prev => prev.filter(t => t.id !== tempTask.id));
      setNewTaskText(content);
    }
  }

  // ── Update task ──
  async function updateTask(id, updates) {
    const prev = tasks;
    setTasks(ts => ts.map(t => t.id === id ? { ...t, ...updates, updated_at: new Date().toISOString() } : t));
    try {
      const { error } = await supabase
        .from('personal_tasks')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    } catch (err) {
      console.error('Error updating task:', err);
      setTasks(prev);
    }
  }

  // ── Delete task ──
  async function deleteTask(id) {
    const prev = tasks;
    setTasks(ts => ts.filter(t => t.id !== id));
    try {
      const { error } = await supabase.from('personal_tasks').delete().eq('id', id);
      if (error) throw error;
    } catch (err) {
      console.error('Error deleting task:', err);
      setTasks(prev);
    }
  }

  // ── Update calendar event ──
  async function updateEvent(id, updates) {
    setEventOverrides(prev => ({ ...prev, [id]: updates }));
    try {
      const { error } = await supabase
        .from('calendar_events')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    } catch (err) {
      console.error('Error updating event:', err);
    }
  }

  // ── Delete calendar event ──
  async function deleteEvent(id) {
    setEventOverrides(prev => { const next = { ...prev }; delete next[id]; return next; });
    setEventColumns(prev => { const next = { ...prev }; delete next[id]; return next; });
    try {
      const { error } = await supabase.from('calendar_events').delete().eq('id', id);
      if (error) throw error;
    } catch (err) {
      console.error('Error deleting event:', err);
    }
  }

  // ── Move task to backlog ──
  async function moveToBacklog(id) {
    const prev = tasks;
    setTasks(ts => ts.filter(t => t.id !== id));
    try {
      const { error } = await supabase
        .from('personal_tasks')
        .update({ status: 'backlog', sprint_id: null, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      if (onBoardChange) onBoardChange();
    } catch (err) {
      console.error('Error moving task to backlog:', err);
      setTasks(prev);
    }
  }

  // ── Auto-advance project stage ──
  async function advanceProjectStage(projectId, expectedStage) {
    try {
      const { data: project, error } = await supabase
        .from('projects')
        .select('id, status')
        .eq('id', projectId)
        .single();
      if (error || !project) return;
      if (project.status !== expectedStage) return; // stale task
      const currentIndex = PROJECT_STATUSES.indexOf(project.status);
      if (currentIndex < 0 || currentIndex >= PROJECT_STATUSES.length - 1) return; // already published
      const nextStatus = PROJECT_STATUSES[currentIndex + 1];
      await supabase.from('projects').update({ status: nextStatus }).eq('id', projectId);
    } catch (err) {
      console.error('Error advancing project stage:', err);
    }
  }

  // ── Drag-and-drop handler ──
  function onDragEnd(result) {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    // Handle schedule event cards (column move only, no DB persistence)
    if (draggableId.startsWith('sched-')) {
      const eventId = draggableId.replace('sched-', '');
      setEventColumns(prev => ({ ...prev, [eventId]: destination.droppableId }));
      return;
    }

    // Handle drop onto sprint zone
    if (destination.droppableId === 'sprint') {
      if (!activeSprint) return;
      const task = tasks.find(t => t.id === draggableId);
      if (!task) return;
      updateTask(draggableId, { sprint_id: activeSprint.id, status: 'this_week' });
      if (onBoardChange) onBoardChange();
      return;
    }

    const newStatus = destination.droppableId;
    const task = tasks.find(t => t.id === draggableId);
    if (!task) return;

    // Adjust destination index to account for event cards above tasks
    const destEventCount = getColumnEvents(newStatus).length;
    const adjustedIndex = Math.max(0, destination.index - destEventCount);

    // Build new column task list for position calculation
    const destTasks = tasks
      .filter(t => t.status === newStatus && t.id !== draggableId)
      .sort((a, b) => a.position - b.position);

    // Insert at adjusted destination index
    let newPosition;
    if (destTasks.length === 0) {
      newPosition = 10;
    } else if (adjustedIndex === 0) {
      newPosition = destTasks[0].position - 10;
    } else if (adjustedIndex >= destTasks.length) {
      newPosition = destTasks[destTasks.length - 1].position + 10;
    } else {
      newPosition = Math.floor((destTasks[adjustedIndex - 1].position + destTasks[adjustedIndex].position) / 2);
    }

    const updates = {
      status: newStatus,
      position: newPosition,
      ...(newStatus === 'done' && !task.completed_at ? { completed_at: new Date().toISOString() } : {}),
      ...(newStatus !== 'done' ? { completed_at: null } : {}),
    };

    updateTask(draggableId, updates);

    if (newStatus === 'done' && task.project_id && task.project_stage) {
      advanceProjectStage(task.project_id, task.project_stage);
    }
  }

  // ── Filter done tasks (hide >7 days old unless toggled) ──
  function getVisibleTasks(columnId) {
    const colTasks = tasks.filter(t => t.status === columnId).sort((a, b) => a.position - b.position);
    if (columnId !== 'done' || showAllDone) return colTasks;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    return colTasks.filter(t => !t.completed_at || new Date(t.completed_at) >= sevenDaysAgo);
  }

  function getDoneHiddenCount() {
    const allDone = tasks.filter(t => t.status === 'done');
    const visible = getVisibleTasks('done');
    return allDone.length - visible.length;
  }

  if (loading) {
    return (
      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>My Board</h2>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px' }}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={sectionStyle}>
      <h2 style={sectionTitleStyle}>My Board</h2>

      {/* Quick capture */}
      <div style={captureRowStyle}>
        <input
          value={newTaskText}
          onChange={e => setNewTaskText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addTask()}
          placeholder="Drop a task, idea, or note..."
          style={captureInputStyle}
        />
        <button
          onClick={addTask}
          disabled={!newTaskText.trim()}
          style={{ ...captureButtonStyle, opacity: newTaskText.trim() ? 1 : 0.4 }}
        >
          Add
        </button>
      </div>

      {/* Kanban columns */}
      <DragDropContext onDragEnd={onDragEnd}>
        {/* Sprint + Backlog drop zones */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
          {activeSprint && (
            <Droppable droppableId="sprint" direction="horizontal">
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  style={{
                    flex: 1,
                    border: `2px dashed ${snapshot.isDraggingOver ? '#6366f1' : 'rgba(99,102,241,0.2)'}`,
                    borderRadius: '10px',
                    padding: '10px 16px',
                    textAlign: 'center',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: snapshot.isDraggingOver ? '#a5b4fc' : 'rgba(99,102,241,0.4)',
                    background: snapshot.isDraggingOver ? 'rgba(99,102,241,0.08)' : 'transparent',
                    transition: 'all 0.15s',
                    minHeight: '20px',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  Drop to add to sprint
                  <div style={{ position: 'absolute', left: -9999 }}>{provided.placeholder}</div>
                </div>
              )}
            </Droppable>
          )}
        </div>
        <div style={boardStyle}>
          {COLUMNS.map(col => {
            const colTasks = getVisibleTasks(col.id);
            const colEvents = getColumnEvents(col.id);
            const totalCount = tasks.filter(t => t.status === col.id).length + colEvents.length;
            const hiddenCount = col.id === 'done' ? getDoneHiddenCount() : 0;

            return (
              <Droppable droppableId={col.id} key={col.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    style={{
                      ...columnStyle,
                      background: snapshot.isDraggingOver ? 'rgba(99,102,241,0.06)' : 'rgba(255,255,255,0.02)',
                    }}
                  >
                    {/* Column header */}
                    <div style={columnHeaderStyle}>
                      <div style={{ ...columnDotStyle, background: col.color }} />
                      <span style={{ fontSize: '12px', fontWeight: 700, color: col.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {col.label}
                      </span>
                      <span style={columnCountStyle}>{totalCount}</span>
                    </div>

                    {/* Cards */}
                    <div style={columnBodyStyle}>
                      {/* Schedule event cards (draggable across columns) */}
                      {colEvents.map((evt, i) => (
                        <ScheduleCard key={`sched-${evt.id}`} event={evt} index={i} onClick={setEditingEvent} />
                      ))}
                      {colTasks.map((task, i) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          index={colEvents.length + i}
                          onClick={setEditingTask}
                          projectsMap={projectsMap}
                          campaignsMap={campaignsMap}
                          activeSprint={activeSprint}
                        />
                      ))}
                      {provided.placeholder}

                      {/* Show all toggle for Done column */}
                      {col.id === 'done' && hiddenCount > 0 && (
                        <button
                          onClick={() => setShowAllDone(!showAllDone)}
                          style={showAllBtnStyle}
                        >
                          {showAllDone ? 'Show recent only' : `Show ${hiddenCount} older`}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </Droppable>
            );
          })}
        </div>
      </DragDropContext>

      {/* Detail modals */}
      {editingTask && (
        <TaskDetailModal
          task={editingTask}
          onClose={() => setEditingTask(null)}
          onSave={updateTask}
          onDelete={deleteTask}
          projects={projects}
          concepts={concepts}
          campaigns={campaigns}
          activeSprint={activeSprint}
          onMoveToBacklog={moveToBacklog}
        />
      )}
      {editingEvent && (
        <EventDetailModal
          event={editingEvent}
          onClose={() => setEditingEvent(null)}
          onSave={updateEvent}
          onDelete={deleteEvent}
        />
      )}
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────
const sectionStyle = {
  marginBottom: '32px',
};

const sectionTitleStyle = {
  fontSize: '18px',
  fontWeight: 700,
  color: '#fff',
  marginBottom: '16px',
};

const captureRowStyle = {
  display: 'flex',
  gap: '8px',
  marginBottom: '16px',
};

const captureInputStyle = {
  flex: 1,
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '10px',
  padding: '10px 14px',
  color: '#fff',
  fontSize: '13px',
  outline: 'none',
};

const captureButtonStyle = {
  background: '#6366f1',
  color: '#fff',
  border: 'none',
  borderRadius: '10px',
  padding: '10px 20px',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};

const boardStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, 1fr)',
  gap: '12px',
};

const columnStyle = {
  borderRadius: '10px',
  border: '1px solid rgba(255,255,255,0.06)',
  minHeight: '200px',
  display: 'flex',
  flexDirection: 'column',
};

const columnHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '12px 12px 8px',
};

const columnDotStyle = {
  width: '8px',
  height: '8px',
  borderRadius: '50%',
};

const columnCountStyle = {
  fontSize: '11px',
  color: 'rgba(255,255,255,0.3)',
  marginLeft: 'auto',
};

const columnBodyStyle = {
  flex: 1,
  padding: '4px 8px 8px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const cardStyle = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: '8px',
  padding: '10px 10px 8px',
  cursor: 'pointer',
  transition: 'background 0.15s',
};

const showAllBtnStyle = {
  background: 'none',
  border: 'none',
  color: 'rgba(255,255,255,0.35)',
  fontSize: '11px',
  cursor: 'pointer',
  padding: '6px 0',
  textAlign: 'center',
};

// Modal styles
const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const modalStyle = {
  background: '#1a1a2e',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '14px',
  padding: '24px',
  width: '440px',
  maxWidth: '90vw',
  maxHeight: '85vh',
  overflowY: 'auto',
};

const labelStyle = {
  display: 'block',
  fontSize: '11px',
  fontWeight: 600,
  color: 'rgba(255,255,255,0.45)',
  marginBottom: '4px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const inputStyle = {
  width: '100%',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '8px',
  padding: '8px 10px',
  color: '#fff',
  fontSize: '13px',
  outline: 'none',
  boxSizing: 'border-box',
};

const closeBtnStyle = {
  background: 'none',
  border: 'none',
  color: 'rgba(255,255,255,0.4)',
  fontSize: '18px',
  cursor: 'pointer',
  padding: '4px 8px',
};

const deleteBtnStyle = {
  background: 'rgba(239,68,68,0.15)',
  color: '#ef4444',
  border: '1px solid rgba(239,68,68,0.2)',
  borderRadius: '8px',
  padding: '8px 16px',
  fontSize: '13px',
  cursor: 'pointer',
};

const cancelBtnStyle = {
  background: 'rgba(255,255,255,0.05)',
  color: 'rgba(255,255,255,0.6)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '8px',
  padding: '8px 16px',
  fontSize: '13px',
  cursor: 'pointer',
};

const saveBtnStyle = {
  background: '#6366f1',
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  padding: '8px 20px',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};
