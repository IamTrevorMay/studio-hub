import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import TaskEditModal from '../components/TaskEditModal';
import MemberAssignmentModal from '../components/MemberAssignmentModal';
import ContractorAssignmentModal from '../components/ContractorAssignmentModal';
import { mobileTokens, mobileTapButton } from '../utils/mobileTokens';
import { fetchAllRows } from './analytics/utils';
import backdropDismiss from '../lib/backdropDismiss';
import { colors } from '../lib/styleTokens';

// Mobile Workflows: Progress table + assignment shortcuts only.
// Kanban flows + automations are desktop-only — the value on a phone
// is "what is everyone working on right now and can I edit / assign
// quickly", which ProgressTable + the two modal create flows cover.

const TEAM_ROLES = ['admin', 'director', 'member', 'director_creative', 'director_comms'];
const ROLE_PRIORITY = { admin: 0, director: 1, director_creative: 1, director_comms: 1, member: 3 };

export default function WorkflowsMobile() {
  const { isAdmin, profile } = useAuth();
  const [profiles, setProfiles] = useState([]);
  const [teamProfiles, setTeamProfiles] = useState([]);
  const [contractorProfiles, setContractorProfiles] = useState([]);
  const [teamPending, setTeamPending] = useState([]);
  const [teamDone, setTeamDone] = useState([]);
  const [flPending, setFlPending] = useState([]);
  const [flDone, setFlDone] = useState([]);
  const [sprintActiveTaskIds, setSprintActiveTaskIds] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [assignSheetOpen, setAssignSheetOpen] = useState(false);
  const [memberAssignOpen, setMemberAssignOpen] = useState(false);
  const [contractorAssignOpen, setContractorAssignOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [editingContractorAssign, setEditingContractorAssign] = useState(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, status')
        .order('full_name', { ascending: true, nullsFirst: false });
      if (cancelled) return;
      const active = (data || []).filter((p) => p.status !== 'archived');
      setProfiles(active);
      // Dedupe by name (admin > director > assistant > member).
      const byKey = new Map();
      for (const p of active.filter((p) => TEAM_ROLES.includes(p.role))) {
        const key = (p.full_name || p.email || p.id).trim().toLowerCase();
        const prev = byKey.get(key);
        const pri = ROLE_PRIORITY[p.role] ?? 99;
        const prevPri = prev ? (ROLE_PRIORITY[prev.role] ?? 99) : 99;
        if (!prev || pri < prevPri) byKey.set(key, p);
      }
      setTeamProfiles(
        Array.from(byKey.values()).map((p) => ({
          id: p.id, name: p.full_name || p.email || 'Unknown', role: p.role || 'member',
        })),
      );
      setContractorProfiles(
        active.filter((p) => p.role === 'contractor' || p.role === 'freelancer').map((p) => ({
          id: p.id, name: p.full_name || p.email || 'Unknown', role: 'contractor',
        })),
      );
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  const fetchProgress = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true); setError(null);
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
    const TASK_COLS = 'id, title, description, assignee_id, due_date, status, snoozed_until, hold_reason, planned_date, workflow_instance_id, automation_id, created_at';
    const TASK_DONE_COLS = TASK_COLS + ', completed_at';
    const FL_COLS = 'id, title, description, contractor_id, status, due_date, due_time, pay_amount, asset_url, completed_at, created_at, created_by';
    try {
      const [pend, { data: completed }, { data: flPendData }, { data: flDoneData }, { data: sprintRows }] = await Promise.all([
        fetchAllRows(supabase.from('tasks').select(TASK_COLS).in('status', ['active', 'pending', 'on_hold']).not('assignee_id', 'is', null).order('created_at', { ascending: true }).order('id', { ascending: true })),
        supabase.from('tasks').select(TASK_DONE_COLS).eq('status', 'complete').gte('completed_at', cutoff).not('assignee_id', 'is', null),
        supabase.from('contractor_assignments').select(FL_COLS).in('status', ['assigned', 'in_progress']),
        supabase.from('contractor_assignments').select(FL_COLS).eq('status', 'completed').gte('completed_at', cutoff),
        supabase.from('personal_tasks').select('task_id, profiles!personal_tasks_created_by_fkey!inner(role)').eq('status', 'in_progress').not('task_id', 'is', null).eq('profiles.role', 'admin'),
      ]);
      setTeamPending(pend || []);
      setTeamDone(completed || []);
      setFlPending((flPendData || []).map((a) => ({ ...a, assignee_id: a.contractor_id })));
      setFlDone((flDoneData || []).map((a) => ({ ...a, assignee_id: a.contractor_id })));
      setSprintActiveTaskIds(new Set((sprintRows || []).map((r) => r.task_id)));
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => { fetchProgress(); }, [fetchProgress]);

  const teamByAssignee = useMemo(() => {
    const map = {};
    const ensure = (id) => (map[id] || (map[id] = { pending: [], done: [] }));
    for (const t of teamPending) if (t.assignee_id) ensure(t.assignee_id).pending.push(t);
    for (const t of teamDone) if (t.assignee_id) ensure(t.assignee_id).done.push(t);
    return map;
  }, [teamPending, teamDone]);

  const contractorByAssignee = useMemo(() => {
    const map = {};
    const ensure = (id) => (map[id] || (map[id] = { pending: [], done: [] }));
    for (const t of flPending) if (t.assignee_id) ensure(t.assignee_id).pending.push(t);
    for (const t of flDone) if (t.assignee_id) ensure(t.assignee_id).done.push(t);
    return map;
  }, [flPending, flDone]);

  if (!isAdmin) {
    return <div style={styles.empty}>Admin access required.</div>;
  }

  const groups = [
    { key: 'team', label: 'Team', profiles: teamProfiles, byAssignee: teamByAssignee },
    { key: 'contractors', label: 'Contractors', profiles: contractorProfiles, byAssignee: contractorByAssignee },
  ];

  function handleTaskClick(task, groupKey) {
    if (!task || typeof task.id !== 'string') return;
    if (task.id.startsWith('progress-') || task.id.startsWith('sprint-')) return;
    if (groupKey === 'contractors') setEditingContractorAssign(task);
    else setEditingTask(task);
  }

  // Delete straight from the edit modal (mirrors desktop). editingTask is
  // always a real `tasks` row here.
  async function deleteEditingTask() {
    const task = editingTask;
    if (!task) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${task.title}"? This deletes the task and can't be undone.`)) return;
    const { error } = await supabase.from('tasks').delete().eq('id', task.id);
    if (error) { console.error('Delete task failed:', error); return; }
    setEditingTask(null);
    fetchProgress();
  }

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <h1 style={styles.title}>Progress</h1>
        <p style={styles.hint}>
          What everyone's working on right now. Flows + automations live on desktop.
        </p>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {loading ? (
        <div style={styles.empty}>Loading…</div>
      ) : (
        <div style={styles.progressWrap}>
          <style>{`@keyframes wfm-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }`}</style>
          {groups
            .filter((g) => g.profiles.length > 0)
            .map((g) => (
              <div key={g.key} style={styles.group}>
                <div style={styles.groupLabel}>{g.label}</div>
                {g.profiles.map((p) => (
                  <PersonCard
                    key={p.id}
                    person={p}
                    data={g.byAssignee[p.id]}
                    sprintActiveTaskIds={sprintActiveTaskIds}
                    onTaskClick={(t) => handleTaskClick(t, g.key)}
                  />
                ))}
              </div>
            ))}
        </div>
      )}

      {/* FAB: + Assignment */}
      <button onClick={() => setAssignSheetOpen(true)} style={styles.fab} aria-label="New assignment">+</button>

      {assignSheetOpen && (
        <div style={styles.sheetBackdrop} {...backdropDismiss(() => setAssignSheetOpen(false))}>
          <div style={styles.sheet} onClick={(e) => e.stopPropagation()}>
            <div style={styles.sheetGrabber} />
            <div style={styles.sheetTitle}>New assignment</div>
            <button
              style={styles.sheetItem}
              onClick={() => { setAssignSheetOpen(false); setMemberAssignOpen(true); }}
            >
              <div style={styles.sheetLabel}>Member</div>
              <div style={styles.sheetDesc}>Team / assistant / partner — one-off task</div>
            </button>
            <button
              style={styles.sheetItem}
              onClick={() => { setAssignSheetOpen(false); setContractorAssignOpen(true); }}
            >
              <div style={styles.sheetLabel}>Contractor</div>
              <div style={styles.sheetDesc}>Contractor — paid assignment</div>
            </button>
            <button style={styles.sheetCancel} onClick={() => setAssignSheetOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      <MemberAssignmentModal
        open={memberAssignOpen}
        onClose={() => setMemberAssignOpen(false)}
        onCreated={fetchProgress}
      />
      <ContractorAssignmentModal
        open={contractorAssignOpen || !!editingContractorAssign}
        existing={editingContractorAssign || undefined}
        onClose={() => { setContractorAssignOpen(false); setEditingContractorAssign(null); }}
        onCreated={fetchProgress}
        onSaved={fetchProgress}
        currentUserId={profile?.id}
      />
      <TaskEditModal
        open={!!editingTask}
        task={editingTask}
        profiles={profiles}
        onClose={() => setEditingTask(null)}
        onSaved={fetchProgress}
        onDelete={deleteEditingTask}
      />
    </div>
  );
}

// Active = being worked right now: sprint "In Progress", or not snoozed /
// on-hold / planned-for-later. Planned/snoozed/on-hold are intentionally
// dropped on mobile — the ask is "what's in progress", not the full queue.
function activeOf(pending, sprintActiveTaskIds) {
  const now = Date.now();
  return (pending || []).filter((t) => {
    if (sprintActiveTaskIds && sprintActiveTaskIds.has(t.id)) return true;
    const snoozed = t.snoozed_until && new Date(t.snoozed_until).getTime() > now;
    return !snoozed && t.status !== 'on_hold' && !t.planned_date;
  });
}

function PersonCard({ person, data, sprintActiveTaskIds, onTaskClick }) {
  const d = data || { pending: [], done: [] };
  const active = activeOf(d.pending, sprintActiveTaskIds);
  const allDone = d.done || [];
  const doneShown = allDone.slice(0, 4);

  const clickable = (t) => typeof t.id === 'string' && !t.id.startsWith('progress-') && !t.id.startsWith('sprint-');

  return (
    <div style={styles.card}>
      <div style={styles.cardHead}>
        <span style={styles.personName}>{person.name}</span>
        <span style={styles.roleBadge}>{person.role}</span>
        {active.length > 0 && (
          <span style={styles.activePill}>{active.length} active</span>
        )}
      </div>

      {active.length === 0 ? (
        <div style={styles.nothing}>Nothing in progress</div>
      ) : (
        <div style={styles.taskList}>
          {active.map((t) => {
            const can = clickable(t);
            return (
              <button
                key={t.id}
                onClick={() => can && onTaskClick(t)}
                disabled={!can}
                style={{ ...styles.taskRow, cursor: can ? 'pointer' : 'default' }}
              >
                <span style={styles.dot} />
                <span style={styles.taskTitle}>{t.title}</span>
              </button>
            );
          })}
        </div>
      )}

      {doneShown.length > 0 && (
        <div style={styles.doneWrap}>
          <div style={styles.doneLabel}>Done · 7d</div>
          {doneShown.map((t) => {
            const can = clickable(t);
            return (
              <button
                key={t.id}
                onClick={() => can && onTaskClick(t)}
                disabled={!can}
                style={{ ...styles.doneRow, cursor: can ? 'pointer' : 'default' }}
              >
                <span style={styles.check}>✓</span>
                <span style={styles.doneTitle}>{t.title}</span>
              </button>
            );
          })}
          {allDone.length > doneShown.length && (
            <div style={styles.doneMore}>+{allDone.length - doneShown.length} more</div>
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  root: {
    display: 'flex', flexDirection: 'column', minHeight: '100%',
    background: colors.bg, color: colors.textBright, position: 'relative',
  },
  header: { padding: `${mobileTokens.space.lg}px ${mobileTokens.space.lg}px ${mobileTokens.space.md}px` },
  title: { margin: 0, fontSize: mobileTokens.font.xl, fontWeight: 800, color: '#fff', letterSpacing: '-0.3px' },
  hint: { margin: '6px 0 0', fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.45)', lineHeight: 1.45 },
  empty: { padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: mobileTokens.font.md },
  error: { margin: `0 ${mobileTokens.space.lg}px`, padding: 10, background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', borderRadius: mobileTokens.radius.sm, fontSize: mobileTokens.font.sm },
  progressWrap: {
    padding: `0 ${mobileTokens.space.lg}px ${mobileTokens.space.xxxl}px`,
    display: 'flex', flexDirection: 'column', gap: 20,
  },
  group: { display: 'flex', flexDirection: 'column', gap: 10 },
  groupLabel: {
    fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.35)', padding: '4px 2px 0',
  },
  card: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: mobileTokens.radius.md,
    padding: `${mobileTokens.space.md}px`,
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  cardHead: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  personName: { fontSize: mobileTokens.font.md, fontWeight: 700, color: '#fff' },
  roleBadge: {
    fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.5)',
    background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '2px 6px',
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  activePill: {
    marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: '#facc15',
    background: 'rgba(250,204,21,0.1)', borderRadius: 4, padding: '2px 7px',
  },
  nothing: { fontSize: mobileTokens.font.sm, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' },
  taskList: { display: 'flex', flexDirection: 'column', gap: 6 },
  taskRow: {
    ...mobileTapButton,
    width: '100%', minHeight: 36, display: 'flex', alignItems: 'center',
    justifyContent: 'flex-start', gap: 8,
    background: 'transparent', border: 'none', padding: '4px 0', margin: 0,
    textAlign: 'left', fontFamily: 'inherit',
  },
  dot: {
    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
    background: '#facc15', boxShadow: '0 0 5px rgba(250,204,21,0.7)',
    animation: 'wfm-blink 1.2s ease-in-out infinite',
  },
  taskTitle: {
    flex: 1, minWidth: 0, fontSize: mobileTokens.font.sm, color: 'rgba(255,255,255,0.85)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  doneWrap: {
    display: 'flex', flexDirection: 'column', gap: 4,
    borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 8,
  },
  doneLabel: {
    fontSize: 9, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.3)',
  },
  doneRow: {
    ...mobileTapButton,
    width: '100%', minHeight: 30, display: 'flex', alignItems: 'center',
    justifyContent: 'flex-start', gap: 8,
    background: 'transparent', border: 'none', padding: '2px 0', margin: 0,
    textAlign: 'left', fontFamily: 'inherit',
  },
  check: { color: '#22c55e', fontSize: 11, flexShrink: 0 },
  doneTitle: {
    flex: 1, minWidth: 0, fontSize: mobileTokens.font.sm, color: 'rgba(255,255,255,0.45)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  doneMore: { fontSize: 10, color: 'rgba(255,255,255,0.3)', paddingLeft: 19 },
  fab: {
    position: 'fixed', right: 18, bottom: 86,
    width: 56, height: 56, borderRadius: '50%',
    background: colors.accent, color: colors.white, border: 'none',
    fontSize: 30, lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit',
    boxShadow: '0 8px 22px rgba(91, 143, 199,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 50,
  },
  sheetBackdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
    zIndex: 200, display: 'flex', alignItems: 'flex-end',
  },
  sheet: {
    width: '100%', background: colors.bgHover,
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    padding: `8px ${mobileTokens.space.lg}px calc(${mobileTokens.space.lg}px + ${mobileTokens.safeBottom})`,
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  sheetGrabber: { width: 36, height: 4, background: 'rgba(255,255,255,0.2)', borderRadius: 2, alignSelf: 'center', marginBottom: 8 },
  sheetTitle: { fontSize: mobileTokens.font.sm, color: 'rgba(255,255,255,0.4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, paddingLeft: 4 },
  sheetItem: {
    ...mobileTapButton,
    width: '100%', textAlign: 'left',
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.md}px`,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: mobileTokens.radius.md,
    color: '#fff', alignItems: 'flex-start', display: 'flex',
    flexDirection: 'column', gap: 2,
  },
  sheetLabel: { fontSize: mobileTokens.font.md, fontWeight: 700, color: '#fff' },
  sheetDesc: { fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.5)' },
  sheetCancel: {
    ...mobileTapButton,
    width: '100%', marginTop: 4,
    padding: `${mobileTokens.space.md}px`,
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: mobileTokens.radius.md,
    color: 'rgba(255,255,255,0.6)', fontSize: mobileTokens.font.md, fontWeight: 600,
  },
};
