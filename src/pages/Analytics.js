import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';

// ═══════════════════════════════════════════════
// Platform Definitions
// ═══════════════════════════════════════════════
const PLATFORMS = [
  { key: 'youtube_trevormay', label: 'Trevor May Baseball', icon: '🎬', color: '#ff0000', table: 'analytics_youtube', channel: 'trevormay' },
  { key: 'youtube_moremayday', label: 'More Mayday', icon: '🎬', color: '#ff4444', table: 'analytics_youtube', channel: 'moremayday' },
  { key: 'tiktok', label: 'IamTrevorMay TikTok', icon: '🎵', color: '#00f2ea', table: 'analytics_tiktok' },
  { key: 'facebook', label: 'Trevor May Facebook', icon: '📘', color: '#1877f2', table: 'analytics_facebook' },
  { key: 'instagram', label: 'trevmay65 Instagram', icon: '📸', color: '#e4405f', table: 'analytics_instagram' },
  { key: 'substack', label: 'Mayday Substack', icon: '📰', color: '#ff6719', table: 'analytics_substack' },
];

// Column definitions per platform — ordered logically
const PLATFORM_COLUMNS = {
  youtube: [
    { key: 'video_title', label: 'Video', type: 'text', sticky: true },
    { key: 'publish_date', label: 'Published', type: 'date' },
    { key: 'views', label: 'Views', type: 'number' },
    { key: 'engaged_views', label: 'Engaged views', type: 'number' },
    { key: 'impressions', label: 'Impressions', type: 'number' },
    { key: 'impressions_ctr', label: 'CTR (%)', type: 'percent' },
    { key: 'watch_time_hours', label: 'Watch time (hrs)', type: 'decimal' },
    { key: 'average_view_duration_seconds', label: 'Avg view duration', type: 'duration' },
    { key: 'average_percentage_viewed', label: 'Avg % viewed', type: 'percent' },
    { key: 'stayed_to_watch_pct', label: 'Stayed to watch (%)', type: 'percent' },
    { key: 'subscribers', label: 'Subscribers', type: 'number' },
    { key: 'post_subscribers', label: 'Post subs', type: 'number' },
    { key: 'estimated_revenue', label: 'Revenue ($)', type: 'currency' },
    { key: 'ad_revenue', label: 'Ad revenue ($)', type: 'currency' },
    { key: 'adsense_revenue', label: 'AdSense ($)', type: 'currency' },
    { key: 'watch_page_ads_revenue', label: 'Watch page ads ($)', type: 'currency' },
    { key: 'youtube_premium_revenue', label: 'Premium ($)', type: 'currency' },
    { key: 'ad_impressions', label: 'Ad impressions', type: 'number' },
    { key: 'cpm', label: 'CPM ($)', type: 'currency' },
    { key: 'rpm', label: 'RPM ($)', type: 'currency' },
    { key: 'youtube_premium_views', label: 'Premium views', type: 'number' },
    { key: 'duration_seconds', label: 'Duration', type: 'duration' },
  ],
  tiktok: [
    { key: 'post_title', label: 'Post', type: 'text', sticky: true },
    { key: 'publish_date', label: 'Published', type: 'date' },
    { key: 'views', label: 'Views', type: 'number' },
    { key: 'likes', label: 'Likes', type: 'number' },
    { key: 'comments', label: 'Comments', type: 'number' },
    { key: 'shares', label: 'Shares', type: 'number' },
    { key: 'saves', label: 'Saves', type: 'number' },
    { key: 'reach', label: 'Reach', type: 'number' },
    { key: 'impressions', label: 'Impressions', type: 'number' },
    { key: 'engagement_rate', label: 'Eng. rate (%)', type: 'percent' },
    { key: 'average_watch_time_seconds', label: 'Avg watch time', type: 'duration' },
    { key: 'watched_full_video_pct', label: 'Watched full (%)', type: 'percent' },
    { key: 'followers_gained', label: 'Followers gained', type: 'number' },
    { key: 'profile_views', label: 'Profile views', type: 'number' },
    { key: 'duration_seconds', label: 'Duration', type: 'duration' },
  ],
  facebook: [
    { key: 'post_title', label: 'Post', type: 'text', sticky: true },
    { key: 'publish_date', label: 'Published', type: 'date' },
    { key: 'post_type', label: 'Type', type: 'text' },
    { key: 'reach', label: 'Reach', type: 'number' },
    { key: 'impressions', label: 'Impressions', type: 'number' },
    { key: 'engaged_users', label: 'Engaged users', type: 'number' },
    { key: 'reactions', label: 'Reactions', type: 'number' },
    { key: 'comments', label: 'Comments', type: 'number' },
    { key: 'shares', label: 'Shares', type: 'number' },
    { key: 'clicks', label: 'Clicks', type: 'number' },
    { key: 'engagement_rate', label: 'Eng. rate (%)', type: 'percent' },
    { key: 'video_views', label: 'Video views', type: 'number' },
    { key: 'video_views_10s', label: '10s views', type: 'number' },
    { key: 'average_watch_time_seconds', label: 'Avg watch time', type: 'duration' },
    { key: 'page_followers', label: 'Page followers', type: 'number' },
    { key: 'page_likes', label: 'Page likes', type: 'number' },
  ],
  instagram: [
    { key: 'post_title', label: 'Post', type: 'text', sticky: true },
    { key: 'publish_date', label: 'Published', type: 'date' },
    { key: 'post_type', label: 'Type', type: 'text' },
    { key: 'reach', label: 'Reach', type: 'number' },
    { key: 'impressions', label: 'Impressions', type: 'number' },
    { key: 'likes', label: 'Likes', type: 'number' },
    { key: 'comments', label: 'Comments', type: 'number' },
    { key: 'shares', label: 'Shares', type: 'number' },
    { key: 'saves', label: 'Saves', type: 'number' },
    { key: 'engagement_rate', label: 'Eng. rate (%)', type: 'percent' },
    { key: 'plays', label: 'Plays', type: 'number' },
    { key: 'average_watch_time_seconds', label: 'Avg watch time', type: 'duration' },
    { key: 'followers_gained', label: 'Followers gained', type: 'number' },
    { key: 'profile_visits', label: 'Profile visits', type: 'number' },
  ],
  substack: [
    { key: 'post_title', label: 'Post', type: 'text', sticky: true },
    { key: 'publish_date', label: 'Published', type: 'date' },
    { key: 'total_sends', label: 'Sends', type: 'number' },
    { key: 'opens', label: 'Opens', type: 'number' },
    { key: 'open_rate', label: 'Open rate (%)', type: 'percent' },
    { key: 'clicks', label: 'Clicks', type: 'number' },
    { key: 'click_rate', label: 'Click rate (%)', type: 'percent' },
    { key: 'likes', label: 'Likes', type: 'number' },
    { key: 'comments', label: 'Comments', type: 'number' },
    { key: 'restacks', label: 'Restacks', type: 'number' },
    { key: 'new_subscribers', label: 'New subs', type: 'number' },
    { key: 'unsubscribes', label: 'Unsubs', type: 'number' },
    { key: 'total_subscribers', label: 'Total subs', type: 'number' },
  ],
};

function getColumns(platformKey) {
  if (platformKey.startsWith('youtube_')) return PLATFORM_COLUMNS.youtube;
  return PLATFORM_COLUMNS[platformKey] || [];
}

// ═══════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════
export default function Analytics() {
  const { profile } = useAuth();
  const [activePlatform, setActivePlatform] = useState(PLATFORMS[0].key);
  const [platformCounts, setPlatformCounts] = useState({});

  useEffect(() => { fetchCounts(); }, []);

  async function fetchCounts() {
    const counts = {};
    for (const p of PLATFORMS) {
      let query = supabase.from(p.table).select('id', { count: 'exact', head: true });
      if (p.channel) query = query.eq('channel', p.channel);
      const { count } = await query;
      counts[p.key] = count || 0;
    }
    setPlatformCounts(counts);
  }

  const platform = PLATFORMS.find(p => p.key === activePlatform);

  return (
    <div style={styles.page}>
      <div style={styles.topBar}>
        <div>
          <h1 style={styles.pageTitle}>Analytics</h1>
          <p style={styles.pageSubtitle}>Performance data across all platforms</p>
        </div>
      </div>

      {/* Platform Tabs */}
      <div style={styles.tabBar}>
        {PLATFORMS.map(p => (
          <button
            key={p.key}
            onClick={() => setActivePlatform(p.key)}
            style={{
              ...styles.tab,
              ...(activePlatform === p.key ? { ...styles.tabActive, borderBottomColor: p.color } : {}),
            }}
          >
            <span style={{ fontSize: '16px' }}>{p.icon}</span>
            <span>{p.label}</span>
            {(platformCounts[p.key] || 0) > 0 && (
              <span style={{ ...styles.tabBadge, background: p.color + '22', color: p.color }}>
                {platformCounts[p.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      <PlatformView platform={platform} profile={profile} onDataChanged={fetchCounts} />
    </div>
  );
}

// ═══════════════════════════════════════════════
// Platform View (chart + table + upload)
// ═══════════════════════════════════════════════
function PlatformView({ platform, profile, onDataChanged }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [sortCol, setSortCol] = useState('views');
  const [sortDir, setSortDir] = useState('desc');
  const [chartMetric, setChartMetric] = useState(null);
  const [selectedRows, setSelectedRows] = useState(new Set());
  const fileInputRef = useRef(null);
  const columns = getColumns(platform.key);

  useEffect(() => {
    setSelectedRows(new Set());
    setUploadResult(null);
    const numCols = columns.filter(c => c.type !== 'text' && c.type !== 'date' && !c.sticky);
    setChartMetric(numCols[0]?.key || null);
    setSortCol(platform.key.startsWith('youtube_') ? 'views' : columns.find(c => c.type === 'number')?.key || 'publish_date');
    setSortDir('desc');
    fetchData();
  }, [platform.key]);

  async function fetchData() {
    setLoading(true);
    let query = supabase.from(platform.table).select('*');
    if (platform.channel) query = query.eq('channel', platform.channel);
    query = query.order('publish_date', { ascending: false, nullsFirst: false }).limit(500);
    const { data: rows } = await query;
    setData(rows || []);
    setLoading(false);
  }

  // Sort data
  const sortedData = useMemo(() => {
    if (!data.length) return [];
    return [...data].sort((a, b) => {
      let va = a[sortCol], vb = b[sortCol];
      if (va === null || va === undefined) va = sortDir === 'asc' ? Infinity : -Infinity;
      if (vb === null || vb === undefined) vb = sortDir === 'asc' ? Infinity : -Infinity;
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }, [data, sortCol, sortDir]);

  // Chart data — top 20 by current sort, or selected rows
  const chartData = useMemo(() => {
    if (!chartMetric || !data.length) return [];
    const source = selectedRows.size > 0
      ? data.filter(r => selectedRows.has(r.id))
      : sortedData.slice(0, 20);
    return source
      .filter(r => r[chartMetric] != null)
      .map(r => ({
        label: truncate(r.video_title || r.post_title || 'Untitled', 30),
        value: Number(r[chartMetric]) || 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [chartMetric, data, sortedData, selectedRows]);

  // Summary row (totals/averages)
  const summaryRow = useMemo(() => {
    if (!data.length) return null;
    const row = {};
    const numCols = columns.filter(c => ['number', 'decimal', 'currency'].includes(c.type));
    const avgCols = columns.filter(c => c.type === 'percent' || c.type === 'duration');
    numCols.forEach(c => {
      row[c.key] = data.reduce((sum, r) => sum + (Number(r[c.key]) || 0), 0);
    });
    avgCols.forEach(c => {
      const vals = data.filter(r => r[c.key] != null).map(r => Number(r[c.key]));
      row[c.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });
    return row;
  }, [data, columns]);

  const metricColumns = columns.filter(c => c.type !== 'text' && c.type !== 'date' && !c.sticky);

  function toggleRow(id) {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  }

  // ── CSV Upload ──
  async function handleCSVUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      if (parsed.rows.length === 0) throw new Error('No data rows found');

      const { rows, dateRange } = mapCSVToPlatform(platform, parsed, profile.id);
      if (rows.length === 0) throw new Error('Could not parse any valid rows. Check CSV format.');

      let inserted = 0;
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const conflictKey = platform.key.startsWith('youtube_') ? 'channel,video_id' :
          platform.key === 'substack' ? 'post_title' : 'post_id';
        const { data: result, error } = await supabase.from(platform.table)
          .upsert(batch, { onConflict: conflictKey })
          .select();
        if (error) { console.error('Batch error:', error); continue; }
        inserted += result?.length || 0;
      }

      await supabase.from('analytics_uploads').insert({
        platform: platform.key,
        filename: file.name,
        row_count: inserted,
        date_range_start: dateRange.start,
        date_range_end: dateRange.end,
        uploaded_by: profile.id,
      });

      setUploadResult({ success: true, count: inserted });
      fetchData();
      onDataChanged();
    } catch (err) {
      console.error(err);
      setUploadResult({ error: err.message });
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div>
      {/* Upload bar */}
      <div style={{ ...styles.uploadBar, borderLeftColor: platform.color }}>
        <div style={styles.uploadBarLeft}>
          <span style={{ fontSize: '20px' }}>{platform.icon}</span>
          <div>
            <div style={styles.uploadBarTitle}>{platform.label}</div>
            <div style={styles.uploadBarSub}>{data.length} items loaded</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {uploadResult && (
            <span style={{
              fontSize: '13px', fontWeight: 500,
              color: uploadResult.error ? '#f87171' : '#4ade80',
            }}>
              {uploadResult.error ? `❌ ${uploadResult.error}` : `✅ ${uploadResult.count} rows imported`}
            </span>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{ ...styles.uploadBtn, borderColor: platform.color + '66', color: platform.color }}
            disabled={uploading}
          >
            {uploading ? '⏳ Processing...' : '📄 Upload CSV'}
          </button>
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCSVUpload} style={{ display: 'none' }} />
        </div>
      </div>

      {loading ? (
        <p style={styles.loadingText}>Loading data...</p>
      ) : data.length === 0 ? (
        <div style={styles.emptyCard}>
          <h3 style={styles.emptyTitle}>No data yet for {platform.label}</h3>
          <p style={styles.emptyText}>Upload a CSV export to get started.</p>
          <CSVGuide platform={platform} />
        </div>
      ) : (
        <>
          {/* ── Chart ── */}
          <div style={styles.chartSection}>
            <div style={styles.chartHeader}>
              <select
                value={chartMetric || ''}
                onChange={e => setChartMetric(e.target.value)}
                style={styles.chartSelect}
              >
                {metricColumns.map(c => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
              {selectedRows.size > 0 && (
                <button onClick={() => setSelectedRows(new Set())} style={styles.clearSelBtn}>
                  Clear selection ({selectedRows.size})
                </button>
              )}
            </div>
            <BarChart data={chartData} color={platform.color} />
          </div>

          {/* ── Data Table ── */}
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={{ ...styles.th, width: '36px', position: 'sticky', left: 0, zIndex: 3, background: '#16162a' }}></th>
                  {columns.map(col => (
                    <th
                      key={col.key}
                      style={{
                        ...styles.th,
                        cursor: 'pointer',
                        ...(col.sticky ? styles.thSticky : {}),
                        ...(col.type !== 'text' ? { textAlign: 'right' } : {}),
                      }}
                      onClick={() => handleSort(col.key)}
                    >
                      {col.label}
                      {sortCol === col.key && <span style={{ marginLeft: '4px', color: '#a5b4fc' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Summary row */}
                {summaryRow && (
                  <tr style={styles.summaryRow}>
                    <td style={{ ...styles.td, position: 'sticky', left: 0, background: '#1a1a30', zIndex: 2 }}></td>
                    {columns.map(col => (
                      <td key={col.key} style={{
                        ...styles.td, ...styles.summaryCell,
                        ...(col.sticky ? { ...styles.tdSticky, background: '#1a1a30' } : {}),
                        ...(col.type !== 'text' ? { textAlign: 'right' } : {}),
                      }}>
                        {col.sticky ? `Total (${data.length})` :
                         col.type === 'date' ? '' :
                         col.type === 'text' ? '' :
                         formatCell(summaryRow[col.key], col.type)}
                      </td>
                    ))}
                  </tr>
                )}
                {/* Data rows */}
                {sortedData.map((row, i) => (
                  <tr key={row.id} style={{
                    ...(i % 2 === 0 ? styles.trEven : {}),
                    ...(selectedRows.has(row.id) ? styles.trSelected : {}),
                  }}>
                    <td style={{ ...styles.td, position: 'sticky', left: 0, background: selectedRows.has(row.id) ? 'rgba(99,102,241,0.08)' : (i % 2 === 0 ? 'rgba(255,255,255,0.01)' : '#12121f'), zIndex: 2 }}>
                      <input
                        type="checkbox"
                        checked={selectedRows.has(row.id)}
                        onChange={() => toggleRow(row.id)}
                        style={styles.checkbox}
                      />
                    </td>
                    {columns.map(col => (
                      <td key={col.key} style={{
                        ...styles.td,
                        ...(col.sticky ? { ...styles.tdSticky, background: selectedRows.has(row.id) ? 'rgba(99,102,241,0.08)' : (i % 2 === 0 ? 'rgba(255,255,255,0.01)' : '#12121f') } : {}),
                        ...(col.type !== 'text' && col.type !== 'date' ? styles.tdValue : {}),
                        ...(col.type !== 'text' ? { textAlign: 'right' } : {}),
                      }}>
                        {formatCell(row[col.key], col.type)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {data.length >= 500 && (
              <p style={styles.limitNote}>Showing first 500 items</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// Bar Chart (pure CSS, no library)
// ═══════════════════════════════════════════════
function BarChart({ data, color }) {
  if (!data.length) return <p style={styles.loadingText}>No data to chart</p>;
  const max = Math.max(...data.map(d => d.value), 1);

  return (
    <div style={styles.chart}>
      {data.map((d, i) => (
        <div key={i} style={styles.chartBarGroup}>
          <div style={styles.chartBarLabel} title={d.label}>
            {d.label}
          </div>
          <div style={styles.chartBarOuter}>
            <div style={{
              ...styles.chartBar,
              width: `${(d.value / max) * 100}%`,
              background: `linear-gradient(90deg, ${color}cc, ${color}88)`,
            }} />
          </div>
          <div style={styles.chartBarValue}>
            {formatCompact(d.value)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════
// CSV Guide
// ═══════════════════════════════════════════════
function CSVGuide({ platform }) {
  const guides = {
    youtube_trevormay: 'YouTube Studio → Analytics → Content tab → Advanced Mode → Export CSV.\nThe file should have columns like Video title, Views, Watch time, Impressions, CTR, Revenue, etc.',
    youtube_moremayday: 'Same as above — YouTube Studio → Analytics → Content tab → Advanced Mode → Export CSV.',
    tiktok: 'TikTok Analytics → Content → Export data. Or use Metricool CSV export.\nExpected: Post title, Views, Likes, Comments, Shares, etc.',
    facebook: 'Meta Business Suite → Insights → Export. Or Metricool CSV.\nExpected: Post title, Reach, Impressions, Reactions, Comments, Shares, etc.',
    instagram: 'Meta Business Suite → Instagram Insights → Export. Or Metricool CSV.\nExpected: Post title, Reach, Impressions, Likes, Comments, Shares, etc.',
    substack: 'Substack Dashboard → Stats → Export.\nExpected: Post title, Sends, Opens, Open rate, Clicks, Subscribers, etc.',
  };
  return (
    <div style={styles.guideBox}>
      <pre style={styles.guideText}>{guides[platform.key]}</pre>
    </div>
  );
}

// ═══════════════════════════════════════════════
// CSV Parsing
// ═══════════════════════════════════════════════
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };

  function splitRow(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    result.push(current.trim());
    return result;
  }

  const headers = splitRow(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = splitRow(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
    rows.push(row);
  }
  return { headers, rows };
}

// ═══════════════════════════════════════════════
// Map CSV → platform DB rows
// ═══════════════════════════════════════════════
function mapCSVToPlatform(platform, parsed, userId) {
  if (platform.key.startsWith('youtube_')) return mapYouTubeCSV(platform, parsed, userId);
  return mapGenericCSV(platform, parsed, userId);
}

// YouTube-specific mapping
function mapYouTubeCSV(platform, parsed, userId) {
  const { headers, rows } = parsed;
  const dbRows = [];
  let minDate = null, maxDate = null;

  // Exact column name mapping from YouTube Studio export
  const colMap = {
    'Content': 'video_id',
    'Video title': 'video_title',
    'Video publish time': '_date',
    'Duration': '_duration',
    'Views': 'views',
    'Engaged views': 'engaged_views',
    'Watch time (hours)': 'watch_time_hours',
    'Average view duration': '_avg_duration',
    'Average percentage viewed (%)': 'average_percentage_viewed',
    'Stayed to watch (%)': 'stayed_to_watch_pct',
    'Unique viewers': 'unique_viewers',
    'New viewers': 'new_viewers',
    'Returning viewers': 'returning_viewers',
    'Regular viewers': 'regular_viewers',
    'Subscribers': 'subscribers',
    'Post subscribers': 'post_subscribers',
    'Impressions': 'impressions',
    'Impressions click-through rate (%)': 'impressions_ctr',
    'Estimated revenue (USD)': 'estimated_revenue',
    'YouTube Premium (USD)': 'youtube_premium_revenue',
    'YouTube ad revenue (USD)': 'ad_revenue',
    'Watch Page ads (USD)': 'watch_page_ads_revenue',
    'Estimated AdSense revenue (USD)': 'adsense_revenue',
    'Ad impressions': 'ad_impressions',
    'CPM (USD)': 'cpm',
    'RPM (USD)': 'rpm',
    'YouTube Premium views': 'youtube_premium_views',
  };

  // Build header→dbField lookup (case-insensitive)
  const headerMap = {};
  headers.forEach(h => {
    if (colMap[h]) { headerMap[h] = colMap[h]; return; }
    const lh = h.toLowerCase();
    for (const [csvName, dbField] of Object.entries(colMap)) {
      if (lh === csvName.toLowerCase()) { headerMap[h] = dbField; return; }
    }
  });

  for (const row of rows) {
    const vidIdHeader = Object.keys(headerMap).find(h => headerMap[h] === 'video_id');
    const vidId = vidIdHeader ? row[vidIdHeader]?.trim() : '';
    if (!vidId || vidId.toLowerCase() === 'total') continue;

    const dbRow = { channel: platform.channel, uploaded_by: userId };

    for (const [csvHeader, dbField] of Object.entries(headerMap)) {
      const raw = row[csvHeader];
      if (raw === '' || raw === undefined) continue;

      if (dbField === '_date') {
        const d = parseDate(raw);
        if (d) {
          dbRow.publish_date = d;
          if (!minDate || d < minDate) minDate = d;
          if (!maxDate || d > maxDate) maxDate = d;
        }
      } else if (dbField === '_duration' || dbField === '_avg_duration') {
        const secs = parseDuration(raw);
        if (secs !== null) {
          dbRow[dbField === '_duration' ? 'duration_seconds' : 'average_view_duration_seconds'] = secs;
        }
      } else if (dbField === 'video_id' || dbField === 'video_title') {
        dbRow[dbField] = raw;
      } else {
        const num = parseNumber(raw);
        if (num !== null) dbRow[dbField] = num;
      }
    }

    if (dbRow.video_id) dbRows.push(dbRow);
  }

  return { rows: dbRows, dateRange: { start: minDate, end: maxDate } };
}

// Generic CSV mapper for TikTok, Facebook, Instagram, Substack
function mapGenericCSV(platform, parsed, userId) {
  const { headers, rows } = parsed;
  const dbRows = [];
  let minDate = null, maxDate = null;
  const columns = getColumns(platform.key);

  function normalize(s) { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); }
  const dbColsByNorm = {};
  columns.forEach(c => { dbColsByNorm[normalize(c.label)] = c.key; dbColsByNorm[normalize(c.key)] = c.key; });

  const headerMap = {};
  headers.forEach(h => {
    const nh = normalize(h);
    if (dbColsByNorm[nh]) { headerMap[h] = dbColsByNorm[nh]; return; }
    for (const [normLabel, dbKey] of Object.entries(dbColsByNorm)) {
      if (nh.includes(normLabel) || normLabel.includes(nh)) { headerMap[h] = dbKey; return; }
    }
  });

  const dateHeader = headers.find(h => /date|publish|time|created/i.test(h));

  for (const row of rows) {
    const dbRow = { uploaded_by: userId };
    if (dateHeader) {
      const d = parseDate(row[dateHeader]);
      if (d) {
        dbRow.publish_date = d;
        if (!minDate || d < minDate) minDate = d;
        if (!maxDate || d > maxDate) maxDate = d;
      }
    }
    for (const [csvHeader, dbField] of Object.entries(headerMap)) {
      if (dbField === 'publish_date') continue;
      const raw = row[csvHeader];
      if (raw === '' || raw === undefined) continue;
      const col = columns.find(c => c.key === dbField);
      if (!col) continue;
      if (col.type === 'text') { dbRow[dbField] = raw; }
      else if (col.type === 'duration') { dbRow[dbField] = parseDuration(raw); }
      else { const num = parseNumber(raw); if (num !== null) dbRow[dbField] = num; }
    }
    const hasContent = dbRow.post_title || dbRow.post_id || dbRow.post_url;
    if (hasContent || dbRow.publish_date) dbRows.push(dbRow);
  }

  return { rows: dbRows, dateRange: { start: minDate, end: maxDate } };
}

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════
function parseDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
  const m = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && months[m[1].toLowerCase()]) return `${m[3]}-${months[m[1].toLowerCase()]}-${m[2].padStart(2,'0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const p = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (p) { const y = p[3].length === 2 ? '20'+p[3] : p[3]; return `${y}-${p[1].padStart(2,'0')}-${p[2].padStart(2,'0')}`; }
  const d = new Date(s);
  return !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : null;
}

function parseDuration(val) {
  if (!val) return null;
  const s = String(val).trim();
  // Pure number = seconds already
  if (/^\d+$/.test(s)) return Number(s);
  const parts = s.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
  if (parts.length === 2) return parts[0]*60 + parts[1];
  return null;
}

function parseNumber(val) {
  if (val === '' || val == null) return null;
  const clean = String(val).replace(/[,%$]/g, '').trim();
  const num = Number(clean);
  return isNaN(num) ? null : num;
}

function formatCell(val, type) {
  if (val === null || val === undefined || val === '') return '—';
  switch (type) {
    case 'number': return Number(val).toLocaleString();
    case 'decimal': return Number(val).toLocaleString(undefined, { maximumFractionDigits: 2 });
    case 'percent': return Number(val).toFixed(2) + '%';
    case 'currency': return '$' + Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'duration': {
      const secs = Math.round(Number(val));
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const sec = secs % 60;
      return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
    }
    case 'date': return new Date(val + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    default: return String(val);
  }
}

function formatCompact(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
  if (n % 1 !== 0) return n.toFixed(2);
  return n.toLocaleString();
}

function truncate(s, len) {
  if (!s) return '';
  return s.length > len ? s.slice(0, len) + '...' : s;
}

// ═══════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════
const styles = {
  page: { padding: '32px 40px' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' },
  pageTitle: { fontSize: '28px', fontWeight: 700, color: '#ffffff', margin: '0 0 4px 0', letterSpacing: '-0.5px' },
  pageSubtitle: { fontSize: '14px', color: 'rgba(255,255,255,0.4)', margin: 0 },
  tabBar: { display: 'flex', gap: '2px', marginBottom: '24px', overflowX: 'auto', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  tab: {
    display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', background: 'none', border: 'none',
    borderBottom: '2px solid transparent', color: 'rgba(255,255,255,0.45)', fontSize: '13px', fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  tabActive: { color: '#ffffff', borderBottomWidth: '2px', borderBottomStyle: 'solid' },
  tabBadge: { fontSize: '11px', padding: '2px 7px', borderRadius: '10px', fontWeight: 600 },
  uploadBar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px',
    padding: '16px 20px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
    borderLeft: '3px solid', borderRadius: '12px', marginBottom: '20px',
  },
  uploadBarLeft: { display: 'flex', alignItems: 'center', gap: '12px' },
  uploadBarTitle: { fontSize: '15px', fontWeight: 700, color: '#fff' },
  uploadBarSub: { fontSize: '12px', color: 'rgba(255,255,255,0.35)' },
  uploadBtn: {
    padding: '9px 18px', background: 'rgba(255,255,255,0.04)', border: '1px solid',
    borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  loadingText: { padding: '40px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '14px' },
  emptyCard: { background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '14px', padding: '40px', textAlign: 'center' },
  emptyTitle: { fontSize: '18px', fontWeight: 700, color: '#fff', margin: '0 0 8px' },
  emptyText: { fontSize: '14px', color: 'rgba(255,255,255,0.45)', margin: '0 0 20px' },
  guideBox: { display: 'inline-block', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', padding: '16px 20px', textAlign: 'left' },
  guideText: { fontSize: '13px', color: 'rgba(255,255,255,0.5)', margin: 0, fontFamily: 'inherit', whiteSpace: 'pre-wrap', lineHeight: 1.6 },
  // Chart
  chartSection: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '20px', marginBottom: '20px' },
  chartHeader: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' },
  chartSelect: {
    padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px', color: '#fff', fontSize: '13px', fontFamily: 'inherit', outline: 'none',
  },
  clearSelBtn: {
    padding: '6px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit',
  },
  chart: { display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '420px', overflowY: 'auto' },
  chartBarGroup: { display: 'grid', gridTemplateColumns: '200px 1fr 80px', gap: '8px', alignItems: 'center' },
  chartBarLabel: { fontSize: '12px', color: 'rgba(255,255,255,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' },
  chartBarOuter: { height: '22px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px', overflow: 'hidden' },
  chartBar: { height: '100%', borderRadius: '4px', transition: 'width 0.3s ease' },
  chartBarValue: { fontSize: '12px', fontWeight: 600, color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' },
  // Table
  tableWrap: {
    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px', overflow: 'auto', maxHeight: '600px',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '1200px' },
  th: {
    padding: '10px 14px', textAlign: 'left', fontWeight: 600, fontSize: '11px',
    color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px',
    borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0,
    background: '#16162a', zIndex: 1, whiteSpace: 'nowrap', userSelect: 'none',
  },
  thSticky: { position: 'sticky', left: 36, zIndex: 3, background: '#16162a', minWidth: '200px', maxWidth: '300px' },
  td: { padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap' },
  tdSticky: { position: 'sticky', left: 36, zIndex: 1, maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500, color: '#e2e8f0' },
  tdValue: { fontWeight: 600, color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' },
  trEven: { background: 'rgba(255,255,255,0.01)' },
  trSelected: { background: 'rgba(99,102,241,0.08)' },
  summaryRow: { background: '#1a1a30' },
  summaryCell: { fontWeight: 700, color: '#ffffff', fontSize: '13px' },
  checkbox: { accentColor: '#6366f1', cursor: 'pointer' },
  limitNote: { padding: '12px', fontSize: '12px', color: 'rgba(255,255,255,0.3)', textAlign: 'center' },
};
