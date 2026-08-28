import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { toast } from '../contexts/ToastContext';
import { mobileTokens } from '../utils/mobileTokens';
import { colors } from '../lib/styleTokens';
import { ROADMAP_COLORS, roadmapPalette, nextRoadmapColor } from '../lib/roadmapColors';
import { fetchAllRows } from './analytics/utils';

// Mobile companion for the Roadmap page. Full parity on the core rebuild:
// Roadmap → Milestone → Task with add/edit/delete + check-off (the
// milestone→tasks cascade is enforced server-side, reflected on refetch).
// Goals and Notes are stacked below the roadmaps (admin only). Goal
// creation / metric-goal editing stays on desktop — the mobile Goals
// section is view + check-off + delete, mirroring the original mobile
// page's "full edit forms desktop-only" posture.

function parseDateLocal(dateStr) { return dateStr ? new Date(dateStr + 'T00:00:00') : null; }
function fmtShortDate(date) {
  if (!date) return null;
  return parseDateLocal(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtCountdown(date) {
  if (!date) return null;
  const target = parseDateLocal(date);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const days = Math.ceil((target - now) / 86400000);
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, color: '#ef4444' };
  if (days === 0) return { label: 'Due today', color: '#f59e0b' };
  if (days <= 14) return { label: `${days}d left`, color: '#f59e0b' };
  return { label: `${days}d left`, color: 'rgba(255,255,255,0.5)' };
}
function progressColor(pct) {
  const r = Math.round(0x86 + (0x16 - 0x86) * pct);
  const g = Math.round(0xef + (0xa3 - 0xef) * pct);
  const b = Math.round(0xac + (0x4a - 0xac) * pct);
  return `rgb(${r},${g},${b})`;
}
function getDateRangeForCategory(category) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  if (category === 'quarterly') {
    const qStart = new Date(year, Math.floor(month / 3) * 3, 1);
    return { start: qStart.toISOString().split('T')[0], end: now.toISOString().split('T')[0] };
  }
  if (category === 'none') return { start: '2020-01-01', end: now.toISOString().split('T')[0] };
  return { start: `${year}-01-01`, end: now.toISOString().split('T')[0] };
}
function formatMetricValue(key, value) {
  if (key === 'watch_time_seconds') return Math.round(value / 3600).toLocaleString() + 'h';
  return Math.round(value).toLocaleString();
}
const METRIC_LABELS = { views: 'Views', likes: 'Likes', comments: 'Comments', shares: 'Shares', watch_time_seconds: 'Watch Time' };
const CATEGORY_GROUPS = [
  { key: 'quarterly', label: 'Quarterly' },
  { key: 'yearly', label: 'Yearly' },
  { key: 'none', label: 'No Timeframe' },
];

const EMPTY_ROADMAP = { name: '', deadline_name: '', deadline_date: '', color: ROADMAP_COLORS[0].key };
const EMPTY_MILESTONE = { title: '', target_date: '' };
const EMPTY_TASK = { title: '', description: '', due_date: '' };

export default function BusinessDevMobile() {
  const { profile, isAdmin, isPartner } = useAuth();
  const confirm = useConfirm();

  const [roadmaps, setRoadmaps] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  const [expandedRoadmaps, setExpandedRoadmaps] = useState({});
  const [expandedMilestones, setExpandedMilestones] = useState({});

  // Roadmap modal
  const [roadmapModalOpen, setRoadmapModalOpen] = useState(false);
  const [editingRoadmapId, setEditingRoadmapId] = useState(null);
  const [roadmapForm, setRoadmapForm] = useState(EMPTY_ROADMAP);

  // Inline milestone/task forms
  const [milestoneFormFor, setMilestoneFormFor] = useState(null);
  const [editingMilestoneId, setEditingMilestoneId] = useState(null);
  const [milestoneForm, setMilestoneForm] = useState(EMPTY_MILESTONE);
  const [taskFormFor, setTaskFormFor] = useState(null);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [taskForm, setTaskForm] = useState(EMPTY_TASK);

  // Goals + Notes (admin only)
  const [bdGoals, setBdGoals] = useState([]);
  const [bdRollupData, setBdRollupData] = useState({});
  const [bdNotes, setBdNotes] = useState([]);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteInputOpen, setNoteInputOpen] = useState(false);

  // ── Fetch roadmap tree ──
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rmRes, msRows, taskRows] = await Promise.all([
        supabase.from('roadmaps').select('*').order('position').order('created_at'),
        fetchAllRows(supabase.from('roadmap_milestones').select('*').order('position').order('created_at')),
        fetchAllRows(supabase.from('roadmap_tasks').select('*').order('position').order('created_at')),
      ]);
      const rms = rmRes.data || [];
      setRoadmaps(rms);
      setMilestones(msRows || []);
      setTasks(taskRows || []);
      setExpandedRoadmaps((prev) => {
        if (Object.keys(prev).length > 0) return prev;
        if (rms.length === 1) return { [rms[0].id]: true };
        return prev;
      });
    } catch (err) {
      console.error('Roadmap mobile fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (profile?.id && (isAdmin || isPartner)) fetchAll(); }, [profile?.id, isAdmin, isPartner, fetchAll]);

  // ── Fetch Goals + Notes (admin only) ──
  const fetchGoals = useCallback(async () => {
    if (!profile?.id) return;
    const gRes = await supabase.from('goals').select('*').eq('scope', 'bd').eq('created_by', profile.id)
      .order('position', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
    const goals = gRes.data || [];
    setBdGoals(goals);
    // Metric rollups
    const metricGoals = goals.filter((g) => g.goal_type === 'metric');
    if (!metricGoals.length) { setBdRollupData({}); return; }
    const allAccountIds = [...new Set(metricGoals.flatMap((g) => g.platform_account_ids || []))];
    if (!allAccountIds.length) { setBdRollupData({}); return; }
    const yearRange = getDateRangeForCategory('yearly');
    const noneRange = getDateRangeForCategory('none');
    const start = metricGoals.some((g) => g.category === 'none') ? noneRange.start : yearRange.start;
    const rollups = await fetchAllRows(supabase.from('platform_daily_metrics').select('*')
      .gte('date', start).lte('date', yearRange.end).in('platform_account_id', allAccountIds));
    const result = {};
    for (const goal of metricGoals) {
      const range = getDateRangeForCategory(goal.category);
      const ids = goal.platform_account_ids || [];
      const filtered = (rollups || []).filter((r) => ids.includes(r.platform_account_id) && r.date >= range.start && r.date <= range.end);
      const sums = {};
      for (const m of (goal.metrics || [])) sums[m] = filtered.reduce((acc, r) => acc + (Number(r[m]) || 0), 0);
      result[goal.id] = sums;
    }
    setBdRollupData(result);
  }, [profile?.id]);

  const fetchNotes = useCallback(async () => {
    if (!profile?.id) return;
    await supabase.from('bd_user_notes').delete().eq('user_id', profile.id).eq('checked', true);
    const { data } = await supabase.from('bd_user_notes').select('*').eq('user_id', profile.id).order('position');
    setBdNotes(data || []);
  }, [profile?.id]);

  useEffect(() => { if (profile?.id && isAdmin) { fetchGoals(); fetchNotes(); } }, [profile?.id, isAdmin, fetchGoals, fetchNotes]);

  // ── Derived ──
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

  // ── Roadmap CRUD ──
  function openCreateRoadmap() { setEditingRoadmapId(null); setRoadmapForm({ ...EMPTY_ROADMAP, color: nextRoadmapColor(roadmaps) }); setRoadmapModalOpen(true); }
  function openEditRoadmap(rm) {
    setEditingRoadmapId(rm.id);
    setRoadmapForm({ name: rm.name, deadline_name: rm.deadline_name || '', deadline_date: rm.deadline_date || '', color: roadmapPalette(rm, roadmaps.indexOf(rm)).key });
    setRoadmapModalOpen(true);
  }
  async function submitRoadmap(e) {
    e.preventDefault();
    const name = roadmapForm.name.trim();
    if (!name) { toast.error('Name is required.'); return; }
    const payload = { name, deadline_name: roadmapForm.deadline_name.trim() || null, deadline_date: roadmapForm.deadline_date || null, color: roadmapForm.color || ROADMAP_COLORS[0].key };
    if (editingRoadmapId) {
      const { error } = await supabase.from('roadmaps').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editingRoadmapId);
      if (error) { toast.error(error.message); return; }
    } else {
      const nextPos = roadmaps.length ? Math.max(...roadmaps.map((r) => r.position || 0)) + 1 : 0;
      const { data, error } = await supabase.from('roadmaps').insert({ ...payload, position: nextPos }).select().single();
      if (error) { toast.error(error.message); return; }
      if (data) setExpandedRoadmaps((prev) => ({ ...prev, [data.id]: true }));
    }
    setRoadmapModalOpen(false);
    fetchAll();
  }
  async function deleteRoadmap(rm) {
    const n = (milestonesByRoadmap[rm.id] || []).length;
    if (!(await confirm(n ? `Delete "${rm.name}" and its ${n} milestone${n !== 1 ? 's' : ''}?` : `Delete "${rm.name}"?`))) return;
    const { error } = await supabase.from('roadmaps').delete().eq('id', rm.id);
    if (error) { toast.error(error.message); return; }
    fetchAll();
  }

  // ── Milestone CRUD ──
  function openCreateMilestone(roadmapId) { setEditingMilestoneId(null); setMilestoneForm(EMPTY_MILESTONE); setMilestoneFormFor(roadmapId); }
  function openEditMilestone(ms) { setEditingMilestoneId(ms.id); setMilestoneForm({ title: ms.title, target_date: ms.target_date || '' }); setMilestoneFormFor(ms.roadmap_id); }
  function cancelMilestone() { setMilestoneFormFor(null); setEditingMilestoneId(null); setMilestoneForm(EMPTY_MILESTONE); }
  async function submitMilestone(e) {
    e.preventDefault();
    const title = milestoneForm.title.trim();
    if (!title) return;
    const payload = { title, target_date: milestoneForm.target_date || null };
    if (editingMilestoneId) {
      const { error } = await supabase.from('roadmap_milestones').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editingMilestoneId);
      if (error) { toast.error(error.message); return; }
    } else {
      const sibs = milestonesByRoadmap[milestoneFormFor] || [];
      const nextPos = sibs.length ? Math.max(...sibs.map((s) => s.position || 0)) + 1 : 0;
      const { error } = await supabase.from('roadmap_milestones').insert({ ...payload, roadmap_id: milestoneFormFor, position: nextPos });
      if (error) { toast.error(error.message); return; }
    }
    cancelMilestone();
    fetchAll();
  }
  async function toggleMilestone(ms) {
    if (!isAdmin) return;
    const done = !!ms.completed_at;
    const now = new Date().toISOString();
    const { error } = await supabase.from('roadmap_milestones').update({ completed_at: done ? null : now, updated_at: now }).eq('id', ms.id);
    if (error) { toast.error(error.message); return; }
    fetchAll(); // reflect milestone→tasks cascade
  }
  async function deleteMilestone(ms) {
    const n = (tasksByMilestone[ms.id] || []).length;
    if (!(await confirm(n ? `Delete "${ms.title}" and its ${n} task${n !== 1 ? 's' : ''}?` : `Delete "${ms.title}"?`))) return;
    const { error } = await supabase.from('roadmap_milestones').delete().eq('id', ms.id);
    if (error) { toast.error(error.message); return; }
    fetchAll();
  }

  // ── Task CRUD ──
  function openCreateTask(milestoneId) { setEditingTaskId(null); setTaskForm(EMPTY_TASK); setTaskFormFor(milestoneId); setExpandedMilestones((prev) => ({ ...prev, [milestoneId]: true })); }
  function openEditTask(t) { setEditingTaskId(t.id); setTaskForm({ title: t.title, description: t.description || '', due_date: t.due_date || '' }); setTaskFormFor(t.milestone_id); }
  function cancelTask() { setTaskFormFor(null); setEditingTaskId(null); setTaskForm(EMPTY_TASK); }
  async function submitTask(e) {
    e.preventDefault();
    const title = taskForm.title.trim();
    if (!title) return;
    const payload = { title, description: taskForm.description.trim() || null, due_date: taskForm.due_date || null };
    if (editingTaskId) {
      const { error } = await supabase.from('roadmap_tasks').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editingTaskId);
      if (error) { toast.error(error.message); return; }
    } else {
      const sibs = tasksByMilestone[taskFormFor] || [];
      const nextPos = sibs.length ? Math.max(...sibs.map((s) => s.position || 0)) + 1 : 0;
      const { error } = await supabase.from('roadmap_tasks').insert({ ...payload, milestone_id: taskFormFor, position: nextPos });
      if (error) { toast.error(error.message); return; }
    }
    cancelTask();
    fetchAll();
  }
  async function toggleTask(t) {
    if (!isAdmin) return;
    const done = !!t.completed_at;
    const now = new Date().toISOString();
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, completed_at: done ? null : now } : x)));
    const { error } = await supabase.from('roadmap_tasks').update({ completed_at: done ? null : now, updated_at: now }).eq('id', t.id);
    if (error) { toast.error(error.message); fetchAll(); }
  }
  async function deleteTask(t) {
    if (!(await confirm('Delete this task?'))) return;
    const { error } = await supabase.from('roadmap_tasks').delete().eq('id', t.id);
    if (error) { toast.error(error.message); return; }
    setTasks((prev) => prev.filter((x) => x.id !== t.id));
  }

  // ── Goals (view + toggle + delete) ──
  async function toggleGoalCheckbox(goal) {
    const done = (goal.current_value || 0) >= 1;
    const now = new Date().toISOString();
    const { error } = await supabase.from('goals').update({ current_value: done ? 0 : 1, completed_at: done ? null : now, updated_at: now }).eq('id', goal.id);
    if (error) { toast.error(error.message); return; }
    fetchGoals();
  }
  async function deleteGoal(goal) {
    if (!(await confirm('Delete this goal?'))) return;
    await supabase.from('goals').delete().eq('id', goal.id);
    fetchGoals();
  }

  // ── Notes CRUD ──
  async function addNote() {
    const text = noteDraft.trim();
    if (!text || !profile?.id) return;
    const nextPos = bdNotes.length ? Math.max(...bdNotes.map((n) => n.position || 0)) + 1 : 0;
    const { data, error } = await supabase.from('bd_user_notes').insert({ user_id: profile.id, text, checked: false, position: nextPos }).select().single();
    if (error) { toast.error(error.message); return; }
    setBdNotes((prev) => [...prev, data]);
    setNoteDraft(''); setNoteInputOpen(false);
  }
  async function toggleNote(n) {
    const next = !n.checked;
    setBdNotes((prev) => prev.map((x) => (x.id === n.id ? { ...x, checked: next } : x)));
    const { error } = await supabase.from('bd_user_notes').update({ checked: next, updated_at: new Date().toISOString() }).eq('id', n.id);
    if (error) setBdNotes((prev) => prev.map((x) => (x.id === n.id ? { ...x, checked: n.checked } : x)));
  }
  async function deleteNote(n) {
    setBdNotes((prev) => prev.filter((x) => x.id !== n.id));
    await supabase.from('bd_user_notes').delete().eq('id', n.id);
  }

  if (loading) return <p style={styles.empty}>Loading…</p>;
  if (!isAdmin && !isPartner) return <p style={styles.empty}>Access restricted.</p>;

  return (
    <div style={styles.root}>
      <div style={styles.pageHeader}>
        <span style={styles.pageTitle}>Roadmap</span>
        {isAdmin && <button onClick={openCreateRoadmap} style={styles.primaryBtn}>+ Roadmap</button>}
      </div>

      {roadmaps.length === 0 && <p style={styles.empty}>{isAdmin ? 'No roadmaps yet. Tap + Roadmap.' : 'No roadmaps yet.'}</p>}

      {roadmaps.map((rm, rmIdx) => {
        const palette = roadmapPalette(rm, rmIdx);
        const isOpen = expandedRoadmaps[rm.id];
        const rmMilestones = milestonesByRoadmap[rm.id] || [];
        const done = rmMilestones.filter((m) => m.completed_at).length;
        const pct = rmMilestones.length ? done / rmMilestones.length : 0;
        const countdown = fmtCountdown(rm.deadline_date);
        const addingMilestone = milestoneFormFor === rm.id && !editingMilestoneId;

        return (
          <section key={rm.id} style={{ ...styles.roadmapCard, borderLeft: `3px solid ${palette.fg}` }}>
            <div style={{ ...styles.roadmapHeader, background: palette.soft }}>
              <button onClick={() => setExpandedRoadmaps((prev) => ({ ...prev, [rm.id]: !prev[rm.id] }))} style={styles.roadmapHeaderBtn}>
                <div style={styles.roadmapHeaderTop}>
                  <span style={styles.roadmapNameWrap}>
                    <span style={{ ...styles.roadmapDot, background: palette.fg }} />
                    <span style={styles.roadmapName}>{rm.name}</span>
                  </span>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ transform: isOpen ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform 0.15s', color: 'rgba(255,255,255,0.5)', flexShrink: 0 }}>
                    <path d="M3 6l5 5 5-5z" />
                  </svg>
                </div>
                {(rm.deadline_name || rm.deadline_date) && (
                  <div style={styles.roadmapDeadline}>
                    {rm.deadline_name && <span style={{ color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>{rm.deadline_name}</span>}
                    {rm.deadline_date && <span style={{ color: 'rgba(255,255,255,0.45)' }}>{fmtShortDate(rm.deadline_date)}</span>}
                    {countdown && <span style={{ color: countdown.color, fontWeight: 600 }}>{countdown.label}</span>}
                  </div>
                )}
                {rmMilestones.length > 0 && (
                  <>
                    <div style={styles.progressTrack}><div style={{ ...styles.progressFill, width: `${pct * 100}%`, background: progressColor(pct) }} /></div>
                    <div style={styles.roadmapMeta}>{done}/{rmMilestones.length} milestones</div>
                  </>
                )}
              </button>
              {isAdmin && (
                <div style={styles.rowActions}>
                  <button onClick={() => openEditRoadmap(rm)} style={styles.iconBtn} aria-label="Edit">{'✎'}</button>
                  <button onClick={() => deleteRoadmap(rm)} style={styles.iconBtn} aria-label="Delete">{'✕'}</button>
                </div>
              )}
            </div>

            {isOpen && (
              <div style={styles.roadmapBody}>
                {rmMilestones.length === 0 && !addingMilestone && <p style={styles.emptySm}>No milestones yet.</p>}
                {rmMilestones.map((ms) => (
                  <MilestoneBlock
                    key={ms.id}
                    ms={ms}
                    tasks={tasksByMilestone[ms.id] || []}
                    isAdmin={isAdmin}
                    expanded={!!expandedMilestones[ms.id]}
                    onToggleExpand={() => setExpandedMilestones((prev) => ({ ...prev, [ms.id]: !prev[ms.id] }))}
                    onToggle={() => toggleMilestone(ms)}
                    onEdit={() => openEditMilestone(ms)}
                    onDelete={() => deleteMilestone(ms)}
                    editingMilestone={editingMilestoneId === ms.id}
                    milestoneForm={milestoneForm}
                    setMilestoneForm={setMilestoneForm}
                    onSubmitMilestone={submitMilestone}
                    onCancelMilestone={cancelMilestone}
                    taskFormFor={taskFormFor}
                    editingTaskId={editingTaskId}
                    taskForm={taskForm}
                    setTaskForm={setTaskForm}
                    onOpenCreateTask={openCreateTask}
                    onOpenEditTask={openEditTask}
                    onSubmitTask={submitTask}
                    onCancelTask={cancelTask}
                    onToggleTask={toggleTask}
                    onDeleteTask={deleteTask}
                  />
                ))}
                {addingMilestone ? (
                  <form onSubmit={submitMilestone} style={styles.inlineForm}>
                    <input value={milestoneForm.title} onChange={(e) => setMilestoneForm({ ...milestoneForm, title: e.target.value })} placeholder="Milestone title" autoFocus style={styles.input} />
                    <input type="date" value={milestoneForm.target_date} onChange={(e) => setMilestoneForm({ ...milestoneForm, target_date: e.target.value })} style={{ ...styles.input, colorScheme: 'dark' }} />
                    <div style={styles.inlineFormActions}>
                      <button type="button" onClick={cancelMilestone} style={styles.subtleBtn}>Cancel</button>
                      <button type="submit" style={styles.primaryBtn}>Add</button>
                    </div>
                  </form>
                ) : (
                  isAdmin && <button onClick={() => openCreateMilestone(rm.id)} style={styles.addRowBtn}>+ Milestone</button>
                )}
              </div>
            )}
          </section>
        );
      })}

      {/* ── Goals (admin only) ── */}
      {isAdmin && (
        <section style={styles.stackSection}>
          <div style={styles.stackHeader}><span style={styles.stackTitle}>Goals</span><span style={styles.stackCount}>{bdGoals.length}</span></div>
          {bdGoals.length === 0 && <p style={styles.emptySm}>No goals yet. Add goals on desktop.</p>}
          {CATEGORY_GROUPS.map((grp) => {
            const items = bdGoals.filter((g) => g.category === grp.key);
            if (!items.length) return null;
            return (
              <div key={grp.key} style={{ marginTop: 4 }}>
                <div style={styles.groupLabel}>{grp.label}</div>
                {items.map((g) => <GoalCard key={g.id} goal={g} rollupData={bdRollupData} onToggle={() => toggleGoalCheckbox(g)} onDelete={() => deleteGoal(g)} />)}
              </div>
            );
          })}
          <p style={styles.stackFooter}>Create & edit goals on desktop.</p>
        </section>
      )}

      {/* ── Notes (admin only) ── */}
      {isAdmin && (
        <section style={styles.stackSection}>
          <div style={styles.stackHeader}>
            <span style={styles.stackTitle}>Notes</span>
            <span style={styles.stackCount}>{bdNotes.length}</span>
            <div style={{ flex: 1 }} />
            {!noteInputOpen && <button onClick={() => setNoteInputOpen(true)} style={styles.primaryBtn}>+ Note</button>}
          </div>
          {noteInputOpen && (
            <div style={styles.inlineForm}>
              <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Add a note…" autoFocus style={styles.input}
                onKeyDown={(e) => { if (e.key === 'Enter') addNote(); if (e.key === 'Escape') { setNoteInputOpen(false); setNoteDraft(''); } }} />
              <div style={styles.inlineFormActions}>
                <button onClick={() => { setNoteInputOpen(false); setNoteDraft(''); }} style={styles.subtleBtn}>Cancel</button>
                <button onClick={addNote} disabled={!noteDraft.trim()} style={{ ...styles.primaryBtn, opacity: noteDraft.trim() ? 1 : 0.4 }}>Add</button>
              </div>
            </div>
          )}
          {bdNotes.length === 0 && !noteInputOpen && <p style={styles.emptySm}>No notes yet.</p>}
          {bdNotes.map((n) => (
            <div key={n.id} style={styles.noteRow}>
              <input type="checkbox" checked={n.checked} onChange={() => toggleNote(n)} style={{ width: 16, height: 16, accentColor: '#5b8fc7' }} />
              <span style={{ flex: 1, fontSize: mobileTokens.font.sm, color: colors.textBright, textDecoration: n.checked ? 'line-through' : 'none', opacity: n.checked ? 0.45 : 1 }}>{n.text}</span>
              <button onClick={() => deleteNote(n)} style={styles.iconBtn} aria-label="Delete">{'✕'}</button>
            </div>
          ))}
        </section>
      )}

      {/* Roadmap create/edit modal */}
      {roadmapModalOpen && (
        <div style={styles.modalOverlay} onClick={() => setRoadmapModalOpen(false)}>
          <div style={styles.modalSheet} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalTitle}>{editingRoadmapId ? 'Edit Roadmap' : 'New Roadmap'}</div>
            <form onSubmit={submitRoadmap} style={{ display: 'flex', flexDirection: 'column', gap: mobileTokens.space.md }}>
              <input value={roadmapForm.name} onChange={(e) => setRoadmapForm({ ...roadmapForm, name: e.target.value })} placeholder="Roadmap name" autoFocus style={styles.input} />
              <input value={roadmapForm.deadline_name} onChange={(e) => setRoadmapForm({ ...roadmapForm, deadline_name: e.target.value })} placeholder="Deadline name (e.g. Grand opening)" style={styles.input} />
              <input type="date" value={roadmapForm.deadline_date} onChange={(e) => setRoadmapForm({ ...roadmapForm, deadline_date: e.target.value })} style={{ ...styles.input, colorScheme: 'dark' }} />
              <div style={styles.swatchRow}>
                {ROADMAP_COLORS.map((c) => {
                  const selected = (roadmapForm.color || ROADMAP_COLORS[0].key) === c.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setRoadmapForm({ ...roadmapForm, color: c.key })}
                      aria-label={c.label}
                      style={{ ...styles.swatch, background: c.soft, borderColor: selected ? c.fg : 'transparent' }}
                    >
                      <span style={{ ...styles.swatchDot, background: c.fg }} />
                    </button>
                  );
                })}
              </div>
              <div style={styles.inlineFormActions}>
                <button type="button" onClick={() => setRoadmapModalOpen(false)} style={styles.subtleBtn}>Cancel</button>
                <button type="submit" style={styles.primaryBtn}>{editingRoadmapId ? 'Save' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function MilestoneBlock(props) {
  const {
    ms, tasks, isAdmin, expanded, onToggleExpand, onToggle, onEdit, onDelete,
    editingMilestone, milestoneForm, setMilestoneForm, onSubmitMilestone, onCancelMilestone,
    taskFormFor, editingTaskId, taskForm, setTaskForm, onOpenCreateTask, onOpenEditTask, onSubmitTask, onCancelTask, onToggleTask, onDeleteTask,
  } = props;

  const isDone = !!ms.completed_at;
  const doneTasks = tasks.filter((t) => t.completed_at).length;
  const cd = fmtCountdown(ms.target_date);
  const addingTask = taskFormFor === ms.id && !editingTaskId;

  if (editingMilestone) {
    return (
      <form onSubmit={onSubmitMilestone} style={styles.inlineForm}>
        <input value={milestoneForm.title} onChange={(e) => setMilestoneForm({ ...milestoneForm, title: e.target.value })} placeholder="Milestone title" autoFocus style={styles.input} />
        <input type="date" value={milestoneForm.target_date} onChange={(e) => setMilestoneForm({ ...milestoneForm, target_date: e.target.value })} style={{ ...styles.input, colorScheme: 'dark' }} />
        <div style={styles.inlineFormActions}>
          <button type="button" onClick={onCancelMilestone} style={styles.subtleBtn}>Cancel</button>
          <button type="submit" style={styles.primaryBtn}>Save</button>
        </div>
      </form>
    );
  }

  return (
    <div style={styles.milestoneCard}>
      <div style={styles.milestoneRow}>
        <button onClick={onToggle} disabled={!isAdmin} style={{ ...styles.check, ...(isDone ? styles.checkDone : {}), cursor: isAdmin ? 'pointer' : 'default' }} aria-label={isDone ? 'Mark incomplete' : 'Complete'}>
          {isDone && <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M2 5l2 2 4-5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </button>
        <button onClick={onToggleExpand} style={styles.milestoneTitleBtn}>
          <span style={{ fontSize: mobileTokens.font.md, fontWeight: 600, color: isDone ? 'rgba(255,255,255,0.45)' : '#fff', textDecoration: isDone ? 'line-through' : 'none', flex: 1, textAlign: 'left', wordBreak: 'break-word' }}>{ms.title}</span>
          {tasks.length > 0 && <span style={styles.taskCounter}>{doneTasks}/{tasks.length}</span>}
        </button>
        {ms.target_date && cd && <span style={{ fontSize: mobileTokens.font.xs, color: cd.color, flexShrink: 0 }}>{fmtShortDate(ms.target_date)}</span>}
        {isAdmin && (
          <div style={styles.rowActions}>
            <button onClick={onEdit} style={styles.iconBtn} aria-label="Edit">{'✎'}</button>
            <button onClick={onDelete} style={styles.iconBtn} aria-label="Delete">{'✕'}</button>
          </div>
        )}
      </div>

      {expanded && (
        <div style={styles.taskList}>
          {tasks.map((t) => (
            editingTaskId === t.id ? (
              <TaskInlineForm key={t.id} form={taskForm} setForm={setTaskForm} onSubmit={onSubmitTask} onCancel={onCancelTask} editing />
            ) : (
              <div key={t.id} style={styles.taskRow}>
                <button onClick={() => onToggleTask(t)} disabled={!isAdmin} style={{ ...styles.check, ...(t.completed_at ? styles.checkDone : {}), cursor: isAdmin ? 'pointer' : 'default', marginTop: 1 }} aria-label={t.completed_at ? 'Mark not done' : 'Mark done'}>
                  {t.completed_at && <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M2 5l2 2 4-5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: mobileTokens.font.sm, color: t.completed_at ? 'rgba(255,255,255,0.45)' : '#e2e8f0', textDecoration: t.completed_at ? 'line-through' : 'none', wordBreak: 'break-word' }}>{t.title}</span>
                  {t.description && <div style={styles.taskDesc}>{t.description}</div>}
                </div>
                {t.due_date && <span style={styles.taskDate}>{fmtShortDate(t.due_date)}</span>}
                {isAdmin && (
                  <div style={styles.rowActions}>
                    <button onClick={() => onOpenEditTask(t)} style={styles.iconBtn} aria-label="Edit">{'✎'}</button>
                    <button onClick={() => onDeleteTask(t)} style={styles.iconBtn} aria-label="Delete">{'✕'}</button>
                  </div>
                )}
              </div>
            )
          ))}
          {addingTask ? (
            <TaskInlineForm form={taskForm} setForm={setTaskForm} onSubmit={onSubmitTask} onCancel={onCancelTask} />
          ) : (
            isAdmin && <button onClick={() => onOpenCreateTask(ms.id)} style={styles.addRowBtnSm}>+ Task</button>
          )}
        </div>
      )}
      {!expanded && isAdmin && tasks.length === 0 && (
        addingTask ? (
          <div style={styles.taskList}><TaskInlineForm form={taskForm} setForm={setTaskForm} onSubmit={onSubmitTask} onCancel={onCancelTask} /></div>
        ) : (
          <button onClick={() => onOpenCreateTask(ms.id)} style={{ ...styles.addRowBtnSm, marginLeft: 28 }}>+ Task</button>
        )
      )}
    </div>
  );
}

function TaskInlineForm({ form, setForm, onSubmit, onCancel, editing }) {
  return (
    <form onSubmit={onSubmit} style={styles.inlineForm}>
      <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Task title" autoFocus style={styles.input} />
      <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description (optional)" rows={2} style={{ ...styles.input, resize: 'vertical', fontFamily: 'inherit' }} />
      <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} style={{ ...styles.input, colorScheme: 'dark' }} />
      <div style={styles.inlineFormActions}>
        <button type="button" onClick={onCancel} style={styles.subtleBtn}>Cancel</button>
        <button type="submit" style={styles.primaryBtn}>{editing ? 'Save' : 'Add'}</button>
      </div>
    </form>
  );
}

function GoalCard({ goal, rollupData, onToggle, onDelete }) {
  const isMetric = goal.goal_type === 'metric';
  const isCheckbox = goal.goal_type === 'checkbox';
  const target = goal.target_value || 1;
  let current = goal.current_value || 0;
  let displayCurrent, displayTarget;
  if (isMetric) {
    const sums = (rollupData || {})[goal.id] || {};
    const keys = goal.metrics || [];
    if (keys.length === 1) { current = sums[keys[0]] || 0; displayCurrent = formatMetricValue(keys[0], current); displayTarget = formatMetricValue(keys[0], target); }
    else { current = keys.reduce((a, k) => a + (sums[k] || 0), 0); displayCurrent = Math.round(current).toLocaleString(); displayTarget = Math.round(target).toLocaleString(); }
  } else { displayCurrent = String(current); displayTarget = String(target); }
  const pct = isCheckbox ? (current >= 1 ? 1 : 0) : Math.min(current / target, 1);
  const pctDisplay = Math.round(pct * 100);

  return (
    <div style={styles.goalCard}>
      <div style={{ display: 'flex', alignItems: 'center', gap: mobileTokens.space.sm }}>
        {isCheckbox && (
          <button onClick={onToggle} style={{ ...styles.check, ...(current >= 1 ? styles.checkDone : {}), cursor: 'pointer' }} aria-label="Toggle">
            {current >= 1 && <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M2 5l2 2 4-5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </button>
        )}
        <span style={{ flex: 1, fontSize: mobileTokens.font.sm, fontWeight: 600, color: isCheckbox && current >= 1 ? 'rgba(255,255,255,0.4)' : '#e2e8f0', textDecoration: isCheckbox && current >= 1 ? 'line-through' : 'none', wordBreak: 'break-word' }}>{goal.title}</span>
        {!isCheckbox && <span style={{ fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.5)' }}>{displayCurrent} / {displayTarget}</span>}
        {!isCheckbox && <span style={{ fontSize: mobileTokens.font.xs, fontWeight: 600, color: progressColor(pct) }}>{pctDisplay}%</span>}
        <button onClick={onDelete} style={styles.iconBtn} aria-label="Delete">{'✕'}</button>
      </div>
      {goal.description && <div style={styles.goalDesc}>{goal.description}</div>}
      {!isCheckbox && <div style={styles.progressTrack}><div style={{ ...styles.progressFill, width: `${pctDisplay}%`, background: progressColor(pct) }} /></div>}
      {isMetric && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
          {(goal.metrics || []).map((mk) => <span key={mk} style={styles.metricTag}>{METRIC_LABELS[mk] || mk}</span>)}
        </div>
      )}
    </div>
  );
}

const styles = {
  root: {
    minHeight: '100%', background: colors.bg, color: '#e2e8f0',
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px ${mobileTokens.space.xxxl}px`,
    display: 'flex', flexDirection: 'column', gap: mobileTokens.space.md,
  },
  pageHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  pageTitle: { fontSize: mobileTokens.font.xl, fontWeight: 700, color: '#fff', letterSpacing: '-0.3px' },
  empty: { color: 'rgba(255,255,255,0.4)', textAlign: 'center', fontSize: mobileTokens.font.md, padding: mobileTokens.space.xxl, margin: 0 },
  emptySm: { color: 'rgba(255,255,255,0.35)', fontSize: mobileTokens.font.sm, fontStyle: 'italic', margin: `${mobileTokens.space.xs}px 0`, padding: '0 4px' },

  primaryBtn: {
    background: colors.accentSoft, border: '1px solid rgba(91, 143, 199,0.35)', borderRadius: mobileTokens.radius.sm,
    color: colors.accentFg, fontSize: mobileTokens.font.sm, fontWeight: 600, fontFamily: 'inherit',
    padding: `${mobileTokens.space.sm}px ${mobileTokens.space.md}px`, cursor: 'pointer', flexShrink: 0,
  },
  subtleBtn: {
    background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', borderRadius: mobileTokens.radius.sm,
    color: 'rgba(255,255,255,0.55)', fontSize: mobileTokens.font.sm, fontWeight: 500, fontFamily: 'inherit',
    padding: `${mobileTokens.space.sm}px ${mobileTokens.space.md}px`, cursor: 'pointer', flexShrink: 0,
  },
  iconBtn: {
    background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer',
    padding: mobileTokens.space.xs, fontSize: mobileTokens.font.md, fontFamily: 'inherit', flexShrink: 0,
  },
  addRowBtn: {
    alignSelf: 'flex-start', background: 'transparent', border: '1px dashed rgba(255,255,255,0.15)',
    borderRadius: mobileTokens.radius.sm, color: 'rgba(255,255,255,0.5)', fontSize: mobileTokens.font.sm, fontWeight: 600,
    fontFamily: 'inherit', padding: `${mobileTokens.space.sm}px ${mobileTokens.space.md}px`, cursor: 'pointer',
  },
  addRowBtnSm: {
    alignSelf: 'flex-start', background: 'transparent', border: 'none',
    color: colors.accentFg, fontSize: mobileTokens.font.sm, fontWeight: 600, fontFamily: 'inherit',
    padding: mobileTokens.space.xs, cursor: 'pointer',
  },
  rowActions: { display: 'flex', gap: 0, alignItems: 'center', flexShrink: 0 },

  // Roadmap
  roadmapCard: { background: 'rgba(255,255,255,0.04)', borderRadius: mobileTokens.radius.lg, overflow: 'hidden' },
  roadmapNameWrap: { display: 'flex', alignItems: 'center', gap: mobileTokens.space.sm, minWidth: 0 },
  roadmapDot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },
  swatchRow: { display: 'flex', gap: mobileTokens.space.sm, flexWrap: 'wrap' },
  swatch: {
    width: '34px', height: '34px', borderRadius: mobileTokens.radius.md,
    border: '1.5px solid transparent', padding: 0, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  swatchDot: { width: '13px', height: '13px', borderRadius: '50%', display: 'block' },
  roadmapHeader: { display: 'flex', alignItems: 'flex-start', gap: mobileTokens.space.xs, padding: mobileTokens.space.md },
  roadmapHeaderBtn: {
    flex: 1, minWidth: 0, background: 'transparent', border: 'none', color: '#e2e8f0', cursor: 'pointer',
    fontFamily: 'inherit', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 6, padding: 0,
  },
  roadmapHeaderTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: mobileTokens.space.sm },
  roadmapName: { fontSize: mobileTokens.font.lg, fontWeight: 700, color: '#fff', letterSpacing: '-0.2px', wordBreak: 'break-word' },
  roadmapDeadline: { display: 'flex', flexWrap: 'wrap', gap: mobileTokens.space.sm, fontSize: mobileTokens.font.xs },
  roadmapMeta: { fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.5)' },
  roadmapBody: {
    padding: `0 ${mobileTokens.space.md}px ${mobileTokens.space.md}px`, display: 'flex', flexDirection: 'column',
    gap: mobileTokens.space.sm, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: mobileTokens.space.md,
  },
  progressTrack: { height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginTop: 4 },
  progressFill: { height: '100%', transition: 'width 0.3s' },

  // Milestone
  milestoneCard: { background: 'rgba(255,255,255,0.03)', borderRadius: mobileTokens.radius.md, padding: mobileTokens.space.sm },
  milestoneRow: { display: 'flex', alignItems: 'center', gap: mobileTokens.space.sm },
  milestoneTitleBtn: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: mobileTokens.space.sm, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 },
  taskCounter: { fontSize: mobileTokens.font.xs, color: 'rgba(34,197,94,0.8)', fontWeight: 600, background: 'rgba(34,197,94,0.08)', padding: '2px 8px', borderRadius: mobileTokens.radius.pill, flexShrink: 0 },
  taskList: { marginTop: mobileTokens.space.sm, paddingTop: mobileTokens.space.sm, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: mobileTokens.space.xs },
  taskRow: { display: 'flex', alignItems: 'flex-start', gap: mobileTokens.space.sm, padding: '2px 0' },
  taskDesc: { fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.45)', marginTop: 2, whiteSpace: 'pre-wrap', lineHeight: 1.4 },
  taskDate: { fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.4)', flexShrink: 0 },

  check: {
    width: 18, height: 18, borderRadius: 4, border: '1.5px solid rgba(255,255,255,0.3)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'transparent',
    background: 'transparent', padding: 0,
  },
  checkDone: { background: '#22c55e', borderColor: '#22c55e', color: '#fff' },

  // Inline forms
  inlineForm: {
    display: 'flex', flexDirection: 'column', gap: mobileTokens.space.sm,
    background: colors.accentA06, border: '1px solid rgba(91, 143, 199,0.18)',
    borderRadius: mobileTokens.radius.md, padding: mobileTokens.space.sm,
  },
  inlineFormActions: { display: 'flex', gap: mobileTokens.space.sm, justifyContent: 'flex-end' },
  input: {
    width: '100%', boxSizing: 'border-box', background: colors.bgInput, border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.sm, padding: `${mobileTokens.space.sm}px ${mobileTokens.space.md}px`,
    color: colors.textBright, fontSize: mobileTokens.font.md, fontFamily: 'inherit', outline: 'none',
  },

  // Stacked Goals / Notes
  stackSection: { background: 'rgba(255,255,255,0.03)', borderRadius: mobileTokens.radius.lg, padding: mobileTokens.space.md, display: 'flex', flexDirection: 'column', gap: mobileTokens.space.xs },
  stackHeader: { display: 'flex', alignItems: 'center', gap: mobileTokens.space.sm },
  stackTitle: { fontSize: mobileTokens.font.md, fontWeight: 700, color: '#fff' },
  stackCount: { fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.4)', fontWeight: 600 },
  stackFooter: { fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.35)', fontStyle: 'italic', margin: `${mobileTokens.space.xs}px 0 0` },
  groupLabel: { fontSize: mobileTokens.font.xs, fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '6px 0 4px' },
  goalCard: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: mobileTokens.radius.sm, padding: mobileTokens.space.sm, marginBottom: mobileTokens.space.xs },
  goalDesc: { fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.55)', marginTop: 4, whiteSpace: 'pre-wrap', lineHeight: 1.4 },
  metricTag: { fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: colors.accentA12, color: colors.accentFg },
  noteRow: { display: 'flex', alignItems: 'center', gap: mobileTokens.space.sm, background: 'rgba(255,255,255,0.04)', borderRadius: mobileTokens.radius.sm, padding: mobileTokens.space.sm },

  // Modal
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 300 },
  modalSheet: {
    width: '100%', maxWidth: 520, background: colors.bgHover, borderTopLeftRadius: mobileTokens.radius.lg, borderTopRightRadius: mobileTokens.radius.lg,
    borderTop: `1px solid ${colors.accentA30}`, padding: mobileTokens.space.lg, paddingBottom: mobileTokens.space.xxl,
    display: 'flex', flexDirection: 'column', gap: mobileTokens.space.md,
  },
  modalTitle: { fontSize: mobileTokens.font.md, fontWeight: 700, color: colors.accentFg, textTransform: 'uppercase', letterSpacing: '0.5px' },
};
