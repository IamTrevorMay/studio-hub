// Yearly + monthly goals section used at the top of the Tracking page.
// Self-contained: owns data fetching, CRUD, and presentation. Yearly cards
// lay out 2-per-row at half-page width. Each yearly card embeds a grid of
// its monthly children at 2-per-row (quarter-page width) which wraps as
// the number of monthlies grows.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';

// ─── Constants + helpers (mirrored from Goals.js so this stays standalone) ─

const PLATFORM_META = {
  youtube:   { label: 'YouTube',   color: '#FF0000' },
  facebook:  { label: 'Facebook',  color: '#1877F2' },
  instagram: { label: 'Instagram', color: '#E4405F' },
  tiktok:    { label: 'TikTok',    color: '#00F2EA' },
  substack:  { label: 'Substack',  color: '#FF6719' },
  twitch:    { label: 'Twitch',    color: '#9146FF' },
  stripe:    { label: 'Stripe',    color: '#635BFF' },
  fourthwall:{ label: 'Fourthwall',color: '#E8451C' },
};

const METRIC_OPTIONS = [
  { key: 'views',              label: 'Views' },
  { key: 'likes',              label: 'Likes' },
  { key: 'comments',           label: 'Comments' },
  { key: 'shares',             label: 'Shares' },
  { key: 'watch_time_seconds', label: 'Watch Time (hrs)' },
];

const EMPTY_GOAL = { title: '', current_value: '', target_value: '', category: 'yearly', goal_type: 'manual', metrics: [], platform_account_ids: [] };
const EMPTY_MONTHLY = { title: '', content_type_filter: 'video', target_value: '', platform_account_ids: [] };

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diff = Date.now() - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function progressColor(pct) {
  const r = Math.round(0x86 + (0x16 - 0x86) * pct);
  const g = Math.round(0xef + (0xa3 - 0xef) * pct);
  const b = Math.round(0xac + (0x4a - 0xac) * pct);
  return `rgb(${r},${g},${b})`;
}

function formatMetricValue(key, value) {
  if (key === 'watch_time_seconds') return Math.round(value / 3600).toLocaleString() + 'h';
  return Math.round(value).toLocaleString();
}

function formatTargetForMetric(key, value) {
  if (key === 'watch_time_seconds') return value * 3600;
  return value;
}

function yearRange() {
  const now = new Date();
  const year = now.getFullYear();
  return { start: `${year}-01-01`, end: now.toISOString().split('T')[0] };
}

// Fraction of the year that has elapsed. Used as the "on-pace" marker
// position on yearly progress bars.
function yearlyExpectedFraction() {
  const now = new Date();
  const y = now.getFullYear();
  const startMs = new Date(y, 0, 1).getTime();
  const endMs = new Date(y + 1, 0, 1).getTime();
  return Math.min(1, Math.max(0, (now.getTime() - startMs) / (endMs - startMs)));
}

// Fraction of the current calendar month that has elapsed.
function monthlyExpectedFraction() {
  const now = new Date();
  const startMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const endMs = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  return Math.min(1, Math.max(0, (now.getTime() - startMs) / (endMs - startMs)));
}

// ─── Section ──────────────────────────────────────────────────

export default function YearlyGoalsSection() {
  const { profile, isAdmin } = useAuth();
  const confirm = useConfirm();

  const [goals, setGoals] = useState([]);              // yearly only
  const [monthlyGoals, setMonthlyGoals] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [rollupData, setRollupData] = useState({});
  const [velocityData, setVelocityData] = useState({});
  const [monthlyProgress, setMonthlyProgress] = useState({});
  const [loading, setLoading] = useState(true);

  // Goal form
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState(null);
  const [goalForm, setGoalForm] = useState(EMPTY_GOAL);

  // Monthly form. `showMonthlyForm` holds the parent yearly-goal id
  // ('standalone' is reserved for monthlies with no parent — currently
  // unused on Tracking since the Goals page kept that section.)
  const [showMonthlyForm, setShowMonthlyForm] = useState(null);
  const [editingMonthlyId, setEditingMonthlyId] = useState(null);
  const [monthlyForm, setMonthlyForm] = useState(EMPTY_MONTHLY);

  // Collapse state for each yearly card's monthly grid. Default expanded.
  const [collapsedMonthly, setCollapsedMonthly] = useState({});
  const toggleMonthly = (yearlyId) =>
    setCollapsedMonthly(prev => ({ ...prev, [yearlyId]: !prev[yearlyId] }));

  // "+ Goal" dropdown
  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const addDropdownRef = useRef(null);
  useEffect(() => {
    if (!showAddDropdown) return;
    const onClick = (e) => { if (addDropdownRef.current && !addDropdownRef.current.contains(e.target)) setShowAddDropdown(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showAddDropdown]);

  // ── Data fetch ──

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [goalsRes, acctRes, monthlyRes] = await Promise.all([
        supabase.from('goals').select('*').eq('scope', 'content').eq('category', 'yearly').order('created_at', { ascending: false }),
        supabase.from('platform_accounts').select('*').eq('is_active', true).order('platform'),
        supabase.from('monthly_goals').select('*').eq('scope', 'content').order('created_at'),
      ]);
      if (goalsRes.error) throw goalsRes.error;

      const goalsData = goalsRes.data || [];
      const monthlyData = monthlyRes.data || [];
      const acctData = acctRes.data || [];
      setGoals(goalsData);
      setMonthlyGoals(monthlyData);
      setAccounts(acctData);

      const metricGoals = goalsData.filter(g => g.goal_type === 'metric');
      if (metricGoals.length > 0) {
        const rollup = await fetchRollupData(metricGoals);
        if (rollup) await fetchVelocityData(metricGoals, rollup);
      }

      if (monthlyData.length > 0) {
        await fetchMonthlyProgress(monthlyData, acctData);
      }
    } catch (err) {
      console.error('YearlyGoalsSection fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!profile?.id) return;
    fetchAll();
  }, [profile?.id, fetchAll]);
  useVisibilityRefresh(fetchAll);

  async function fetchRollupData(metricGoals) {
    const { start, end } = yearRange();
    const allAccountIds = [...new Set(metricGoals.flatMap(g => g.platform_account_ids || []))];
    if (!allAccountIds.length) return {};
    const { data: rollups } = await supabase
      .from('platform_daily_metrics')
      .select('*')
      .gte('date', start)
      .lte('date', end)
      .in('platform_account_id', allAccountIds);
    if (!rollups) return {};
    const result = {};
    for (const goal of metricGoals) {
      const goalAccountIds = goal.platform_account_ids || [];
      const goalMetrics = goal.metrics || [];
      const filtered = rollups.filter(r => goalAccountIds.includes(r.platform_account_id));
      const sums = {};
      for (const m of goalMetrics) {
        sums[m] = filtered.reduce((acc, r) => acc + (Number(r[m]) || 0), 0);
      }
      result[goal.id] = sums;
    }
    setRollupData(result);
    return result;
  }

  async function fetchVelocityData(metricGoals, rollupResult) {
    const allAccountIds = [...new Set(metricGoals.flatMap(g => g.platform_account_ids || []))];
    if (!allAccountIds.length) return;
    const today = new Date();
    const d20ago = new Date(today); d20ago.setDate(d20ago.getDate() - 20);
    const d10ago = new Date(today); d10ago.setDate(d10ago.getDate() - 10);
    const fmt = d => d.toISOString().split('T')[0];

    const { data: rows } = await supabase
      .from('platform_daily_metrics')
      .select('*')
      .gte('date', fmt(d20ago))
      .lte('date', fmt(today))
      .in('platform_account_id', allAccountIds);
    if (!rows) return;

    const result = {};
    for (const goal of metricGoals) {
      const goalAccountIds = goal.platform_account_ids || [];
      const goalMetrics = goal.metrics || [];
      const goalRows = rows.filter(r => goalAccountIds.includes(r.platform_account_id));
      const last10 = goalRows.filter(r => r.date > fmt(d10ago));
      const prev10 = goalRows.filter(r => r.date <= fmt(d10ago));

      let sumLast = 0, sumPrev = 0;
      for (const m of goalMetrics) {
        sumLast += last10.reduce((a, r) => a + (Number(r[m]) || 0), 0);
        sumPrev += prev10.reduce((a, r) => a + (Number(r[m]) || 0), 0);
      }
      const currentTotal = goalMetrics.reduce((a, m) => a + ((rollupResult[goal.id] || {})[m] || 0), 0);
      const target = Number(goal.target_value) || 0;
      const remaining = target - currentTotal;
      const year = today.getFullYear();
      const endDate = new Date(year, 11, 31);
      const daysRemaining = Math.max(1, Math.ceil((endDate - today) / 86400000));
      const paceNeeded10 = (remaining / daysRemaining) * 10;
      result[goal.id] = { last10: sumLast, prev10: sumPrev, paceNeeded10 };
    }
    setVelocityData(result);
  }

  async function fetchMonthlyProgress(mGoals, accts) {
    const now = new Date();
    const year = now.getFullYear();
    const yearStart = `${year}-01-01`;
    const yearEnd = now.toISOString();
    const allAccountIds = [...new Set(mGoals.flatMap(g => g.platform_account_ids || []))];
    if (!allAccountIds.length) return;

    const tiktokAccountIds = new Set((accts || []).filter(a => a.platform === 'tiktok').map(a => a.id));

    const { data: items } = await supabase
      .from('content_items')
      .select('id, content_type, platform_account_id, published_at, duration_seconds')
      .gte('published_at', yearStart)
      .lte('published_at', yearEnd)
      .in('platform_account_id', allAccountIds.filter(id => !tiktokAccountIds.has(id)));

    const needsTiktok = mGoals.some(mg => (mg.platform_account_ids || []).some(id => tiktokAccountIds.has(id)));
    const tiktokByMonth = {};
    if (needsTiktok) {
      try {
        const { data: { session: mcSession } } = await supabase.auth.getSession();
        const res = await fetch(
          `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/metricool-posts?start=${year}-01-01T00:00:00&end=${year}-12-31T23:59:59`,
          { headers: { Authorization: `Bearer ${mcSession?.access_token}`, apikey: process.env.REACT_APP_SUPABASE_ANON_KEY } },
        );
        if (res.ok) {
          const { posts } = await res.json();
          const tiktokPosts = (posts || []).filter(p => p.network === 'TIKTOK' && p.status === 'PUBLISHED');
          for (const p of tiktokPosts) {
            const month = typeof p.publicationDate === 'string' ? p.publicationDate.substring(0, 7) : null;
            if (month) tiktokByMonth[month] = (tiktokByMonth[month] || 0) + 1;
          }
        }
      } catch (err) {
        console.error('metricool tiktok fetch:', err);
      }
    }

    const LONGFORM_THRESHOLD = 180;
    const result = {};
    for (const mg of mGoals) {
      const goalAccountIds = mg.platform_account_ids || [];
      const hasTiktok = goalAccountIds.some(id => tiktokAccountIds.has(id));
      const nonTiktokIds = goalAccountIds.filter(id => !tiktokAccountIds.has(id));
      const filtered = (items || []).filter(item => {
        if (!nonTiktokIds.includes(item.platform_account_id)) return false;
        if (mg.content_type_filter === 'video') {
          return item.content_type === 'video' && (item.duration_seconds || 0) > LONGFORM_THRESHOLD;
        }
        return item.content_type === 'short' || item.content_type === 'reel' || (item.content_type === 'video' && (item.duration_seconds || 0) <= LONGFORM_THRESHOLD);
      });
      const byMonth = {};
      for (const item of filtered) {
        const month = item.published_at.substring(0, 7);
        byMonth[month] = (byMonth[month] || 0) + 1;
      }
      if (hasTiktok && mg.content_type_filter === 'short') {
        for (const [month, count] of Object.entries(tiktokByMonth)) {
          byMonth[month] = (byMonth[month] || 0) + count;
        }
      }
      result[mg.id] = byMonth;
    }
    setMonthlyProgress(result);
  }

  // ── Yearly goal CRUD ──

  function openCreateGoal() {
    setEditingGoalId(null);
    setGoalForm({ ...EMPTY_GOAL });
    setShowGoalForm(true);
  }
  function openEditGoal(goal) {
    setEditingGoalId(goal.id);
    setGoalForm({
      title: goal.title,
      current_value: String(goal.current_value),
      target_value: String(goal.target_value),
      category: 'yearly',
      goal_type: goal.goal_type || 'manual',
      metrics: goal.metrics || [],
      platform_account_ids: goal.platform_account_ids || [],
    });
    setShowGoalForm(true);
  }
  function cancelGoalForm() {
    setShowGoalForm(false);
    setEditingGoalId(null);
    setGoalForm({ ...EMPTY_GOAL });
  }
  async function handleGoalSubmit(e) {
    e.preventDefault();
    const title = goalForm.title.trim();
    if (!title) return;
    const isMetric = goalForm.goal_type === 'metric';
    const target_value = parseFloat(goalForm.target_value) || 1;
    const current_value = isMetric ? 0 : (parseFloat(goalForm.current_value) || 0);
    const storedTarget = isMetric && goalForm.metrics.length === 1
      ? formatTargetForMetric(goalForm.metrics[0], target_value)
      : target_value;
    const payload = {
      title,
      current_value: isMetric ? 0 : current_value,
      target_value: storedTarget,
      category: 'yearly',
      goal_type: goalForm.goal_type,
      metrics: isMetric ? goalForm.metrics : [],
      platform_account_ids: isMetric ? goalForm.platform_account_ids : [],
    };
    if (isMetric && (!payload.metrics.length || !payload.platform_account_ids.length)) {
      alert('Please select at least one metric and one platform.');
      return;
    }
    if (editingGoalId) {
      const { error } = await supabase.from('goals').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editingGoalId);
      if (error) { alert('Error: ' + error.message); return; }
    } else {
      const { error } = await supabase.from('goals').insert({ ...payload, created_by: profile.id }).select();
      if (error) { alert('Error: ' + error.message); return; }
    }
    cancelGoalForm();
    fetchAll();
  }
  async function handleDeleteGoal(id) {
    if (!(await confirm('Delete this goal?'))) return;
    await supabase.from('goals').delete().eq('id', id);
    fetchAll();
  }

  // ── Monthly goal CRUD ──

  function openCreateMonthly(parentGoalId) {
    setEditingMonthlyId(null);
    setMonthlyForm({ ...EMPTY_MONTHLY });
    setShowMonthlyForm(parentGoalId);
  }
  function openEditMonthly(mg) {
    setEditingMonthlyId(mg.id);
    setMonthlyForm({
      title: mg.title,
      content_type_filter: mg.content_type_filter,
      target_value: String(mg.target_value),
      platform_account_ids: mg.platform_account_ids || [],
    });
    setShowMonthlyForm(mg.parent_goal_id);
  }
  function cancelMonthlyForm() {
    setShowMonthlyForm(null);
    setEditingMonthlyId(null);
    setMonthlyForm({ ...EMPTY_MONTHLY });
  }
  async function handleMonthlySubmit(e, parentGoalId) {
    e.preventDefault();
    const title = monthlyForm.title.trim();
    if (!title || !monthlyForm.platform_account_ids.length) {
      alert('Please fill in all fields and select at least one platform.');
      return;
    }
    const target_value = parseInt(monthlyForm.target_value) || 1;
    if (editingMonthlyId) {
      const { error } = await supabase.from('monthly_goals').update({
        title,
        content_type_filter: monthlyForm.content_type_filter,
        target_value,
        platform_account_ids: monthlyForm.platform_account_ids,
        updated_at: new Date().toISOString(),
      }).eq('id', editingMonthlyId);
      if (error) { alert('Error: ' + error.message); return; }
    } else {
      const { error } = await supabase.from('monthly_goals').insert({
        title,
        content_type_filter: monthlyForm.content_type_filter,
        target_value,
        platform_account_ids: monthlyForm.platform_account_ids,
        parent_goal_id: parentGoalId,
        created_by: profile.id,
      });
      if (error) { alert('Error: ' + error.message); return; }
    }
    cancelMonthlyForm();
    fetchAll();
  }
  async function handleDeleteMonthly(id) {
    if (!(await confirm('Delete this monthly goal?'))) return;
    await supabase.from('monthly_goals').delete().eq('id', id);
    fetchAll();
  }

  // ── Form helpers ──

  const toggleMetric = (key) => setGoalForm(prev => {
    const cur = prev.metrics || [];
    if (cur.includes(key)) return { ...prev, metrics: cur.filter(m => m !== key) };
    if (cur.length >= 3) return prev;
    return { ...prev, metrics: [...cur, key] };
  });
  const togglePlatformAccount = (id) => setGoalForm(prev => {
    const cur = prev.platform_account_ids || [];
    return cur.includes(id)
      ? { ...prev, platform_account_ids: cur.filter(a => a !== id) }
      : { ...prev, platform_account_ids: [...cur, id] };
  });
  const toggleMonthlyPlatform = (id) => setMonthlyForm(prev => {
    const cur = prev.platform_account_ids || [];
    return cur.includes(id)
      ? { ...prev, platform_account_ids: cur.filter(a => a !== id) }
      : { ...prev, platform_account_ids: [...cur, id] };
  });

  // ── Render ──

  const isMetricForm = goalForm.goal_type === 'metric';

  if (loading) {
    return <div style={styles.loading}>Loading goals…</div>;
  }

  return (
    <div style={styles.section}>
      <div style={styles.header}>
        <h2 style={styles.title}>Goals</h2>
        {isAdmin && (
          <div ref={addDropdownRef} style={{ position: 'relative' }}>
            <button onClick={() => setShowAddDropdown(v => !v)} style={styles.addBtn}>+ Goal ▾</button>
            {showAddDropdown && (
              <div style={styles.dropdown}>
                <button style={styles.dropdownItem} onClick={() => { setShowAddDropdown(false); openCreateGoal(); }}>
                  Yearly Goal
                </button>
                <button style={{ ...styles.dropdownItem, color: 'rgba(255,255,255,0.35)', fontSize: 11 }} disabled>
                  (Monthly: open a yearly card)
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Yearly create/edit form (full-width above the grid) */}
      {showGoalForm && (
        <form onSubmit={handleGoalSubmit} style={styles.form}>
          <div style={styles.formLabel}>{editingGoalId ? 'Edit Yearly Goal' : 'New Yearly Goal'}</div>
          <div style={styles.formRow}>
            <button type="button" onClick={() => setGoalForm({ ...goalForm, goal_type: 'manual' })}
              style={{ ...styles.typeBtn, ...(goalForm.goal_type === 'manual' ? styles.typeBtnActive : {}) }}>
              Manual
            </button>
            <button type="button" onClick={() => setGoalForm({ ...goalForm, goal_type: 'metric' })}
              style={{ ...styles.typeBtn, ...(goalForm.goal_type === 'metric' ? styles.typeBtnActive : {}) }}>
              Metric
            </button>
          </div>
          <input
            value={goalForm.title}
            onChange={e => setGoalForm({ ...goalForm, title: e.target.value })}
            placeholder="Goal title"
            style={styles.input}
            autoFocus
          />
          {!isMetricForm && (
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
            </div>
          )}
          {isMetricForm && (
            <>
              <input
                value={goalForm.target_value}
                onChange={e => setGoalForm({ ...goalForm, target_value: e.target.value })}
                placeholder="Target value"
                style={styles.input}
                inputMode="decimal"
              />
              <div>
                <div style={styles.formSubLabel}>Metrics (up to 3)</div>
                <div style={styles.chipRow}>
                  {METRIC_OPTIONS.map(m => {
                    const selected = (goalForm.metrics || []).includes(m.key);
                    return (
                      <button key={m.key} type="button" onClick={() => toggleMetric(m.key)}
                        style={{ ...styles.chip, ...(selected ? styles.chipSelected : {}) }}>
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <div style={styles.formSubLabel}>Platforms</div>
                <div style={styles.chipRow}>
                  {accounts.filter(a => a.platform !== 'stripe').map(acct => {
                    const selected = (goalForm.platform_account_ids || []).includes(acct.id);
                    const pm = PLATFORM_META[acct.platform] || {};
                    return (
                      <button key={acct.id} type="button" onClick={() => togglePlatformAccount(acct.id)}
                        style={{
                          ...styles.chip,
                          ...(selected ? { background: (pm.color || '#666') + '22', borderColor: (pm.color || '#666') + '66', color: pm.color || '#fff' } : {}),
                        }}>
                        {acct.account_name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
          <div style={styles.formRow}>
            <button type="submit" style={styles.submitBtn}>{editingGoalId ? 'Update Goal' : 'Create Goal'}</button>
            <button type="button" onClick={cancelGoalForm} style={{ ...styles.addBtn, color: 'rgba(255,255,255,0.5)' }}>Cancel</button>
          </div>
        </form>
      )}

      {/* Yearly grid: 2 per row */}
      {goals.length === 0 ? (
        <p style={styles.empty}>{isAdmin ? 'No yearly goals yet — create one with the + Goal button above.' : 'No yearly goals yet.'}</p>
      ) : (
        <div style={styles.yearlyGrid}>
          {goals.map(g => {
            const childGoals = monthlyGoals.filter(mg => mg.parent_goal_id === g.id);
            const showFormHere = isAdmin && showMonthlyForm === g.id;
            return (
              <div key={g.id} style={styles.yearlyCell}>
                <GoalCard
                  goal={g}
                  rollupData={rollupData}
                  velocityData={velocityData}
                  accounts={accounts}
                  isAdmin={isAdmin}
                  onEdit={openEditGoal}
                  onDelete={handleDeleteGoal}
                />

                <div style={styles.monthlyZone}>
                  <div style={styles.monthlyHeader}>
                    <button
                      type="button"
                      onClick={() => toggleMonthly(g.id)}
                      style={styles.monthlyCollapseBtn}
                      title={collapsedMonthly[g.id] ? 'Expand monthly goals' : 'Collapse monthly goals'}
                    >
                      <span style={{
                        display: 'inline-block',
                        transform: collapsedMonthly[g.id] ? 'rotate(-90deg)' : 'rotate(0deg)',
                        transition: 'transform 0.15s',
                        fontSize: 9,
                        color: 'rgba(255,255,255,0.5)',
                      }}>▼</span>
                      <span style={styles.monthlyHeaderTitle}>
                        Monthly{childGoals.length > 0 ? ` · ${childGoals.length}` : ''}
                      </span>
                    </button>
                    {isAdmin && !showFormHere && (
                      <button onClick={() => { setCollapsedMonthly(prev => ({ ...prev, [g.id]: false })); openCreateMonthly(g.id); }} style={styles.addMonthlyBtn}>+ Monthly</button>
                    )}
                  </div>

                  {!collapsedMonthly[g.id] && (
                  <div style={styles.monthlyGrid}>
                    {childGoals.map(mg => (
                      <MonthlyGoalCard
                        key={mg.id}
                        goal={mg}
                        progress={monthlyProgress[mg.id] || {}}
                        accounts={accounts}
                        isAdmin={isAdmin}
                        onEdit={openEditMonthly}
                        onDelete={handleDeleteMonthly}
                      />
                    ))}
                    {showFormHere && (
                      <form onSubmit={(e) => handleMonthlySubmit(e, g.id)} style={styles.monthlyFormCard}>
                        <div style={styles.formLabel}>{editingMonthlyId ? 'Edit Monthly Goal' : 'New Monthly Goal'}</div>
                        <input
                          value={monthlyForm.title}
                          onChange={e => setMonthlyForm({ ...monthlyForm, title: e.target.value })}
                          placeholder="Title"
                          style={styles.input}
                          autoFocus
                        />
                        <div style={styles.formRow}>
                          <button type="button" onClick={() => setMonthlyForm({ ...monthlyForm, content_type_filter: 'video' })}
                            style={{ ...styles.typeBtn, ...(monthlyForm.content_type_filter === 'video' ? styles.typeBtnActive : {}) }}>
                            Longform
                          </button>
                          <button type="button" onClick={() => setMonthlyForm({ ...monthlyForm, content_type_filter: 'short' })}
                            style={{ ...styles.typeBtn, ...(monthlyForm.content_type_filter === 'short' ? styles.typeBtnActive : {}) }}>
                            Short
                          </button>
                        </div>
                        <input
                          value={monthlyForm.target_value}
                          onChange={e => setMonthlyForm({ ...monthlyForm, target_value: e.target.value })}
                          placeholder="Target per month"
                          style={styles.input}
                          inputMode="numeric"
                        />
                        <div>
                          <div style={styles.formSubLabel}>Platforms</div>
                          <div style={styles.chipRow}>
                            {accounts.map(acct => {
                              const selected = (monthlyForm.platform_account_ids || []).includes(acct.id);
                              const pm = PLATFORM_META[acct.platform] || {};
                              return (
                                <button key={acct.id} type="button" onClick={() => toggleMonthlyPlatform(acct.id)}
                                  style={{
                                    ...styles.chip,
                                    ...(selected ? { background: (pm.color || '#666') + '22', borderColor: (pm.color || '#666') + '66', color: pm.color || '#fff' } : {}),
                                  }}>
                                  {acct.account_name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div style={styles.formRow}>
                          <button type="submit" style={styles.submitBtn}>{editingMonthlyId ? 'Update' : 'Create'}</button>
                          <button type="button" onClick={cancelMonthlyForm} style={{ ...styles.addBtn, color: 'rgba(255,255,255,0.5)' }}>Cancel</button>
                        </div>
                      </form>
                    )}
                    {childGoals.length === 0 && !showFormHere && (
                      <div style={styles.monthlyEmpty}>No monthly goals yet.</div>
                    )}
                  </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Subcomponents ───────────────────────────────────────────

function GoalCard({ goal, rollupData, velocityData, accounts, isAdmin, onEdit, onDelete }) {
  const isMetric = goal.goal_type === 'metric';
  const goalMetrics = goal.metrics || [];
  const goalAccountIds = goal.platform_account_ids || [];
  const [paceHover, setPaceHover] = useState(false);

  let current, target, metricBreakdown;
  if (isMetric && goalMetrics.length > 0) {
    const sums = rollupData[goal.id] || {};
    if (goalMetrics.length === 1) {
      const key = goalMetrics[0];
      current = sums[key] || 0;
      target = Number(goal.target_value) || 1;
      metricBreakdown = null;
    } else {
      current = goalMetrics.reduce((acc, key) => acc + (sums[key] || 0), 0);
      target = Number(goal.target_value) || 1;
      metricBreakdown = goalMetrics.map(key => ({
        key,
        label: METRIC_OPTIONS.find(m => m.key === key)?.label || key,
        value: sums[key] || 0,
      }));
    }
  } else {
    target = Number(goal.target_value) || 1;
    current = Number(goal.current_value) || 0;
  }

  const pct = Math.min(current / target, 1);
  const pctDisplay = Math.round(pct * 100);
  const color = progressColor(pct);

  const displayCurrent = isMetric && goalMetrics.length === 1
    ? formatMetricValue(goalMetrics[0], current)
    : isMetric ? Math.round(current).toLocaleString() : current;
  const displayTarget = isMetric && goalMetrics.length === 1
    ? formatMetricValue(goalMetrics[0], target)
    : isMetric ? Math.round(target).toLocaleString() : target;

  const platformLabels = isMetric
    ? goalAccountIds.map(id => (accounts.find(a => a.id === id) || {}).account_name).filter(Boolean)
    : [];

  const expectedFrac = yearlyExpectedFraction();
  const expectedPct = Math.round(expectedFrac * 100);
  const expectedValue = target * expectedFrac;
  const expectedDisplay = isMetric && goalMetrics.length === 1
    ? formatMetricValue(goalMetrics[0], expectedValue)
    : Math.round(expectedValue).toLocaleString();

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <div style={styles.cardTitleRow}>
          <span style={isMetric ? styles.metricBadge : styles.cardBadge}>{isMetric ? 'Metric' : 'Goal'}</span>
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

      {isMetric && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
          {goalMetrics.map(key => (
            <span key={key} style={styles.metricTag}>
              {METRIC_OPTIONS.find(m => m.key === key)?.label || key}
            </span>
          ))}
          {platformLabels.map((name, i) => (
            <span key={i} style={styles.platformTag}>{name}</span>
          ))}
        </div>
      )}

      <div style={styles.barBg}>
        <div style={styles.barClip}>
          <div style={{ ...styles.barFill, width: `${pctDisplay}%`, background: color }} />
        </div>
        <div
          style={{ ...styles.paceHit, left: `${expectedPct}%` }}
          onMouseEnter={() => setPaceHover(true)}
          onMouseLeave={() => setPaceHover(false)}
        >
          <div style={styles.paceTick} />
          <div style={styles.paceDot} />
          {paceHover && (
            <div style={styles.paceTip}>On pace: {expectedDisplay} ({expectedPct}%)</div>
          )}
        </div>
      </div>
      <div style={styles.cardFooter}>
        <span style={styles.cardNumbers}>{displayCurrent} / {displayTarget}</span>
        <span style={{ ...styles.cardPct, color }}>{pctDisplay}%</span>
      </div>

      {metricBreakdown && (
        <div style={{ marginTop: '6px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {metricBreakdown.map(m => (
            <span key={m.key} style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
              {m.label}: {formatMetricValue(m.key, m.value)}
            </span>
          ))}
        </div>
      )}

      {isMetric && velocityData[goal.id] && (() => {
        const v = velocityData[goal.id];
        const fmtKey = goalMetrics.length === 1 ? goalMetrics[0] : null;
        const fmtVal = val => fmtKey ? formatMetricValue(fmtKey, val) : Math.round(val).toLocaleString();
        const statusColor = v.last10 >= v.paceNeeded10 * 1.02 ? '#22c55e'
          : v.last10 >= v.paceNeeded10 * 0.98 ? '#86efac' : '#f97316';
        const statusLabel = v.last10 >= v.paceNeeded10 * 1.02 ? 'Ahead'
          : v.last10 >= v.paceNeeded10 * 0.98 ? 'On Pace' : 'Behind';
        return (
          <div style={{ marginTop: '6px', fontSize: '11px', color: 'rgba(255,255,255,0.4)', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
            <span>Last 10d: +{fmtVal(v.last10)} (prev: +{fmtVal(v.prev10)})</span>
            <span>+{fmtVal(v.last10)} <span style={{ color: statusColor }}>{statusLabel}</span> ({fmtVal(v.paceNeeded10)})</span>
          </div>
        );
      })()}

      <div style={styles.cardUpdated}>
        {isMetric ? 'This year — live' : `Updated ${formatDate(goal.updated_at)}`}
      </div>
    </div>
  );
}

function MonthlyGoalCard({ goal, progress, accounts, isAdmin, onEdit, onDelete }) {
  const [paceHover, setPaceHover] = useState(false);
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentCount = progress[currentMonth] || 0;
  const target = goal.target_value || 1;
  const pct = Math.min(currentCount / target, 1);
  const pctDisplay = Math.round(pct * 100);
  const color = progressColor(pct);
  const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const contentLabel = goal.content_type_filter === 'video' ? 'Video' : 'Short';
  const contentColor = goal.content_type_filter === 'video' ? '#f472b6' : '#38bdf8';
  const platformLabels = (goal.platform_account_ids || []).map(id => (accounts.find(a => a.id === id) || {}).account_name).filter(Boolean);
  const expectedFrac = monthlyExpectedFraction();
  const expectedPct = Math.round(expectedFrac * 100);
  const expectedValue = Math.round(target * expectedFrac);

  return (
    <div style={styles.monthlyCard}>
      <div style={styles.cardHeader}>
        <div style={styles.cardTitleRow}>
          <span style={styles.monthlyBadge}>Monthly</span>
          <span style={{
            fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
            color: contentColor, background: contentColor + '18', padding: '3px 8px', borderRadius: '4px', flexShrink: 0,
          }}>{contentLabel}</span>
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

      {platformLabels.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
          {platformLabels.map((name, i) => (
            <span key={i} style={styles.platformTag}>{name}</span>
          ))}
        </div>
      )}

      <div style={styles.barBg}>
        <div style={styles.barClip}>
          <div style={{ ...styles.barFill, width: `${pctDisplay}%`, background: color }} />
        </div>
        <div
          style={{ ...styles.paceHit, left: `${expectedPct}%` }}
          onMouseEnter={() => setPaceHover(true)}
          onMouseLeave={() => setPaceHover(false)}
        >
          <div style={styles.paceTick} />
          <div style={styles.paceDot} />
          {paceHover && (
            <div style={styles.paceTip}>On pace: {expectedValue} ({expectedPct}%)</div>
          )}
        </div>
      </div>
      <div style={styles.cardFooter}>
        <span style={styles.cardNumbers}>{currentCount} / {target}</span>
        <span style={{ ...styles.cardPct, color }}>{pctDisplay}%</span>
      </div>
      <div style={styles.cardUpdated}>{monthLabel} — live</div>
    </div>
  );
}

// ─── Styles ────────────────────────────────────────────────

const styles = {
  section: { marginBottom: 32 },
  loading: { color: 'rgba(255,255,255,0.4)', padding: '20px 0', fontSize: 13 },

  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontSize: 18, fontWeight: 700, color: '#fff', margin: 0 },

  addBtn: {
    padding: '8px 16px', borderRadius: 10, border: 'none',
    background: 'rgba(99,102,241,0.15)', color: '#a5b4fc',
    fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  dropdown: {
    position: 'absolute', top: '110%', right: 0,
    background: '#1e1e2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
    overflow: 'hidden', zIndex: 50, minWidth: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  dropdownItem: {
    display: 'block', width: '100%', padding: '10px 16px',
    border: 'none', background: 'transparent', color: '#e2e8f0',
    fontSize: 13, fontWeight: 500, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
  },

  empty: { color: 'rgba(255,255,255,0.3)', fontSize: 13, padding: '12px 0' },

  yearlyGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 16,
  },
  yearlyCell: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 14,
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    minWidth: 0,
  },

  monthlyZone: { display: 'flex', flexDirection: 'column', gap: 10 },
  monthlyHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  monthlyCollapseBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: 'transparent', border: 'none', padding: '2px 0',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  monthlyHeaderTitle: {
    fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.4)',
  },
  monthlyGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 10,
  },
  monthlyEmpty: {
    gridColumn: '1 / -1',
    fontSize: 12, color: 'rgba(255,255,255,0.3)',
    border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 8,
    padding: '10px 12px',
  },
  monthlyFormCard: {
    gridColumn: '1 / -1',
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10, padding: 14,
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  addMonthlyBtn: {
    padding: '4px 10px', borderRadius: 6,
    border: '1px dashed rgba(255,255,255,0.15)', background: 'transparent',
    color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },

  form: {
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12, padding: 16, marginBottom: 16,
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  formLabel: { fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 2 },
  formSubLabel: {
    fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.35)',
    marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  formRow: { display: 'flex', gap: 10 },

  input: {
    padding: '10px 12px', borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.06)',
    color: '#e2e8f0', fontSize: 13, fontFamily: 'inherit', outline: 'none',
  },
  typeBtn: {
    flex: 1, padding: '8px 14px', borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.4)', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  typeBtnActive: { background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.4)', color: '#a5b4fc' },
  chipRow: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  chip: {
    padding: '5px 12px', borderRadius: 16,
    border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  chipSelected: { background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.4)', color: '#a5b4fc' },
  submitBtn: {
    padding: '10px 20px', borderRadius: 8, border: 'none',
    background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },

  // Card primitives (used by GoalCard + MonthlyGoalCard)
  card: {
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12, padding: 16, width: '100%', minWidth: 0,
  },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTitleRow: { display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 14, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cardActions: { display: 'flex', gap: 4, flexShrink: 0 },
  iconBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28, border: 'none', borderRadius: 6,
    background: 'transparent', color: 'rgba(255,255,255,0.35)', cursor: 'pointer',
  },
  cardBadge: {
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
    color: '#86efac', background: 'rgba(134,239,172,0.1)',
    padding: '3px 8px', borderRadius: 4, flexShrink: 0,
  },
  metricBadge: {
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
    color: '#c4b5fd', background: 'rgba(196,181,253,0.1)',
    padding: '3px 8px', borderRadius: 4, flexShrink: 0,
  },
  metricTag: {
    fontSize: 10, fontWeight: 600,
    color: 'rgba(196,181,253,0.7)', background: 'rgba(196,181,253,0.08)',
    padding: '2px 8px', borderRadius: 10,
  },
  platformTag: {
    fontSize: 10, fontWeight: 600,
    color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)',
    padding: '2px 8px', borderRadius: 10,
  },
  barBg: {
    position: 'relative',
    height: 8, borderRadius: 4,
    background: 'rgba(255,255,255,0.08)', overflow: 'visible', marginBottom: 8,
  },
  barClip: {
    position: 'absolute', inset: 0,
    borderRadius: 4, overflow: 'hidden',
  },
  paceHit: {
    position: 'absolute',
    top: -6, bottom: -6,
    width: 14,
    transform: 'translateX(-7px)',
    cursor: 'help',
  },
  paceTick: {
    position: 'absolute',
    top: 3, bottom: 3,
    left: '50%',
    width: 2,
    background: '#f97316',
    transform: 'translateX(-1px)',
    borderRadius: 1,
    pointerEvents: 'none',
  },
  paceDot: {
    position: 'absolute',
    top: 1, left: '50%',
    height: 4, width: 4,
    borderRadius: '50%',
    background: '#f97316',
    transform: 'translateX(-2px)',
    pointerEvents: 'none',
  },
  paceTip: {
    position: 'absolute',
    bottom: 'calc(100% + 6px)',
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#1a1a2e',
    border: '1px solid rgba(249,115,22,0.4)',
    color: '#fdba74',
    padding: '4px 8px',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    zIndex: 5,
  },
  barFill: { height: '100%', borderRadius: 4, transition: 'width 0.3s ease', minWidth: 2 },
  cardFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardNumbers: { fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  cardPct: { fontSize: 14, fontWeight: 700 },
  cardUpdated: { fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 4 },

  monthlyCard: {
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10, padding: 12, width: '100%', minWidth: 0,
  },
  monthlyBadge: {
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
    color: '#fbbf24', background: 'rgba(251,191,36,0.1)',
    padding: '3px 8px', borderRadius: 4, flexShrink: 0,
  },
};
