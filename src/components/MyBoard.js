import React, { useState, useEffect, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { supabase } from '../supabaseClient';
import SprintGoals from './SprintGoals';
import SprintRetroModal from './SprintRetroModal';

const SPRINT_COLUMNS = [
  { id: 'ready', label: 'Ready', color: '#3b82f6' },
  { id: 'in_progress', label: 'In Progress', color: '#f59e0b' },
  { id: 'holding', label: 'Holding', color: '#f97316' },
  { id: 'done', label: 'Done', color: '#22c55e' },
];

const BUCKET_COLUMNS = [
  { id: 'inbox', label: 'Inbox', color: '#a78bfa' },
  { id: 'backlog', label: 'Backlog', color: '#f97316' },
];

const ALL_COLUMNS = [...SPRINT_COLUMNS, ...BUCKET_COLUMNS];

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

const POINT_COLORS = { '15': '#ef4444', '10': '#f97316', '6': '#f59e0b', '3': '#3b82f6', '1': '#6b7280' };
const PRIORITY_OPTIONS = [
  { value: null, label: 'None', points: 0 },
  { value: '1', label: '1 pt', points: 1 },
  { value: '3', label: '3 pts', points: 3 },
  { value: '6', label: '6 pts', points: 6 },
  { value: '10', label: '10 pts', points: 10 },
  { value: '15', label: '15 pts', points: 15 },
];

// ─── Week helpers ──────────────────────────────────────────
function getSprintWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: monday.toISOString().split('T')[0],
    end: sunday.toISOString().split('T')[0],
  };
}

function offsetWeek(startDate, offset) {
  const d = new Date(startDate + 'T00:00:00');
  d.setDate(d.getDate() + offset * 7);
  return getSprintWeek(d);
}

function fmtWeekRange(start, end) {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(s)} \u2013 ${fmt(e)}`;
}

function isCurrentWeek(start) {
  const current = getSprintWeek();
  return current.start === start;
}

// ─── TaskCard ───────────────────────────────────────────────
function TaskCard({ task, index, onClick, projectsMap, campaignsMap, readOnly }) {
  const cat = CATEGORY_OPTIONS.find(c => c.value === task.category);
  const subcat = SUBCATEGORY_OPTIONS.find(c => c.value === task.subcategory);
  const priorityColor = task.priority ? POINT_COLORS[task.priority] : null;

  return (
    <Draggable draggableId={task.id} index={index} isDragDisabled={readOnly}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => !readOnly && onClick(task)}
          style={{
            ...cardStyle,
            borderLeft: priorityColor ? `3px solid ${priorityColor}` : '3px solid transparent',
            ...(readOnly ? { opacity: 0.6, cursor: 'default' } : {}),
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

// ─── TaskDetailModal ────────────────────────────────────────
function TaskDetailModal({ task, onClose, onSave, onDelete, projects, concepts, campaigns, activeSprint }) {
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
          <button onClick={onClose} style={closeBtnStyle}>{'\u2715'}</button>
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

        {/* Sprint controls */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' }}>
          {activeSprint && !task.sprint_id && (
            <button
              onClick={() => { onSave(task.id, { sprint_id: activeSprint.id, status: 'ready' }); onClose(); }}
              style={{ background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '6px', padding: '6px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
            >
              Add to Sprint
            </button>
          )}
          {activeSprint && task.sprint_id === activeSprint.id && (
            <span style={{ fontSize: '10px', padding: '4px 10px', borderRadius: '6px', background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
              In Sprint
              <button
                onClick={() => { onSave(task.id, { sprint_id: null, status: 'backlog' }); onClose(); }}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: '12px', padding: '0 2px' }}
              >
                \u00d7
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
export default function MyBoard({ profile, onNavigate, onBoardChange, sprintVersion }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTaskText, setNewTaskText] = useState('');
  const [editingTask, setEditingTask] = useState(null);
  const [projects, setProjects] = useState([]);
  const [concepts, setConcepts] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [showAllDone, setShowAllDone] = useState(false);

  // Sprint state
  const [selectedWeek, setSelectedWeek] = useState(getSprintWeek());
  const [sprintForWeek, setSprintForWeek] = useState(null);
  const [sprintLoading, setSprintLoading] = useState(true);

  // Plan a Sprint state
  const [planExpanded, setPlanExpanded] = useState(false);
  const [planWeek, setPlanWeek] = useState(() => offsetWeek(getSprintWeek().start, 1));
  const [planSprint, setPlanSprint] = useState(null);
  const [planGoals, setPlanGoals] = useState([]);

  // Retro modal state
  const [showRetro, setShowRetro] = useState(false);
  const [closeResult, setCloseResult] = useState(null);

  const isViewingCurrentWeek = isCurrentWeek(selectedWeek.start);
  const isArchived = sprintForWeek && sprintForWeek.status === 'completed';
  const activeSprint = sprintForWeek && sprintForWeek.status === 'active' ? sprintForWeek : null;

  const projectsMap = {};
  projects.forEach(p => { projectsMap[p.id] = p.name; });
  const campaignsMap = {};
  campaigns.forEach(c => { campaignsMap[c.id] = c.label; });

  // ── Fetch sprint for selected week ──
  const fetchSprintForWeek = useCallback(async () => {
    if (!profile?.id) return;
    setSprintLoading(true);
    const { data, error } = await supabase
      .from('sprints')
      .select('*')
      .eq('user_id', profile.id)
      .eq('start_date', selectedWeek.start)
      .maybeSingle();
    if (!error) setSprintForWeek(data);
    setSprintLoading(false);
  }, [profile?.id, selectedWeek.start]);

  // ── Fetch plan sprint (for Plan a Sprint section) ──
  const fetchPlanSprint = useCallback(async () => {
    if (!profile?.id) return;
    const { data, error } = await supabase
      .from('sprints')
      .select('*')
      .eq('user_id', profile.id)
      .eq('start_date', planWeek.start)
      .maybeSingle();
    if (!error) setPlanSprint(data);
  }, [profile?.id, planWeek.start]);

  const fetchPlanGoals = useCallback(async () => {
    if (!planSprint) { setPlanGoals([]); return; }
    const { data, error } = await supabase
      .from('sprint_goals')
      .select('*')
      .eq('sprint_id', planSprint.id)
      .order('position');
    if (!error) setPlanGoals(data || []);
  }, [planSprint]);

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
        label: `${c.sponsors?.name || 'Sponsor'} \u2014 ${c.name}`,
      })));
    }
    fetchMeta();
  }, []);

  useEffect(() => { if (profile?.id) fetchTasks(); }, [profile?.id, fetchTasks, sprintVersion]);
  useEffect(() => { fetchSprintForWeek(); }, [fetchSprintForWeek]);
  useEffect(() => { fetchPlanSprint(); }, [fetchPlanSprint]);
  useEffect(() => { fetchPlanGoals(); }, [fetchPlanGoals]);

  // ── Week navigation ──
  function navigateWeek(offset) {
    setSelectedWeek(prev => offsetWeek(prev.start, offset));
  }

  // ── Start sprint for a week ──
  async function startSprint(week) {
    if (!profile?.id) return;
    const { error } = await supabase.from('sprints').insert({
      user_id: profile.id,
      start_date: week.start,
      end_date: week.end,
      status: 'active',
    });
    if (error) {
      console.error('Error starting sprint:', error);
      // If unique constraint, re-fetch to show existing sprint
      fetchSprintForWeek();
      fetchPlanSprint();
      return;
    }
    if (week.start === selectedWeek.start) {
      fetchSprintForWeek();
    }
    if (week.start === planWeek.start) {
      fetchPlanSprint();
      setPlanExpanded(false);
    }
    if (onBoardChange) onBoardChange();
  }

  // ── Complete sprint ──
  async function completeSprint() {
    if (!activeSprint) return;

    const { data: sprintTasks } = await supabase
      .from('personal_tasks')
      .select('id, status, priority')
      .eq('sprint_id', activeSprint.id);

    const pts = (t) => parseInt(t.priority) || 0;
    const completedPoints = (sprintTasks || []).filter(t => t.status === 'done').reduce((sum, t) => sum + pts(t), 0);
    const completedCount = (sprintTasks || []).filter(t => t.status === 'done').length;
    const incompleteTasks = (sprintTasks || []).filter(t => t.status !== 'done');

    // Update sprint: set velocity, archived_at, complete
    await supabase
      .from('sprints')
      .update({ status: 'completed', velocity: completedPoints, archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', activeSprint.id);

    // Roll incomplete tasks (ready, in_progress, holding) back to backlog
    if (incompleteTasks.length > 0) {
      await supabase
        .from('personal_tasks')
        .update({ sprint_id: null, status: 'backlog', updated_at: new Date().toISOString() })
        .in('id', incompleteTasks.map(t => t.id));
    }

    setCloseResult({ completedCount, completedPoints, rolledBackCount: incompleteTasks.length, sprint: { ...activeSprint } });
    setShowRetro(true);
  }

  function handleRetroSaved() {
    setShowRetro(false);
    setCloseResult(null);
    fetchSprintForWeek();
    fetchTasks();
    if (onBoardChange) onBoardChange();
  }

  // ── Quick capture ──
  async function addTask() {
    if (!newTaskText.trim() || !profile?.id) return;
    const content = newTaskText.trim();

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

  // ── Auto-advance project stage ──
  async function advanceProjectStage(projectId, expectedStage) {
    try {
      const { data: project, error } = await supabase
        .from('projects')
        .select('id, status')
        .eq('id', projectId)
        .single();
      if (error || !project) return;
      if (project.status !== expectedStage) return;
      const currentIndex = PROJECT_STATUSES.indexOf(project.status);
      if (currentIndex < 0 || currentIndex >= PROJECT_STATUSES.length - 1) return;
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

    const newStatus = destination.droppableId;
    const task = tasks.find(t => t.id === draggableId);
    if (!task) return;

    const adjustedIndex = destination.index;

    // Build new column task list for position calculation
    const destTasks = tasks
      .filter(t => t.status === newStatus && t.id !== draggableId)
      .sort((a, b) => a.position - b.position);

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

    const isSprint = ['ready', 'in_progress', 'holding', 'done'].includes(newStatus);
    const updates = {
      status: newStatus,
      position: newPosition,
      ...(newStatus === 'done' && !task.completed_at ? { completed_at: new Date().toISOString() } : {}),
      ...(newStatus !== 'done' ? { completed_at: null } : {}),
      // If dragging into a sprint column and there is an active sprint, assign sprint_id
      ...(isSprint && activeSprint && !task.sprint_id ? { sprint_id: activeSprint.id } : {}),
      // If dragging out of sprint columns to bucket columns, clear sprint_id
      ...(!isSprint && task.sprint_id ? { sprint_id: null } : {}),
    };

    updateTask(draggableId, updates);

    if (newStatus === 'done' && task.project_id && task.project_stage) {
      advanceProjectStage(task.project_id, task.project_stage);
    }

    if (onBoardChange) onBoardChange();
  }

  // ── Get visible tasks for a column ──
  function getVisibleTasks(columnId) {
    let colTasks = tasks.filter(t => t.status === columnId).sort((a, b) => a.position - b.position);

    // For sprint columns, only show tasks from the viewed sprint (or unassigned for current week)
    if (['ready', 'in_progress', 'holding', 'done'].includes(columnId) && sprintForWeek) {
      colTasks = colTasks.filter(t => t.sprint_id === sprintForWeek.id);
    }

    if (columnId !== 'done' || showAllDone) return colTasks;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return colTasks.filter(t => !t.completed_at || new Date(t.completed_at) >= sevenDaysAgo);
  }

  function getDoneHiddenCount() {
    const allDone = tasks.filter(t => t.status === 'done' && (!sprintForWeek || t.sprint_id === sprintForWeek.id));
    const visible = getVisibleTasks('done');
    return allDone.length - visible.length;
  }

  // ── Sprint task points for progress bar ──
  const sprintTaskPoints = (() => {
    if (!sprintForWeek) return { total: 0, completed: 0 };
    const sTasks = tasks.filter(t => t.sprint_id === sprintForWeek.id);
    const pts = (t) => parseInt(t.priority) || 0;
    return {
      total: sTasks.reduce((sum, t) => sum + pts(t), 0),
      completed: sTasks.filter(t => t.status === 'done').reduce((sum, t) => sum + pts(t), 0),
    };
  })();

  if (loading) {
    return (
      <div style={sectionStyle}>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px' }}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={sectionStyle}>
      {/* ── Header: Sprint title + week selector ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {isArchived && (
            <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Archived
            </span>
          )}
          {activeSprint && (
            <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Active
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button onClick={() => navigateWeek(-1)} style={weekNavBtnStyle}>{'\u2190'}</button>
          <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', fontWeight: 500, minWidth: '140px', textAlign: 'center' }}>
            {fmtWeekRange(selectedWeek.start, selectedWeek.end)}
          </span>
          <button onClick={() => navigateWeek(1)} style={weekNavBtnStyle}>{'\u2192'}</button>
          {!isViewingCurrentWeek && (
            <button onClick={() => setSelectedWeek(getSprintWeek())} style={{ ...weekNavBtnStyle, fontSize: '11px', padding: '4px 10px' }}>
              Today
            </button>
          )}
        </div>
      </div>

      {/* ── Sprint progress bar (when sprint exists) ── */}
      {sprintForWeek && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              background: '#6366f1',
              borderRadius: '3px',
              transition: 'width 0.3s ease',
              width: sprintTaskPoints.total > 0 ? `${(sprintTaskPoints.completed / sprintTaskPoints.total) * 100}%` : '0%',
            }} />
          </div>
          <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>
            {sprintTaskPoints.completed}/{sprintTaskPoints.total} pts
          </span>
          {activeSprint && (
            <button onClick={completeSprint} style={completeSprintBtnStyle}>
              Complete Sprint
            </button>
          )}
          {isArchived && sprintForWeek.velocity != null && (
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>
              Velocity: {sprintForWeek.velocity} pts
            </span>
          )}
        </div>
      )}

      {/* ── No sprint for this week ── */}
      {!sprintLoading && !sprintForWeek && isViewingCurrentWeek && (
        <div style={{ textAlign: 'center', padding: '16px', marginBottom: '12px' }}>
          <button onClick={() => startSprint(selectedWeek)} style={startSprintBtnStyle}>
            Start Sprint for This Week
          </button>
        </div>
      )}

      {/* ── Kanban: single DragDropContext for sprint + buckets ── */}
      <DragDropContext onDragEnd={onDragEnd}>
        {/* Sprint columns (4-column grid) */}
        <div style={sprintGridStyle}>
          {SPRINT_COLUMNS.map(col => {
            const colTasks = getVisibleTasks(col.id);
            const totalCount = colTasks.length;
            const hiddenCount = col.id === 'done' ? getDoneHiddenCount() : 0;

            return (
              <Droppable droppableId={col.id} key={col.id} isDropDisabled={isArchived}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    style={{
                      ...columnStyle,
                      background: snapshot.isDraggingOver ? 'rgba(99,102,241,0.06)' : 'rgba(255,255,255,0.02)',
                      ...(isArchived ? { opacity: 0.7 } : {}),
                    }}
                  >
                    <div style={columnHeaderStyle}>
                      <div style={{ ...columnDotStyle, background: col.color }} />
                      <span style={{ fontSize: '12px', fontWeight: 700, color: col.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {col.label}
                      </span>
                      <span style={columnCountStyle}>{totalCount}</span>
                    </div>
                    <div style={columnBodyStyle}>
                      {colTasks.map((task, i) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          index={i}
                          onClick={setEditingTask}
                          projectsMap={projectsMap}
                          campaignsMap={campaignsMap}
                          readOnly={isArchived}
                        />
                      ))}
                      {provided.placeholder}
                      {col.id === 'done' && hiddenCount > 0 && (
                        <button onClick={() => setShowAllDone(!showAllDone)} style={showAllBtnStyle}>
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

        {/* ── Plan a Sprint (collapsible) ── */}
        <div style={{ marginTop: '16px', marginBottom: '16px' }}>
          <button
            onClick={() => setPlanExpanded(!planExpanded)}
            style={{
              background: 'none', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px',
              color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontWeight: 600, padding: '8px 16px',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', width: '100%',
              justifyContent: 'center',
            }}
          >
            <span style={{ transform: planExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', display: 'inline-block' }}>
              {'\u25B6'}
            </span>
            Plan a Sprint
          </button>
          {planExpanded && (
            <div style={{ marginTop: '12px', padding: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px' }}>
              {/* Plan week selector */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '14px' }}>
                <button onClick={() => setPlanWeek(prev => offsetWeek(prev.start, -1))} style={weekNavBtnStyle}>{'\u2190'}</button>
                <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', fontWeight: 500, minWidth: '140px', textAlign: 'center' }}>
                  {fmtWeekRange(planWeek.start, planWeek.end)}
                </span>
                <button onClick={() => setPlanWeek(prev => offsetWeek(prev.start, 1))} style={weekNavBtnStyle}>{'\u2192'}</button>
              </div>

              {planSprint ? (
                <div>
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginBottom: '10px' }}>
                    Sprint already {planSprint.status === 'active' ? 'active' : 'exists'} for this week.
                  </div>
                  {planSprint.status !== 'completed' && (
                    <SprintGoals goals={planGoals} sprintId={planSprint.id} onUpdate={fetchPlanGoals} />
                  )}
                </div>
              ) : (
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', margin: '0 0 12px' }}>
                    No sprint planned for this week yet.
                  </p>
                  <button onClick={() => startSprint(planWeek)} style={startSprintBtnStyle}>
                    Start Sprint
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Quick capture (below Plan a Sprint) */}
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

        {/* ── Bucket columns (Inbox + Backlog side by side) ── */}
        <div style={bucketGridStyle}>
          {BUCKET_COLUMNS.map(col => {
            const colTasks = getVisibleTasks(col.id);
            const totalCount = colTasks.length;

            return (
              <Droppable droppableId={col.id} key={col.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    style={{
                      ...columnStyle,
                      background: snapshot.isDraggingOver ? 'rgba(99,102,241,0.06)' : 'rgba(255,255,255,0.02)',
                      minHeight: '120px',
                    }}
                  >
                    <div style={columnHeaderStyle}>
                      <div style={{ ...columnDotStyle, background: col.color }} />
                      <span style={{ fontSize: '12px', fontWeight: 700, color: col.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {col.label}
                      </span>
                      <span style={columnCountStyle}>{totalCount}</span>
                    </div>
                    <div style={{ ...columnBodyStyle, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
                      {colTasks.map((task, i) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          index={i}
                          onClick={setEditingTask}
                          projectsMap={projectsMap}
                          campaignsMap={campaignsMap}
                          readOnly={false}
                        />
                      ))}
                      {provided.placeholder}
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
        />
      )}
      {/* Retro modal */}
      {showRetro && closeResult && (
        <SprintRetroModal
          sprint={closeResult.sprint}
          completedCount={closeResult.completedCount}
          completedPoints={closeResult.completedPoints}
          rolledBackCount={closeResult.rolledBackCount}
          onClose={handleRetroSaved}
          onSaved={handleRetroSaved}
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

const sprintGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: '12px',
};

const bucketGridStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
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

const weekNavBtnStyle = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '6px',
  color: 'rgba(255,255,255,0.5)',
  fontSize: '14px',
  cursor: 'pointer',
  padding: '4px 10px',
  lineHeight: 1,
};

const startSprintBtnStyle = {
  background: '#6366f1',
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  padding: '8px 18px',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
};

const completeSprintBtnStyle = {
  background: 'rgba(34,197,94,0.12)',
  color: '#22c55e',
  border: '1px solid rgba(34,197,94,0.2)',
  borderRadius: '8px',
  padding: '6px 14px',
  fontSize: '11px',
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
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
