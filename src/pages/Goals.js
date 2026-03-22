import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';

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
  fourthwall:{ label: 'Fourthwall',color: '#E8451C' },
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
const EMPTY_MONTHLY = { title: '', content_type_filter: 'video', target_value: '', platform_account_ids: [] };

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

  // Monthly goals state
  const [monthlyGoals, setMonthlyGoals] = useState([]);
  const [monthlyProgress, setMonthlyProgress] = useState({});
  const [expandedYearlyGoals, setExpandedYearlyGoals] = useState({});
  const [showMonthlyForm, setShowMonthlyForm] = useState(null);
  const [showGoalDropdown, setShowGoalDropdown] = useState(false);
  const goalDropdownRef = useRef(null);

  useEffect(() => {
    if (!showGoalDropdown) return;
    function handleClick(e) {
      if (goalDropdownRef.current && !goalDropdownRef.current.contains(e.target)) {
        setShowGoalDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showGoalDropdown]);
  const [editingMonthlyId, setEditingMonthlyId] = useState(null);
  const [monthlyForm, setMonthlyForm] = useState(EMPTY_MONTHLY);

  useEffect(() => {
    if (profile?.id) fetchAll();
  }, [profile?.id]);

  useVisibilityRefresh(() => { fetchAll(); });

  async function fetchAll() {
    try {
      const [goalsRes, initRes, acctRes, monthlyRes] = await Promise.all([
        supabase.from('goals').select('*').order('created_at', { ascending: false }),
        supabase.from('initiatives').select('*').order('deadline', { ascending: true }),
        supabase.from('platform_accounts').select('*').eq('is_active', true).order('platform'),
        supabase.from('monthly_goals').select('*').order('created_at'),
      ]);
      if (goalsRes.error) throw goalsRes.error;
      if (initRes.error) throw initRes.error;
      const goalsData = goalsRes.data || [];
      const monthlyData = monthlyRes.data || [];
      setGoals(goalsData);
      setInitiatives(initRes.data || []);
      setAccounts(acctRes.data || []);
      setMonthlyGoals(monthlyData);

      // Fetch rollup data for metric goals
      const metricGoals = goalsData.filter(g => g.goal_type === 'metric');
      if (metricGoals.length > 0) {
        await fetchRollupData(metricGoals);
      }

      // Fetch progress for monthly goals
      if (monthlyData.length > 0) {
        await fetchMonthlyProgress(monthlyData, acctRes.data || []);
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

  async function fetchMonthlyProgress(mGoals, accts) {
    const now = new Date();
    const year = now.getFullYear();
    const yearStart = `${year}-01-01`;
    const yearEnd = now.toISOString();
    const allAccountIds = [...new Set(mGoals.flatMap(g => g.platform_account_ids || []))];
    if (!allAccountIds.length) return;

    // Find TikTok account IDs (content_items has no TikTok data — we use Metricool)
    const tiktokAccountIds = new Set(
      (accts || []).filter(a => a.platform === 'tiktok').map(a => a.id)
    );

    const { data: items } = await supabase
      .from('content_items')
      .select('id, content_type, platform_account_id, published_at, duration_seconds')
      .gte('published_at', yearStart)
      .lte('published_at', yearEnd)
      .in('platform_account_id', allAccountIds.filter(id => !tiktokAccountIds.has(id)));

    // Fetch TikTok posts from Metricool if any goal uses TikTok
    const needsTiktok = mGoals.some(mg =>
      (mg.platform_account_ids || []).some(id => tiktokAccountIds.has(id))
    );
    let tiktokByMonth = {};
    if (needsTiktok) {
      try {
        const startStr = `${year}-01-01T00:00:00`;
        const endStr = `${year}-12-31T23:59:59`;
        const res = await fetch(
          `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/metricool-posts?start=${startStr}&end=${endStr}`
        );
        if (res.ok) {
          const { posts } = await res.json();
          const tiktokPosts = (posts || []).filter(p => p.network === 'tiktok' && p.status === 'PUBLISHED');
          for (const p of tiktokPosts) {
            const month = p.publicationDate?.dateTime?.substring(0, 7);
            if (month) tiktokByMonth[month] = (tiktokByMonth[month] || 0) + 1;
          }
        }
      } catch (err) {
        console.error('Error fetching TikTok posts from Metricool:', err);
      }
    }

    const LONGFORM_THRESHOLD = 180; // seconds
    const result = {};
    for (const mg of mGoals) {
      const goalAccountIds = mg.platform_account_ids || [];
      const hasTiktok = goalAccountIds.some(id => tiktokAccountIds.has(id));
      const nonTiktokIds = goalAccountIds.filter(id => !tiktokAccountIds.has(id));

      // Count from content_items (YouTube etc)
      const filtered = (items || []).filter(item => {
        if (!nonTiktokIds.includes(item.platform_account_id)) return false;
        if (mg.content_type_filter === 'video') {
          return item.content_type === 'video' && (item.duration_seconds || 0) > LONGFORM_THRESHOLD;
        }
        return item.content_type === 'short' || (item.content_type === 'video' && (item.duration_seconds || 0) <= LONGFORM_THRESHOLD);
      });
      const byMonth = {};
      for (const item of filtered) {
        const month = item.published_at.substring(0, 7);
        byMonth[month] = (byMonth[month] || 0) + 1;
      }

      // Add TikTok counts (all TikTok posts count as shorts)
      if (hasTiktok && mg.content_type_filter === 'short') {
        for (const [month, count] of Object.entries(tiktokByMonth)) {
          byMonth[month] = (byMonth[month] || 0) + count;
        }
      }

      result[mg.id] = byMonth;
    }
    setMonthlyProgress(result);
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
  async function handleToggleInitComplete(initiative) {
    const newVal = initiative.completed_at ? null : new Date().toISOString();
    await supabase.from('initiatives').update({ completed_at: newVal }).eq('id', initiative.id);
    fetchAll();
  }

  // --- Monthly goal CRUD ---
  function openCreateMonthly(parentGoalId) {
    setEditingMonthlyId(null);
    setMonthlyForm(EMPTY_MONTHLY);
    setShowMonthlyForm(parentGoalId === null ? 'standalone' : parentGoalId);
  }
  function openEditMonthly(mg) {
    setEditingMonthlyId(mg.id);
    setMonthlyForm({
      title: mg.title,
      content_type_filter: mg.content_type_filter,
      target_value: String(mg.target_value),
      platform_account_ids: mg.platform_account_ids || [],
    });
    setShowMonthlyForm(mg.parent_goal_id || 'standalone');
  }
  function cancelMonthlyForm() {
    setShowMonthlyForm(null);
    setEditingMonthlyId(null);
    setMonthlyForm(EMPTY_MONTHLY);
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
        title, content_type_filter: monthlyForm.content_type_filter,
        target_value, platform_account_ids: monthlyForm.platform_account_ids,
        updated_at: new Date().toISOString(),
      }).eq('id', editingMonthlyId);
      if (error) { alert('Error: ' + error.message); return; }
    } else {
      const { error } = await supabase.from('monthly_goals').insert({
        title, content_type_filter: monthlyForm.content_type_filter,
        target_value, platform_account_ids: monthlyForm.platform_account_ids,
        parent_goal_id: parentGoalId === 'standalone' ? null : parentGoalId,
        created_by: profile.id,
      });
      if (error) { alert('Error: ' + error.message); return; }
    }
    cancelMonthlyForm();
    fetchAll();
  }
  async function handleDeleteMonthly(id) {
    if (!window.confirm('Delete this monthly goal?')) return;
    await supabase.from('monthly_goals').delete().eq('id', id);
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

  function toggleMonthlyPlatformAccount(id) {
    setMonthlyForm(prev => {
      const cur = prev.platform_account_ids || [];
      if (cur.includes(id)) return { ...prev, platform_account_ids: cur.filter(a => a !== id) };
      return { ...prev, platform_account_ids: [...cur, id] };
    });
  }

  const quarterlyGoals = goals.filter(g => g.category === 'quarterly');
  const yearlyGoals = goals.filter(g => g.category === 'yearly');
  const sortedInitiatives = [...initiatives].sort((a, b) => (a.deadline || '').localeCompare(b.deadline || ''));
  const totalCount = goals.length + initiatives.length + monthlyGoals.length;

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
            <div ref={goalDropdownRef} style={styles.dropdownWrap}>
              <button onClick={() => setShowGoalDropdown(!showGoalDropdown)} style={styles.addBtn}>
                + Goal ▾
              </button>
              {showGoalDropdown && (
                <div style={styles.dropdown}>
                  <button style={styles.dropdownItem} onClick={() => { setShowGoalDropdown(false); openCreateGoal(); }}>
                    Yearly / Quarterly Goal
                  </button>
                  <button style={styles.dropdownItem} onClick={() => { setShowGoalDropdown(false); openCreateMonthly(null); }}>
                    Monthly Goal
                  </button>
                </div>
              )}
            </div>
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
          <input
            type="date"
            value={initForm.deadline}
            onChange={e => setInitForm({ ...initForm, deadline: e.target.value })}
            style={styles.input}
          />
          <button type="submit" style={styles.submitBtn}>
            {editingInitId ? 'Update Initiative' : 'Create Initiative'}
          </button>
        </form>
      )}

      {/* Standalone Monthly Goal Form */}
      {showMonthlyForm === 'standalone' && (
        <form onSubmit={(e) => handleMonthlySubmit(e, 'standalone')} style={styles.form}>
          <div style={styles.formLabel}>{editingMonthlyId ? 'Edit Monthly Goal' : 'New Monthly Goal'}</div>
          <input
            value={monthlyForm.title}
            onChange={e => setMonthlyForm({ ...monthlyForm, title: e.target.value })}
            placeholder="Monthly goal title"
            style={styles.input}
            autoFocus
          />
          <div style={styles.formRow}>
            <button type="button" onClick={() => setMonthlyForm({ ...monthlyForm, content_type_filter: 'video' })}
              style={{ ...styles.typeBtn, ...(monthlyForm.content_type_filter === 'video' ? styles.typeBtnActive : {}) }}>
              Longform Video
            </button>
            <button type="button" onClick={() => setMonthlyForm({ ...monthlyForm, content_type_filter: 'short' })}
              style={{ ...styles.typeBtn, ...(monthlyForm.content_type_filter === 'short' ? styles.typeBtnActive : {}) }}>
              Short
            </button>
          </div>
          <input
            value={monthlyForm.target_value}
            onChange={e => setMonthlyForm({ ...monthlyForm, target_value: e.target.value })}
            placeholder="How many per month?"
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
                  <button key={acct.id} type="button" onClick={() => toggleMonthlyPlatformAccount(acct.id)}
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
            <button type="submit" style={styles.submitBtn}>
              {editingMonthlyId ? 'Update' : 'Create'}
            </button>
            <button type="button" onClick={cancelMonthlyForm} style={{ ...styles.addBtn, color: 'rgba(255,255,255,0.5)' }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Monthly Section (standalone monthly goals) */}
      {monthlyGoals.filter(mg => !mg.parent_goal_id).length > 0 && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Monthly</h2>
          <div style={styles.list}>
            {monthlyGoals.filter(mg => !mg.parent_goal_id).map(mg => (
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
          </div>
        </div>
      )}

      {/* Quarterly Section */}
      {quarterlyGoals.length > 0 && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Quarterly</h2>
          <div style={styles.list}>
            {quarterlyGoals.map(g => (
              <GoalCard key={g.id} goal={g} rollupData={rollupData} accounts={accounts} isAdmin={isAdmin} onEdit={openEditGoal} onDelete={handleDeleteGoal} />
            ))}
          </div>
        </div>
      )}

      {/* Yearly Section */}
      {yearlyGoals.length > 0 && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Yearly</h2>
          <div style={styles.list}>
            {yearlyGoals.map(g => {
              const childGoals = monthlyGoals.filter(mg => mg.parent_goal_id === g.id);
              const isExpanded = expandedYearlyGoals[g.id];
              return (
                <div key={g.id}>
                  <GoalCard goal={g} rollupData={rollupData} accounts={accounts} isAdmin={isAdmin} onEdit={openEditGoal} onDelete={handleDeleteGoal} />
                  {(childGoals.length > 0 || isAdmin) && (
                    <div style={styles.monthlyToggleRow}>
                      <button
                        onClick={() => setExpandedYearlyGoals(prev => ({ ...prev, [g.id]: !prev[g.id] }))}
                        style={styles.monthlyToggleBtn}
                      >
                        <span style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block', transition: 'transform 0.15s', fontSize: '10px' }}>▶</span>
                        {' '}{childGoals.length} monthly goal{childGoals.length !== 1 ? 's' : ''}
                      </button>
                    </div>
                  )}
                  {isExpanded && (
                    <div style={styles.monthlyNest}>
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
                      {isAdmin && showMonthlyForm === g.id ? (
                        <form onSubmit={(e) => handleMonthlySubmit(e, g.id)} style={styles.monthlyFormBox}>
                          <div style={styles.formLabel}>{editingMonthlyId ? 'Edit Monthly Goal' : 'New Monthly Goal'}</div>
                          <input
                            value={monthlyForm.title}
                            onChange={e => setMonthlyForm({ ...monthlyForm, title: e.target.value })}
                            placeholder="Monthly goal title"
                            style={styles.input}
                            autoFocus
                          />
                          <div style={styles.formRow}>
                            <button type="button" onClick={() => setMonthlyForm({ ...monthlyForm, content_type_filter: 'video' })}
                              style={{ ...styles.typeBtn, ...(monthlyForm.content_type_filter === 'video' ? styles.typeBtnActive : {}) }}>
                              Longform Video
                            </button>
                            <button type="button" onClick={() => setMonthlyForm({ ...monthlyForm, content_type_filter: 'short' })}
                              style={{ ...styles.typeBtn, ...(monthlyForm.content_type_filter === 'short' ? styles.typeBtnActive : {}) }}>
                              Short
                            </button>
                          </div>
                          <input
                            value={monthlyForm.target_value}
                            onChange={e => setMonthlyForm({ ...monthlyForm, target_value: e.target.value })}
                            placeholder="How many per month?"
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
                                  <button key={acct.id} type="button" onClick={() => toggleMonthlyPlatformAccount(acct.id)}
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
                            <button type="submit" style={styles.submitBtn}>
                              {editingMonthlyId ? 'Update' : 'Create'}
                            </button>
                            <button type="button" onClick={cancelMonthlyForm} style={{ ...styles.addBtn, color: 'rgba(255,255,255,0.5)' }}>
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : isAdmin && (
                        <button onClick={() => openCreateMonthly(g.id)} style={styles.addMonthlyBtn}>+ Monthly Goal</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Road Map */}
      {sortedInitiatives.length > 0 && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Road Map</h2>
          <div style={styles.list}>
            {sortedInitiatives.map(i => (
              <InitiativeCard key={i.id} initiative={i} isAdmin={isAdmin} onEdit={openEditInit} onDelete={handleDeleteInit} onToggleComplete={handleToggleInitComplete} />
            ))}
          </div>
        </div>
      )}

      {/* Monthly Results */}
      {monthlyGoals.length > 0 && (() => {
        const now = new Date();
        const currentMonthIdx = now.getMonth();
        const year = now.getFullYear();
        const hasResults = monthlyGoals.some(mg => {
          const createdDate = new Date(mg.created_at);
          const startMonth = createdDate.getFullYear() === year ? createdDate.getMonth() : 0;
          return startMonth < currentMonthIdx;
        });
        if (!hasResults) return null;
        return (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Monthly Results</h2>
            <div style={styles.resultsList}>
              {monthlyGoals.map(mg => {
                const createdDate = new Date(mg.created_at);
                const createdMonthIdx = createdDate.getFullYear() === year ? createdDate.getMonth() : 0;
                const createdYear = createdDate.getFullYear();
                const progress = monthlyProgress[mg.id] || {};
                const contentLabel = mg.content_type_filter === 'video' ? 'Video' : 'Short';
                const months = [];
                for (let m = 0; m < currentMonthIdx; m++) {
                  if (createdYear === year && m < createdMonthIdx) continue;
                  if (createdYear > year) continue;
                  const monthKey = `${year}-${String(m + 1).padStart(2, '0')}`;
                  const count = progress[monthKey] || 0;
                  const met = count >= mg.target_value;
                  months.push({
                    monthKey,
                    label: new Date(year, m).toLocaleDateString('en-US', { month: 'short' }),
                    count,
                    met,
                  });
                }
                if (months.length === 0) return null;
                return (
                  <div key={mg.id} style={styles.resultsRow}>
                    <div style={styles.resultsLabel}>
                      <span style={styles.resultsGoalTitle}>{mg.title}</span>
                      <span style={styles.resultsGoalMeta}>{contentLabel} · {mg.target_value}/mo</span>
                    </div>
                    <div style={styles.resultsMonths}>
                      {months.map(m => (
                        <div key={m.monthKey} style={{
                          ...styles.resultsCell,
                          background: m.met ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.1)',
                          borderColor: m.met ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.2)',
                        }}>
                          <div style={styles.resultsCellMonth}>{m.label}</div>
                          <div style={{
                            ...styles.resultsCellCount,
                            color: m.met ? '#4ade80' : '#f87171',
                          }}>{m.count}/{mg.target_value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
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

function InitiativeCard({ initiative, isAdmin, onEdit, onDelete, onToggleComplete }) {
  const dl = formatDeadline(initiative.deadline);
  const done = !!initiative.completed_at;

  return (
    <div style={{ ...styles.card, ...(done ? styles.cardCompleted : {}) }}>
      <div style={styles.cardHeader}>
        <div style={styles.cardTitleRow}>
          <span style={{ ...styles.initBadge, ...(done ? styles.initBadgeCompleted : {}) }}>
            {done ? 'Completed' : 'Initiative'}
          </span>
          <span style={{ ...styles.cardTitle, ...(done ? { color: '#bbf7d0' } : {}) }}>{initiative.title}</span>
        </div>
        <div style={styles.cardActions}>
          {isAdmin && (
            <button onClick={() => onToggleComplete(initiative)} style={{ ...styles.completeBtn, ...(done ? styles.completeBtnDone : {}) }} title={done ? 'Mark incomplete' : 'Mark completed'}>
              {done ? '✓ Done' : '✓ Complete'}
            </button>
          )}
          {isAdmin && (
            <>
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
            </>
          )}
        </div>
      </div>
      <div style={styles.deadlineRow}>
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke={done ? '#4ade80' : dl.color} strokeWidth="1.5" style={{ flexShrink: 0 }}>
          <rect x="3" y="4" width="14" height="13" rx="2" />
          <path d="M3 8h14M7 2v4M13 2v4" />
        </svg>
        <span style={{ color: done ? '#4ade80' : dl.color, fontSize: '13px', fontWeight: 500 }}>{dl.label}</span>
        {!done && <span style={{ color: dl.color, fontSize: '12px', opacity: 0.8 }}>{dl.sub}</span>}
      </div>
    </div>
  );
}

function MonthlyGoalCard({ goal, progress, accounts, isAdmin, onEdit, onDelete }) {
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

  const platformLabels = (goal.platform_account_ids || []).map(id => {
    const acct = accounts.find(a => a.id === id);
    return acct ? acct.account_name : '';
  }).filter(Boolean);

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
        <div style={{ ...styles.barFill, width: `${pctDisplay}%`, background: color }} />
      </div>
      <div style={styles.cardFooter}>
        <span style={styles.cardNumbers}>{currentCount} / {target}</span>
        <span style={{ ...styles.cardPct, color }}>{pctDisplay}%</span>
      </div>
      <div style={styles.cardUpdated}>{monthLabel} — live</div>
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
  dropdownWrap: {
    position: 'relative',
  },
  dropdown: {
    position: 'absolute',
    top: '110%',
    left: 0,
    background: '#1e1e2e',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '10px',
    overflow: 'hidden',
    zIndex: 50,
    minWidth: '180px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  dropdownItem: {
    display: 'block',
    width: '100%',
    padding: '10px 16px',
    border: 'none',
    background: 'transparent',
    color: '#e2e8f0',
    fontSize: '13px',
    fontWeight: 500,
    textAlign: 'left',
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
  initBadgeCompleted: {
    color: '#4ade80',
    background: 'rgba(74,222,128,0.15)',
  },
  cardCompleted: {
    background: 'rgba(74,222,128,0.08)',
    border: '1px solid rgba(74,222,128,0.2)',
  },
  completeBtn: {
    padding: '3px 10px',
    borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.05)',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  completeBtnDone: {
    background: 'rgba(74,222,128,0.15)',
    borderColor: 'rgba(74,222,128,0.3)',
    color: '#4ade80',
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
  monthlyToggleRow: {
    marginTop: '-1px',
    paddingLeft: '16px',
  },
  monthlyToggleBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    border: 'none',
    background: 'transparent',
    color: 'rgba(255,255,255,0.35)',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  monthlyNest: {
    marginLeft: '16px',
    paddingLeft: '16px',
    borderLeft: '2px solid rgba(255,255,255,0.06)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginBottom: '8px',
  },
  monthlyCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '10px',
    padding: '14px',
    width: '100%',
  },
  monthlyBadge: {
    fontSize: '10px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: '#fbbf24',
    background: 'rgba(251,191,36,0.1)',
    padding: '3px 8px',
    borderRadius: '4px',
    flexShrink: 0,
  },
  monthlyFormBox: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '10px',
    padding: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  addMonthlyBtn: {
    padding: '6px 14px',
    borderRadius: '8px',
    border: '1px dashed rgba(255,255,255,0.12)',
    background: 'transparent',
    color: 'rgba(255,255,255,0.3)',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    alignSelf: 'flex-start',
  },
  resultsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  resultsRow: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '10px',
    padding: '14px',
  },
  resultsLabel: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    marginBottom: '10px',
  },
  resultsGoalTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#e2e8f0',
  },
  resultsGoalMeta: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.35)',
  },
  resultsMonths: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  resultsCell: {
    border: '1px solid',
    borderRadius: '8px',
    padding: '6px 10px',
    textAlign: 'center',
    minWidth: '52px',
  },
  resultsCellMonth: {
    fontSize: '10px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    marginBottom: '2px',
  },
  resultsCellCount: {
    fontSize: '13px',
    fontWeight: 700,
  },
};
