import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import KanbanPanel from './workflows/KanbanPanel';
import MemberAssignmentModal from '../components/MemberAssignmentModal';
import ContractorAssignmentModal from '../components/ContractorAssignmentModal';
import TaskEditModal from '../components/TaskEditModal';
import ProgressTable from '../components/workflows/ProgressTable';
import { fetchAllRows } from './analytics/utils';
import backdropDismiss from '../lib/backdropDismiss';
import { colors, radii, shadows, zIndex } from '../lib/styleTokens';

// ─── Component ───────────────────────────────────────────────
export default function Workflows() {
  const { isAdmin, profile } = useAuth();

  // ── Grid + drill-in state ──
  // null | { type: 'flow', id } | { type: 'automation', id } — persisted to
  // localStorage (JSON, since usePersistedTab is string-only) so a refresh
  // reopens the drilled flow/automation. Stale ids are reconciled below.
  const [drilledView, setDrilledView] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('tab:workflows-drilled'));
      if (
        stored && typeof stored === 'object' &&
        ['flow', 'automation'].includes(stored.type) &&
        typeof stored.id === 'string' && stored.id
      ) {
        return { type: stored.type, id: stored.id };
      }
    } catch { /* missing/corrupt entry or storage unavailable — start at grid */ }
    return null;
  });
  useEffect(() => {
    try {
      if (drilledView) localStorage.setItem('tab:workflows-drilled', JSON.stringify(drilledView));
      else localStorage.removeItem('tab:workflows-drilled');
    } catch { /* ignore */ }
  }, [drilledView]);
  const [toast, setToast] = useState(null);

  // ── Boards (flows) state ──
  const [boards, setBoards] = useState([]);
  const [boardsLoading, setBoardsLoading] = useState(true);
  const [boardsLoaded, setBoardsLoaded] = useState(false); // first successful fetch done
  const [showNewBoardModal, setShowNewBoardModal] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');

  // ── Automations state ──
  const [automations, setAutomations] = useState([]);
  const [automationsLoading, setAutomationsLoading] = useState(false);
  const [automationsLoaded, setAutomationsLoaded] = useState(false); // first successful fetch done
  const [selectedAutoId, setSelectedAutoId] = useState(null);
  const [autoForm, setAutoForm] = useState(null);
  const [autoRuns, setAutoRuns] = useState([]);
  const [showRunsExpanded, setShowRunsExpanded] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [creatingAuto, setCreatingAuto] = useState(false);
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [showNewAutoModal, setShowNewAutoModal] = useState(false);
  const [newAutoName, setNewAutoName] = useState('');
  const [newAutoTriggerType, setNewAutoTriggerType] = useState('schedule');

  // ── Assignment modals ──
  const [assignMenuOpen, setAssignMenuOpen] = useState(false);
  const [memberAssignOpen, setMemberAssignOpen] = useState(false);
  const [contractorAssignOpen, setContractorAssignOpen] = useState(false);

  // ── Progress edit modals ──
  const [editingTask, setEditingTask] = useState(null);
  const [editingContractorAssign, setEditingContractorAssign] = useState(null);

  // Set of tasks.id whose admin assignee has the linked sprint card in
  // the "In Progress" column. Forces the "active" pill in ProgressTable.
  const [sprintActiveTaskIds, setSprintActiveTaskIds] = useState(() => new Set());
  // Sprint "Holding" column → force the row's pill/dot to "on hold".
  const [sprintHoldingTaskIds, setSprintHoldingTaskIds] = useState(() => new Set());
  // Sprint "Done" column → move the row out of Pending into the Done · 7d
  // bucket, regardless of underlying tasks.status. Limited to cards moved
  // within the last 7 days so the Done column stays consistent.
  const [sprintDoneTaskIds, setSprintDoneTaskIds] = useState(() => new Set());

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
      setBoardsLoaded(true);
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
      setAutomationsLoaded(true);
    } catch (err) {
      console.error('Error fetching automations:', err);
    } finally {
      setAutomationsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) fetchAutomations();
  }, [isAdmin, fetchAutomations]);

  // ─── Reconcile a restored drilled view once data loads ─────
  // A persisted flow/automation id may have been deleted (or, for
  // automations, restored without selectedAutoId set) — fall back to the
  // grid when the id is gone, and hook the automation editor back up
  // when it exists.
  useEffect(() => {
    if (drilledView?.type !== 'flow' || !boardsLoaded) return;
    if (!boards.some(b => b.id === drilledView.id)) setDrilledView(null);
  }, [drilledView, boards, boardsLoaded]);

  useEffect(() => {
    if (drilledView?.type !== 'automation') return;
    // Automations are only fetched for admins — a restored automation drill
    // for a non-admin would otherwise hang on a loading screen.
    if (!isAdmin) { setDrilledView(null); setSelectedAutoId(null); return; }
    if (!automationsLoaded) return;
    if (!automations.some(a => a.id === drilledView.id)) {
      setDrilledView(null);
      setSelectedAutoId(null);
    } else if (selectedAutoId !== drilledView.id) {
      setSelectedAutoId(drilledView.id);
    }
  }, [drilledView, automations, automationsLoaded, selectedAutoId, isAdmin]);

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
    if (!newAutoName.trim() || creatingAuto) return;
    setCreatingAuto(true);
    try {
      const { data, error } = await supabase
        .from('automations')
        .insert({
          name: newAutoName.trim(),
          trigger_type: newAutoTriggerType,
          trigger_config: newAutoTriggerType === 'schedule'
            ? { type: 'days_of_month', days: [], hour_pt: 8 }
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
    } finally {
      setCreatingAuto(false);
    }
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
    if (!name || creatingBoard) return;
    setCreatingBoard(true);
    try {
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
    } finally {
      setCreatingBoard(false);
    }
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
          .filter(p => p.role === 'contractor' || p.role === 'freelancer')
          .map(p => ({ id: p.id, name: p.full_name || p.email || 'Unknown', role: 'contractor' })),
      );
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  const fetchProgress = useCallback(async () => {
    if (!isAdmin) return;
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
    // Task selects pull the columns TaskEditModal needs (description,
    // workflow_instance_id, automation_id, created_at) so click-to-edit
    // doesn't have to round-trip a second time.
    const TASK_COLS = 'id, title, description, assignee_id, due_date, status, snoozed_until, hold_reason, planned_date, workflow_instance_id, automation_id, created_at';
    const TASK_DONE_COLS = TASK_COLS + ', completed_at';
    const FL_COLS = 'id, title, description, contractor_id, status, due_date, due_time, pay_amount, asset_url, completed_at, created_at, created_by';
    const [
      pend,
      { data: completed },
      { data: flPend },
      { data: flDoneData },
    ] = await Promise.all([
      fetchAllRows(supabase.from('tasks').select(TASK_COLS)
        .in('status', ['active', 'pending', 'on_hold'])
        .not('assignee_id', 'is', null)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })),
      supabase.from('tasks').select(TASK_DONE_COLS)
        .eq('status', 'complete')
        .gte('completed_at', cutoff)
        .not('assignee_id', 'is', null),
      supabase.from('contractor_assignments')
        .select(FL_COLS)
        .in('status', ['assigned', 'in_progress']),
      supabase.from('contractor_assignments')
        .select(FL_COLS)
        .eq('status', 'completed')
        .gte('completed_at', cutoff),
    ]);
    // Alias contractor_id → assignee_id so the shared ProgressTable
    // grouping logic doesn't need a special case for contractors.
    setFlPending((flPend || []).map((a) => ({ ...a, assignee_id: a.contractor_id })));
    setFlDone((flDoneData || []).map((a) => ({ ...a, assignee_id: a.contractor_id })));

    // Sprint overlay: keep the existing per-admin in_progress overlay for
    // tasks-linked sprint cards (drives the yellow "active" dot on rows
    // whose tasks.id matches a personal_tasks.task_id). The Holding/Done
    // overrides are folded into the project-card synthesis below so we
    // don't double-paint.
    const { data: sprintActiveRows } = await supabase
      .from('personal_tasks')
      .select('task_id')
      .eq('status', 'in_progress')
      .not('task_id', 'is', null);
    const sprintActiveIds = new Set((sprintActiveRows || []).map((r) => r.task_id));

    // My-project-card overlay: surface MY sprint cards that originated
    // from a project (project_id not null). Each card is synthesized as
    // a pseudo-task pinned to my own row so the existing Progress table
    // renders it without needing a real tasks row. In Progress / Holding
    // / Done map to active / on-hold / done buckets respectively. Done
    // window matches the rest of the table (7d).
    const sprintHoldIds = new Set();
    const sprintDoneIds = new Set();
    if (profile?.id) {
      const { data: myCards } = await supabase
        .from('personal_tasks')
        .select('id, content, status, updated_at, task_id')
        .eq('created_by', profile.id)
        .not('project_id', 'is', null)
        .in('status', ['in_progress', 'holding', 'done']);
      const cutoffMs = Date.now() - SEVEN_DAYS_MS;
      const synthPending = [];
      const synthDone = [];
      for (const c of myCards || []) {
        const synthId = `sprint-${c.id}`;
        const title = c.content || '(untitled card)';
        // Card already linked to a real tasks row (e.g. a received project-stage
        // task): the real row is already rendered from `pend`/`completed`, so
        // don't synthesize a phantom — just overlay the sprint status onto that
        // row (keyed on the real task id, exactly like the in_progress overlay).
        if (c.task_id) {
          if (c.status === 'in_progress') sprintActiveIds.add(c.task_id);
          else if (c.status === 'holding') sprintHoldIds.add(c.task_id);
          else if (c.status === 'done') sprintDoneIds.add(c.task_id);
          continue;
        }
        if (c.status === 'done') {
          const tMs = c.updated_at ? new Date(c.updated_at).getTime() : 0;
          if (tMs < cutoffMs) continue;
          synthDone.push({ id: synthId, title, assignee_id: profile.id, status: 'complete', completed_at: c.updated_at });
        } else {
          synthPending.push({ id: synthId, title, assignee_id: profile.id, status: 'active' });
          if (c.status === 'in_progress') sprintActiveIds.add(synthId);
          else if (c.status === 'holding') sprintHoldIds.add(synthId);
        }
      }
      setTeamPending([...(pend || []), ...synthPending]);
      setTeamDone([...(completed || []), ...synthDone]);
    } else {
      setTeamPending(pend || []);
      setTeamDone(completed || []);
    }

    setSprintActiveTaskIds(sprintActiveIds);
    setSprintHoldingTaskIds(sprintHoldIds);
    setSprintDoneTaskIds(sprintDoneIds);
  }, [isAdmin, profile?.id]);

  useEffect(() => { fetchProgress(); }, [fetchProgress]);

  // Open the right editor for a Progress row. Pseudo-tasks (sprint-*/
  // progress-card-*) have synthetic ids — the editor save would error/no-op.
  const openProgressTaskEditor = (task, groupKey) => {
    if (!task || typeof task.id !== 'string') return;
    if (task.id.startsWith('sprint-') || task.id.startsWith('progress-card-')) return;
    if (groupKey === 'contractors') {
      // Contractor rows store contractor_assignments shape — the row
      // already has the columns ContractorAssignmentModal expects.
      setEditingContractorAssign(task);
    } else {
      setEditingTask(task);
    }
  };

  // Delete straight from the edit modal (right-click menu is unreliable, so the
  // edit window carries the destructive action). Same effect as cancel: removes
  // the row. TaskEditModal only ever holds a real `tasks` row here.
  const deleteEditingTask = async () => {
    const task = editingTask;
    if (!task) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${task.title}"? This deletes the task and can't be undone.`)) return;
    const { error } = await supabase.from('tasks').delete().eq('id', task.id);
    if (error) {
      console.error('Delete task failed:', error);
      showToast('Failed to delete task', 'error');
      return;
    }
    showToast('Task deleted');
    setEditingTask(null);
    fetchProgress();
  };

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
    const ensure = id => (map[id] || (map[id] = { pending: [], done: [] }));
    for (const t of teamPending) if (t.assignee_id) ensure(t.assignee_id).pending.push(t);
    for (const t of teamDone) if (t.assignee_id) ensure(t.assignee_id).done.push(t);
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
  }, [teamPending, teamDone, teamProfiles, editingCards]);

  const contractorByAssignee = useMemo(() => {
    const map = {};
    const ensure = id => (map[id] || (map[id] = { pending: [], done: [] }));
    for (const t of flPending) if (t.assignee_id) ensure(t.assignee_id).pending.push(t);
    for (const t of flDone) if (t.assignee_id) ensure(t.assignee_id).done.push(t);
    return map;
  }, [flPending, flDone]);

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

      {/* Assignment modals */}
      <MemberAssignmentModal
        open={memberAssignOpen}
        onClose={() => setMemberAssignOpen(false)}
        showToast={showToast}
        onCreated={fetchProgress}
      />
      <ContractorAssignmentModal
        open={contractorAssignOpen || !!editingContractorAssign}
        existing={editingContractorAssign || undefined}
        onClose={() => { setContractorAssignOpen(false); setEditingContractorAssign(null); }}
        onCreated={fetchProgress}
        onSaved={fetchProgress}
        showToast={showToast}
        currentUserId={profile?.id}
      />
      <TaskEditModal
        open={!!editingTask}
        task={editingTask}
        profiles={profiles}
        onClose={() => setEditingTask(null)}
        onSaved={fetchProgress}
        showToast={showToast}
        onDelete={deleteEditingTask}
      />

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
                        updateAutoForm('trigger_config', { type: 'days_of_month', days: [], hour_pt: 8 });
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
                        <label style={styles.fieldLabel}>Hour (PT)</label>
                        <select
                          style={styles.modalInput}
                          value={(() => {
                            // Prefer hour_pt; migrate legacy time_utc rows for display
                            // (uses fixed -7, exact value is corrected on save).
                            if (autoForm.trigger_config?.hour_pt != null) return autoForm.trigger_config.hour_pt;
                            const utc = autoForm.trigger_config?.time_utc;
                            if (!utc) return 8;
                            return ((Number(utc.split(':')[0]) - 7) % 24 + 24) % 24;
                          })()}
                          onChange={e => updateTriggerConfig('hour_pt', parseInt(e.target.value, 10))}
                        >
                          {Array.from({ length: 24 }, (_, h) => {
                            const ampm = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
                            return <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00 — ${ampm}`}</option>;
                          })}
                        </select>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                          Runs hourly; fires at the top of this Pacific hour (auto-adjusts for DST).
                        </div>
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
                              : run.status === 'pending_confirmation' ? 'rgba(91, 143, 199,0.15)'
                              : 'rgba(239,68,68,0.15)',
                            color: run.status === 'success' ? '#22c55e'
                              : run.status === 'skipped' ? '#facc15'
                              : run.status === 'pending_confirmation' ? '#8fb4d8'
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
      {/* Page header: title + Assignment dropdown */}
      <div style={styles.pageHeader}>
        <h1 style={styles.pageTitle}>Workflows</h1>
        <div style={{ position: 'relative' }}>
          <button
            style={styles.assignBtn}
            onClick={() => setAssignMenuOpen(v => !v)}
          >
            + Assignment
            <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.7 }}>▾</span>
          </button>
          {assignMenuOpen && (
            <>
              <div
                style={styles.assignMenuBackdrop}
                onClick={() => setAssignMenuOpen(false)}
              />
              <div style={styles.assignMenu}>
                <button
                  style={styles.assignMenuItem}
                  onClick={() => { setAssignMenuOpen(false); setMemberAssignOpen(true); }}
                >
                  <div style={styles.assignMenuLabel}>Member</div>
                  <div style={styles.assignMenuDesc}>Team/assistant/partner — one-off task</div>
                </button>
                <button
                  style={styles.assignMenuItem}
                  onClick={() => { setAssignMenuOpen(false); setContractorAssignOpen(true); }}
                >
                  <div style={styles.assignMenuLabel}>Contractor</div>
                  <div style={styles.assignMenuDesc}>Contractor — paid assignment</div>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

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

      {/* ── Team section (Team + Contractors table) ── */}
      <ProgressTable
        groups={[
          { key: 'team', label: 'Team', profiles: teamProfiles, byAssignee: teamByAssignee },
          { key: 'contractors', label: 'Contractors', profiles: contractorProfiles, byAssignee: contractorByAssignee },
        ]}
        sprintActiveTaskIds={sprintActiveTaskIds}
        sprintHoldingTaskIds={sprintHoldingTaskIds}
        sprintDoneTaskIds={sprintDoneTaskIds}
        onTaskClick={(task, person, groupKey) => openProgressTaskEditor(task, groupKey)}
      />
      </>
      )}

      {/* ── New Board Modal ── */}
      {showNewBoardModal && (
        <div style={styles.modalOverlay} {...backdropDismiss(() => setShowNewBoardModal(false))}>
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
              <button style={styles.createBtn} onClick={createBoard} disabled={!newBoardName.trim() || creatingBoard}>{creatingBoard ? 'Creating…' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── New Automation Modal ── */}
      {showNewAutoModal && (
        <div style={styles.modalOverlay} {...backdropDismiss(() => setShowNewAutoModal(false))}>
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
              <button style={styles.createBtn} onClick={handleCreateAutomation} disabled={!newAutoName.trim() || creatingAuto}>{creatingAuto ? 'Creating…' : 'Create'}</button>
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
    padding: '36px 40px 64px',
    maxWidth: '1500px',
    margin: '0 auto',
    minHeight: '100vh',
    position: 'relative',
  },

  // Page header (above grid)
  pageHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: 800,
    color: '#fff',
    margin: 0,
  },
  assignBtn: {
    background: colors.accent,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'flex',
    alignItems: 'center',
  },
  assignMenuBackdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 998,
  },
  assignMenu: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 6,
    minWidth: 260,
    background: colors.bgHover,
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10,
    padding: 6,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    zIndex: 999,
  },
  assignMenuItem: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'none',
    border: 'none',
    borderRadius: 6,
    padding: '10px 12px',
    color: '#fff',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  assignMenuLabel: {
    fontSize: 14,
    fontWeight: 700,
    color: '#fff',
  },
  assignMenuDesc: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 2,
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

  // Context menu
  ctxMenu: {
    position: 'fixed',
    zIndex: 9999,
    background: colors.bgHover,
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
    borderTopColor: '#5b8fc7',
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
    background: colors.accent,
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
    background: colors.accent,
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
    background: colors.bgHover,
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
    background: colors.accentA15,
    color: colors.accentFg,
  },
};
