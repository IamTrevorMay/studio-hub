// Mobile Tracking — read-only mirror of the desktop page. Two tabs:
// "Posts" shows monthly post counts vs goals per platform as stacked
// cards; "Progress" shows the production pipeline kanban as a simple
// sectioned list. Goal edits, drag-reorder and renames stay on desktop.

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { ptRangeToUtc, ptDayKey } from '../lib/ptDate';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import usePersistedTab from '../hooks/usePersistedTab';
import { mobileTokens, mobileTapButton } from '../utils/mobileTokens';
import { colors } from '../lib/styleTokens';

// Same source-of-truth columns as desktop Tracking.js.
const POSTS_COLUMNS = [
  { key: 'tiktok',    label: 'TikTok',              accountId: 'e6101720-f32c-45e1-8cc3-195864d0ae36', color: '#00F2EA', icon: 'TT', source: 'metricool',     network: 'TIKTOK' },
  { key: 'mm_yt',     label: 'More Mayday',         accountId: '4e7f34a3-acf8-4cae-9023-0bfa04280c14', color: '#FF0000', icon: 'YT', source: 'content_items', isYouTube: true },
  { key: 'tmb_yt',    label: 'Trevor May Baseball', accountId: '3b68a43a-4967-4b00-8572-296077721ebb', color: '#FF0000', icon: 'YT', source: 'content_items', isYouTube: true },
  { key: 'instagram', label: 'Instagram',           accountId: '4a960721-ef97-42c0-a1d4-222aa621ddc4', color: '#E4405F', icon: 'IG', source: 'metricool',     network: 'INSTAGRAM' },
  { key: 'facebook',  label: 'Facebook',            accountId: 'eb95b9c9-c78e-486a-b1a9-6991f5b030cd', color: '#1877F2', icon: 'FB', source: 'metricool',     network: 'FACEBOOK' },
  { key: 'substack',  label: 'Substack',            accountId: 'c46338e3-d923-43c7-a6ca-8dac8d53abf7', color: '#FF6719', icon: 'SS', source: 'content_items' },
];

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Pipeline sections mirror ProgressKanban's columns.
const PIPELINE_SECTIONS = [
  { key: 'write_film', label: 'Write & Film', color: 'rgba(168,85,247,0.15)', textColor: 'rgba(168,85,247,0.8)' },
  { key: 'editing',    label: 'Editing',      color: 'rgba(251,191,36,0.15)', textColor: 'rgba(251,191,36,0.8)' },
  { key: 'ready',      label: 'Ready',        color: 'rgba(96,165,250,0.15)', textColor: 'rgba(96,165,250,0.8)' },
  { key: 'scheduled',  label: 'Scheduled',    color: 'rgba(52,211,153,0.15)', textColor: 'rgba(52,211,153,0.8)' },
];
const NUMBERED_SECTIONS = new Set(['editing', 'ready']);

const CONTENT_TYPE_COLORS = {
  short: { bg: 'rgba(96,165,250,0.15)', text: 'rgba(96,165,250,0.9)' },
  long:  { bg: 'rgba(168,85,247,0.15)', text: 'rgba(168,85,247,0.9)' },
};

const TABS = ['Posts', 'Progress'];

// ─── Helpers (mirrors of Tracking.js / ProgressKanban.js) ────

function getMonthRange(year, month) {
  const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const end = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

// YouTube row chip: <=180s = Short, otherwise Video (same threshold note
// as desktop — DB content_type is unreliable).
function ytKind(post) {
  const d = Number(post.duration_seconds);
  if (Number.isFinite(d) && d > 0 && d <= 180) return 'Short';
  return 'Video';
}

function relativeTime(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function archiveCountdown(movedAt) {
  if (!movedAt) return null;
  const diff = 3 * 24 * 60 * 60 * 1000 - (Date.now() - new Date(movedAt).getTime());
  if (diff <= 0) return 'Archiving soon';
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
  return `Archiving in ${days}d`;
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

// ─── Component ───────────────────────────────────────────────

export default function TrackingMobile() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = usePersistedTab('tracking-tab-mobile', 'Posts', ['Posts', 'Progress']);

  // ── Posts state ──
  const [postsMonth, setPostsMonth] = useState(new Date().getMonth());
  const [postsYear, setPostsYear] = useState(new Date().getFullYear());
  const [postsData, setPostsData] = useState([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [goals, setGoals] = useState({});
  const postsGenRef = useRef(0);

  // ── Progress state ──
  const [cards, setCards] = useState([]);
  const [cardsLoading, setCardsLoading] = useState(true);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const fetchGoals = useCallback(async () => {
    const { data } = await supabase
      .from('tracking_post_goals')
      .select('column_key, goal')
      .eq('year', postsYear)
      .eq('month', postsMonth);
    if (!mountedRef.current) return;
    const map = {};
    (data || []).forEach(r => { map[r.column_key] = r.goal; });
    setGoals(map);
  }, [postsYear, postsMonth]);

  const fetchPosts = useCallback(async () => {
    const gen = ++postsGenRef.current;
    setPostsLoading(true);
    const { start, end } = getMonthRange(postsYear, postsMonth);
    const { startUtc, endUtc } = ptRangeToUtc(start, end);

    const ciIds = POSTS_COLUMNS.filter(c => c.source === 'content_items').map(c => c.accountId);
    const ciQuery = supabase
      .from('content_items')
      .select('id, published_at, duration_seconds, platform_account_id')
      .in('platform_account_id', ciIds)
      .gte('published_at', startUtc)
      .lt('published_at', endUtc)
      .order('published_at', { ascending: false });

    const { data: { session } } = await supabase.auth.getSession();
    const mcFetch = fetch(
      `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/metricool-posts?start=${start}&end=${end}`,
      { headers: { Authorization: `Bearer ${session?.access_token}`, apikey: process.env.REACT_APP_SUPABASE_ANON_KEY } },
    );

    const [ciData, mcRes] = await Promise.all([fetchAllRows(ciQuery), mcFetch.catch(() => null)]);
    if (!mountedRef.current || gen !== postsGenRef.current) return;

    let mcPosts = [];
    if (mcRes && mcRes.ok) {
      const mcJson = await mcRes.json();
      const networkToCol = {};
      POSTS_COLUMNS.filter(c => c.source === 'metricool').forEach(c => { networkToCol[c.network] = c.accountId; });
      // extendedRange=true makes Metricool return posts past the window edge,
      // which would otherwise be counted in the neighbouring month.
      mcPosts = (mcJson.posts || [])
        .filter(p => p.status === 'PUBLISHED' && networkToCol[p.network])
        .filter(p => {
          if (!p.publicationDate) return false;
          const day = ptDayKey(p.publicationDate);
          return day >= start && day <= end;
        })
        .map(p => ({ id: `mc_${p.id}`, duration_seconds: null, platform_account_id: networkToCol[p.network] }));
    }
    if (gen !== postsGenRef.current) return;

    setPostsData([...(ciData || []), ...mcPosts]);
    setPostsLoading(false);
  }, [postsMonth, postsYear]);

  const fetchCards = useCallback(async () => {
    const { data, error } = await supabase
      .from('progress_cards')
      .select('*')
      .is('archived_at', null)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (!mountedRef.current) return;
    if (!error) setCards(data || []);
    setCardsLoading(false);
  }, []);

  const fetchAll = useCallback(() => { fetchGoals(); fetchPosts(); fetchCards(); }, [fetchGoals, fetchPosts, fetchCards]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useVisibilityRefresh(fetchAll);

  // Per-column counts + YouTube shorts/videos split
  const columnCounts = useMemo(() => {
    const out = {};
    for (const col of POSTS_COLUMNS) {
      const colPosts = postsData.filter(p => p.platform_account_id === col.accountId);
      if (col.isYouTube) {
        out[col.key] = {
          shorts: colPosts.filter(p => ytKind(p) === 'Short').length,
          videos: colPosts.filter(p => ytKind(p) === 'Video').length,
        };
      } else {
        out[col.key] = { total: colPosts.length };
      }
    }
    return out;
  }, [postsData]);

  const groupedCards = useMemo(() => {
    const out = {};
    for (const s of PIPELINE_SECTIONS) out[s.key] = [];
    for (const card of cards) {
      if (out[card.status]) out[card.status].push(card);
    }
    return out;
  }, [cards]);

  function prevMonth() {
    setPostsMonth(m => (m === 0 ? 11 : m - 1));
    if (postsMonth === 0) setPostsYear(y => y - 1);
  }
  function nextMonth() {
    setPostsMonth(m => (m === 11 ? 0 : m + 1));
    if (postsMonth === 11) setPostsYear(y => y + 1);
  }

  if (!isAdmin) return <div style={styles.empty}>Admin access required.</div>;

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <h1 style={styles.title}>Tracking</h1>
        <button onClick={fetchAll} style={styles.refreshBtn}>↻</button>
      </div>

      <div style={styles.tabs}>
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{ ...styles.tab, ...(t === tab ? styles.tabActive : {}) }}
          >
            {t}
          </button>
        ))}
      </div>

      <div style={styles.pane}>
        {tab === 'Posts' ? (
          <>
            <div style={styles.monthRow}>
              <button onClick={prevMonth} style={styles.monthBtn}>←</button>
              <span style={styles.monthLabel}>{MONTHS[postsMonth]} {postsYear}</span>
              <button onClick={nextMonth} style={styles.monthBtn}>→</button>
            </div>
            {postsLoading ? (
              <div style={styles.empty}>Loading posts…</div>
            ) : (
              <div style={styles.list}>
                {POSTS_COLUMNS.map(col => {
                  const counts = columnCounts[col.key] || {};
                  const rows = col.isYouTube
                    ? [
                        { label: 'Shorts', count: counts.shorts || 0, goal: goals[`${col.key}_shorts`] },
                        { label: 'Videos', count: counts.videos || 0, goal: goals[`${col.key}_videos`] },
                      ]
                    : [{ label: null, count: counts.total || 0, goal: goals[col.key] }];
                  return (
                    <div key={col.key} style={{ ...styles.platformCard, borderLeft: `3px solid ${col.color}` }}>
                      <div style={styles.platformHeader}>
                        <span style={{ ...styles.platformIcon, color: col.color }}>{col.icon}</span>
                        <span style={styles.platformLabel}>{col.label}</span>
                      </div>
                      {rows.map(row => <GoalRow key={row.label || 'total'} {...row} />)}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : cardsLoading ? (
          <div style={styles.empty}>Loading pipeline…</div>
        ) : (
          <div style={styles.list}>
            {PIPELINE_SECTIONS.map(section => {
              const items = groupedCards[section.key];
              const numbered = NUMBERED_SECTIONS.has(section.key);
              return (
                <div key={section.key}>
                  <div style={{ ...styles.sectionHeader, background: section.color }}>
                    <span style={{ ...styles.sectionLabel, color: section.textColor }}>{section.label}</span>
                    <span style={{ ...styles.sectionCount, color: section.textColor }}>{items.length}</span>
                  </div>
                  <div style={styles.sectionBody}>
                    {items.length === 0 ? (
                      <div style={styles.emptySection}>No items</div>
                    ) : items.map((card, i) => (
                      <div key={card.id} style={styles.card}>
                        <div style={styles.cardTitle}>{card.title}</div>
                        <div style={styles.cardMeta}>
                          {numbered && <span style={styles.priorityBadge}>#{i + 1}</span>}
                          <span style={{
                            ...styles.typeBadge,
                            background: CONTENT_TYPE_COLORS[card.content_type]?.bg,
                            color: CONTENT_TYPE_COLORS[card.content_type]?.text,
                          }}>
                            {card.content_type === 'short' ? 'Short' : 'Long'}
                          </span>
                          <span style={styles.timeAgo}>{relativeTime(card.created_at)}</span>
                        </div>
                        {card.status === 'scheduled' && card.moved_to_scheduled_at && (
                          <div style={styles.archiveNote}>{archiveCountdown(card.moved_to_scheduled_at)}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Count vs goal row with progress bar. Goal-less rows show count only.
function GoalRow({ label, count, goal }) {
  const met = goal ? count >= goal : false;
  const pct = goal ? Math.min(100, Math.round((count / goal) * 100)) : 0;
  return (
    <div style={styles.goalRow}>
      <div style={styles.goalRowTop}>
        <span style={styles.goalRowLabel}>{label || 'Posts'}</span>
        <span style={{ ...styles.goalRowCount, color: met ? '#22c55e' : 'rgba(255,255,255,0.7)' }}>
          {count}{goal ? `/${goal}` : ''}
          {met && <span style={{ marginLeft: 4 }}>✓</span>}
        </span>
      </div>
      {goal ? (
        <div style={styles.goalBar}>
          <div style={{ ...styles.goalBarFill, width: `${pct}%`, background: met ? '#22c55e' : '#5b8fc7' }} />
        </div>
      ) : null}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const styles = {
  root: { display: 'flex', flexDirection: 'column', minHeight: '100%', background: colors.bg, color: colors.textBright },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px`,
  },
  title: { margin: 0, fontSize: mobileTokens.font.xl, fontWeight: 800, color: '#fff', letterSpacing: '-0.3px' },
  refreshBtn: {
    ...mobileTapButton, width: 38, height: 38,
    background: colors.accentA15, border: '1px solid rgba(91, 143, 199,0.3)',
    borderRadius: mobileTokens.radius.md, color: colors.accentFg,
    fontSize: 18, lineHeight: 1, fontFamily: 'inherit',
  },
  tabs: { display: 'flex', gap: 6, padding: `0 ${mobileTokens.space.lg}px ${mobileTokens.space.sm}px` },
  tab: {
    flex: 1, ...mobileTapButton, minHeight: 36,
    padding: '8px 12px', borderRadius: mobileTokens.radius.pill,
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.55)', fontSize: mobileTokens.font.sm, fontWeight: 600,
  },
  tabActive: { background: colors.accentSoft, color: colors.accentFg, border: '1px solid rgba(91, 143, 199,0.3)' },
  pane: { flex: 1, minHeight: 0, padding: `0 ${mobileTokens.space.lg}px ${mobileTokens.space.xxxl}px` },

  monthRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: mobileTokens.space.md, padding: `${mobileTokens.space.sm}px 0` },
  monthBtn: {
    ...mobileTapButton, width: 40, height: 36,
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: mobileTokens.radius.pill, color: 'rgba(255,255,255,0.55)', fontSize: mobileTokens.font.md,
  },
  monthLabel: { fontSize: mobileTokens.font.md, fontWeight: 700, color: colors.accentFg, minWidth: 90, textAlign: 'center' },

  list: { display: 'flex', flexDirection: 'column', gap: 10 },
  platformCard: {
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: mobileTokens.radius.md, padding: mobileTokens.space.md,
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  platformHeader: { display: 'flex', alignItems: 'center', gap: 6 },
  platformIcon: { fontSize: 11, fontWeight: 700 },
  platformLabel: { fontSize: mobileTokens.font.md, fontWeight: 700, color: '#fff' },
  goalRow: { display: 'flex', flexDirection: 'column', gap: 4 },
  goalRowTop: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' },
  goalRowLabel: { fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  goalRowCount: { fontSize: mobileTokens.font.sm, fontWeight: 700 },
  goalBar: { height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' },
  goalBarFill: { height: '100%', borderRadius: 3, transition: 'width 0.4s ease, background 0.3s ease' },

  sectionHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 12px', borderRadius: '8px 8px 0 0',
  },
  sectionLabel: { fontSize: mobileTokens.font.xs, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' },
  sectionCount: { fontSize: 11, fontWeight: 600, opacity: 0.7 },
  sectionBody: {
    background: 'rgba(255,255,255,0.02)', borderRadius: '0 0 8px 8px',
    border: '1px solid rgba(255,255,255,0.06)', borderTop: 'none',
    padding: mobileTokens.space.sm, display: 'flex', flexDirection: 'column', gap: 6,
  },
  emptySection: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 40,
    border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 6,
    color: 'rgba(255,255,255,0.2)', fontSize: mobileTokens.font.xs,
  },
  card: {
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 6, padding: '10px 12px',
  },
  cardTitle: {
    fontSize: mobileTokens.font.sm, fontWeight: 600, color: 'rgba(255,255,255,0.9)', lineHeight: 1.35,
    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
  },
  cardMeta: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 },
  priorityBadge: {
    fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
    background: colors.accentA20, color: colors.accentFg, letterSpacing: '0.3px',
  },
  typeBadge: { fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.3px' },
  timeAgo: { fontSize: 11, color: 'rgba(255,255,255,0.3)' },
  archiveNote: { marginTop: 6, fontSize: 11, color: 'rgba(52,211,153,0.6)', fontStyle: 'italic' },

  empty: { padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: mobileTokens.font.md },
};
