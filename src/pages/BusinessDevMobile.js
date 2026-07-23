import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { mobileTokens } from '../utils/mobileTokens';
import { colors } from '../lib/styleTokens';
import { fetchAllRows } from './analytics/utils';
import {
  BD_TAGS, BD_STATUSES, BD_STATUS_MAP, computeBdAttention, syncBdTaskToBacklog,
  bdTodayPT, addDaysToDateStr, WAITING_AGE_DAYS, STALE_ACTIVE_DAYS,
} from '../lib/bdAttention';

// Mobile companion view of the BD tracker. Shows the Phases tab only —
// Timeline / Calendar / My Stuff and the full edit forms stay desktop-only.
// Actionable on mobile: quick-add to Inbox, live task check-off (with the
// personal_tasks backlog mirror), and the Needs Attention strip with
// one-tap re-dating.

// Tag/status metadata shared with BusinessDev.js via src/lib/bdAttention.js
// so the two clients can't drift on colors or labels.
const STATUS_LABELS = Object.fromEntries(BD_STATUSES.map((s) => [s.key, s.label]));
const STATUS_COLORS = Object.fromEntries(BD_STATUSES.map((s) => [s.key, s.color]));
const TAG_COLORS = Object.fromEntries(BD_TAGS.map((t) => [t.key, t.color]));
const TAG_LABELS = Object.fromEntries(BD_TAGS.map((t) => [t.key, t.label]));
// 'inbox' first: quick-capture triage bucket, rendered only when non-empty.
const WORKSTREAMS = ['inbox', 'facility', 'product', 'marketing', 'sales', 'operations', 'finance', 'tech'];
const WORKSTREAM_LABELS = {
  inbox: 'Inbox', facility: 'Facility', product: 'Product', marketing: 'Marketing & Brand',
  sales: 'Sales / BD', operations: 'Operations', finance: 'Finance', tech: 'Tech / Systems',
};

function fmtCountdown(date) {
  if (!date) return null;
  const target = new Date(date + 'T00:00:00');
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const days = Math.ceil((target - now) / 86400000);
  if (days < 0) return { label: 'Past launch', color: '#ef4444' };
  if (days === 0) return { label: 'Launches today', color: '#f59e0b' };
  return { label: `${days} day${days === 1 ? '' : 's'} to launch`, color: 'rgba(255,255,255,0.6)' };
}

function fmtShortDate(date) {
  if (!date) return null;
  const d = new Date(date + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function BusinessDevMobile() {
  const { profile, isAdmin } = useAuth();
  const [phases, setPhases] = useState([]);
  const [initiatives, setInitiatives] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [openInits, setOpenInits] = useState({});
  const [quickTitle, setQuickTitle] = useState('');
  const [quickPhaseId, setQuickPhaseId] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [phRes, initRows, taskRows, msRes, adminRes] = await Promise.all([
        supabase.from('bd_phases').select('*').is('archived_at', null).order('position'),
        fetchAllRows(supabase.from('bd_initiatives').select('*').order('position')),
        fetchAllRows(supabase.from('bd_tasks').select('*').order('position')),
        supabase.from('bd_milestones').select('*').is('retired_at', null).order('target_date'),
        supabase.from('profiles').select('id, full_name').in('role', ['admin', 'partner']),
      ]);
      const phs = phRes.data || [];
      setPhases(phs);
      setInitiatives(initRows || []);
      setTasks(taskRows || []);
      setMilestones(msRes.data || []);
      setAdmins(adminRes.data || []);
      // Auto-expand if single phase
      setExpanded((prev) => {
        if (Object.keys(prev).length > 0) return prev;
        if (phs.length === 1) return { [phs[0].id]: true };
        return prev;
      });
    } catch (err) {
      console.error('BD fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (profile?.id) fetchAll(); }, [profile?.id, fetchAll]);

  const adminMap = useMemo(() => {
    const m = {};
    admins.forEach((a) => { m[a.id] = a.full_name; });
    return m;
  }, [admins]);

  const attention = useMemo(
    () => computeBdAttention({ tasks, initiatives, phases }),
    [tasks, initiatives, phases]
  );

  // Optimistic completed_at toggle + personal_tasks backlog mirror
  // (same semantics as desktop's handleToggleTask).
  async function toggleTask(task) {
    const completed_at = task.completed_at ? null : new Date().toISOString();
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed_at } : t)));
    const { data, error } = await supabase.from('bd_tasks').update({ completed_at }).eq('id', task.id).select().single();
    if (error) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed_at: task.completed_at } : t)));
      return;
    }
    if (data) await syncBdTaskToBacklog(data, initiatives);
  }

  // One-tap reschedule: overdue / due-today push from *today* (PT),
  // future-dated push from their own date.
  async function redateTask(task, days) {
    const today = bdTodayPT();
    const base = task.due_date && task.due_date > today ? task.due_date : today;
    const due_date = addDaysToDateStr(base, days);
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, due_date } : t)));
    const { data, error } = await supabase.from('bd_tasks').update({ due_date }).eq('id', task.id).select().single();
    if (error) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, due_date: task.due_date } : t)));
      return;
    }
    if (data) await syncBdTaskToBacklog(data, initiatives);
  }

  // Quick-capture: title-only insert into the phase's Inbox bucket.
  async function handleQuickAdd(e) {
    e.preventDefault();
    const title = quickTitle.trim();
    const phaseId = quickPhaseId || phases[0]?.id;
    if (!title || !phaseId) return;
    const siblings = initiatives.filter((i) => i.phase_id === phaseId && i.workstream === 'inbox');
    const maxPos = Math.max(0, ...siblings.map((i) => i.position || 0));
    const { error } = await supabase.from('bd_initiatives').insert({
      phase_id: phaseId, workstream: 'inbox', title,
      status: 'ideas', tag: 'shared',
      position: maxPos + 1, created_by: profile.id,
    });
    if (error) { console.error('Quick add failed:', error); return; }
    setQuickTitle('');
    fetchAll();
  }

  if (loading) return <p style={styles.empty}>Loading…</p>;
  if (phases.length === 0) return <p style={styles.empty}>No phases yet.</p>;

  const attentionGroups = [
    { key: 'overdue', label: `Overdue (${attention.overdue.length})`, color: colors.danger.fgSoft, rows: attention.overdue, type: 'task' },
    { key: 'dueSoon', label: `Due this week (${attention.dueSoon.length})`, color: colors.warning.fgSoft, rows: attention.dueSoon, type: 'task' },
    { key: 'waiting', label: `Waiting >${WAITING_AGE_DAYS}d (${attention.waiting.length})`, color: STATUS_COLORS.waiting, rows: attention.waiting, type: 'init' },
    { key: 'stale', label: `Active, untouched ${STALE_ACTIVE_DAYS}d+ (${attention.stale.length})`, color: STATUS_COLORS.ideas, rows: attention.stale, type: 'init' },
  ];

  return (
    <div style={styles.root}>
      {/* Quick-capture to Inbox */}
      {isAdmin && (
        <form onSubmit={handleQuickAdd} style={styles.quickAddCard}>
          <input
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            placeholder="Quick add to Inbox…"
            style={styles.quickAddInput}
          />
          {phases.length > 1 && (
            <select
              value={quickPhaseId || phases[0].id}
              onChange={(e) => setQuickPhaseId(e.target.value)}
              style={styles.quickAddSelect}
            >
              {phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button type="submit" disabled={!quickTitle.trim()}
            style={{ ...styles.quickAddBtn, opacity: quickTitle.trim() ? 1 : 0.4 }}>
            Add
          </button>
        </form>
      )}

      {/* Needs Attention strip */}
      {attention.total === 0 ? (
        <p style={styles.attnAllClear}>✓ Nothing needs attention</p>
      ) : (
        <section style={styles.attnCard}>
          <div style={styles.attnHeader}>
            <span style={styles.attnTitle}>Needs Attention</span>
            <span style={styles.attnCount}>{attention.total}</span>
          </div>
          {attentionGroups.map((g) => g.rows.length === 0 ? null : (
            <div key={g.key} style={styles.attnGroup}>
              <div style={{ ...styles.attnGroupLabel, color: g.color }}>{g.label}</div>
              {g.type === 'task' ? g.rows.map((row) => (
                <div key={row.task.id} style={styles.attnRow}>
                  {isAdmin && (
                    <button onClick={() => toggleTask(row.task)} style={styles.taskCheckBtn} aria-label="Mark done">
                      <span style={styles.taskCheck} />
                    </button>
                  )}
                  <div style={styles.attnRowMain}>
                    <span style={styles.attnRowTitle}>{row.task.title}</span>
                    <span style={styles.attnRowContext}>
                      {row.initiative?.title || ''}{row.phase ? ` · ${row.phase.name}` : ''}
                    </span>
                  </div>
                  <div style={styles.attnRowRight}>
                    {row.task.due_date && <span style={styles.attnDue}>{fmtShortDate(row.task.due_date)}</span>}
                    {isAdmin && (
                      <div style={styles.attnRedateRow}>
                        <button onClick={() => redateTask(row.task, 1)} style={styles.redateBtn}>+1d</button>
                        <button onClick={() => redateTask(row.task, 7)} style={styles.redateBtn}>+1w</button>
                      </div>
                    )}
                  </div>
                </div>
              )) : g.rows.map((row) => (
                <div key={row.initiative.id} style={styles.attnRow}>
                  <span style={{ ...styles.initStatusDot, background: STATUS_COLORS[row.initiative.status] || '#64748b', marginTop: mobileTokens.space.xs }} />
                  <div style={styles.attnRowMain}>
                    <span style={styles.attnRowTitle}>{row.initiative.title}</span>
                    <span style={styles.attnRowContext}>
                      {WORKSTREAM_LABELS[row.initiative.workstream] || row.initiative.workstream}
                      {row.phase ? ` · ${row.phase.name}` : ''}
                    </span>
                  </div>
                  <span style={{
                    ...styles.attnAge,
                    ...(g.key === 'waiting' ? styles.attnAgeWaiting : styles.attnAgeStale),
                  }}>
                    {g.key === 'waiting' ? `Waiting — ${row.ageDays}d` : `${row.ageDays}d idle`}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      {phases.map((phase) => {
        const isOpen = expanded[phase.id];
        const phaseInits = initiatives.filter((i) => i.phase_id === phase.id);
        const doneCount = phaseInits.filter((i) => i.status === 'done').length;
        const pct = phaseInits.length > 0 ? doneCount / phaseInits.length : 0;
        const phaseInitIds = new Set(phaseInits.map((i) => i.id));
        const phaseTasks = tasks.filter((t) => phaseInitIds.has(t.initiative_id));
        const phaseTasksDone = phaseTasks.filter((t) => t.completed_at).length;
        const countdown = fmtCountdown(phase.launch_target_date);
        const phaseMilestones = milestones.filter((m) => m.phase_id === phase.id);

        return (
          <section key={phase.id} style={styles.phaseCard}>
            <button
              onClick={() => setExpanded((prev) => ({ ...prev, [phase.id]: !prev[phase.id] }))}
              style={styles.phaseHeader}
            >
              <div style={styles.phaseHeaderTop}>
                <span style={styles.phaseName}>{phase.name}</span>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ transform: isOpen ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform 0.15s', color: 'rgba(255,255,255,0.5)' }}>
                  <path d="M3 6l5 5 5-5z" />
                </svg>
              </div>
              {countdown && <div style={{ ...styles.phaseCountdown, color: countdown.color }}>{countdown.label}</div>}
              <div style={styles.progressTrack}>
                <div style={{ ...styles.progressFill, width: `${pct * 100}%` }} />
              </div>
              <div style={styles.phaseMeta}>
                {doneCount}/{phaseInits.length} initiatives · {phaseTasksDone}/{phaseTasks.length} tasks
              </div>
            </button>

            {isOpen && (
              <div style={styles.phaseBody}>
                {phaseMilestones.length > 0 && (
                  <div style={styles.milestoneRow}>
                    {phaseMilestones.map((m) => (
                      <div key={m.id} style={styles.milestonePill}>
                        <span style={styles.milestoneTitle}>{m.title}</span>
                        {m.target_date && <span style={styles.milestoneDate}>{fmtShortDate(m.target_date)}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {WORKSTREAMS.map((ws) => {
                  const wsInits = phaseInits.filter((i) => i.workstream === ws);
                  if (wsInits.length === 0) return null;
                  return (
                    <div key={ws} style={styles.workstream}>
                      <div style={styles.workstreamHeader}>{WORKSTREAM_LABELS[ws]}</div>
                      {wsInits.map((init) => {
                        const initTasks = tasks.filter((t) => t.initiative_id === init.id);
                        const initDone = initTasks.filter((t) => t.completed_at).length;
                        const accent = STATUS_COLORS[init.status] || '#64748b';
                        const tagColor = TAG_COLORS[init.tag] || 'rgba(255,255,255,0.5)';
                        const isInitOpen = openInits[init.id];
                        return (
                          <div key={init.id} style={styles.initCard}>
                            <button
                              onClick={() => setOpenInits((prev) => ({ ...prev, [init.id]: !prev[init.id] }))}
                              style={styles.initHeader}
                            >
                              <span style={{ ...styles.initStatusDot, background: accent }} />
                              <span style={styles.initTitle}>{init.title}</span>
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" style={{ transform: isInitOpen ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform 0.15s', color: 'rgba(255,255,255,0.4)' }}>
                                <path d="M3 5l4 4 4-4z" />
                              </svg>
                            </button>
                            <div style={styles.initMeta}>
                              <span style={{ ...styles.initStatusPill, background: `${accent}22`, color: accent, borderColor: `${accent}55` }}>
                                {STATUS_LABELS[init.status] || init.status}
                              </span>
                              {init.tag && (
                                <span style={{ ...styles.tagPill, color: tagColor, borderColor: `${tagColor}66` }}>
                                  {TAG_LABELS[init.tag] || init.tag}
                                </span>
                              )}
                              {init.owner_id && adminMap[init.owner_id] && (
                                <span style={styles.ownerLabel}>· {adminMap[init.owner_id]}</span>
                              )}
                              {init.target_date && (
                                <span style={styles.dateLabel}>· {fmtShortDate(init.target_date)}</span>
                              )}
                              {initTasks.length > 0 && (
                                <span style={styles.dateLabel}>· {initDone}/{initTasks.length} tasks</span>
                              )}
                            </div>
                            {isInitOpen && init.description && (
                              <p style={styles.initDescription}>{init.description}</p>
                            )}
                            {isInitOpen && initTasks.length > 0 && (
                              <ul style={styles.taskList}>
                                {initTasks.map((t) => (
                                  <li key={t.id} style={styles.taskRow}>
                                    <button
                                      onClick={() => isAdmin && toggleTask(t)}
                                      style={{ ...styles.taskCheckBtn, cursor: isAdmin ? 'pointer' : 'default' }}
                                      aria-label={t.completed_at ? 'Mark not done' : 'Mark done'}
                                    >
                                      <span style={{ ...styles.taskCheck, ...(t.completed_at ? styles.taskCheckDone : {}) }}>
                                        {t.completed_at && (
                                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2.5">
                                            <path d="M2 5l2 2 4-5" strokeLinecap="round" strokeLinejoin="round" />
                                          </svg>
                                        )}
                                      </span>
                                    </button>
                                    <span style={{ ...styles.taskTitle, textDecoration: t.completed_at ? 'line-through' : 'none', color: t.completed_at ? 'rgba(255,255,255,0.45)' : '#e2e8f0' }}>
                                      {t.title}
                                    </span>
                                    {t.due_date && (
                                      <span style={styles.taskDate}>{fmtShortDate(t.due_date)}</span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      <p style={styles.footer}>Timeline, Calendar, and My Stuff views are desktop-only.</p>
    </div>
  );
}

const styles = {
  root: {
    minHeight: '100%',
    background: colors.bg,
    color: '#e2e8f0',
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px ${mobileTokens.space.xxxl}px`,
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.md,
  },
  empty: {
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    fontSize: mobileTokens.font.md,
    padding: mobileTokens.space.xxl,
    margin: 0,
  },
  // Quick-capture
  quickAddCard: {
    display: 'flex',
    alignItems: 'center',
    gap: mobileTokens.space.sm,
    background: colors.accentA06,
    border: '1px solid rgba(91, 143, 199,0.18)',
    borderRadius: mobileTokens.radius.md,
    padding: mobileTokens.space.sm,
  },
  quickAddInput: {
    flex: 1,
    minWidth: 0,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: colors.textBright,
    fontSize: mobileTokens.fontBase,
    fontFamily: 'inherit',
    padding: mobileTokens.space.xs,
  },
  quickAddSelect: {
    maxWidth: 110,
    background: colors.bgInput,
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.sm,
    color: colors.textBright,
    fontSize: mobileTokens.font.sm,
    fontFamily: 'inherit',
    padding: `${mobileTokens.space.xs}px`,
    flexShrink: 0,
  },
  quickAddBtn: {
    background: colors.accentSoft,
    border: '1px solid rgba(91, 143, 199,0.35)',
    borderRadius: mobileTokens.radius.sm,
    color: colors.accentFg,
    fontSize: mobileTokens.font.sm,
    fontWeight: 600,
    fontFamily: 'inherit',
    padding: `${mobileTokens.space.sm}px ${mobileTokens.space.md}px`,
    cursor: 'pointer',
    flexShrink: 0,
  },
  // Needs Attention strip
  attnCard: {
    background: colors.bgInput,
    border: '1px solid rgba(255,255,255,0.06)',
    borderLeft: `3px solid ${colors.warning.border}`,
    borderRadius: mobileTokens.radius.lg,
    padding: mobileTokens.space.md,
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.sm,
  },
  attnHeader: { display: 'flex', alignItems: 'center', gap: mobileTokens.space.sm },
  attnTitle: {
    fontSize: mobileTokens.font.sm,
    fontWeight: 700,
    color: colors.white,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  attnCount: {
    fontSize: mobileTokens.font.xs,
    fontWeight: 700,
    color: colors.warning.fg,
    background: colors.warning.bg,
    border: `1px solid ${colors.warning.border}`,
    padding: '1px 8px',
    borderRadius: mobileTokens.radius.pill,
  },
  attnGroup: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.xs },
  attnGroupLabel: {
    fontSize: mobileTokens.font.xs,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  attnRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: mobileTokens.space.sm,
    background: colors.whiteA03,
    borderRadius: mobileTokens.radius.sm,
    padding: mobileTokens.space.sm,
  },
  attnRowMain: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: mobileTokens.space.xs },
  attnRowTitle: {
    fontSize: mobileTokens.font.sm,
    fontWeight: 600,
    color: colors.textBright,
    wordBreak: 'break-word',
  },
  attnRowContext: { fontSize: mobileTokens.font.xs, color: colors.whiteA45 },
  attnRowRight: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: mobileTokens.space.xs,
    flexShrink: 0,
  },
  attnDue: { fontSize: mobileTokens.font.xs, color: colors.textSubtle },
  attnRedateRow: { display: 'flex', gap: mobileTokens.space.xs },
  redateBtn: {
    background: colors.whiteA05,
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: mobileTokens.radius.sm,
    color: colors.textMuted,
    fontSize: mobileTokens.font.xs,
    fontWeight: 600,
    fontFamily: 'inherit',
    padding: `${mobileTokens.space.xs}px ${mobileTokens.space.sm}px`,
    cursor: 'pointer',
  },
  attnAge: {
    fontSize: mobileTokens.font.xs,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: mobileTokens.radius.pill,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  // Waiting reuses its status color; stale reuses the ideas gray.
  attnAgeWaiting: { color: BD_STATUS_MAP.waiting.color, background: BD_STATUS_MAP.waiting.bg },
  attnAgeStale: { color: BD_STATUS_MAP.ideas.color, background: BD_STATUS_MAP.ideas.bg },
  attnAllClear: {
    margin: 0,
    fontSize: mobileTokens.font.sm,
    color: colors.textDim,
    display: 'flex',
    alignItems: 'center',
    gap: mobileTokens.space.xs,
  },
  taskCheckBtn: {
    background: 'transparent',
    border: 'none',
    padding: mobileTokens.space.xs,
    margin: -mobileTokens.space.xs,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
    WebkitTapHighlightColor: 'transparent',
  },
  phaseCard: {
    background: 'rgba(255,255,255,0.04)',
    borderRadius: mobileTokens.radius.lg,
    overflow: 'hidden',
  },
  phaseHeader: {
    width: '100%',
    padding: mobileTokens.space.md,
    border: 'none',
    background: 'transparent',
    color: '#e2e8f0',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  phaseHeaderTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  phaseName: {
    fontSize: mobileTokens.font.lg,
    fontWeight: 700,
    color: '#fff',
    letterSpacing: '-0.2px',
  },
  phaseCountdown: {
    fontSize: mobileTokens.font.sm,
    fontWeight: 600,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    background: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
    marginTop: 4,
  },
  progressFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #5b8fc7, #8fb4d8)',
    transition: 'width 0.3s',
  },
  phaseMeta: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.5)',
  },
  phaseBody: {
    padding: `0 ${mobileTokens.space.md}px ${mobileTokens.space.md}px`,
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.md,
    borderTop: '1px solid rgba(255,255,255,0.05)',
    paddingTop: mobileTokens.space.md,
  },
  milestoneRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: mobileTokens.space.sm,
  },
  milestonePill: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    background: colors.accentA10,
    border: '1px solid rgba(91, 143, 199,0.25)',
    borderRadius: mobileTokens.radius.pill,
    fontSize: mobileTokens.font.xs,
  },
  milestoneTitle: {
    color: colors.accentFg,
    fontWeight: 600,
  },
  milestoneDate: {
    color: 'rgba(255,255,255,0.5)',
  },
  workstream: {
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.sm,
  },
  workstreamHeader: {
    fontSize: mobileTokens.font.xs,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  initCard: {
    background: 'rgba(255,255,255,0.03)',
    borderRadius: mobileTokens.radius.md,
    padding: mobileTokens.space.sm,
  },
  initHeader: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: mobileTokens.space.sm,
    background: 'transparent',
    border: 'none',
    color: '#e2e8f0',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    padding: 4,
  },
  initStatusDot: {
    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
  },
  initTitle: {
    flex: 1,
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    color: '#fff',
    wordBreak: 'break-word',
  },
  initMeta: {
    padding: '4px 4px 0',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
    alignItems: 'center',
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.5)',
  },
  initStatusPill: {
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: mobileTokens.radius.pill,
    border: '1px solid',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  tagPill: {
    fontSize: 10,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: mobileTokens.radius.pill,
    border: '1px solid',
  },
  ownerLabel: { color: 'rgba(255,255,255,0.5)' },
  dateLabel: { color: 'rgba(255,255,255,0.4)' },
  initDescription: {
    margin: `${mobileTokens.space.sm}px 0 0`,
    fontSize: mobileTokens.font.sm,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 1.45,
    padding: '0 4px',
    whiteSpace: 'pre-wrap',
  },
  taskList: {
    listStyle: 'none',
    margin: `${mobileTokens.space.sm}px 0 0`,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  taskRow: {
    display: 'flex',
    alignItems: 'center',
    gap: mobileTokens.space.sm,
    padding: '4px 4px',
    fontSize: mobileTokens.font.sm,
  },
  taskCheck: {
    width: 16,
    height: 16,
    borderRadius: 4,
    border: '1.5px solid rgba(255,255,255,0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    color: 'transparent',
  },
  taskCheckDone: {
    background: '#22c55e',
    borderColor: '#22c55e',
    color: '#fff',
  },
  taskTitle: {
    flex: 1,
    fontSize: mobileTokens.font.sm,
    color: '#e2e8f0',
    wordBreak: 'break-word',
  },
  taskDate: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.4)',
    flexShrink: 0,
  },
  footer: {
    marginTop: mobileTokens.space.md,
    padding: mobileTokens.space.md,
    background: colors.accentA06,
    border: '1px solid rgba(91, 143, 199,0.18)',
    borderRadius: mobileTokens.radius.sm,
    color: 'rgba(255,255,255,0.55)',
    fontSize: mobileTokens.font.sm,
    textAlign: 'center',
  },
};
