import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDeadline(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((d - now) / 86400000);
  const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (diffDays < 0) return { label, sub: `${Math.abs(diffDays)}d overdue`, color: '#ef4444' };
  if (diffDays === 0) return { label, sub: 'Due today', color: '#f59e0b' };
  if (diffDays <= 7) return { label, sub: `${diffDays}d left`, color: '#f59e0b' };
  return { label, sub: `${diffDays}d left`, color: 'rgba(255,255,255,0.4)' };
}

function progressColor(pct) {
  const r = Math.round(0x86 + (0x16 - 0x86) * pct);
  const g = Math.round(0xef + (0xa3 - 0xef) * pct);
  const b = Math.round(0xac + (0x4a - 0xac) * pct);
  return `rgb(${r},${g},${b})`;
}

const EMPTY_GOAL = { title: '', current_value: '', target_value: '', category: 'quarterly' };
const EMPTY_INITIATIVE = { title: '', deadline: '', category: 'quarterly' };

export default function Goals() {
  const { profile, isAdmin } = useAuth();
  const [goals, setGoals] = useState([]);
  const [initiatives, setInitiatives] = useState([]);
  const [loading, setLoading] = useState(true);

  // Goal form state
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState(null);
  const [goalForm, setGoalForm] = useState(EMPTY_GOAL);

  // Initiative form state
  const [showInitForm, setShowInitForm] = useState(false);
  const [editingInitId, setEditingInitId] = useState(null);
  const [initForm, setInitForm] = useState(EMPTY_INITIATIVE);

  useEffect(() => {
    if (profile?.id) fetchAll();
  }, [profile?.id]);

  async function fetchAll() {
    try {
      const [goalsRes, initRes] = await Promise.all([
        supabase.from('goals').select('*').order('created_at', { ascending: false }),
        supabase.from('initiatives').select('*').order('deadline', { ascending: true }),
      ]);
      if (goalsRes.error) throw goalsRes.error;
      if (initRes.error) throw initRes.error;
      setGoals(goalsRes.data || []);
      setInitiatives(initRes.data || []);
    } catch (err) {
      console.error('Error fetching:', err);
    } finally {
      setLoading(false);
    }
  }

  // --- Goal CRUD ---
  function openCreateGoal() {
    setEditingGoalId(null);
    setGoalForm(EMPTY_GOAL);
    setShowGoalForm(true);
  }
  function openEditGoal(goal) {
    setEditingGoalId(goal.id);
    setGoalForm({
      title: goal.title,
      current_value: String(goal.current_value),
      target_value: String(goal.target_value),
      category: goal.category,
    });
    setShowGoalForm(true);
  }
  function cancelGoalForm() {
    setShowGoalForm(false);
    setEditingGoalId(null);
    setGoalForm(EMPTY_GOAL);
  }
  async function handleGoalSubmit(e) {
    e.preventDefault();
    const title = goalForm.title.trim();
    if (!title) return;
    const current_value = parseFloat(goalForm.current_value) || 0;
    const target_value = parseFloat(goalForm.target_value) || 1;

    if (editingGoalId) {
      const { error } = await supabase.from('goals').update({
        title, current_value, target_value, category: goalForm.category,
        updated_at: new Date().toISOString(),
      }).eq('id', editingGoalId);
      if (error) { alert('Error: ' + error.message); return; }
    } else {
      const { error } = await supabase.from('goals').insert({
        title, current_value, target_value, category: goalForm.category,
        created_by: profile.id,
      }).select();
      if (error) { alert('Error: ' + error.message); return; }
    }
    cancelGoalForm();
    fetchAll();
  }
  async function handleDeleteGoal(id) {
    if (!window.confirm('Delete this goal?')) return;
    await supabase.from('goals').delete().eq('id', id);
    fetchAll();
  }

  // --- Initiative CRUD ---
  function openCreateInit() {
    setEditingInitId(null);
    setInitForm(EMPTY_INITIATIVE);
    setShowInitForm(true);
  }
  function openEditInit(init) {
    setEditingInitId(init.id);
    setInitForm({ title: init.title, deadline: init.deadline, category: init.category });
    setShowInitForm(true);
  }
  function cancelInitForm() {
    setShowInitForm(false);
    setEditingInitId(null);
    setInitForm(EMPTY_INITIATIVE);
  }
  async function handleInitSubmit(e) {
    e.preventDefault();
    const title = initForm.title.trim();
    if (!title || !initForm.deadline) return;

    if (editingInitId) {
      const { error } = await supabase.from('initiatives').update({
        title, deadline: initForm.deadline, category: initForm.category,
        updated_at: new Date().toISOString(),
      }).eq('id', editingInitId);
      if (error) { alert('Error: ' + error.message); return; }
    } else {
      const { error } = await supabase.from('initiatives').insert({
        title, deadline: initForm.deadline, category: initForm.category,
        created_by: profile.id,
      }).select();
      if (error) { alert('Error: ' + error.message); return; }
    }
    cancelInitForm();
    fetchAll();
  }
  async function handleDeleteInit(id) {
    if (!window.confirm('Delete this initiative?')) return;
    await supabase.from('initiatives').delete().eq('id', id);
    fetchAll();
  }

  const quarterlyGoals = goals.filter(g => g.category === 'quarterly');
  const yearlyGoals = goals.filter(g => g.category === 'yearly');
  const quarterlyInits = initiatives.filter(i => i.category === 'quarterly');
  const yearlyInits = initiatives.filter(i => i.category === 'yearly');
  const totalCount = goals.length + initiatives.length;

  if (loading) {
    return <div style={styles.page}><div style={styles.loading}>Loading goals...</div></div>;
  }

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.topBar}>
        <div>
          <h1 style={styles.pageTitle}>Goals</h1>
          <p style={styles.pageSubtitle}>{totalCount} item{totalCount !== 1 ? 's' : ''} tracked</p>
        </div>
        {isAdmin && (
          <div style={styles.headerActions}>
            <button onClick={showGoalForm ? cancelGoalForm : openCreateGoal} style={styles.addBtn}>
              {showGoalForm ? '✕ Cancel' : '+ Add Goal'}
            </button>
            <button onClick={showInitForm ? cancelInitForm : openCreateInit} style={styles.addBtn}>
              {showInitForm ? '✕ Cancel' : '+ Add Initiative'}
            </button>
          </div>
        )}
      </div>

      {/* Goal Form */}
      {showGoalForm && (
        <form onSubmit={handleGoalSubmit} style={styles.form}>
          <div style={styles.formLabel}>New Goal</div>
          <input
            value={goalForm.title}
            onChange={e => setGoalForm({ ...goalForm, title: e.target.value })}
            placeholder="Goal title"
            style={styles.input}
            autoFocus
          />
          <div style={styles.formRow}>
            <input
              value={goalForm.current_value}
              onChange={e => setGoalForm({ ...goalForm, current_value: e.target.value })}
              placeholder="Current value"
              style={{ ...styles.input, flex: 1 }}
              inputMode="decimal"
            />
            <input
              value={goalForm.target_value}
              onChange={e => setGoalForm({ ...goalForm, target_value: e.target.value })}
              placeholder="Target value"
              style={{ ...styles.input, flex: 1 }}
              inputMode="decimal"
            />
            <select
              value={goalForm.category}
              onChange={e => setGoalForm({ ...goalForm, category: e.target.value })}
              style={styles.select}
            >
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          <button type="submit" style={styles.submitBtn}>
            {editingGoalId ? 'Update Goal' : 'Create Goal'}
          </button>
        </form>
      )}

      {/* Initiative Form */}
      {showInitForm && (
        <form onSubmit={handleInitSubmit} style={styles.form}>
          <div style={styles.formLabel}>New Initiative</div>
          <input
            value={initForm.title}
            onChange={e => setInitForm({ ...initForm, title: e.target.value })}
            placeholder="Initiative title"
            style={styles.input}
            autoFocus
          />
          <div style={styles.formRow}>
            <input
              type="date"
              value={initForm.deadline}
              onChange={e => setInitForm({ ...initForm, deadline: e.target.value })}
              style={{ ...styles.input, flex: 1 }}
            />
            <select
              value={initForm.category}
              onChange={e => setInitForm({ ...initForm, category: e.target.value })}
              style={styles.select}
            >
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          <button type="submit" style={styles.submitBtn}>
            {editingInitId ? 'Update Initiative' : 'Create Initiative'}
          </button>
        </form>
      )}

      {/* Quarterly Section */}
      {(quarterlyGoals.length > 0 || quarterlyInits.length > 0) && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Quarterly</h2>
          <div style={styles.list}>
            {quarterlyGoals.map(g => (
              <GoalCard key={g.id} goal={g} isAdmin={isAdmin} onEdit={openEditGoal} onDelete={handleDeleteGoal} />
            ))}
            {quarterlyInits.map(i => (
              <InitiativeCard key={i.id} initiative={i} isAdmin={isAdmin} onEdit={openEditInit} onDelete={handleDeleteInit} />
            ))}
          </div>
        </div>
      )}

      {/* Yearly Section */}
      {(yearlyGoals.length > 0 || yearlyInits.length > 0) && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Yearly</h2>
          <div style={styles.list}>
            {yearlyGoals.map(g => (
              <GoalCard key={g.id} goal={g} isAdmin={isAdmin} onEdit={openEditGoal} onDelete={handleDeleteGoal} />
            ))}
            {yearlyInits.map(i => (
              <InitiativeCard key={i.id} initiative={i} isAdmin={isAdmin} onEdit={openEditInit} onDelete={handleDeleteInit} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GoalCard({ goal, isAdmin, onEdit, onDelete }) {
  const target = Number(goal.target_value) || 1;
  const current = Number(goal.current_value) || 0;
  const pct = Math.min(current / target, 1);
  const pctDisplay = Math.round(pct * 100);
  const color = progressColor(pct);

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <div style={styles.cardTitleRow}>
          <span style={styles.cardBadge}>Goal</span>
          <span style={styles.cardTitle}>{goal.title}</span>
        </div>
        {isAdmin && (
          <div style={styles.cardActions}>
            <button onClick={() => onEdit(goal)} style={styles.iconBtn} title="Edit">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14.5 3.5l2 2L6 16H4v-2L14.5 3.5z" />
              </svg>
            </button>
            <button onClick={() => onDelete(goal.id)} style={styles.iconBtn} title="Delete">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M5 6h10M8 6V4h4v2M6 6v10a1 1 0 001 1h6a1 1 0 001-1V6" />
              </svg>
            </button>
          </div>
        )}
      </div>
      <div style={styles.barBg}>
        <div style={{ ...styles.barFill, width: `${pctDisplay}%`, background: color }} />
      </div>
      <div style={styles.cardFooter}>
        <span style={styles.cardNumbers}>{current} / {target}</span>
        <span style={{ ...styles.cardPct, color }}>{pctDisplay}%</span>
      </div>
      <div style={styles.cardUpdated}>Updated {formatDate(goal.updated_at)}</div>
    </div>
  );
}

function InitiativeCard({ initiative, isAdmin, onEdit, onDelete }) {
  const dl = formatDeadline(initiative.deadline);

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <div style={styles.cardTitleRow}>
          <span style={styles.initBadge}>Initiative</span>
          <span style={styles.cardTitle}>{initiative.title}</span>
        </div>
        {isAdmin && (
          <div style={styles.cardActions}>
            <button onClick={() => onEdit(initiative)} style={styles.iconBtn} title="Edit">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14.5 3.5l2 2L6 16H4v-2L14.5 3.5z" />
              </svg>
            </button>
            <button onClick={() => onDelete(initiative.id)} style={styles.iconBtn} title="Delete">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M5 6h10M8 6V4h4v2M6 6v10a1 1 0 001 1h6a1 1 0 001-1V6" />
              </svg>
            </button>
          </div>
        )}
      </div>
      <div style={styles.deadlineRow}>
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke={dl.color} strokeWidth="1.5" style={{ flexShrink: 0 }}>
          <rect x="3" y="4" width="14" height="13" rx="2" />
          <path d="M3 8h14M7 2v4M13 2v4" />
        </svg>
        <span style={{ color: dl.color, fontSize: '13px', fontWeight: 500 }}>{dl.label}</span>
        <span style={{ color: dl.color, fontSize: '12px', opacity: 0.8 }}>{dl.sub}</span>
      </div>
    </div>
  );
}

const styles = {
  page: {
    padding: '32px 40px',
    maxWidth: '960px',
    margin: '0 auto',
  },
  loading: {
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    paddingTop: '80px',
    fontSize: '14px',
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '28px',
  },
  pageTitle: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#fff',
    margin: 0,
  },
  pageSubtitle: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.4)',
    margin: '4px 0 0',
  },
  headerActions: {
    display: 'flex',
    gap: '8px',
  },
  addBtn: {
    padding: '8px 18px',
    borderRadius: '10px',
    border: 'none',
    background: 'rgba(99,102,241,0.15)',
    color: '#a5b4fc',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  form: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '28px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  formLabel: {
    fontSize: '13px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: '2px',
  },
  formRow: {
    display: 'flex',
    gap: '10px',
  },
  input: {
    padding: '10px 12px',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.06)',
    color: '#e2e8f0',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  select: {
    padding: '10px 12px',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.06)',
    color: '#e2e8f0',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
    cursor: 'pointer',
  },
  submitBtn: {
    padding: '10px 20px',
    borderRadius: '8px',
    border: 'none',
    background: '#6366f1',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    alignSelf: 'flex-start',
  },
  section: {
    marginBottom: '32px',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.7)',
    margin: '0 0 14px',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  card: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '12px',
    padding: '16px',
    width: '100%',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  cardTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flex: 1,
    minWidth: 0,
  },
  cardBadge: {
    fontSize: '10px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: '#86efac',
    background: 'rgba(134,239,172,0.1)',
    padding: '3px 8px',
    borderRadius: '4px',
    flexShrink: 0,
  },
  initBadge: {
    fontSize: '10px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: '#93c5fd',
    background: 'rgba(147,197,253,0.1)',
    padding: '3px 8px',
    borderRadius: '4px',
    flexShrink: 0,
  },
  cardTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#e2e8f0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  cardActions: {
    display: 'flex',
    gap: '4px',
    flexShrink: 0,
  },
  iconBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    border: 'none',
    borderRadius: '6px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.35)',
    cursor: 'pointer',
    transition: 'color 0.15s',
  },
  barBg: {
    height: '8px',
    borderRadius: '4px',
    background: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    marginBottom: '8px',
  },
  barFill: {
    height: '100%',
    borderRadius: '4px',
    transition: 'width 0.3s ease',
    minWidth: '2px',
  },
  cardFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '4px',
  },
  cardNumbers: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.5)',
  },
  cardPct: {
    fontSize: '14px',
    fontWeight: 700,
  },
  cardUpdated: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.3)',
  },
  deadlineRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
};
