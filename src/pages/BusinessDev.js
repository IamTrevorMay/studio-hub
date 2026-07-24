import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { toast } from '../contexts/ToastContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import { fetchAllRows } from './analytics/utils';
import backdropDismiss from '../lib/backdropDismiss';
import { clickableKeyProps } from '../lib/styleRecipes';
import { colors } from '../lib/styleTokens';

// ════════════════════════════════════════════════════════════
// Constants — BD Goals (preserved from the previous page)
// ════════════════════════════════════════════════════════════
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

// Note ordering still respects legacy stored priorities (higher first), but
// the priority picker UI was removed — new notes are text-only.
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
// Constants — Roadmap
// ════════════════════════════════════════════════════════════
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
  if (diff < 0)   return { sub: `${Math.abs(diff)}d overdue`, color: '#ef4444' };
  if (diff === 0) return { sub: 'Due today',                  color: '#f59e0b' };
  if (diff <= 14) return { sub: `${diff}d left`,              color: '#f59e0b' };
  return { sub: `${diff}d left`, color: 'rgba(255,255,255,0.4)' };
}

const EMPTY_ROADMAP = { name: '', deadline_name: '', deadline_date: '' };
const EMPTY_MILESTONE = { title: '', target_date: '' };
const EMPTY_TASK = { title: '', description: '', due_date: '' };
const EMPTY_BD_GOAL = { title: '', description: '', current_value: '', target_value: '', category: 'quarterly', goal_type: 'manual', metrics: [], platform_account_ids: [] };
const EMPTY_BD_MONTHLY = { title: '', target_value: '' };

// ════════════════════════════════════════════════════════════
// Main page
// ════════════════════════════════════════════════════════════
export default function BusinessDev() {
  const { profile, isAdmin, isPartner } = useAuth();
  const confirm = useConfirm();

  // ── Roadmap data ──
  const [roadmaps, setRoadmaps] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  // Expand/collapse
  const [expandedRoadmaps, setExpandedRoadmaps] = useState({});   // roadmapId -> bool
  const [expandedMilestones, setExpandedMilestones] = useState({}); // milestoneId -> bool

  // Roadmap form (modal)
  const [showRoadmapForm, setShowRoadmapForm] = useState(false);
  const [editingRoadmapId, setEditingRoadmapId] = useState(null);
  const [roadmapForm, setRoadmapForm] = useState(EMPTY_ROADMAP);

  // Milestone inline form (per roadmap)
  const [milestoneFormFor, setMilestoneFormFor] = useState(null); // roadmapId
  const [editingMilestoneId, setEditingMilestoneId] = useState(null);
  const [milestoneForm, setMilestoneForm] = useState(EMPTY_MILESTONE);

  // Task inline form (per milestone)
  const [taskFormFor, setTaskFormFor] = useState(null); // milestoneId
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [taskForm, setTaskForm] = useState(EMPTY_TASK);

  // ── BD Goals state (preserved) ──
  const [bdGoalsExpanded, setBdGoalsExpanded] = useState(true);
  const [bdGoals, setBdGoals] = useState([]);
  const [bdMonthlyGoals, setBdMonthlyGoals] = useState([]);
  // BD Notes (per-user, behaves like Dashboard To Do)
  const [bdNotes, setBdNotes] = useState([]);
  const [bdNoteInputOpen, setBdNoteInputOpen] = useState(false);
  const [bdNoteDraft, setBdNoteDraft] = useState('');
  const [bdNoteEditingId, setBdNoteEditingId] = useState(null);
  const [bdNoteEditingText, setBdNoteEditingText] = useState('');
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
  // Fetch roadmap tree
  // ─────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rmRes, msRes, taskRes] = await Promise.all([
        supabase.from('roadmaps').select('*').order('position', { ascending: true }).order('created_at', { ascending: true }),
        fetchAllRows(supabase.from('roadmap_milestones').select('*').order('position', { ascending: true }).order('created_at', { ascending: true })),
        fetchAllRows(supabase.from('roadmap_tasks').select('*').order('position', { ascending: true }).order('created_at', { ascending: true })),
      ]);
      const rms = rmRes.data || [];
      setRoadmaps(rms);
      setMilestones(msRes || []);
      setTasks(taskRes || []);
      // Solo roadmap auto-expands on first load; multi defaults collapsed.
      setExpandedRoadmaps(prev => {
        if (Object.keys(prev).length > 0) return prev;
        const next = {};
        if (rms.length === 1) next[rms[0].id] = true;
        return next;
      });
    } catch (err) {
      console.error('Roadmap fetch error:', err);
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
  // BD Goals fetch & CRUD (preserved)
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
      if (!(bdGoalForm.metrics || []).length) { toast.error('Select at least one metric'); return; }
      if (!(bdGoalForm.platform_account_ids || []).length) { toast.error('Select at least one platform'); return; }
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
      if (error) { toast.error(error.message); return; }
    } else {
      const nextPosition = bdGoals.length > 0 ? Math.max(...bdGoals.map(g => g.position || 0)) + 1 : 0;
      const { error } = await supabase.from('goals').insert({ ...payload, created_by: profile.id, position: nextPosition });
      if (error) { toast.error(error.message); return; }
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
    const baseRaw = Math.min(...group.map(g => (g.position != null ? g.position : Number.POSITIVE_INFINITY)));
    const base = Number.isFinite(baseRaw) ? baseRaw : 0;
    const reindexed = reordered.map((g, idx) => ({ ...g, position: base + idx }));
    setBdGoals(prev => {
      const others = prev.filter(g => g.category !== category);
      const merged = [...others, ...reindexed];
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
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase.from('monthly_goals').insert({ title, target_value, parent_goal_id: showBdMonthlyForm, scope: 'bd', created_by: profile.id });
      if (error) { toast.error(error.message); return; }
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
    if (!text || !profile?.id) return;
    const nextPosition = bdNotes.length > 0 ? Math.max(...bdNotes.map(n => n.position || 0)) + 1 : 0;
    const { data, error } = await supabase
      .from('bd_user_notes')
      .insert({ user_id: profile.id, text, checked: false, position: nextPosition })
      .select()
      .single();
    if (error) { toast.error(`Could not save note: ${error.message || 'unknown error'}`); return; }
    setBdNotes(prev => sortByPriority([...prev, data]));
    setBdNoteDraft('');
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
    setBdNoteEditingId(null);
    setBdNoteEditingText('');
    if (!trimmed) return;
    const current = bdNotes.find(n => n.id === id);
    if (!current || current.text === trimmed) return;
    setBdNotes(prev => sortByPriority(prev.map(n => n.id === id ? { ...n, text: trimmed } : n)));
    const { error } = await supabase
      .from('bd_user_notes')
      .update({ text: trimmed, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      console.error('Error saving note edit:', error);
      setBdNotes(prev => sortByPriority(prev.map(n => n.id === id ? { ...n, text: current.text } : n)));
    }
  }

  // ─────────────────────────────────────────────
  // Derived
  // ─────────────────────────────────────────────
  const milestonesByRoadmap = useMemo(() => {
    const m = {};
    for (const ms of milestones) (m[ms.roadmap_id] = m[ms.roadmap_id] || []).push(ms);
    return m;
  }, [milestones]);

  const tasksByMilestone = useMemo(() => {
    const m = {};
    for (const t of tasks) (m[t.milestone_id] = m[t.milestone_id] || []).push(t);
    return m;
  }, [tasks]);

  // ─────────────────────────────────────────────
  // Roadmap CRUD
  // ─────────────────────────────────────────────
  function openCreateRoadmap() {
    setEditingRoadmapId(null);
    setRoadmapForm(EMPTY_ROADMAP);
    setShowRoadmapForm(true);
  }
  function openEditRoadmap(rm) {
    setEditingRoadmapId(rm.id);
    setRoadmapForm({ name: rm.name, deadline_name: rm.deadline_name || '', deadline_date: rm.deadline_date || '' });
    setShowRoadmapForm(true);
  }
  function cancelRoadmapForm() {
    setShowRoadmapForm(false);
    setEditingRoadmapId(null);
    setRoadmapForm(EMPTY_ROADMAP);
  }
  async function handleRoadmapSubmit(e) {
    e.preventDefault();
    const name = roadmapForm.name.trim();
    if (!name) { toast.error('Name is required.'); return; }
    const payload = {
      name,
      deadline_name: roadmapForm.deadline_name.trim() || null,
      deadline_date: roadmapForm.deadline_date || null,
    };
    if (editingRoadmapId) {
      const { error } = await supabase.from('roadmaps').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editingRoadmapId);
      if (error) { toast.error(error.message); return; }
    } else {
      const nextPos = roadmaps.length > 0 ? Math.max(...roadmaps.map(r => r.position || 0)) + 1 : 0;
      const { data, error } = await supabase.from('roadmaps').insert({ ...payload, position: nextPos }).select().single();
      if (error) { toast.error(error.message); return; }
      if (data) setExpandedRoadmaps(prev => ({ ...prev, [data.id]: true }));
    }
    cancelRoadmapForm();
    fetchAll();
  }
  async function handleDeleteRoadmap(rm) {
    const msCount = (milestonesByRoadmap[rm.id] || []).length;
    const msg = msCount
      ? `Delete "${rm.name}" and its ${msCount} milestone${msCount !== 1 ? 's' : ''} (and all their tasks)? This cannot be undone.`
      : `Delete "${rm.name}"? This cannot be undone.`;
    if (!(await confirm(msg))) return;
    const { error } = await supabase.from('roadmaps').delete().eq('id', rm.id);
    if (error) { toast.error(error.message); return; }
    fetchAll();
  }

  // ─────────────────────────────────────────────
  // Milestone CRUD
  // ─────────────────────────────────────────────
  function openCreateMilestone(roadmapId) {
    setEditingMilestoneId(null);
    setMilestoneForm(EMPTY_MILESTONE);
    setMilestoneFormFor(roadmapId);
  }
  function openEditMilestone(ms) {
    setEditingMilestoneId(ms.id);
    setMilestoneForm({ title: ms.title, target_date: ms.target_date || '' });
    setMilestoneFormFor(ms.roadmap_id);
  }
  function cancelMilestoneForm() {
    setMilestoneFormFor(null);
    setEditingMilestoneId(null);
    setMilestoneForm(EMPTY_MILESTONE);
  }
  async function handleMilestoneSubmit(e) {
    e.preventDefault();
    const title = milestoneForm.title.trim();
    if (!title) return;
    const payload = { title, target_date: milestoneForm.target_date || null };
    if (editingMilestoneId) {
      const { error } = await supabase.from('roadmap_milestones').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editingMilestoneId);
      if (error) { toast.error(error.message); return; }
    } else {
      const siblings = milestonesByRoadmap[milestoneFormFor] || [];
      const nextPos = siblings.length > 0 ? Math.max(...siblings.map(s => s.position || 0)) + 1 : 0;
      const { error } = await supabase.from('roadmap_milestones').insert({ ...payload, roadmap_id: milestoneFormFor, position: nextPos });
      if (error) { toast.error(error.message); return; }
    }
    cancelMilestoneForm();
    fetchAll();
  }
  async function handleToggleMilestone(ms) {
    if (!isAdmin) return;
    const done = !!ms.completed_at;
    const now = new Date().toISOString();
    const { error } = await supabase.from('roadmap_milestones')
      .update({ completed_at: done ? null : now, updated_at: now })
      .eq('id', ms.id);
    if (error) { toast.error(error.message); return; }
    // Refetch so the milestone→tasks cascade (server-side trigger) is reflected.
    fetchAll();
  }
  async function handleDeleteMilestone(ms) {
    const tCount = (tasksByMilestone[ms.id] || []).length;
    const msg = tCount
      ? `Delete milestone "${ms.title}" and its ${tCount} task${tCount !== 1 ? 's' : ''}?`
      : `Delete milestone "${ms.title}"?`;
    if (!(await confirm(msg))) return;
    const { error } = await supabase.from('roadmap_milestones').delete().eq('id', ms.id);
    if (error) { toast.error(error.message); return; }
    fetchAll();
  }

  // ─────────────────────────────────────────────
  // Task CRUD
  // ─────────────────────────────────────────────
  function openCreateTask(milestoneId) {
    setEditingTaskId(null);
    setTaskForm(EMPTY_TASK);
    setTaskFormFor(milestoneId);
    setExpandedMilestones(prev => ({ ...prev, [milestoneId]: true }));
  }
  function openEditTask(task) {
    setEditingTaskId(task.id);
    setTaskForm({ title: task.title, description: task.description || '', due_date: task.due_date || '' });
    setTaskFormFor(task.milestone_id);
  }
  function cancelTaskForm() {
    setTaskFormFor(null);
    setEditingTaskId(null);
    setTaskForm(EMPTY_TASK);
  }
  async function handleTaskSubmit(e) {
    e.preventDefault();
    const title = taskForm.title.trim();
    if (!title) return;
    const payload = {
      title,
      description: taskForm.description.trim() || null,
      due_date: taskForm.due_date || null,
    };
    if (editingTaskId) {
      const { error } = await supabase.from('roadmap_tasks').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editingTaskId);
      if (error) { toast.error(error.message); return; }
    } else {
      const siblings = tasksByMilestone[taskFormFor] || [];
      const nextPos = siblings.length > 0 ? Math.max(...siblings.map(s => s.position || 0)) + 1 : 0;
      const { error } = await supabase.from('roadmap_tasks').insert({ ...payload, milestone_id: taskFormFor, position: nextPos });
      if (error) { toast.error(error.message); return; }
    }
    cancelTaskForm();
    fetchAll();
  }
  async function handleToggleTask(task) {
    if (!isAdmin) return;
    const done = !!task.completed_at;
    const now = new Date().toISOString();
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, completed_at: done ? null : now } : t));
    const { error } = await supabase.from('roadmap_tasks')
      .update({ completed_at: done ? null : now, updated_at: now })
      .eq('id', task.id);
    if (error) { toast.error(error.message); fetchAll(); }
  }
  async function handleDeleteTask(task) {
    if (!(await confirm('Delete this task?'))) return;
    const { error } = await supabase.from('roadmap_tasks').delete().eq('id', task.id);
    if (error) { toast.error(error.message); return; }
    setTasks(prev => prev.filter(t => t.id !== task.id));
  }

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  if (!isAdmin && !isPartner) return <div style={styles.page}><div style={styles.loading}>Access restricted.</div></div>;
  if (loading) return <div style={styles.page}><div style={styles.loading}>Loading Roadmap...</div></div>;

  const showSidebar = isAdmin; // Goals + Notes are admin-only

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <div>
          <h1 style={styles.pageTitle}>Roadmap</h1>
          <p style={styles.pageSubtitle}>Roadmaps, milestones & tasks</p>
        </div>
        {isAdmin && <button onClick={openCreateRoadmap} style={styles.primaryBtn}>+ Roadmap</button>}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: showSidebar ? '2fr 1fr' : '1fr',
        gap: '16px',
        alignItems: 'flex-start',
      }}>
        {/* ── Left: Roadmaps ── */}
        <div style={styles.roadmapList}>
          {roadmaps.length === 0 ? (
            <div style={styles.empty}>
              {isAdmin ? 'No roadmaps yet. Click + Roadmap to create one.' : 'No roadmaps yet.'}
            </div>
          ) : (
            roadmaps.map(rm => (
              <RoadmapCard
                key={rm.id}
                roadmap={rm}
                milestones={milestonesByRoadmap[rm.id] || []}
                tasksByMilestone={tasksByMilestone}
                isAdmin={isAdmin}
                expanded={!!expandedRoadmaps[rm.id]}
                onToggleExpand={() => setExpandedRoadmaps(prev => ({ ...prev, [rm.id]: !prev[rm.id] }))}
                expandedMilestones={expandedMilestones}
                setExpandedMilestones={setExpandedMilestones}
                onEditRoadmap={() => openEditRoadmap(rm)}
                onDeleteRoadmap={() => handleDeleteRoadmap(rm)}
                // milestone
                milestoneFormFor={milestoneFormFor}
                editingMilestoneId={editingMilestoneId}
                milestoneForm={milestoneForm}
                setMilestoneForm={setMilestoneForm}
                onOpenCreateMilestone={openCreateMilestone}
                onOpenEditMilestone={openEditMilestone}
                onMilestoneSubmit={handleMilestoneSubmit}
                onCancelMilestoneForm={cancelMilestoneForm}
                onToggleMilestone={handleToggleMilestone}
                onDeleteMilestone={handleDeleteMilestone}
                // task
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
              />
            ))
          )}
        </div>

        {/* ── Right: Goals + Notes (admin only) ── */}
        {showSidebar && (
          <div>
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
              onAdd={addBdNote}
              onToggle={toggleBdNote}
              onDelete={deleteBdNote}
              onSaveEdit={saveBdNoteEdit}
            />
          </div>
        )}
      </div>

      {/* Roadmap form modal */}
      {isAdmin && showRoadmapForm && (
        <RoadmapFormModal
          form={roadmapForm}
          setForm={setRoadmapForm}
          editing={!!editingRoadmapId}
          onSubmit={handleRoadmapSubmit}
          onCancel={cancelRoadmapForm}
        />
      )}

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
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Roadmap card
// ════════════════════════════════════════════════════════════
function RoadmapCard(props) {
  const {
    roadmap, milestones, tasksByMilestone, isAdmin,
    expanded, onToggleExpand, expandedMilestones, setExpandedMilestones,
    onEditRoadmap, onDeleteRoadmap,
    milestoneFormFor, editingMilestoneId, milestoneForm, setMilestoneForm,
    onOpenCreateMilestone, onOpenEditMilestone, onMilestoneSubmit, onCancelMilestoneForm,
    onToggleMilestone, onDeleteMilestone,
    taskFormFor, editingTaskId, taskForm, setTaskForm,
    onOpenCreateTask, onOpenEditTask, onTaskSubmit, onCancelTaskForm,
    onToggleTask, onDeleteTask,
  } = props;

  const total = milestones.length;
  const done = milestones.filter(m => m.completed_at).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const deadline = formatDeadline(roadmap.deadline_date);
  const addingMilestone = milestoneFormFor === roadmap.id && !editingMilestoneId;

  return (
    <div style={styles.roadmapCard}>
      <div style={styles.roadmapHeader}>
        <button onClick={onToggleExpand} style={styles.caretBtn} title={expanded ? 'Collapse' : 'Expand'}>
          <span style={{ display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>{'▶'}</span>
        </button>
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={onToggleExpand}>
          <div style={styles.roadmapName}>{roadmap.name}</div>
          {(roadmap.deadline_name || roadmap.deadline_date) && (
            <div style={styles.roadmapDeadlineRow}>
              {roadmap.deadline_name && <span style={styles.roadmapDeadlineName}>{roadmap.deadline_name}</span>}
              {roadmap.deadline_date && <span style={styles.roadmapDeadlineDate}>{formatDate(roadmap.deadline_date)}</span>}
              {deadline && <span style={{ ...styles.roadmapCountdown, color: deadline.color }}>{deadline.sub}</span>}
            </div>
          )}
        </div>
        {total > 0 && (
          <div style={styles.roadmapPctWrap} title={`${done} of ${total} milestones complete`}>
            <span style={{ ...styles.roadmapPct, color: progressColor(pct / 100) }}>{pct}%</span>
            <span style={styles.roadmapPctSub}>{done}/{total}</span>
          </div>
        )}
        {isAdmin && (
          <div style={styles.rowActions}>
            <button onClick={onEditRoadmap} style={styles.iconBtn} title="Edit roadmap">{'✎'}</button>
            <button onClick={onDeleteRoadmap} style={styles.iconBtn} title="Delete roadmap">{'✕'}</button>
          </div>
        )}
      </div>

      {expanded && (
        <div style={styles.roadmapBody}>
          {milestones.length === 0 && !addingMilestone && (
            <div style={styles.empty}>No milestones yet.</div>
          )}
          {milestones.map(ms => (
            <MilestoneRow
              key={ms.id}
              milestone={ms}
              tasks={tasksByMilestone[ms.id] || []}
              isAdmin={isAdmin}
              expanded={!!expandedMilestones[ms.id]}
              onToggleExpand={() => setExpandedMilestones(prev => ({ ...prev, [ms.id]: !prev[ms.id] }))}
              onToggle={() => onToggleMilestone(ms)}
              onEdit={() => onOpenEditMilestone(ms)}
              onDelete={() => onDeleteMilestone(ms)}
              isEditingMilestone={editingMilestoneId === ms.id}
              milestoneForm={milestoneForm}
              setMilestoneForm={setMilestoneForm}
              onMilestoneSubmit={onMilestoneSubmit}
              onCancelMilestoneForm={onCancelMilestoneForm}
              // task
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

          {/* Add-milestone inline form */}
          {addingMilestone ? (
            <form onSubmit={onMilestoneSubmit} style={styles.inlineForm}>
              <input
                value={milestoneForm.title}
                onChange={e => setMilestoneForm({ ...milestoneForm, title: e.target.value })}
                placeholder="Milestone title"
                autoFocus
                style={{ ...styles.input, flex: 1, minWidth: '160px' }}
              />
              <input
                type="date"
                value={milestoneForm.target_date}
                onChange={e => setMilestoneForm({ ...milestoneForm, target_date: e.target.value })}
                style={{ ...styles.input, colorScheme: 'dark' }}
              />
              <button type="submit" style={styles.primaryBtn}>Add</button>
              <button type="button" onClick={onCancelMilestoneForm} style={styles.subtleBtn}>Cancel</button>
            </form>
          ) : (
            isAdmin && (
              <button onClick={() => onOpenCreateMilestone(roadmap.id)} style={styles.addRowBtn}>+ Milestone</button>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Milestone row
// ════════════════════════════════════════════════════════════
function MilestoneRow(props) {
  const {
    milestone: ms, tasks, isAdmin, expanded, onToggleExpand,
    onToggle, onEdit, onDelete,
    isEditingMilestone, milestoneForm, setMilestoneForm, onMilestoneSubmit, onCancelMilestoneForm,
    taskFormFor, editingTaskId, taskForm, setTaskForm,
    onOpenCreateTask, onOpenEditTask, onTaskSubmit, onCancelTaskForm, onToggleTask, onDeleteTask,
  } = props;

  const isDone = !!ms.completed_at;
  const doneTasks = tasks.filter(t => t.completed_at).length;
  const dl = formatDeadline(ms.target_date);
  const addingTask = taskFormFor === ms.id && !editingTaskId;

  if (isEditingMilestone) {
    return (
      <form onSubmit={onMilestoneSubmit} style={styles.inlineForm}>
        <input
          value={milestoneForm.title}
          onChange={e => setMilestoneForm({ ...milestoneForm, title: e.target.value })}
          placeholder="Milestone title"
          autoFocus
          style={{ ...styles.input, flex: 1, minWidth: '160px' }}
        />
        <input
          type="date"
          value={milestoneForm.target_date}
          onChange={e => setMilestoneForm({ ...milestoneForm, target_date: e.target.value })}
          style={{ ...styles.input, colorScheme: 'dark' }}
        />
        <button type="submit" style={styles.primaryBtn}>Save</button>
        <button type="button" onClick={onCancelMilestoneForm} style={styles.subtleBtn}>Cancel</button>
      </form>
    );
  }

  return (
    <div style={styles.milestoneWrap}>
      <div style={styles.milestoneRow}>
        <button
          onClick={onToggle}
          disabled={!isAdmin}
          style={isDone ? styles.bdCheckboxDone : styles.bdCheckbox}
          title={isAdmin ? (isDone ? 'Mark incomplete' : 'Complete milestone (checks off its tasks)') : undefined}
        >
          {isDone ? '✓' : ''}
        </button>
        {tasks.length > 0 ? (
          <button onClick={onToggleExpand} style={styles.caretBtnSm} title={expanded ? 'Collapse' : 'Expand'}>
            <span style={{ display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>{'▶'}</span>
          </button>
        ) : (
          <span style={{ width: '18px', flexShrink: 0 }} />
        )}
        <span
          onClick={tasks.length > 0 ? onToggleExpand : undefined}
          style={{
            flex: 1, minWidth: 0, fontSize: '14px', fontWeight: 600,
            color: isDone ? 'rgba(255,255,255,0.4)' : '#e2e8f0',
            textDecoration: isDone ? 'line-through' : 'none',
            cursor: tasks.length > 0 ? 'pointer' : 'default',
          }}
        >
          {ms.title}
        </span>
        {tasks.length > 0 && (
          <span style={styles.taskCounter}>{doneTasks}/{tasks.length}</span>
        )}
        {ms.target_date && dl && (
          <span style={{ ...styles.dateChip, color: dl.color }} title={formatDate(ms.target_date)}>{formatDateShort(ms.target_date)}</span>
        )}
        {isAdmin && (
          <div style={styles.rowActions}>
            <button onClick={onEdit} style={styles.iconBtn} title="Edit milestone">{'✎'}</button>
            <button onClick={onDelete} style={styles.iconBtn} title="Delete milestone">{'✕'}</button>
          </div>
        )}
      </div>

      {expanded && (
        <div style={styles.taskList}>
          {tasks.map(t => (
            editingTaskId === t.id ? (
              <TaskInlineForm key={t.id} form={taskForm} setForm={setTaskForm} onSubmit={onTaskSubmit} onCancel={onCancelTaskForm} editing />
            ) : (
              <RoadmapTaskRow key={t.id} task={t} isAdmin={isAdmin} onToggle={() => onToggleTask(t)} onEdit={() => onOpenEditTask(t)} onDelete={() => onDeleteTask(t)} />
            )
          ))}
          {addingTask ? (
            <TaskInlineForm form={taskForm} setForm={setTaskForm} onSubmit={onTaskSubmit} onCancel={onCancelTaskForm} />
          ) : (
            isAdmin && <button onClick={() => onOpenCreateTask(ms.id)} style={styles.addRowBtnSm}>+ Task</button>
          )}
        </div>
      )}
      {/* When collapsed but user wants to add first task */}
      {!expanded && isAdmin && tasks.length === 0 && (
        addingTask ? (
          <div style={styles.taskList}>
            <TaskInlineForm form={taskForm} setForm={setTaskForm} onSubmit={onTaskSubmit} onCancel={onCancelTaskForm} />
          </div>
        ) : (
          <div style={{ paddingLeft: '30px' }}>
            <button onClick={() => onOpenCreateTask(ms.id)} style={styles.addRowBtnSm}>+ Task</button>
          </div>
        )
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Task row
// ════════════════════════════════════════════════════════════
function RoadmapTaskRow({ task, isAdmin, onToggle, onEdit, onDelete }) {
  const isDone = !!task.completed_at;
  const dl = formatDeadline(task.due_date);
  return (
    <div style={styles.taskRow}>
      <button
        onClick={onToggle}
        disabled={!isAdmin}
        style={{ ...styles.checkBtn, cursor: isAdmin ? 'pointer' : 'default' }}
        title={isAdmin ? (isDone ? 'Mark incomplete' : 'Mark complete') : undefined}
      >
        <span style={{ ...styles.checkBox, ...(isDone ? styles.checkBoxDone : {}) }}>{isDone ? '✓' : ''}</span>
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: '13px', color: isDone ? 'rgba(255,255,255,0.4)' : '#e2e8f0', textDecoration: isDone ? 'line-through' : 'none' }}>{task.title}</span>
        {task.description && (
          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.45)', marginTop: '2px', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{task.description}</div>
        )}
      </div>
      {task.due_date && dl && (
        <span style={{ ...styles.dateChip, color: dl.color }} title={formatDate(task.due_date)}>{formatDateShort(task.due_date)}</span>
      )}
      {isAdmin && (
        <div style={styles.rowActions}>
          <button onClick={onEdit} style={styles.iconBtn} title="Edit task">{'✎'}</button>
          <button onClick={onDelete} style={styles.iconBtn} title="Delete task">{'✕'}</button>
        </div>
      )}
    </div>
  );
}

function TaskInlineForm({ form, setForm, onSubmit, onCancel, editing }) {
  return (
    <form onSubmit={onSubmit} style={styles.taskInlineForm}>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={form.title}
          onChange={e => setForm({ ...form, title: e.target.value })}
          placeholder="Task title"
          autoFocus
          style={{ ...styles.input, flex: 1, minWidth: '160px' }}
        />
        <input
          type="date"
          value={form.due_date}
          onChange={e => setForm({ ...form, due_date: e.target.value })}
          style={{ ...styles.input, colorScheme: 'dark' }}
        />
      </div>
      <textarea
        value={form.description}
        onChange={e => setForm({ ...form, description: e.target.value })}
        placeholder="Description (optional)"
        rows={2}
        style={{ ...styles.input, width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
      />
      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={styles.subtleBtn}>Cancel</button>
        <button type="submit" style={styles.primaryBtn}>{editing ? 'Save' : 'Add'}</button>
      </div>
    </form>
  );
}

// ════════════════════════════════════════════════════════════
// Roadmap form modal
// ════════════════════════════════════════════════════════════
function RoadmapFormModal({ form, setForm, editing, onSubmit, onCancel }) {
  return (
    <div style={styles.modalOverlay} {...backdropDismiss(onCancel)}>
      <div style={{ ...styles.modal, borderColor: colors.accentA30 }} onClick={e => e.stopPropagation()}>
        <div style={{ ...styles.modalTitle, color: colors.accentFg }}>{editing ? 'Edit Roadmap' : 'New Roadmap'}</div>
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={styles.formLabel}>Name</label>
            <input
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="e.g., Neptune Performance buildout"
              autoFocus
              style={{ ...styles.input, width: '100%', marginTop: '4px' }}
            />
          </div>
          <div style={styles.formRow}>
            <div style={{ flex: 1, minWidth: '160px' }}>
              <label style={styles.formLabel}>Deadline Name</label>
              <input
                value={form.deadline_name}
                onChange={e => setForm({ ...form, deadline_name: e.target.value })}
                placeholder="e.g., Grand opening"
                style={{ ...styles.input, width: '100%', marginTop: '4px' }}
              />
            </div>
            <div>
              <label style={styles.formLabel}>Deadline Date</label>
              <input
                type="date"
                value={form.deadline_date}
                onChange={e => setForm({ ...form, deadline_date: e.target.value })}
                style={{ ...styles.input, marginTop: '4px', colorScheme: 'dark', display: 'block' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
            <button type="button" onClick={onCancel} style={styles.subtleBtn}>Cancel</button>
            <button type="submit" style={styles.primaryBtn}>{editing ? 'Save' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// BD Goals — preserved verbatim from the previous page
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
                                        <span style={{ display: 'inline-block', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>{'▶'}</span>
                                        {' '}{children.length} monthly goal{children.length !== 1 ? 's' : ''}
                                      </button>
                                    )}
                                    <button onClick={() => onCreateMonthly(g.id)} style={{ ...styles.iconBtn, fontSize: '11px', color: colors.accentFg }}>+ Monthly</button>
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
      <div {...clickableKeyProps(onToggleExpand)} style={styles.bdGoalsHeader} onClick={onToggleExpand}>
        <span style={{ ...styles.workstreamCaret, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>{'▶'}</span>
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
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onAdd();
                if (e.key === 'Escape') { setInputOpen(false); setDraft(''); }
              }}
              placeholder="Add a note..."
              style={{ ...styles.input, flex: 1 }}
              autoFocus
            />
            <button onClick={onAdd} disabled={!draft.trim()} style={{ ...styles.primaryBtn, opacity: draft.trim() ? 1 : 0.4 }}>Add</button>
            <button onClick={() => { setInputOpen(false); setDraft(''); }} style={styles.subtleBtn}>Cancel</button>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {notes.map((n) => (
            <div
              key={n.id}
              style={{
                ...styles.bdGoalCard,
                padding: '8px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <input
                type="checkbox"
                checked={n.checked}
                onChange={() => onToggle(n.id)}
                style={{ width: '14px', height: '14px', cursor: 'pointer', accentColor: '#5b8fc7' }}
              />
              {editingId === n.id ? (
                <input
                  value={editingText}
                  onChange={(e) => setEditingText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onSaveEdit(n.id);
                    if (e.key === 'Escape') { setEditingId(null); setEditingText(''); }
                  }}
                  style={{ ...styles.input, flex: 1 }}
                  autoFocus
                />
              ) : (
                <span
                  style={{ flex: 1, fontSize: '13px', color: colors.textBright, textDecoration: n.checked ? 'line-through' : 'none', opacity: n.checked ? 0.45 : 1, cursor: 'text' }}
                  onDoubleClick={() => { setEditingId(n.id); setEditingText(n.text); }}
                  title="Double-click to edit"
                >
                  {n.text}
                </span>
              )}
              <button onClick={() => onDelete(n.id)} style={{ ...styles.iconBtn, color: colors.danger.fg }} title="Delete">{'✕'}</button>
            </div>
          ))}
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
          <div {...dragHandleProps} style={{ color: 'rgba(255,255,255,0.2)', fontSize: '14px', cursor: 'grab', userSelect: 'none', lineHeight: 1 }} title="Drag to reorder">{'⠿'}</div>
        )}
        {isCheckbox && (
          <button onClick={() => onToggleCheckbox && onToggleCheckbox(goal)} style={current >= 1 ? styles.bdCheckboxDone : styles.bdCheckbox}>
            {current >= 1 ? '✓' : ''}
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
        <button onClick={onEdit} style={styles.iconBtn} title="Edit">{'✎'}</button>
        <button onClick={onDelete} style={styles.iconBtn} title="Delete">{'✕'}</button>
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
        <button onClick={onEdit} style={styles.iconBtn} title="Edit">{'✎'}</button>
        <button onClick={onDelete} style={styles.iconBtn} title="Delete">{'✕'}</button>
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
      <div style={{ ...styles.modal, borderColor: colors.accentA30 }} onClick={e => e.stopPropagation()}>
        <div style={{ ...styles.modalTitle, color: colors.accentFg }}>{editing ? 'Edit Goal' : 'New Goal'}</div>
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
// Styles
// ════════════════════════════════════════════════════════════
const styles = {
  page: { padding: '36px 40px 64px', maxWidth: '1500px', margin: '0 auto', color: '#e2e8f0', fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif" },
  loading: { color: 'rgba(255,255,255,0.5)', fontSize: '14px', padding: '60px 20px', textAlign: 'center' },

  pageHeader: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: '20px', marginBottom: '14px',
  },
  pageTitle: { margin: 0, fontSize: '24px', fontWeight: 700, color: '#fff', letterSpacing: '-0.4px' },
  pageSubtitle: { margin: '4px 0 0', fontSize: '13px', color: 'rgba(255,255,255,0.45)' },

  // Roadmap list
  roadmapList: { display: 'flex', flexDirection: 'column', gap: '12px' },
  roadmapCard: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '14px',
    overflow: 'hidden',
  },
  roadmapHeader: {
    display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px',
    background: 'rgba(255,255,255,0.025)',
  },
  roadmapName: { fontSize: '15px', fontWeight: 700, color: '#fff', letterSpacing: '-0.2px' },
  roadmapDeadlineRow: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '3px', flexWrap: 'wrap' },
  roadmapDeadlineName: { fontSize: '12px', color: 'rgba(255,255,255,0.6)', fontWeight: 600 },
  roadmapDeadlineDate: { fontSize: '12px', color: 'rgba(255,255,255,0.45)' },
  roadmapCountdown: { fontSize: '11px', fontWeight: 600 },
  roadmapPctWrap: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 },
  roadmapPct: { fontSize: '14px', fontWeight: 700 },
  roadmapPctSub: { fontSize: '10px', color: 'rgba(255,255,255,0.4)', fontWeight: 500 },
  roadmapBody: { padding: '8px 18px 18px', display: 'flex', flexDirection: 'column', gap: '6px' },

  // Milestone
  milestoneWrap: {
    background: 'rgba(255,255,255,0.025)',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '8px', padding: '8px 12px',
  },
  milestoneRow: { display: 'flex', alignItems: 'center', gap: '8px' },
  taskList: { marginTop: '8px', paddingTop: '8px', paddingLeft: '6px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: '4px' },
  taskRow: { display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '4px 0' },
  taskCounter: {
    fontSize: '11px', color: 'rgba(34,197,94,0.8)', fontWeight: 600,
    background: 'rgba(34,197,94,0.08)', padding: '2px 8px',
    borderRadius: '6px', flexShrink: 0,
  },
  dateChip: {
    fontSize: '11px', fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap',
    background: 'rgba(255,255,255,0.04)', padding: '2px 8px', borderRadius: '6px',
  },

  // Carets / row actions
  caretBtn: {
    background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.55)',
    cursor: 'pointer', padding: '4px 6px', fontSize: '11px', fontFamily: 'inherit', flexShrink: 0,
  },
  caretBtnSm: {
    background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)',
    cursor: 'pointer', padding: '2px 4px', fontSize: '10px', fontFamily: 'inherit', flexShrink: 0,
    width: '18px',
  },
  rowActions: { display: 'flex', gap: '2px', alignItems: 'center', flexShrink: 0 },
  iconBtn: {
    background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)',
    cursor: 'pointer', padding: '4px 6px', borderRadius: '4px',
    fontSize: '12px', fontFamily: 'inherit',
  },
  addRowBtn: {
    alignSelf: 'flex-start', marginTop: '2px',
    background: 'transparent', border: '1px dashed rgba(255,255,255,0.15)',
    borderRadius: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', padding: '6px 12px',
  },
  addRowBtnSm: {
    alignSelf: 'flex-start',
    background: 'transparent', border: 'none',
    color: colors.accentFg, fontSize: '12px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', padding: '4px 6px',
  },

  // Inline forms
  inlineForm: {
    display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap',
    background: colors.accentA04, border: '1px solid rgba(91, 143, 199,0.15)',
    borderRadius: '8px', padding: '10px', marginTop: '2px',
  },
  taskInlineForm: {
    display: 'flex', flexDirection: 'column', gap: '6px',
    background: colors.accentA04, border: '1px solid rgba(91, 143, 199,0.15)',
    borderRadius: '8px', padding: '10px', marginTop: '2px',
  },

  // Checkboxes (tasks reuse the small square; milestones reuse bdCheckbox)
  checkBtn: { background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, marginTop: '1px', flexShrink: 0 },
  checkBox: {
    width: '16px', height: '16px', border: '1.5px solid rgba(255,255,255,0.3)',
    borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#22c55e', fontSize: '12px', fontWeight: 700,
  },
  checkBoxDone: { background: 'rgba(34,197,94,0.18)', borderColor: '#22c55e' },

  // Forms
  formLabel: {
    fontSize: '12px', fontWeight: 700, color: colors.accentFg,
    letterSpacing: '0.5px', textTransform: 'uppercase',
  },
  formRow: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-start' },
  input: {
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px', padding: '8px 12px', color: '#e2e8f0',
    fontSize: '13px', fontFamily: 'inherit', outline: 'none',
  },
  primaryBtn: {
    padding: '8px 14px', background: colors.accentSoft,
    border: '1px solid rgba(91, 143, 199,0.35)', borderRadius: '8px',
    color: colors.accentFg, fontSize: '12px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  subtleBtn: {
    padding: '6px 10px', background: 'transparent',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
    color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  empty: { color: 'rgba(255,255,255,0.3)', fontSize: '12px', fontStyle: 'italic', padding: '8px 10px' },

  // Modal
  modalOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 200, backdropFilter: 'blur(2px)',
  },
  modal: {
    background: colors.bgHover, border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: '14px', padding: '20px 24px', minWidth: '420px', maxWidth: '560px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
  },
  modalTitle: {
    fontSize: '15px', fontWeight: 700, color: '#fca5a5',
    textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px',
  },

  // BD Goals (preserved)
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
    background: colors.accentA15, borderColor: colors.accentA40, color: colors.accentFg,
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
    background: colors.accentA12, color: colors.accentFg,
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
    background: colors.accentA15, borderColor: colors.accentA40, color: colors.accentFg,
  },
  workstreamCaret: { fontSize: '10px', color: 'rgba(255,255,255,0.4)', transition: 'transform 0.15s', display: 'inline-block' },
};
