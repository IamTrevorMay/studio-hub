import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import { getStepAction } from '../lib/workflowSteps';
import { getWorkflowModal } from '../lib/workflowModals';

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || '';

// ─── Helpers ──────────────────────────────────────────────────

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function snoozeLabel(until) {
  if (!until) return '';
  const d = new Date(until);
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  if (diff <= 0) return 'Snooze expired';
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) return `${Math.ceil(diff / 60000)}m`;
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function computeSnoozeUntil(preset) {
  const now = new Date();
  switch (preset) {
    case '1h': return new Date(now.getTime() + 3600000).toISOString();
    case '4h': return new Date(now.getTime() + 4 * 3600000).toISOString();
    case 'tomorrow': {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    }
    case 'next_week': {
      const d = new Date(now);
      const daysUntilMon = ((8 - d.getDay()) % 7) || 7;
      d.setDate(d.getDate() + daysUntilMon);
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    }
    default: return null;
  }
}

// ─── API calls ────────────────────────────────────────────────

async function callWorkflowFn(fnName, body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `${fnName} failed`);
  return data;
}

// ─── Inline review for ad read proposal tasks ────────────────

function ReviewProposalCard({ task }) {
  const [proposal, setProposal] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const proposalId = task.workflow_instance?.context?.proposal_id;
    if (!proposalId) { setError('Missing proposal_id in workflow context.'); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from('ad_read_proposals')
        .select('*, creator:profiles(id, full_name), items:ad_read_proposal_items(id, title, deliverable_type, channel, due_month, pay, position)')
        .eq('id', proposalId)
        .single();
      if (cancelled) return;
      if (err) { setError(err.message); setLoading(false); return; }
      const items = (data.items || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
      setProposal({ ...data, items });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [task.workflow_instance?.context?.proposal_id]);

  if (loading) return <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, margin: 0 }}>Loading proposal…</p>;
  if (error) return <p style={{ color: '#fca5a5', fontSize: 13, margin: 0 }}>Error: {error}</p>;
  if (!proposal) return null;

  const totalPay = (proposal.items || []).reduce((sum, it) => sum + (Number(it.pay) || 0), 0);

  return (
    <div style={{ marginTop: 12 }}>
      {/* Sponsor + meta */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{proposal.sponsor_name}</span>
        {proposal.timeframe && (
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{proposal.timeframe}</span>
        )}
        {proposal.creator?.full_name && (
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
            Submitted by {proposal.creator.full_name}
          </span>
        )}
      </div>

      {proposal.description && (
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5, margin: '0 0 12px' }}>
          {proposal.description}
        </p>
      )}

      {/* Items table */}
      {proposal.items.length > 0 && (
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 8,
          overflow: 'hidden',
          marginBottom: 12,
        }}>
          {proposal.items.map((it, idx) => (
            <div
              key={it.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 110px 110px 110px 80px',
                gap: 10,
                padding: '10px 12px',
                borderTop: idx === 0 ? 'none' : '1px solid rgba(255,255,255,0.05)',
                fontSize: 13,
                color: 'rgba(255,255,255,0.85)',
                alignItems: 'center',
              }}
            >
              <span style={{ fontWeight: 500 }}>{it.title}</span>
              <span style={{ color: 'rgba(255,255,255,0.55)' }}>{it.deliverable_type || '—'}</span>
              <span style={{ color: 'rgba(255,255,255,0.55)' }}>{it.channel || '—'}</span>
              <span style={{ color: 'rgba(255,255,255,0.55)' }}>{it.due_month || '—'}</span>
              <span style={{ color: '#34d399', textAlign: 'right', fontWeight: 600 }}>
                {it.pay ? `$${Number(it.pay).toLocaleString()}` : '—'}
              </span>
            </div>
          ))}
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '8px 12px',
            background: 'rgba(255,255,255,0.02)',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            fontSize: 12,
            color: 'rgba(255,255,255,0.5)',
          }}>
            <span>Total:</span>
            <span style={{ color: '#34d399', fontWeight: 700 }}>${totalPay.toLocaleString()}</span>
          </div>
        </div>
      )}

    </div>
  );
}

// ─── Component ────────────────────────────────────────────────

export default function MyTasks({ onNavigate }) {
  const { profile, refreshNotifications } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [collapsedIds, setCollapsedIds] = useState(new Set());
  const [holdModalTask, setHoldModalTask] = useState(null);
  const [declineModalTask, setDeclineModalTask] = useState(null);
  const [declineReason, setDeclineReason] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const [snoozeOpenId, setSnoozeOpenId] = useState(null);
  const [snoozeDropUp, setSnoozeDropUp] = useState(true);
  const [completingIds, setCompletingIds] = useState(new Set());
  const [fadingIds, setFadingIds] = useState(new Set());
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [completedTasks, setCompletedTasks] = useState([]);
  const [openModal, setOpenModal] = useState(null); // { task, ModalComponent }
  const [confirmTask, setConfirmTask] = useState(null); // task pending confirmation
  const [deliverableMeta, setDeliverableMeta] = useState({}); // { [deliverable_id]: { title, due_date } }
  const [activeProfiles, setActiveProfiles] = useState([]); // for inline editor pickers
  const channelRef = useRef(null);
  const snoozeRef = useRef(null);

  // Close snooze dropdown on outside click
  useEffect(() => {
    if (!snoozeOpenId) return;
    const handler = (e) => {
      if (snoozeRef.current && !snoozeRef.current.contains(e.target)) {
        setSnoozeOpenId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [snoozeOpenId]);

  // Load active profiles for any task that needs an inline person picker.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, status')
        .order('full_name', { ascending: true, nullsFirst: false });
      if (cancelled || error) return;
      setActiveProfiles((data || [])
        .filter((p) => p.status !== 'archived')
        .map((p) => ({
          id: p.id,
          name: p.full_name || p.email || 'Unknown',
          role: p.role || 'member',
        })));
    })();
    return () => { cancelled = true; };
  }, []);

  // ─── Fetch tasks ──────────────────────────────────────────

  const fetchTasks = useCallback(async () => {
    if (!profile) return;
    try {
      // Fetch directly-assigned tasks.
      const { data: assigned, error: assignedErr } = await supabase
        .from('tasks')
        .select('*, workflow_instance:workflow_instances(id, workflow_id, context, status)')
        .eq('assignee_id', profile.id)
        .in('status', ['active', 'on_hold'])
        .order('created_at', { ascending: true });
      if (assignedErr) throw assignedErr;

      // Fetch sign-off tasks where this user has a pending sign-off.
      const { data: signOffRows } = await supabase
        .from('task_sign_offs')
        .select('task_id')
        .eq('user_id', profile.id)
        .is('signed_off_at', null);
      const signOffTaskIds = (signOffRows || []).map((r) => r.task_id);

      let signOffTasks = [];
      if (signOffTaskIds.length > 0) {
        const { data: soTasks } = await supabase
          .from('tasks')
          .select('*, workflow_instance:workflow_instances(id, workflow_id, context, status)')
          .in('id', signOffTaskIds)
          .eq('status', 'active')
          .eq('requires_sign_off', true)
          .order('created_at', { ascending: true });
        signOffTasks = soTasks || [];
      }

      // Merge, dedupe by id.
      const seen = new Set();
      const merged = [];
      for (const t of [...(assigned || []), ...signOffTasks]) {
        if (!seen.has(t.id)) { seen.add(t.id); merged.push(t); }
      }

      // Fetch sign-off progress for sign-off tasks.
      const soIds = merged.filter((t) => t.requires_sign_off).map((t) => t.id);
      if (soIds.length > 0) {
        const { data: allSo } = await supabase
          .from('task_sign_offs')
          .select('task_id, signed_off_at')
          .in('task_id', soIds);
        const progressMap = {};
        for (const so of allSo || []) {
          if (!progressMap[so.task_id]) progressMap[so.task_id] = { done: 0, total: 0 };
          progressMap[so.task_id].total++;
          if (so.signed_off_at) progressMap[so.task_id].done++;
        }
        // Attach progress to tasks.
        for (const t of merged) {
          if (progressMap[t.id]) t._signOffProgress = progressMap[t.id];
        }
      }

      setTasks(merged);
    } catch (err) {
      console.error('Error fetching tasks:', err);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  const fetchCompletedTasks = useCallback(async () => {
    if (!profile) return;
    try {
      const yesterday = new Date(Date.now() - 86400000).toISOString();
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('assignee_id', profile.id)
        .eq('status', 'complete')
        .gte('completed_at', yesterday)
        .order('completed_at', { ascending: false });
      if (error) throw error;
      setCompletedTasks(data || []);
    } catch (err) {
      console.error('Error fetching completed tasks:', err);
    }
  }, [profile]);

  useEffect(() => {
    fetchTasks();
    fetchCompletedTasks();
  }, [fetchTasks, fetchCompletedTasks]);

  // Fetch deliverable metadata for tasks linked to deliverables
  useEffect(() => {
    const ids = tasks
      .filter(t => t.related_entity_type === 'deliverable' && t.related_entity_id)
      .map(t => t.related_entity_id);
    if (ids.length === 0) return;
    const unique = [...new Set(ids)];
    supabase
      .from('sponsor_deliverables')
      .select('id, title, due_date, channel')
      .in('id', unique)
      .then(({ data }) => {
        if (!data) return;
        const map = {};
        for (const d of data) map[d.id] = d;
        setDeliverableMeta(map);
      });
  }, [tasks]);

  useVisibilityRefresh(() => {
    fetchTasks();
    fetchCompletedTasks();
  });

  // Realtime subscription
  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel('my-tasks-live')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'tasks',
        filter: `assignee_id=eq.${profile.id}`,
      }, () => {
        fetchTasks();
        fetchCompletedTasks();
      })
      .subscribe();
    channelRef.current = channel;
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [profile, fetchTasks, fetchCompletedTasks]);

  // ─── Actions ──────────────────────────────────────────────

  const handleComplete = async (task, payload = {}) => {
    setCompletingIds(prev => new Set(prev).add(task.id));
    try {
      await callWorkflowFn('workflow-complete-task', { task_id: task.id, payload });
      // Animate out
      setFadingIds(prev => new Set(prev).add(task.id));
      setTimeout(() => {
        setTasks(prev => prev.filter(t => t.id !== task.id));
        setFadingIds(prev => { const s = new Set(prev); s.delete(task.id); return s; });
        setCompletingIds(prev => { const s = new Set(prev); s.delete(task.id); return s; });
        refreshNotifications();
        fetchCompletedTasks();
      }, 300);
    } catch (err) {
      console.error('Complete failed:', err);
      alert(err.message);
      setCompletingIds(prev => { const s = new Set(prev); s.delete(task.id); return s; });
    }
  };

  const handleSignOff = async (task) => {
    setCompletingIds(prev => new Set(prev).add(task.id));
    try {
      await callWorkflowFn('workflow-complete-task', { task_id: task.id, action: 'sign_off' });
      // Animate out
      setFadingIds(prev => new Set(prev).add(task.id));
      setTimeout(() => {
        setTasks(prev => prev.filter(t => t.id !== task.id));
        setFadingIds(prev => { const s = new Set(prev); s.delete(task.id); return s; });
        setCompletingIds(prev => { const s = new Set(prev); s.delete(task.id); return s; });
        refreshNotifications();
        fetchCompletedTasks();
      }, 300);
    } catch (err) {
      console.error('Sign-off failed:', err);
      alert(err.message);
      setCompletingIds(prev => { const s = new Set(prev); s.delete(task.id); return s; });
    }
  };

  const handleHoldSubmit = async () => {
    if (!holdModalTask || !holdReason.trim()) return;
    try {
      await callWorkflowFn('workflow-update-task', {
        task_id: holdModalTask.id,
        action: 'hold',
        reason: holdReason.trim(),
      });
      setHoldModalTask(null);
      setHoldReason('');
      fetchTasks();
      refreshNotifications();
    } catch (err) {
      console.error('Hold failed:', err);
      alert(err.message);
    }
  };

  const handleDeclineSubmit = async () => {
    if (!declineModalTask) return;
    const task = declineModalTask;
    try {
      await callWorkflowFn('workflow-update-task', {
        task_id: task.id,
        action: 'decline',
        reason: declineReason.trim(),
      });
      setDeclineModalTask(null);
      setDeclineReason('');
      setFadingIds(prev => new Set(prev).add(task.id));
      setTimeout(() => {
        setTasks(prev => prev.filter(t => t.id !== task.id));
        setFadingIds(prev => { const s = new Set(prev); s.delete(task.id); return s; });
      }, 300);
      refreshNotifications();
    } catch (err) {
      console.error('Decline failed:', err);
      alert(err.message);
    }
  };

  const handleResume = async (taskId) => {
    try {
      await callWorkflowFn('workflow-update-task', { task_id: taskId, action: 'resume' });
      fetchTasks();
      refreshNotifications();
    } catch (err) {
      console.error('Resume failed:', err);
      alert(err.message);
    }
  };

  const handleSnooze = async (taskId, preset) => {
    const until = computeSnoozeUntil(preset);
    if (!until) return;
    try {
      await callWorkflowFn('workflow-update-task', { task_id: taskId, action: 'snooze', until });
      setSnoozeOpenId(null);
      fetchTasks();
      refreshNotifications();
    } catch (err) {
      console.error('Snooze failed:', err);
      alert(err.message);
    }
  };

  const handleUnsnooze = async (taskId) => {
    try {
      await callWorkflowFn('workflow-update-task', { task_id: taskId, action: 'unsnooze' });
      fetchTasks();
      refreshNotifications();
    } catch (err) {
      console.error('Unsnooze failed:', err);
      alert(err.message);
    }
  };

  const handlePrimaryAction = (task) => {
    const action = getStepAction(task.step_key, task);
    switch (action.type) {
      case 'complete':
        if (action.confirm) {
          handleCompleteWithConfirm(task);
        } else {
          handleComplete(task);
        }
        break;
      case 'navigate':
        if (onNavigate && action.tab) {
          const ctx = task.workflow_instance?.context || {};
          const target = action.target ? ctx[action.target] : undefined;
          onNavigate(action.tab, target);
        }
        break;
      case 'modal': {
        const entry = action.modalKey ? getWorkflowModal(action.modalKey) : null;
        if (entry?.component) {
          setOpenModal({ task, ModalComponent: entry.component });
        } else {
          handleComplete(task);
        }
        break;
      }
      case 'write_ad_read': {
        // "Write It" button opens the editor modal (no auto-complete)
        const entry = action.modalKey ? getWorkflowModal(action.modalKey) : null;
        if (entry?.component) {
          setOpenModal({ task, ModalComponent: entry.component, noAutoComplete: true });
        }
        break;
      }
      case 'editor_picker':
      case 'auto':
        // Inline picker or trigger-driven completion — no primary action.
        break;
      case 'external_link': {
        const ctx = task.workflow_instance?.context || {};
        const url = action.contextKey ? ctx[action.contextKey] : task.link_url;
        if (url) window.open(url, '_blank', 'noopener');
        break;
      }
      default:
        handleComplete(task);
    }
  };

  // Inline editor picker (for steps with action.type === 'editor_picker')
  const setEditorOnTask = async (task, editorId) => {
    const action = getStepAction(task.step_key, task);
    const key = action.context_key || 'editor_id';
    try {
      await callWorkflowFn('workflow-update-task', {
        task_id: task.id,
        action: 'set_context',
        context: { [key]: editorId },
      });
      // Optimistic local update so the picker shows the new value immediately.
      setTasks(prev => prev.map(t => {
        if (t.id !== task.id) return t;
        const ctx = { ...(t.workflow_instance?.context || {}), [key]: editorId };
        return { ...t, workflow_instance: { ...(t.workflow_instance || {}), context: ctx } };
      }));
    } catch (err) {
      console.error('Set editor failed:', err);
      alert(err.message);
    }
  };

  const handleCompleteWithConfirm = (task) => {
    setConfirmTask(task);
  };

  const confirmAndComplete = async () => {
    if (!confirmTask) return;
    const t = confirmTask;
    setConfirmTask(null);
    await handleComplete(t);
  };

  const handleModalSubmit = async (payload) => {
    if (!openModal) return;
    const t = openModal.task;
    const noAutoComplete = openModal.noAutoComplete;
    setOpenModal(null);
    if (!noAutoComplete) {
      await handleComplete(t, payload);
    }
  };

  // ─── Partition tasks ──────────────────────────────────────

  const now = new Date();
  const activeTasks = tasks.filter(t => {
    if (t.snoozed_until && new Date(t.snoozed_until) > now) return false;
    return true;
  });
  const snoozedTasks = tasks.filter(t => t.snoozed_until && new Date(t.snoozed_until) > now);

  // ─── Render ───────────────────────────────────────────────

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.header}>
          <h1 style={styles.title}>My Tasks</h1>
        </div>
        <div style={styles.loadingContainer}>
          <div style={styles.spinner} />
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>My Tasks</h1>
        <span style={styles.subtitle}>
          {activeTasks.length} active{snoozedTasks.length > 0 ? ` \u00B7 ${snoozedTasks.length} snoozed` : ''}
        </span>
      </div>

      {activeTasks.length === 0 && snoozedTasks.length === 0 && (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>&#10003;</div>
          <p style={styles.emptyText}>You're all caught up. No tasks right now.</p>
        </div>
      )}

      {/* Active + on_hold tasks */}
      <div style={styles.taskList}>
        {activeTasks.map(task => {
          const action = getStepAction(task.step_key, task);
          const isExpanded = !collapsedIds.has(task.id);
          const isFading = fadingIds.has(task.id);
          const isCompleting = completingIds.has(task.id);
          const isOnHold = task.status === 'on_hold';
          const isReviewProposal = task.step_key === 'review_proposal';
          const isWriteAdRead = action.type === 'write_ad_read';

          return (
            <div
              key={task.id}
              style={{
                ...styles.taskCard,
                ...(isOnHold ? styles.taskCardOnHold : {}),
                ...(isFading ? styles.taskCardFading : {}),
              }}
            >
              {/* Header row */}
              <div style={styles.taskHeader}>
                <div style={styles.taskTitleRow}>
                  <span style={styles.taskTitle}>{task.title}</span>
                  {isOnHold && <span style={styles.holdBadge}>ON HOLD</span>}
                  <span style={styles.taskAge}>{timeAgo(task.created_at)}</span>
                </div>
                {isOnHold && task.hold_reason && (
                  <p style={styles.holdReason}>{task.hold_reason}</p>
                )}
              </div>

              {/* Direct-task due date + link */}
              {(task.due_date || task.link_url) && (
                <div style={styles.directMeta}>
                  {task.due_date && (
                    <span style={{ ...styles.duePill, ...(new Date(task.due_date) < new Date() ? styles.duePillOverdue : {}) }}>
                      {new Date(task.due_date) < new Date() ? 'Overdue · ' : 'Due '}
                      {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                  {task.link_url && (
                    <a href={task.link_url} target="_blank" rel="noopener noreferrer" style={styles.linkBtn}>
                      {'🔗'} Open link
                    </a>
                  )}
                </div>
              )}

              {/* Summary line */}
              {!isReviewProposal && task.related_entity_type === 'deliverable' && task.related_entity_id && (() => {
                const meta = deliverableMeta[task.related_entity_id];
                const dTitle = meta?.title || '';
                const dMonth = meta?.due_date
                  ? new Date(meta.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                  : '';
                const channelLabels = { mayday: 'MD', tmb: 'TMB', socials: 'SOC' };
                const dChannel = meta?.channel ? channelLabels[meta.channel] || meta.channel : '';
                return (
                  <p style={styles.entitySummary}>
                    {dTitle}{dChannel ? ` \u2022 ${dChannel}` : ''}{dMonth ? ` \u2022 ${dMonth}` : ''}
                  </p>
                );
              })()}
              {!isReviewProposal && task.related_entity_type && task.related_entity_type !== 'deliverable' && (
                <p style={styles.entitySummary}>
                  {task.related_entity_type}{task.related_entity_id ? ` \u2022 ${task.related_entity_id.slice(0, 8)}...` : ''}
                </p>
              )}

              {/* Inline proposal review */}
              {isReviewProposal && !isOnHold && (
                <ReviewProposalCard task={task} />
              )}

              {/* Expanded description (default tasks only) */}
              {!isReviewProposal && isExpanded && task.description && (
                <div style={styles.expandedSection}>
                  <p style={styles.description}>{task.description}</p>
                </div>
              )}

              {/* Sign-off progress indicator */}
              {task.requires_sign_off && task._signOffProgress && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>
                  {task._signOffProgress.done} of {task._signOffProgress.total} signed off
                </div>
              )}

              {/* Action row */}
              <div style={{ ...styles.actionRow, ...(isWriteAdRead ? { flexWrap: 'wrap' } : {}) }}>
                {task.requires_sign_off && !isOnHold ? (
                  <button
                    style={styles.signOffBtn}
                    onClick={() => handleSignOff(task)}
                    disabled={isCompleting}
                  >
                    {isCompleting ? 'Signing off…' : 'Sign Off'}
                  </button>
                ) : isOnHold ? (
                  <button
                    style={styles.resumeBtn}
                    onClick={() => handleResume(task.id)}
                  >
                    Resume
                  </button>
                ) : isWriteAdRead ? (
                  <>
                    <button
                      style={styles.primaryBtn}
                      onClick={() => handlePrimaryAction(task)}
                      disabled={isCompleting}
                    >
                      Write It
                    </button>
                    <button
                      style={styles.markDoneBtn}
                      onClick={() => handleCompleteWithConfirm(task)}
                      disabled={isCompleting}
                    >
                      {isCompleting ? 'Working...' : 'Complete'}
                    </button>
                  </>
                ) : action.type === 'editor_picker' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                    <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap' }}>Assign an editor</label>
                    <select
                      value={task.workflow_instance?.context?.[action.context_key || 'editor_id'] || ''}
                      onChange={(e) => setEditorOnTask(task, e.target.value)}
                      style={{
                        flex: 1,
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 6,
                        padding: '6px 10px',
                        color: '#fff',
                        fontSize: 13,
                      }}
                    >
                      <option value="">— Pick someone —</option>
                      {activeProfiles.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} ({p.role})</option>
                      ))}
                    </select>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontStyle: 'italic', whiteSpace: 'nowrap' }}>
                      {action.label}
                    </span>
                  </div>
                ) : action.type === 'auto' ? (
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>
                    {action.label}
                  </span>
                ) : (action.type === 'external_link' || task.link_url) ? (
                  <>
                    <button
                      style={styles.primaryBtn}
                      onClick={() => {
                        const url = task.link_url || (task.workflow_instance?.context || {})[action.contextKey];
                        if (url) window.open(url, '_blank', 'noopener');
                      }}
                      disabled={isCompleting}
                    >
                      {task.link_url ? 'Go To Work' : action.label}
                    </button>
                    <button
                      style={styles.markDoneBtn}
                      onClick={() => handleCompleteWithConfirm(task)}
                      disabled={isCompleting}
                    >
                      {isCompleting ? 'Working...' : 'Mark Complete'}
                    </button>
                  </>
                ) : !isReviewProposal && (
                  <>
                    <button
                      style={styles.primaryBtn}
                      onClick={() => task.nav_target && onNavigate ? onNavigate(task.nav_target) : handlePrimaryAction(task)}
                      disabled={isCompleting}
                    >
                      {isCompleting ? 'Working...' : (task.nav_target ? 'Do it →' : action.label)}
                    </button>
                    {(action.type === 'navigate' || task.nav_target) && (
                      <button
                        style={styles.markDoneBtn}
                        onClick={() => handleComplete(task)}
                        disabled={isCompleting}
                      >
                        Mark Done
                      </button>
                    )}
                  </>
                )}

                {!isOnHold && (
                  <button
                    style={styles.holdBtn}
                    onClick={() => setHoldModalTask(task)}
                  >
                    Hold
                  </button>
                )}

                {/* Snooze */}
                <div style={styles.snoozeWrapper} ref={snoozeOpenId === task.id ? snoozeRef : undefined}>
                  <button
                    style={styles.snoozeBtn}
                    onClick={(e) => {
                      if (snoozeOpenId === task.id) {
                        setSnoozeOpenId(null);
                      } else {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setSnoozeDropUp(rect.top > 200);
                        setSnoozeOpenId(task.id);
                      }
                    }}
                  >
                    Snooze
                  </button>
                  {snoozeOpenId === task.id && (
                    <div style={snoozeDropUp ? styles.snoozeDropdown : styles.snoozeDropdownBelow}>
                      {[
                        { key: '1h', label: '1 hour' },
                        { key: '4h', label: '4 hours' },
                        { key: 'tomorrow', label: 'Tomorrow 9am' },
                        { key: 'next_week', label: 'Next Monday 9am' },
                      ].map(opt => (
                        <button
                          key={opt.key}
                          style={styles.snoozeOption}
                          onClick={() => handleSnooze(task.id, opt.key)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Decline */}
                {!isReviewProposal && action.type !== 'auto' && (
                  <button
                    style={styles.declineBtn}
                    onClick={() => setDeclineModalTask(task)}
                  >
                    Decline
                  </button>
                )}

                {/* Expand toggle (skip for review_proposal — full proposal already inline) */}
                {!isReviewProposal && task.description && (
                  <button
                    style={styles.expandBtn}
                    onClick={() => setCollapsedIds(prev => {
                      const next = new Set(prev);
                      if (isExpanded) next.add(task.id);
                      else next.delete(task.id);
                      return next;
                    })}
                  >
                    {isExpanded ? 'Less' : 'More'}
                  </button>
                )}

                {/* Accept / Decline pinned to the right for review_proposal */}
                {isReviewProposal && !isOnHold && (
                  <>
                    <button
                      style={{ ...styles.acceptBtn, marginLeft: 'auto', opacity: isCompleting ? 0.6 : 1 }}
                      onClick={() => handleComplete(task, { outcome: 'accept' })}
                      disabled={isCompleting}
                    >
                      Accept Proposal
                    </button>
                    <button
                      style={{ ...styles.declineBtn, opacity: isCompleting ? 0.6 : 1 }}
                      onClick={() => handleComplete(task, { outcome: 'deny' })}
                      disabled={isCompleting}
                    >
                      Decline
                    </button>
                  </>
                )}

                {/* Go to Deliverables — pinned right */}
                {isWriteAdRead && !isOnHold && (
                  <button
                    style={styles.goToDeliverableLink}
                    onClick={() => {
                      const ctx = task.workflow_instance?.context || {};
                      if (onNavigate) onNavigate('deliverables', ctx.campaign_id);
                    }}
                  >
                    Go to Deliverables &rsaquo;
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Snoozed section */}
      {snoozedTasks.length > 0 && (
        <div style={styles.section}>
          <button
            style={styles.sectionHeader}
            onClick={() => setShowSnoozed(!showSnoozed)}
          >
            <span>Snoozed ({snoozedTasks.length})</span>
            <span style={styles.chevron}>{showSnoozed ? '\u25B2' : '\u25BC'}</span>
          </button>
          {showSnoozed && snoozedTasks.map(task => (
            <div key={task.id} style={{ ...styles.taskCard, opacity: 0.5 }}>
              <div style={styles.taskHeader}>
                <div style={styles.taskTitleRow}>
                  <span style={styles.taskTitle}>{task.title}</span>
                  <span style={styles.snoozeBadge}>Wakes in {snoozeLabel(task.snoozed_until)}</span>
                </div>
              </div>
              <div style={styles.actionRow}>
                <button style={styles.secondaryBtn} onClick={() => handleUnsnooze(task.id)}>
                  Wake now
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Completed today section */}
      {completedTasks.length > 0 && (
        <div style={styles.section}>
          <button
            style={styles.sectionHeader}
            onClick={() => setShowCompleted(!showCompleted)}
          >
            <span>Completed recently ({completedTasks.length})</span>
            <span style={styles.chevron}>{showCompleted ? '\u25B2' : '\u25BC'}</span>
          </button>
          {showCompleted && completedTasks.map(task => (
            <div key={task.id} style={{ ...styles.taskCard, opacity: 0.4 }}>
              <div style={styles.taskHeader}>
                <div style={styles.taskTitleRow}>
                  <span style={{ ...styles.taskTitle, textDecoration: 'line-through' }}>{task.title}</span>
                  <span style={styles.taskAge}>{timeAgo(task.completed_at)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Hold modal */}
      {holdModalTask && (
        <div style={styles.modalOverlay} onClick={() => { setHoldModalTask(null); setHoldReason(''); }}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Put task on hold</h3>
            <p style={styles.modalSubtitle}>{holdModalTask.title}</p>
            <textarea
              style={styles.holdInput}
              placeholder="What's blocking this?"
              value={holdReason}
              onChange={e => setHoldReason(e.target.value)}
              autoFocus
              rows={3}
            />
            <div style={styles.modalActions}>
              <button
                style={styles.secondaryBtn}
                onClick={() => { setHoldModalTask(null); setHoldReason(''); }}
              >
                Cancel
              </button>
              <button
                style={{ ...styles.primaryBtn, background: '#eab308' }}
                onClick={handleHoldSubmit}
                disabled={!holdReason.trim()}
              >
                Put on Hold
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Decline modal */}
      {declineModalTask && (
        <div style={styles.modalOverlay} onClick={() => { setDeclineModalTask(null); setDeclineReason(''); }}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Decline this task?</h3>
            <p style={styles.modalSubtitle}>{declineModalTask.title}</p>
            <textarea
              style={styles.holdInput}
              placeholder="Reason (optional) — sent to the admins"
              value={declineReason}
              onChange={e => setDeclineReason(e.target.value)}
              autoFocus
              rows={3}
            />
            <div style={styles.modalActions}>
              <button
                style={styles.secondaryBtn}
                onClick={() => { setDeclineModalTask(null); setDeclineReason(''); }}
              >
                Cancel
              </button>
              <button
                style={{ ...styles.primaryBtn, background: '#ef4444' }}
                onClick={handleDeclineSubmit}
              >
                Decline Task
              </button>
            </div>
          </div>
        </div>
      )}

      {openModal && (
        <openModal.ModalComponent
          task={openModal.task}
          onSubmit={handleModalSubmit}
          onClose={() => setOpenModal(null)}
        />
      )}

      {/* Confirm complete dialog */}
      {confirmTask && (
        <div style={styles.modalOverlay} onClick={() => setConfirmTask(null)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Complete this task?</h3>
            <p style={styles.modalSubtitle}>{confirmTask.title}</p>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: '8px 0 0' }}>
              This will mark the ad read as done and advance the workflow.
            </p>
            <div style={styles.modalActions}>
              <button
                style={styles.secondaryBtn}
                onClick={() => setConfirmTask(null)}
              >
                Cancel
              </button>
              <button
                style={styles.primaryBtn}
                onClick={confirmAndComplete}
              >
                Complete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Styles ────────────────────────────────────────────────────

const styles = {
  page: {
    padding: '32px 40px',
    maxWidth: 800,
    margin: '0 auto',
  },
  header: {
    marginBottom: 24,
    display: 'flex',
    alignItems: 'baseline',
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    color: '#fff',
    margin: 0,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.4)',
  },
  loadingContainer: {
    display: 'flex',
    justifyContent: 'center',
    padding: 60,
  },
  spinner: {
    width: 24,
    height: 24,
    border: '2px solid rgba(255,255,255,0.1)',
    borderTopColor: '#6366f1',
    borderRadius: '50%',
    animation: 'spin 0.6s linear infinite',
  },
  emptyState: {
    textAlign: 'center',
    padding: '60px 20px',
  },
  emptyIcon: {
    fontSize: 48,
    color: 'rgba(99,102,241,0.3)',
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.4)',
    margin: 0,
  },
  taskList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  taskCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: '14px 18px',
    transition: 'opacity 0.3s ease, transform 0.3s ease',
  },
  taskCardOnHold: {
    borderLeft: '3px solid #eab308',
  },
  taskCardFading: {
    opacity: 0,
    transform: 'translateY(-10px)',
  },
  taskHeader: {
    marginBottom: 6,
  },
  taskTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  taskTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: '#fff',
  },
  holdBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: '#eab308',
    background: 'rgba(234,179,8,0.1)',
    padding: '2px 6px',
    borderRadius: 4,
    letterSpacing: 0.5,
  },
  snoozeBadge: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    fontStyle: 'italic',
  },
  taskAge: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.25)',
    marginLeft: 'auto',
  },
  holdReason: {
    fontSize: 13,
    color: 'rgba(234,179,8,0.7)',
    margin: '4px 0 0',
    fontStyle: 'italic',
  },
  entitySummary: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.3)',
    margin: '0 0 8px',
    textTransform: 'capitalize',
  },
  directMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: '0 0 8px',
    flexWrap: 'wrap',
  },
  duePill: {
    fontSize: 11,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.6)',
    background: 'rgba(255,255,255,0.06)',
    borderRadius: 5,
    padding: '2px 8px',
  },
  duePillOverdue: {
    color: '#fca5a5',
    background: 'rgba(239,68,68,0.14)',
  },
  linkBtn: {
    fontSize: 11,
    fontWeight: 600,
    color: '#a5b4fc',
    background: 'rgba(99,102,241,0.12)',
    border: '1px solid rgba(99,102,241,0.25)',
    borderRadius: 5,
    padding: '2px 8px',
    textDecoration: 'none',
  },
  expandedSection: {
    padding: '8px 0',
    borderTop: '1px solid rgba(255,255,255,0.04)',
    marginBottom: 8,
  },
  description: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 1.5,
    margin: 0,
    whiteSpace: 'pre-wrap',
  },
  actionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  primaryBtn: {
    background: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '7px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  resumeBtn: {
    background: 'rgba(234,179,8,0.15)',
    color: '#eab308',
    border: '1px solid rgba(234,179,8,0.3)',
    borderRadius: 6,
    padding: '7px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  secondaryBtn: {
    background: 'transparent',
    color: 'rgba(255,255,255,0.5)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    padding: '6px 12px',
    fontSize: 12,
    cursor: 'pointer',
  },
  holdBtn: {
    background: 'rgba(249,115,22,0.15)',
    color: '#fb923c',
    border: '1px solid rgba(249,115,22,0.4)',
    borderRadius: 6,
    padding: '7px 14px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  declineBtn: {
    background: 'rgba(239,68,68,0.12)',
    color: '#f87171',
    border: '1px solid rgba(239,68,68,0.35)',
    borderRadius: 6,
    padding: '7px 14px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  snoozeBtn: {
    background: 'rgba(234,179,8,0.15)',
    color: '#facc15',
    border: '1px solid rgba(234,179,8,0.4)',
    borderRadius: 6,
    padding: '7px 14px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  markDoneBtn: {
    background: 'rgba(16,185,129,0.12)',
    color: '#34d399',
    border: '1px solid rgba(16,185,129,0.3)',
    borderRadius: 6,
    padding: '7px 14px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  signOffBtn: {
    background: 'rgba(6,182,212,0.15)',
    color: '#06b6d4',
    border: '1px solid rgba(6,182,212,0.35)',
    borderRadius: 6,
    padding: '7px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  acceptBtn: {
    background: '#10b981',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '9px 18px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  declineBtn: {
    background: 'rgba(239,68,68,0.12)',
    color: '#fca5a5',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 8,
    padding: '9px 18px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  expandBtn: {
    background: 'transparent',
    color: 'rgba(255,255,255,0.3)',
    border: 'none',
    padding: '6px 8px',
    fontSize: 12,
    cursor: 'pointer',
    marginLeft: 'auto',
  },
  goToDeliverableLink: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.3)',
    fontSize: 11,
    cursor: 'pointer',
    padding: '4px 0',
    marginLeft: 'auto',
    fontFamily: 'inherit',
  },
  snoozeWrapper: {
    position: 'relative',
  },
  snoozeDropdown: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    marginBottom: 4,
    background: '#1a1a2e',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: 4,
    zIndex: 10,
    minWidth: 160,
    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
  },
  snoozeDropdownBelow: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 4,
    background: '#1a1a2e',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: 4,
    zIndex: 10,
    minWidth: 160,
    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
  },
  snoozeOption: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    color: 'rgba(255,255,255,0.7)',
    border: 'none',
    padding: '8px 12px',
    fontSize: 13,
    cursor: 'pointer',
    borderRadius: 4,
  },
  section: {
    marginTop: 24,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    background: 'transparent',
    border: 'none',
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    padding: '8px 0',
    marginBottom: 8,
  },
  chevron: {
    fontSize: 10,
  },
  // ─── Modal ──────────────────────────────────────────────
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#1a1a2e',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 24,
    width: 400,
    maxWidth: '90vw',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: '#fff',
    margin: '0 0 4px',
  },
  modalSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
    margin: '0 0 16px',
  },
  holdInput: {
    width: '100%',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    color: '#fff',
    fontSize: 14,
    padding: '10px 12px',
    resize: 'vertical',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 16,
  },
};
