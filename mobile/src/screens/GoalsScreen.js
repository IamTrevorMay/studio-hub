import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  TextInput, ScrollView, RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useSupabaseQuery } from '../hooks/useSupabaseQuery';
import { supabase } from '../services/supabase';
import { colors, spacing, radius, fontSize } from '../utils/theme';

const METRIC_OPTIONS = [
  { key: 'total_views', label: 'Views' },
  { key: 'revenue_cents', label: 'Revenue ($)' },
  { key: 'followers_eod', label: 'Followers' },
  { key: 'total_likes', label: 'Likes' },
  { key: 'total_comments', label: 'Comments' },
  { key: 'total_shares', label: 'Shares' },
  { key: 'total_watch_time_seconds', label: 'Watch Time (hrs)' },
  { key: 'posts_published', label: 'Posts Published' },
];

function formatDeadline(dateStr) {
  if (!dateStr) return { label: '', sub: '', color: colors.textTertiary };
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((d - now) / 86400000);
  const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (diffDays < 0) return { label, sub: `${Math.abs(diffDays)}d overdue`, color: colors.red };
  if (diffDays === 0) return { label, sub: 'Due today', color: colors.amber };
  if (diffDays <= 7) return { label, sub: `${diffDays}d left`, color: colors.amber };
  return { label, sub: `${diffDays}d left`, color: colors.textTertiary };
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

const EMPTY_GOAL = { title: '', current_value: '', target_value: '', category: 'quarterly', goal_type: 'manual', metrics: [], platform_account_ids: [] };
const EMPTY_INITIATIVE = { title: '', deadline: '', category: 'quarterly' };

export default function GoalsScreen() {
  const { profile, isAdmin } = useAuth();
  const { safeQuery } = useSupabaseQuery();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [goals, setGoals] = useState([]);
  const [initiatives, setInitiatives] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [rollupData, setRollupData] = useState({});

  // Forms
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState(null);
  const [goalForm, setGoalForm] = useState(EMPTY_GOAL);
  const [showInitForm, setShowInitForm] = useState(false);
  const [editingInitId, setEditingInitId] = useState(null);
  const [initForm, setInitForm] = useState(EMPTY_INITIATIVE);

  // Tab
  const [tab, setTab] = useState('goals'); // goals | initiatives

  const fetchAll = useCallback(async () => {
    const [goalsRes, initRes, acctRes] = await Promise.all([
      safeQuery(() => supabase.from('goals').select('*').order('created_at', { ascending: false })),
      safeQuery(() => supabase.from('initiatives').select('*').order('deadline', { ascending: true })),
      safeQuery(() => supabase.from('platform_accounts').select('*').eq('is_active', true).order('platform')),
    ]);
    const goalsData = goalsRes.data || [];
    setGoals(goalsData);
    setInitiatives(initRes.data || []);
    setAccounts(acctRes.data || []);

    // Fetch rollup data for metric goals
    const metricGoals = goalsData.filter(g => g.goal_type === 'metric');
    if (metricGoals.length > 0) {
      await fetchRollupData(metricGoals);
    }
    setLoading(false);
  }, [safeQuery]);

  async function fetchRollupData(metricGoals) {
    const yearRange = getDateRangeForCategory('yearly');
    const allAccountIds = [...new Set(metricGoals.flatMap(g => g.platform_account_ids || []))];
    if (!allAccountIds.length) return;

    const { data: rollups } = await safeQuery(() =>
      supabase.from('daily_platform_rollups').select('*')
        .gte('date', yearRange.start).lte('date', yearRange.end)
        .in('platform_account_id', allAccountIds)
    );
    if (!rollups) return;

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

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

  // ── Goal CRUD ──
  function cancelGoalForm() {
    setShowGoalForm(false);
    setEditingGoalId(null);
    setGoalForm(EMPTY_GOAL);
  }

  async function handleGoalSubmit() {
    const title = goalForm.title.trim();
    if (!title) return;
    const isMetric = goalForm.goal_type === 'metric';
    const target_value = parseFloat(goalForm.target_value) || 1;
    const current_value = isMetric ? 0 : (parseFloat(goalForm.current_value) || 0);
    const storedTarget = isMetric && goalForm.metrics.length === 1
      ? formatTargetForMetric(goalForm.metrics[0], target_value)
      : target_value;

    const payload = {
      title, current_value: isMetric ? 0 : current_value, target_value: storedTarget,
      category: goalForm.category, goal_type: goalForm.goal_type,
      metrics: isMetric ? goalForm.metrics : [],
      platform_account_ids: isMetric ? goalForm.platform_account_ids : [],
    };

    if (isMetric && (!payload.metrics.length || !payload.platform_account_ids.length)) {
      Alert.alert('Error', 'Please select at least one metric and one platform.');
      return;
    }

    if (editingGoalId) {
      await safeQuery(() => supabase.from('goals').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editingGoalId));
    } else {
      await safeQuery(() => supabase.from('goals').insert({ ...payload, created_by: profile.id }).select());
    }
    cancelGoalForm();
    fetchAll();
  }

  async function handleDeleteGoal(id) {
    Alert.alert('Delete Goal', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await safeQuery(() => supabase.from('goals').delete().eq('id', id));
        fetchAll();
      }},
    ]);
  }

  // ── Initiative CRUD ──
  function cancelInitForm() {
    setShowInitForm(false);
    setEditingInitId(null);
    setInitForm(EMPTY_INITIATIVE);
  }

  async function handleInitSubmit() {
    const title = initForm.title.trim();
    if (!title || !initForm.deadline) return;
    if (editingInitId) {
      await safeQuery(() => supabase.from('initiatives').update({
        title, deadline: initForm.deadline, category: initForm.category,
        updated_at: new Date().toISOString(),
      }).eq('id', editingInitId));
    } else {
      await safeQuery(() => supabase.from('initiatives').insert({
        title, deadline: initForm.deadline, category: initForm.category,
        created_by: profile.id,
      }).select());
    }
    cancelInitForm();
    fetchAll();
  }

  async function handleToggleComplete(initiative) {
    const newVal = initiative.completed_at ? null : new Date().toISOString();
    await safeQuery(() => supabase.from('initiatives').update({ completed_at: newVal }).eq('id', initiative.id));
    fetchAll();
  }

  async function handleDeleteInit(id) {
    Alert.alert('Delete Initiative', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await safeQuery(() => supabase.from('initiatives').delete().eq('id', id));
        fetchAll();
      }},
    ]);
  }

  // ── Goal form helpers ──
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
  const isMetricForm = goalForm.goal_type === 'metric';

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  function renderGoalCard(goal) {
    const isMetric = goal.goal_type === 'metric';
    let currentVal = goal.current_value || 0;
    let targetVal = goal.target_value || 1;
    let displayCurrent = String(Math.round(currentVal));
    let displayTarget = String(Math.round(targetVal));

    if (isMetric && rollupData[goal.id]) {
      const sums = rollupData[goal.id];
      const metricKeys = goal.metrics || [];
      currentVal = metricKeys.reduce((s, k) => s + (sums[k] || 0), 0);
      if (metricKeys.length === 1) {
        displayCurrent = formatMetricValue(metricKeys[0], currentVal);
        displayTarget = formatMetricValue(metricKeys[0], targetVal);
      } else {
        displayCurrent = Math.round(currentVal).toLocaleString();
        displayTarget = Math.round(targetVal).toLocaleString();
      }
    }

    const pct = targetVal > 0 ? Math.min(currentVal / targetVal, 1) : 0;
    const pctDisplay = Math.round(pct * 100);

    return (
      <View key={goal.id} style={styles.goalCard}>
        <View style={styles.goalHeader}>
          <Text style={styles.goalTitle} numberOfLines={1}>{goal.title}</Text>
          {isAdmin && (
            <TouchableOpacity onPress={() => handleDeleteGoal(goal.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.deleteBtn}>x</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.progressRow}>
          <Text style={styles.progressText}>{displayCurrent} / {displayTarget}</Text>
          <Text style={styles.progressPct}>{pctDisplay}%</Text>
        </View>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${pctDisplay}%`, backgroundColor: pct >= 1 ? colors.green : colors.primary }]} />
        </View>
        {isMetric && goal.metrics?.length > 0 && (
          <Text style={styles.goalMetrics}>
            {goal.metrics.map(k => METRIC_OPTIONS.find(m => m.key === k)?.label || k).join(', ')}
          </Text>
        )}
      </View>
    );
  }

  function renderInitCard(init) {
    const dl = formatDeadline(init.deadline);
    const done = !!init.completed_at;
    return (
      <View key={init.id} style={[styles.initCard, done && styles.initDone]}>
        <TouchableOpacity
          style={[styles.checkbox, done && styles.checkboxDone]}
          onPress={() => handleToggleComplete(init)}
        >
          {done && <Text style={styles.checkmark}>{'✓'}</Text>}
        </TouchableOpacity>
        <View style={styles.initInfo}>
          <Text style={[styles.initTitle, done && styles.initTitleDone]} numberOfLines={1}>{init.title}</Text>
          <View style={styles.initMeta}>
            <Text style={styles.initDeadline}>{dl.label}</Text>
            <Text style={[styles.initDeadlineSub, { color: dl.color }]}>{dl.sub}</Text>
          </View>
        </View>
        {isAdmin && (
          <TouchableOpacity onPress={() => handleDeleteInit(init.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.deleteBtn}>x</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Tab toggle */}
      <View style={styles.tabRow}>
        {['goals', 'initiatives'].map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'goals' ? `Goals (${goals.length})` : `Initiatives (${initiatives.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'goals' ? (
        /* ── GOALS TAB ── */
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {/* Add goal button */}
          {isAdmin && !showGoalForm && (
            <TouchableOpacity style={styles.addBtn} onPress={() => { setEditingGoalId(null); setGoalForm(EMPTY_GOAL); setShowGoalForm(true); }}>
              <Text style={styles.addBtnText}>+ New Goal</Text>
            </TouchableOpacity>
          )}

          {/* Goal form */}
          {showGoalForm && (
            <View style={styles.formCard}>
              <TextInput
                style={styles.input}
                placeholder="Goal title"
                placeholderTextColor={colors.textTertiary}
                value={goalForm.title}
                onChangeText={v => setGoalForm(p => ({ ...p, title: v }))}
              />

              {/* Category */}
              <View style={styles.chipRow}>
                {['quarterly', 'yearly'].map(c => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.chip, goalForm.category === c && styles.chipActive]}
                    onPress={() => setGoalForm(p => ({ ...p, category: c }))}
                  >
                    <Text style={[styles.chipText, goalForm.category === c && styles.chipTextActive]}>
                      {c.charAt(0).toUpperCase() + c.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Type */}
              <View style={styles.chipRow}>
                {['manual', 'metric'].map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.chip, goalForm.goal_type === t && styles.chipActive]}
                    onPress={() => setGoalForm(p => ({ ...p, goal_type: t }))}
                  >
                    <Text style={[styles.chipText, goalForm.goal_type === t && styles.chipTextActive]}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {!isMetricForm && (
                <View style={styles.rowInputs}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="Current"
                    placeholderTextColor={colors.textTertiary}
                    keyboardType="numeric"
                    value={goalForm.current_value}
                    onChangeText={v => setGoalForm(p => ({ ...p, current_value: v }))}
                  />
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="Target"
                    placeholderTextColor={colors.textTertiary}
                    keyboardType="numeric"
                    value={goalForm.target_value}
                    onChangeText={v => setGoalForm(p => ({ ...p, target_value: v }))}
                  />
                </View>
              )}

              {isMetricForm && (
                <>
                  <TextInput
                    style={styles.input}
                    placeholder="Target value"
                    placeholderTextColor={colors.textTertiary}
                    keyboardType="numeric"
                    value={goalForm.target_value}
                    onChangeText={v => setGoalForm(p => ({ ...p, target_value: v }))}
                  />
                  <Text style={styles.formLabel}>Metrics (up to 3)</Text>
                  <View style={styles.chipRow}>
                    {METRIC_OPTIONS.map(m => (
                      <TouchableOpacity
                        key={m.key}
                        style={[styles.chip, goalForm.metrics.includes(m.key) && styles.chipActive]}
                        onPress={() => toggleMetric(m.key)}
                      >
                        <Text style={[styles.chipText, goalForm.metrics.includes(m.key) && styles.chipTextActive]}>{m.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={styles.formLabel}>Platforms</Text>
                  <View style={styles.chipRow}>
                    {accounts.map(a => (
                      <TouchableOpacity
                        key={a.id}
                        style={[styles.chip, goalForm.platform_account_ids.includes(a.id) && styles.chipActive]}
                        onPress={() => togglePlatformAccount(a.id)}
                      >
                        <Text style={[styles.chipText, goalForm.platform_account_ids.includes(a.id) && styles.chipTextActive]}>
                          {a.account_name || a.platform}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              <View style={styles.formActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={cancelGoalForm}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.submitBtn} onPress={handleGoalSubmit}>
                  <Text style={styles.submitText}>{editingGoalId ? 'Save' : 'Create'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Quarterly goals */}
          {quarterlyGoals.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Quarterly Goals</Text>
              {quarterlyGoals.map(renderGoalCard)}
            </View>
          )}

          {/* Yearly goals */}
          {yearlyGoals.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Yearly Goals</Text>
              {yearlyGoals.map(renderGoalCard)}
            </View>
          )}

          {goals.length === 0 && !showGoalForm && (
            <View style={styles.emptyCard}><Text style={styles.emptyText}>No goals yet</Text></View>
          )}
        </ScrollView>
      ) : (
        /* ── INITIATIVES TAB ── */
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {isAdmin && !showInitForm && (
            <TouchableOpacity style={styles.addBtn} onPress={() => { setEditingInitId(null); setInitForm(EMPTY_INITIATIVE); setShowInitForm(true); }}>
              <Text style={styles.addBtnText}>+ New Initiative</Text>
            </TouchableOpacity>
          )}

          {showInitForm && (
            <View style={styles.formCard}>
              <TextInput
                style={styles.input}
                placeholder="Initiative title"
                placeholderTextColor={colors.textTertiary}
                value={initForm.title}
                onChangeText={v => setInitForm(p => ({ ...p, title: v }))}
              />
              <TextInput
                style={styles.input}
                placeholder="Deadline (YYYY-MM-DD)"
                placeholderTextColor={colors.textTertiary}
                value={initForm.deadline}
                onChangeText={v => setInitForm(p => ({ ...p, deadline: v }))}
              />
              <View style={styles.chipRow}>
                {['quarterly', 'yearly'].map(c => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.chip, initForm.category === c && styles.chipActive]}
                    onPress={() => setInitForm(p => ({ ...p, category: c }))}
                  >
                    <Text style={[styles.chipText, initForm.category === c && styles.chipTextActive]}>
                      {c.charAt(0).toUpperCase() + c.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.formActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={cancelInitForm}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.submitBtn} onPress={handleInitSubmit}>
                  <Text style={styles.submitText}>{editingInitId ? 'Save' : 'Create'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {initiatives.map(renderInitCard)}

          {initiatives.length === 0 && !showInitForm && (
            <View style={styles.emptyCard}><Text style={styles.emptyText}>No initiatives yet</Text></View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl },
  tabRow: { flexDirection: 'row', paddingHorizontal: spacing.xl, paddingTop: spacing.md, gap: spacing.sm },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  tabActive: { backgroundColor: colors.primaryLight },
  tabText: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '600' },
  tabTextActive: { color: colors.primary },
  addBtn: {
    padding: spacing.lg,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
  },
  addBtnText: { fontSize: fontSize.base, fontWeight: '600', color: colors.primary },
  formCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  input: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    color: colors.text,
    fontSize: fontSize.base,
  },
  rowInputs: { flexDirection: 'row', gap: spacing.sm },
  formLabel: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: '600', marginTop: spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText: { fontSize: fontSize.xs, color: colors.textSecondary },
  chipTextActive: { color: colors.primary, fontWeight: '600' },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.xs },
  cancelBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md },
  cancelText: { fontSize: fontSize.sm, color: colors.textSecondary },
  submitBtn: { paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md },
  submitText: { fontSize: fontSize.sm, fontWeight: '600', color: '#fff' },
  section: { marginBottom: spacing.lg },
  sectionTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  // Goal card
  goalCard: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  goalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  goalTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.text, flex: 1 },
  deleteBtn: { fontSize: fontSize.base, color: colors.red, fontWeight: '700', paddingHorizontal: spacing.sm },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  progressText: { fontSize: fontSize.xs, color: colors.textSecondary },
  progressPct: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary },
  progressBar: { height: 6, borderRadius: 3, backgroundColor: colors.bg, marginTop: spacing.xs, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  goalMetrics: { fontSize: fontSize.xs, color: colors.textTertiary, marginTop: spacing.sm },
  // Initiative card
  initCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  initDone: { opacity: 0.5 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  checkboxDone: { backgroundColor: colors.green, borderColor: colors.green },
  checkmark: { fontSize: 14, color: '#fff', fontWeight: '700' },
  initInfo: { flex: 1 },
  initTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.text },
  initTitleDone: { textDecorationLine: 'line-through', color: colors.textSecondary },
  initMeta: { flexDirection: 'row', gap: spacing.sm, marginTop: 2 },
  initDeadline: { fontSize: fontSize.xs, color: colors.textTertiary },
  initDeadlineSub: { fontSize: fontSize.xs, fontWeight: '600' },
  emptyCard: { padding: spacing.xxxl, alignItems: 'center' },
  emptyText: { fontSize: fontSize.md, color: colors.textTertiary },
});
