// Tracking — admin view of every post published in a given month,
// grouped by source (TikTok / More Mayday / TMB / Instagram / Facebook / Substack).
// Compact row list per column. Hover reveals thumbnail + metrics.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient';

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
  const [postsMonth, setPostsMonth] = useState(new Date().getMonth());
  const [postsYear, setPostsYear] = useState(new Date().getFullYear());
  const [postsData, setPostsData] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [hover, setHover] = useState(null); // { post, x, y }
  const postsGenRef = useRef(0);

  const fetchPosts = useCallback(async () => {
    const gen = ++postsGenRef.current;
    setPostsLoading(true);
    const { start, end } = getMonthRange(postsYear, postsMonth);

    const ciIds = POSTS_COLUMNS.filter(c => c.source === 'content_items').map(c => c.accountId);
    const ciQuery = supabase
      .from('content_items')
      .select('id, title, published_at, url, content_type, thumbnail_url, description, duration_seconds, platform_account_id, platform_account:platform_accounts(platform, account_name), latest_metrics:content_metrics(views, likes, comments, shares, engagement_rate)')
      .in('platform_account_id', ciIds)
      .gte('published_at', start)
      .lte('published_at', end + 'T23:59:59.999')
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
      mcPosts = (mcJson.posts || [])
        .filter(p => p.status === 'PUBLISHED' && networkToCol[p.network])
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
        <p style={styles.subtitle}>All published posts by source for the selected month.</p>
      </div>

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
            return (
              <div key={col.key} style={styles.postsColumn}>
                <div style={{ ...styles.postsColumnHeader, borderBottom: `2px solid ${col.color}` }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: col.color, marginRight: 6 }}>{col.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', flex: 1 }}>{col.label}</span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 600 }}>{colPosts.length}</span>
                </div>
                <div style={styles.postsColumnBody}>
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
                              background: kind === 'Short' ? 'rgba(236,72,153,0.15)' : 'rgba(99,102,241,0.15)',
                              color: kind === 'Short' ? '#f9a8d4' : '#a5b4fc',
                              borderColor: kind === 'Short' ? 'rgba(236,72,153,0.35)' : 'rgba(99,102,241,0.35)',
                            }}>{kind}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

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
  page: { padding: '24px 32px', minHeight: '100vh' },
  header: { marginBottom: 20 },
  title: { fontSize: 22, fontWeight: 700, color: '#fff', margin: 0 },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: '4px 0 0' },

  filterChip: { padding: '6px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' },
  filterSelect: { padding: '6px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', outline: 'none', appearance: 'none', WebkitAppearance: 'none', paddingRight: '10px' },
  filterSelectActive: { background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.4)', color: '#a5b4fc' },

  loadingText: { padding: '40px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '14px' },

  postsGrid: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, minHeight: 400 },
  postsColumn: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  postsColumnHeader: { padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 4 },
  postsColumnBody: { flex: 1, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '0 0 10px 10px', padding: 4, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', maxHeight: 'calc(100vh - 220px)' },

  row: { padding: '6px 8px', borderRadius: 6, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2, transition: 'background 0.12s' },
  rowTitle: { fontSize: 12, color: 'rgba(255,255,255,0.85)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', whiteSpace: 'nowrap' },
  rowMeta: { display: 'flex', alignItems: 'center', gap: 6 },
  rowDate: { fontSize: 10, color: 'rgba(255,255,255,0.35)', fontWeight: 500 },
  kindChip: { fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, border: '1px solid', letterSpacing: 0.3, textTransform: 'uppercase' },
  emptyRow: { padding: 12, textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 11 },

  popover: { position: 'fixed', zIndex: 1000, background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.5)', pointerEvents: 'none' },
  popoverThumb: { width: '100%', height: 130, borderRadius: 6, overflow: 'hidden', marginBottom: 8, background: 'rgba(0,0,0,0.3)' },
  popoverTitle: { fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 8, lineHeight: 1.3 },
  popoverMetrics: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 },
  popoverStat: { background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: '6px 4px', textAlign: 'center' },
  popoverStatVal: { fontSize: 12, fontWeight: 700, color: '#fff' },
  popoverStatLabel: { fontSize: 8, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 1 },
  popoverNoMetrics: { fontSize: 11, color: 'rgba(255,255,255,0.35)', textAlign: 'center', padding: '4px 0' },
};
