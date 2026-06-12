import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import KanbanPanel from './workflows/KanbanPanel';

// ─── Helpers ────────────────────────────────────────────────

function fmtSnoozeEnd(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs <= 0) return 'now';
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `til ${time}`;
  if (isTomorrow) return `til tmrw ${time}`;
  const within7 = diffMs < 7 * 24 * 3600 * 1000;
  if (within7) return `til ${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  return `til ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

// ─── Component ───────────────────────────────────────────────
export default function Workflows() {
  const { isAdmin, profile } = useAuth();

  // ── Grid + drill-in state ──
  const [drilledView, setDrilledView] = useState(null); // null | { type: 'flow', id } | { type: 'automation', id }
  const [toast, setToast] = useState(null);

  // ── Boards (flows) state ──
  const [boards, setBoards] = useState([]);
  const [boardsLoading, setBoardsLoading] = useState(true);
  const [showNewBoardModal, setShowNewBoardModal] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');

  // ── Automations state ──
  const [automations, setAutomations] = useState([]);
  const [automationsLoading, setAutomationsLoading] = useState(false);
  const [selectedAutoId, setSelectedAutoId] = useState(null);
  const [autoForm, setAutoForm] = useState(null);
  const [autoRuns, setAutoRuns] = useState([]);
  const [showRunsExpanded, setShowRunsExpanded] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [showNewAutoModal, setShowNewAutoModal] = useState(false);
  const [newAutoName, setNewAutoName] = useState('');
  const [newAutoTriggerType, setNewAutoTriggerType] = useState('schedule');

  // ── Context menu (right-click) ──
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, type: 'board'|'automation', item }

  // ── Profiles ──
  const [profiles, setProfiles] = useState([]);

  const toastTimerRef = useRef(null);

  // ─── Toast helper ──────────────────────────────────────────

  const showToast = useCallback((message, type = 'success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // ─── Fetch boards (flows) ─────────────────────────────────

  const fetchBoards = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('workflows')
        .select('id, slug, name, description, is_active, trigger_mode, trigger_config')
        .order('created_at', { ascending: true });
      if (error) throw error;
      setBoards(data || []);
    } catch (err) {
      console.error('Error fetching boards:', err);
    } finally {
      setBoardsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) fetchBoards();
  }, [isAdmin, fetchBoards]);

  // ─── Fetch automations ─────────────────────────────────────

  const fetchAutomations = useCallback(async () => {
    setAutomationsLoading(true);
    try {
      const { data, error } = await supabase
        .from('automations')
        .select('*')
        .order('created_at', { ascending: true });
      if (error) throw error;
      setAutomations(data || []);
    } catch (err) {
      console.error('Error fetching automations:', err);
    } finally {
      setAutomationsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) fetchAutomations();
  }, [isAdmin, fetchAutomations]);

  // Load automation detail when selected
  useEffect(() => {
    if (!selectedAutoId) { setAutoForm(null); setAutoRuns([]); return; }
    const auto = automations.find(a => a.id === selectedAutoId);
    if (auto) {
      setAutoForm({
        name: auto.name || '',
        description: auto.description || '',
        is_enabled: auto.is_enabled,
        trigger_type: auto.trigger_type,
        trigger_config: auto.trigger_config || {},
        actions: auto.actions || [],
        dedup_key: auto.dedup_key || '',
        requires_confirmation: !!auto.requires_confirmation,
        confirmation_admin_id: auto.confirmation_admin_id || '',
      });
      // Fetch recent runs
      (async () => {
        const { data } = await supabase
          .from('automation_runs')
          .select('*')
          .eq('automation_id', selectedAutoId)
          .order('created_at', { ascending: false })
          .limit(10);
        setAutoRuns(data || []);
      })();
    }
  }, [selectedAutoId, automations]);

  const toggleAutoEnabled = async (auto) => {
    const newVal = !auto.is_enabled;
    const { error } = await supabase
      .from('automations')
      .update({ is_enabled: newVal })
      .eq('id', auto.id);
    if (error) { showToast('Failed to toggle', 'error'); return; }
    setAutomations(prev => prev.map(a => a.id === auto.id ? { ...a, is_enabled: newVal } : a));
    if (autoForm && selectedAutoId === auto.id) setAutoForm(prev => ({ ...prev, is_enabled: newVal }));
    showToast(newVal ? 'Enabled' : 'Disabled');
  };

  const handleCreateAutomation = async () => {
    if (!newAutoName.trim()) return;
    const { data, error } = await supabase
      .from('automations')
      .insert({
        name: newAutoName.trim(),
        trigger_type: newAutoTriggerType,
        trigger_config: newAutoTriggerType === 'schedule'
          ? { type: 'days_of_month', days: [], time_utc: '15:00' }
          : { event: '', source: '' },
        actions: [],
        is_enabled: false,
        created_by: profile?.id || null,
      })
      .select()
      .single();
    if (error) { showToast(error.message, 'error'); return; }
    setShowNewAutoModal(false);
    setNewAutoName('');
    await fetchAutomations();
    setSelectedAutoId(data.id);
    setDrilledView({ type: 'automation', id: data.id });
    showToast('Automation created');
  };

  const saveAutomation = async () => {
    if (!selectedAutoId || !autoForm) return;
    setAutoSaving(true);
    try {
      const { error } = await supabase
        .from('automations')
        .update({
          name: autoForm.name,
          description: autoForm.description,
          is_enabled: autoForm.is_enabled,
          trigger_type: autoForm.trigger_type,
          trigger_config: autoForm.trigger_config,
          actions: autoForm.actions,
          dedup_key: autoForm.dedup_key || null,
          requires_confirmation: !!autoForm.requires_confirmation,
          confirmation_admin_id: autoForm.confirmation_admin_id || null,
        })
        .eq('id', selectedAutoId);
      if (error) throw error;
      await fetchAutomations();
      showToast('Saved');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setAutoSaving(false);
    }
  };

  const deleteAutomation = async () => {
    if (!selectedAutoId) return;
    if (!window.confirm('Delete this automation? This cannot be undone.')) return;
    const { error } = await supabase
      .from('automations')
      .delete()
      .eq('id', selectedAutoId);
    if (error) { showToast(error.message, 'error'); return; }
    setSelectedAutoId(null);
    setAutoForm(null);
    await fetchAutomations();
    showToast('Deleted');
  };

  // Helper: update a nested field in autoForm
  const updateAutoForm = (key, value) => setAutoForm(prev => ({ ...prev, [key]: value }));
  const updateTriggerConfig = (key, value) => setAutoForm(prev => ({
    ...prev, trigger_config: { ...prev.trigger_config, [key]: value },
  }));
  const updateAction = (index, field, value) => setAutoForm(prev => {
    const actions = [...prev.actions];
    actions[index] = { ...actions[index], config: { ...actions[index].config, [field]: value } };
    return { ...prev, actions };
  });
  const updateActionType = (index, type) => setAutoForm(prev => {
    const actions = [...prev.actions];
    actions[index] = { type, config: {} };
    return { ...prev, actions };
  });
  const addAction = () => setAutoForm(prev => ({
    ...prev, actions: [...prev.actions, { type: 'create_task', config: { title: '', assignee_type: 'all_admins', step_key: 'automation' } }],
  }));
  const removeAction = (index) => setAutoForm(prev => ({
    ...prev, actions: prev.actions.filter((_, i) => i !== index),
  }));

  // ─── Fetch profiles for assignee picker ────────────────────

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, status')
        .order('full_name', { ascending: true, nullsFirst: false });
      if (cancelled) return;
      if (error) {
        console.error('Failed to load profiles:', error);
        return;
      }
      setProfiles((data || [])
        .filter((p) => p.status !== 'archived')
        .map((p) => ({
          id: p.id,
          name: p.full_name || p.email || 'Unknown',
          role: p.role || 'member',
        })));
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  // ─── Board CRUD ──────────────────────────────────────────

  const toggleBoardActive = async (board) => {
    const next = !board.is_active;
    const { error } = await supabase.from('workflows').update({ is_active: next }).eq('id', board.id);
    if (error) { showToast('Failed to toggle', 'error'); return; }
    setBoards(prev => prev.map(b => b.id === board.id ? { ...b, is_active: next } : b));
  };

  const createBoard = async () => {
    const name = newBoardName.trim();
    if (!name) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
    const { data, error } = await supabase
      .from('workflows')
      .insert({ name, slug: `${slug}_${Date.now().toString(36)}`, is_active: true, source: 'data', trigger_mode: 'manual' })
      .select('id, slug, name, description, is_active, trigger_mode, trigger_config')
      .single();
    if (error) { showToast(error.message, 'error'); return; }

    // Auto-create a "Complete" terminal column.
    await supabase.from('workflow_steps').insert({
      workflow_id: data.id,
      step_key: 'complete',
      title_template: 'Complete',
      position: 9999,
      assignee_type: 'static',
      action_type: 'complete',
      action_label: 'Done',
      is_terminal: true,
      entry_action_type: 'create_task',
    });

    setBoards(prev => [...prev, data]);
    setShowNewBoardModal(false);
    setNewBoardName('');
    setDrilledView({ type: 'flow', id: data.id });
    showToast('Flow created');
  };

  // ─── Context menu ────────────────────────────────────────

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [ctxMenu]);

  const handleCtxDelete = async () => {
    if (!ctxMenu) return;
    const { type, item } = ctxMenu;
    setCtxMenu(null);
    if (type === 'board') {
      await supabase.from('workflow_instances').delete().eq('workflow_id', item.id);
      await supabase.from('workflow_steps').delete().eq('workflow_id', item.id);
      await supabase.from('workflow_versions').delete().eq('workflow_id', item.id);
      const { error } = await supabase.from('workflows').delete().eq('id', item.id);
      if (error) { showToast('Failed to delete flow', 'error'); return; }
      setBoards(prev => prev.filter(b => b.id !== item.id));
      if (drilledView?.type === 'flow' && drilledView.id === item.id) setDrilledView(null);
      showToast('Flow deleted');
    } else if (type === 'automation') {
      await supabase.from('automation_runs').delete().eq('automation_id', item.id);
      const { error } = await supabase.from('automations').delete().eq('id', item.id);
      if (error) { showToast('Failed to delete automation', 'error'); return; }
      setAutomations(prev => prev.filter(a => a.id !== item.id));
      if (selectedAutoId === item.id) setSelectedAutoId(null);
      if (drilledView?.type === 'automation' && drilledView.id === item.id) setDrilledView(null);
      showToast('Automation deleted');
    }
  };

  // ─── Board counts for tile cards ─────────────────────────

  const [boardStats, setBoardStats] = useState({}); // { boardId: { columns, cards } }

  useEffect(() => {
    if (!isAdmin || boards.length === 0) return;
    let cancelled = false;
    (async () => {
      const ids = boards.map(b => b.id);
      const [{ data: cols }, { data: cards }] = await Promise.all([
        supabase.from('workflow_steps').select('id, workflow_id').in('workflow_id', ids),
        supabase.from('workflow_instances').select('id, workflow_id').in('workflow_id', ids).in('status', ['active', 'blocked']),
      ]);
      if (cancelled) return;
      const stats = {};
      for (const id of ids) stats[id] = { columns: 0, cards: 0 };
      for (const c of (cols || [])) if (stats[c.workflow_id]) stats[c.workflow_id].columns++;
      for (const c of (cards || [])) if (stats[c.workflow_id]) stats[c.workflow_id].cards++;
      setBoardStats(stats);
    })();
    return () => { cancelled = true; };
  }, [isAdmin, boards]);

  // ─── Team + Contractor data for overview ─────────────────

  const [teamProfiles, setTeamProfiles] = useState([]);
  const [contractorProfiles, setContractorProfiles] = useState([]);
  const [teamPending, setTeamPending] = useState([]);
  const [teamDone, setTeamDone] = useState([]);
  const [flPending, setFlPending] = useState([]);
  const [flDone, setFlDone] = useState([]);
  const [editingCards, setEditingCards] = useState([]);
  const [projectStagePending, setProjectStagePending] = useState([]);
  const [projectStageDone, setProjectStageDone] = useState([]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      const TEAM_ROLES = ['admin', 'assistant', 'member', 'director_creative', 'director_comms'];
      const ROLE_PRIORITY = { admin: 0, director_creative: 1, director_comms: 1, assistant: 2, member: 3 };
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, status')
        .order('full_name', { ascending: true, nullsFirst: false });
      if (cancelled) return;
      const active = (data || []).filter(p => p.status !== 'archived');
      // Dedupe duplicate name records by keeping the highest-priority role.
      const byKey = new Map();
      for (const p of active.filter(p => TEAM_ROLES.includes(p.role))) {
        const key = (p.full_name || p.email || p.id).trim().toLowerCase();
        const prev = byKey.get(key);
        const pri = ROLE_PRIORITY[p.role] ?? 99;
        const prevPri = prev ? (ROLE_PRIORITY[prev.role] ?? 99) : 99;
        if (!prev || pri < prevPri) byKey.set(key, p);
      }
      setTeamProfiles(
        Array.from(byKey.values()).map(p => ({ id: p.id, name: p.full_name || p.email || 'Unknown', role: p.role || 'member' })),
      );
      setContractorProfiles(
        active
          .filter(p => p.role === 'freelancer')
          .map(p => ({ id: p.id, name: p.full_name || p.email || 'Unknown', role: 'contractor' })),
      );
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    (async () => {
      const cutoff = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
      const [
        { data: pend },
        { data: completed },
        { data: flPend },
        { data: flDoneData },
      ] = await Promise.all([
        supabase.from('tasks').select('id, title, assignee_id, due_date, status, snoozed_until, hold_reason, planned_date')
          .in('status', ['active', 'pending', 'on_hold'])
          .not('assignee_id', 'is', null),
        supabase.from('tasks').select('id, title, assignee_id, due_date, status, completed_at')
          .eq('status', 'complete')
          .gte('completed_at', cutoff)
          .not('assignee_id', 'is', null),
        supabase.from('freelancer_assignments')
          .select('id, title, freelancer_id, status, due_date, completed_at')
          .in('status', ['assigned', 'in_progress']),
        supabase.from('freelancer_assignments')
          .select('id, title, freelancer_id, status, due_date, completed_at')
          .eq('status', 'completed')
          .gte('completed_at', cutoff),
      ]);
      if (cancelled) return;
      setTeamPending(pend || []);
      setTeamDone(completed || []);
      setFlPending((flPend || []).map(a => ({ ...a, assignee_id: a.freelancer_id })));
      setFlDone((flDoneData || []).map(a => ({ ...a, assignee_id: a.freelancer_id })));
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  // Project stage assignments for current-stage rows (Pending) + recently-archived (Done 7d).
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const load = async () => {
      const cutoff = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
      const { data, error } = await supabase
        .from('project_stage_assignments')
        .select('id, stage, user_id, project:projects(id, name, status, type, archived_at)');
      if (error || cancelled) return;
      const rows = data || [];
      const pending = [];
      const done = [];
      for (const r of rows) {
        const p = r.project;
        if (!p || !r.user_id) continue;
        if (!p.archived_at && r.stage === p.status) {
          pending.push({ id: `proj-${r.id}`, project_id: p.id, name: p.name, stage: r.stage, type: p.type, assignee_id: r.user_id });
        } else if (p.archived_at && p.archived_at >= cutoff && r.stage === p.status) {
          done.push({ id: `proj-${r.id}`, project_id: p.id, name: p.name, stage: r.stage, type: p.type, assignee_id: r.user_id, archived_at: p.archived_at });
        }
      }
      if (!cancelled) {
        setProjectStagePending(pending);
        setProjectStageDone(done);
      }
    };
    load();
    const ch = supabase
      .channel('workflows-project-stages')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_stage_assignments' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, load)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const loadEditing = async () => {
      const { data } = await supabase
        .from('progress_cards')
        .select('id, title')
        .eq('status', 'editing')
        .is('archived_at', null);
      if (!cancelled) setEditingCards(data || []);
    };
    loadEditing();
    const ch = supabase
      .channel('workflows-editing-cards')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'progress_cards' }, loadEditing)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [isAdmin]);

  const teamByAssignee = useMemo(() => {
    const map = {};
    const ensure = id => (map[id] || (map[id] = { pending: [], done: [], projectsPending: [], projectsDone: [] }));
    for (const t of teamPending) if (t.assignee_id) ensure(t.assignee_id).pending.push(t);
    for (const t of teamDone) if (t.assignee_id) ensure(t.assignee_id).done.push(t);
    for (const p of projectStagePending) ensure(p.assignee_id).projectsPending.push(p);
    for (const p of projectStageDone) ensure(p.assignee_id).projectsDone.push(p);
    // Mirror Tracking > Progress > Editing column into Alana Benson's pending list.
    const alana = teamProfiles.find(p => p.name === 'Alana Benson');
    if (alana && editingCards.length > 0) {
      for (const c of editingCards) {
        ensure(alana.id).pending.push({
          id: `progress-card-${c.id}`,
          title: c.title || '(untitled video)',
          status: 'pending',
        });
      }
    }
    return map;
  }, [teamPending, teamDone, teamProfiles, editingCards, projectStagePending, projectStageDone]);

  const contractorByAssignee = useMemo(() => {
    const map = {};
    const ensure = id => (map[id] || (map[id] = { pending: [], done: [], projectsPending: [], projectsDone: [] }));
    for (const t of flPending) if (t.assignee_id) ensure(t.assignee_id).pending.push(t);
    for (const t of flDone) if (t.assignee_id) ensure(t.assignee_id).done.push(t);
    for (const p of projectStagePending) ensure(p.assignee_id).projectsPending.push(p);
    for (const p of projectStageDone) ensure(p.assignee_id).projectsDone.push(p);
    return map;
  }, [flPending, flDone, projectStagePending, projectStageDone]);

  // (Old workflow builder / step CRUD / version publishing / simulator
  //  functions removed — no longer used in this grid layout.)


  // ─── Guard: admin only ─────────────────────────────────────

  if (!isAdmin) {
    return (
      <div style={styles.page}>
        <p style={{ color: 'rgba(255,255,255,0.5)' }}>Admin access required.</p>
      </div>
    );
  }

  // ─── Render helpers ─────────────────────────────────────────

  const renderPersonCard = (p, d) => {
    const data = d || { pending: [], done: [], projectsPending: [], projectsDone: [] };
    const pending = data.pending || [];
    const done = data.done || [];
    const projectsPending = data.projectsPending || [];
    const projectsDone = data.projectsDone || [];
    const doneShown = done.slice(0, 6);
    const projDoneShown = projectsDone.slice(0, 4);
    const pendingTotal = pending.length + projectsPending.length;
    const doneTotal = done.length + projectsDone.length;
    return (
      <div key={p.id} style={styles.teamCard}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{p.name}</span>
          <span style={{
            fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)',
            background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '2px 7px',
            textTransform: 'uppercase', letterSpacing: 0.4,
          }}>{p.role}</span>
        </div>
        <div style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.4)', letterSpacing: 0.5, marginBottom: 6 }}>
          PENDING ({pendingTotal})
        </div>
        {pendingTotal === 0 ? (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic', padding: '2px 0' }}>Nothing pending</div>
        ) : pending.map(t => {
          const nowMs = Date.now();
          const snoozed = t.snoozed_until && new Date(t.snoozed_until).getTime() > nowMs;
          const onHold = !snoozed && t.status === 'on_hold';
          const color = snoozed ? '#a855f7' : onHold ? '#fb923c' : '#facc15';
          const glow = snoozed ? 'rgba(168,85,247,0.7)' : onHold ? 'rgba(251,146,60,0.7)' : 'rgba(250,204,21,0.7)';
          return (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: 12.5 }}>
              <span style={{
                display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                background: color, boxShadow: `0 0 6px ${glow}`,
                animation: 'wf-blink 1.2s ease-in-out infinite', flexShrink: 0,
              }} />
              <span style={{ color: 'rgba(255,255,255,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{t.title}</span>
              {snoozed && (
                <span style={{ fontSize: 10, fontWeight: 600, color: '#c084fc', flexShrink: 0 }}>
                  💤 {fmtSnoozeEnd(t.snoozed_until)}
                </span>
              )}
              {onHold && t.hold_reason && (
                <span title={t.hold_reason} style={{ fontSize: 10, fontWeight: 600, color: '#fdba74', flexShrink: 0 }}>
                  on hold
                </span>
              )}
              {t.planned_date && !snoozed && (
                <span style={{ fontSize: 10, fontWeight: 600, color: '#facc15', flexShrink: 0 }}>
                  {new Date(t.planned_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              )}
            </div>
          );
        })}
        {projectsPending.length > 0 && (
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(96,165,250,0.7)', letterSpacing: 0.4, padding: '2px 0 1px 14px' }}>
              PROJECTS
            </div>
            {projectsPending.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0 3px 14px', fontSize: 12.5 }}>
                <span style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                  background: '#60a5fa', boxShadow: '0 0 6px rgba(96,165,250,0.7)', flexShrink: 0,
                }} />
                <span style={{ color: 'rgba(255,255,255,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                  {p.name} <span style={{ color: 'rgba(255,255,255,0.4)' }}>· {p.stage}</span>
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: 0.5,
                  color: '#60a5fa', background: 'rgba(96,165,250,0.12)',
                  borderRadius: 3, padding: '1px 5px', flexShrink: 0,
                }}>PROJECT</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.4)', letterSpacing: 0.5, marginBottom: 6, marginTop: 10 }}>
          DONE · 7d ({doneTotal})
        </div>
        {doneTotal === 0 ? (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic', padding: '2px 0' }}>None this week</div>
        ) : (
          <>
            {doneShown.map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: 12.5 }}>
                <span style={{ color: '#22c55e', fontSize: 12 }}>✓</span>
                <span style={{ color: 'rgba(255,255,255,0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{t.title}</span>
              </div>
            ))}
            {done.length > doneShown.length && (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', padding: '3px 0 0 18px' }}>
                +{done.length - doneShown.length} more
              </div>
            )}
            {projDoneShown.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0 3px 14px', fontSize: 12.5 }}>
                <span style={{ color: '#60a5fa', fontSize: 12 }}>✓</span>
                <span style={{ color: 'rgba(255,255,255,0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{p.name}</span>
                <span style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: 0.5,
                  color: 'rgba(96,165,250,0.7)', background: 'rgba(96,165,250,0.08)',
                  borderRadius: 3, padding: '1px 5px', flexShrink: 0,
                }}>PROJECT</span>
              </div>
            ))}
            {projectsDone.length > projDoneShown.length && (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', padding: '3px 0 0 32px' }}>
                +{projectsDone.length - projDoneShown.length} more projects
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  // ─── Render ─────────────────────────────────────────────────

  return (
    <div style={styles.page}>
      {/* Toast */}
      {toast && (
        <div style={{
          ...styles.toast,
          background: toast.type === 'error' ? 'rgba(239,68,68,0.9)' : 'rgba(34,197,94,0.9)',
        }}>
          {toast.message}
        </div>
      )}

      {/* ── Drilled into a Flow ── */}
      {drilledView?.type === 'flow' && (
        <KanbanPanel
          boardId={drilledView.id}
          onBack={() => setDrilledView(null)}
          showToast={showToast}
        />
      )}

      {/* ── Drilled into an Automation ── */}
      {drilledView?.type === 'automation' && (() => {
        const auto = automations.find(a => a.id === drilledView.id);
        if (!auto && !autoForm) return <div style={{ color: 'rgba(255,255,255,0.4)', padding: 40 }}>Loading…</div>;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <button
              onClick={() => { setDrilledView(null); setSelectedAutoId(null); }}
              style={{
                background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 13,
                cursor: 'pointer', padding: '4px 0', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6,
                fontFamily: 'inherit', fontWeight: 600,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Automations
            </button>
            {!autoForm ? (
              <div style={styles.canvasLoading}><div style={styles.spinner} /></div>
            ) : (
              <div style={styles.autoEditorWrap}>
                {/* Header */}
                <div style={styles.canvasHeader}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                    <input
                      style={{ ...styles.headerInput, flex: 1 }}
                      value={autoForm.name}
                      onChange={e => updateAutoForm('name', e.target.value)}
                      placeholder="Automation name"
                    />
                    <button
                      style={{
                        ...styles.activeDot,
                        width: 14, height: 14,
                        background: autoForm.is_enabled ? '#22c55e' : 'rgba(255,255,255,0.2)',
                      }}
                      onClick={() => {
                        const a = automations.find(x => x.id === selectedAutoId);
                        if (a) toggleAutoEnabled(a);
                      }}
                      title={autoForm.is_enabled ? 'Enabled' : 'Disabled'}
                    />
                  </div>
                </div>

                {/* Delete row */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button
                    style={{ ...styles.cancelBtn, color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)', fontSize: 12, padding: '4px 12px' }}
                    onClick={deleteAutomation}
                  >
                    Delete Automation
                  </button>
                </div>

                {/* Description */}
                <div style={styles.autoSection}>
                  <label style={styles.fieldLabel}>Description</label>
                  <textarea
                    style={{ ...styles.modalInput, minHeight: 48, resize: 'vertical', fontFamily: 'inherit' }}
                    value={autoForm.description}
                    onChange={e => updateAutoForm('description', e.target.value)}
                    placeholder="Optional description"
                  />
                </div>

                {/* Trigger Section */}
                <div style={styles.autoSection}>
                  <label style={styles.autoSectionTitle}>Trigger</label>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <button
                      style={{
                        ...styles.viewTab,
                        ...(autoForm.trigger_type === 'schedule' ? styles.viewTabActive : {}),
                        fontSize: 12,
                      }}
                      onClick={() => {
                        updateAutoForm('trigger_type', 'schedule');
                        updateAutoForm('trigger_config', { type: 'days_of_month', days: [], time_utc: '15:00' });
                      }}
                    >Schedule</button>
                    <button
                      style={{
                        ...styles.viewTab,
                        ...(autoForm.trigger_type === 'event' ? styles.viewTabActive : {}),
                        fontSize: 12,
                      }}
                      onClick={() => {
                        updateAutoForm('trigger_type', 'event');
                        updateAutoForm('trigger_config', { event: '', source: '' });
                      }}
                    >Event</button>
                  </div>

                  {autoForm.trigger_type === 'schedule' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div>
                        <label style={styles.fieldLabel}>Schedule type</label>
                        <select
                          style={styles.modalInput}
                          value={autoForm.trigger_config?.type || 'days_of_month'}
                          onChange={e => updateTriggerConfig('type', e.target.value)}
                        >
                          <option value="days_of_month">Days of month</option>
                          <option value="day_of_week">Day of week</option>
                        </select>
                      </div>
                      {autoForm.trigger_config?.type === 'days_of_month' ? (
                        <div>
                          <label style={styles.fieldLabel}>Days (comma-separated)</label>
                          <input
                            style={styles.modalInput}
                            value={(autoForm.trigger_config?.days || []).join(', ')}
                            onChange={e => updateTriggerConfig('days', e.target.value.split(',').map(d => parseInt(d.trim(), 10)).filter(n => !isNaN(n)))}
                            placeholder="1, 15"
                          />
                        </div>
                      ) : (
                        <div>
                          <label style={styles.fieldLabel}>Day of week</label>
                          <select
                            style={styles.modalInput}
                            value={autoForm.trigger_config?.day_of_week ?? 1}
                            onChange={e => updateTriggerConfig('day_of_week', parseInt(e.target.value, 10))}
                          >
                            {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d, i) => (
                              <option key={i} value={i}>{d}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div>
                        <label style={styles.fieldLabel}>Time (PT, HH:MM)</label>
                        <input
                          style={styles.modalInput}
                          value={(() => {
                            const utc = autoForm.trigger_config?.time_utc || '15:00';
                            const [h, m] = utc.split(':').map(Number);
                            const ptH = ((h - 7) % 24 + 24) % 24;
                            return `${String(ptH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                          })()}
                          onChange={e => {
                            const [h, m] = e.target.value.split(':').map(Number);
                            if (isNaN(h) || isNaN(m)) return;
                            const utcH = ((h + 7) % 24 + 24) % 24;
                            updateTriggerConfig('time_utc', `${String(utcH).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
                          }}
                          placeholder="08:00"
                        />
                      </div>
                    </div>
                  )}

                  {autoForm.trigger_type === 'event' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div>
                        <label style={styles.fieldLabel}>Event name</label>
                        <input
                          style={styles.modalInput}
                          value={autoForm.trigger_config?.event || ''}
                          onChange={e => updateTriggerConfig('event', e.target.value)}
                          placeholder="new_video"
                        />
                      </div>
                      <div>
                        <label style={styles.fieldLabel}>Source filter (optional)</label>
                        <input
                          style={styles.modalInput}
                          value={autoForm.trigger_config?.source || ''}
                          onChange={e => updateTriggerConfig('source', e.target.value)}
                          placeholder="More Mayday"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions Section */}
                <div style={styles.autoSection}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <label style={styles.autoSectionTitle}>Actions</label>
                    <button style={styles.newBtn} onClick={addAction}>+ Add</button>
                  </div>
                  {autoForm.actions.map((action, idx) => (
                    <div key={idx} style={styles.autoActionCard}>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <select
                          style={{ ...styles.modalInput, width: 'auto', flex: 1 }}
                          value={action.type}
                          onChange={e => updateActionType(idx, e.target.value)}
                        >
                          <option value="create_task">Create Task</option>
                          <option value="send_notification">Send Notification</option>
                        </select>
                        <button
                          style={{ ...styles.cancelBtn, marginLeft: 8, fontSize: 11, padding: '4px 8px' }}
                          onClick={() => removeAction(idx)}
                        >Remove</button>
                      </div>

                      {action.type === 'create_task' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div>
                            <label style={styles.fieldLabel}>Title</label>
                            <input
                              style={styles.modalInput}
                              value={action.config?.title || ''}
                              onChange={e => updateAction(idx, 'title', e.target.value)}
                              placeholder="Task title (supports {{variables}})"
                            />
                          </div>
                          <div>
                            <label style={styles.fieldLabel}>Description (optional)</label>
                            <input
                              style={styles.modalInput}
                              value={action.config?.description || ''}
                              onChange={e => updateAction(idx, 'description', e.target.value)}
                            />
                          </div>
                          <div>
                            <label style={styles.fieldLabel}>Assignee</label>
                            <select
                              style={styles.modalInput}
                              value={action.config?.assignee_type || 'all_admins'}
                              onChange={e => updateAction(idx, 'assignee_type', e.target.value)}
                            >
                              <option value="all_admins">All Admins</option>
                              <option value="specific">Specific Person</option>
                            </select>
                          </div>
                          {action.config?.assignee_type === 'specific' && (
                            <div>
                              <label style={styles.fieldLabel}>Person</label>
                              <select
                                style={styles.modalInput}
                                value={action.config?.assignee_id || ''}
                                onChange={e => updateAction(idx, 'assignee_id', e.target.value)}
                              >
                                <option value="">Select...</option>
                                {profiles.map(p => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                              </select>
                            </div>
                          )}
                          <div>
                            <label style={styles.fieldLabel}>Link URL (optional, supports {'{{variables}}'})</label>
                            <input
                              style={styles.modalInput}
                              value={action.config?.link_url || ''}
                              onChange={e => updateAction(idx, 'link_url', e.target.value)}
                              placeholder="{{video_url}}"
                            />
                          </div>
                        </div>
                      )}

                      {action.type === 'send_notification' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div>
                            <label style={styles.fieldLabel}>Title</label>
                            <input
                              style={styles.modalInput}
                              value={action.config?.title || ''}
                              onChange={e => updateAction(idx, 'title', e.target.value)}
                              placeholder="Notification title"
                            />
                          </div>
                          <div>
                            <label style={styles.fieldLabel}>Body (optional)</label>
                            <input
                              style={styles.modalInput}
                              value={action.config?.body || ''}
                              onChange={e => updateAction(idx, 'body', e.target.value)}
                              placeholder="Notification body"
                            />
                          </div>
                          <div>
                            <label style={styles.fieldLabel}>Recipients</label>
                            <select
                              style={styles.modalInput}
                              value={action.config?.recipient_type || 'all_admins'}
                              onChange={e => updateAction(idx, 'recipient_type', e.target.value)}
                            >
                              <option value="all_admins">All Admins</option>
                              <option value="specific">Specific Person</option>
                            </select>
                          </div>
                        </div>
                      )}

                      {autoForm.trigger_type === 'event' && (
                        <p style={styles.autoHelperText}>
                          Available variables: {'{{'}{autoForm.trigger_config.event === 'new_video' ? 'video_id}}, {{video_title}}, {{video_url' : '...'}}{'}}'}
                        </p>
                      )}
                      {autoForm.trigger_type === 'schedule' && (
                        <p style={styles.autoHelperText}>
                          Available variables: {'{{today}}, {{day_of_month}}, {{day_of_week}}'}
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                {/* Dedup Key */}
                <div style={styles.autoSection}>
                  <label style={styles.fieldLabel}>Dedup Key (optional)</label>
                  <input
                    style={styles.modalInput}
                    value={autoForm.dedup_key}
                    onChange={e => updateAutoForm('dedup_key', e.target.value)}
                    placeholder="payroll_{{today}}"
                  />
                  <p style={styles.autoHelperText}>
                    Prevents duplicate tasks. Template is resolved at runtime.
                  </p>
                </div>

                {/* Admin Confirmation Gate */}
                <div style={styles.autoSection}>
                  <label style={{ ...styles.fieldLabel, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!!autoForm.requires_confirmation}
                      onChange={e => updateAutoForm('requires_confirmation', e.target.checked)}
                    />
                    <span>Require admin confirmation before running</span>
                  </label>
                  {autoForm.requires_confirmation && (
                    <div style={{ marginTop: 8 }}>
                      <label style={styles.fieldLabel}>Send confirmation task to</label>
                      <select
                        style={styles.modalInput}
                        value={autoForm.confirmation_admin_id || ''}
                        onChange={e => updateAutoForm('confirmation_admin_id', e.target.value)}
                      >
                        <option value="">All admins (first to respond wins)</option>
                        {profiles.filter(p => p.role === 'admin').map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <p style={styles.autoHelperText}>
                    When enabled, the trigger creates an Approve/Decline task instead of firing the actions. Actions run only after an admin approves.
                  </p>
                </div>

                {/* History Section */}
                <div style={styles.autoSection}>
                  <button
                    style={{ ...styles.autoSectionTitle, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', width: '100%' }}
                    onClick={() => setShowRunsExpanded(!showRunsExpanded)}
                  >
                    History {showRunsExpanded ? '▾' : '▸'} ({autoRuns.length})
                  </button>
                  {showRunsExpanded && (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {autoRuns.length === 0 ? (
                        <p style={styles.listEmpty}>No runs yet</p>
                      ) : autoRuns.map(run => (
                        <div key={run.id} style={styles.autoRunRow}>
                          <span style={{
                            ...styles.sourceBadge,
                            background: run.status === 'success' ? 'rgba(34,197,94,0.15)'
                              : run.status === 'skipped' ? 'rgba(234,179,8,0.15)'
                              : run.status === 'pending_confirmation' ? 'rgba(99,102,241,0.15)'
                              : 'rgba(239,68,68,0.15)',
                            color: run.status === 'success' ? '#22c55e'
                              : run.status === 'skipped' ? '#facc15'
                              : run.status === 'pending_confirmation' ? '#818cf8'
                              : '#ef4444',
                          }}>
                            {run.status === 'pending_confirmation' ? 'pending' : run.status}
                          </span>
                          <span style={styles.slugText}>
                            {new Date(run.created_at).toLocaleString()}
                          </span>
                          {run.error_message && (
                            <span style={{ fontSize: 11, color: '#ef4444', marginLeft: 4 }}>
                              {run.error_message}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Save Button */}
                <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    style={styles.createBtn}
                    onClick={saveAutomation}
                    disabled={autoSaving}
                  >
                    {autoSaving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── GRID OVERVIEW ── */}
      {!drilledView && (
      <>
      {/* Top row: Flows (75%) + Automations (25%) */}
      <div style={styles.gridRow}>
        {/* ── Flows section ── */}
        <div style={styles.flowsSection}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: 0 }}>
              Flows <span style={{ fontWeight: 400, color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>({boards.length})</span>
            </h2>
          </div>
          {boardsLoading ? (
            <div style={styles.listLoading}><div style={styles.spinner} /></div>
          ) : (
            <div style={styles.tileGrid3}>
              {boards.map(b => {
                const stats = boardStats[b.id] || { columns: 0, cards: 0 };
                return (
                  <div
                    key={b.id}
                    style={styles.tileCard}
                    onClick={() => setDrilledView({ type: 'flow', id: b.id })}
                    onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, type: 'board', item: b }); }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{b.name}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleBoardActive(b); }}
                        title={b.is_active ? 'Active' : 'Inactive'}
                        style={{
                          width: 8, height: 8, borderRadius: '50%', border: 'none', cursor: 'pointer', flexShrink: 0,
                          background: b.is_active ? '#22c55e' : 'rgba(255,255,255,0.15)',
                        }}
                      />
                    </div>
                    {b.description && (
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {b.description}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
                      <span>{stats.columns} col{stats.columns !== 1 ? 's' : ''}</span>
                      <span>{stats.cards} card{stats.cards !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                );
              })}
              {/* + New Flow */}
              <div
                style={styles.tilePlaceholder}
                onClick={() => { setShowNewBoardModal(true); setNewBoardName(''); }}
              >
                <span style={{ fontSize: 22, color: 'rgba(255,255,255,0.25)', lineHeight: 1 }}>+</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontWeight: 500 }}>New Flow</span>
              </div>
            </div>
          )}
        </div>

        {/* ── Automations section ── */}
        <div style={styles.automationsSection}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: 0 }}>
              Automations <span style={{ fontWeight: 400, color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>({automations.length})</span>
            </h2>
          </div>
          {automationsLoading ? (
            <div style={styles.listLoading}><div style={styles.spinner} /></div>
          ) : (
            <div style={styles.tileGrid2}>
              {automations.map(auto => (
                <div
                  key={auto.id}
                  style={styles.tileCard}
                  onClick={() => { setSelectedAutoId(auto.id); setDrilledView({ type: 'automation', id: auto.id }); }}
                  onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, type: 'automation', item: auto }); }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{auto.name}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleAutoEnabled(auto); }}
                      title={auto.is_enabled ? 'Enabled' : 'Disabled'}
                      style={{
                        width: 8, height: 8, borderRadius: '50%', border: 'none', cursor: 'pointer', flexShrink: 0, marginLeft: 8,
                        background: auto.is_enabled ? '#22c55e' : 'rgba(255,255,255,0.15)',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
                      textTransform: 'uppercase', letterSpacing: 0.5,
                      background: auto.trigger_type === 'schedule' ? 'rgba(234,179,8,0.15)' : 'rgba(59,130,246,0.15)',
                      color: auto.trigger_type === 'schedule' ? '#facc15' : '#60a5fa',
                    }}>
                      {auto.trigger_type}
                    </span>
                    {auto.run_count > 0 && (
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{auto.run_count} runs</span>
                    )}
                  </div>
                </div>
              ))}
              {/* + New Automation */}
              <div
                style={styles.tilePlaceholder}
                onClick={() => { setShowNewAutoModal(true); setNewAutoName(''); setNewAutoTriggerType('schedule'); }}
              >
                <span style={{ fontSize: 22, color: 'rgba(255,255,255,0.25)', lineHeight: 1 }}>+</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontWeight: 500 }}>New Auto</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Team section (Team + Contractors) ── */}
      {(teamProfiles.length > 0 || contractorProfiles.length > 0) && (
        <div style={{ marginTop: 32 }}>
          <style>{`@keyframes wf-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }`}</style>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: '#ffffff', margin: '0 0 12px' }}>Team</h2>
          {teamProfiles.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14 }}>
              {teamProfiles.map(p => renderPersonCard(p, teamByAssignee[p.id]))}
            </div>
          )}

          {contractorProfiles.length > 0 && (
            <>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.7)', margin: '20px 0 10px', textTransform: 'uppercase', letterSpacing: 0.6 }}>Contractors</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14 }}>
                {contractorProfiles.map(p => renderPersonCard(p, contractorByAssignee[p.id]))}
              </div>
            </>
          )}
        </div>
      )}
      </>
      )}

      {/* ── New Board Modal ── */}
      {showNewBoardModal && (
        <div style={styles.modalOverlay} onClick={() => setShowNewBoardModal(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>New Flow</h3>
            <div style={styles.modalField}>
              <label style={styles.fieldLabel}>Name</label>
              <input
                style={styles.modalInput}
                value={newBoardName}
                onChange={e => setNewBoardName(e.target.value)}
                placeholder="e.g. Mayday Video"
                onKeyDown={e => { if (e.key === 'Enter') createBoard(); }}
                autoFocus
              />
            </div>
            <div style={styles.modalActions}>
              <button style={styles.cancelBtn} onClick={() => setShowNewBoardModal(false)}>Cancel</button>
              <button style={styles.createBtn} onClick={createBoard} disabled={!newBoardName.trim()}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* ── New Automation Modal ── */}
      {showNewAutoModal && (
        <div style={styles.modalOverlay} onClick={() => setShowNewAutoModal(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>New Automation</h3>
            <div style={styles.modalField}>
              <label style={styles.fieldLabel}>Name</label>
              <input
                style={styles.modalInput}
                value={newAutoName}
                onChange={e => setNewAutoName(e.target.value)}
                placeholder="Payroll Reminder"
                autoFocus
              />
            </div>
            <div style={styles.modalField}>
              <label style={styles.fieldLabel}>Trigger Type</label>
              <select
                style={styles.modalInput}
                value={newAutoTriggerType}
                onChange={e => setNewAutoTriggerType(e.target.value)}
              >
                <option value="schedule">Schedule (time-based)</option>
                <option value="event">Event (triggered by system events)</option>
              </select>
            </div>
            <div style={styles.modalActions}>
              <button style={styles.cancelBtn} onClick={() => setShowNewAutoModal(false)}>Cancel</button>
              <button style={styles.createBtn} onClick={handleCreateAutomation} disabled={!newAutoName.trim()}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Right-click context menu */}
      {ctxMenu && (
        <div
          style={{ ...styles.ctxMenu, top: ctxMenu.y, left: ctxMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={styles.ctxMenuTitle}>{ctxMenu.item.name}</div>
          <button style={styles.ctxMenuBtn} onClick={handleCtxDelete}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
            Delete {ctxMenu.type === 'automation' ? 'automation' : 'flow'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const styles = {
  page: {
    padding: '24px 32px',
    minHeight: '100vh',
    position: 'relative',
  },

  // Grid overview
  gridRow: {
    display: 'flex',
    gap: 24,
    alignItems: 'flex-start',
  },
  flowsSection: {
    flex: 3,
    minWidth: 0,
  },
  automationsSection: {
    flex: 1,
    minWidth: 0,
    borderLeft: '1px solid rgba(255,255,255,0.06)',
    paddingLeft: 24,
  },
  tileGrid3: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 14,
  },
  tileGrid2: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 14,
  },
  tileCard: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: '14px 16px',
    cursor: 'pointer',
    transition: 'border-color 0.15s, background 0.15s',
  },
  tilePlaceholder: {
    border: '1px dashed rgba(255,255,255,0.12)',
    borderRadius: 10,
    padding: '14px 16px',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 80,
    transition: 'border-color 0.15s',
  },
  teamCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: '14px 16px',
  },

  // Context menu
  ctxMenu: {
    position: 'fixed',
    zIndex: 9999,
    background: '#1e1e2e',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    padding: 4,
    minWidth: 160,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  ctxMenuTitle: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    padding: '6px 10px 4px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  ctxMenuBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    background: 'none',
    border: 'none',
    borderRadius: 5,
    padding: '7px 10px',
    color: '#f87171',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    textAlign: 'left',
  },

  // Toast
  toast: {
    position: 'fixed',
    top: 20,
    right: 20,
    padding: '10px 20px',
    borderRadius: 8,
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    zIndex: 9999,
    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
  },

  // Loading
  listLoading: {
    display: 'flex',
    justifyContent: 'center',
    padding: 40,
  },
  spinner: {
    width: 22,
    height: 22,
    border: '2px solid rgba(255,255,255,0.1)',
    borderTopColor: '#6366f1',
    borderRadius: '50%',
    animation: 'spin 0.6s linear infinite',
  },
  listEmpty: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 13,
    textAlign: 'center',
    padding: 20,
  },
  canvasLoading: {
    display: 'flex',
    justifyContent: 'center',
    padding: 60,
  },

  // Shared form elements
  activeDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    flexShrink: 0,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerInput: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 5,
    padding: '6px 10px',
    color: '#fff',
    fontSize: 13,
    outline: 'none',
    minWidth: 140,
  },
  sourceBadge: {
    fontSize: 10,
    fontWeight: 700,
    padding: '1px 6px',
    borderRadius: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  slugText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
    fontFamily: 'monospace',
  },

  // Buttons
  newBtn: {
    background: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  cancelBtn: {
    background: 'rgba(255,255,255,0.05)',
    color: 'rgba(255,255,255,0.6)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    padding: '8px 16px',
    fontSize: 13,
    cursor: 'pointer',
  },
  createBtn: {
    background: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },

  // Modal
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#1a1a2e',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: '24px 28px',
    width: 420,
    maxWidth: '90vw',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: '#fff',
    margin: '0 0 16px',
  },
  modalField: {
    marginBottom: 14,
  },
  modalInput: {
    width: '100%',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    padding: '8px 12px',
    color: '#fff',
    fontSize: 14,
    outline: 'none',
    marginTop: 4,
    boxSizing: 'border-box',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 20,
  },

  // Automation editor
  canvasHeader: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: '16px 20px',
  },
  autoEditorWrap: {
    maxWidth: 720,
    padding: 20,
  },
  autoSection: {
    marginTop: 20,
    paddingTop: 16,
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  autoSectionTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: '#fff',
    marginBottom: 8,
    display: 'block',
  },
  autoActionCard: {
    padding: 12,
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 8,
    marginBottom: 8,
  },
  autoHelperText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
    marginTop: 6,
    fontStyle: 'italic',
  },
  autoRunRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 0',
    borderBottom: '1px solid rgba(255,255,255,0.03)',
  },
  viewTab: {
    flex: 1,
    padding: '6px 12px',
    border: 'none',
    borderRadius: 6,
    background: 'transparent',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s',
  },
  viewTabActive: {
    background: 'rgba(99,102,241,0.15)',
    color: '#818cf8',
  },
};
