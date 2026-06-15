import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import ProgressTable from '../components/workflows/ProgressTable';
import TaskEditModal from '../components/TaskEditModal';
import MemberAssignmentModal from '../components/MemberAssignmentModal';
import ContractorAssignmentModal from '../components/ContractorAssignmentModal';
import { mobileTokens, mobileTapButton } from '../utils/mobileTokens';

// Mobile Workflows: Progress table + assignment shortcuts only.
// Kanban flows + automations are desktop-only — the value on a phone
// is "what is everyone working on right now and can I edit / assign
// quickly", which ProgressTable + the two modal create flows cover.

const TEAM_ROLES = ['admin', 'assistant', 'member', 'director_creative', 'director_comms'];
const ROLE_PRIORITY = { admin: 0, director_creative: 1, director_comms: 1, assistant: 2, member: 3 };

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
        active.filter((p) => p.role === 'freelancer').map((p) => ({
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
    const FL_COLS = 'id, title, description, freelancer_id, status, due_date, pay_amount, asset_url, completed_at, created_at, created_by';
    try {
      const [{ data: pend }, { data: completed }, { data: flPendData }, { data: flDoneData }, { data: sprintRows }] = await Promise.all([
        supabase.from('tasks').select(TASK_COLS).in('status', ['active', 'pending', 'on_hold']).not('assignee_id', 'is', null),
        supabase.from('tasks').select(TASK_DONE_COLS).eq('status', 'complete').gte('completed_at', cutoff).not('assignee_id', 'is', null),
        supabase.from('freelancer_assignments').select(FL_COLS).in('status', ['assigned', 'in_progress']),
        supabase.from('freelancer_assignments').select(FL_COLS).eq('status', 'completed').gte('completed_at', cutoff),
        supabase.from('personal_tasks').select('task_id, profiles!personal_tasks_created_by_fkey!inner(role)').eq('status', 'in_progress').not('task_id', 'is', null).eq('profiles.role', 'admin'),
      ]);
      setTeamPending(pend || []);
      setTeamDone(completed || []);
      setFlPending((flPendData || []).map((a) => ({ ...a, assignee_id: a.freelancer_id })));
      setFlDone((flDoneData || []).map((a) => ({ ...a, assignee_id: a.freelancer_id })));
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

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <h1 style={styles.title}>Workflows</h1>
        <p style={styles.hint}>
          Flows + automations live on desktop. Use this view to glance at
          team progress and create assignments on the go.
        </p>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {loading ? (
        <div style={styles.empty}>Loading…</div>
      ) : (
        <div style={styles.progressWrap}>
          <ProgressTable
            groups={[
              { key: 'team', label: 'Team', profiles: teamProfiles, byAssignee: teamByAssignee },
              { key: 'contractors', label: 'Contractors', profiles: contractorProfiles, byAssignee: contractorByAssignee },
            ]}
            sprintActiveTaskIds={sprintActiveTaskIds}
            onTaskClick={(task, person, groupKey) => {
              if (groupKey === 'contractors') setEditingContractorAssign(task);
              else setEditingTask(task);
            }}
          />
        </div>
      )}

      {/* FAB: + Assignment */}
      <button onClick={() => setAssignSheetOpen(true)} style={styles.fab} aria-label="New assignment">+</button>

      {assignSheetOpen && (
        <div style={styles.sheetBackdrop} onClick={() => setAssignSheetOpen(false)}>
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
              <div style={styles.sheetDesc}>Freelancer — paid assignment</div>
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
      />
    </div>
  );
}

const styles = {
  root: {
    display: 'flex', flexDirection: 'column', minHeight: '100%',
    background: '#0f0f1a', color: '#e2e8f0', position: 'relative',
  },
  header: { padding: `${mobileTokens.space.lg}px ${mobileTokens.space.lg}px ${mobileTokens.space.md}px` },
  title: { margin: 0, fontSize: mobileTokens.font.xl, fontWeight: 800, color: '#fff', letterSpacing: '-0.3px' },
  hint: { margin: '6px 0 0', fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.45)', lineHeight: 1.45 },
  empty: { padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: mobileTokens.font.md },
  error: { margin: `0 ${mobileTokens.space.lg}px`, padding: 10, background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', borderRadius: mobileTokens.radius.sm, fontSize: mobileTokens.font.sm },
  progressWrap: {
    padding: `0 ${mobileTokens.space.lg}px ${mobileTokens.space.xxxl}px`,
    overflowX: 'auto',
    WebkitOverflowScrolling: 'touch',
  },
  fab: {
    position: 'fixed', right: 18, bottom: 86,
    width: 56, height: 56, borderRadius: '50%',
    background: '#6366f1', color: '#fff', border: 'none',
    fontSize: 30, lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit',
    boxShadow: '0 8px 22px rgba(99,102,241,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 50,
  },
  sheetBackdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
    zIndex: 200, display: 'flex', alignItems: 'flex-end',
  },
  sheet: {
    width: '100%', background: '#1a1a2e',
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
