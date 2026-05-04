import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';

// ════════════════════════════════════════════════════════════
// Constants
// ════════════════════════════════════════════════════════════
const WORKSTREAMS = [
  { key: 'facility',   label: 'Facility',          color: '#f59e0b' },
  { key: 'product',    label: 'Product',           color: '#8b5cf6' },
  { key: 'marketing',  label: 'Marketing & Brand', color: '#ec4899' },
  { key: 'sales',      label: 'Sales / BD',        color: '#10b981' },
  { key: 'operations', label: 'Operations',        color: '#3b82f6' },
  { key: 'finance',    label: 'Finance',           color: '#22c55e' },
  { key: 'tech',       label: 'Tech / Systems',    color: '#06b6d4' },
];

const WORKSTREAM_MAP = Object.fromEntries(WORKSTREAMS.map(w => [w.key, w]));

const STATUSES = [
  { key: 'ideas',    label: 'Ideas',    color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' },
  { key: 'planned',  label: 'Planned',  color: '#60a5fa', bg: 'rgba(96,165,250,0.15)' },
  { key: 'active',   label: 'Active',   color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
  { key: 'waiting',  label: 'Waiting',  color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  { key: 'done',     label: 'Done',     color: '#a3a3a3', bg: 'rgba(163,163,163,0.15)' },
];

const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.key, s]));
const STATUS_ORDER = { active: 0, planned: 1, waiting: 2, ideas: 3, done: 4 };

const TAGS = [
  { key: 'mayday',  label: 'Mayday',  color: '#6366f1', bg: 'rgba(99,102,241,0.15)'  },
  { key: 'neptune', label: 'Neptune', color: '#06b6d4', bg: 'rgba(6,182,212,0.15)'   },
  { key: 'shared',  label: 'Shared',  color: '#a78bfa', bg: 'rgba(167,139,250,0.15)' },
];
const TAG_MAP = Object.fromEntries(TAGS.map(t => [t.key, t]));

const PRIORITIES = [
  { key: 'high', label: 'High', color: '#ef4444' },
  { key: 'med',  label: 'Med',  color: '#f59e0b' },
  { key: 'low',  label: 'Low',  color: '#94a3b8' },
];
const PRIORITY_MAP = Object.fromEntries(PRIORITIES.map(p => [p.key, p]));
const PRIORITY_ORDER = { high: 0, med: 1, low: 2 };

const RECURRENCE_OPTIONS = [
  { key: '',        label: 'No repeat' },
  { key: 'daily',   label: 'Daily' },
  { key: 'weekly',  label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
];

const COMPLETED_GRACE_HOURS = 24; // auto-collapse after 1 day

// ════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function parseDateLocal(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr + 'T00:00:00');
}

function daysBetween(a, b) {
  return Math.round((a - b) / 86400000);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = parseDateLocal(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = parseDateLocal(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDeadline(dateStr) {
  if (!dateStr) return null;
  const d = parseDateLocal(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = daysBetween(d, now);
  if (diff < 0)  return { sub: `${Math.abs(diff)}d overdue`, color: '#ef4444' };
  if (diff === 0) return { sub: 'Due today',                color: '#f59e0b' };
  if (diff <= 7)  return { sub: `${diff}d left`,            color: '#f59e0b' };
  return { sub: `${diff}d left`, color: 'rgba(255,255,255,0.4)' };
}

function formatBudget(cents) {
  if (cents == null) return null;
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000) return `$${(dollars / 1000).toFixed(dollars >= 10000 ? 0 : 1)}k`;
  return `$${dollars.toLocaleString()}`;
}

function isRecentlyCompleted(completedAt) {
  if (!completedAt) return false;
  const d = new Date(completedAt);
  return (Date.now() - d.getTime()) / 3_600_000 < COMPLETED_GRACE_HOURS;
}

function effectiveTag(task, initiative) {
  return task.tag || initiative?.tag || 'shared';
}

// ════════════════════════════════════════════════════════════
// Main page
// ════════════════════════════════════════════════════════════
const EMPTY_INITIATIVE = {
  workstream: 'facility',
  title: '',
  description: '',
  status: 'planned',
  tag: 'shared',
  owner_id: null,
  target_date: '',
  budget_dollars: '',
  priority: 'med',
};

const EMPTY_TASK = {
  title: '',
  notes: '',
  tag: '',
  owner_id: null,
  due_date: '',
  recurrence_interval: '',
  recurrence_count: 1,
};

const EMPTY_MILESTONE = { title: '', target_date: '' };

export default function BusinessDev() {
  const { profile, isAdmin } = useAuth();
  const [view, setView] = useState('main'); // main | timeline | calendar | mine
  const [initiatives, setInitiatives] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [links, setLinks] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [settings, setSettings] = useState({ launch_target_date: null });
  const [loading, setLoading] = useState(true);

  const [tagFilter, setTagFilter] = useState('all');
  const [hideDone, setHideDone] = useState(true);
  const [collapsedWorkstreams, setCollapsedWorkstreams] = useState({});
  const [expandedInitiatives, setExpandedInitiatives] = useState({});

  // form state
  const [showInitForm, setShowInitForm] = useState(false);
  const [editingInitId, setEditingInitId] = useState(null);
  const [initForm, setInitForm] = useState(EMPTY_INITIATIVE);

  const [taskFormFor, setTaskFormFor] = useState(null); // { initiativeId } when adding new
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [taskForm, setTaskForm] = useState(EMPTY_TASK);

  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [editingMilestoneId, setEditingMilestoneId] = useState(null);
  const [milestoneForm, setMilestoneForm] = useState(EMPTY_MILESTONE);

  const [editingLaunchDate, setEditingLaunchDate] = useState(false);
  const [launchDateInput, setLaunchDateInput] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [initRes, taskRes, linkRes, msRes, adminRes, setRes] = await Promise.all([
        supabase.from('bd_initiatives').select('*').order('position'),
        supabase.from('bd_tasks').select('*').order('position'),
        supabase.from('bd_initiative_links').select('*').order('position'),
        supabase.from('bd_milestones').select('*').is('retired_at', null).order('target_date'),
        supabase.from('profiles').select('id, full_name, role').eq('role', 'admin').order('full_name'),
        supabase.from('bd_settings').select('*').eq('id', 1).maybeSingle(),
      ]);
      setInitiatives(initRes.data || []);
      setTasks(taskRes.data || []);
      setLinks(linkRes.data || []);
      setMilestones(msRes.data || []);
      setAdmins(adminRes.data || []);
      setSettings(setRes.data || { launch_target_date: null });
    } catch (err) {
      console.error('BusinessDev fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!profile?.id || !isAdmin) return;
    fetchAll();
  }, [profile?.id, isAdmin, fetchAll]);
  useVisibilityRefresh(fetchAll);

  // ─────────────────────────────────────────────
  // Derived data
  // ─────────────────────────────────────────────
  const tasksByInitiative = useMemo(() => {
    const m = {};
    for (const t of tasks) {
      (m[t.initiative_id] = m[t.initiative_id] || []).push(t);
    }
    return m;
  }, [tasks]);

  const linksByInitiative = useMemo(() => {
    const m = {};
    for (const l of links) {
      (m[l.initiative_id] = m[l.initiative_id] || []).push(l);
    }
    return m;
  }, [links]);

  const filteredInitiatives = useMemo(() => {
    return initiatives.filter(i => {
      if (tagFilter !== 'all' && i.tag !== tagFilter) return false;
      if (hideDone && i.status === 'done' && !isRecentlyCompleted(i.completed_at)) return false;
      return true;
    });
  }, [initiatives, tagFilter, hideDone]);

  const overallPct = useMemo(() => {
    const visible = initiatives.filter(i => !(i.status === 'done' && !isRecentlyCompleted(i.completed_at)));
    if (visible.length === 0) return 0;
    const done = initiatives.filter(i => i.status === 'done').length;
    const total = initiatives.length;
    return total === 0 ? 0 : Math.round((done / total) * 100);
  }, [initiatives]);

  const launchCountdown = useMemo(() => {
    if (!settings?.launch_target_date) return null;
    const target = parseDateLocal(settings.launch_target_date);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return daysBetween(target, now);
  }, [settings]);

  // ─────────────────────────────────────────────
  // Initiative CRUD
  // ─────────────────────────────────────────────
  function openCreateInit(workstream) {
    setEditingInitId(null);
    setInitForm({ ...EMPTY_INITIATIVE, workstream: workstream || 'facility' });
    setShowInitForm(true);
  }
  function openEditInit(init) {
    setEditingInitId(init.id);
    setInitForm({
      workstream: init.workstream,
      title: init.title,
      description: init.description || '',
      status: init.status,
      tag: init.tag,
      owner_id: init.owner_id || null,
      target_date: init.target_date || '',
      budget_dollars: init.budget_cents != null ? String(init.budget_cents / 100) : '',
      priority: init.priority,
      _links: linksByInitiative[init.id] || [],
    });
    setShowInitForm(true);
  }
  function cancelInitForm() {
    setShowInitForm(false);
    setEditingInitId(null);
    setInitForm(EMPTY_INITIATIVE);
  }

  async function handleInitSubmit(e) {
    e?.preventDefault();
    const title = initForm.title.trim();
    if (!title) return;
    const budget_cents = initForm.budget_dollars === '' ? null : Math.round(parseFloat(initForm.budget_dollars) * 100);
    const status = initForm.status;
    const completed_at = status === 'done' ? new Date().toISOString() : null;

    const payload = {
      workstream: initForm.workstream,
      title,
      description: initForm.description || null,
      status,
      tag: initForm.tag,
      owner_id: initForm.owner_id || null,
      target_date: initForm.target_date || null,
      budget_cents,
      priority: initForm.priority,
      completed_at,
    };

    let savedId = editingInitId;
    if (editingInitId) {
      const { error } = await supabase.from('bd_initiatives').update(payload).eq('id', editingInitId);
      if (error) { alert(error.message); return; }
    } else {
      const maxPos = Math.max(0, ...initiatives.filter(i => i.workstream === payload.workstream).map(i => i.position || 0));
      const { data, error } = await supabase
        .from('bd_initiatives')
        .insert({ ...payload, position: maxPos + 1, created_by: profile.id })
        .select()
        .single();
      if (error) { alert(error.message); return; }
      savedId = data.id;
    }

    // Sync links if editing form had _links
    if (initForm._links !== undefined && savedId) {
      const desired = initForm._links.filter(l => l.label?.trim() && l.url?.trim());
      const existing = linksByInitiative[savedId] || [];
      const existingIds = new Set(existing.map(l => l.id));
      const desiredIds = new Set(desired.filter(l => l.id).map(l => l.id));

      // Delete removed
      for (const l of existing) {
        if (!desiredIds.has(l.id)) {
          await supabase.from('bd_initiative_links').delete().eq('id', l.id);
        }
      }
      // Upsert
      for (let i = 0; i < desired.length; i++) {
        const l = desired[i];
        if (l.id && existingIds.has(l.id)) {
          await supabase.from('bd_initiative_links').update({
            label: l.label, url: l.url, position: i,
          }).eq('id', l.id);
        } else {
          await supabase.from('bd_initiative_links').insert({
            initiative_id: savedId, label: l.label, url: l.url, position: i,
          });
        }
      }
    }

    cancelInitForm();
    fetchAll();
  }

  async function handleDeleteInit(id) {
    if (!window.confirm('Delete this initiative and all its tasks?')) return;
    await supabase.from('bd_initiatives').delete().eq('id', id);
    fetchAll();
  }

  async function handleInitiativeStatusChange(id, newStatus) {
    const completed_at = newStatus === 'done' ? new Date().toISOString() : null;
    await supabase.from('bd_initiatives').update({ status: newStatus, completed_at }).eq('id', id);
    fetchAll();
  }

  async function handleMoveInitiative(initiative, direction) {
    const siblings = initiatives
      .filter(i => i.workstream === initiative.workstream)
      .sort((a, b) => (a.position || 0) - (b.position || 0));
    const idx = siblings.findIndex(i => i.id === initiative.id);
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= siblings.length) return;
    const swap = siblings[newIdx];
    await Promise.all([
      supabase.from('bd_initiatives').update({ position: swap.position }).eq('id', initiative.id),
      supabase.from('bd_initiatives').update({ position: initiative.position }).eq('id', swap.id),
    ]);
    fetchAll();
  }

  // ─────────────────────────────────────────────
  // Task CRUD
  // ─────────────────────────────────────────────
  function openCreateTask(initiativeId) {
    setEditingTaskId(null);
    setTaskForm(EMPTY_TASK);
    setTaskFormFor(initiativeId);
  }
  function openEditTask(task) {
    setEditingTaskId(task.id);
    setTaskForm({
      title: task.title,
      notes: task.notes || '',
      tag: task.tag || '',
      owner_id: task.owner_id || null,
      due_date: task.due_date || '',
      recurrence_interval: task.recurrence_interval || '',
      recurrence_count: task.recurrence_count || 1,
    });
    setTaskFormFor(task.initiative_id);
  }
  function cancelTaskForm() {
    setTaskFormFor(null);
    setEditingTaskId(null);
    setTaskForm(EMPTY_TASK);
  }

  async function handleTaskSubmit(e, initiativeId) {
    e?.preventDefault();
    const title = taskForm.title.trim();
    if (!title) return;

    const payload = {
      initiative_id: initiativeId,
      title,
      notes: taskForm.notes || null,
      tag: taskForm.tag || null,
      owner_id: taskForm.owner_id || null,
      due_date: taskForm.due_date || null,
      recurrence_interval: taskForm.recurrence_interval || null,
      recurrence_count: taskForm.recurrence_interval ? parseInt(taskForm.recurrence_count) || 1 : 1,
    };

    if (editingTaskId) {
      const { error } = await supabase.from('bd_tasks').update(payload).eq('id', editingTaskId);
      if (error) { alert(error.message); return; }
    } else {
      const siblings = (tasksByInitiative[initiativeId] || []);
      const maxPos = Math.max(0, ...siblings.map(t => t.position || 0));
      const { error } = await supabase.from('bd_tasks').insert({
        ...payload, position: maxPos + 1, created_by: profile.id,
      });
      if (error) { alert(error.message); return; }
    }
    cancelTaskForm();
    fetchAll();
  }

  async function handleToggleTask(task) {
    const completed_at = task.completed_at ? null : new Date().toISOString();
    await supabase.from('bd_tasks').update({ completed_at }).eq('id', task.id);
    fetchAll();
  }
  async function handleDeleteTask(id) {
    if (!window.confirm('Delete this task?')) return;
    await supabase.from('bd_tasks').delete().eq('id', id);
    fetchAll();
  }

  // ─────────────────────────────────────────────
  // Milestone CRUD
  // ─────────────────────────────────────────────
  function openCreateMilestone() {
    setEditingMilestoneId(null);
    setMilestoneForm(EMPTY_MILESTONE);
    setShowMilestoneForm(true);
  }
  function openEditMilestone(ms) {
    setEditingMilestoneId(ms.id);
    setMilestoneForm({ title: ms.title, target_date: ms.target_date || '' });
    setShowMilestoneForm(true);
  }
  function cancelMilestoneForm() {
    setShowMilestoneForm(false);
    setEditingMilestoneId(null);
    setMilestoneForm(EMPTY_MILESTONE);
  }
  async function handleMilestoneSubmit(e) {
    e.preventDefault();
    if (!milestoneForm.title.trim()) return;
    const payload = {
      title: milestoneForm.title.trim(),
      target_date: milestoneForm.target_date || null,
    };
    if (editingMilestoneId) {
      await supabase.from('bd_milestones').update(payload).eq('id', editingMilestoneId);
    } else {
      const maxPos = Math.max(0, ...milestones.map(m => m.position || 0));
      await supabase.from('bd_milestones').insert({
        ...payload, position: maxPos + 1, created_by: profile.id,
      });
    }
    cancelMilestoneForm();
    fetchAll();
  }
  async function handleRetireMilestone(id) {
    if (!window.confirm('Retire this milestone?')) return;
    await supabase.from('bd_milestones').update({ retired_at: new Date().toISOString() }).eq('id', id);
    fetchAll();
  }

  // ─────────────────────────────────────────────
  // Settings (launch date)
  // ─────────────────────────────────────────────
  async function saveLaunchDate() {
    await supabase.from('bd_settings').update({
      launch_target_date: launchDateInput || null,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    setEditingLaunchDate(false);
    fetchAll();
  }

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  if (!isAdmin) {
    return <div style={styles.page}><div style={styles.loading}>Admin access required.</div></div>;
  }
  if (loading) {
    return <div style={styles.page}><div style={styles.loading}>Loading Business Dev...</div></div>;
  }

  return (
    <div style={styles.page}>
      <Header
        countdown={launchCountdown}
        launchDate={settings?.launch_target_date}
        editingLaunchDate={editingLaunchDate}
        launchDateInput={launchDateInput}
        setLaunchDateInput={setLaunchDateInput}
        onEditLaunch={() => { setLaunchDateInput(settings?.launch_target_date || ''); setEditingLaunchDate(true); }}
        onSaveLaunch={saveLaunchDate}
        onCancelLaunch={() => setEditingLaunchDate(false)}
        milestones={milestones}
        showMilestoneForm={showMilestoneForm}
        editingMilestoneId={editingMilestoneId}
        milestoneForm={milestoneForm}
        setMilestoneForm={setMilestoneForm}
        onCreateMilestone={openCreateMilestone}
        onEditMilestone={openEditMilestone}
        onMilestoneSubmit={handleMilestoneSubmit}
        onCancelMilestoneForm={cancelMilestoneForm}
        onRetireMilestone={handleRetireMilestone}
        overallPct={overallPct}
      />

      {/* Tab bar */}
      <div style={styles.tabBar}>
        {[
          { key: 'main',     label: 'Workstreams' },
          { key: 'timeline', label: 'Timeline' },
          { key: 'calendar', label: 'Calendar' },
          { key: 'mine',     label: 'My Stuff' },
        ].map(t => (
          <button key={t.key}
            onClick={() => setView(t.key)}
            style={{ ...styles.tabBtn, ...(view === t.key ? styles.tabBtnActive : {}) }}>
            {t.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => openCreateInit()} style={styles.primaryBtn}>+ Initiative</button>
      </div>

      {/* Filter bar — main view only */}
      {view === 'main' && (
        <div style={styles.filterBar}>
          <div style={styles.tagPills}>
            {[{ key: 'all', label: 'All', color: 'rgba(255,255,255,0.4)' }, ...TAGS].map(t => (
              <button key={t.key}
                onClick={() => setTagFilter(t.key)}
                style={{
                  ...styles.tagPill,
                  ...(tagFilter === t.key ? { background: (t.bg || 'rgba(255,255,255,0.1)'), color: t.color, borderColor: t.color + '55' } : {}),
                }}>
                {t.label}
              </button>
            ))}
          </div>
          <label style={styles.toggleLabel}>
            <input type="checkbox" checked={hideDone} onChange={e => setHideDone(e.target.checked)} />
            Hide done
          </label>
        </div>
      )}

      {/* Initiative form */}
      {showInitForm && (
        <InitiativeForm
          form={initForm}
          setForm={setInitForm}
          editing={!!editingInitId}
          admins={admins}
          existingLinks={linksByInitiative[editingInitId] || []}
          onSubmit={handleInitSubmit}
          onCancel={cancelInitForm}
        />
      )}

      {/* Views */}
      {view === 'main' && (
        <MainView
          filteredInitiatives={filteredInitiatives}
          tasksByInitiative={tasksByInitiative}
          linksByInitiative={linksByInitiative}
          admins={admins}
          collapsedWorkstreams={collapsedWorkstreams}
          setCollapsedWorkstreams={setCollapsedWorkstreams}
          expandedInitiatives={expandedInitiatives}
          setExpandedInitiatives={setExpandedInitiatives}
          taskFormFor={taskFormFor}
          editingTaskId={editingTaskId}
          taskForm={taskForm}
          setTaskForm={setTaskForm}
          onOpenCreateTask={openCreateTask}
          onOpenEditTask={openEditTask}
          onTaskSubmit={handleTaskSubmit}
          onCancelTaskForm={cancelTaskForm}
          onToggleTask={handleToggleTask}
          onDeleteTask={handleDeleteTask}
          onEditInit={openEditInit}
          onDeleteInit={handleDeleteInit}
          onMoveInit={handleMoveInitiative}
          onCreateInit={openCreateInit}
          onStatusChange={handleInitiativeStatusChange}
          hideDone={hideDone}
        />
      )}

      {view === 'timeline' && (
        <TimelineView initiatives={initiatives} tasks={tasks} milestones={milestones} settings={settings} hideDone={hideDone} tagFilter={tagFilter} />
      )}

      {view === 'calendar' && (
        <CalendarView initiatives={initiatives} tasks={tasks} milestones={milestones} />
      )}

      {view === 'mine' && (
        <MyStuffView
          profile={profile}
          initiatives={initiatives}
          tasks={tasks}
          tasksByInitiative={tasksByInitiative}
          onToggleTask={handleToggleTask}
          onEditInit={openEditInit}
          onEditTask={openEditTask}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Header
// ════════════════════════════════════════════════════════════
function Header(props) {
  const {
    countdown, launchDate, editingLaunchDate, launchDateInput, setLaunchDateInput,
    onEditLaunch, onSaveLaunch, onCancelLaunch,
    milestones, showMilestoneForm, editingMilestoneId, milestoneForm, setMilestoneForm,
    onCreateMilestone, onEditMilestone, onMilestoneSubmit, onCancelMilestoneForm, onRetireMilestone,
    overallPct,
  } = props;

  return (
    <div style={styles.header}>
      <div style={styles.headerTop}>
        <div>
          <h1 style={styles.pageTitle}>Business Dev</h1>
          <p style={styles.pageSubtitle}>Mayday Media + Neptune Performance — buildout & ops</p>
        </div>
        <div style={styles.headerStats}>
          {countdown != null ? (
            <div style={styles.countdownBox}>
              <div style={styles.countdownDays}>
                {countdown >= 0 ? countdown : `${Math.abs(countdown)}d past`}
                {countdown >= 0 && <span style={styles.countdownUnit}>d</span>}
              </div>
              <div style={styles.countdownLabel}>
                to {launchDate ? formatDateShort(launchDate) : 'launch'}
                <button onClick={onEditLaunch} style={styles.miniEditBtn}>edit</button>
              </div>
            </div>
          ) : (
            <button onClick={onEditLaunch} style={styles.setLaunchBtn}>+ Set launch date</button>
          )}
          <div style={styles.overallBox}>
            <div style={styles.overallPctNum}>{overallPct}%</div>
            <div style={styles.overallPctLabel}>overall</div>
          </div>
        </div>
      </div>

      {/* Launch date editor */}
      {editingLaunchDate && (
        <div style={styles.launchEditorRow}>
          <input
            type="date"
            value={launchDateInput}
            onChange={e => setLaunchDateInput(e.target.value)}
            style={styles.input}
          />
          <button onClick={onSaveLaunch} style={styles.primaryBtn}>Save</button>
          <button onClick={onCancelLaunch} style={styles.subtleBtn}>Cancel</button>
        </div>
      )}

      {/* Milestones */}
      <div style={styles.milestonesRow}>
        <span style={styles.milestonesLabel}>Milestones:</span>
        {milestones.map(ms => (
          <button key={ms.id} onClick={() => onEditMilestone(ms)} style={styles.milestoneChip} title={`${ms.title} — ${ms.target_date ? formatDate(ms.target_date) : 'no date'}`}>
            <span style={styles.milestoneTitle}>{ms.title}</span>
            {ms.target_date && <span style={styles.milestoneDate}>{formatDateShort(ms.target_date)}</span>}
          </button>
        ))}
        <button onClick={onCreateMilestone} style={styles.milestoneAdd}>+</button>
      </div>

      {/* Milestone form */}
      {showMilestoneForm && (
        <form onSubmit={onMilestoneSubmit} style={styles.milestoneForm}>
          <input
            value={milestoneForm.title}
            onChange={e => setMilestoneForm({ ...milestoneForm, title: e.target.value })}
            placeholder="Milestone title"
            autoFocus
            style={{ ...styles.input, flex: 1 }}
          />
          <input
            type="date"
            value={milestoneForm.target_date}
            onChange={e => setMilestoneForm({ ...milestoneForm, target_date: e.target.value })}
            style={styles.input}
          />
          <button type="submit" style={styles.primaryBtn}>{editingMilestoneId ? 'Update' : 'Add'}</button>
          {editingMilestoneId && (
            <button type="button" onClick={() => onRetireMilestone(editingMilestoneId)} style={styles.dangerBtn}>Retire</button>
          )}
          <button type="button" onClick={onCancelMilestoneForm} style={styles.subtleBtn}>Cancel</button>
        </form>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Main view (workstream-grouped)
// ════════════════════════════════════════════════════════════
function MainView(props) {
  const {
    filteredInitiatives, tasksByInitiative, linksByInitiative, admins,
    collapsedWorkstreams, setCollapsedWorkstreams,
    expandedInitiatives, setExpandedInitiatives,
    taskFormFor, editingTaskId, taskForm, setTaskForm,
    onOpenCreateTask, onOpenEditTask, onTaskSubmit, onCancelTaskForm, onToggleTask, onDeleteTask,
    onEditInit, onDeleteInit, onMoveInit, onCreateInit, onStatusChange, hideDone,
  } = props;

  return (
    <div style={styles.workstreamList}>
      {WORKSTREAMS.map(ws => {
        const wsInits = filteredInitiatives.filter(i => i.workstream === ws.key);
        const totalCount = wsInits.length;
        const doneCount = wsInits.filter(i => i.status === 'done').length;
        const collapsed = collapsedWorkstreams[ws.key];

        // sort: status order, then by due date
        const sorted = [...wsInits].sort((a, b) => {
          const sa = STATUS_ORDER[a.status] ?? 9;
          const sb = STATUS_ORDER[b.status] ?? 9;
          if (sa !== sb) return sa - sb;
          if (a.target_date && b.target_date) return a.target_date.localeCompare(b.target_date);
          if (a.target_date) return -1;
          if (b.target_date) return 1;
          return (a.position || 0) - (b.position || 0);
        });

        // Split active vs auto-collapsed completed
        const activeRows = [];
        const completedRows = [];
        for (const init of sorted) {
          if (init.status === 'done' && !isRecentlyCompleted(init.completed_at)) {
            completedRows.push(init);
          } else {
            activeRows.push(init);
          }
        }
        const showCompleted = !hideDone && completedRows.length > 0;

        return (
          <div key={ws.key} style={styles.workstreamSection}>
            <button
              onClick={() => setCollapsedWorkstreams(prev => ({ ...prev, [ws.key]: !prev[ws.key] }))}
              style={styles.workstreamHeader}
            >
              <span style={{ ...styles.workstreamCaret, transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}>▶</span>
              <span style={{ ...styles.workstreamDot, background: ws.color }} />
              <span style={styles.workstreamLabel}>{ws.label}</span>
              <span style={styles.workstreamCount}>{doneCount} / {totalCount} done</span>
              <button onClick={(e) => { e.stopPropagation(); onCreateInit(ws.key); }} style={styles.workstreamAddBtn}>+</button>
            </button>

            {!collapsed && (
              <div style={styles.workstreamBody}>
                {activeRows.length === 0 && completedRows.length === 0 && (
                  <div style={styles.empty}>No initiatives yet.</div>
                )}
                {activeRows.map((init, idx) => (
                  <InitiativeCard
                    key={init.id}
                    initiative={init}
                    tasks={tasksByInitiative[init.id] || []}
                    initiativeLinks={linksByInitiative[init.id] || []}
                    admins={admins}
                    expanded={!!expandedInitiatives[init.id]}
                    onToggleExpand={() => setExpandedInitiatives(prev => ({ ...prev, [init.id]: !prev[init.id] }))}
                    onEdit={() => onEditInit(init)}
                    onDelete={() => onDeleteInit(init.id)}
                    onStatusChange={onStatusChange}
                    onMoveUp={idx > 0 ? () => onMoveInit(init, 'up') : null}
                    onMoveDown={idx < activeRows.length - 1 ? () => onMoveInit(init, 'down') : null}
                    taskFormFor={taskFormFor}
                    editingTaskId={editingTaskId}
                    taskForm={taskForm}
                    setTaskForm={setTaskForm}
                    onOpenCreateTask={onOpenCreateTask}
                    onOpenEditTask={onOpenEditTask}
                    onTaskSubmit={onTaskSubmit}
                    onCancelTaskForm={onCancelTaskForm}
                    onToggleTask={onToggleTask}
                    onDeleteTask={onDeleteTask}
                  />
                ))}

                {showCompleted && (
                  <CompletedSection
                    initiatives={completedRows}
                    tasksByInitiative={tasksByInitiative}
                    linksByInitiative={linksByInitiative}
                    admins={admins}
                    onEditInit={onEditInit}
                    onDeleteInit={onDeleteInit}
                    onStatusChange={onStatusChange}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CompletedSection({ initiatives, tasksByInitiative, linksByInitiative, admins, onEditInit, onDeleteInit, onStatusChange }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={styles.completedWrap}>
      <button onClick={() => setOpen(o => !o)} style={styles.completedToggle}>
        <span style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block', transition: 'transform 0.15s' }}>▶</span>
        {' '}Completed ({initiatives.length})
      </button>
      {open && initiatives.map(init => (
        <InitiativeCard
          key={init.id}
          initiative={init}
          tasks={tasksByInitiative[init.id] || []}
          initiativeLinks={linksByInitiative[init.id] || []}
          admins={admins}
          expanded={false}
          onToggleExpand={() => {}}
          onEdit={() => onEditInit(init)}
          onDelete={() => onDeleteInit(init.id)}
          onStatusChange={onStatusChange}
          dimmed
        />
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Initiative card
// ════════════════════════════════════════════════════════════
function InitiativeCard(props) {
  const {
    initiative, tasks, initiativeLinks, admins,
    expanded, onToggleExpand, onEdit, onDelete, onStatusChange,
    onMoveUp, onMoveDown, dimmed,
    taskFormFor, editingTaskId, taskForm, setTaskForm,
    onOpenCreateTask, onOpenEditTask, onTaskSubmit, onCancelTaskForm,
    onToggleTask, onDeleteTask,
  } = props;

  const tag = TAG_MAP[initiative.tag];
  const status = STATUS_MAP[initiative.status];
  const priority = PRIORITY_MAP[initiative.priority];
  const owner = admins.find(a => a.id === initiative.owner_id);
  const dl = formatDeadline(initiative.target_date);
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter(t => t.completed_at).length;
  const taskPct = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;

  // Sort tasks: incomplete by due date, completed last
  const sortedTasks = [...tasks].sort((a, b) => {
    const ac = !!a.completed_at, bc = !!b.completed_at;
    if (ac !== bc) return ac ? 1 : -1;
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return (a.position || 0) - (b.position || 0);
  });

  return (
    <div style={{ ...styles.initiativeCard, opacity: dimmed ? 0.55 : 1 }}>
      <div style={styles.initRowHeader}>
        <button onClick={onToggleExpand} style={styles.initCaretBtn} title={expanded ? 'Collapse' : 'Expand'}>
          <span style={{ display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.12s' }}>▶</span>
        </button>

        <span style={{ ...styles.statusBadge, color: status.color, background: status.bg }}>{status.label}</span>
        <span style={{ ...styles.tagBadge, color: tag.color, background: tag.bg }}>{tag.label}</span>

        <span style={styles.initTitle}>{initiative.title}</span>

        {priority.key === 'high' && <span style={styles.priorityHigh}>★</span>}

        <div style={{ flex: 1 }} />

        {owner && <span style={styles.ownerChip} title={owner.full_name}>{owner.full_name?.charAt(0).toUpperCase()}</span>}
        {initiative.budget_cents != null && <span style={styles.metaPill}>{formatBudget(initiative.budget_cents)}</span>}
        {dl && <span style={{ ...styles.metaPill, color: dl.color }}>{formatDateShort(initiative.target_date)} · {dl.sub}</span>}

        {totalTasks > 0 && (
          <span style={styles.taskCounter}>{doneTasks}/{totalTasks}</span>
        )}

        <div style={styles.initActions}>
          {onMoveUp && <button onClick={onMoveUp} style={styles.iconBtn} title="Move up">▲</button>}
          {onMoveDown && <button onClick={onMoveDown} style={styles.iconBtn} title="Move down">▼</button>}
          <select
            value={initiative.status}
            onChange={(e) => onStatusChange(initiative.id, e.target.value)}
            style={styles.miniSelect}
            onClick={(e) => e.stopPropagation()}
          >
            {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button onClick={onEdit} style={styles.iconBtn} title="Edit">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14.5 3.5l2 2L6 16H4v-2L14.5 3.5z" />
            </svg>
          </button>
          <button onClick={onDelete} style={styles.iconBtn} title="Delete">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M5 6h10M8 6V4h4v2M6 6v10a1 1 0 001 1h6a1 1 0 001-1V6" />
            </svg>
          </button>
        </div>
      </div>

      {totalTasks > 0 && (
        <div style={styles.barBg}>
          <div style={{ ...styles.barFill, width: `${taskPct}%`, background: '#22c55e' }} />
        </div>
      )}

      {expanded && (
        <div style={styles.initBody}>
          {initiative.description && (
            <div style={styles.initDescription}>{initiative.description}</div>
          )}

          {initiativeLinks.length > 0 && (
            <div style={styles.linksRow}>
              {initiativeLinks.map(l => (
                <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer" style={styles.linkChip}>
                  ↗ {l.label}
                </a>
              ))}
            </div>
          )}

          <div style={styles.tasksHeader}>
            <span>Tasks</span>
            {taskFormFor !== initiative.id && (
              <button onClick={() => onOpenCreateTask(initiative.id)} style={styles.subtleBtn}>+ Task</button>
            )}
          </div>

          {sortedTasks.map(task => (
            <TaskRow
              key={task.id}
              task={task}
              admins={admins}
              initiative={initiative}
              isEditing={editingTaskId === task.id && taskFormFor === initiative.id}
              taskForm={taskForm}
              setTaskForm={setTaskForm}
              onToggle={() => onToggleTask(task)}
              onEdit={() => onOpenEditTask(task)}
              onSubmit={(e) => onTaskSubmit(e, initiative.id)}
              onCancel={onCancelTaskForm}
              onDelete={() => onDeleteTask(task.id)}
            />
          ))}

          {taskFormFor === initiative.id && !editingTaskId && (
            <TaskForm
              form={taskForm}
              setForm={setTaskForm}
              admins={admins}
              onSubmit={(e) => onTaskSubmit(e, initiative.id)}
              onCancel={onCancelTaskForm}
            />
          )}

          {sortedTasks.length === 0 && taskFormFor !== initiative.id && (
            <div style={styles.emptyTasks}>No tasks yet.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Task row
// ════════════════════════════════════════════════════════════
function TaskRow({ task, admins, initiative, isEditing, taskForm, setTaskForm, onToggle, onEdit, onSubmit, onCancel, onDelete }) {
  if (isEditing) {
    return <TaskForm form={taskForm} setForm={setTaskForm} admins={admins} onSubmit={onSubmit} onCancel={onCancel} editing />;
  }
  const done = !!task.completed_at;
  const owner = admins.find(a => a.id === task.owner_id);
  const dl = formatDeadline(task.due_date);
  const tag = effectiveTag(task, initiative);
  const tagMeta = TAG_MAP[tag];

  return (
    <div style={{ ...styles.taskRow, opacity: done ? 0.55 : 1 }}>
      <button onClick={onToggle} style={styles.checkBtn} title={done ? 'Mark incomplete' : 'Mark done'}>
        <span style={{ ...styles.checkBox, ...(done ? styles.checkBoxDone : {}) }}>{done && '✓'}</span>
      </button>
      <span style={{ ...styles.taskTitle, textDecoration: done ? 'line-through' : 'none' }}>{task.title}</span>
      {task.recurrence_interval && (
        <span style={styles.recurChip} title={`Repeats ${task.recurrence_interval}`}>↻ {task.recurrence_interval}</span>
      )}
      {task.tag && task.tag !== initiative.tag && (
        <span style={{ ...styles.miniTag, color: tagMeta.color, background: tagMeta.bg }}>{tagMeta.label}</span>
      )}
      <div style={{ flex: 1 }} />
      {dl && !done && <span style={{ ...styles.metaPill, color: dl.color }}>{formatDateShort(task.due_date)} · {dl.sub}</span>}
      {dl && done && <span style={styles.metaPill}>{formatDateShort(task.due_date)}</span>}
      {owner && <span style={styles.ownerChip} title={owner.full_name}>{owner.full_name?.charAt(0).toUpperCase()}</span>}
      <button onClick={onEdit} style={styles.iconBtn} title="Edit">
        <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M14.5 3.5l2 2L6 16H4v-2L14.5 3.5z" />
        </svg>
      </button>
      <button onClick={onDelete} style={styles.iconBtn} title="Delete">×</button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Initiative form
// ════════════════════════════════════════════════════════════
function InitiativeForm({ form, setForm, editing, admins, existingLinks, onSubmit, onCancel }) {
  // Initialize _links if not present (only on mount; no deps needed)
  useEffect(() => {
    if (form._links === undefined) {
      setForm(f => ({ ...f, _links: existingLinks.map(l => ({ id: l.id, label: l.label, url: l.url })) }));
    }
  }, []); // eslint-disable-line

  function updateLink(idx, key, val) {
    const next = [...(form._links || [])];
    next[idx] = { ...next[idx], [key]: val };
    setForm({ ...form, _links: next });
  }
  function removeLink(idx) {
    const next = [...(form._links || [])];
    next.splice(idx, 1);
    setForm({ ...form, _links: next });
  }
  function addLink() {
    setForm({ ...form, _links: [...(form._links || []), { label: '', url: '' }] });
  }

  return (
    <form onSubmit={onSubmit} style={styles.form}>
      <div style={styles.formLabel}>{editing ? 'Edit Initiative' : 'New Initiative'}</div>

      <input
        value={form.title}
        onChange={e => setForm({ ...form, title: e.target.value })}
        placeholder="Initiative title"
        style={styles.input}
        autoFocus
      />

      <textarea
        value={form.description}
        onChange={e => setForm({ ...form, description: e.target.value })}
        placeholder="Description / notes (optional)"
        style={{ ...styles.input, minHeight: '60px', resize: 'vertical' }}
      />

      <div style={styles.formRow}>
        <select value={form.workstream} onChange={e => setForm({ ...form, workstream: e.target.value })} style={styles.select}>
          {WORKSTREAMS.map(w => <option key={w.key} value={w.key}>{w.label}</option>)}
        </select>
        <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} style={styles.select}>
          {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select value={form.tag} onChange={e => setForm({ ...form, tag: e.target.value })} style={styles.select}>
          {TAGS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} style={styles.select}>
          {PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label} priority</option>)}
        </select>
      </div>

      <div style={styles.formRow}>
        <input
          type="date"
          value={form.target_date}
          onChange={e => setForm({ ...form, target_date: e.target.value })}
          style={{ ...styles.input, flex: 1 }}
        />
        <select
          value={form.owner_id || ''}
          onChange={e => setForm({ ...form, owner_id: e.target.value || null })}
          style={{ ...styles.select, flex: 1 }}
        >
          <option value="">No owner</option>
          {admins.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
        </select>
        <input
          value={form.budget_dollars}
          onChange={e => setForm({ ...form, budget_dollars: e.target.value })}
          placeholder="Budget ($)"
          inputMode="decimal"
          style={{ ...styles.input, flex: 1 }}
        />
      </div>

      {/* Links */}
      <div style={styles.formSubLabel}>Links</div>
      {(form._links || []).map((l, idx) => (
        <div key={idx} style={styles.formRow}>
          <input
            value={l.label}
            onChange={e => updateLink(idx, 'label', e.target.value)}
            placeholder="Label"
            style={{ ...styles.input, flex: 1 }}
          />
          <input
            value={l.url}
            onChange={e => updateLink(idx, 'url', e.target.value)}
            placeholder="https://"
            style={{ ...styles.input, flex: 2 }}
          />
          <button type="button" onClick={() => removeLink(idx)} style={styles.subtleBtn}>×</button>
        </div>
      ))}
      <button type="button" onClick={addLink} style={styles.subtleBtn}>+ Link</button>

      <div style={styles.formRow}>
        <button type="submit" style={styles.primaryBtn}>{editing ? 'Update' : 'Create'}</button>
        <button type="button" onClick={onCancel} style={styles.subtleBtn}>Cancel</button>
      </div>
    </form>
  );
}

// ════════════════════════════════════════════════════════════
// Task form
// ════════════════════════════════════════════════════════════
function TaskForm({ form, setForm, admins, onSubmit, onCancel, editing }) {
  return (
    <form onSubmit={onSubmit} style={styles.taskForm}>
      <input
        value={form.title}
        onChange={e => setForm({ ...form, title: e.target.value })}
        placeholder="Task title"
        autoFocus
        style={styles.input}
      />
      <div style={styles.formRow}>
        <input
          type="date"
          value={form.due_date}
          onChange={e => setForm({ ...form, due_date: e.target.value })}
          style={{ ...styles.input, flex: 1 }}
        />
        <select
          value={form.owner_id || ''}
          onChange={e => setForm({ ...form, owner_id: e.target.value || null })}
          style={{ ...styles.select, flex: 1 }}
        >
          <option value="">No owner</option>
          {admins.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
        </select>
        <select
          value={form.tag}
          onChange={e => setForm({ ...form, tag: e.target.value })}
          style={{ ...styles.select, flex: 1 }}
        >
          <option value="">Inherit tag</option>
          {TAGS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </div>
      <div style={styles.formRow}>
        <select
          value={form.recurrence_interval}
          onChange={e => setForm({ ...form, recurrence_interval: e.target.value })}
          style={{ ...styles.select, flex: 1 }}
        >
          {RECURRENCE_OPTIONS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        {form.recurrence_interval && (
          <input
            type="number"
            min="1"
            value={form.recurrence_count}
            onChange={e => setForm({ ...form, recurrence_count: e.target.value })}
            placeholder="Every N"
            style={{ ...styles.input, width: '90px' }}
          />
        )}
      </div>
      <textarea
        value={form.notes}
        onChange={e => setForm({ ...form, notes: e.target.value })}
        placeholder="Notes (optional)"
        style={{ ...styles.input, minHeight: '50px', resize: 'vertical' }}
      />
      <div style={styles.formRow}>
        <button type="submit" style={styles.primaryBtn}>{editing ? 'Update' : 'Add Task'}</button>
        <button type="button" onClick={onCancel} style={styles.subtleBtn}>Cancel</button>
      </div>
    </form>
  );
}

// ════════════════════════════════════════════════════════════
// Timeline view (Gantt-ish)
// ════════════════════════════════════════════════════════════
function TimelineView({ initiatives, tasks, milestones, settings, hideDone, tagFilter }) {
  const [monthsAhead, setMonthsAhead] = useState(6);

  // Compute timeline range: today → today + N months
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(start.getFullYear(), start.getMonth() + monthsAhead, 0);
  const totalDays = daysBetween(end, start) + 1;
  const dayWidth = 100 / totalDays; // % of width per day

  function dateOffsetPct(dateStr) {
    if (!dateStr) return null;
    const d = parseDateLocal(dateStr);
    return Math.max(0, daysBetween(d, start) * dayWidth);
  }

  const visible = initiatives.filter(i => {
    if (tagFilter !== 'all' && i.tag !== tagFilter) return false;
    if (hideDone && i.status === 'done' && !isRecentlyCompleted(i.completed_at)) return false;
    return true;
  });

  // Build month headers
  const months = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const monthDays = daysBetween(monthEnd, cursor) + 1;
    months.push({
      label: cursor.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      widthPct: monthDays * dayWidth,
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  return (
    <div style={styles.timelineWrap}>
      <div style={styles.timelineToolbar}>
        <span style={styles.timelineLabel}>Range:</span>
        {[3, 6, 12, 24].map(n => (
          <button key={n} onClick={() => setMonthsAhead(n)} style={{ ...styles.subtleBtn, ...(monthsAhead === n ? { background: 'rgba(99,102,241,0.18)', color: '#a5b4fc' } : {}) }}>
            {n}mo
          </button>
        ))}
      </div>

      {/* Month axis */}
      <div style={styles.timelineAxis}>
        <div style={styles.timelineRowLabel} />
        <div style={styles.timelineLane}>
          {months.map((m, idx) => (
            <div key={idx} style={{ ...styles.timelineMonth, width: `${m.widthPct}%` }}>{m.label}</div>
          ))}
        </div>
      </div>

      {/* Today line + milestones overlay */}
      <div style={styles.timelineOverlayWrap}>
        <div style={styles.timelineRowLabel} />
        <div style={{ ...styles.timelineLane, position: 'relative', height: '20px' }}>
          {/* Today */}
          <div style={{ ...styles.timelineToday, left: `${dateOffsetPct(todayStr())}%` }} title="Today" />
          {/* Launch */}
          {settings?.launch_target_date && dateOffsetPct(settings.launch_target_date) != null && (
            <div style={{ ...styles.timelineLaunch, left: `${dateOffsetPct(settings.launch_target_date)}%` }} title={`Launch: ${formatDate(settings.launch_target_date)}`}>🚀</div>
          )}
          {/* Milestones */}
          {milestones.map(ms => {
            const offset = dateOffsetPct(ms.target_date);
            if (offset == null) return null;
            return (
              <div key={ms.id} style={{ ...styles.timelineMilestone, left: `${offset}%` }} title={`${ms.title} — ${formatDate(ms.target_date)}`}>
                ◆
              </div>
            );
          })}
        </div>
      </div>

      {/* Workstream rows */}
      {WORKSTREAMS.map(ws => {
        const wsInits = visible.filter(i => i.workstream === ws.key);
        if (wsInits.length === 0) return null;
        return (
          <div key={ws.key}>
            <div style={{ ...styles.timelineWsHeader, color: ws.color }}>{ws.label}</div>
            {wsInits.map(init => {
              const tag = TAG_MAP[init.tag];
              const startPct = dateOffsetPct(init.created_at?.substring(0, 10) || todayStr());
              const endPct   = dateOffsetPct(init.target_date) ?? Math.min(100, startPct + 10);
              const width = Math.max(2, endPct - startPct);
              return (
                <div key={init.id} style={styles.timelineRow}>
                  <div style={styles.timelineRowLabel} title={init.title}>{init.title}</div>
                  <div style={styles.timelineLane}>
                    <div
                      style={{
                        ...styles.timelineBar,
                        left: `${startPct}%`,
                        width: `${width}%`,
                        background: tag.bg,
                        border: `1px solid ${tag.color}55`,
                        color: tag.color,
                      }}
                      title={`${init.title} → ${init.target_date ? formatDate(init.target_date) : 'no date'}`}
                    >
                      {init.title}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {visible.length === 0 && <div style={styles.empty}>No initiatives to display.</div>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Calendar view
// ════════════════════════════════════════════════════════════
function CalendarView({ initiatives, tasks, milestones }) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = firstDay.getDay(); // 0 = Sunday
  const daysInMonth = lastDay.getDate();
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;

  function makeKey(d) {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  // Build event lookup by date
  const events = {};
  function pushEvent(date, ev) {
    if (!date) return;
    (events[date] = events[date] || []).push(ev);
  }
  for (const t of tasks) {
    if (t.due_date) pushEvent(t.due_date, { kind: 'task', label: t.title, color: '#a5b4fc', done: !!t.completed_at });
  }
  for (const i of initiatives) {
    if (i.target_date) pushEvent(i.target_date, { kind: 'initiative', label: i.title, color: TAG_MAP[i.tag]?.color || '#94a3b8' });
  }
  for (const m of milestones) {
    if (m.target_date) pushEvent(m.target_date, { kind: 'milestone', label: m.title, color: '#fbbf24' });
  }

  const todayKey = makeKey(new Date());

  return (
    <div style={styles.calendarWrap}>
      <div style={styles.calendarHeader}>
        <button onClick={() => setCursor(new Date(year, month - 1, 1))} style={styles.subtleBtn}>◀</button>
        <div style={styles.calendarMonthLabel}>
          {cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </div>
        <button onClick={() => setCursor(new Date(year, month + 1, 1))} style={styles.subtleBtn}>▶</button>
        <div style={{ flex: 1 }} />
        <button onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); }} style={styles.subtleBtn}>Today</button>
      </div>
      <div style={styles.calendarGrid}>
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} style={styles.calendarDayHeader}>{d}</div>
        ))}
        {Array.from({ length: totalCells }).map((_, idx) => {
          const dayNum = idx - startWeekday + 1;
          if (dayNum < 1 || dayNum > daysInMonth) {
            return <div key={idx} style={styles.calendarCellEmpty} />;
          }
          const cellDate = new Date(year, month, dayNum);
          const key = makeKey(cellDate);
          const dayEvents = events[key] || [];
          const isToday = key === todayKey;
          return (
            <div key={idx} style={{ ...styles.calendarCell, ...(isToday ? styles.calendarCellToday : {}) }}>
              <div style={styles.calendarCellNum}>{dayNum}</div>
              <div style={styles.calendarCellEvents}>
                {dayEvents.slice(0, 4).map((ev, i) => (
                  <div key={i} style={{
                    ...styles.calendarEvent,
                    background: ev.color + '22',
                    color: ev.color,
                    textDecoration: ev.done ? 'line-through' : 'none',
                  }} title={`${ev.kind}: ${ev.label}`}>
                    {ev.kind === 'milestone' && '◆ '}
                    {ev.kind === 'initiative' && '▌ '}
                    {ev.label}
                  </div>
                ))}
                {dayEvents.length > 4 && (
                  <div style={styles.calendarMoreEvents}>+{dayEvents.length - 4} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// My Stuff view
// ════════════════════════════════════════════════════════════
function MyStuffView({ profile, initiatives, tasks, tasksByInitiative, onToggleTask, onEditInit, onEditTask }) {
  const myInits = initiatives.filter(i => i.owner_id === profile.id && i.status !== 'done');
  const myTasks = tasks.filter(t => t.owner_id === profile.id && !t.completed_at);

  myTasks.sort((a, b) => {
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return 0;
  });
  myInits.sort((a, b) => {
    if (a.target_date && b.target_date) return a.target_date.localeCompare(b.target_date);
    if (a.target_date) return -1;
    if (b.target_date) return 1;
    return 0;
  });

  return (
    <div style={styles.mineWrap}>
      <div style={styles.mineSection}>
        <h3 style={styles.mineHeader}>My Tasks ({myTasks.length})</h3>
        {myTasks.length === 0 && <div style={styles.empty}>No open tasks owned by you.</div>}
        {myTasks.map(task => {
          const init = initiatives.find(i => i.id === task.initiative_id);
          const dl = formatDeadline(task.due_date);
          const ws = WORKSTREAM_MAP[init?.workstream];
          return (
            <div key={task.id} style={styles.taskRow}>
              <button onClick={() => onToggleTask(task)} style={styles.checkBtn}>
                <span style={styles.checkBox} />
              </button>
              <span style={styles.taskTitle}>{task.title}</span>
              {ws && <span style={{ ...styles.miniTag, color: ws.color, background: ws.color + '22' }}>{ws.label}</span>}
              {init && <span style={styles.contextLabel}>in {init.title}</span>}
              <div style={{ flex: 1 }} />
              {dl && <span style={{ ...styles.metaPill, color: dl.color }}>{formatDateShort(task.due_date)} · {dl.sub}</span>}
              <button onClick={() => onEditTask(task)} style={styles.iconBtn}>edit</button>
            </div>
          );
        })}
      </div>

      <div style={styles.mineSection}>
        <h3 style={styles.mineHeader}>My Initiatives ({myInits.length})</h3>
        {myInits.length === 0 && <div style={styles.empty}>No open initiatives owned by you.</div>}
        {myInits.map(init => {
          const dl = formatDeadline(init.target_date);
          const taskList = tasksByInitiative[init.id] || [];
          const doneCount = taskList.filter(t => t.completed_at).length;
          const tag = TAG_MAP[init.tag];
          const status = STATUS_MAP[init.status];
          return (
            <div key={init.id} style={styles.initiativeCard}>
              <div style={styles.initRowHeader}>
                <span style={{ ...styles.statusBadge, color: status.color, background: status.bg }}>{status.label}</span>
                <span style={{ ...styles.tagBadge, color: tag.color, background: tag.bg }}>{tag.label}</span>
                <span style={styles.initTitle}>{init.title}</span>
                <div style={{ flex: 1 }} />
                <span style={styles.taskCounter}>{doneCount}/{taskList.length}</span>
                {dl && <span style={{ ...styles.metaPill, color: dl.color }}>{formatDateShort(init.target_date)} · {dl.sub}</span>}
                <button onClick={() => onEditInit(init)} style={styles.iconBtn}>edit</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Styles
// ════════════════════════════════════════════════════════════
const styles = {
  page: {
    padding: '24px 28px 60px',
    color: '#e2e8f0',
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  loading: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: '14px',
    padding: '60px 20px',
    textAlign: 'center',
  },

  // Header
  header: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '14px',
    padding: '18px 20px',
    marginBottom: '16px',
  },
  headerTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '20px',
    marginBottom: '14px',
  },
  pageTitle: {
    margin: 0,
    fontSize: '24px',
    fontWeight: 700,
    color: '#fff',
    letterSpacing: '-0.4px',
  },
  pageSubtitle: {
    margin: '4px 0 0',
    fontSize: '13px',
    color: 'rgba(255,255,255,0.45)',
  },
  headerStats: {
    display: 'flex',
    gap: '14px',
    alignItems: 'stretch',
  },
  countdownBox: {
    background: 'rgba(99,102,241,0.08)',
    border: '1px solid rgba(99,102,241,0.2)',
    borderRadius: '10px',
    padding: '10px 16px',
    minWidth: '120px',
    textAlign: 'center',
  },
  countdownDays: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#a5b4fc',
    lineHeight: 1,
    letterSpacing: '-0.5px',
  },
  countdownUnit: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'rgba(165,180,252,0.6)',
    marginLeft: '2px',
  },
  countdownLabel: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.5)',
    marginTop: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
  },
  miniEditBtn: {
    background: 'transparent',
    border: 'none',
    color: 'rgba(165,180,252,0.6)',
    cursor: 'pointer',
    fontSize: '10px',
    padding: '0 4px',
    fontFamily: 'inherit',
    textDecoration: 'underline',
  },
  setLaunchBtn: {
    background: 'rgba(99,102,241,0.08)',
    border: '1px dashed rgba(99,102,241,0.3)',
    borderRadius: '10px',
    padding: '10px 16px',
    color: '#a5b4fc',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 600,
    fontFamily: 'inherit',
  },
  overallBox: {
    background: 'rgba(34,197,94,0.06)',
    border: '1px solid rgba(34,197,94,0.18)',
    borderRadius: '10px',
    padding: '10px 16px',
    minWidth: '90px',
    textAlign: 'center',
  },
  overallPctNum: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#86efac',
    lineHeight: 1,
  },
  overallPctLabel: {
    fontSize: '11px',
    color: 'rgba(134,239,172,0.6)',
    marginTop: '4px',
  },
  launchEditorRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    marginBottom: '10px',
  },
  milestonesRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    alignItems: 'center',
    paddingTop: '8px',
    borderTop: '1px solid rgba(255,255,255,0.05)',
  },
  milestonesLabel: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.4)',
    fontWeight: 600,
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    marginRight: '4px',
  },
  milestoneChip: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 10px',
    background: 'rgba(251,191,36,0.08)',
    border: '1px solid rgba(251,191,36,0.2)',
    borderRadius: '8px',
    color: '#fcd34d',
    fontSize: '12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  milestoneTitle: {
    fontWeight: 600,
  },
  milestoneDate: {
    fontSize: '11px',
    color: 'rgba(252,211,77,0.6)',
  },
  milestoneAdd: {
    width: '26px',
    height: '26px',
    border: '1px dashed rgba(255,255,255,0.2)',
    borderRadius: '8px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.45)',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: 'inherit',
  },
  milestoneForm: {
    display: 'flex',
    gap: '8px',
    marginTop: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },

  // Tabs + Filters
  tabBar: {
    display: 'flex',
    gap: '4px',
    padding: '4px',
    background: 'rgba(255,255,255,0.03)',
    borderRadius: '10px',
    marginBottom: '12px',
    alignItems: 'center',
  },
  tabBtn: {
    padding: '8px 14px',
    border: 'none',
    borderRadius: '8px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.55)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.12s',
  },
  tabBtnActive: {
    background: 'rgba(99,102,241,0.15)',
    color: '#a5b4fc',
  },
  filterBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '0 4px',
    marginBottom: '10px',
  },
  tagPills: {
    display: 'flex',
    gap: '4px',
  },
  tagPill: {
    padding: '5px 10px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  toggleLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: 'rgba(255,255,255,0.6)',
    cursor: 'pointer',
  },

  // Forms
  form: {
    background: 'rgba(99,102,241,0.04)',
    border: '1px solid rgba(99,102,241,0.15)',
    borderRadius: '12px',
    padding: '14px',
    marginBottom: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  formLabel: {
    fontSize: '12px',
    fontWeight: 700,
    color: '#a5b4fc',
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
  },
  formSubLabel: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.45)',
    marginTop: '4px',
    fontWeight: 600,
  },
  formRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  input: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    padding: '8px 12px',
    color: '#e2e8f0',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  select: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    padding: '8px 10px',
    color: '#e2e8f0',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
    cursor: 'pointer',
  },
  miniSelect: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    padding: '3px 6px',
    color: '#e2e8f0',
    fontSize: '11px',
    fontFamily: 'inherit',
    outline: 'none',
    cursor: 'pointer',
  },
  primaryBtn: {
    padding: '8px 14px',
    background: 'rgba(99,102,241,0.18)',
    border: '1px solid rgba(99,102,241,0.35)',
    borderRadius: '8px',
    color: '#a5b4fc',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  subtleBtn: {
    padding: '6px 10px',
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  dangerBtn: {
    padding: '6px 10px',
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: '8px',
    color: '#fca5a5',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },

  // Workstream / initiative cards
  workstreamList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  workstreamSection: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '10px',
    overflow: 'hidden',
  },
  workstreamHeader: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 14px',
    background: 'rgba(255,255,255,0.02)',
    border: 'none',
    color: '#e2e8f0',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
  },
  workstreamCaret: {
    fontSize: '10px',
    color: 'rgba(255,255,255,0.4)',
    transition: 'transform 0.15s',
    display: 'inline-block',
  },
  workstreamDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  workstreamLabel: {
    flex: 1,
  },
  workstreamCount: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.4)',
    fontWeight: 500,
  },
  workstreamAddBtn: {
    width: '24px',
    height: '24px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    color: 'rgba(255,255,255,0.6)',
    fontSize: '14px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  workstreamBody: {
    padding: '4px 10px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  empty: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: '12px',
    fontStyle: 'italic',
    padding: '8px 10px',
  },
  emptyTasks: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: '12px',
    fontStyle: 'italic',
    padding: '4px 0',
  },

  // Initiative card
  initiativeCard: {
    background: 'rgba(255,255,255,0.025)',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '8px',
    padding: '10px 12px',
    transition: 'border-color 0.15s',
  },
  initRowHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  initCaretBtn: {
    background: 'transparent',
    border: 'none',
    color: 'rgba(255,255,255,0.4)',
    cursor: 'pointer',
    padding: '2px 4px',
    fontSize: '10px',
    fontFamily: 'inherit',
  },
  initTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#e2e8f0',
  },
  priorityHigh: {
    color: '#ef4444',
    fontSize: '14px',
  },
  statusBadge: {
    fontSize: '10px',
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    flexShrink: 0,
  },
  tagBadge: {
    fontSize: '10px',
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    flexShrink: 0,
  },
  miniTag: {
    fontSize: '10px',
    fontWeight: 600,
    padding: '1px 6px',
    borderRadius: '4px',
    flexShrink: 0,
  },
  ownerChip: {
    width: '22px',
    height: '22px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    color: '#fff',
    fontSize: '11px',
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  metaPill: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.5)',
    background: 'rgba(255,255,255,0.04)',
    padding: '2px 8px',
    borderRadius: '6px',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  taskCounter: {
    fontSize: '11px',
    color: 'rgba(34,197,94,0.8)',
    fontWeight: 600,
    background: 'rgba(34,197,94,0.08)',
    padding: '2px 8px',
    borderRadius: '6px',
    flexShrink: 0,
  },
  initActions: {
    display: 'flex',
    gap: '4px',
    alignItems: 'center',
  },
  iconBtn: {
    background: 'transparent',
    border: 'none',
    color: 'rgba(255,255,255,0.4)',
    cursor: 'pointer',
    padding: '4px 6px',
    borderRadius: '4px',
    fontSize: '12px',
    fontFamily: 'inherit',
  },
  barBg: {
    height: '4px',
    background: 'rgba(255,255,255,0.06)',
    borderRadius: '2px',
    overflow: 'hidden',
    marginTop: '8px',
  },
  barFill: {
    height: '100%',
    transition: 'width 0.3s',
  },
  initBody: {
    marginTop: '10px',
    paddingTop: '10px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  initDescription: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
  },
  linksRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  linkChip: {
    fontSize: '12px',
    color: '#a5b4fc',
    background: 'rgba(99,102,241,0.08)',
    border: '1px solid rgba(99,102,241,0.18)',
    padding: '3px 10px',
    borderRadius: '6px',
    textDecoration: 'none',
  },
  tasksHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: '11px',
    fontWeight: 700,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  taskRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '5px 0',
  },
  checkBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
  },
  checkBox: {
    width: '16px',
    height: '16px',
    border: '1.5px solid rgba(255,255,255,0.3)',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#22c55e',
    fontSize: '12px',
    fontWeight: 700,
  },
  checkBoxDone: {
    background: 'rgba(34,197,94,0.18)',
    borderColor: '#22c55e',
  },
  taskTitle: {
    fontSize: '13px',
    color: '#e2e8f0',
  },
  recurChip: {
    fontSize: '10px',
    color: '#fbbf24',
    background: 'rgba(251,191,36,0.08)',
    padding: '1px 6px',
    borderRadius: '4px',
  },
  contextLabel: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.4)',
  },
  taskForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    background: 'rgba(99,102,241,0.04)',
    border: '1px solid rgba(99,102,241,0.15)',
    borderRadius: '8px',
    padding: '10px',
    marginTop: '4px',
  },
  completedWrap: {
    marginTop: '6px',
  },
  completedToggle: {
    background: 'transparent',
    border: 'none',
    color: 'rgba(255,255,255,0.35)',
    fontSize: '11px',
    cursor: 'pointer',
    padding: '4px 0',
    fontFamily: 'inherit',
  },

  // Timeline
  timelineWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px',
    background: 'rgba(255,255,255,0.02)',
    padding: '14px',
  },
  timelineToolbar: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    marginBottom: '8px',
  },
  timelineLabel: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.5)',
    fontWeight: 600,
    marginRight: '8px',
  },
  timelineAxis: {
    display: 'flex',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    paddingBottom: '6px',
  },
  timelineRowLabel: {
    width: '180px',
    fontSize: '12px',
    color: 'rgba(255,255,255,0.7)',
    paddingRight: '10px',
    flexShrink: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  timelineLane: {
    flex: 1,
    display: 'flex',
    position: 'relative',
    minHeight: '20px',
  },
  timelineMonth: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.45)',
    fontWeight: 600,
    borderLeft: '1px solid rgba(255,255,255,0.06)',
    paddingLeft: '4px',
  },
  timelineOverlayWrap: {
    display: 'flex',
    height: '24px',
    position: 'relative',
  },
  timelineToday: {
    position: 'absolute',
    top: '-4px',
    bottom: 0,
    width: '2px',
    background: '#ef4444',
    zIndex: 2,
  },
  timelineLaunch: {
    position: 'absolute',
    top: 0,
    fontSize: '12px',
    transform: 'translateX(-50%)',
    zIndex: 3,
  },
  timelineMilestone: {
    position: 'absolute',
    top: 4,
    color: '#fbbf24',
    fontSize: '10px',
    transform: 'translateX(-50%)',
    zIndex: 3,
  },
  timelineWsHeader: {
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    padding: '8px 0 4px',
  },
  timelineRow: {
    display: 'flex',
    alignItems: 'center',
    height: '28px',
  },
  timelineBar: {
    position: 'absolute',
    height: '20px',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: 600,
    padding: '0 6px',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    display: 'flex',
    alignItems: 'center',
  },

  // Calendar
  calendarWrap: {
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px',
    background: 'rgba(255,255,255,0.02)',
    padding: '14px',
  },
  calendarHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '10px',
  },
  calendarMonthLabel: {
    fontSize: '15px',
    fontWeight: 700,
    color: '#e2e8f0',
  },
  calendarGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: '4px',
  },
  calendarDayHeader: {
    fontSize: '10px',
    fontWeight: 700,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    textAlign: 'center',
    padding: '4px 0',
  },
  calendarCell: {
    minHeight: '90px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '6px',
    padding: '4px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  calendarCellEmpty: {
    minHeight: '90px',
  },
  calendarCellToday: {
    background: 'rgba(99,102,241,0.06)',
    border: '1px solid rgba(99,102,241,0.25)',
  },
  calendarCellNum: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.5)',
    fontWeight: 600,
  },
  calendarCellEvents: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    flex: 1,
    overflow: 'hidden',
  },
  calendarEvent: {
    fontSize: '10px',
    padding: '1px 4px',
    borderRadius: '3px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  calendarMoreEvents: {
    fontSize: '10px',
    color: 'rgba(255,255,255,0.4)',
    padding: '0 4px',
  },

  // My stuff
  mineWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  mineSection: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px',
    padding: '14px',
  },
  mineHeader: {
    margin: '0 0 10px',
    fontSize: '13px',
    fontWeight: 700,
    color: '#e2e8f0',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
};
