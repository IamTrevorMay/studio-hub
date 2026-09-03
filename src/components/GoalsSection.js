// Goals section on the Tracking page.
//
// Structure: Section ("funnel") → period subsection → goal cards.
// A section holds goals of any period; each period renders as its own
// subsection stacked chronologically (Weekly → Monthly → Yearly), and a
// subsection with no goals in it is hidden along with its label.
//
// Every goal lives in `goals`, keyed by category (the period) and section_id
// (the grouping). Monthly goals used to be children of a yearly goal in a
// separate monthly_goals table; migration 20260903180000 moved the
// content-scope ones here. monthly_goals still exists for BusinessDev's
// scope='bd' roadmap goals — unrelated feature, untouched.
//
// Three goal types, all available at all three periods:
//   manual     — hand-entered current value
//   metric     — sums platform_daily_metrics columns over the period window
//   post_count — counts published posts by type over the period window

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import { ptDateToUtcISO, ptDayKey, ptMonthKey, ptWeekStartKey, recentWeekStarts } from '../lib/ptDate';
import {
  POST_TYPE_OPTIONS, POST_TYPE_MAP, needsAccountPicker, impliedAccountIds,
  youtubeTypeOf, metricoolPostMatches,
} from '../lib/postTypes';
import { colors } from '../lib/styleTokens';

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
  // YouTube-only: daily split from the Analytics API creatorContentType
  // dimension (views_shorts / views_long on platform_daily_metrics). Rows
  // without a split (old history, other platforms) are null → count as 0.
  { key: 'views_long',         label: 'Views — Long-form (YT)' },
  { key: 'views_shorts',       label: 'Views — Shorts (YT)' },
  { key: 'likes',              label: 'Likes' },
  { key: 'comments',           label: 'Comments' },
  { key: 'shares',             label: 'Shares' },
  { key: 'watch_time_seconds', label: 'Watch Time (hrs)' },
];

// Rendered top to bottom in this order. `label` is the subsection heading.
const PERIODS = [
  { key: 'weekly',  label: 'Weekly',  badge: '#34d399' },
  { key: 'monthly', label: 'Monthly', badge: '#fbbf24' },
  { key: 'yearly',  label: 'Yearly',  badge: '#818cf8' },
];
const PERIOD_MAP = Object.fromEntries(PERIODS.map(p => [p.key, p]));

const GOAL_TYPES = [
  { key: 'manual',     label: 'Manual' },
  { key: 'metric',     label: 'Metric' },
  { key: 'post_count', label: 'Post count' },
];

const EMPTY_GOAL = {
  title: '', current_value: '', target_value: '',
  category: 'weekly', goal_type: 'post_count', metrics: [], platform_account_ids: [],
};

// How many past weeks the hit/miss strip on a weekly card shows.
const WEEK_HISTORY = 8;

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

// ── Period windows (all Pacific, matching the rest of the app) ──

// Inclusive PT date range [start, end] for the live instance of a period.
function periodRange(period, now = new Date()) {
  const today = ptDayKey(now);
  if (period === 'weekly')  return { start: ptWeekStartKey(now), end: today };
  if (period === 'monthly') return { start: `${ptMonthKey(now)}-01`, end: today };
  return { start: `${today.slice(0, 4)}-01-01`, end: today };
}

// Fraction of the current period that has elapsed — drives the pace marker.
function expectedFraction(period, now = new Date()) {
  const { start } = periodRange(period, now);
  const startMs = Date.parse(ptDateToUtcISO(start));
  let spanMs;
  if (period === 'weekly') {
    spanMs = 7 * 86400000;
  } else if (period === 'monthly') {
    const [y, m] = ptMonthKey(now).split('-').map(Number);
    spanMs = Date.parse(ptDateToUtcISO(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`)) - startMs;
  } else {
    const y = Number(ptDayKey(now).slice(0, 4));
    spanMs = Date.parse(ptDateToUtcISO(`${y + 1}-01-01`)) - startMs;
  }
  return Math.min(1, Math.max(0, (now.getTime() - startMs) / spanMs));
}

// Bucket key for an instant, per period. Used to fold post/metric history
// into the period the app is currently showing.
function bucketKeyFor(period) {
  if (period === 'weekly')  return ptWeekStartKey;
  if (period === 'monthly') return ptMonthKey;
  return (d) => ptDayKey(d).slice(0, 4);
}

// The bucket key of the live period.
function currentBucket(period, now = new Date()) {
  return bucketKeyFor(period)(now);
}

function periodLabel(period, now = new Date()) {
  if (period === 'weekly')  return weekRangeLabel(ptWeekStartKey(now));
  if (period === 'monthly') return now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return ptDayKey(now).slice(0, 4);
}

// Label like "Sep 1–7" for a Monday-start week key.
function weekRangeLabel(weekKey) {
  const [y, m, d] = weekKey.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  const end = new Date(Date.UTC(y, m - 1, d + 6));
  const fmt = (dt, withMonth) => (withMonth
    ? `${dt.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })} ${dt.getUTCDate()}`
    : String(dt.getUTCDate()));
  return `${fmt(start, true)}–${fmt(end, start.getUTCMonth() !== end.getUTCMonth())}`;
}

// Count posts into buckets keyed by `keyFn(publishedAt)`. Metricool covers the
// IG/TikTok/FB types; content_items covers the two YouTube ones.
function countPostsByPeriod({ mcPosts, ciItems, types, ytAccountIds, keyFn }) {
  const out = {};
  const bump = (k) => { if (k) out[k] = (out[k] || 0) + 1; };
  const selected = (types || []).map(t => POST_TYPE_MAP[t]).filter(Boolean);
  const mcTypes = selected.filter(o => o.source === 'metricool').map(o => o.key);
  const ytTypes = selected.filter(o => o.source === 'content_items').map(o => o.key);

  if (mcTypes.length) {
    for (const p of (mcPosts || [])) {
      if (!p.publicationDate) continue;
      if (mcTypes.some(t => metricoolPostMatches(p, t))) bump(keyFn(p.publicationDate));
    }
  }
  if (ytTypes.length) {
    const idSet = new Set(ytAccountIds || []);
    for (const item of (ciItems || [])) {
      if (idSet.size && !idSet.has(item.platform_account_id)) continue;
      if (!ytTypes.includes(youtubeTypeOf(item))) continue;
      bump(keyFn(item.published_at));
    }
  }
  return out;
}

// Sum platform_daily_metrics rows into the same bucket shape. Rows carry a
// plain 'YYYY-MM-DD' PT date, so they bucket without timezone conversion.
function sumMetricsByPeriod({ rows, metrics, accountIds, keyFn }) {
  const out = {};
  const idSet = new Set(accountIds || []);
  for (const r of (rows || [])) {
    if (idSet.size && !idSet.has(r.platform_account_id)) continue;
    const k = keyFn(`${r.date}T12:00:00Z`);
    if (!k) continue;
    let v = 0;
    for (const m of (metrics || [])) v += Number(r[m]) || 0;
    out[k] = (out[k] || 0) + v;
  }
  return out;
}

// ─── Section ──────────────────────────────────────────────────

export default function GoalsSection() {
  const { profile, isAdmin } = useAuth();
  const confirm = useConfirm();

  const [sections, setSections] = useState([]);
  const [goals, setGoals] = useState([]);
  const [accounts, setAccounts] = useState([]);
  // { goalId: { current, history: { bucketKey: value } } }
  const [progress, setProgress] = useState({});
  // { goalId: { last10, prev10, paceNeeded10 } } — yearly metric goals only
  const [velocity, setVelocity] = useState({});
  const [loading, setLoading] = useState(true);

  // Section create/rename
  const [sectionForm, setSectionForm] = useState(null);   // { id|null, name }
  const [deleteSection, setDeleteSection] = useState(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // Goal form — `openFor` is the section id the form belongs to.
  const [goalForm, setGoalForm] = useState(null);         // { openFor, editingId, ...fields }

  const [collapsed, setCollapsed] = useState({});
  const toggleSection = (id) => setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));

  // ── Data fetch ──

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [secRes, goalRes, acctRes] = await Promise.all([
        supabase.from('goal_sections').select('*').eq('scope', 'content').order('position'),
        supabase.from('goals').select('*').eq('scope', 'content').order('created_at'),
        supabase.from('platform_accounts').select('*').eq('is_active', true).order('platform'),
      ]);
      if (secRes.error) throw secRes.error;
      if (goalRes.error) throw goalRes.error;

      const sectionData = secRes.data || [];
      const goalData = (goalRes.data || []).filter(g => g.section_id);
      setSections(sectionData);
      setGoals(goalData);
      setAccounts(acctRes.data || []);

      await computeProgress(goalData);
    } catch (err) {
      console.error('GoalsSection fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!profile?.id) return;
    fetchAll();
  }, [profile?.id, fetchAll]);
  useVisibilityRefresh(fetchAll);

  // One pass over every goal, whatever its period or type. Sources are fetched
  // once across the widest window any goal needs, then bucketed per goal.
  async function computeProgress(goalData) {
    const metricGoals = goalData.filter(g => g.goal_type === 'metric');
    const postGoals   = goalData.filter(g => g.goal_type === 'post_count');

    const now = new Date();
    const weekKeys = recentWeekStarts(WEEK_HISTORY, now);
    const yearStart = `${ptDayKey(now).slice(0, 4)}-01-01`;
    const hasWeekly = goalData.some(g => g.category === 'weekly');
    // Weekly history reaches back before Jan 1 in early January.
    const windowStart = hasWeekly && weekKeys[0] < yearStart ? weekKeys[0] : yearStart;
    const todayKey = ptDayKey(now);

    const next = {};
    for (const g of goalData) {
      if (g.goal_type === 'manual') {
        next[g.id] = { current: Number(g.current_value) || 0, history: {} };
      }
    }

    // ── Metric goals: platform_daily_metrics ──
    if (metricGoals.length) {
      const acctIds = [...new Set(metricGoals.flatMap(g => g.platform_account_ids || []))];
      if (acctIds.length) {
        const { data: rows, error } = await supabase
          .from('platform_daily_metrics')
          .select('*')
          .gte('date', windowStart)
          .lte('date', todayKey)
          .in('platform_account_id', acctIds);
        if (error) console.error('platform_daily_metrics fetch:', error);

        for (const g of metricGoals) {
          const history = sumMetricsByPeriod({
            rows, metrics: g.metrics || [],
            accountIds: g.platform_account_ids || [],
            keyFn: bucketKeyFor(g.category),
          });
          next[g.id] = { current: history[currentBucket(g.category, now)] || 0, history };
        }

        // Velocity is only meaningful against a year-long runway.
        const yearlyMetric = metricGoals.filter(g => g.category === 'yearly');
        if (yearlyMetric.length) {
          const d10 = new Date(now); d10.setDate(d10.getDate() - 10);
          const d20 = new Date(now); d20.setDate(d20.getDate() - 20);
          const k10 = ptDayKey(d10), k20 = ptDayKey(d20);
          const vel = {};
          for (const g of yearlyMetric) {
            const ids = new Set(g.platform_account_ids || []);
            const mine = (rows || []).filter(r => ids.has(r.platform_account_id));
            const sum = (subset) => subset.reduce((a, r) =>
              a + (g.metrics || []).reduce((b, m) => b + (Number(r[m]) || 0), 0), 0);
            const last10 = sum(mine.filter(r => r.date > k10));
            const prev10 = sum(mine.filter(r => r.date > k20 && r.date <= k10));
            const target = Number(g.target_value) || 0;
            const remaining = target - (next[g.id]?.current || 0);
            const endMs = Date.parse(ptDateToUtcISO(`${Number(todayKey.slice(0, 4)) + 1}-01-01`));
            const daysLeft = Math.max(1, Math.ceil((endMs - now.getTime()) / 86400000));
            vel[g.id] = { last10, prev10, paceNeeded10: (remaining / daysLeft) * 10 };
          }
          setVelocity(vel);
        } else {
          setVelocity({});
        }
      }
    } else {
      setVelocity({});
    }

    // ── Post-count goals: Metricool (live) + content_items ──
    if (postGoals.length) {
      const allTypes = new Set(postGoals.flatMap(g => g.metrics || []));
      const needsMetricool = [...allTypes].some(t => POST_TYPE_MAP[t]?.source === 'metricool');
      const needsYouTube   = [...allTypes].some(t => POST_TYPE_MAP[t]?.source === 'content_items');

      let mcPosts = [], ciItems = [];
      if (needsMetricool) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch(
            `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/metricool-posts?start=${windowStart}&end=${todayKey}`,
            { headers: { Authorization: `Bearer ${session?.access_token}`, apikey: process.env.REACT_APP_SUPABASE_ANON_KEY } },
          );
          if (res.ok) mcPosts = (await res.json()).posts || [];
          else console.error('metricool-posts returned', res.status);
        } catch (err) {
          console.error('post-count metricool fetch:', err);
        }
      }
      if (needsYouTube) {
        const { data, error } = await supabase
          .from('content_items')
          .select('id, content_type, platform_account_id, published_at, duration_seconds')
          .gte('published_at', ptDateToUtcISO(windowStart))
          .lt('published_at', ptDateToUtcISO(todayKey, true));
        if (error) console.error('post-count content_items fetch:', error);
        ciItems = data || [];
      }

      for (const g of postGoals) {
        const history = countPostsByPeriod({
          mcPosts, ciItems,
          types: g.metrics || [],
          ytAccountIds: g.platform_account_ids || [],
          keyFn: bucketKeyFor(g.category),
        });
        next[g.id] = { current: history[currentBucket(g.category, now)] || 0, history };
      }
    }

    setProgress(next);
  }

  // ── Section CRUD ──

  async function submitSection(e) {
    e.preventDefault();
    const name = (sectionForm?.name || '').trim();
    if (!name) return;
    if (sectionForm.id) {
      const { error } = await supabase.from('goal_sections')
        .update({ name, updated_at: new Date().toISOString() }).eq('id', sectionForm.id);
      if (error) { alert('Error: ' + error.message); return; }
    } else {
      const nextPos = sections.length ? Math.max(...sections.map(s => s.position || 0)) + 1 : 0;
      const { error } = await supabase.from('goal_sections')
        .insert({ name, position: nextPos, scope: 'content', created_by: profile.id });
      if (error) { alert('Error: ' + error.message); return; }
    }
    setSectionForm(null);
    fetchAll();
  }

  // Cascade is enforced by the FK (goals.section_id on delete cascade); the
  // typed name is the guard against doing it by accident.
  async function confirmDeleteSection() {
    if (!deleteSection || deleteConfirmText !== deleteSection.name) return;
    const { error } = await supabase.from('goal_sections').delete().eq('id', deleteSection.id);
    if (error) { alert('Error: ' + error.message); return; }
    setDeleteSection(null);
    setDeleteConfirmText('');
    fetchAll();
  }

  async function moveSection(section, dir) {
    const ordered = [...sections].sort((a, b) => (a.position || 0) - (b.position || 0));
    const i = ordered.findIndex(s => s.id === section.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    setSections(ordered.map((s, idx) => ({ ...s, position: idx })));
    await Promise.all(ordered.map((s, idx) =>
      supabase.from('goal_sections').update({ position: idx }).eq('id', s.id)));
    fetchAll();
  }

  // ── Goal CRUD ──

  function openCreateGoal(sectionId, period) {
    setGoalForm({ ...EMPTY_GOAL, openFor: sectionId, editingId: null, category: period || 'weekly' });
  }
  function openEditGoal(goal) {
    setGoalForm({
      openFor: goal.section_id,
      editingId: goal.id,
      title: goal.title,
      current_value: String(goal.current_value ?? ''),
      target_value: String(goal.target_value ?? ''),
      category: goal.category,
      goal_type: goal.goal_type,
      metrics: goal.metrics || [],
      platform_account_ids: goal.platform_account_ids || [],
    });
  }

  async function submitGoal(e) {
    e.preventDefault();
    const f = goalForm;
    const title = (f.title || '').trim();
    if (!title) return;

    const isMetric = f.goal_type === 'metric';
    const isPost   = f.goal_type === 'post_count';
    const target = parseFloat(f.target_value) || 1;
    const storedTarget = isMetric && f.metrics.length === 1
      ? formatTargetForMetric(f.metrics[0], target)
      : target;

    if (isMetric && (!f.metrics.length || !(f.platform_account_ids || []).length)) {
      alert('Please select at least one metric and one platform.');
      return;
    }
    if (isPost) {
      if (!f.metrics.length) { alert('Please select at least one post type.'); return; }
      if (needsAccountPicker(f.metrics) && !(f.platform_account_ids || []).length) {
        alert('Please pick which YouTube channel to count.');
        return;
      }
    }

    // Post-count goals resolve their own accounts from the selected types;
    // only the two YouTube types need an explicit channel choice.
    const accountIds = isPost
      ? [...new Set([
          ...impliedAccountIds(f.metrics, accounts),
          ...(needsAccountPicker(f.metrics) ? (f.platform_account_ids || []) : []),
        ])]
      : (isMetric ? f.platform_account_ids : []);

    const payload = {
      title,
      category: f.category,
      goal_type: f.goal_type,
      target_value: storedTarget,
      current_value: f.goal_type === 'manual' ? (parseFloat(f.current_value) || 0) : 0,
      metrics: f.goal_type === 'manual' ? [] : f.metrics,
      platform_account_ids: accountIds,
      section_id: f.openFor,
      scope: 'content',
    };

    if (f.editingId) {
      const { error } = await supabase.from('goals')
        .update({ ...payload, updated_at: new Date().toISOString() }).eq('id', f.editingId);
      if (error) { alert('Error: ' + error.message); return; }
    } else {
      const { error } = await supabase.from('goals').insert({ ...payload, created_by: profile.id });
      if (error) { alert('Error: ' + error.message); return; }
    }
    setGoalForm(null);
    fetchAll();
  }

  async function deleteGoal(id) {
    if (!(await confirm('Delete this goal?'))) return;
    await supabase.from('goals').delete().eq('id', id);
    fetchAll();
  }

  // ── Form helpers ──

  const patchForm = (patch) => setGoalForm(prev => ({ ...prev, ...patch }));
  const toggleMetric = (key) => setGoalForm(prev => {
    const cur = prev.metrics || [];
    if (cur.includes(key)) return { ...prev, metrics: cur.filter(m => m !== key) };
    if (cur.length >= 3) return prev;   // metric sums stay readable
    return { ...prev, metrics: [...cur, key] };
  });
  const togglePostType = (key) => setGoalForm(prev => {
    const cur = prev.metrics || [];
    return cur.includes(key)
      ? { ...prev, metrics: cur.filter(m => m !== key) }
      : { ...prev, metrics: [...cur, key] };
  });
  const toggleAccount = (id) => setGoalForm(prev => {
    const cur = prev.platform_account_ids || [];
    return cur.includes(id)
      ? { ...prev, platform_account_ids: cur.filter(a => a !== id) }
      : { ...prev, platform_account_ids: [...cur, id] };
  });

  if (loading) return <div style={styles.loading}>Loading goals…</div>;

  const orderedSections = [...sections].sort((a, b) => (a.position || 0) - (b.position || 0));

  return (
    <div style={styles.section}>
      <div style={styles.header}>
        <h2 style={styles.title}>Goals</h2>
        {isAdmin && !sectionForm && (
          <button onClick={() => setSectionForm({ id: null, name: '' })} style={styles.addBtn}>
            + Section
          </button>
        )}
      </div>

      {sectionForm && (
        <form onSubmit={submitSection} style={styles.form}>
          <div style={styles.formLabel}>{sectionForm.id ? 'Rename Section' : 'New Section'}</div>
          <input
            value={sectionForm.name}
            onChange={e => setSectionForm({ ...sectionForm, name: e.target.value })}
            placeholder="Section name — e.g. Socials Funnel"
            style={styles.input}
            autoFocus
          />
          <div style={styles.formRow}>
            <button type="submit" style={styles.submitBtn}>{sectionForm.id ? 'Rename' : 'Create Section'}</button>
            <button type="button" onClick={() => setSectionForm(null)} style={{ ...styles.addBtn, color: 'rgba(255,255,255,0.5)' }}>Cancel</button>
          </div>
        </form>
      )}

      {orderedSections.length === 0 && !sectionForm ? (
        <p style={styles.empty}>
          {isAdmin ? 'No sections yet — create one with + Section.' : 'No goals yet.'}
        </p>
      ) : orderedSections.map((section, idx) => {
        const sectionGoals = goals.filter(g => g.section_id === section.id);
        const isCollapsed = collapsed[section.id];
        const formHere = goalForm && goalForm.openFor === section.id;

        return (
          <div key={section.id} style={styles.sectionCard}>
            <div style={styles.sectionHeader}>
              <button type="button" onClick={() => toggleSection(section.id)} style={styles.collapseBtn}>
                <span style={{
                  display: 'inline-block', fontSize: 9, color: 'rgba(255,255,255,0.5)',
                  transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s',
                }}>▼</span>
                <span style={styles.sectionName}>{section.name}</span>
                <span style={styles.sectionCount}>
                  {sectionGoals.length} goal{sectionGoals.length === 1 ? '' : 's'}
                </span>
              </button>
              {isAdmin && (
                <div style={styles.cardActions}>
                  <button onClick={() => moveSection(section, -1)} disabled={idx === 0}
                    style={{ ...styles.iconBtn, opacity: idx === 0 ? 0.25 : 1 }} title="Move up">↑</button>
                  <button onClick={() => moveSection(section, 1)} disabled={idx === orderedSections.length - 1}
                    style={{ ...styles.iconBtn, opacity: idx === orderedSections.length - 1 ? 0.25 : 1 }} title="Move down">↓</button>
                  <button onClick={() => setSectionForm({ id: section.id, name: section.name })}
                    style={styles.iconBtn} title="Rename">
                    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M14.5 3.5l2 2L6 16H4v-2L14.5 3.5z" />
                    </svg>
                  </button>
                  <button onClick={() => { setDeleteSection(section); setDeleteConfirmText(''); }}
                    style={styles.iconBtn} title="Delete section">
                    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M5 6h10M8 6V4h4v2M6 6v10a1 1 0 001 1h6a1 1 0 001-1V6" />
                    </svg>
                  </button>
                  {!formHere && (
                    <button onClick={() => openCreateGoal(section.id)} style={styles.addMonthlyBtn}>+ Goal</button>
                  )}
                </div>
              )}
            </div>

            {!isCollapsed && (
              <>
                {formHere && (
                  <GoalForm
                    form={goalForm}
                    accounts={accounts}
                    onPatch={patchForm}
                    onToggleMetric={toggleMetric}
                    onTogglePostType={togglePostType}
                    onToggleAccount={toggleAccount}
                    onSubmit={submitGoal}
                    onCancel={() => setGoalForm(null)}
                  />
                )}

                {/* Period subsections, chronological. A period with no goals
                    renders nothing at all — no heading, no empty state. */}
                {PERIODS.map(period => {
                  const periodGoals = sectionGoals.filter(g => g.category === period.key);
                  if (!periodGoals.length) return null;
                  return (
                    <div key={period.key} style={styles.periodZone}>
                      <div style={styles.periodLabel}>
                        <span style={{ color: period.badge }}>{period.label}</span>
                        <span style={styles.periodSub}>{periodLabel(period.key)}</span>
                      </div>
                      <div style={styles.goalGrid}>
                        {periodGoals.map(g => (
                          <GoalCard
                            key={g.id}
                            goal={g}
                            progress={progress[g.id]}
                            velocity={velocity[g.id]}
                            accounts={accounts}
                            isAdmin={isAdmin}
                            onEdit={openEditGoal}
                            onDelete={deleteGoal}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}

                {sectionGoals.length === 0 && !formHere && (
                  <div style={styles.monthlyEmpty}>
                    {isAdmin ? 'No goals in this section yet — add one with + Goal.' : 'No goals yet.'}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}

      {/* Typed-confirmation delete, same shape as deleting a Business Dev phase */}
      {deleteSection && (
        <div style={styles.modalOverlay} onClick={() => setDeleteSection(null)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Delete “{deleteSection.name}”?</h3>
            <p style={styles.modalSubtitle}>
              This deletes the section and every goal inside it
              {' '}({goals.filter(g => g.section_id === deleteSection.id).length} goal
              {goals.filter(g => g.section_id === deleteSection.id).length === 1 ? '' : 's'}).
              This can't be undone. Type the section name to confirm.
            </p>
            <input
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              placeholder={deleteSection.name}
              style={styles.input}
              autoFocus
            />
            <div style={styles.formRow}>
              <button
                onClick={confirmDeleteSection}
                disabled={deleteConfirmText !== deleteSection.name}
                style={{
                  ...styles.submitBtn, background: '#ef4444',
                  opacity: deleteConfirmText === deleteSection.name ? 1 : 0.4,
                  cursor: deleteConfirmText === deleteSection.name ? 'pointer' : 'not-allowed',
                }}
              >
                Delete Section
              </button>
              <button onClick={() => setDeleteSection(null)}
                style={{ ...styles.addBtn, color: 'rgba(255,255,255,0.5)' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Goal form ────────────────────────────────────────────────

function GoalForm({ form, accounts, onPatch, onToggleMetric, onTogglePostType, onToggleAccount, onSubmit, onCancel }) {
  const isManual = form.goal_type === 'manual';
  const isMetric = form.goal_type === 'metric';
  const isPost   = form.goal_type === 'post_count';

  return (
    <form onSubmit={onSubmit} style={styles.form}>
      <div style={styles.formLabel}>{form.editingId ? 'Edit Goal' : 'New Goal'}</div>

      <div>
        <div style={styles.formSubLabel}>Time period</div>
        <div style={styles.formRow}>
          {PERIODS.map(p => (
            <button key={p.key} type="button" onClick={() => onPatch({ category: p.key })}
              style={{ ...styles.typeBtn, ...(form.category === p.key ? styles.typeBtnActive : {}) }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div style={styles.formSubLabel}>Goal type</div>
        <div style={styles.formRow}>
          {GOAL_TYPES.map(t => (
            <button key={t.key} type="button" onClick={() => onPatch({ goal_type: t.key, metrics: [] })}
              style={{ ...styles.typeBtn, ...(form.goal_type === t.key ? styles.typeBtnActive : {}) }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <input
        value={form.title}
        onChange={e => onPatch({ title: e.target.value })}
        placeholder="Goal title"
        style={styles.input}
        autoFocus
      />

      {isManual ? (
        <div style={styles.formRow}>
          <input value={form.current_value} onChange={e => onPatch({ current_value: e.target.value })}
            placeholder="Current value" style={{ ...styles.input, flex: 1 }} inputMode="decimal" />
          <input value={form.target_value} onChange={e => onPatch({ target_value: e.target.value })}
            placeholder="Target value" style={{ ...styles.input, flex: 1 }} inputMode="decimal" />
        </div>
      ) : (
        <input value={form.target_value} onChange={e => onPatch({ target_value: e.target.value })}
          placeholder={`Target per ${form.category === 'weekly' ? 'week' : form.category === 'monthly' ? 'month' : 'year'}`}
          style={styles.input} inputMode="decimal" />
      )}

      {isMetric && (
        <>
          <div>
            <div style={styles.formSubLabel}>Metrics (up to 3)</div>
            <div style={styles.chipRow}>
              {METRIC_OPTIONS.map(m => {
                const selected = (form.metrics || []).includes(m.key);
                return (
                  <button key={m.key} type="button" onClick={() => onToggleMetric(m.key)}
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
                const selected = (form.platform_account_ids || []).includes(acct.id);
                const pm = PLATFORM_META[acct.platform] || {};
                return (
                  <button key={acct.id} type="button" onClick={() => onToggleAccount(acct.id)}
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

      {isPost && (
        <>
          <div>
            <div style={styles.formSubLabel}>Count which posts</div>
            <div style={styles.chipRow}>
              {POST_TYPE_OPTIONS.map(o => {
                const selected = (form.metrics || []).includes(o.key);
                return (
                  <button key={o.key} type="button" onClick={() => onTogglePostType(o.key)}
                    style={{
                      ...styles.chip,
                      ...(selected ? { background: o.color + '22', borderColor: o.color + '66', color: o.color } : {}),
                    }}>
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
          {/* The five Metricool types resolve their own account; only YouTube
              is ambiguous, since there are two channels. */}
          {needsAccountPicker(form.metrics) && (
            <div>
              <div style={styles.formSubLabel}>YouTube channel</div>
              <div style={styles.chipRow}>
                {accounts.filter(a => a.platform === 'youtube').map(acct => {
                  const selected = (form.platform_account_ids || []).includes(acct.id);
                  const pm = PLATFORM_META.youtube;
                  return (
                    <button key={acct.id} type="button" onClick={() => onToggleAccount(acct.id)}
                      style={{
                        ...styles.chip,
                        ...(selected ? { background: pm.color + '22', borderColor: pm.color + '66', color: pm.color } : {}),
                      }}>
                      {acct.account_name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      <div style={styles.formRow}>
        <button type="submit" style={styles.submitBtn}>{form.editingId ? 'Update Goal' : 'Create Goal'}</button>
        <button type="button" onClick={onCancel} style={{ ...styles.addBtn, color: 'rgba(255,255,255,0.5)' }}>Cancel</button>
      </div>
    </form>
  );
}

// ─── Goal card ────────────────────────────────────────────────

function GoalCard({ goal, progress, velocity, accounts, isAdmin, onEdit, onDelete }) {
  const [paceHover, setPaceHover] = useState(false);
  const period = goal.category;
  const isManual = goal.goal_type === 'manual';
  const isMetric = goal.goal_type === 'metric';
  const isPost   = goal.goal_type === 'post_count';
  const metrics = goal.metrics || [];

  const current = progress?.current ?? (isManual ? Number(goal.current_value) || 0 : 0);
  const target = Number(goal.target_value) || 1;
  const pct = Math.min(current / target, 1);
  const pctDisplay = Math.round(pct * 100);
  const color = progressColor(pct);

  // Only single-metric goals can carry a unit; a mixed sum is just a number.
  const unitKey = isMetric && metrics.length === 1 ? metrics[0] : null;
  const fmt = (v) => (unitKey ? formatMetricValue(unitKey, v) : Math.round(v).toLocaleString());

  const expFrac = expectedFraction(period);
  const expPct = Math.round(expFrac * 100);
  const expDisplay = fmt(target * expFrac);

  const accountNames = isMetric
    ? (goal.platform_account_ids || []).map(id => (accounts.find(a => a.id === id) || {}).account_name).filter(Boolean)
    : [];

  // Weekly cards carry a hit/miss strip; it needs per-period history, which
  // manual goals don't have.
  const weekKeys = period === 'weekly' && !isManual ? recentWeekStarts(WEEK_HISTORY) : null;

  return (
    <div style={styles.monthlyCard}>
      <div style={styles.cardHeader}>
        <div style={styles.cardTitleRow}>
          <span style={{
            ...styles.monthlyBadge,
            color: PERIOD_MAP[period]?.badge || '#fbbf24',
            background: (PERIOD_MAP[period]?.badge || '#fbbf24') + '1a',
          }}>
            {PERIOD_MAP[period]?.label || period}
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

      {!isManual && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {metrics.map(key => (isPost ? (
            <span key={key} style={{
              ...styles.metricTag,
              color: POST_TYPE_MAP[key]?.color || '#fff',
              background: (POST_TYPE_MAP[key]?.color || '#666') + '18',
            }}>
              {POST_TYPE_MAP[key]?.short || key}
            </span>
          ) : (
            <span key={key} style={styles.metricTag}>
              {METRIC_OPTIONS.find(m => m.key === key)?.label || key}
            </span>
          )))}
          {accountNames.map((name, i) => <span key={i} style={styles.platformTag}>{name}</span>)}
        </div>
      )}

      <div style={styles.barBg}>
        <div style={styles.barClip}>
          <div style={{ ...styles.barFill, width: `${pctDisplay}%`, background: color }} />
        </div>
        <div
          style={{ ...styles.paceHit, left: `${expPct}%` }}
          onMouseEnter={() => setPaceHover(true)}
          onMouseLeave={() => setPaceHover(false)}
        >
          <div style={styles.paceTick} />
          <div style={styles.paceDot} />
          {paceHover && <div style={styles.paceTip}>On pace: {expDisplay} ({expPct}%)</div>}
        </div>
      </div>
      <div style={styles.cardFooter}>
        <span style={styles.cardNumbers}>{fmt(current)} / {fmt(target)}</span>
        <span style={{ ...styles.cardPct, color }}>{pctDisplay}%</span>
      </div>

      {weekKeys && (
        <div style={styles.weekStrip}>
          {weekKeys.map((wk, i) => {
            const count = progress?.history?.[wk] || 0;
            const hit = count >= target;
            const isCurrent = i === weekKeys.length - 1;
            return (
              <span
                key={wk}
                title={`${weekRangeLabel(wk)} — ${fmt(count)}/${fmt(target)}${isCurrent ? ' (in progress)' : ''}`}
                style={{
                  ...styles.weekDot,
                  ...(isCurrent
                    ? { border: `1.5px solid ${color}`, background: 'transparent', color }
                    : hit
                      ? { background: 'rgba(34,197,94,0.18)', color: '#22c55e' }
                      : { background: 'rgba(249,115,22,0.15)', color: '#f97316' }),
                }}
              >
                {isCurrent ? '●' : hit ? '✓' : '✗'}
              </span>
            );
          })}
        </div>
      )}

      {velocity && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(255,255,255,0.4)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>Last 10d: +{fmt(velocity.last10)} (prev: +{fmt(velocity.prev10)})</span>
          <span>
            <span style={{
              color: velocity.last10 >= velocity.paceNeeded10 * 1.02 ? '#22c55e'
                : velocity.last10 >= velocity.paceNeeded10 * 0.98 ? '#86efac' : '#f97316',
            }}>
              {velocity.last10 >= velocity.paceNeeded10 * 1.02 ? 'Ahead'
                : velocity.last10 >= velocity.paceNeeded10 * 0.98 ? 'On Pace' : 'Behind'}
            </span>
            {' '}({fmt(velocity.paceNeeded10)})
          </span>
        </div>
      )}

      <div style={styles.cardUpdated}>
        {isManual ? `Updated ${formatDate(goal.updated_at)}` : `${periodLabel(period)} — live`}
      </div>
    </div>
  );
}

const styles = {
  section: { marginBottom: 32 },
  loading: { color: 'rgba(255,255,255,0.4)', padding: '20px 0', fontSize: 13 },

  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontSize: 18, fontWeight: 700, color: '#fff', margin: 0 },

  addBtn: {
    padding: '8px 16px', borderRadius: 10, border: 'none',
    background: colors.accentA15, color: colors.accentFg,
    fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  dropdown: {
    position: 'absolute', top: '110%', right: 0,
    background: colors.bgHover, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
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
  typeBtnActive: { background: colors.accentA15, borderColor: colors.accentA40, color: colors.accentFg },
  chipRow: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  chip: {
    padding: '5px 12px', borderRadius: 16,
    border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  chipSelected: { background: colors.accentA15, borderColor: colors.accentA40, color: colors.accentFg },
  submitBtn: {
    padding: '10px 20px', borderRadius: 8, border: 'none',
    background: colors.accent, color: colors.white, fontSize: 13, fontWeight: 600,
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
    background: colors.bgHover,
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
  weeklyBadge: {
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
    color: '#34d399', background: 'rgba(52,211,153,0.1)',
    padding: '3px 8px', borderRadius: 4, flexShrink: 0,
  },

  // ── Weekly subsection ──
  weeklyZone: {
    display: 'flex', flexDirection: 'column', gap: 10,
    paddingBottom: 16, marginBottom: 16,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  subsectionHeader: { display: 'flex', alignItems: 'center', gap: 10 },
  subsectionTitle: {
    fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.4)',
  },
  subsectionHint: {
    fontSize: 11, color: 'rgba(255,255,255,0.25)', flex: 1,
  },
  weeklyGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: 10,
  },
  weekStrip: { display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' },
  weekDot: {
    width: 18, height: 18, borderRadius: 4,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 10, fontWeight: 700, cursor: 'default',
  },
  // ── Sections ──
  sectionCard: {
    border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12,
    padding: 14, marginBottom: 14,
    display: 'flex', flexDirection: 'column', gap: 12,
  },
  sectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  collapseBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    background: 'transparent', border: 'none', padding: 0,
    cursor: 'pointer', fontFamily: 'inherit', minWidth: 0, flex: 1, textAlign: 'left',
  },
  sectionName: { fontSize: 15, fontWeight: 700, color: '#fff' },
  sectionCount: { fontSize: 11, color: 'rgba(255,255,255,0.3)' },
  periodZone: { display: 'flex', flexDirection: 'column', gap: 8 },
  periodLabel: {
    display: 'flex', alignItems: 'baseline', gap: 8,
    fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  periodSub: { fontSize: 11, fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: 'rgba(255,255,255,0.25)' },
  goalGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 10,
  },
};
