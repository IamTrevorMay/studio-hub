// Tracking — admin view of every post published in a given month,
// grouped by source (TikTok / More Mayday / TMB / Instagram / Facebook / Substack).
// Compact row list per column. Hover reveals thumbnail + metrics.

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { ptRangeToUtc, ptDayKey } from '../lib/ptDate';
import GoalsSection from '../components/GoalsSection';
import ProgressKanban from '../components/ProgressKanban';
import { colors } from '../lib/styleTokens';

// ─── Config ─────────────────────────────────────────────────

const POSTS_COLUMNS = [
  { key: 'tiktok',    label: 'TikTok',                 accountId: 'e6101720-f32c-45e1-8cc3-195864d0ae36', color: '#00F2EA', icon: 'TT', source: 'metricool',     network: 'TIKTOK' },
  { key: 'mm_yt',     label: 'More Mayday',            accountId: '4e7f34a3-acf8-4cae-9023-0bfa04280c14', color: '#FF0000', icon: 'YT', source: 'content_items', isYouTube: true },
  { key: 'tmb_yt',    label: 'Trevor May Baseball',    accountId: '3b68a43a-4967-4b00-8572-296077721ebb', color: '#FF0000', icon: 'YT', source: 'content_items', isYouTube: true },
  { key: 'instagram', label: 'Instagram',              accountId: '4a960721-ef97-42c0-a1d4-222aa621ddc4', color: '#E4405F', icon: 'IG', source: 'metricool',     network: 'INSTAGRAM' },
  { key: 'facebook',  label: 'Facebook',               accountId: 'eb95b9c9-c78e-486a-b1a9-6991f5b030cd', color: '#1877F2', icon: 'FB', source: 'metricool',     network: 'FACEBOOK' },
  { key: 'substack',  label: 'Substack',               accountId: 'c46338e3-d923-43c7-a6ca-8dac8d53abf7', color: '#FF6719', icon: 'SS', source: 'content_items' },
];

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const POPOVER_W = 260;
const POPOVER_H_EST = 220;

// ─── Helpers ────────────────────────────────────────────────

function getMonthRange(year, month) {
  const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const end = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

function formatCompact(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  if (n % 1 !== 0) return n.toFixed(1);
  return n.toLocaleString();
}

function shortDate(s) {
  if (!s) return '';
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// YouTube row chip: <=180s = Short, otherwise Video.
// (content_type field in DB is unreliable — sync-youtube uses an old
// 60s threshold, but YouTube Shorts max length is now 3 minutes.)
function ytKind(post) {
  const d = Number(post.duration_seconds);
  if (Number.isFinite(d) && d > 0 && d <= 180) return 'Short';
  return 'Video';
}

// Map Metricool network → POSTS_COLUMNS key (More Mayday only)
const NETWORK_TO_COL_KEY = {
  TIKTOK: 'tiktok',
  YOUTUBE: 'mm_yt',
  INSTAGRAM: 'instagram',
  FACEBOOK: 'facebook',
};

function formatUpcomingDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('en-US', { weekday: 'short' });
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const date = d.getDate();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${day}, ${month} ${date} · ${time}`;
}

async function fetchAllRows(query) {
  const PAGE = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data } = await query.range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// ─── Component ──────────────────────────────────────────────

export default function Tracking() {
  const { isAdmin, profile } = useAuth();
  const [postsMonth, setPostsMonth] = useState(new Date().getMonth());
  const [postsYear, setPostsYear] = useState(new Date().getFullYear());
  const [postsData, setPostsData] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [hover, setHover] = useState(null); // { post, x, y }
  const [goals, setGoals] = useState({});  // { columnKey: goalNumber }
  const [editingGoal, setEditingGoal] = useState(null); // columnKey being edited
  const goalInputRef = useRef(null);
  const postsGenRef = useRef(0);

  // ── Initiatives (daily goals) state ──
  const [initiativeTargets, setInitiativeTargets] = useState({});
  const [storyCounts, setStoryCounts] = useState({});
  const [initiativeLoading, setInitiativeLoading] = useState(false);
  const [editingInitiativeTarget, setEditingInitiativeTarget] = useState(null);
  const [initiativeTargetDraft, setInitiativeTargetDraft] = useState('');
  const storyFailCount = useRef(0);

  // Fetch goals for current month
  const fetchGoals = useCallback(async () => {
    const { data } = await supabase
      .from('tracking_post_goals')
      .select('column_key, goal')
      .eq('year', postsYear)
      .eq('month', postsMonth);
    const map = {};
    (data || []).forEach(r => { map[r.column_key] = r.goal; });
    setGoals(map);
  }, [postsYear, postsMonth]);

  useEffect(() => { fetchGoals(); }, [fetchGoals]);

  const saveGoal = useCallback(async (columnKey, value) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0) return;
    setGoals(prev => ({ ...prev, [columnKey]: num || undefined }));
    setEditingGoal(null);
    if (num === 0) {
      await supabase
        .from('tracking_post_goals')
        .delete()
        .eq('column_key', columnKey)
        .eq('year', postsYear)
        .eq('month', postsMonth);
    } else {
      await supabase
        .from('tracking_post_goals')
        .upsert(
          { column_key: columnKey, year: postsYear, month: postsMonth, goal: num, updated_at: new Date().toISOString() },
          { onConflict: 'column_key,year,month' },
        );
    }
  }, [postsYear, postsMonth]);

  // Focus input when editing goal
  useEffect(() => {
    if (editingGoal && goalInputRef.current) goalInputRef.current.focus();
  }, [editingGoal]);

  // Fetch upcoming posts from Metricool + YouTube scheduled videos
  const [upcomingPosts, setUpcomingPosts] = useState([]);   // Metricool
  const [ytScheduled, setYtScheduled] = useState([]);       // YouTube

  const fetchUpcoming = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const headers = { Authorization: `Bearer ${session.access_token}`, apikey: process.env.REACT_APP_SUPABASE_ANON_KEY };
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const end = new Date(today);
      end.setDate(end.getDate() + 7);
      const startStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;

      // Fetch Metricool + YouTube scheduled in parallel
      const [mcRes, ytRes] = await Promise.all([
        fetch(
          `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/metricool-posts?start=${startStr}&end=${endStr}`,
          { headers },
        ),
        fetch(
          `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/youtube-scheduled`,
          { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' },
        ).catch(() => null),
      ]);

      // Process Metricool
      if (mcRes.ok) {
        const { posts: all } = await mcRes.json();
        const now = new Date();
        const upcoming = (all || [])
          .filter(p => p.status !== 'PUBLISHED')
          .filter(p => {
            if (!p.publicationDate) return false;
            const d = new Date(p.publicationDate);
            return d >= now && d < end;
          })
          .sort((a, b) => new Date(a.publicationDate) - new Date(b.publicationDate));
        setUpcomingPosts(upcoming);
      }

      // Process YouTube scheduled
      if (ytRes && ytRes.ok) {
        const { scheduled } = await ytRes.json();
        setYtScheduled(scheduled || []);
      }
    } catch (e) {
      console.error('Failed to fetch upcoming posts:', e);
    }
  }, []);

  useEffect(() => { fetchUpcoming(); }, [fetchUpcoming]);

  // Group upcoming posts by column key (Metricool + YouTube)
  const upcomingByCol = useMemo(() => {
    const map = {};
    // Metricool upcoming
    for (const p of upcomingPosts) {
      const colKey = NETWORK_TO_COL_KEY[p.network];
      if (!colKey) continue;
      (map[colKey] ||= []).push({
        id: `mc_upcoming_${p.id}`,
        title: p.youtubeTitle || p.text || '(untitled)',
        scheduledAt: p.publicationDate,
      });
    }
    // YouTube scheduled — match accountId to POSTS_COLUMNS
    for (const v of ytScheduled) {
      const col = POSTS_COLUMNS.find(c => c.accountId === v.accountId);
      if (!col) continue;
      (map[col.key] ||= []).push({
        id: `yt_sched_${v.videoId}`,
        title: v.title,
        scheduledAt: v.scheduledAt,
      });
    }
    // Sort each column's upcoming by scheduledAt
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
    }
    return map;
  }, [upcomingPosts, ytScheduled]);

  const fetchPosts = useCallback(async () => {
    const gen = ++postsGenRef.current;
    setPostsLoading(true);
    const { start, end } = getMonthRange(postsYear, postsMonth);
    const { startUtc, endUtc } = ptRangeToUtc(start, end);

    const ciIds = POSTS_COLUMNS.filter(c => c.source === 'content_items').map(c => c.accountId);
    const ciQuery = supabase
      .from('content_items')
      .select('id, title, published_at, url, content_type, thumbnail_url, description, duration_seconds, platform_account_id, platform_account:platform_accounts(platform, account_name), latest_metrics:content_metrics(views, likes, comments, shares, engagement_rate)')
      .in('platform_account_id', ciIds)
      .gte('published_at', startUtc)
      .lt('published_at', endUtc)
      .order('published_at', { ascending: false });

    const { data: { session: mcSession } } = await supabase.auth.getSession();
    const mcFetch = fetch(
      `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/metricool-posts?start=${start}&end=${end}`,
      { headers: { Authorization: `Bearer ${mcSession?.access_token}`, apikey: process.env.REACT_APP_SUPABASE_ANON_KEY } },
    );

    const [ciData, mcRes] = await Promise.all([fetchAllRows(ciQuery), mcFetch]);
    if (gen !== postsGenRef.current) return;

    let mcPosts = [];
    if (mcRes.ok) {
      const mcJson = await mcRes.json();
      const networkToCol = {};
      POSTS_COLUMNS.filter(c => c.source === 'metricool').forEach(c => { networkToCol[c.network] = c.accountId; });
      // Metricool is asked with extendedRange=true, so it returns posts past
      // the window boundary — a Jul 31 reel came back for an Aug 1 request.
      // Without this the extra posts land in the wrong month's column.
      mcPosts = (mcJson.posts || [])
        .filter(p => p.status === 'PUBLISHED' && networkToCol[p.network])
        .filter(p => {
          if (!p.publicationDate) return false;
          const day = ptDayKey(p.publicationDate);
          return day >= start && day <= end;
        })
        .map(p => ({
          id: `mc_${p.id}`,
          title: p.youtubeTitle || p.text || '(untitled)',
          published_at: p.publicationDate,
          url: p.publicUrl,
          content_type: p.instagramType || p.facebookType || p.youtubeType || null,
          thumbnail_url: null,
          description: null,
          duration_seconds: null,
          platform_account_id: networkToCol[p.network],
          latest_metrics: null,
          _source: 'metricool',
        }));
    }

    setPostsData([...(ciData || []), ...mcPosts]);
    setPostsLoading(false);
  }, [postsMonth, postsYear]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  // ── Initiatives (daily goals) fetching ──
  const fetchInitiativeTargets = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const { data } = await supabase
        .from('admin_goals')
        .select('id, name, daily_target')
        .eq('is_active', true);
      const map = {};
      for (const g of data || []) map[g.name] = { id: g.id, daily_target: g.daily_target };
      if (!map.ig_stories) map.ig_stories = { id: null, daily_target: 1 };
      setInitiativeTargets(map);
    } catch (err) {
      console.error('Error fetching initiative targets:', err);
      setInitiativeTargets(prev => prev.ig_stories ? prev : { ig_stories: { id: null, daily_target: 1 } });
    }
  }, [isAdmin]);

  const fetchStoryCounts = useCallback(async () => {
    if (!isAdmin) return;
    setInitiativeLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
      const resp = await fetch(
        `${supabaseUrl}/functions/v1/metricool-stories?days=7`,
        { headers: { Authorization: `Bearer ${session.access_token}`, apikey: process.env.REACT_APP_SUPABASE_ANON_KEY } }
      );
      if (resp.ok) {
        const data = await resp.json();
        setStoryCounts(data.countsByDate || {});
        storyFailCount.current = 0;
      } else {
        storyFailCount.current += 1;
      }
    } catch (err) {
      console.error('Error fetching story counts:', err);
      storyFailCount.current += 1;
    } finally {
      setInitiativeLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || !profile?.id) return;
    fetchInitiativeTargets();
    fetchStoryCounts();
    const interval = setInterval(() => {
      if (storyFailCount.current >= 3) return;
      fetchStoryCounts();
    }, 30000);
    return () => clearInterval(interval);
  }, [isAdmin, profile?.id, fetchInitiativeTargets, fetchStoryCounts]);

  async function updateInitiativeTarget(goalId, newTarget) {
    // Null id means the row wasn't loaded (transient fetch fallback). Don't run
    // an `.eq('id', null)` no-op update — recover the real id and bail.
    if (!goalId) { setEditingInitiativeTarget(null); fetchInitiativeTargets(); return; }
    const val = Math.max(1, parseInt(newTarget, 10) || 1);
    await supabase.from('admin_goals').update({ daily_target: val, updated_at: new Date().toISOString() }).eq('id', goalId);
    setInitiativeTargets(prev => {
      const updated = { ...prev };
      for (const key of Object.keys(updated)) {
        if (updated[key].id === goalId) updated[key] = { ...updated[key], daily_target: val };
      }
      return updated;
    });
    setEditingInitiativeTarget(null);
  }

  // Build 7-day data for initiatives section
  const initiativeDays = useMemo(() => {
    const goal = initiativeTargets.ig_stories;
    if (!goal) return null;
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dayLabel = i === 0 ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short' });
      days.push({ dateStr, dayLabel, count: storyCounts[dateStr] || 0 });
    }
    return days;
  }, [initiativeTargets.ig_stories, storyCounts]);

  // Build YouTube sub-counts per column
  const ytSubCounts = useMemo(() => {
    const result = {};
    POSTS_COLUMNS.filter(c => c.isYouTube).forEach(col => {
      const colPosts = postsData.filter(p => p.platform_account_id === col.accountId);
      const shorts = colPosts.filter(p => ytKind(p) === 'Short').length;
      const videos = colPosts.filter(p => ytKind(p) === 'Video').length;
      result[col.key] = { shorts, videos };
    });
    return result;
  }, [postsData]);

  // Editable goal number component
  const GoalDisplay = ({ columnKey, count }) => {
    const goal = goals[columnKey];
    const isEditing = editingGoal === columnKey;

    if (isEditing) {
      return (
        <span style={styles.goalFraction}>
          <span style={styles.goalCount}>{count}</span>
          <span style={styles.goalSlash}>/</span>
          <input
            ref={goalInputRef}
            defaultValue={goal || ''}
            placeholder="0"
            style={styles.goalInput}
            onBlur={e => saveGoal(columnKey, e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') saveGoal(columnKey, e.target.value);
              if (e.key === 'Escape') setEditingGoal(null);
            }}
          />
        </span>
      );
    }

    if (!goal) {
      return (
        <span
          style={styles.goalCountOnly}
          onDoubleClick={() => setEditingGoal(columnKey)}
          title="Double-click to set goal"
        >{count}</span>
      );
    }

    const met = count >= goal;
    return (
      <span
        style={{ ...styles.goalFraction, color: met ? 'rgba(52,211,153,0.8)' : 'rgba(255,255,255,0.35)' }}
        title="Double-click goal to edit"
      >
        <span style={styles.goalCount}>{count}</span>
        <span style={styles.goalSlash}>/</span>
        <span
          style={styles.goalTarget}
          onDoubleClick={() => setEditingGoal(columnKey)}
        >{goal}</span>
      </span>
    );
  };

  const onRowEnter = (e, post) => {
    const r = e.currentTarget.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = r.right + 8;
    if (x + POPOVER_W > vw - 8) x = r.left - POPOVER_W - 8;
    if (x < 8) x = 8;
    let y = r.top;
    if (y + POPOVER_H_EST > vh - 8) y = vh - POPOVER_H_EST - 8;
    if (y < 8) y = 8;
    setHover({ post, x, y });
  };
  const onRowLeave = () => setHover(null);
  const onRowClick = (post) => { if (post.url) window.open(post.url, '_blank', 'noopener,noreferrer'); };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Tracking</h1>
        <p style={styles.subtitle}>Goal progress + all published posts by source.</p>
      </div>

      <GoalsSection />

      {/* ── Posts Section ── */}
      <div style={{ marginTop: 32 }}>
      {/* ── Month Filter ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => {
            const pm = postsMonth === 0 ? 11 : postsMonth - 1;
            const py = postsMonth === 0 ? postsYear - 1 : postsYear;
            setPostsMonth(pm); setPostsYear(py);
          }}
          style={{ ...styles.filterChip, padding: '6px 10px' }}
        >←</button>
        <select
          value={postsMonth}
          onChange={e => setPostsMonth(Number(e.target.value))}
          style={{ ...styles.filterSelect, ...styles.filterSelectActive }}
        >
          {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
        </select>
        <select
          value={postsYear}
          onChange={e => setPostsYear(Number(e.target.value))}
          style={{ ...styles.filterSelect, ...styles.filterSelectActive }}
        >
          {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <button
          onClick={() => {
            const pm = postsMonth === 11 ? 0 : postsMonth + 1;
            const py = postsMonth === 11 ? postsYear + 1 : postsYear;
            setPostsMonth(pm); setPostsYear(py);
          }}
          style={{ ...styles.filterChip, padding: '6px 10px' }}
        >→</button>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginLeft: 8 }}>
          {postsData.length} post{postsData.length !== 1 ? 's' : ''}
        </span>
      </div>

      {postsLoading ? (
        <p style={styles.loadingText}>Loading posts...</p>
      ) : (
        <div style={styles.postsGrid}>
          {POSTS_COLUMNS.map(col => {
            const colPosts = postsData.filter(p => p.platform_account_id === col.accountId);
            const yt = col.isYouTube ? ytSubCounts[col.key] : null;
            return (
              <div key={col.key} style={styles.postsColumn}>
                <div style={{ ...styles.postsColumnHeader, borderBottom: `2px solid ${col.color}` }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: col.color, marginRight: 6 }}>{col.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', flex: 1 }}>{col.label}</span>
                  {yt ? (
                    <div style={styles.ytSubCounts}>
                      <div style={styles.ytSubRow}>
                        <span style={styles.ytSubLabel}>Shorts</span>
                        <GoalDisplay columnKey={`${col.key}_shorts`} count={yt.shorts} />
                      </div>
                      <div style={styles.ytSubRow}>
                        <span style={styles.ytSubLabel}>Videos</span>
                        <GoalDisplay columnKey={`${col.key}_videos`} count={yt.videos} />
                      </div>
                    </div>
                  ) : (
                    <GoalDisplay columnKey={col.key} count={colPosts.length} />
                  )}
                </div>
                <div style={styles.postsColumnBody}>
                  <div style={styles.postsScrollable}>
                    {colPosts.length === 0 ? (
                      <div style={styles.emptyRow}>No posts</div>
                    ) : colPosts.map(post => {
                      const kind = col.isYouTube ? ytKind(post) : null;
                      return (
                        <div
                          key={post.id}
                          onMouseEnter={(e) => onRowEnter(e, post)}
                          onMouseLeave={onRowLeave}
                          onClick={() => onRowClick(post)}
                          style={styles.row}
                        >
                          <div style={styles.rowTitle} title={post.title || '(untitled)'}>
                            {post.title || '(untitled)'}
                          </div>
                          <div style={styles.rowMeta}>
                            <span style={styles.rowDate}>{shortDate(post.published_at)}</span>
                            {kind && (
                              <span style={{
                                ...styles.kindChip,
                                background: kind === 'Short' ? 'rgba(236,72,153,0.15)' : 'rgba(91, 143, 199,0.15)',
                                color: kind === 'Short' ? '#f9a8d4' : '#8fb4d8',
                                borderColor: kind === 'Short' ? 'rgba(236,72,153,0.35)' : 'rgba(91, 143, 199,0.35)',
                              }}>{kind}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {(upcomingByCol[col.key] || []).length > 0 && (
                    <div style={styles.upcomingSection}>
                      <div style={styles.upcomingDivider}>
                        <span style={styles.upcomingDividerLabel}>Upcoming</span>
                      </div>
                      {upcomingByCol[col.key].map(p => (
                        <div key={p.id} style={styles.upcomingRow}>
                          <div style={styles.upcomingTitle} title={p.title}>
                            {p.title}
                          </div>
                          <div style={styles.upcomingDate}>
                            {formatUpcomingDate(p.scheduledAt)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>

      <div style={{ marginTop: 32, display: 'flex', gap: 20 }}>
        <div style={{ flex: 4 }}>
          <ProgressKanban />
        </div>
        {isAdmin && initiativeTargets.ig_stories && initiativeDays && (() => {
          const goal = initiativeTargets.ig_stories;
          const today = initiativeDays[initiativeDays.length - 1];
          const todayPct = Math.min(100, Math.round((today.count / goal.daily_target) * 100));

          return (
            <div style={{ flex: 1 }}>
              <div style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '14px',
                padding: '20px 24px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                  <h2 style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Initiatives
                  </h2>
                  {initiativeLoading && (
                    <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)' }}>syncing...</span>
                  )}
                </div>

                {/* Goal row: label + editable target */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#e0e7ff' }}>IG Stories</span>
                  <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>daily goal:</span>
                  {goal.id != null && editingInitiativeTarget === goal.id ? (
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <input
                        type="number"
                        min="1"
                        value={initiativeTargetDraft}
                        onChange={e => setInitiativeTargetDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') updateInitiativeTarget(goal.id, initiativeTargetDraft); if (e.key === 'Escape') setEditingInitiativeTarget(null); }}
                        style={{
                          width: '48px', padding: '3px 6px', background: 'rgba(255,255,255,0.08)',
                          border: '1px solid rgba(255,255,255,0.2)', borderRadius: '5px',
                          color: '#fff', fontSize: '13px', fontFamily: 'inherit', textAlign: 'center', outline: 'none',
                        }}
                        autoFocus
                      />
                      <button
                        onClick={() => updateInitiativeTarget(goal.id, initiativeTargetDraft)}
                        style={{ padding: '3px 8px', background: colors.accent, border: 'none', borderRadius: '5px', color: colors.white, fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                      >Save</button>
                    </div>
                  ) : (
                    <span
                      onClick={() => { setEditingInitiativeTarget(goal.id); setInitiativeTargetDraft(String(goal.daily_target)); }}
                      style={{ fontSize: '14px', fontWeight: 700, color: colors.accentFg, cursor: 'pointer', borderBottom: '1px dashed rgba(165,180,252,0.3)' }}
                      title="Click to change"
                    >
                      {goal.daily_target}
                    </span>
                  )}
                </div>

                {/* Today's progress bar */}
                <div style={{ marginBottom: '18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
                    <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>Today</span>
                    <span style={{ fontSize: '12px', color: todayPct >= 100 ? '#22c55e' : 'rgba(255,255,255,0.5)', fontWeight: 600 }}>
                      {today.count}/{goal.daily_target}
                    </span>
                  </div>
                  <div style={{ height: '8px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${todayPct}%`,
                      background: todayPct >= 100 ? '#22c55e' : '#5b8fc7',
                      borderRadius: '4px',
                      transition: 'width 0.4s ease, background 0.3s ease',
                    }} />
                  </div>
                </div>

                {/* Last 7 days */}
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between' }}>
                  {initiativeDays.map(day => {
                    const pct = Math.min(100, Math.round((day.count / goal.daily_target) * 100));
                    const met = pct >= 100;
                    return (
                      <div key={day.dateStr} style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
                        <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginBottom: '6px', fontWeight: 500 }}>
                          {day.dayLabel}
                        </div>
                        <div style={{
                          height: '40px',
                          background: 'rgba(255,255,255,0.04)',
                          borderRadius: '6px',
                          overflow: 'hidden',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'flex-end',
                          border: met ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(255,255,255,0.04)',
                        }}>
                          <div style={{
                            height: `${pct}%`,
                            background: met ? '#22c55e' : 'rgba(91, 143, 199,0.5)',
                            borderRadius: '0 0 5px 5px',
                            transition: 'height 0.4s ease',
                            minHeight: day.count > 0 ? '4px' : '0',
                          }} />
                        </div>
                        <div style={{ marginTop: '4px', fontSize: '13px' }}>
                          {met ? (
                            <span style={{ color: '#22c55e' }}>&#10003;</span>
                          ) : (
                            <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '11px' }}>{day.count}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── Hover Popover (thumbnail + metrics) ── */}
      {hover && (
        <div
          style={{ ...styles.popover, left: hover.x, top: hover.y, width: POPOVER_W }}
        >
          {hover.post.thumbnail_url ? (
            <div style={styles.popoverThumb}>
              <img src={hover.post.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          ) : (
            <div style={{ ...styles.popoverThumb, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>
              No thumbnail
            </div>
          )}
          <div style={styles.popoverTitle}>{hover.post.title || '(untitled)'}</div>
          {(() => {
            const m = hover.post.latest_metrics?.[0];
            if (!m) return <div style={styles.popoverNoMetrics}>No metrics yet</div>;
            return (
              <div style={styles.popoverMetrics}>
                {[
                  { label: 'Views',    val: m.views },
                  { label: 'Likes',    val: m.likes },
                  { label: 'Comments', val: m.comments },
                  { label: 'Shares',   val: m.shares },
                ].map(s => (
                  <div key={s.label} style={styles.popoverStat}>
                    <div style={styles.popoverStatVal}>{formatCompact(s.val || 0)}</div>
                    <div style={styles.popoverStatLabel}>{s.label}</div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────

const styles = {
  page: { padding: '36px 40px 64px', maxWidth: '1500px', margin: '0 auto', minHeight: '100vh' },
  header: { marginBottom: 20 },
  title: { fontSize: 22, fontWeight: 700, color: '#fff', margin: 0 },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: '4px 0 0' },

  filterChip: { padding: '6px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' },
  filterSelect: { padding: '6px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', outline: 'none', appearance: 'none', WebkitAppearance: 'none', paddingRight: '10px' },
  filterSelectActive: { background: colors.accentA15, borderColor: colors.accentA40, color: colors.accentFg },

  loadingText: { padding: '40px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '14px' },

  postsGrid: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, minHeight: 400 },
  postsColumn: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  postsColumnHeader: { padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 4 },
  postsColumnBody: { flex: 1, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '0 0 10px 10px', padding: 4, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 220px)' },
  postsScrollable: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, minHeight: 0 },

  row: { padding: '6px 8px', borderRadius: 6, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2, transition: 'background 0.12s' },
  rowTitle: { fontSize: 12, color: 'rgba(255,255,255,0.85)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', whiteSpace: 'nowrap' },
  rowMeta: { display: 'flex', alignItems: 'center', gap: 6 },
  rowDate: { fontSize: 10, color: 'rgba(255,255,255,0.35)', fontWeight: 500 },
  kindChip: { fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, border: '1px solid', letterSpacing: 0.3, textTransform: 'uppercase' },
  emptyRow: { padding: 12, textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 11 },

  popover: { position: 'fixed', zIndex: 1000, background: colors.bgHover, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.5)', pointerEvents: 'none' }, // style-lint-ignore
  popoverThumb: { width: '100%', height: 130, borderRadius: 6, overflow: 'hidden', marginBottom: 8, background: 'rgba(0,0,0,0.3)' },
  popoverTitle: { fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 8, lineHeight: 1.3 },
  popoverMetrics: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 },
  popoverStat: { background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: '6px 4px', textAlign: 'center' },
  popoverStatVal: { fontSize: 12, fontWeight: 700, color: '#fff' },
  popoverStatLabel: { fontSize: 8, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 1 },
  popoverNoMetrics: { fontSize: 11, color: 'rgba(255,255,255,0.35)', textAlign: 'center', padding: '4px 0' },

  ytSubCounts: { display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' },
  ytSubRow: { display: 'flex', alignItems: 'center', gap: 4 },
  ytSubLabel: { fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 },

  goalFraction: { display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.35)' },
  goalCount: { },
  goalSlash: { margin: '0 1px', opacity: 0.5 },
  goalTarget: { cursor: 'pointer', borderBottom: '1px dashed rgba(255,255,255,0.15)', lineHeight: 1 },
  goalCountOnly: { fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 600, cursor: 'pointer', borderBottom: '1px dashed transparent' },
  goalInput: { width: 28, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 3, color: '#fff', fontSize: 11, fontWeight: 600, padding: '1px 3px', outline: 'none', fontFamily: 'inherit', textAlign: 'center' },

  upcomingSection: { flexShrink: 0, padding: '0 4px 4px' },
  upcomingDivider: { borderTop: '1px solid rgba(255,255,255,0.08)', margin: '4px 0 6px', paddingTop: 6, display: 'flex', alignItems: 'center' },
  upcomingDividerLabel: { fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: 0.5 },
  upcomingRow: { padding: '4px 4px', display: 'flex', flexDirection: 'column', gap: 1 },
  upcomingTitle: { fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  upcomingDate: { fontSize: 10, color: 'rgba(255,255,255,0.3)', fontWeight: 500 },
};
