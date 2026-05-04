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
  { key: 'ideas',   label: 'Ideas',   color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' },
  { key: 'planned', label: 'Planned', color: '#60a5fa', bg: 'rgba(96,165,250,0.15)' },
  { key: 'active',  label: 'Active',  color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
  { key: 'waiting', label: 'Waiting', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  { key: 'done',    label: 'Done',    color: '#a3a3a3', bg: 'rgba(163,163,163,0.15)' },
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

const RECURRENCE_OPTIONS = [
  { key: '',        label: 'No repeat' },
  { key: 'daily',   label: 'Daily' },
  { key: 'weekly',  label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
];

const PHASE_PALETTE = ['#6366f1', '#06b6d4', '#a78bfa', '#22c55e', '#f59e0b', '#ec4899', '#3b82f6', '#10b981'];
function phaseColor(phaseIdx) { return PHASE_PALETTE[phaseIdx % PHASE_PALETTE.length]; }

const COMPLETED_GRACE_HOURS = 24;

// ════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════
function todayStr() { return new Date().toISOString().split('T')[0]; }
function parseDateLocal(dateStr) { return dateStr ? new Date(dateStr + 'T00:00:00') : null; }
function daysBetween(a, b) { return Math.round((a - b) / 86400000); }

function formatDate(dateStr) {
  if (!dateStr) return '';
  return parseDateLocal(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function formatDateShort(dateStr) {
  if (!dateStr) return '';
  return parseDateLocal(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
  return (Date.now() - new Date(completedAt).getTime()) / 3_600_000 < COMPLETED_GRACE_HOURS;
}
function effectiveTag(task, initiative) { return task.tag || initiative?.tag || 'shared'; }

// ════════════════════════════════════════════════════════════
// Empty form templates
// ════════════════════════════════════════════════════════════
const EMPTY_PHASE = { name: '', launch_target_date: '' };
const EMPTY_INITIATIVE = {
  workstream: 'facility', title: '', description: '', status: 'planned',
  tag: 'shared', owner_id: null, target_date: '', budget_dollars: '',
  priority: 'med', phase_id: null,
};
const EMPTY_TASK = { title: '', notes: '', tag: '', owner_id: null, due_date: '', recurrence_interval: '', recurrence_count: 1 };
const EMPTY_MILESTONE = { title: '', target_date: '' };

// ════════════════════════════════════════════════════════════
// Main page
// ════════════════════════════════════════════════════════════
export default function BusinessDev() {
  const { profile, isAdmin } = useAuth();

  // Data
  const [phases, setPhases] = useState([]);
  const [initiatives, setInitiatives] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [links, setLinks] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);

  // View
  const [view, setView] = useState('phases'); // phases | timeline | calendar | mine

  // UI state
  const [expandedPhases, setExpandedPhases] = useState({}); // phaseId -> bool
  const [collapsedWorkstreams, setCollapsedWorkstreams] = useState({}); // `${phaseId}::${ws}` -> bool
  const [expandedInitiatives, setExpandedInitiatives] = useState({});
  const [tagFilters, setTagFilters] = useState({}); // phaseId -> 'all'|'mayday'|'neptune'|'shared'
  const [hideDones, setHideDones] = useState({});   // phaseId -> bool (default true)
  const [enabledPhases, setEnabledPhases] = useState({}); // phaseId -> bool (for global views)

  // Forms
  const [showPhaseForm, setShowPhaseForm] = useState(false);
  const [editingPhaseId, setEditingPhaseId] = useState(null);
  const [phaseForm, setPhaseForm] = useState(EMPTY_PHASE);

  const [showInitForm, setShowInitForm] = useState(false);
  const [editingInitId, setEditingInitId] = useState(null);
  const [initForm, setInitForm] = useState(EMPTY_INITIATIVE);

  const [taskFormFor, setTaskFormFor] = useState(null);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [taskForm, setTaskForm] = useState(EMPTY_TASK);

  const [milestoneFormFor, setMilestoneFormFor] = useState(null); // phaseId
  const [editingMilestoneId, setEditingMilestoneId] = useState(null);
  const [milestoneForm, setMilestoneForm] = useState(EMPTY_MILESTONE);

  // Delete-confirm state
  const [deletingPhase, setDeletingPhase] = useState(null); // phase object
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // ─────────────────────────────────────────────
  // Fetch all
  // ─────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [phRes, initRes, taskRes, linkRes, msRes, adminRes] = await Promise.all([
        supabase.from('bd_phases').select('*').is('archived_at', null).order('position'),
        supabase.from('bd_initiatives').select('*').order('position'),
        supabase.from('bd_tasks').select('*').order('position'),
        supabase.from('bd_initiative_links').select('*').order('position'),
        supabase.from('bd_milestones').select('*').is('retired_at', null).order('target_date'),
        supabase.from('profiles').select('id, full_name, role').eq('role', 'admin').order('full_name'),
      ]);
      const phs = phRes.data || [];
      setPhases(phs);
      setInitiatives(initRes.data || []);
      setTasks(taskRes.data || []);
      setLinks(linkRes.data || []);
      setMilestones(msRes.data || []);
      setAdmins(adminRes.data || []);

      // Default expanded state on first load: solo phase = expanded, multi = collapsed
      setExpandedPhases(prev => {
        if (Object.keys(prev).length > 0) return prev;
        const next = {};
        if (phs.length === 1) next[phs[0].id] = true;
        return next;
      });

      // Default enabledPhases for global views: all on
      setEnabledPhases(prev => {
        const next = { ...prev };
        for (const p of phs) if (next[p.id] === undefined) next[p.id] = true;
        return next;
      });

      // Default per-phase filters
      setTagFilters(prev => {
        const next = { ...prev };
        for (const p of phs) if (!next[p.id]) next[p.id] = 'all';
        return next;
      });
      setHideDones(prev => {
        const next = { ...prev };
        for (const p of phs) if (next[p.id] === undefined) next[p.id] = true;
        return next;
      });
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
  // Derived
  // ─────────────────────────────────────────────
  const phasesById = useMemo(() => Object.fromEntries(phases.map(p => [p.id, p])), [phases]);
  const phaseIndexById = useMemo(() => Object.fromEntries(phases.map((p, i) => [p.id, i])), [phases]);

  const tasksByInitiative = useMemo(() => {
    const m = {};
    for (const t of tasks) (m[t.initiative_id] = m[t.initiative_id] || []).push(t);
    return m;
  }, [tasks]);

  const linksByInitiative = useMemo(() => {
    const m = {};
    for (const l of links) (m[l.initiative_id] = m[l.initiative_id] || []).push(l);
    return m;
  }, [links]);

  const initiativesByPhase = useMemo(() => {
    const m = {};
    for (const i of initiatives) (m[i.phase_id] = m[i.phase_id] || []).push(i);
    return m;
  }, [initiatives]);

  const milestonesByPhase = useMemo(() => {
    const m = {};
    for (const ms of milestones) (m[ms.phase_id] = m[ms.phase_id] || []).push(ms);
    return m;
  }, [milestones]);

  // ─────────────────────────────────────────────
  // Phase CRUD
  // ─────────────────────────────────────────────
  function openCreatePhase() {
    setEditingPhaseId(null);
    setPhaseForm(EMPTY_PHASE);
    setShowPhaseForm(true);
  }
  function openEditPhase(phase) {
    setEditingPhaseId(phase.id);
    setPhaseForm({ name: phase.name, launch_target_date: phase.launch_target_date || '' });
    setShowPhaseForm(true);
  }
  function cancelPhaseForm() {
    setShowPhaseForm(false);
    setEditingPhaseId(null);
    setPhaseForm(EMPTY_PHASE);
  }
  async function handlePhaseSubmit(e) {
    e.preventDefault();
    const name = phaseForm.name.trim();
    if (!name) return;
    const payload = { name, launch_target_date: phaseForm.launch_target_date || null };
    if (editingPhaseId) {
      const { error } = await supabase.from('bd_phases').update(payload).eq('id', editingPhaseId);
      if (error) { alert(error.message); return; }
    } else {
      const maxPos = Math.max(0, ...phases.map(p => p.position || 0));
      const { data, error } = await supabase.from('bd_phases').insert({
        ...payload, position: maxPos + 1, created_by: profile.id,
      }).select().single();
      if (error) { alert(error.message); return; }
      // Auto-expand newly created phase
      setExpandedPhases(prev => ({ ...prev, [data.id]: true }));
      setEnabledPhases(prev => ({ ...prev, [data.id]: true }));
      setTagFilters(prev => ({ ...prev, [data.id]: 'all' }));
      setHideDones(prev => ({ ...prev, [data.id]: true }));
    }
    cancelPhaseForm();
    fetchAll();
  }
  function openDeletePhase(phase) {
    setDeletingPhase(phase);
    setDeleteConfirmText('');
  }
  function cancelDeletePhase() {
    setDeletingPhase(null);
    setDeleteConfirmText('');
  }
  async function confirmDeletePhase() {
    if (!deletingPhase) return;
    if (deleteConfirmText !== deletingPhase.name) return;
    await supabase.from('bd_phases').delete().eq('id', deletingPhase.id);
    cancelDeletePhase();
    fetchAll();
  }
  async function handleMovePhase(phase, direction) {
    const idx = phases.findIndex(p => p.id === phase.id);
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= phases.length) return;
    const swap = phases[newIdx];
    await Promise.all([
      supabase.from('bd_phases').update({ position: swap.position }).eq('id', phase.id),
      supabase.from('bd_phases').update({ position: phase.position }).eq('id', swap.id),
    ]);
    fetchAll();
  }

  // ─────────────────────────────────────────────
  // Initiative CRUD
  // ─────────────────────────────────────────────
  function openCreateInit(phaseId, workstream) {
    setEditingInitId(null);
    setInitForm({ ...EMPTY_INITIATIVE, phase_id: phaseId, workstream: workstream || 'facility' });
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
      phase_id: init.phase_id,
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
    if (!title || !initForm.phase_id) { alert('Title and phase are required.'); return; }
    const budget_cents = initForm.budget_dollars === '' ? null : Math.round(parseFloat(initForm.budget_dollars) * 100);
    const status = initForm.status;
    const completed_at = status === 'done' ? new Date().toISOString() : null;
    const payload = {
      phase_id: initForm.phase_id,
      workstream: initForm.workstream,
      title,
      description: initForm.description || null,
      status, tag: initForm.tag,
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
      const siblings = (initiativesByPhase[payload.phase_id] || []).filter(i => i.workstream === payload.workstream);
      const maxPos = Math.max(0, ...siblings.map(i => i.position || 0));
      const { data, error } = await supabase.from('bd_initiatives').insert({
        ...payload, position: maxPos + 1, created_by: profile.id,
      }).select().single();
      if (error) { alert(error.message); return; }
      savedId = data.id;
    }

    // Sync links
    if (initForm._links !== undefined && savedId) {
      const desired = initForm._links.filter(l => l.label?.trim() && l.url?.trim());
      const existing = linksByInitiative[savedId] || [];
      const desiredIds = new Set(desired.filter(l => l.id).map(l => l.id));
      for (const l of existing) {
        if (!desiredIds.has(l.id)) await supabase.from('bd_initiative_links').delete().eq('id', l.id);
      }
      for (let i = 0; i < desired.length; i++) {
        const l = desired[i];
        if (l.id) {
          await supabase.from('bd_initiative_links').update({ label: l.label, url: l.url, position: i }).eq('id', l.id);
        } else {
          await supabase.from('bd_initiative_links').insert({ initiative_id: savedId, label: l.label, url: l.url, position: i });
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
      .filter(i => i.phase_id === initiative.phase_id && i.workstream === initiative.workstream)
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
      const { error } = await supabase.from('bd_tasks').insert({ ...payload, position: maxPos + 1, created_by: profile.id });
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
  // Milestone CRUD (per phase)
  // ─────────────────────────────────────────────
  function openCreateMilestone(phaseId) {
    setEditingMilestoneId(null);
    setMilestoneForm(EMPTY_MILESTONE);
    setMilestoneFormFor(phaseId);
  }
  function openEditMilestone(ms) {
    setEditingMilestoneId(ms.id);
    setMilestoneForm({ title: ms.title, target_date: ms.target_date || '' });
    setMilestoneFormFor(ms.phase_id);
  }
  function cancelMilestoneForm() {
    setMilestoneFormFor(null);
    setEditingMilestoneId(null);
    setMilestoneForm(EMPTY_MILESTONE);
  }
  async function handleMilestoneSubmit(e, phaseId) {
    e.preventDefault();
    if (!milestoneForm.title.trim()) return;
    const payload = {
      phase_id: phaseId,
      title: milestoneForm.title.trim(),
      target_date: milestoneForm.target_date || null,
    };
    if (editingMilestoneId) {
      await supabase.from('bd_milestones').update(payload).eq('id', editingMilestoneId);
    } else {
      const siblings = milestonesByPhase[phaseId] || [];
      const maxPos = Math.max(0, ...siblings.map(m => m.position || 0));
      await supabase.from('bd_milestones').insert({ ...payload, position: maxPos + 1, created_by: profile.id });
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
  // Render
  // ─────────────────────────────────────────────
  if (!isAdmin) return <div style={styles.page}><div style={styles.loading}>Admin access required.</div></div>;
  if (loading)  return <div style={styles.page}><div style={styles.loading}>Loading Business Dev...</div></div>;

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <div>
          <h1 style={styles.pageTitle}>Business Dev</h1>
          <p style={styles.pageSubtitle}>Multi-phase program tracker</p>
        </div>
        <button onClick={openCreatePhase} style={styles.primaryBtn}>+ Phase</button>
      </div>

      {/* Tab bar */}
      <div style={styles.tabBar}>
        {[
          { key: 'phases',   label: 'Phases' },
          { key: 'timeline', label: 'Timeline' },
          { key: 'calendar', label: 'Calendar' },
          { key: 'mine',     label: 'My Stuff' },
        ].map(t => (
          <button key={t.key} onClick={() => setView(t.key)}
            style={{ ...styles.tabBtn, ...(view === t.key ? styles.tabBtnActive : {}) }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Phase form */}
      {showPhaseForm && (
        <PhaseForm
          form={phaseForm}
          setForm={setPhaseForm}
          editing={!!editingPhaseId}
          onSubmit={handlePhaseSubmit}
          onCancel={cancelPhaseForm}
        />
      )}

      {/* Initiative form (always rendered when active; phase selector lets you move it) */}
      {showInitForm && (
        <InitiativeForm
          form={initForm}
          setForm={setInitForm}
          editing={!!editingInitId}
          phases={phases}
          admins={admins}
          existingLinks={editingInitId ? (linksByInitiative[editingInitId] || []) : []}
          onSubmit={handleInitSubmit}
          onCancel={cancelInitForm}
        />
      )}

      {/* Delete-phase confirm modal */}
      {deletingPhase && (
        <DeletePhaseConfirm
          phase={deletingPhase}
          counts={{
            initiatives: (initiativesByPhase[deletingPhase.id] || []).length,
            tasks: tasks.filter(t => {
              const init = initiatives.find(i => i.id === t.initiative_id);
              return init?.phase_id === deletingPhase.id;
            }).length,
            milestones: (milestonesByPhase[deletingPhase.id] || []).length,
          }}
          confirmText={deleteConfirmText}
          setConfirmText={setDeleteConfirmText}
          onCancel={cancelDeletePhase}
          onConfirm={confirmDeletePhase}
        />
      )}

      {/* Views */}
      {view === 'phases' && (
        phases.length === 0 ? (
          <div style={styles.empty}>No phases yet. Click + Phase to create one.</div>
        ) : (
          <div style={styles.phaseList}>
            {phases.map((phase, idx) => (
              <PhaseCard
                key={phase.id}
                phase={phase}
                phaseIdx={idx}
                phaseCount={phases.length}
                initiatives={initiativesByPhase[phase.id] || []}
                tasksByInitiative={tasksByInitiative}
                linksByInitiative={linksByInitiative}
                milestones={milestonesByPhase[phase.id] || []}
                admins={admins}
                expanded={!!expandedPhases[phase.id]}
                onToggleExpand={() => setExpandedPhases(prev => ({ ...prev, [phase.id]: !prev[phase.id] }))}
                onEditPhase={() => openEditPhase(phase)}
                onDeletePhase={() => openDeletePhase(phase)}
                onMovePhaseUp={idx > 0 ? () => handleMovePhase(phase, 'up') : null}
                onMovePhaseDown={idx < phases.length - 1 ? () => handleMovePhase(phase, 'down') : null}
                tagFilter={tagFilters[phase.id] || 'all'}
                setTagFilter={(v) => setTagFilters(prev => ({ ...prev, [phase.id]: v }))}
                hideDone={hideDones[phase.id] !== false}
                setHideDone={(v) => setHideDones(prev => ({ ...prev, [phase.id]: v }))}
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
                milestoneFormFor={milestoneFormFor}
                editingMilestoneId={editingMilestoneId}
                milestoneForm={milestoneForm}
                setMilestoneForm={setMilestoneForm}
                onCreateMilestone={openCreateMilestone}
                onEditMilestone={openEditMilestone}
                onMilestoneSubmit={handleMilestoneSubmit}
                onCancelMilestoneForm={cancelMilestoneForm}
                onRetireMilestone={handleRetireMilestone}
              />
            ))}
          </div>
        )
      )}

      {view === 'timeline' && (
        <PhaseChipFilter
          phases={phases}
          enabled={enabledPhases}
          setEnabled={setEnabledPhases}
        />
      )}
      {view === 'timeline' && (
        <TimelineView
          phases={phases}
          phasesById={phasesById}
          phaseIndexById={phaseIndexById}
          initiatives={initiatives}
          milestones={milestones}
          enabledPhases={enabledPhases}
        />
      )}

      {view === 'calendar' && (
        <PhaseChipFilter
          phases={phases}
          enabled={enabledPhases}
          setEnabled={setEnabledPhases}
        />
      )}
      {view === 'calendar' && (
        <CalendarView
          phasesById={phasesById}
          phaseIndexById={phaseIndexById}
          initiatives={initiatives}
          tasks={tasks}
          milestones={milestones}
          enabledPhases={enabledPhases}
        />
      )}

      {view === 'mine' && (
        <PhaseChipFilter
          phases={phases}
          enabled={enabledPhases}
          setEnabled={setEnabledPhases}
        />
      )}
      {view === 'mine' && (
        <MyStuffView
          profile={profile}
          phasesById={phasesById}
          phaseIndexById={phaseIndexById}
          initiatives={initiatives}
          tasks={tasks}
          tasksByInitiative={tasksByInitiative}
          enabledPhases={enabledPhases}
          onToggleTask={handleToggleTask}
          onEditInit={openEditInit}
          onEditTask={openEditTask}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Phase form
// ════════════════════════════════════════════════════════════
function PhaseForm({ form, setForm, editing, onSubmit, onCancel }) {
  return (
    <form onSubmit={onSubmit} style={styles.form}>
      <div style={styles.formLabel}>{editing ? 'Edit Phase' : 'New Phase'}</div>
      <input
        value={form.name}
        onChange={e => setForm({ ...form, name: e.target.value })}
        placeholder="Phase name (e.g., Mayday Media + Neptune Performance — buildout & ops)"
        autoFocus
        style={styles.input}
      />
      <div style={styles.formRow}>
        <label style={styles.formInlineLabel}>Launch target date (optional):</label>
        <input
          type="date"
          value={form.launch_target_date}
          onChange={e => setForm({ ...form, launch_target_date: e.target.value })}
          style={styles.input}
        />
      </div>
      <div style={styles.formRow}>
        <button type="submit" style={styles.primaryBtn}>{editing ? 'Update' : 'Create Phase'}</button>
        <button type="button" onClick={onCancel} style={styles.subtleBtn}>Cancel</button>
      </div>
    </form>
  );
}

// ════════════════════════════════════════════════════════════
// Delete-phase confirm
// ════════════════════════════════════════════════════════════
function DeletePhaseConfirm({ phase, counts, confirmText, setConfirmText, onCancel, onConfirm }) {
  const matches = confirmText === phase.name;
  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <div style={styles.modalTitle}>Delete phase</div>
        <div style={styles.modalBody}>
          This will permanently delete <strong>{phase.name}</strong> and everything inside it:
          <ul style={styles.modalList}>
            <li>{counts.initiatives} initiative{counts.initiatives !== 1 ? 's' : ''}</li>
            <li>{counts.tasks} task{counts.tasks !== 1 ? 's' : ''}</li>
            <li>{counts.milestones} milestone{counts.milestones !== 1 ? 's' : ''}</li>
          </ul>
          <div style={styles.modalConfirmHint}>
            Type the phase name exactly to confirm:
          </div>
          <div style={styles.modalConfirmName}>{phase.name}</div>
          <input
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            placeholder="Type phase name here"
            autoFocus
            style={styles.input}
          />
        </div>
        <div style={styles.modalActions}>
          <button onClick={onCancel} style={styles.subtleBtn}>Cancel</button>
          <button onClick={onConfirm} disabled={!matches}
            style={{ ...styles.dangerBtn, opacity: matches ? 1 : 0.4, cursor: matches ? 'pointer' : 'not-allowed' }}>
            Delete Phase
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Phase card (collapsible per-phase wrapper)
// ════════════════════════════════════════════════════════════
function PhaseCard(props) {
  const {
    phase, phaseIdx, phaseCount, initiatives, tasksByInitiative, linksByInitiative,
    milestones, admins,
    expanded, onToggleExpand, onEditPhase, onDeletePhase, onMovePhaseUp, onMovePhaseDown,
    tagFilter, setTagFilter, hideDone, setHideDone,
    collapsedWorkstreams, setCollapsedWorkstreams,
    expandedInitiatives, setExpandedInitiatives,
    taskFormFor, editingTaskId, taskForm, setTaskForm,
    onOpenCreateTask, onOpenEditTask, onTaskSubmit, onCancelTaskForm, onToggleTask, onDeleteTask,
    onEditInit, onDeleteInit, onMoveInit, onCreateInit, onStatusChange,
    milestoneFormFor, editingMilestoneId, milestoneForm, setMilestoneForm,
    onCreateMilestone, onEditMilestone, onMilestoneSubmit, onCancelMilestoneForm, onRetireMilestone,
  } = props;

  const launchCountdown = useMemo(() => {
    if (!phase.launch_target_date) return null;
    const target = parseDateLocal(phase.launch_target_date);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return daysBetween(target, now);
  }, [phase.launch_target_date]);

  const overallPct = useMemo(() => {
    if (initiatives.length === 0) return 0;
    const done = initiatives.filter(i => i.status === 'done').length;
    return Math.round((done / initiatives.length) * 100);
  }, [initiatives]);

  const filteredInitiatives = useMemo(() =>
    initiatives.filter(i => {
      if (tagFilter !== 'all' && i.tag !== tagFilter) return false;
      if (hideDone && i.status === 'done' && !isRecentlyCompleted(i.completed_at)) return false;
      return true;
    }),
  [initiatives, tagFilter, hideDone]);

  const color = phaseColor(phaseIdx);

  return (
    <div style={{ ...styles.phaseCard, borderColor: color + '33' }}>
      {/* Header (always visible) */}
      <div style={styles.phaseHeaderRow}>
        <button onClick={onToggleExpand} style={styles.phaseCaretBtn}>
          <span style={{ display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>▶</span>
        </button>
        <span style={{ ...styles.phaseColorDot, background: color }} />
        <span style={styles.phaseName}>{phase.name}</span>

        {launchCountdown != null && (
          <span style={styles.phaseHeaderStat}>
            <span style={{ color }}>{launchCountdown >= 0 ? `${launchCountdown}d` : `${Math.abs(launchCountdown)}d past`}</span>
            <span style={styles.phaseHeaderStatLabel}>to {formatDateShort(phase.launch_target_date)}</span>
          </span>
        )}
        {phase.launch_target_date == null && (
          <span style={styles.phaseHeaderStat}>
            <span style={{ color: 'rgba(255,255,255,0.35)' }}>—</span>
            <span style={styles.phaseHeaderStatLabel}>no launch date</span>
          </span>
        )}

        <span style={styles.phaseHeaderStat}>
          <span style={{ color: '#86efac' }}>{overallPct}%</span>
          <span style={styles.phaseHeaderStatLabel}>{initiatives.filter(i => i.status === 'done').length} / {initiatives.length}</span>
        </span>

        <div style={{ flex: 1 }} />

        <div style={styles.phaseActions}>
          {onMovePhaseUp && <button onClick={onMovePhaseUp} style={styles.iconBtn} title="Move up">▲</button>}
          {onMovePhaseDown && <button onClick={onMovePhaseDown} style={styles.iconBtn} title="Move down">▼</button>}
          <button onClick={onEditPhase} style={styles.iconBtn} title="Edit phase">edit</button>
          {phaseCount > 1 && (
            <button onClick={onDeletePhase} style={{ ...styles.iconBtn, color: '#fca5a5' }} title="Delete phase">delete</button>
          )}
          {phaseCount === 1 && (
            <button onClick={onDeletePhase} style={{ ...styles.iconBtn, color: '#fca5a5' }} title="Delete phase">delete</button>
          )}
        </div>
      </div>

      {expanded && (
        <div style={styles.phaseBody}>
          {/* Milestones row (per phase) */}
          <div style={styles.milestonesRow}>
            <span style={styles.milestonesLabel}>Milestones:</span>
            {milestones.map(ms => (
              <button key={ms.id} onClick={() => onEditMilestone(ms)} style={styles.milestoneChip}
                title={`${ms.title}${ms.target_date ? ' — ' + formatDate(ms.target_date) : ''}`}>
                <span style={styles.milestoneTitle}>{ms.title}</span>
                {ms.target_date && <span style={styles.milestoneDate}>{formatDateShort(ms.target_date)}</span>}
              </button>
            ))}
            <button onClick={() => onCreateMilestone(phase.id)} style={styles.milestoneAdd}>+</button>
          </div>

          {/* Milestone form (per phase) */}
          {milestoneFormFor === phase.id && (
            <form onSubmit={e => onMilestoneSubmit(e, phase.id)} style={styles.milestoneForm}>
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

          {/* Filter bar (per phase) */}
          <div style={styles.filterBar}>
            <div style={styles.tagPills}>
              {[{ key: 'all', label: 'All', color: 'rgba(255,255,255,0.4)' }, ...TAGS].map(t => (
                <button key={t.key} onClick={() => setTagFilter(t.key)}
                  style={{
                    ...styles.tagPill,
                    ...(tagFilter === t.key ? {
                      background: (t.bg || 'rgba(255,255,255,0.1)'),
                      color: t.color, borderColor: (t.color || '#fff') + '55',
                    } : {}),
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

          {/* Workstreams */}
          {WORKSTREAMS.map(ws => {
            const wsInits = filteredInitiatives.filter(i => i.workstream === ws.key);
            const totalCount = wsInits.length;
            const doneCount = wsInits.filter(i => i.status === 'done').length;
            const wsKey = `${phase.id}::${ws.key}`;
            const collapsed = collapsedWorkstreams[wsKey];
            const sorted = [...wsInits].sort((a, b) => {
              const sa = STATUS_ORDER[a.status] ?? 9;
              const sb = STATUS_ORDER[b.status] ?? 9;
              if (sa !== sb) return sa - sb;
              if (a.target_date && b.target_date) return a.target_date.localeCompare(b.target_date);
              if (a.target_date) return -1;
              if (b.target_date) return 1;
              return (a.position || 0) - (b.position || 0);
            });
            const activeRows = [];
            const completedRows = [];
            for (const init of sorted) {
              if (init.status === 'done' && !isRecentlyCompleted(init.completed_at)) completedRows.push(init);
              else activeRows.push(init);
            }
            const showCompleted = !hideDone && completedRows.length > 0;

            return (
              <div key={ws.key} style={styles.workstreamSection}>
                <button
                  onClick={() => setCollapsedWorkstreams(prev => ({ ...prev, [wsKey]: !prev[wsKey] }))}
                  style={styles.workstreamHeader}
                >
                  <span style={{ ...styles.workstreamCaret, transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}>▶</span>
                  <span style={{ ...styles.workstreamDot, background: ws.color }} />
                  <span style={styles.workstreamLabel}>{ws.label}</span>
                  <span style={styles.workstreamCount}>{doneCount} / {totalCount} done</span>
                  <button onClick={(e) => { e.stopPropagation(); onCreateInit(phase.id, ws.key); }} style={styles.workstreamAddBtn}>+</button>
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
      )}
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
  const owner = admins.find(a => a.id === initiative.owner_id);
  const dl = formatDeadline(initiative.target_date);
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter(t => t.completed_at).length;
  const taskPct = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;

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
        {initiative.priority === 'high' && <span style={styles.priorityHigh}>★</span>}
        <div style={{ flex: 1 }} />
        {owner && <span style={styles.ownerChip} title={owner.full_name}>{owner.full_name?.charAt(0).toUpperCase()}</span>}
        {initiative.budget_cents != null && <span style={styles.metaPill}>{formatBudget(initiative.budget_cents)}</span>}
        {dl && <span style={{ ...styles.metaPill, color: dl.color }}>{formatDateShort(initiative.target_date)} · {dl.sub}</span>}
        {totalTasks > 0 && <span style={styles.taskCounter}>{doneTasks}/{totalTasks}</span>}
        <div style={styles.initActions}>
          {onMoveUp && <button onClick={onMoveUp} style={styles.iconBtn} title="Move up">▲</button>}
          {onMoveDown && <button onClick={onMoveDown} style={styles.iconBtn} title="Move down">▼</button>}
          <select value={initiative.status} onChange={(e) => onStatusChange(initiative.id, e.target.value)}
            style={styles.miniSelect} onClick={(e) => e.stopPropagation()}>
            {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button onClick={onEdit} style={styles.iconBtn} title="Edit">edit</button>
          <button onClick={onDelete} style={styles.iconBtn} title="Delete">×</button>
        </div>
      </div>

      {totalTasks > 0 && (
        <div style={styles.barBg}>
          <div style={{ ...styles.barFill, width: `${taskPct}%`, background: '#22c55e' }} />
        </div>
      )}

      {expanded && (
        <div style={styles.initBody}>
          {initiative.description && <div style={styles.initDescription}>{initiative.description}</div>}
          {initiativeLinks.length > 0 && (
            <div style={styles.linksRow}>
              {initiativeLinks.map(l => (
                <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer" style={styles.linkChip}>↗ {l.label}</a>
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
            <TaskForm form={taskForm} setForm={setTaskForm} admins={admins}
              onSubmit={(e) => onTaskSubmit(e, initiative.id)} onCancel={onCancelTaskForm} />
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
  if (isEditing) return <TaskForm form={taskForm} setForm={setTaskForm} admins={admins} onSubmit={onSubmit} onCancel={onCancel} editing />;
  const done = !!task.completed_at;
  const owner = admins.find(a => a.id === task.owner_id);
  const dl = formatDeadline(task.due_date);
  const tag = effectiveTag(task, initiative);
  const tagMeta = TAG_MAP[tag];
  return (
    <div style={{ ...styles.taskRow, opacity: done ? 0.55 : 1 }}>
      <button onClick={onToggle} style={styles.checkBtn}>
        <span style={{ ...styles.checkBox, ...(done ? styles.checkBoxDone : {}) }}>{done && '✓'}</span>
      </button>
      <span style={{ ...styles.taskTitle, textDecoration: done ? 'line-through' : 'none' }}>{task.title}</span>
      {task.recurrence_interval && <span style={styles.recurChip} title={`Repeats ${task.recurrence_interval}`}>↻ {task.recurrence_interval}</span>}
      {task.tag && task.tag !== initiative.tag && (
        <span style={{ ...styles.miniTag, color: tagMeta.color, background: tagMeta.bg }}>{tagMeta.label}</span>
      )}
      <div style={{ flex: 1 }} />
      {dl && !done && <span style={{ ...styles.metaPill, color: dl.color }}>{formatDateShort(task.due_date)} · {dl.sub}</span>}
      {dl && done && <span style={styles.metaPill}>{formatDateShort(task.due_date)}</span>}
      {owner && <span style={styles.ownerChip} title={owner.full_name}>{owner.full_name?.charAt(0).toUpperCase()}</span>}
      <button onClick={onEdit} style={styles.iconBtn}>edit</button>
      <button onClick={onDelete} style={styles.iconBtn}>×</button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Initiative form (with phase selector to support cross-phase moves)
// ════════════════════════════════════════════════════════════
function InitiativeForm({ form, setForm, editing, phases, admins, existingLinks, onSubmit, onCancel }) {
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
        <select value={form.phase_id || ''} onChange={e => setForm({ ...form, phase_id: e.target.value })} style={styles.select}>
          <option value="">Select phase...</option>
          {phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={form.workstream} onChange={e => setForm({ ...form, workstream: e.target.value })} style={styles.select}>
          {WORKSTREAMS.map(w => <option key={w.key} value={w.key}>{w.label}</option>)}
        </select>
      </div>

      <div style={styles.formRow}>
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
        <input type="date" value={form.target_date} onChange={e => setForm({ ...form, target_date: e.target.value })}
          style={{ ...styles.input, flex: 1 }} />
        <select value={form.owner_id || ''} onChange={e => setForm({ ...form, owner_id: e.target.value || null })}
          style={{ ...styles.select, flex: 1 }}>
          <option value="">No owner</option>
          {admins.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
        </select>
        <input value={form.budget_dollars} onChange={e => setForm({ ...form, budget_dollars: e.target.value })}
          placeholder="Budget ($)" inputMode="decimal" style={{ ...styles.input, flex: 1 }} />
      </div>

      <div style={styles.formSubLabel}>Links</div>
      {(form._links || []).map((l, idx) => (
        <div key={idx} style={styles.formRow}>
          <input value={l.label} onChange={e => updateLink(idx, 'label', e.target.value)} placeholder="Label"
            style={{ ...styles.input, flex: 1 }} />
          <input value={l.url} onChange={e => updateLink(idx, 'url', e.target.value)} placeholder="https://"
            style={{ ...styles.input, flex: 2 }} />
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
      <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
        placeholder="Task title" autoFocus style={styles.input} />
      <div style={styles.formRow}>
        <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })}
          style={{ ...styles.input, flex: 1 }} />
        <select value={form.owner_id || ''} onChange={e => setForm({ ...form, owner_id: e.target.value || null })}
          style={{ ...styles.select, flex: 1 }}>
          <option value="">No owner</option>
          {admins.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
        </select>
        <select value={form.tag} onChange={e => setForm({ ...form, tag: e.target.value })}
          style={{ ...styles.select, flex: 1 }}>
          <option value="">Inherit tag</option>
          {TAGS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </div>
      <div style={styles.formRow}>
        <select value={form.recurrence_interval} onChange={e => setForm({ ...form, recurrence_interval: e.target.value })}
          style={{ ...styles.select, flex: 1 }}>
          {RECURRENCE_OPTIONS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        {form.recurrence_interval && (
          <input type="number" min="1" value={form.recurrence_count}
            onChange={e => setForm({ ...form, recurrence_count: e.target.value })}
            placeholder="Every N" style={{ ...styles.input, width: '90px' }} />
        )}
      </div>
      <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
        placeholder="Notes (optional)" style={{ ...styles.input, minHeight: '50px', resize: 'vertical' }} />
      <div style={styles.formRow}>
        <button type="submit" style={styles.primaryBtn}>{editing ? 'Update' : 'Add Task'}</button>
        <button type="button" onClick={onCancel} style={styles.subtleBtn}>Cancel</button>
      </div>
    </form>
  );
}

// ════════════════════════════════════════════════════════════
// Phase chip filter (for global views)
// ════════════════════════════════════════════════════════════
function PhaseChipFilter({ phases, enabled, setEnabled }) {
  if (phases.length <= 1) return null;
  function toggle(id) { setEnabled(prev => ({ ...prev, [id]: !prev[id] })); }
  function setAll(val) {
    const next = {};
    for (const p of phases) next[p.id] = val;
    setEnabled(next);
  }
  return (
    <div style={styles.phaseFilterBar}>
      <span style={styles.phaseFilterLabel}>Phases:</span>
      {phases.map((p, idx) => {
        const on = enabled[p.id];
        const c = phaseColor(idx);
        return (
          <button key={p.id} onClick={() => toggle(p.id)}
            style={{
              ...styles.phaseChip,
              ...(on ? { background: c + '22', borderColor: c + '66', color: c } : {}),
            }}>
            {on ? '✓ ' : ''}{p.name}
          </button>
        );
      })}
      <div style={{ flex: 1 }} />
      <button onClick={() => setAll(true)} style={styles.subtleBtn}>All</button>
      <button onClick={() => setAll(false)} style={styles.subtleBtn}>None</button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Timeline view
// ════════════════════════════════════════════════════════════
function TimelineView({ phases, phasesById, phaseIndexById, initiatives, milestones, enabledPhases }) {
  const [monthsAhead, setMonthsAhead] = useState(6);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(start.getFullYear(), start.getMonth() + monthsAhead, 0);
  const totalDays = daysBetween(end, start) + 1;
  const dayWidth = 100 / totalDays;

  function dateOffsetPct(dateStr) {
    if (!dateStr) return null;
    const d = parseDateLocal(dateStr);
    return Math.max(0, daysBetween(d, start) * dayWidth);
  }

  const months = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const monthDays = daysBetween(monthEnd, cursor) + 1;
    months.push({ label: cursor.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), widthPct: monthDays * dayWidth });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  const visiblePhases = phases.filter(p => enabledPhases[p.id]);

  return (
    <div style={styles.timelineWrap}>
      <div style={styles.timelineToolbar}>
        <span style={styles.timelineLabel}>Range:</span>
        {[3, 6, 12, 24].map(n => (
          <button key={n} onClick={() => setMonthsAhead(n)}
            style={{ ...styles.subtleBtn, ...(monthsAhead === n ? { background: 'rgba(99,102,241,0.18)', color: '#a5b4fc' } : {}) }}>
            {n}mo
          </button>
        ))}
      </div>

      <div style={styles.timelineAxis}>
        <div style={styles.timelineRowLabel} />
        <div style={styles.timelineLane}>
          {months.map((m, idx) => (
            <div key={idx} style={{ ...styles.timelineMonth, width: `${m.widthPct}%` }}>{m.label}</div>
          ))}
        </div>
      </div>

      <div style={styles.timelineOverlayWrap}>
        <div style={styles.timelineRowLabel} />
        <div style={{ ...styles.timelineLane, position: 'relative', height: '20px' }}>
          <div style={{ ...styles.timelineToday, left: `${dateOffsetPct(todayStr())}%` }} title="Today" />
          {visiblePhases.map(p => {
            const offset = dateOffsetPct(p.launch_target_date);
            if (offset == null) return null;
            const c = phaseColor(phaseIndexById[p.id]);
            return (
              <div key={p.id} style={{ ...styles.timelineLaunch, left: `${offset}%`, color: c }}
                title={`${p.name} launch: ${formatDate(p.launch_target_date)}`}>🚀</div>
            );
          })}
          {milestones.filter(ms => enabledPhases[ms.phase_id]).map(ms => {
            const offset = dateOffsetPct(ms.target_date);
            if (offset == null) return null;
            return (
              <div key={ms.id} style={{ ...styles.timelineMilestone, left: `${offset}%` }}
                title={`${ms.title} (${phasesById[ms.phase_id]?.name || ''}) — ${formatDate(ms.target_date)}`}>◆</div>
            );
          })}
        </div>
      </div>

      {visiblePhases.length === 0 && <div style={styles.empty}>No phases enabled.</div>}

      {visiblePhases.map(phase => {
        const phaseInits = initiatives.filter(i => i.phase_id === phase.id);
        if (phaseInits.length === 0) return null;
        const c = phaseColor(phaseIndexById[phase.id]);
        return (
          <div key={phase.id}>
            <div style={{ ...styles.timelinePhaseHeader, color: c }}>{phase.name}</div>
            {WORKSTREAMS.map(ws => {
              const wsInits = phaseInits.filter(i => i.workstream === ws.key);
              if (wsInits.length === 0) return null;
              return (
                <div key={ws.key}>
                  <div style={{ ...styles.timelineWsHeader, color: ws.color }}>{ws.label}</div>
                  {wsInits.map(init => {
                    const tag = TAG_MAP[init.tag];
                    const startPct = dateOffsetPct(init.created_at?.substring(0, 10) || todayStr());
                    const endPct = dateOffsetPct(init.target_date) ?? Math.min(100, startPct + 10);
                    const width = Math.max(2, endPct - startPct);
                    return (
                      <div key={init.id} style={styles.timelineRow}>
                        <div style={styles.timelineRowLabel} title={init.title}>{init.title}</div>
                        <div style={styles.timelineLane}>
                          <div style={{
                            ...styles.timelineBar,
                            left: `${startPct}%`, width: `${width}%`,
                            background: tag.bg,
                            border: `1px solid ${tag.color}55`,
                            color: tag.color,
                          }} title={`${init.title} → ${init.target_date ? formatDate(init.target_date) : 'no date'}`}>
                            {init.title}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Calendar view
// ════════════════════════════════════════════════════════════
function CalendarView({ phasesById, phaseIndexById, initiatives, tasks, milestones, enabledPhases }) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;

  function makeKey(d) {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  // initiatives lookup by id (for phase resolution on tasks)
  const initiativesById = Object.fromEntries(initiatives.map(i => [i.id, i]));

  const events = {};
  function pushEvent(date, ev) { if (!date) return; (events[date] = events[date] || []).push(ev); }
  for (const t of tasks) {
    const init = initiativesById[t.initiative_id];
    if (!init || !enabledPhases[init.phase_id]) continue;
    const c = phaseColor(phaseIndexById[init.phase_id]);
    if (t.due_date) pushEvent(t.due_date, { kind: 'task', label: t.title, color: c, done: !!t.completed_at });
  }
  for (const i of initiatives) {
    if (!enabledPhases[i.phase_id]) continue;
    const c = phaseColor(phaseIndexById[i.phase_id]);
    if (i.target_date) pushEvent(i.target_date, { kind: 'initiative', label: i.title, color: c });
  }
  for (const m of milestones) {
    if (!enabledPhases[m.phase_id]) continue;
    if (m.target_date) pushEvent(m.target_date, { kind: 'milestone', label: m.title, color: '#fbbf24' });
  }

  const todayKey = makeKey(new Date());

  return (
    <div style={styles.calendarWrap}>
      <div style={styles.calendarHeader}>
        <button onClick={() => setCursor(new Date(year, month - 1, 1))} style={styles.subtleBtn}>◀</button>
        <div style={styles.calendarMonthLabel}>{cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
        <button onClick={() => setCursor(new Date(year, month + 1, 1))} style={styles.subtleBtn}>▶</button>
        <div style={{ flex: 1 }} />
        <button onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); }}
          style={styles.subtleBtn}>Today</button>
      </div>
      <div style={styles.calendarGrid}>
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} style={styles.calendarDayHeader}>{d}</div>
        ))}
        {Array.from({ length: totalCells }).map((_, idx) => {
          const dayNum = idx - startWeekday + 1;
          if (dayNum < 1 || dayNum > daysInMonth) return <div key={idx} style={styles.calendarCellEmpty} />;
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
                {dayEvents.length > 4 && <div style={styles.calendarMoreEvents}>+{dayEvents.length - 4} more</div>}
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
function MyStuffView({ profile, phasesById, phaseIndexById, initiatives, tasks, tasksByInitiative, enabledPhases, onToggleTask, onEditInit, onEditTask }) {
  const initiativesById = Object.fromEntries(initiatives.map(i => [i.id, i]));

  const myInits = initiatives.filter(i => i.owner_id === profile.id && i.status !== 'done' && enabledPhases[i.phase_id]);
  const myTasks = tasks.filter(t => {
    if (t.owner_id !== profile.id || t.completed_at) return false;
    const init = initiativesById[t.initiative_id];
    return init && enabledPhases[init.phase_id];
  });

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
          const init = initiativesById[task.initiative_id];
          const phase = init ? phasesById[init.phase_id] : null;
          const phaseC = phase ? phaseColor(phaseIndexById[phase.id]) : '#666';
          const dl = formatDeadline(task.due_date);
          const ws = WORKSTREAM_MAP[init?.workstream];
          return (
            <div key={task.id} style={styles.taskRow}>
              <button onClick={() => onToggleTask(task)} style={styles.checkBtn}>
                <span style={styles.checkBox} />
              </button>
              <span style={styles.taskTitle}>{task.title}</span>
              {phase && <span style={{ ...styles.miniTag, color: phaseC, background: phaseC + '22' }}>{phase.name}</span>}
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
          const phase = phasesById[init.phase_id];
          const phaseC = phase ? phaseColor(phaseIndexById[phase.id]) : '#666';
          return (
            <div key={init.id} style={styles.initiativeCard}>
              <div style={styles.initRowHeader}>
                <span style={{ ...styles.statusBadge, color: status.color, background: status.bg }}>{status.label}</span>
                <span style={{ ...styles.tagBadge, color: tag.color, background: tag.bg }}>{tag.label}</span>
                {phase && <span style={{ ...styles.miniTag, color: phaseC, background: phaseC + '22' }}>{phase.name}</span>}
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
  page: { padding: '24px 28px 60px', color: '#e2e8f0', fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif" },
  loading: { color: 'rgba(255,255,255,0.5)', fontSize: '14px', padding: '60px 20px', textAlign: 'center' },

  pageHeader: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: '20px', marginBottom: '14px',
  },
  pageTitle: { margin: 0, fontSize: '24px', fontWeight: 700, color: '#fff', letterSpacing: '-0.4px' },
  pageSubtitle: { margin: '4px 0 0', fontSize: '13px', color: 'rgba(255,255,255,0.45)' },

  tabBar: {
    display: 'flex', gap: '4px', padding: '4px',
    background: 'rgba(255,255,255,0.03)', borderRadius: '10px',
    marginBottom: '12px', alignItems: 'center',
  },
  tabBtn: {
    padding: '8px 14px', border: 'none', borderRadius: '8px', background: 'transparent',
    color: 'rgba(255,255,255,0.55)', fontSize: '13px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s',
  },
  tabBtnActive: { background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' },

  // Phase chip filter
  phaseFilterBar: {
    display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
    padding: '10px 12px', background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px',
    marginBottom: '10px',
  },
  phaseFilterLabel: { fontSize: '11px', color: 'rgba(255,255,255,0.5)', fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase' },
  phaseChip: {
    padding: '5px 10px', background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px',
    color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },

  // Phase card
  phaseList: { display: 'flex', flexDirection: 'column', gap: '12px' },
  phaseCard: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '14px',
    overflow: 'hidden',
  },
  phaseHeaderRow: {
    display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px',
    background: 'rgba(255,255,255,0.025)',
  },
  phaseCaretBtn: {
    background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.55)',
    cursor: 'pointer', padding: '4px 6px', fontSize: '11px', fontFamily: 'inherit',
  },
  phaseColorDot: { width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0 },
  phaseName: { fontSize: '15px', fontWeight: 700, color: '#fff', letterSpacing: '-0.2px' },
  phaseHeaderStat: {
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
    fontSize: '13px', fontWeight: 700, marginLeft: '14px',
  },
  phaseHeaderStatLabel: { fontSize: '10px', fontWeight: 500, color: 'rgba(255,255,255,0.4)' },
  phaseActions: { display: 'flex', gap: '4px', alignItems: 'center' },
  phaseBody: { padding: '8px 18px 18px', display: 'flex', flexDirection: 'column', gap: '8px' },

  // Milestones (per phase)
  milestonesRow: {
    display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', paddingTop: '4px',
  },
  milestonesLabel: {
    fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontWeight: 600,
    letterSpacing: '0.5px', textTransform: 'uppercase', marginRight: '4px',
  },
  milestoneChip: {
    display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px',
    background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)',
    borderRadius: '8px', color: '#fcd34d', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit',
  },
  milestoneTitle: { fontWeight: 600 },
  milestoneDate: { fontSize: '11px', color: 'rgba(252,211,77,0.6)' },
  milestoneAdd: {
    width: '24px', height: '24px', border: '1px dashed rgba(255,255,255,0.2)',
    borderRadius: '6px', background: 'transparent', color: 'rgba(255,255,255,0.45)',
    cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit',
  },
  milestoneForm: {
    display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap',
    padding: '8px 0',
  },

  // Filter bar
  filterBar: {
    display: 'flex', alignItems: 'center', gap: '12px', padding: '4px 0',
  },
  tagPills: { display: 'flex', gap: '4px' },
  tagPill: {
    padding: '5px 10px', background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px',
    color: 'rgba(255,255,255,0.5)', fontSize: '11px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  toggleLabel: {
    display: 'flex', alignItems: 'center', gap: '6px',
    fontSize: '12px', color: 'rgba(255,255,255,0.6)', cursor: 'pointer',
  },

  // Forms
  form: {
    background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.15)',
    borderRadius: '12px', padding: '14px', marginBottom: '14px',
    display: 'flex', flexDirection: 'column', gap: '8px',
  },
  formLabel: {
    fontSize: '12px', fontWeight: 700, color: '#a5b4fc',
    letterSpacing: '0.5px', textTransform: 'uppercase',
  },
  formSubLabel: { fontSize: '11px', color: 'rgba(255,255,255,0.45)', marginTop: '4px', fontWeight: 600 },
  formRow: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' },
  formInlineLabel: { fontSize: '12px', color: 'rgba(255,255,255,0.55)' },
  input: {
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px', padding: '8px 12px', color: '#e2e8f0',
    fontSize: '13px', fontFamily: 'inherit', outline: 'none',
  },
  select: {
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px', padding: '8px 10px', color: '#e2e8f0',
    fontSize: '13px', fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
  },
  miniSelect: {
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px', padding: '3px 6px', color: '#e2e8f0',
    fontSize: '11px', fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
  },
  primaryBtn: {
    padding: '8px 14px', background: 'rgba(99,102,241,0.18)',
    border: '1px solid rgba(99,102,241,0.35)', borderRadius: '8px',
    color: '#a5b4fc', fontSize: '12px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  subtleBtn: {
    padding: '6px 10px', background: 'transparent',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
    color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  dangerBtn: {
    padding: '8px 14px', background: 'rgba(239,68,68,0.12)',
    border: '1px solid rgba(239,68,68,0.35)', borderRadius: '8px',
    color: '#fca5a5', fontSize: '12px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },

  // Modal
  modalOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 200, backdropFilter: 'blur(2px)',
  },
  modal: {
    background: '#1a1a2e', border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: '14px', padding: '20px 24px', minWidth: '420px', maxWidth: '560px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
  },
  modalTitle: {
    fontSize: '15px', fontWeight: 700, color: '#fca5a5',
    textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px',
  },
  modalBody: { fontSize: '13px', color: 'rgba(255,255,255,0.75)', lineHeight: 1.5 },
  modalList: { margin: '8px 0', paddingLeft: '18px', color: 'rgba(255,255,255,0.6)' },
  modalConfirmHint: { marginTop: '14px', fontSize: '12px', color: 'rgba(255,255,255,0.5)' },
  modalConfirmName: {
    margin: '6px 0 8px', fontSize: '13px', fontWeight: 600,
    color: '#e2e8f0', background: 'rgba(255,255,255,0.04)',
    padding: '8px 10px', borderRadius: '6px', wordBreak: 'break-word',
    fontFamily: 'monospace',
  },
  modalActions: {
    display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '14px',
  },

  // Workstream / initiative
  workstreamSection: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '10px', overflow: 'hidden',
  },
  workstreamHeader: {
    display: 'flex', width: '100%', alignItems: 'center', gap: '10px',
    padding: '10px 14px', background: 'rgba(255,255,255,0.02)',
    border: 'none', color: '#e2e8f0', fontSize: '14px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
  },
  workstreamCaret: { fontSize: '10px', color: 'rgba(255,255,255,0.4)', transition: 'transform 0.15s', display: 'inline-block' },
  workstreamDot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },
  workstreamLabel: { flex: 1 },
  workstreamCount: { fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontWeight: 500 },
  workstreamAddBtn: {
    width: '24px', height: '24px', background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
    color: 'rgba(255,255,255,0.6)', fontSize: '14px', cursor: 'pointer', fontFamily: 'inherit',
  },
  workstreamBody: { padding: '4px 10px 10px', display: 'flex', flexDirection: 'column', gap: '4px' },
  empty: { color: 'rgba(255,255,255,0.3)', fontSize: '12px', fontStyle: 'italic', padding: '8px 10px' },
  emptyTasks: { color: 'rgba(255,255,255,0.3)', fontSize: '12px', fontStyle: 'italic', padding: '4px 0' },

  // Initiative
  initiativeCard: {
    background: 'rgba(255,255,255,0.025)',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '8px', padding: '10px 12px',
    transition: 'border-color 0.15s',
  },
  initRowHeader: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  initCaretBtn: {
    background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)',
    cursor: 'pointer', padding: '2px 4px', fontSize: '10px', fontFamily: 'inherit',
  },
  initTitle: { fontSize: '14px', fontWeight: 600, color: '#e2e8f0' },
  priorityHigh: { color: '#ef4444', fontSize: '14px' },
  statusBadge: {
    fontSize: '10px', fontWeight: 700, padding: '2px 8px',
    borderRadius: '4px', textTransform: 'uppercase',
    letterSpacing: '0.5px', flexShrink: 0,
  },
  tagBadge: {
    fontSize: '10px', fontWeight: 700, padding: '2px 8px',
    borderRadius: '4px', textTransform: 'uppercase',
    letterSpacing: '0.5px', flexShrink: 0,
  },
  miniTag: { fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', flexShrink: 0 },
  ownerChip: {
    width: '22px', height: '22px', borderRadius: '50%',
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    color: '#fff', fontSize: '11px', fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  metaPill: {
    fontSize: '11px', color: 'rgba(255,255,255,0.5)',
    background: 'rgba(255,255,255,0.04)', padding: '2px 8px',
    borderRadius: '6px', flexShrink: 0, whiteSpace: 'nowrap',
  },
  taskCounter: {
    fontSize: '11px', color: 'rgba(34,197,94,0.8)', fontWeight: 600,
    background: 'rgba(34,197,94,0.08)', padding: '2px 8px',
    borderRadius: '6px', flexShrink: 0,
  },
  initActions: { display: 'flex', gap: '4px', alignItems: 'center' },
  iconBtn: {
    background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)',
    cursor: 'pointer', padding: '4px 6px', borderRadius: '4px',
    fontSize: '12px', fontFamily: 'inherit',
  },
  barBg: {
    height: '4px', background: 'rgba(255,255,255,0.06)',
    borderRadius: '2px', overflow: 'hidden', marginTop: '8px',
  },
  barFill: { height: '100%', transition: 'width 0.3s' },
  initBody: {
    marginTop: '10px', paddingTop: '10px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    display: 'flex', flexDirection: 'column', gap: '8px',
  },
  initDescription: { fontSize: '13px', color: 'rgba(255,255,255,0.65)', lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  linksRow: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  linkChip: {
    fontSize: '12px', color: '#a5b4fc',
    background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.18)',
    padding: '3px 10px', borderRadius: '6px', textDecoration: 'none',
  },
  tasksHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase', letterSpacing: '0.5px',
  },
  taskRow: { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0' },
  checkBtn: { background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 },
  checkBox: {
    width: '16px', height: '16px', border: '1.5px solid rgba(255,255,255,0.3)',
    borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#22c55e', fontSize: '12px', fontWeight: 700,
  },
  checkBoxDone: { background: 'rgba(34,197,94,0.18)', borderColor: '#22c55e' },
  taskTitle: { fontSize: '13px', color: '#e2e8f0' },
  recurChip: {
    fontSize: '10px', color: '#fbbf24', background: 'rgba(251,191,36,0.08)',
    padding: '1px 6px', borderRadius: '4px',
  },
  contextLabel: { fontSize: '11px', color: 'rgba(255,255,255,0.4)' },
  taskForm: {
    display: 'flex', flexDirection: 'column', gap: '6px',
    background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.15)',
    borderRadius: '8px', padding: '10px', marginTop: '4px',
  },
  completedWrap: { marginTop: '6px' },
  completedToggle: {
    background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.35)',
    fontSize: '11px', cursor: 'pointer', padding: '4px 0', fontFamily: 'inherit',
  },

  // Timeline
  timelineWrap: {
    display: 'flex', flexDirection: 'column', gap: '4px',
    border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px',
    background: 'rgba(255,255,255,0.02)', padding: '14px',
  },
  timelineToolbar: { display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' },
  timelineLabel: { fontSize: '11px', color: 'rgba(255,255,255,0.5)', fontWeight: 600, marginRight: '8px' },
  timelineAxis: { display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '6px' },
  timelineRowLabel: {
    width: '180px', fontSize: '12px', color: 'rgba(255,255,255,0.7)',
    paddingRight: '10px', flexShrink: 0,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  timelineLane: { flex: 1, display: 'flex', position: 'relative', minHeight: '20px' },
  timelineMonth: {
    fontSize: '11px', color: 'rgba(255,255,255,0.45)', fontWeight: 600,
    borderLeft: '1px solid rgba(255,255,255,0.06)', paddingLeft: '4px',
  },
  timelineOverlayWrap: { display: 'flex', height: '24px', position: 'relative' },
  timelineToday: {
    position: 'absolute', top: '-4px', bottom: 0, width: '2px',
    background: '#ef4444', zIndex: 2,
  },
  timelineLaunch: { position: 'absolute', top: 0, fontSize: '12px', transform: 'translateX(-50%)', zIndex: 3 },
  timelineMilestone: {
    position: 'absolute', top: 4, color: '#fbbf24',
    fontSize: '10px', transform: 'translateX(-50%)', zIndex: 3,
  },
  timelinePhaseHeader: {
    fontSize: '12px', fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.5px',
    padding: '12px 0 4px', borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: '6px',
  },
  timelineWsHeader: {
    fontSize: '11px', fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.5px',
    padding: '6px 0 2px', paddingLeft: '12px',
  },
  timelineRow: { display: 'flex', alignItems: 'center', height: '28px' },
  timelineBar: {
    position: 'absolute', height: '20px', borderRadius: '4px',
    fontSize: '10px', fontWeight: 600, padding: '0 6px',
    overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
    display: 'flex', alignItems: 'center',
  },

  // Calendar
  calendarWrap: {
    border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px',
    background: 'rgba(255,255,255,0.02)', padding: '14px',
  },
  calendarHeader: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' },
  calendarMonthLabel: { fontSize: '15px', fontWeight: 700, color: '#e2e8f0' },
  calendarGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' },
  calendarDayHeader: {
    fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase', letterSpacing: '0.5px',
    textAlign: 'center', padding: '4px 0',
  },
  calendarCell: {
    minHeight: '90px', background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.05)', borderRadius: '6px',
    padding: '4px', display: 'flex', flexDirection: 'column', gap: '2px',
  },
  calendarCellEmpty: { minHeight: '90px' },
  calendarCellToday: {
    background: 'rgba(99,102,241,0.06)',
    border: '1px solid rgba(99,102,241,0.25)',
  },
  calendarCellNum: { fontSize: '11px', color: 'rgba(255,255,255,0.5)', fontWeight: 600 },
  calendarCellEvents: { display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, overflow: 'hidden' },
  calendarEvent: {
    fontSize: '10px', padding: '1px 4px', borderRadius: '3px',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
  calendarMoreEvents: { fontSize: '10px', color: 'rgba(255,255,255,0.4)', padding: '0 4px' },

  // My stuff
  mineWrap: { display: 'flex', flexDirection: 'column', gap: '20px' },
  mineSection: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px', padding: '14px',
  },
  mineHeader: {
    margin: '0 0 10px', fontSize: '13px', fontWeight: 700,
    color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '0.5px',
  },
};
