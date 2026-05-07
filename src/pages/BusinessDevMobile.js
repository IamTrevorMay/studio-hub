import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { mobileTokens } from '../utils/mobileTokens';

// Read-only mobile view of the BD tracker. Shows the Phases tab only —
// Timeline / Calendar / My Stuff stay desktop-only with a footer note.

const STATUS_LABELS = {
  ideas: 'Ideas', planned: 'Planned', active: 'Active', waiting: 'Waiting', done: 'Done',
};
const STATUS_COLORS = {
  ideas: '#8b5cf6', planned: '#3b82f6', active: '#22c55e',
  waiting: '#f59e0b', done: '#94a3b8',
};
const TAG_COLORS = {
  mayday: '#a5b4fc', neptune: '#86efac', shared: '#fcd34d',
};
const TAG_LABELS = { mayday: 'Mayday', neptune: 'Neptune', shared: 'Shared' };
const WORKSTREAMS = ['facility', 'product', 'marketing', 'sales', 'operations', 'finance', 'tech'];
const WORKSTREAM_LABELS = {
  facility: 'Facility', product: 'Product', marketing: 'Marketing & Brand',
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
  const { profile } = useAuth();
  const [phases, setPhases] = useState([]);
  const [initiatives, setInitiatives] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [openInits, setOpenInits] = useState({});

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [phRes, initRes, taskRes, msRes, adminRes] = await Promise.all([
        supabase.from('bd_phases').select('*').is('archived_at', null).order('position'),
        supabase.from('bd_initiatives').select('*').order('position'),
        supabase.from('bd_tasks').select('*').order('position'),
        supabase.from('bd_milestones').select('*').is('retired_at', null).order('target_date'),
        supabase.from('profiles').select('id, full_name').in('role', ['admin', 'partner']),
      ]);
      const phs = phRes.data || [];
      setPhases(phs);
      setInitiatives(initRes.data || []);
      setTasks(taskRes.data || []);
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

  if (loading) return <p style={styles.empty}>Loading…</p>;
  if (phases.length === 0) return <p style={styles.empty}>No phases yet.</p>;

  return (
    <div style={styles.root}>
      {phases.map((phase) => {
        const isOpen = expanded[phase.id];
        const phaseInits = initiatives.filter((i) => i.phase_id === phase.id);
        const doneCount = phaseInits.filter((i) => i.status === 'done').length;
        const pct = phaseInits.length > 0 ? doneCount / phaseInits.length : 0;
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
              <div style={styles.phaseMeta}>{doneCount} / {phaseInits.length} initiatives done</div>
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
                                    <span style={{ ...styles.taskCheck, ...(t.completed_at ? styles.taskCheckDone : {}) }}>
                                      {t.completed_at && (
                                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2.5">
                                          <path d="M2 5l2 2 4-5" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                      )}
                                    </span>
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
    background: '#0f0f1a',
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
    background: 'linear-gradient(90deg, #6366f1, #818cf8)',
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
    background: 'rgba(99,102,241,0.1)',
    border: '1px solid rgba(99,102,241,0.25)',
    borderRadius: mobileTokens.radius.pill,
    fontSize: mobileTokens.font.xs,
  },
  milestoneTitle: {
    color: '#a5b4fc',
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
    background: 'rgba(99,102,241,0.06)',
    border: '1px solid rgba(99,102,241,0.18)',
    borderRadius: mobileTokens.radius.sm,
    color: 'rgba(255,255,255,0.55)',
    fontSize: mobileTokens.font.sm,
    textAlign: 'center',
  },
};
