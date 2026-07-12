import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import usePersistedTab from '../hooks/usePersistedTab';
import { fetchAllRows } from './analytics/utils';
import backdropDismiss from '../lib/backdropDismiss';

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

const PLATFORM_META = {
  youtube:   { label: 'YouTube',   color: '#FF0000' },
  facebook:  { label: 'Facebook',  color: '#1877F2' },
  instagram: { label: 'Instagram', color: '#E4405F' },
  tiktok:    { label: 'TikTok',    color: '#00F2EA' },
  substack:  { label: 'Substack',  color: '#FF6719' },
  twitch:    { label: 'Twitch',    color: '#9146FF' },
  stripe:    { label: 'Stripe',    color: '#635BFF' },
  fourthwall:{ label: 'Fourthwall',color: '#E8451C' },
};

const METRIC_OPTIONS = [
  { key: 'views',              label: 'Views' },
  { key: 'likes',              label: 'Likes' },
  { key: 'comments',           label: 'Comments' },
  { key: 'shares',             label: 'Shares' },
  { key: 'watch_time_seconds', label: 'Watch Time (hrs)' },
];

function getDateRangeForCategory(category) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  if (category === 'quarterly') {
    const qStart = new Date(year, Math.floor(month / 3) * 3, 1);
    return { start: qStart.toISOString().split('T')[0], end: now.toISOString().split('T')[0] };
  }
  if (category === 'none') {
    return { start: '2020-01-01', end: now.toISOString().split('T')[0] };
  }
  return { start: `${year}-01-01`, end: now.toISOString().split('T')[0] };
}

function formatMetricValue(key, value) {
  if (key === 'watch_time_seconds') return Math.round(value / 3600).toLocaleString() + 'h';
  return Math.round(value).toLocaleString();
}

function formatTargetForMetric(key, value) {
  if (key === 'watch_time_seconds') return value * 3600;
  return value;
}

const PRIORITY_COLORS = {
  10: '#ef4444', 9: '#f97316', 8: '#fb923c',
  6: '#fbbf24', 5: '#eab308', 4: '#a3e635',
  3: '#4ade80', 2: '#22c55e', 1: '#15803d',
};
const PRIORITY_OPTIONS = [10, 9, 8, 6, 5, 4, 3, 2, 1];

function sortByPriority(items, completedKey = 'checked') {
  return [...items].sort((a, b) => {
    const ac = a[completedKey] ? 1 : 0;
    const bc = b[completedKey] ? 1 : 0;
    if (ac !== bc) return ac - bc;
    const ap = a.priority ?? 0;
    const bp = b.priority ?? 0;
    if (ap !== bp) return bp - ap;
    return (a.position ?? 0) - (b.position ?? 0);
  });
}

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

function progressColor(pct) {
  const r = Math.round(0x86 + (0x16 - 0x86) * pct);
  const g = Math.round(0xef + (0xa3 - 0xef) * pct);
  const b = Math.round(0xac + (0x4a - 0xac) * pct);
  return `rgb(${r},${g},${b})`;
}

function formatTimeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

// ════════════════════════════════════════════════════════════
// Empty form templates
// ════════════════════════════════════════════════════════════
const EMPTY_PHASE = { name: '', launch_target_date: '', assigned_partners: [] };
const EMPTY_INITIATIVE = {
  workstream: 'facility', title: '', description: '', status: 'planned',
  tag: 'shared', owner_id: null, target_date: '', budget_dollars: '',
  priority: 'med', phase_id: null,
};
const EMPTY_TASK = { title: '', notes: '', tag: '', owner_id: null, due_date: '', recurrence_interval: '', recurrence_count: 1 };
const EMPTY_MILESTONE = { title: '', target_date: '' };
const EMPTY_BD_GOAL = { title: '', description: '', current_value: '', target_value: '', category: 'quarterly', goal_type: 'manual', metrics: [], platform_account_ids: [] };
const EMPTY_BD_MONTHLY = { title: '', target_value: '' };

// ════════════════════════════════════════════════════════════
// Main page
// ════════════════════════════════════════════════════════════
export default function BusinessDev() {
  const { profile, isAdmin, isPartner } = useAuth();
  const confirm = useConfirm();

  // Data
  const [phases, setPhases] = useState([]);
  const [initiatives, setInitiatives] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [links, setLinks] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);

  // View
  const [view, setView] = usePersistedTab('business-dev-view', 'phases', ['phases', 'timeline', 'calendar', 'mine']); // phases | timeline | calendar | mine

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

  // BD Goals state
  const [bdGoalsExpanded, setBdGoalsExpanded] = useState(true);
  const [bdGoals, setBdGoals] = useState([]);
  const [bdMonthlyGoals, setBdMonthlyGoals] = useState([]);
  // BD Notes (per-user, behaves like Dashboard To Do)
  const [bdNotes, setBdNotes] = useState([]);
  const [bdNoteInputOpen, setBdNoteInputOpen] = useState(false);
  const [bdNoteDraft, setBdNoteDraft] = useState('');
  const [bdNoteEditingId, setBdNoteEditingId] = useState(null);
  const [bdNoteEditingText, setBdNoteEditingText] = useState('');
  const [bdNotePriority, setBdNotePriority] = useState(null);
  const [bdNoteEditPriority, setBdNoteEditPriority] = useState(null);
  const [expandedYearlyBdGoals, setExpandedYearlyBdGoals] = useState({});
  const [showBdGoalForm, setShowBdGoalForm] = useState(false);
  const [editingBdGoalId, setEditingBdGoalId] = useState(null);
  const [bdGoalForm, setBdGoalForm] = useState(EMPTY_BD_GOAL);
  const [showBdMonthlyForm, setShowBdMonthlyForm] = useState(null); // parent goal id
  const [editingBdMonthlyId, setEditingBdMonthlyId] = useState(null);
  const [bdMonthlyForm, setBdMonthlyForm] = useState(EMPTY_BD_MONTHLY);
  const [bdAccounts, setBdAccounts] = useState([]);
  const [bdRollupData, setBdRollupData] = useState({});

  // ─────────────────────────────────────────────
  // Fetch all
  // ─────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [phRes, initRes, taskRes, linkRes, msRes, adminRes, partnerRes] = await Promise.all([
        supabase.from('bd_phases').select('*').is('archived_at', null).order('position'),
        fetchAllRows(supabase.from('bd_initiatives').select('*').order('position')),
        fetchAllRows(supabase.from('bd_tasks').select('*').order('position')),
        supabase.from('bd_initiative_links').select('*').order('position'),
        supabase.from('bd_milestones').select('*').is('retired_at', null).order('target_date'),
        supabase.from('profiles').select('id, full_name, role').in('role', ['admin', 'partner']).order('full_name'),
        supabase.from('profiles').select('id, full_name').eq('role', 'partner').order('full_name'),
      ]);
      const phs = phRes.data || [];
      setPartners(partnerRes.data || []);
      setPhases(phs);
      setInitiatives(initRes || []);
      setTasks(taskRes || []);
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
    if (!profile?.id || (!isAdmin && !isPartner)) return;
    fetchAll();
  }, [profile?.id, isAdmin, isPartner, fetchAll]);
  useVisibilityRefresh(fetchAll);

  // ─────────────────────────────────────────────
  // BD Goals fetch & CRUD
  // ─────────────────────────────────────────────
  const fetchBdRollupData = useCallback(async (metricGoals) => {
    if (!metricGoals.length) { setBdRollupData({}); return; }
    const hasNone = metricGoals.some(g => g.category === 'none');
    const hasYearly = metricGoals.some(g => g.category === 'yearly');
    const noneRange = getDateRangeForCategory('none');
    const yearRange = getDateRangeForCategory('yearly');
    const quarterRange = getDateRangeForCategory('quarterly');
    const start = hasNone ? noneRange.start : hasYearly ? yearRange.start : quarterRange.start;
    const end = yearRange.end;
    const allAccountIds = [...new Set(metricGoals.flatMap(g => g.platform_account_ids || []))];
    if (!allAccountIds.length) { setBdRollupData({}); return; }
    const rollups = await fetchAllRows(supabase
      .from('platform_daily_metrics')
      .select('*')
      .gte('date', start)
      .lte('date', end)
      .in('platform_account_id', allAccountIds)
      .order('date', { ascending: false }));
    if (!rollups) { setBdRollupData({}); return; }
    const result = {};
    for (const goal of metricGoals) {
      const range = getDateRangeForCategory(goal.category);
      const goalAccountIds = goal.platform_account_ids || [];
      const goalMetrics = goal.metrics || [];
      const filtered = rollups.filter(r =>
        goalAccountIds.includes(r.platform_account_id) &&
        r.date >= range.start && r.date <= range.end
      );
      const sums = {};
      for (const m of goalMetrics) {
        sums[m] = filtered.reduce((acc, r) => acc + (Number(r[m]) || 0), 0);
      }
      result[goal.id] = sums;
    }
    setBdRollupData(result);
  }, []);

  const fetchBdGoals = useCallback(async () => {
    if (!profile?.id) return;
    const [gRes, mRes, acctRes] = await Promise.all([
      supabase.from('goals').select('*').eq('scope', 'bd').eq('created_by', profile.id)
        .order('position', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase.from('monthly_goals').select('*').eq('scope', 'bd').order('created_at'),
      supabase.from('platform_accounts').select('*').eq('is_active', true).order('platform'),
    ]);
    const goals = gRes.data || [];
    setBdGoals(goals);
    setBdMonthlyGoals(mRes.data || []);
    setBdAccounts(acctRes.data || []);
    const metricGoals = goals.filter(g => g.goal_type === 'metric');
    fetchBdRollupData(metricGoals);
  }, [profile?.id, fetchBdRollupData]);

  useEffect(() => {
    if (!profile?.id || !isAdmin) return;
    fetchBdGoals();
  }, [profile?.id, isAdmin, fetchBdGoals]);

  function openCreateBdGoal() {
    setEditingBdGoalId(null);
    setBdGoalForm(EMPTY_BD_GOAL);
    setShowBdGoalForm(true);
  }
  function openEditBdGoal(goal) {
    setEditingBdGoalId(goal.id);
    const gt = goal.goal_type || 'manual';
    const tv = gt === 'metric' && goal.metrics?.length === 1 && goal.metrics[0] === 'watch_time_seconds'
      ? String(Math.round((goal.target_value || 0) / 3600))
      : String(goal.target_value || 0);
    setBdGoalForm({
      title: goal.title,
      description: goal.description || '',
      current_value: String(goal.current_value || 0),
      target_value: tv,
      category: goal.category,
      goal_type: gt,
      metrics: goal.metrics || [],
      platform_account_ids: goal.platform_account_ids || [],
    });
    setShowBdGoalForm(true);
  }
  function cancelBdGoalForm() {
    setShowBdGoalForm(false);
    setEditingBdGoalId(null);
    setBdGoalForm(EMPTY_BD_GOAL);
  }
  async function handleBdGoalSubmit(e) {
    e.preventDefault();
    const title = bdGoalForm.title.trim();
    if (!title) return;
    const goalType = bdGoalForm.goal_type || 'manual';
    let current_value, target_value, metrics, platform_account_ids;
    if (goalType === 'metric') {
      if (!(bdGoalForm.metrics || []).length) { alert('Select at least one metric'); return; }
      if (!(bdGoalForm.platform_account_ids || []).length) { alert('Select at least one platform'); return; }
      current_value = 0;
      metrics = bdGoalForm.metrics;
      platform_account_ids = bdGoalForm.platform_account_ids;
      const rawTarget = parseInt(bdGoalForm.target_value) || 1;
      target_value = metrics.length === 1 ? formatTargetForMetric(metrics[0], rawTarget) : rawTarget;
    } else if (goalType === 'checkbox') {
      current_value = 0;
      target_value = 1;
      metrics = [];
      platform_account_ids = [];
    } else {
      current_value = parseInt(bdGoalForm.current_value) || 0;
      target_value = parseInt(bdGoalForm.target_value) || 1;
      metrics = [];
      platform_account_ids = [];
    }
    const payload = { title, description: bdGoalForm.description?.trim() || null, current_value, target_value, category: bdGoalForm.category, goal_type: goalType, metrics, platform_account_ids, scope: 'bd' };
    if (editingBdGoalId) {
      const { error } = await supabase.from('goals').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editingBdGoalId);
      if (error) { alert(error.message); return; }
    } else {
      const nextPosition = bdGoals.length > 0 ? Math.max(...bdGoals.map(g => g.position || 0)) + 1 : 0;
      const { error } = await supabase.from('goals').insert({ ...payload, created_by: profile.id, position: nextPosition });
      if (error) { alert(error.message); return; }
    }
    cancelBdGoalForm();
    fetchBdGoals();
  }

  async function handleBdGoalsDragEnd(category, result) {
    if (!result.destination) return;
    const group = bdGoals.filter(g => g.category === category);
    const reordered = Array.from(group);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    // Re-base positions for this category using a contiguous block starting at the
    // smallest existing position in the group (or 0 if none set yet).
    const baseRaw = Math.min(...group.map(g => (g.position != null ? g.position : Number.POSITIVE_INFINITY)));
    const base = Number.isFinite(baseRaw) ? baseRaw : 0;
    const reindexed = reordered.map((g, idx) => ({ ...g, position: base + idx }));
    // Optimistic state update: replace just this category's goals.
    setBdGoals(prev => {
      const others = prev.filter(g => g.category !== category);
      const merged = [...others, ...reindexed];
      // Preserve overall order by position-then-created
      return merged.sort((a, b) => {
        const pa = a.position == null ? Number.POSITIVE_INFINITY : a.position;
        const pb = b.position == null ? Number.POSITIVE_INFINITY : b.position;
        if (pa !== pb) return pa - pb;
        return new Date(b.created_at) - new Date(a.created_at);
      });
    });
    const updates = reindexed.map(g =>
      supabase.from('goals').update({ position: g.position }).eq('id', g.id)
    );
    const results = await Promise.all(updates);
    const firstError = results.find(r => r.error)?.error;
    if (firstError) {
      console.error('Error reordering goals:', firstError);
      fetchBdGoals();
    }
  }
  async function handleDeleteBdGoal(id) {
    if (!(await confirm('Delete this goal?'))) return;
    await supabase.from('goals').delete().eq('id', id);
    fetchBdGoals();
  }
  async function handleToggleBdGoalCheckbox(goal) {
    const done = (goal.current_value || 0) >= 1;
    const now = new Date().toISOString();
    await supabase.from('goals').update({
      current_value: done ? 0 : 1,
      completed_at: done ? null : now,
      updated_at: now,
    }).eq('id', goal.id);
    fetchBdGoals();
  }

  function openCreateBdMonthly(parentGoalId) {
    setEditingBdMonthlyId(null);
    setBdMonthlyForm(EMPTY_BD_MONTHLY);
    setShowBdMonthlyForm(parentGoalId);
  }
  function openEditBdMonthly(mg) {
    setEditingBdMonthlyId(mg.id);
    setBdMonthlyForm({ title: mg.title, target_value: String(mg.target_value || 0) });
    setShowBdMonthlyForm(mg.parent_goal_id);
  }
  function cancelBdMonthlyForm() {
    setShowBdMonthlyForm(null);
    setEditingBdMonthlyId(null);
    setBdMonthlyForm(EMPTY_BD_MONTHLY);
  }
  async function handleBdMonthlySubmit(e) {
    e.preventDefault();
    const title = bdMonthlyForm.title.trim();
    if (!title) return;
    const target_value = parseInt(bdMonthlyForm.target_value) || 1;
    if (editingBdMonthlyId) {
      const { error } = await supabase.from('monthly_goals').update({ title, target_value, updated_at: new Date().toISOString() }).eq('id', editingBdMonthlyId);
      if (error) { alert(error.message); return; }
    } else {
      const { error } = await supabase.from('monthly_goals').insert({ title, target_value, parent_goal_id: showBdMonthlyForm, scope: 'bd', created_by: profile.id });
      if (error) { alert(error.message); return; }
    }
    cancelBdMonthlyForm();
    fetchBdGoals();
  }
  async function handleDeleteBdMonthly(id) {
    if (!(await confirm('Delete this monthly goal?'))) return;
    await supabase.from('monthly_goals').delete().eq('id', id);
    fetchBdGoals();
  }

  // ── BD Notes (per-user, mirrors Dashboard To Do) ──
  const fetchBdNotes = useCallback(async () => {
    if (!profile?.id) return;
    await supabase.from('bd_user_notes').delete().eq('user_id', profile.id).eq('checked', true);
    const { data, error } = await supabase
      .from('bd_user_notes')
      .select('*')
      .eq('user_id', profile.id)
      .order('position', { ascending: true });
    if (error) { console.error('Error loading bd notes:', error); return; }
    setBdNotes(sortByPriority(data || []));
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id || !isAdmin) return;
    fetchBdNotes();
  }, [profile?.id, isAdmin, fetchBdNotes]);

  async function addBdNote() {
    const text = bdNoteDraft.trim();
    if (!text || !profile?.id || bdNotePriority === null) return;
    const nextPosition = bdNotes.length > 0 ? Math.max(...bdNotes.map(n => n.position || 0)) + 1 : 0;
    const { data, error } = await supabase
      .from('bd_user_notes')
      .insert({ user_id: profile.id, text, checked: false, position: nextPosition, priority: bdNotePriority })
      .select()
      .single();
    if (error) { alert(`Could not save note: ${error.message || 'unknown error'}`); return; }
    setBdNotes(prev => sortByPriority([...prev, data]));
    setBdNoteDraft('');
    setBdNotePriority(null);
    setBdNoteInputOpen(false);
  }

  async function toggleBdNote(id) {
    const current = bdNotes.find(n => n.id === id);
    if (!current) return;
    const nextChecked = !current.checked;
    setBdNotes(prev => sortByPriority(prev.map(n => n.id === id ? { ...n, checked: nextChecked } : n)));
    const { error } = await supabase
      .from('bd_user_notes')
      .update({ checked: nextChecked, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      console.error('Error toggling note:', error);
      setBdNotes(prev => sortByPriority(prev.map(n => n.id === id ? { ...n, checked: current.checked } : n)));
    }
  }

  async function deleteBdNote(id) {
    const previous = bdNotes;
    setBdNotes(prev => prev.filter(n => n.id !== id));
    const { error } = await supabase.from('bd_user_notes').delete().eq('id', id);
    if (error) { console.error('Error deleting note:', error); setBdNotes(previous); }
  }

  async function saveBdNoteEdit(id) {
    const trimmed = bdNoteEditingText.trim();
    const newPriority = bdNoteEditPriority;
    setBdNoteEditingId(null);
    setBdNoteEditingText('');
    setBdNoteEditPriority(null);
    if (!trimmed) return;
    const current = bdNotes.find(n => n.id === id);
    if (!current) return;
    const updates = { updated_at: new Date().toISOString() };
    if (current.text !== trimmed) updates.text = trimmed;
    if (newPriority !== null && current.priority !== newPriority) updates.priority = newPriority;
    if (Object.keys(updates).length === 1) return; // only updated_at
    setBdNotes(prev => sortByPriority(prev.map(n => n.id === id ? { ...n, text: trimmed, ...(newPriority !== null ? { priority: newPriority } : {}) } : n)));
    const { error } = await supabase
      .from('bd_user_notes')
      .update(updates)
      .eq('id', id);
    if (error) {
      console.error('Error saving note edit:', error);
      setBdNotes(prev => sortByPriority(prev.map(n => n.id === id ? { ...n, text: current.text, priority: current.priority } : n)));
    }
  }


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
    setPhaseForm({ name: phase.name, launch_target_date: phase.launch_target_date || '', assigned_partners: phase.assigned_partners || [] });
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
    const payload = { name, launch_target_date: phaseForm.launch_target_date || null, assigned_partners: phaseForm.assigned_partners || [] };
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
    // Cascade deletes bd_initiatives + bd_tasks, but not the personal_tasks
    // mirrors keyed on bd_task_id — remove those for every task under the phase.
    const initIds = new Set(initiatives.filter(i => i.phase_id === deletingPhase.id).map(i => i.id));
    const taskIds = tasks.filter(t => initIds.has(t.initiative_id)).map(t => t.id);
    if (taskIds.length) await supabase.from('personal_tasks').delete().in('bd_task_id', taskIds);
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
    const original = editingInitId ? initiatives.find(i => i.id === editingInitId) : null;
    // Only stamp completed_at on the transition into 'done'. Re-stamping on every
    // save of an already-done initiative reset the 24h auto-archive timer and
    // clobbered the real completion time.
    const completed_at = status === 'done'
      ? ((original?.status === 'done' && original.completed_at) ? original.completed_at : new Date().toISOString())
      : null;
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
      // Moved to a different phase or workstream → place at the end of the new
      // group so its old position can't collide with destination siblings.
      if (original && (original.phase_id !== payload.phase_id || original.workstream !== payload.workstream)) {
        const dstSiblings = (initiativesByPhase[payload.phase_id] || [])
          .filter(i => i.workstream === payload.workstream && i.id !== editingInitId);
        payload.position = Math.max(0, ...dstSiblings.map(i => i.position || 0)) + 1;
      }
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
    if (!(await confirm('Delete this initiative and all its tasks?'))) return;
    // bd_tasks cascade in the DB, but the personal_tasks mirror keyed on
    // bd_task_id does not — drop those mirrors first so they don't orphan in
    // owners' backlogs.
    const taskIds = tasks.filter(t => t.initiative_id === id).map(t => t.id);
    if (taskIds.length) await supabase.from('personal_tasks').delete().in('bd_task_id', taskIds);
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
  // Drag-and-drop reorder
  // ─────────────────────────────────────────────
  async function handleReorderInitiative(draggedId, targetId, phaseId, workstream) {
    const siblings = initiatives
      .filter(i => i.phase_id === phaseId && i.workstream === workstream)
      .sort((a, b) => (a.position || 0) - (b.position || 0));
    const ordered = siblings.map(i => i.id);
    const fromIdx = ordered.indexOf(draggedId);
    if (fromIdx === -1) return;
    ordered.splice(fromIdx, 1);
    const toIdx = ordered.indexOf(targetId);
    if (toIdx === -1) return;
    ordered.splice(toIdx, 0, draggedId);
    await Promise.all(ordered.map((id, i) =>
      supabase.from('bd_initiatives').update({ position: i }).eq('id', id)
    ));
    fetchAll();
  }

  async function handleReorderTask(draggedId, targetId, sourceInitId, destInitId) {
    // Move task to a different initiative if needed
    if (sourceInitId !== destInitId) {
      await supabase.from('bd_tasks').update({ initiative_id: destInitId }).eq('id', draggedId);
    }
    // Reorder within the destination initiative
    const destTasks = tasks
      .filter(t => t.initiative_id === destInitId && t.id !== draggedId)
      .sort((a, b) => (a.position || 0) - (b.position || 0));
    const ordered = destTasks.map(t => t.id);
    if (targetId) {
      const toIdx = ordered.indexOf(targetId);
      if (toIdx !== -1) ordered.splice(toIdx, 0, draggedId);
      else ordered.push(draggedId);
    } else {
      ordered.push(draggedId);
    }
    await Promise.all(ordered.map((id, i) =>
      supabase.from('bd_tasks').update({ position: i }).eq('id', id)
    ));
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
  // The task form is rendered inline inside the Phases view (inside its
  // initiative card). When edit is clicked from My Stuff (or any non-phases
  // view), we need to switch views and make sure the parent phase + workstream
  // are expanded so the form is actually visible.
  function openEditTaskFromAnywhere(task) {
    const init = initiatives.find(i => i.id === task.initiative_id);
    if (init?.phase_id) {
      setExpandedPhases(prev => ({ ...prev, [init.phase_id]: true }));
      // Clear filters on the parent phase so the initiative is guaranteed visible.
      setTagFilters(prev => ({ ...prev, [init.phase_id]: 'all' }));
      setHideDones(prev => ({ ...prev, [init.phase_id]: false }));
      if (init.workstream) {
        const wsKey = `${init.phase_id}::${init.workstream}`;
        setCollapsedWorkstreams(prev => ({ ...prev, [wsKey]: false }));
      }
    }
    if (init) setExpandedInitiatives(prev => ({ ...prev, [init.id]: true }));
    if (view !== 'phases') setView('phases');
    openEditTask(task);
  }
  function cancelTaskForm() {
    setTaskFormFor(null);
    setEditingTaskId(null);
    setTaskForm(EMPTY_TASK);
  }
  // Mirror a bd_task into the owner's personal_tasks backlog (idempotent).
  // Pass the bd_task object you just wrote (with its id). Handles insert,
  // owner change, field updates, owner removal, and completion.
  async function syncTaskToBacklog(bdTask) {
    try {
      const parentInit = initiatives.find(i => i.id === bdTask.initiative_id);
      const initiativeTitle = parentInit?.title || 'BD Task';
      const content = `${bdTask.title} | ${initiativeTitle}`;
      const tag = bdTask.tag || parentInit?.tag || 'shared';
      const tagInfo = TAG_MAP[tag] || TAG_MAP.shared;

      const { data: existing } = await supabase
        .from('personal_tasks')
        .select('id, created_by')
        .eq('bd_task_id', bdTask.id)
        .maybeSingle();

      // No owner or task is done -> remove from backlog
      if (!bdTask.owner_id || bdTask.completed_at) {
        if (existing) await supabase.from('personal_tasks').delete().eq('id', existing.id);
        return;
      }

      // Owner unchanged -> just update fields
      if (existing && existing.created_by === bdTask.owner_id) {
        await supabase.from('personal_tasks').update({
          content, bucket: tag, due_date: bdTask.due_date,
        }).eq('id', existing.id);
        return;
      }

      // Owner changed -> drop old row first
      if (existing) {
        await supabase.from('personal_tasks').delete().eq('id', existing.id);
      }

      // Ensure the bucket option exists for the new owner
      await supabase.from('user_task_options').upsert(
        { user_id: bdTask.owner_id, kind: 'bucket', value: tag, label: tagInfo.label, color: tagInfo.color },
        { onConflict: 'user_id,kind,value' }
      );

      await supabase.from('personal_tasks').insert({
        created_by: bdTask.owner_id,
        content,
        status: 'backlog',
        category: 'business_development',
        bucket: tag,
        due_date: bdTask.due_date,
        position: 0,
        bd_task_id: bdTask.id,
      });
    } catch (err) {
      console.error('syncTaskToBacklog failed:', err);
    }
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

    let savedTask;
    if (editingTaskId) {
      const { data, error } = await supabase.from('bd_tasks').update(payload).eq('id', editingTaskId).select().single();
      if (error) { alert(error.message); return; }
      savedTask = data;
    } else {
      const siblings = (tasksByInitiative[initiativeId] || []);
      const maxPos = Math.max(0, ...siblings.map(t => t.position || 0));
      const { data, error } = await supabase.from('bd_tasks')
        .insert({ ...payload, position: maxPos + 1, created_by: profile.id })
        .select()
        .single();
      if (error) { alert(error.message); return; }
      savedTask = data;
    }
    await syncTaskToBacklog(savedTask);
    cancelTaskForm();
    fetchAll();
  }

  async function handleToggleTask(task) {
    const completed_at = task.completed_at ? null : new Date().toISOString();
    const { data, error } = await supabase.from('bd_tasks').update({ completed_at }).eq('id', task.id).select().single();
    if (error) { alert(`Could not update task: ${error.message}`); return; }
    if (data) await syncTaskToBacklog(data);
    fetchAll();
  }
  async function handleDeleteTask(id) {
    if (!(await confirm('Delete this task?'))) return;
    // Drop the personal_tasks mirror first (RLS-permitting; ignore failures
    // since RLS may scope to the row owner only — the bd_task delete is what
    // the user actually cares about).
    await supabase.from('personal_tasks').delete().eq('bd_task_id', id);
    const { error } = await supabase.from('bd_tasks').delete().eq('id', id);
    if (error) {
      alert(`Could not delete task: ${error.message}`);
      return;
    }
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
    if (!(await confirm('Retire this milestone?'))) return;
    await supabase.from('bd_milestones').update({ retired_at: new Date().toISOString() }).eq('id', id);
    fetchAll();
  }

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  if (!isAdmin && !isPartner) return <div style={styles.page}><div style={styles.loading}>Access restricted.</div></div>;
  if (loading)  return <div style={styles.page}><div style={styles.loading}>Loading Roadmap...</div></div>;

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <div>
          <h1 style={styles.pageTitle}>Roadmap</h1>
          <p style={styles.pageSubtitle}>Multi-phase program tracker</p>
        </div>
        {isAdmin && <button onClick={openCreatePhase} style={styles.primaryBtn}>+ Phase</button>}
      </div>

      {/* Goals + Notes row (admin only) */}
      {isAdmin && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginBottom: '16px', alignItems: 'flex-start' }}>
          <BdGoalsSection
            goals={bdGoals}
            monthlyGoals={bdMonthlyGoals}
            expanded={bdGoalsExpanded}
            onToggleExpand={() => setBdGoalsExpanded(prev => !prev)}
            expandedYearly={expandedYearlyBdGoals}
            setExpandedYearly={setExpandedYearlyBdGoals}
            onCreateGoal={openCreateBdGoal}
            onEditGoal={openEditBdGoal}
            onDeleteGoal={handleDeleteBdGoal}
            onToggleCheckbox={handleToggleBdGoalCheckbox}
            onCreateMonthly={openCreateBdMonthly}
            onEditMonthly={openEditBdMonthly}
            onDeleteMonthly={handleDeleteBdMonthly}
            monthlyFormFor={showBdMonthlyForm}
            editingMonthlyId={editingBdMonthlyId}
            monthlyForm={bdMonthlyForm}
            setMonthlyForm={setBdMonthlyForm}
            onMonthlySubmit={handleBdMonthlySubmit}
            onCancelMonthlyForm={cancelBdMonthlyForm}
            accounts={bdAccounts}
            rollupData={bdRollupData}
            onDragEnd={handleBdGoalsDragEnd}
          />
          <BdNotesSection
            notes={bdNotes}
            inputOpen={bdNoteInputOpen}
            setInputOpen={setBdNoteInputOpen}
            draft={bdNoteDraft}
            setDraft={setBdNoteDraft}
            editingId={bdNoteEditingId}
            setEditingId={setBdNoteEditingId}
            editingText={bdNoteEditingText}
            setEditingText={setBdNoteEditingText}
            priority={bdNotePriority}
            setPriority={setBdNotePriority}
            editPriority={bdNoteEditPriority}
            setEditPriority={setBdNoteEditPriority}
            onAdd={addBdNote}
            onToggle={toggleBdNote}
            onDelete={deleteBdNote}
            onSaveEdit={saveBdNoteEdit}
          />
        </div>
      )}

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
      {isAdmin && showPhaseForm && (
        <PhaseForm
          form={phaseForm}
          setForm={setPhaseForm}
          editing={!!editingPhaseId}
          onSubmit={handlePhaseSubmit}
          onCancel={cancelPhaseForm}
          partners={partners}
        />
      )}

      {/* Initiative form (always rendered when active; phase selector lets you move it) */}
      {isAdmin && showInitForm && (
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

      {/* BD Goals section was here; now rendered above the tab bar */}

      {/* BD Goal modal form */}
      {showBdGoalForm && (
        <BdGoalFormModal
          form={bdGoalForm}
          setForm={setBdGoalForm}
          editing={!!editingBdGoalId}
          onSubmit={handleBdGoalSubmit}
          onCancel={cancelBdGoalForm}
          accounts={bdAccounts}
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
                isAdmin={isAdmin}
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
                onReorderInit={handleReorderInitiative}
                onReorderTask={handleReorderTask}
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
          isAdmin={isAdmin}
          onToggleTask={handleToggleTask}
          onEditInit={openEditInit}
          onEditTask={openEditTaskFromAnywhere}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// BD Goals Section
// ════════════════════════════════════════════════════════════
function BdGoalsSection({
  goals, monthlyGoals, expanded, onToggleExpand,
  expandedYearly, setExpandedYearly,
  onCreateGoal, onEditGoal, onDeleteGoal, onToggleCheckbox,
  onCreateMonthly, onEditMonthly, onDeleteMonthly,
  monthlyFormFor, editingMonthlyId, monthlyForm, setMonthlyForm,
  onMonthlySubmit, onCancelMonthlyForm,
  accounts, rollupData, onDragEnd,
}) {
  const quarterly = goals.filter(g => g.category === 'quarterly');
  const yearly = goals.filter(g => g.category === 'yearly');
  const uncategorized = goals.filter(g => g.category === 'none');
  const monthlyByParent = {};
  for (const mg of monthlyGoals) {
    if (mg.parent_goal_id) (monthlyByParent[mg.parent_goal_id] = monthlyByParent[mg.parent_goal_id] || []).push(mg);
  }

  function renderGroup(category, items, label) {
    if (items.length === 0) return null;
    return (
      <div>
        <div style={styles.bdGoalsGroupLabel}>{label}</div>
        <DragDropContext onDragEnd={r => onDragEnd && onDragEnd(category, r)}>
          <Droppable droppableId={`bd-goals-${category}`}>
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {items.map((g, idx) => (
                  <Draggable key={g.id} draggableId={g.id} index={idx}>
                    {(p, snapshot) => (
                      <div
                        ref={p.innerRef}
                        {...p.draggableProps}
                        style={{
                          ...(snapshot.isDragging ? { boxShadow: '0 4px 16px rgba(0,0,0,0.3)', opacity: 0.95 } : {}),
                          ...p.draggableProps.style,
                        }}
                      >
                        {category === 'yearly' ? (
                          (() => {
                            const children = monthlyByParent[g.id] || [];
                            const isExpanded = !!expandedYearly[g.id];
                            return (
                              <>
                                <BdGoalCard goal={g} onEdit={() => onEditGoal(g)} onDelete={() => onDeleteGoal(g.id)} onToggleCheckbox={onToggleCheckbox} rollupData={rollupData} accounts={accounts} dragHandleProps={p.dragHandleProps}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                                    {children.length > 0 && (
                                      <button
                                        onClick={() => setExpandedYearly(prev => ({ ...prev, [g.id]: !prev[g.id] }))}
                                        style={{ ...styles.iconBtn, fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}
                                      >
                                        <span style={{ display: 'inline-block', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>▶</span>
                                        {' '}{children.length} monthly goal{children.length !== 1 ? 's' : ''}
                                      </button>
                                    )}
                                    <button onClick={() => onCreateMonthly(g.id)} style={{ ...styles.iconBtn, fontSize: '11px', color: '#a5b4fc' }}>+ Monthly</button>
                                  </div>
                                </BdGoalCard>
                                {isExpanded && children.length > 0 && (
                                  <div style={{ marginLeft: '20px', marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    {children.map(mg => (
                                      <BdMonthlyCard key={mg.id} mg={mg} onEdit={() => onEditMonthly(mg)} onDelete={() => onDeleteMonthly(mg.id)} />
                                    ))}
                                  </div>
                                )}
                                {monthlyFormFor === g.id && (
                                  <form onSubmit={onMonthlySubmit} style={{ marginLeft: '20px', marginTop: '4px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <input
                                      value={monthlyForm.title}
                                      onChange={e => setMonthlyForm({ ...monthlyForm, title: e.target.value })}
                                      placeholder="Monthly goal title"
                                      autoFocus
                                      style={{ ...styles.input, flex: 1, minWidth: '140px' }}
                                    />
                                    <input
                                      value={monthlyForm.target_value}
                                      onChange={e => setMonthlyForm({ ...monthlyForm, target_value: e.target.value })}
                                      placeholder="Target"
                                      type="number"
                                      min="1"
                                      style={{ ...styles.input, width: '70px' }}
                                    />
                                    <button type="submit" style={styles.primaryBtn}>{editingMonthlyId ? 'Save' : 'Add'}</button>
                                    <button type="button" onClick={onCancelMonthlyForm} style={styles.subtleBtn}>Cancel</button>
                                  </form>
                                )}
                              </>
                            );
                          })()
                        ) : (
                          <BdGoalCard goal={g} onEdit={() => onEditGoal(g)} onDelete={() => onDeleteGoal(g.id)} onToggleCheckbox={onToggleCheckbox} rollupData={rollupData} accounts={accounts} dragHandleProps={p.dragHandleProps} />
                        )}
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </div>
    );
  }

  return (
    <div style={styles.bdGoalsSection}>
      <div style={styles.bdGoalsHeader} onClick={onToggleExpand}>
        <span style={{ ...styles.workstreamCaret, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
        <span style={{ fontSize: '14px', fontWeight: 700, color: '#e2e8f0' }}>Goals</span>
        <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>{goals.length}</span>
        <div style={{ flex: 1 }} />
        <button onClick={e => { e.stopPropagation(); onCreateGoal(); }} style={styles.primaryBtn}>+ Goal</button>
      </div>
      {expanded && (
        <div style={styles.bdGoalsBody}>
          {goals.length === 0 && (
            <div style={styles.empty}>No goals yet. Click + Goal to add one.</div>
          )}
          {renderGroup('quarterly', quarterly, 'Quarterly')}
          {renderGroup('yearly', yearly, 'Yearly')}
          {renderGroup('none', uncategorized, 'No Timeframe')}
        </div>
      )}
    </div>
  );
}

function BdNotesSection({
  notes, inputOpen, setInputOpen, draft, setDraft,
  editingId, setEditingId, editingText, setEditingText,
  priority, setPriority, editPriority, setEditPriority,
  onAdd, onToggle, onDelete, onSaveEdit,
}) {
  return (
    <div style={styles.bdGoalsSection}>
      <div style={{ ...styles.bdGoalsHeader, cursor: 'default' }}>
        <span style={{ fontSize: '14px', fontWeight: 700, color: '#e2e8f0' }}>Notes</span>
        <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>{notes.length}</span>
        <div style={{ flex: 1 }} />
        {!inputOpen && (
          <button onClick={() => setInputOpen(true)} style={styles.primaryBtn}>+ Note</button>
        )}
      </div>
      <div style={styles.bdGoalsBody}>
        {inputOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && priority !== null) onAdd();
                  if (e.key === 'Escape') { setInputOpen(false); setDraft(''); setPriority(null); }
                }}
                placeholder="Add a note..."
                style={{ ...styles.input, flex: 1 }}
                autoFocus
              />
              <button onClick={onAdd} disabled={!draft.trim() || priority === null} style={{ ...styles.primaryBtn, opacity: (draft.trim() && priority !== null) ? 1 : 0.4 }}>Add</button>
              <button onClick={() => { setInputOpen(false); setDraft(''); setPriority(null); }} style={styles.subtleBtn}>Cancel</button>
            </div>
            <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
              {PRIORITY_OPTIONS.map(p => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  style={{
                    width: 26, height: 26, borderRadius: '4px', border: priority === p ? `2px solid ${PRIORITY_COLORS[p]}` : '1px solid rgba(255,255,255,0.12)',
                    background: priority === p ? `${PRIORITY_COLORS[p]}22` : 'rgba(255,255,255,0.04)',
                    color: priority === p ? PRIORITY_COLORS[p] : 'rgba(255,255,255,0.5)',
                    fontSize: '11px', fontWeight: 700, cursor: 'pointer', padding: 0,
                  }}
                >{p}</button>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {notes.map((n) => {
            const borderColor = n.priority ? PRIORITY_COLORS[n.priority] : undefined;
            return (
              <div
                key={n.id}
                style={{
                  ...styles.bdGoalCard,
                  padding: '8px 10px',
                  display: 'flex',
                  alignItems: editingId === n.id ? 'flex-start' : 'center',
                  gap: '8px',
                  ...(borderColor ? { borderLeft: `3px solid ${borderColor}` } : {}),
                }}
              >
                <input
                  type="checkbox"
                  checked={n.checked}
                  onChange={() => onToggle(n.id)}
                  style={{ width: '14px', height: '14px', cursor: 'pointer', accentColor: '#6366f1', marginTop: editingId === n.id ? '4px' : 0 }}
                />
                {editingId === n.id ? (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <input
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onSaveEdit(n.id);
                        if (e.key === 'Escape') { setEditingId(null); setEditingText(''); setEditPriority(null); }
                      }}
                      style={{ ...styles.input, flex: 1 }}
                      autoFocus
                    />
                    <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                      {PRIORITY_OPTIONS.map(p => (
                        <button
                          key={p}
                          onClick={() => setEditPriority(p)}
                          style={{
                            width: 26, height: 26, borderRadius: '4px', border: editPriority === p ? `2px solid ${PRIORITY_COLORS[p]}` : '1px solid rgba(255,255,255,0.12)',
                            background: editPriority === p ? `${PRIORITY_COLORS[p]}22` : 'rgba(255,255,255,0.04)',
                            color: editPriority === p ? PRIORITY_COLORS[p] : 'rgba(255,255,255,0.5)',
                            fontSize: '11px', fontWeight: 700, cursor: 'pointer', padding: 0,
                          }}
                        >{p}</button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <span
                    style={{ flex: 1, fontSize: '13px', color: '#e2e8f0', textDecoration: n.checked ? 'line-through' : 'none', opacity: n.checked ? 0.45 : 1, cursor: 'text' }}
                    onDoubleClick={() => { setEditingId(n.id); setEditingText(n.text); setEditPriority(n.priority || null); }}
                    title="Double-click to edit"
                  >
                    {n.text}
                  </span>
                )}
                <button onClick={() => onDelete(n.id)} style={{ ...styles.iconBtn, color: '#ef4444' }} title="Delete">✕</button>
              </div>
            );
          })}
          {notes.length === 0 && !inputOpen && (
            <div style={{ ...styles.empty, padding: '8px 0' }}>No notes yet</div>
          )}
        </div>
      </div>
    </div>
  );
}

function BdGoalCard({ goal, onEdit, onDelete, onToggleCheckbox, rollupData, accounts, children, dragHandleProps }) {
  const isMetric = goal.goal_type === 'metric';
  const isCheckbox = goal.goal_type === 'checkbox';
  const target = goal.target_value || 1;

  let current = goal.current_value || 0;
  let displayCurrent, displayTarget;

  if (isMetric) {
    const sums = (rollupData || {})[goal.id] || {};
    const metricKeys = goal.metrics || [];
    if (metricKeys.length === 1) {
      current = sums[metricKeys[0]] || 0;
      displayCurrent = formatMetricValue(metricKeys[0], current);
      displayTarget = formatMetricValue(metricKeys[0], target);
    } else {
      current = metricKeys.reduce((acc, k) => acc + (sums[k] || 0), 0);
      displayCurrent = Math.round(current).toLocaleString();
      displayTarget = Math.round(target).toLocaleString();
    }
  } else if (isCheckbox) {
    current = goal.current_value || 0;
  } else {
    displayCurrent = String(current);
    displayTarget = String(target);
  }

  const pct = isCheckbox ? (current >= 1 ? 1 : 0) : Math.min(current / target, 1);
  const pctDisplay = Math.round(pct * 100);

  return (
    <div style={styles.bdGoalCard}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {dragHandleProps && (
          <div {...dragHandleProps} style={{ color: 'rgba(255,255,255,0.2)', fontSize: '14px', cursor: 'grab', userSelect: 'none', lineHeight: 1 }} title="Drag to reorder">\u283f</div>
        )}
        {isCheckbox && (
          <button onClick={() => onToggleCheckbox && onToggleCheckbox(goal)} style={current >= 1 ? styles.bdCheckboxDone : styles.bdCheckbox}>
            {current >= 1 ? '\u2713' : ''}
          </button>
        )}
        <span style={{ fontSize: '13px', fontWeight: 600, color: isCheckbox && current >= 1 ? 'rgba(255,255,255,0.4)' : '#e2e8f0', flex: 1, textDecoration: isCheckbox && current >= 1 ? 'line-through' : 'none' }}>{goal.title}</span>
        {isCheckbox ? (
          <span style={{ fontSize: '11px', fontWeight: 600, color: current >= 1 ? '#22c55e' : 'rgba(255,255,255,0.4)' }}>{current >= 1 ? 'Complete' : 'Incomplete'}</span>
        ) : (
          <>
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>{displayCurrent} / {displayTarget}</span>
            <span style={{ fontSize: '11px', fontWeight: 600, color: progressColor(pct) }}>{pctDisplay}%</span>
          </>
        )}
        <button onClick={onEdit} style={styles.iconBtn} title="Edit">{'\u270E'}</button>
        <button onClick={onDelete} style={styles.iconBtn} title="Delete">{'\u2715'}</button>
      </div>
      {goal.description && (
        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)', marginTop: '4px', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
          {goal.description}
        </div>
      )}
      {!isCheckbox && (
        <div style={styles.bdGoalBarBg}>
          <div style={{ ...styles.bdGoalBarFill, width: `${pctDisplay}%`, background: progressColor(pct) }} />
        </div>
      )}
      {isMetric && (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px' }}>
          {(goal.metrics || []).map(mk => {
            const mo = METRIC_OPTIONS.find(m => m.key === mk);
            return <span key={mk} style={styles.bdMetricTag}>{mo ? mo.label : mk}</span>;
          })}
          {(goal.platform_account_ids || []).map(aid => {
            const acct = (accounts || []).find(a => a.id === aid);
            if (!acct) return null;
            const pm = PLATFORM_META[acct.platform] || {};
            return <span key={aid} style={{ ...styles.bdPlatformTag, borderColor: (pm.color || '#666') + '44', color: pm.color || '#fff' }}>{acct.account_name}</span>;
          })}
        </div>
      )}
      {goal.updated_at && (
        <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginTop: '4px' }}>Updated {formatTimeAgo(goal.updated_at)}</div>
      )}
      {children}
    </div>
  );
}

function BdMonthlyCard({ mg, onEdit, onDelete }) {
  return (
    <div style={{ ...styles.bdGoalCard, padding: '6px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '12px', color: '#e2e8f0', flex: 1 }}>{mg.title}</span>
        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)' }}>target: {mg.target_value || 0}</span>
        <button onClick={onEdit} style={styles.iconBtn} title="Edit">✎</button>
        <button onClick={onDelete} style={styles.iconBtn} title="Delete">✕</button>
      </div>
    </div>
  );
}

function BdGoalFormModal({ form, setForm, editing, onSubmit, onCancel, accounts }) {
  const isMetricForm = form.goal_type === 'metric';
  const isCheckboxForm = form.goal_type === 'checkbox';

  function toggleMetric(key) {
    const cur = form.metrics || [];
    if (cur.includes(key)) {
      setForm({ ...form, metrics: cur.filter(k => k !== key) });
    } else if (cur.length < 3) {
      setForm({ ...form, metrics: [...cur, key] });
    }
  }
  function togglePlatformAccount(id) {
    const cur = form.platform_account_ids || [];
    if (cur.includes(id)) {
      setForm({ ...form, platform_account_ids: cur.filter(a => a !== id) });
    } else {
      setForm({ ...form, platform_account_ids: [...cur, id] });
    }
  }

  return (
    <div style={styles.modalOverlay} {...backdropDismiss(onCancel)}>
      <div style={{ ...styles.modal, borderColor: 'rgba(99,102,241,0.3)' }} onClick={e => e.stopPropagation()}>
        <div style={{ ...styles.modalTitle, color: '#a5b4fc' }}>{editing ? 'Edit Goal' : 'New Goal'}</div>
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Type toggle */}
          <div style={{ display: 'flex', gap: '6px' }}>
            {[{ key: 'manual', label: 'Manual' }, { key: 'metric', label: 'Metric' }, { key: 'checkbox', label: 'Checkbox' }].map(t => (
              <button key={t.key} type="button"
                onClick={() => setForm({ ...form, goal_type: t.key })}
                style={{ ...styles.bdTypeBtn, ...(form.goal_type === t.key ? styles.bdTypeBtnActive : {}) }}>
                {t.label}
              </button>
            ))}
          </div>
          <div>
            <label style={styles.formLabel}>Title</label>
            <input
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
              placeholder={isCheckboxForm ? 'e.g., Set up CRM' : isMetricForm ? 'e.g., Reach 100k total views' : 'e.g., Sign 5 new clients'}
              autoFocus
              style={{ ...styles.input, width: '100%', marginTop: '4px' }}
            />
          </div>
          <div>
            <label style={styles.formLabel}>Description</label>
            <textarea
              value={form.description || ''}
              onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder="Optional context, success criteria, links..."
              rows={2}
              style={{ ...styles.input, width: '100%', marginTop: '4px', resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
          <div>
            <label style={styles.formLabel}>Category</label>
            <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
              {[{ key: 'quarterly', label: 'Quarterly' }, { key: 'yearly', label: 'Yearly' }, { key: 'none', label: 'No timeframe' }].map(cat => (
                <label key={cat.key} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#e2e8f0', cursor: 'pointer' }}>
                  <input type="radio" name="bdGoalCategory" value={cat.key} checked={form.category === cat.key}
                    onChange={() => setForm({ ...form, category: cat.key })} />
                  {cat.label}
                </label>
              ))}
            </div>
          </div>
          {/* Manual fields */}
          {!isMetricForm && !isCheckboxForm && (
            <div style={styles.formRow}>
              <div style={{ flex: 1 }}>
                <label style={styles.formLabel}>Current Value</label>
                <input value={form.current_value} onChange={e => setForm({ ...form, current_value: e.target.value })}
                  type="number" min="0" style={{ ...styles.input, width: '100%', marginTop: '4px' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={styles.formLabel}>Target Value</label>
                <input value={form.target_value} onChange={e => setForm({ ...form, target_value: e.target.value })}
                  type="number" min="1" style={{ ...styles.input, width: '100%', marginTop: '4px' }} />
              </div>
            </div>
          )}
          {/* Metric fields */}
          {isMetricForm && (
            <>
              <div>
                <label style={styles.formLabel}>Target Value</label>
                <input value={form.target_value} onChange={e => setForm({ ...form, target_value: e.target.value })}
                  type="number" min="1" style={{ ...styles.input, width: '100%', marginTop: '4px' }} />
              </div>
              <div>
                <label style={styles.formLabel}>Metrics (up to 3)</label>
                <div style={styles.bdChipRow}>
                  {METRIC_OPTIONS.map(m => {
                    const selected = (form.metrics || []).includes(m.key);
                    return (
                      <button key={m.key} type="button" onClick={() => toggleMetric(m.key)}
                        style={{ ...styles.bdChip, ...(selected ? styles.bdChipSelected : {}) }}>
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label style={styles.formLabel}>Platforms</label>
                <div style={styles.bdChipRow}>
                  {(accounts || []).filter(a => a.platform !== 'stripe').map(acct => {
                    const selected = (form.platform_account_ids || []).includes(acct.id);
                    const pm = PLATFORM_META[acct.platform] || {};
                    return (
                      <button key={acct.id} type="button" onClick={() => togglePlatformAccount(acct.id)}
                        style={{
                          ...styles.bdChip,
                          ...(selected ? { background: (pm.color || '#666') + '22', borderColor: (pm.color || '#666') + '66', color: pm.color || '#fff' } : {}),
                        }}>
                        {acct.account_name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '6px' }}>
            <button type="button" onClick={onCancel} style={styles.subtleBtn}>Cancel</button>
            <button type="submit" style={styles.primaryBtn}>{editing ? 'Save' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Phase form
// ════════════════════════════════════════════════════════════
function PhaseForm({ form, setForm, editing, onSubmit, onCancel, partners }) {
  function togglePartner(pid) {
    const cur = form.assigned_partners || [];
    const next = cur.includes(pid) ? cur.filter(id => id !== pid) : [...cur, pid];
    setForm({ ...form, assigned_partners: next });
  }
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
      {partners && partners.length > 0 && (
        <div style={{ marginTop: '8px' }}>
          <label style={styles.formInlineLabel}>Assigned Partners:</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
            {partners.map(p => (
              <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', color: 'rgba(255,255,255,0.7)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={(form.assigned_partners || []).includes(p.id)}
                  onChange={() => togglePartner(p.id)}
                />
                {p.full_name}
              </label>
            ))}
          </div>
        </div>
      )}
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
    milestones, admins, isAdmin,
    expanded, onToggleExpand, onEditPhase, onDeletePhase, onMovePhaseUp, onMovePhaseDown,
    tagFilter, setTagFilter, hideDone, setHideDone,
    collapsedWorkstreams, setCollapsedWorkstreams,
    expandedInitiatives, setExpandedInitiatives,
    taskFormFor, editingTaskId, taskForm, setTaskForm,
    onOpenCreateTask, onOpenEditTask, onTaskSubmit, onCancelTaskForm, onToggleTask, onDeleteTask,
    onEditInit, onDeleteInit, onMoveInit, onReorderInit, onReorderTask, onCreateInit, onStatusChange,
    milestoneFormFor, editingMilestoneId, milestoneForm, setMilestoneForm,
    onCreateMilestone, onEditMilestone, onMilestoneSubmit, onCancelMilestoneForm, onRetireMilestone,
  } = props;
  const [dragOverInitId, setDragOverInitId] = useState(null);
  const [dragOverTaskId, setDragOverTaskId] = useState(null);
  const [dragOverInitDrop, setDragOverInitDrop] = useState(null); // initiative id receiving a task drop

  const launchCountdown = useMemo(() => {
    if (!phase.launch_target_date) return null;
    const target = parseDateLocal(phase.launch_target_date);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return daysBetween(target, now);
  }, [phase.launch_target_date]);

  const taskProgress = useMemo(() => {
    let total = 0;
    let done = 0;
    for (const init of initiatives) {
      const list = tasksByInitiative[init.id] || [];
      total += list.length;
      done += list.filter(t => t.completed_at).length;
    }
    return { total, done, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
  }, [initiatives, tasksByInitiative]);

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
          <span style={{ color: '#86efac' }}>{taskProgress.pct}%</span>
          <span style={styles.phaseHeaderStatLabel}>{taskProgress.done} / {taskProgress.total}</span>
        </span>

        <div style={{ flex: 1 }} />

        {isAdmin && (
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
        )}
      </div>

      {expanded && (
        <div style={styles.phaseBody}>
          {/* Milestones row (per phase) */}
          <div style={styles.milestonesRow}>
            <span style={styles.milestonesLabel}>Milestones:</span>
            {milestones.map(ms => (
              <button key={ms.id} onClick={isAdmin ? () => onEditMilestone(ms) : undefined} style={{ ...styles.milestoneChip, cursor: isAdmin ? 'pointer' : 'default' }}
                title={`${ms.title}${ms.target_date ? ' — ' + formatDate(ms.target_date) : ''}`}>
                <span style={styles.milestoneTitle}>{ms.title}</span>
                {ms.target_date && <span style={styles.milestoneDate}>{formatDateShort(ms.target_date)}</span>}
              </button>
            ))}
            {isAdmin && <button onClick={() => onCreateMilestone(phase.id)} style={styles.milestoneAdd}>+</button>}
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
                  {isAdmin && <button onClick={(e) => { e.stopPropagation(); onCreateInit(phase.id, ws.key); }} style={styles.workstreamAddBtn}>+</button>}
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
                        isAdmin={isAdmin}
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
                        isDragOver={dragOverInitId === init.id}
                        onInitDragStart={(e) => { e.dataTransfer.setData('bd-init-id', init.id); e.dataTransfer.setData('bd-init-phase', phase.id); e.dataTransfer.setData('bd-init-ws', ws.key); e.dataTransfer.effectAllowed = 'move'; }}
                        onInitDragOver={(e) => { if (e.dataTransfer.types.includes('bd-init-id')) { e.preventDefault(); setDragOverInitId(init.id); } }}
                        onInitDragLeave={() => setDragOverInitId(null)}
                        onInitDrop={(e) => { e.preventDefault(); setDragOverInitId(null); const draggedId = e.dataTransfer.getData('bd-init-id'); const srcPhase = e.dataTransfer.getData('bd-init-phase'); const srcWs = e.dataTransfer.getData('bd-init-ws'); if (draggedId && draggedId !== init.id && srcPhase === phase.id && srcWs === ws.key) onReorderInit(draggedId, init.id, phase.id, ws.key); }}
                        isTaskDragOver={dragOverInitDrop === init.id}
                        dragOverTaskId={dragOverTaskId}
                        onTaskDragStart={(taskId, initId) => (e) => { e.dataTransfer.setData('bd-task-id', taskId); e.dataTransfer.setData('bd-task-src-init', initId); e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); }}
                        onTaskDragOver={(taskId, initId) => (e) => { if (e.dataTransfer.types.includes('bd-task-id')) { e.preventDefault(); e.stopPropagation(); setDragOverTaskId(taskId); setDragOverInitDrop(initId); } }}
                        onTaskDragLeave={() => { setDragOverTaskId(null); setDragOverInitDrop(null); }}
                        onTaskDrop={(targetTaskId, destInitId) => (e) => { e.preventDefault(); e.stopPropagation(); setDragOverTaskId(null); setDragOverInitDrop(null); const draggedId = e.dataTransfer.getData('bd-task-id'); const srcInit = e.dataTransfer.getData('bd-task-src-init'); if (draggedId && draggedId !== targetTaskId) onReorderTask(draggedId, targetTaskId, srcInit, destInitId); }}
                        onInitTaskAreaDragOver={(initId) => (e) => { if (e.dataTransfer.types.includes('bd-task-id')) { e.preventDefault(); e.stopPropagation(); setDragOverInitDrop(initId); setDragOverTaskId(null); } }}
                        onInitTaskAreaDrop={(initId) => (e) => { e.preventDefault(); e.stopPropagation(); setDragOverInitDrop(null); setDragOverTaskId(null); const draggedId = e.dataTransfer.getData('bd-task-id'); const srcInit = e.dataTransfer.getData('bd-task-src-init'); if (draggedId) onReorderTask(draggedId, null, srcInit, initId); }}
                      />
                    ))}
                    {showCompleted && (
                      <CompletedSection
                        initiatives={completedRows}
                        tasksByInitiative={tasksByInitiative}
                        linksByInitiative={linksByInitiative}
                        admins={admins}
                        isAdmin={isAdmin}
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

function CompletedSection({ initiatives, tasksByInitiative, linksByInitiative, admins, isAdmin, onEditInit, onDeleteInit, onStatusChange }) {
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
          isAdmin={isAdmin}
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
    initiative, tasks, initiativeLinks, admins, isAdmin,
    expanded, onToggleExpand, onEdit, onDelete, onStatusChange,
    onMoveUp, onMoveDown, dimmed,
    taskFormFor, editingTaskId, taskForm, setTaskForm,
    onOpenCreateTask, onOpenEditTask, onTaskSubmit, onCancelTaskForm,
    onToggleTask, onDeleteTask,
    // drag-and-drop
    isDragOver, onInitDragStart, onInitDragOver, onInitDragLeave, onInitDrop,
    isTaskDragOver, dragOverTaskId,
    onTaskDragStart, onTaskDragOver, onTaskDragLeave, onTaskDrop,
    onInitTaskAreaDragOver, onInitTaskAreaDrop,
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
    <div
      style={{ ...styles.initiativeCard, opacity: dimmed ? 0.55 : 1, ...(isDragOver ? { borderColor: '#6366f1', background: 'rgba(99,102,241,0.06)' } : {}), ...(isTaskDragOver ? { borderColor: '#10b981', background: 'rgba(16,185,129,0.04)' } : {}) }}
      draggable={isAdmin && !dimmed}
      onDragStart={onInitDragStart}
      onDragOver={onInitDragOver}
      onDragLeave={onInitDragLeave}
      onDrop={onInitDrop}
      onDragEnd={() => {}}
    >
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
        {isAdmin && (
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
        )}
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
            {isAdmin && taskFormFor !== initiative.id && (
              <button onClick={() => onOpenCreateTask(initiative.id)} style={styles.subtleBtn}>+ Task</button>
            )}
          </div>
          <div
            onDragOver={onInitTaskAreaDragOver ? onInitTaskAreaDragOver(initiative.id) : undefined}
            onDrop={onInitTaskAreaDrop ? onInitTaskAreaDrop(initiative.id) : undefined}
          >
          {sortedTasks.map(task => (
            <TaskRow
              key={task.id}
              task={task}
              admins={admins}
              isAdmin={isAdmin}
              initiative={initiative}
              isEditing={editingTaskId === task.id && taskFormFor === initiative.id}
              taskForm={taskForm}
              setTaskForm={setTaskForm}
              onToggle={() => onToggleTask(task)}
              onEdit={() => onOpenEditTask(task)}
              onSubmit={(e) => onTaskSubmit(e, initiative.id)}
              onCancel={onCancelTaskForm}
              onDelete={() => onDeleteTask(task.id)}
              isDragOver={dragOverTaskId === task.id}
              onDragStart={onTaskDragStart ? onTaskDragStart(task.id, initiative.id) : undefined}
              onDragOver={onTaskDragOver ? onTaskDragOver(task.id, initiative.id) : undefined}
              onDragLeave={onTaskDragLeave}
              onDrop={onTaskDrop ? onTaskDrop(task.id, initiative.id) : undefined}
            />
          ))}
          </div>
          {isAdmin && taskFormFor === initiative.id && !editingTaskId && (
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
function TaskRow({ task, admins, isAdmin, initiative, isEditing, taskForm, setTaskForm, onToggle, onEdit, onSubmit, onCancel, onDelete,
  isDragOver, onDragStart, onDragOver, onDragLeave, onDrop }) {
  if (isEditing) return <TaskForm form={taskForm} setForm={setTaskForm} admins={admins} onSubmit={onSubmit} onCancel={onCancel} editing />;
  const done = !!task.completed_at;
  const owner = admins.find(a => a.id === task.owner_id);
  const dl = formatDeadline(task.due_date);
  const tag = effectiveTag(task, initiative);
  const tagMeta = TAG_MAP[tag];
  return (
    <div
      style={{ ...styles.taskRow, opacity: done ? 0.55 : 1, ...(isDragOver ? { borderTop: '2px solid #6366f1', marginTop: '-2px' } : {}) }}
      draggable={isAdmin}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isAdmin ? (
        <button onClick={onToggle} style={styles.checkBtn}>
          <span style={{ ...styles.checkBox, ...(done ? styles.checkBoxDone : {}) }}>{done && '✓'}</span>
        </button>
      ) : (
        <span style={{ ...styles.checkBox, ...(done ? styles.checkBoxDone : {}), marginRight: '8px' }}>{done && '✓'}</span>
      )}
      <span style={{ ...styles.taskTitle, textDecoration: done ? 'line-through' : 'none' }}>{task.title}</span>
      {task.recurrence_interval && <span style={styles.recurChip} title={`Repeats ${task.recurrence_interval}`}>↻ {task.recurrence_interval}</span>}
      {task.tag && task.tag !== initiative.tag && (
        <span style={{ ...styles.miniTag, color: tagMeta.color, background: tagMeta.bg }}>{tagMeta.label}</span>
      )}
      <div style={{ flex: 1 }} />
      {dl && !done && <span style={{ ...styles.metaPill, color: dl.color }}>{formatDateShort(task.due_date)} · {dl.sub}</span>}
      {dl && done && <span style={styles.metaPill}>{formatDateShort(task.due_date)}</span>}
      {owner && <span style={styles.ownerChip} title={owner.full_name}>{owner.full_name?.charAt(0).toUpperCase()}</span>}
      {isAdmin && <button onClick={(e) => { e.stopPropagation(); onEdit(); }} style={styles.iconBtn}>edit</button>}
      {isAdmin && <button onClick={(e) => { e.stopPropagation(); onDelete(); }} style={styles.iconBtn}>×</button>}
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
function MyStuffView({ profile, phasesById, phaseIndexById, initiatives, tasks, tasksByInitiative, enabledPhases, isAdmin, onToggleTask, onEditInit, onEditTask }) {
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
              {isAdmin ? (
                <button onClick={() => onToggleTask(task)} style={styles.checkBtn}>
                  <span style={styles.checkBox} />
                </button>
              ) : (
                <span style={{ ...styles.checkBox, marginRight: '8px' }} />
              )}
              <span style={styles.taskTitle}>{task.title}</span>
              {phase && <span style={{ ...styles.miniTag, color: phaseC, background: phaseC + '22' }}>{phase.name}</span>}
              {ws && <span style={{ ...styles.miniTag, color: ws.color, background: ws.color + '22' }}>{ws.label}</span>}
              {init && <span style={styles.contextLabel}>in {init.title}</span>}
              <div style={{ flex: 1 }} />
              {dl && <span style={{ ...styles.metaPill, color: dl.color }}>{formatDateShort(task.due_date)} · {dl.sub}</span>}
              {isAdmin && <button onClick={() => onEditTask(task)} style={styles.iconBtn}>edit</button>}
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
                {isAdmin && <button onClick={() => onEditInit(init)} style={styles.iconBtn}>edit</button>}
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

  // BD Goals
  bdGoalsSection: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '14px', overflow: 'hidden', marginBottom: '12px',
  },
  bdGoalsHeader: {
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '12px 18px', cursor: 'pointer',
    background: 'rgba(255,255,255,0.025)',
  },
  bdGoalsBody: {
    padding: '8px 18px 18px',
    display: 'flex', flexDirection: 'column', gap: '12px',
  },
  bdGoalsGroupLabel: {
    fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px',
  },
  bdGoalCard: {
    background: 'rgba(255,255,255,0.025)',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '8px', padding: '10px 12px',
  },
  bdGoalBarBg: {
    height: '4px', background: 'rgba(255,255,255,0.06)',
    borderRadius: '2px', overflow: 'hidden', marginTop: '6px',
  },
  bdGoalBarFill: { height: '100%', borderRadius: '2px', transition: 'width 0.3s' },
  bdTypeBtn: {
    flex: 1, padding: '8px 14px', borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.4)', fontSize: '13px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  bdTypeBtnActive: {
    background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.4)', color: '#a5b4fc',
  },
  bdCheckbox: {
    width: '18px', height: '18px', borderRadius: '4px',
    border: '1.5px solid rgba(255,255,255,0.25)', background: 'transparent',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '12px', color: 'transparent', padding: 0, flexShrink: 0,
  },
  bdCheckboxDone: {
    width: '18px', height: '18px', borderRadius: '4px',
    border: '1.5px solid #22c55e', background: 'rgba(34,197,94,0.15)',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '12px', color: '#22c55e', padding: 0, flexShrink: 0,
  },
  bdMetricTag: {
    fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px',
    background: 'rgba(99,102,241,0.12)', color: '#a5b4fc',
  },
  bdPlatformTag: {
    fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px',
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
  },
  bdChipRow: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' },
  bdChip: {
    padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 500,
    border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontFamily: 'inherit',
  },
  bdChipSelected: {
    background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.4)', color: '#a5b4fc',
  },
};
