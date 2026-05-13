import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { mobileTokens } from '../utils/mobileTokens';

// Read-only mobile view of company goals.
// Goal cards are collapsed by default; tapping opens progress + monthly sub-goals.

function formatDeadline(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((d - now) / 86400000);
  const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (diffDays < 0) return { label, sub: `${Math.abs(diffDays)}d overdue`, color: '#ef4444' };
  if (diffDays === 0) return { label, sub: 'Due today', color: '#f59e0b' };
  if (diffDays <= 7) return { label, sub: `${diffDays}d left`, color: '#f59e0b' };
  return { label, sub: `${diffDays}d left`, color: 'rgba(255,255,255,0.5)' };
}

const CATEGORY_LABEL = { quarterly: 'Quarter', yearly: 'Year' };

export default function GoalsMobile() {
  const { profile } = useAuth();
  const [goals, setGoals] = useState([]);
  const [monthlyGoals, setMonthlyGoals] = useState([]);
  const [initiatives, setInitiatives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({}); // goalId -> bool

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [goalsRes, monthlyRes, initRes] = await Promise.all([
        supabase.from('goals').select('*').eq('scope', 'content').order('created_at', { ascending: false }),
        supabase.from('monthly_goals').select('*').eq('scope', 'content').order('created_at', { ascending: true }),
        supabase.from('initiatives').select('*').order('deadline', { ascending: true }),
      ]);
      setGoals(goalsRes.data || []);
      setMonthlyGoals(monthlyRes.data || []);
      setInitiatives(initRes.data || []);
    } catch (err) {
      console.error('Goals fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!profile?.id) return;
    fetchAll();
  }, [profile?.id, fetchAll]);

  if (loading) return <p style={styles.empty}>Loading…</p>;

  function toggle(id) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div style={styles.root}>
      <Section title="Goals" count={goals.length} empty="No goals yet.">
        {goals.map((g) => (
          <GoalCard
            key={g.id}
            goal={g}
            children={monthlyGoals.filter((mg) => mg.parent_goal_id === g.id)}
            isOpen={!!expanded[g.id]}
            onToggle={() => toggle(g.id)}
          />
        ))}
      </Section>
      <Section title="Initiatives" count={initiatives.length} empty="No initiatives yet.">
        {initiatives.map((i) => <InitiativeCard key={i.id} init={i} />)}
      </Section>
    </div>
  );
}

function Section({ title, count, empty, children }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <section style={styles.section}>
      <div style={styles.sectionHeader}>
        <h3 style={styles.sectionTitle}>{title}</h3>
        <span style={styles.sectionCount}>{count}</span>
      </div>
      {items.length === 0 ? <p style={styles.empty}>{empty}</p> : items}
    </section>
  );
}

function GoalCard({ goal, children, isOpen, onToggle }) {
  const isMetric = goal.goal_type === 'metric';
  const target = parseFloat(goal.target_value) || 0;
  const current = parseFloat(goal.current_value) || 0;
  const pct = target > 0 ? Math.min(1, current / target) : 0;
  const subCount = children.length;
  return (
    <div style={styles.card}>
      <button type="button" onClick={onToggle} style={styles.cardHeader}>
        <span style={styles.cardTitle}>{goal.title}</span>
        <span style={styles.cardHeaderRight}>
          {goal.category && <span style={styles.tag}>{CATEGORY_LABEL[goal.category] || goal.category}</span>}
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="currentColor"
            style={{ transform: isOpen ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform 0.15s', color: 'rgba(255,255,255,0.4)' }}
          >
            <path d="M3 5l4 4 4-4z" />
          </svg>
        </span>
      </button>

      {target > 0 && !isMetric && (
        <div style={styles.progressBlock}>
          <div style={styles.progressTrack}>
            <div style={{ ...styles.progressFill, width: `${pct * 100}%` }} />
          </div>
          <div style={styles.progressLabel}>
            {Math.round(current).toLocaleString()} / {Math.round(target).toLocaleString()}
            <span style={{ marginLeft: 6, color: 'rgba(255,255,255,0.4)' }}>· {Math.round(pct * 100)}%</span>
          </div>
        </div>
      )}

      {!isOpen && subCount > 0 && (
        <div style={styles.subCountChip}>
          {subCount} monthly goal{subCount === 1 ? '' : 's'}
        </div>
      )}

      {isOpen && (
        <div style={styles.expandedBody}>
          {isMetric && (
            <p style={styles.metricNote}>Metric goal — open on desktop for live progress against platform metrics.</p>
          )}
          {subCount === 0 ? (
            <p style={styles.subEmpty}>No monthly sub-goals.</p>
          ) : (
            <div style={styles.subList}>
              {children.map((mg) => <MonthlyGoalRow key={mg.id} goal={mg} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MonthlyGoalRow({ goal }) {
  const target = parseFloat(goal.target_value) || 0;
  const typeLabel = goal.content_type_filter === 'short' ? 'Short' : goal.content_type_filter === 'video' ? 'Longform' : null;
  return (
    <div style={styles.subCard}>
      <div style={styles.subHeader}>
        <span style={styles.subTitle}>{goal.title}</span>
        {typeLabel && <span style={styles.subType}>{typeLabel}</span>}
      </div>
      {target > 0 && (
        <div style={styles.subTarget}>Target: {Math.round(target).toLocaleString()}</div>
      )}
    </div>
  );
}

function InitiativeCard({ init }) {
  const deadline = formatDeadline(init.deadline);
  const done = !!init.completed_at;
  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <span style={{ ...styles.cardTitle, textDecoration: done ? 'line-through' : 'none', color: done ? 'rgba(255,255,255,0.45)' : '#fff' }}>{init.title}</span>
        {init.category && <span style={styles.tag}>{CATEGORY_LABEL[init.category] || init.category}</span>}
      </div>
      {deadline && (
        <div style={{ ...styles.deadlineRow, color: deadline.color }}>
          <span>{deadline.label}</span>
          <span>·</span>
          <span>{deadline.sub}</span>
        </div>
      )}
      {done && <div style={styles.doneTag}>Completed</div>}
    </div>
  );
}

const styles = {
  root: {
    minHeight: '100%',
    background: '#0f0f1a',
    color: '#e2e8f0',
    padding: `${mobileTokens.space.md}px 0 ${mobileTokens.space.xxxl}px`,
  },
  section: {
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px`,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'baseline',
    gap: mobileTokens.space.sm,
    marginBottom: mobileTokens.space.md,
  },
  sectionTitle: {
    margin: 0,
    fontSize: mobileTokens.font.lg,
    fontWeight: 700,
    color: '#fff',
    letterSpacing: '-0.2px',
  },
  sectionCount: {
    fontSize: mobileTokens.font.sm,
    color: 'rgba(255,255,255,0.4)',
    fontWeight: 500,
  },
  card: {
    background: 'rgba(255,255,255,0.04)',
    borderRadius: mobileTokens.radius.md,
    padding: mobileTokens.space.md,
    marginBottom: mobileTokens.space.sm,
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.sm,
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: mobileTokens.space.sm,
    width: '100%',
    background: 'transparent',
    border: 'none',
    color: '#e2e8f0',
    fontFamily: 'inherit',
    cursor: 'pointer',
    padding: 0,
    textAlign: 'left',
  },
  cardHeaderRight: {
    display: 'flex',
    alignItems: 'center',
    gap: mobileTokens.space.sm,
    flexShrink: 0,
  },
  cardTitle: {
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    color: '#fff',
    flex: 1,
    wordBreak: 'break-word',
    textAlign: 'left',
  },
  tag: {
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: mobileTokens.radius.pill,
    background: 'rgba(99,102,241,0.14)',
    color: '#a5b4fc',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  progressBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    background: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #6366f1, #818cf8)',
    transition: 'width 0.3s',
  },
  progressLabel: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.65)',
    fontWeight: 600,
  },
  subCountChip: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.45)',
    fontWeight: 500,
  },
  expandedBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.sm,
    paddingTop: mobileTokens.space.sm,
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  metricNote: {
    margin: 0,
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.45)',
    fontStyle: 'italic',
  },
  subEmpty: {
    margin: 0,
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.4)',
  },
  subList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  subCard: {
    background: 'rgba(255,255,255,0.03)',
    borderRadius: mobileTokens.radius.sm,
    padding: mobileTokens.space.sm,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  subHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: mobileTokens.space.sm,
  },
  subTitle: {
    fontSize: mobileTokens.font.sm,
    fontWeight: 600,
    color: '#e2e8f0',
    flex: 1,
    wordBreak: 'break-word',
  },
  subType: {
    fontSize: 10,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    flexShrink: 0,
  },
  subTarget: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.55)',
    fontWeight: 500,
  },
  deadlineRow: {
    display: 'flex',
    gap: 6,
    fontSize: mobileTokens.font.sm,
    fontWeight: 500,
  },
  doneTag: {
    alignSelf: 'flex-start',
    fontSize: mobileTokens.font.xs,
    fontWeight: 600,
    color: '#86efac',
    background: 'rgba(34,197,94,0.12)',
    padding: '2px 8px',
    borderRadius: mobileTokens.radius.pill,
  },
  empty: {
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    fontSize: mobileTokens.font.sm,
    padding: mobileTokens.space.lg,
    margin: 0,
  },
};
