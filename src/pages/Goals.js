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

function progressColor(pct) {
  // Interpolate from #86efac (light green) to #16a34a (dark green)
  const r = Math.round(0x86 + (0x16 - 0x86) * pct);
  const g = Math.round(0xef + (0xa3 - 0xef) * pct);
  const b = Math.round(0xac + (0x4a - 0xac) * pct);
  return `rgb(${r},${g},${b})`;
}

const EMPTY_FORM = { title: '', current_value: '', target_value: '', category: 'quarterly' };

export default function Goals() {
  const { profile, isAdmin } = useAuth();
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    if (profile?.id) fetchGoals();
  }, [profile?.id]);

  async function fetchGoals() {
    try {
      const { data, error } = await supabase.from('goals')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setGoals(data || []);
    } catch (err) {
      console.error('Error fetching goals:', err);
      setGoals([]);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(goal) {
    setEditingId(goal.id);
    setForm({
      title: goal.title,
      current_value: String(goal.current_value),
      target_value: String(goal.target_value),
      category: goal.category,
    });
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const title = form.title.trim();
    if (!title) return;
    const current_value = parseFloat(form.current_value) || 0;
    const target_value = parseFloat(form.target_value) || 1;

    if (editingId) {
      const { error } = await supabase.from('goals').update({
        title,
        current_value,
        target_value,
        category: form.category,
        updated_at: new Date().toISOString(),
      }).eq('id', editingId);
      if (error) { console.error(error); return; }
    } else {
      const { error } = await supabase.from('goals').insert({
        title,
        current_value,
        target_value,
        category: form.category,
        created_by: profile.id,
      }).select();
      if (error) { console.error(error); alert('Error creating goal: ' + error.message); return; }
    }
    cancelForm();
    fetchGoals();
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this goal?')) return;
    await supabase.from('goals').delete().eq('id', id);
    fetchGoals();
  }

  const quarterly = goals.filter(g => g.category === 'quarterly');
  const yearly = goals.filter(g => g.category === 'yearly');

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.loading}>Loading goals...</div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.topBar}>
        <div>
          <h1 style={styles.pageTitle}>Goals</h1>
          <p style={styles.pageSubtitle}>{goals.length} goal{goals.length !== 1 ? 's' : ''} tracked</p>
        </div>
        {isAdmin && (
          <button onClick={showForm ? cancelForm : openCreate} style={styles.addBtn}>
            {showForm ? '✕ Cancel' : '+ Add Goal'}
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            placeholder="Goal title"
            style={styles.input}
            autoFocus
          />
          <div style={styles.formRow}>
            <input
              value={form.current_value}
              onChange={e => setForm({ ...form, current_value: e.target.value })}
              placeholder="Current value"
              style={{ ...styles.input, flex: 1 }}
              inputMode="decimal"
            />
            <input
              value={form.target_value}
              onChange={e => setForm({ ...form, target_value: e.target.value })}
              placeholder="Target value"
              style={{ ...styles.input, flex: 1 }}
              inputMode="decimal"
            />
            <select
              value={form.category}
              onChange={e => setForm({ ...form, category: e.target.value })}
              style={styles.select}
            >
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          <button type="submit" style={styles.submitBtn}>
            {editingId ? 'Update Goal' : 'Create Goal'}
          </button>
        </form>
      )}

      <GoalSection title="Quarterly Goals" goals={quarterly} isAdmin={isAdmin} onEdit={openEdit} onDelete={handleDelete} />
      <GoalSection title="Yearly Goals" goals={yearly} isAdmin={isAdmin} onEdit={openEdit} onDelete={handleDelete} />
    </div>
  );
}

function GoalSection({ title, goals, isAdmin, onEdit, onDelete }) {
  if (goals.length === 0) return null;

  return (
    <div style={styles.section}>
      <h2 style={styles.sectionTitle}>{title}</h2>
      <div style={styles.grid}>
        {goals.map(goal => (
          <GoalCard key={goal.id} goal={goal} isAdmin={isAdmin} onEdit={onEdit} onDelete={onDelete} />
        ))}
      </div>
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
        <span style={styles.cardTitle}>{goal.title}</span>
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

      {/* Progress bar */}
      <div style={styles.barBg}>
        <div style={{
          ...styles.barFill,
          width: `${pctDisplay}%`,
          background: color,
        }} />
      </div>

      <div style={styles.cardFooter}>
        <span style={styles.cardNumbers}>{current} / {target}</span>
        <span style={{ ...styles.cardPct, color }}>{pctDisplay}%</span>
      </div>
      <div style={styles.cardUpdated}>Updated {formatDate(goal.updated_at)}</div>
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
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '14px',
  },
  card: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '12px',
    padding: '16px',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  cardTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#e2e8f0',
  },
  cardActions: {
    display: 'flex',
    gap: '4px',
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
};
