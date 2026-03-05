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

// ═══════════════════════════════════════════════
// Metric goal config
// ═══════════════════════════════════════════════
const PLATFORM_META = {
  youtube:   { label: 'YouTube',   color: '#FF0000' },
  facebook:  { label: 'Facebook',  color: '#1877F2' },
  instagram: { label: 'Instagram', color: '#E4405F' },
  tiktok:    { label: 'TikTok',    color: '#00F2EA' },
  substack:  { label: 'Substack',  color: '#FF6719' },
  twitch:    { label: 'Twitch',    color: '#9146FF' },
  stripe:    { label: 'Stripe',    color: '#635BFF' },
};

const METRIC_OPTIONS = [
  { key: 'total_views',              label: 'Views' },
  { key: 'revenue_cents',            label: 'Revenue ($)' },
  { key: 'followers_eod',            label: 'Followers' },
  { key: 'total_likes',              label: 'Likes' },
  { key: 'total_comments',           label: 'Comments' },
  { key: 'total_shares',             label: 'Shares' },
  { key: 'total_watch_time_seconds', label: 'Watch Time (hrs)' },
  { key: 'posts_published',          label: 'Posts Published' },
];

function getDateRangeForCategory(category) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  if (category === 'quarterly') {
    const qStart = new Date(year, Math.floor(month / 3) * 3, 1);
    return { start: qStart.toISOString().split('T')[0], end: now.toISOString().split('T')[0] };
  }
  return { start: `${year}-01-01`, end: now.toISOString().split('T')[0] };
}

function formatMetricValue(key, value) {
  if (key === 'revenue_cents') return '$' + (value / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (key === 'total_watch_time_seconds') return Math.round(value / 3600).toLocaleString() + 'h';
  return Math.round(value).toLocaleString();
}

function formatTargetForMetric(key, value) {
  if (key === 'revenue_cents') return Math.round(value * 100);
  if (key === 'total_watch_time_seconds') return value * 3600;
  return value;
}

function displayTargetForMetric(key, value) {
  if (key === 'revenue_cents') return '$' + Math.round(value).toLocaleString();
  if (key === 'total_watch_time_seconds') return Math.round(value).toLocaleString() + 'h';
  return Math.round(value).toLocaleString();
}

const EMPTY_GOAL = { title: '', current_value: '', target_value: '', category: 'quarterly', goal_type: 'manual', metrics: [], platform_account_ids: [] };
const EMPTY_INITIATIVE = { title: '', deadline: '', category: 'quarterly' };

export default function Goals() {
  const { profile, isAdmin } = useAuth();
  const [goals, setGoals] = useState([]);
  const [initiatives, setInitiatives] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [rollupData, setRollupData] = useState({});
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
      const [goalsRes, initRes, acctRes] = await Promise.all([
        supabase.from('goals').select('*').order('created_at', { ascending: false }),
        supabase.from('initiatives').select('*').order('deadline', { ascending: true }),
        supabase.from('platform_accounts').select('*').eq('is_active', true).order('platform'),
      ]);
      if (goalsRes.error) throw goalsRes.error;
      if (initRes.error) throw initRes.error;
      const goalsData = goalsRes.data || [];
      setGoals(goalsData);
      setInitiatives(initRes.data || []);
      setAccounts(acctRes.data || []);

      // Fetch rollup data for metric goals
      const metricGoals = goalsData.filter(g => g.goal_type === 'metric');
      if (metricGoals.length > 0) {
        await fetchRollupData(metricGoals);
      }
    } catch (err) {
      console.error('Error fetching:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchRollupData(metricGoals) {
    // Determine the widest date range needed (yearly always covers quarterly)
    const hasYearly = metricGoals.some(g => g.category === 'yearly');
    const yearRange = getDateRangeForCategory('yearly');
    const quarterRange = getDateRangeForCategory('quarterly');
    const start = hasYearly ? yearRange.start : quarterRange.start;
    const end = yearRange.end;

    // Collect all platform account IDs needed
    const allAccountIds = [...new Set(metricGoals.flatMap(g => g.platform_account_ids || []))];
    if (!allAccountIds.length) return;

    const { data: rollups } = await supabase
      .from('daily_platform_rollups')
      .select('*')
      .gte('date', start)
      .lte('date', end)
      .in('platform_account_id', allAccountIds);

    if (!rollups) return;

    // Build lookup: { goalId: { metricKey: summedValue } }
    const result = {};
    for (const goal of metricGoals) {
      const range = getDateRangeForCategory(goal.category);
      const goalAccountIds = goal.platform_account_ids || [];
      const goalMetrics = goal.metrics || [];
      const filtered = rollups.filter(r =>
        goalAccountIds.includes(r.platform_account_id) &&
        r.date >= range.start && r.date <= range.end
      );
      const sums = {};
      for (const m of goalMetrics) {
        sums[m] = filtered.reduce((acc, r) => acc + (Number(r[m]) || 0), 0);
      }
      result[goal.id] = sums;
    }
    setRollupData(result);
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
      goal_type: goal.goal_type || 'manual',
      metrics: goal.metrics || [],
      platform_account_ids: goal.platform_account_ids || [],
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

    const isMetric = goalForm.goal_type === 'metric';
    const target_value = parseFloat(goalForm.target_value) || 1;
    const current_value = isMetric ? 0 : (parseFloat(goalForm.current_value) || 0);

    // For metric goals, store the target in the unit the user typed (dollars, hours, raw count)
    // but convert to the DB unit for comparison
    const storedTarget = isMetric && goalForm.metrics.length === 1
      ? formatTargetForMetric(goalForm.metrics[0], target_value)
      : target_value;

    const payload = {
      title,
      current_value: isMetric ? 0 : current_value,
      target_value: storedTarget,
      category: goalForm.category,
      goal_type: goalForm.goal_type,
      metrics: isMetric ? goalForm.metrics : [],
      platform_account_ids: isMetric ? goalForm.platform_account_ids : [],
    };

    if (isMetric && (!payload.metrics.length || !payload.platform_account_ids.length)) {
      alert('Please select at least one metric and one platform.');
      return;
    }

    if (editingGoalId) {
      const { error } = await supabase.from('goals').update({
        ...payload, updated_at: new Date().toISOString(),
      }).eq('id', editingGoalId);
      if (error) { alert('Error: ' + error.message); return; }
    } else {
      const { error } = await supabase.from('goals').insert({
        ...payload, created_by: profile.id,
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

  // --- Metric form helpers ---
  function toggleMetric(key) {
    setGoalForm(prev => {
      const cur = prev.metrics || [];
      if (cur.includes(key)) return { ...prev, metrics: cur.filter(m => m !== key) };
      if (cur.length >= 3) return prev;
      return { ...prev, metrics: [...cur, key] };
    });
  }
  function togglePlatformAccount(id) {
    setGoalForm(prev => {
      const cur = prev.platform_account_ids || [];
      if (cur.includes(id)) return { ...prev, platform_account_ids: cur.filter(a => a !== id) };
      return { ...prev, platform_account_ids: [...cur, id] };
    });
  }

  const quarterlyGoals = goals.filter(g => g.category === 'quarterly');
  const yearlyGoals = goals.filter(g => g.category === 'yearly');
  const quarterlyInits = initiatives.filter(i => i.category === 'quarterly');
  const yearlyInits = initiatives.filter(i => i.category === 'yearly');
  const totalCount = goals.length + initiatives.length;

  if (loading) {
    return <div style={styles.page}><div style={styles.loading}>Loading goals...</div></div>;
  }

  const isMetricForm = goalForm.goal_type === 'metric';

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
          <div style={styles.formLabel}>{editingGoalId ? 'Edit Goal' : 'New Goal'}</div>

          {/* Type toggle */}
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

          {/* Manual fields */}
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
              <select
                value={goalForm.category}
                onChange={e => setGoalForm({ ...goalForm, category: e.target.value })}
                style={styles.select}
              >
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
          )}

          {/* Metric fields */}
          {isMetricForm && (
            <>
              <div style={styles.formRow}>
                <input
                  value={goalForm.target_value}
                  onChange={e => setGoalForm({ ...goalForm, target_value: e.target.value })}
                  placeholder={goalForm.metrics.length === 1 && goalForm.metrics[0] === 'revenue_cents' ? 'Target (dollars)' : goalForm.metrics.length === 1 && goalForm.metrics[0] === 'total_watch_time_seconds' ? 'Target (hours)' : 'Target value'}
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

              {/* Metrics picker */}
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

              {/* Platform picker */}
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

          <button type="submit" style={styles.submitBtn}>
            {editingGoalId ? 'Update Goal' : 'Create Goal'}
          </button>
        </form>
      )}

      {/* Initiative Form */}
      {showInitForm && (
        <form onSubmit={handleInitSubmit} style={styles.form}>
          <div style={styles.formLabel}>{editingInitId ? 'Edit Initiative' : 'New Initiative'}</div>
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
              <GoalCard key={g.id} goal={g} rollupData={rollupData} accounts={accounts} isAdmin={isAdmin} onEdit={openEditGoal} onDelete={handleDeleteGoal} />
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
              <GoalCard key={g.id} goal={g} rollupData={rollupData} accounts={accounts} isAdmin={isAdmin} onEdit={openEditGoal} onDelete={handleDeleteGoal} />
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

function GoalCard({ goal, rollupData, accounts, isAdmin, onEdit, onDelete }) {
  const isMetric = goal.goal_type === 'metric';
  const goalMetrics = goal.metrics || [];
  const goalAccountIds = goal.platform_account_ids || [];

  // Compute current value for metric goals
  let current, target, metricBreakdown;
  if (isMetric && goalMetrics.length > 0) {
    const sums = rollupData[goal.id] || {};
    // If single metric, use sum directly vs target
    if (goalMetrics.length === 1) {
      const key = goalMetrics[0];
      current = sums[key] || 0;
      target = Number(goal.target_value) || 1;
      metricBreakdown = null;
    } else {
      // Multiple metrics: sum all metric values, target is the combined target
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

  // Format display values
  const displayCurrent = isMetric && goalMetrics.length === 1
    ? formatMetricValue(goalMetrics[0], current)
    : isMetric ? Math.round(current).toLocaleString() : current;
  const displayTarget = isMetric && goalMetrics.length === 1
    ? formatMetricValue(goalMetrics[0], target)
    : isMetric ? Math.round(target).toLocaleString() : target;

  // Platform labels for metric goals
  const platformLabels = isMetric
    ? goalAccountIds.map(id => {
        const acct = accounts.find(a => a.id === id);
        return acct ? acct.account_name : '';
      }).filter(Boolean)
    : [];

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <div style={styles.cardTitleRow}>
          <span style={isMetric ? styles.metricBadge : styles.cardBadge}>
            {isMetric ? 'Metric' : 'Goal'}
          </span>
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

      {/* Metric tags */}
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
        <div style={{ ...styles.barFill, width: `${pctDisplay}%`, background: color }} />
      </div>
      <div style={styles.cardFooter}>
        <span style={styles.cardNumbers}>{displayCurrent} / {displayTarget}</span>
        <span style={{ ...styles.cardPct, color }}>{pctDisplay}%</span>
      </div>

      {/* Multi-metric breakdown */}
      {metricBreakdown && (
        <div style={{ marginTop: '6px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {metricBreakdown.map(m => (
            <span key={m.key} style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
              {m.label}: {formatMetricValue(m.key, m.value)}
            </span>
          ))}
        </div>
      )}

      <div style={styles.cardUpdated}>
        {isMetric ? `${goal.category === 'quarterly' ? 'This quarter' : 'This year'} — live` : `Updated ${formatDate(goal.updated_at)}`}
      </div>
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
  formSubLabel: {
    fontSize: '11px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.35)',
    marginBottom: '6px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
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
  typeBtn: {
    flex: 1,
    padding: '8px 14px',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.4)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  typeBtnActive: {
    background: 'rgba(99,102,241,0.15)',
    borderColor: 'rgba(99,102,241,0.4)',
    color: '#a5b4fc',
  },
  chipRow: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  chip: {
    padding: '5px 12px',
    borderRadius: '16px',
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  chipSelected: {
    background: 'rgba(99,102,241,0.15)',
    borderColor: 'rgba(99,102,241,0.4)',
    color: '#a5b4fc',
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
  metricBadge: {
    fontSize: '10px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: '#c4b5fd',
    background: 'rgba(196,181,253,0.1)',
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
  metricTag: {
    fontSize: '10px',
    fontWeight: 600,
    color: 'rgba(196,181,253,0.7)',
    background: 'rgba(196,181,253,0.08)',
    padding: '2px 8px',
    borderRadius: '10px',
  },
  platformTag: {
    fontSize: '10px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.4)',
    background: 'rgba(255,255,255,0.06)',
    padding: '2px 8px',
    borderRadius: '10px',
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
    marginTop: '4px',
  },
  deadlineRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
};
