import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';

// ═══════════════════════════════════════════════
// Platform config (YouTube only for now)
// ═══════════════════════════════════════════════
const PLATFORMS = [
  { key: 'youtube_trevormay', label: 'Trevor May Baseball', icon: '🎬', color: '#ff0000', channel: 'trevormay' },
  { key: 'youtube_moremayday', label: 'More Mayday', icon: '🎬', color: '#ff4444', channel: 'moremayday' },
  { key: 'tiktok', label: 'IamTrevorMay TikTok', icon: '🎵', color: '#00f2ea', disabled: true },
  { key: 'facebook', label: 'Trevor May Facebook', icon: '📘', color: '#1877f2', disabled: true },
  { key: 'instagram', label: 'trevmay65 Instagram', icon: '📸', color: '#e4405f', disabled: true },
  { key: 'substack', label: 'Mayday Substack', icon: '📰', color: '#ff6719', disabled: true },
];

// Line colors for multi-metric graph
const LINE_COLORS = ['#6366f1', '#f59e0b', '#22c55e', '#ec4899'];

// Daily metrics available for graphing
const DAILY_METRICS = [
  { key: 'views', label: 'Views', format: 'number' },
  { key: 'engaged_views', label: 'Engaged Views', format: 'number' },
  { key: 'watch_time_hours', label: 'Watch Time (hrs)', format: 'decimal' },
  { key: 'subscribers', label: 'Subscribers', format: 'number' },
  { key: 'impressions', label: 'Impressions', format: 'number' },
  { key: 'impressions_ctr', label: 'CTR (%)', format: 'percent' },
  { key: 'average_percentage_viewed', label: 'Avg % Viewed', format: 'percent' },
  { key: 'average_views_per_viewer', label: 'Avg Views/Viewer', format: 'decimal' },
  { key: 'unique_viewers', label: 'Unique Viewers', format: 'number' },
  { key: 'new_viewers', label: 'New Viewers', format: 'number' },
  { key: 'returning_viewers', label: 'Returning Viewers', format: 'number' },
  { key: 'estimated_revenue', label: 'Revenue ($)', format: 'currency' },
  { key: 'ad_revenue', label: 'Ad Revenue ($)', format: 'currency' },
  { key: 'adsense_revenue', label: 'AdSense ($)', format: 'currency' },
  { key: 'watch_page_ads_revenue', label: 'Watch Page Ads ($)', format: 'currency' },
  { key: 'youtube_premium_revenue', label: 'Premium ($)', format: 'currency' },
  { key: 'ad_impressions', label: 'Ad Impressions', format: 'number' },
  { key: 'cpm', label: 'CPM ($)', format: 'currency' },
  { key: 'rpm', label: 'RPM ($)', format: 'currency' },
  { key: 'videos_published', label: 'Videos Published', format: 'number' },
  { key: 'stayed_to_watch_pct', label: 'Stayed to Watch (%)', format: 'percent' },
];

// Per-video table columns
const VIDEO_COLUMNS = [
  { key: 'video_title', label: 'Video', type: 'text', sticky: true, defaultOn: true },
  { key: 'publish_date', label: 'Published', type: 'date', defaultOn: true },
  { key: 'views', label: 'Views', type: 'number', defaultOn: true },
  { key: 'engaged_views', label: 'Engaged Views', type: 'number', defaultOn: true },
  { key: 'impressions', label: 'Impressions', type: 'number', defaultOn: true },
  { key: 'impressions_ctr', label: 'CTR (%)', type: 'percent', defaultOn: true },
  { key: 'watch_time_hours', label: 'Watch Time (hrs)', type: 'decimal', defaultOn: true },
  { key: 'average_view_duration_seconds', label: 'Avg Duration', type: 'duration', defaultOn: true },
  { key: 'average_percentage_viewed', label: 'Avg % Viewed', type: 'percent', defaultOn: false },
  { key: 'stayed_to_watch_pct', label: 'Stayed to Watch (%)', type: 'percent', defaultOn: false },
  { key: 'subscribers', label: 'Subscribers', type: 'number', defaultOn: true },
  { key: 'estimated_revenue', label: 'Revenue ($)', type: 'currency', defaultOn: true },
  { key: 'ad_revenue', label: 'Ad Revenue ($)', type: 'currency', defaultOn: false },
  { key: 'adsense_revenue', label: 'AdSense ($)', type: 'currency', defaultOn: false },
  { key: 'watch_page_ads_revenue', label: 'Watch Page Ads ($)', type: 'currency', defaultOn: false },
  { key: 'youtube_premium_revenue', label: 'Premium ($)', type: 'currency', defaultOn: false },
  { key: 'ad_impressions', label: 'Ad Impressions', type: 'number', defaultOn: false },
  { key: 'cpm', label: 'CPM ($)', type: 'currency', defaultOn: false },
  { key: 'rpm', label: 'RPM ($)', type: 'currency', defaultOn: false },
  { key: 'youtube_premium_views', label: 'Premium Views', type: 'number', defaultOn: false },
  { key: 'post_subscribers', label: 'Post Subs', type: 'number', defaultOn: false },
  { key: 'duration_seconds', label: 'Duration', type: 'duration', defaultOn: false },
];

// ═══════════════════════════════════════════════
// Date helpers
// ═══════════════════════════════════════════════
function today() { return new Date().toISOString().split('T')[0]; }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; }
function startOfMonth(year, month) { return `${year}-${String(month).padStart(2,'0')}-01`; }
function endOfMonth(year, month) { const d = new Date(year, month, 0); return d.toISOString().split('T')[0]; }
function startOfYear(year) { return `${year}-01-01`; }
function endOfYear(year) { return `${year}-12-31`; }

const TIME_PRESETS = [
  { key: '28d', label: 'Last 28 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: '365d', label: 'Last 365 days' },
  { key: 'month', label: 'Specific month' },
  { key: 'year', label: 'Specific year' },
  { key: 'custom', label: 'Custom range' },
];

// ═══════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════
export default function Analytics() {
  const { profile } = useAuth();
  const [activePlatform, setActivePlatform] = useState(PLATFORMS[0].key);

  const platform = PLATFORMS.find(p => p.key === activePlatform);
  const isYouTube = activePlatform.startsWith('youtube_');

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
            onClick={() => !p.disabled && setActivePlatform(p.key)}
            style={{
              ...styles.tab,
              ...(activePlatform === p.key ? { ...styles.tabActive, borderBottomColor: p.color } : {}),
              ...(p.disabled ? styles.tabDisabled : {}),
            }}
          >
            <span style={{ fontSize: '16px' }}>{p.icon}</span>
            <span>{p.label}</span>
            {p.disabled && <span style={styles.comingSoon}>Soon</span>}
          </button>
        ))}
      </div>

      {isYouTube && <YouTubeAnalytics platform={platform} profile={profile} />}
    </div>
  );
}

// ═══════════════════════════════════════════════
// YouTube Analytics
// ═══════════════════════════════════════════════
function YouTubeAnalytics({ platform, profile }) {
  // Daily data + video data
  const [dailyData, setDailyData] = useState([]);
  const [videoData, setVideoData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);

  // Time filter
  const [timePreset, setTimePreset] = useState('28d');
  const [dateStart, setDateStart] = useState(daysAgo(28));
  const [dateEnd, setDateEnd] = useState(today());
  const [selectedMonth, setSelectedMonth] = useState(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`);
  const [selectedYear, setSelectedYear] = useState(String(new Date().getFullYear()));

  // Graph metrics (up to 4)
  const [graphMetrics, setGraphMetrics] = useState(['views']);

  // Table column visibility
  const [visibleCols, setVisibleCols] = useState(() => {
    const set = new Set();
    VIDEO_COLUMNS.forEach(c => { if (c.defaultOn) set.add(c.key); });
    return set;
  });
  const [showColMenu, setShowColMenu] = useState(false);

  // Table sort
  const [sortCol, setSortCol] = useState('views');
  const [sortDir, setSortDir] = useState('desc');

  const fileInputRef = useRef(null);
  const videoFileInputRef = useRef(null);

  // Compute effective date range from preset
  useEffect(() => {
    if (timePreset === '28d') { setDateStart(daysAgo(28)); setDateEnd(today()); }
    else if (timePreset === '90d') { setDateStart(daysAgo(90)); setDateEnd(today()); }
    else if (timePreset === '365d') { setDateStart(daysAgo(365)); setDateEnd(today()); }
    else if (timePreset === 'month') {
      const [y, m] = selectedMonth.split('-').map(Number);
      setDateStart(startOfMonth(y, m)); setDateEnd(endOfMonth(y, m));
    } else if (timePreset === 'year') {
      setDateStart(startOfYear(Number(selectedYear))); setDateEnd(endOfYear(Number(selectedYear)));
    }
    // 'custom' — user sets manually
  }, [timePreset, selectedMonth, selectedYear]);

  // Fetch data when date range or channel changes
  useEffect(() => { fetchAll(); }, [platform.channel, dateStart, dateEnd]);

  async function fetchAll() {
    setLoading(true);
    await Promise.all([fetchDaily(), fetchVideos()]);
    setLoading(false);
  }

  async function fetchDaily() {
    const { data } = await supabase.from('analytics_youtube_daily')
      .select('*')
      .eq('channel', platform.channel)
      .gte('date', dateStart)
      .lte('date', dateEnd)
      .order('date', { ascending: true });
    setDailyData(data || []);
  }

  async function fetchVideos() {
    const { data } = await supabase.from('analytics_youtube')
      .select('*')
      .eq('channel', platform.channel)
      .gte('publish_date', dateStart)
      .lte('publish_date', dateEnd)
      .order('publish_date', { ascending: false })
      .limit(500);
    setVideoData(data || []);
  }

  // ── Totals from daily data ──
  const totals = useMemo(() => {
    const t = { views: 0, watch_time_hours: 0, estimated_revenue: 0, videos_published: 0, shorts_published: 0 };
    dailyData.forEach(d => {
      t.views += Number(d.views) || 0;
      t.watch_time_hours += Number(d.watch_time_hours) || 0;
      t.estimated_revenue += Number(d.estimated_revenue) || 0;
      t.videos_published += Number(d.videos_published) || 0;
    });
    // Estimate shorts: videos in videoData with duration < 180 seconds
    t.shorts_published = videoData.filter(v => v.duration_seconds && v.duration_seconds <= 180).length;
    t.long_videos = videoData.filter(v => !v.duration_seconds || v.duration_seconds > 180).length;
    return t;
  }, [dailyData, videoData]);

  // ── Sort video table ──
  const sortedVideos = useMemo(() => {
    return [...videoData].sort((a, b) => {
      let va = a[sortCol], vb = b[sortCol];
      if (va == null) va = sortDir === 'asc' ? Infinity : -Infinity;
      if (vb == null) vb = sortDir === 'asc' ? Infinity : -Infinity;
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }, [videoData, sortCol, sortDir]);

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  }

  function toggleGraphMetric(key) {
    setGraphMetrics(prev => {
      if (prev.includes(key)) return prev.filter(k => k !== key);
      if (prev.length >= 4) return [...prev.slice(1), key]; // Replace oldest
      return [...prev, key];
    });
  }

  function toggleCol(key) {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // ── CSV Upload handlers ──
  async function handleDailyUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setUploadResult(null);
    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      const { rows, dateRange } = mapDailyCSV(platform.channel, parsed, profile.id);
      if (!rows.length) throw new Error('No valid rows found');
      let inserted = 0;
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const { data: result, error } = await supabase.from('analytics_youtube_daily')
          .upsert(batch, { onConflict: 'channel,date' }).select();
        if (error) { console.error(error); continue; }
        inserted += result?.length || 0;
      }
      await supabase.from('analytics_uploads').insert({
        platform: platform.key, filename: file.name, row_count: inserted,
        date_range_start: dateRange.start, date_range_end: dateRange.end, uploaded_by: profile.id,
      });
      setUploadResult({ success: true, count: inserted, type: 'daily' });
      fetchAll();
    } catch (err) { setUploadResult({ error: err.message }); }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleVideoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setUploadResult(null);
    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      const { rows, dateRange } = mapVideoCSV(platform.channel, parsed, profile.id);
      if (!rows.length) throw new Error('No valid rows found');
      let inserted = 0;
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const { data: result, error } = await supabase.from('analytics_youtube')
          .upsert(batch, { onConflict: 'channel,video_id' }).select();
        if (error) { console.error(error); continue; }
        inserted += result?.length || 0;
      }
      await supabase.from('analytics_uploads').insert({
        platform: platform.key, filename: file.name, row_count: inserted,
        date_range_start: dateRange.start, date_range_end: dateRange.end, uploaded_by: profile.id,
      });
      setUploadResult({ success: true, count: inserted, type: 'video' });
      fetchAll();
    } catch (err) { setUploadResult({ error: err.message }); }
    setUploading(false);
    if (videoFileInputRef.current) videoFileInputRef.current.value = '';
  }

  const activeVisibleCols = VIDEO_COLUMNS.filter(c => visibleCols.has(c.key));

  return (
    <div>
      {/* ── Upload Bar ── */}
      <div style={{ ...styles.uploadBar, borderLeftColor: platform.color }}>
        <div style={styles.uploadBarLeft}>
          <span style={{ fontSize: '20px' }}>{platform.icon}</span>
          <div>
            <div style={styles.uploadBarTitle}>{platform.label}</div>
            <div style={styles.uploadBarSub}>{dailyData.length} days · {videoData.length} videos</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {uploadResult && (
            <span style={{ fontSize: '12px', fontWeight: 500, color: uploadResult.error ? '#f87171' : '#4ade80' }}>
              {uploadResult.error ? `❌ ${uploadResult.error}` : `✅ ${uploadResult.count} ${uploadResult.type} rows imported`}
            </span>
          )}
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
            style={{ ...styles.uploadBtn, borderColor: platform.color + '66', color: platform.color }}>
            {uploading ? '⏳...' : '📈 Upload Daily CSV'}
          </button>
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleDailyUpload} style={{ display: 'none' }} />
          <button onClick={() => videoFileInputRef.current?.click()} disabled={uploading}
            style={{ ...styles.uploadBtn, borderColor: platform.color + '66', color: platform.color }}>
            {uploading ? '⏳...' : '🎬 Upload Video CSV'}
          </button>
          <input ref={videoFileInputRef} type="file" accept=".csv" onChange={handleVideoUpload} style={{ display: 'none' }} />
        </div>
      </div>

      {/* ── Time Filters ── */}
      <div style={styles.filterBar}>
        {TIME_PRESETS.map(p => (
          <button key={p.key} onClick={() => setTimePreset(p.key)}
            style={{ ...styles.filterChip, ...(timePreset === p.key ? styles.filterChipActive : {}) }}>
            {p.label}
          </button>
        ))}
        {timePreset === 'month' && (
          <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={styles.filterInput} />
        )}
        {timePreset === 'year' && (
          <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} style={styles.filterInput}>
            {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        )}
        {timePreset === 'custom' && (
          <>
            <input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)} style={styles.filterInput} />
            <span style={{ color: 'rgba(255,255,255,0.3)' }}>to</span>
            <input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)} style={styles.filterInput} />
          </>
        )}
        <span style={styles.filterRange}>
          {new Date(dateStart + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} — {new Date(dateEnd + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      </div>

      {loading ? <p style={styles.loadingText}>Loading...</p> : (
        <>
          {/* ── Totals Cards ── */}
          <div style={styles.totalsGrid}>
            <TotalCard label="Total Views" value={totals.views} format="number" color="#6366f1" />
            <TotalCard label="Videos Published" value={totals.long_videos} format="number" color="#3b82f6" />
            <TotalCard label="Shorts Published" value={totals.shorts_published} format="number" color="#8b5cf6" />
            <TotalCard label="Estimated Revenue" value={totals.estimated_revenue} format="currency" color="#22c55e" />
            <TotalCard label="Watch Time (hrs)" value={totals.watch_time_hours} format="decimal" color="#f59e0b" />
            <TotalCard label="Subscribers" value={dailyData.reduce((s, d) => s + (Number(d.subscribers) || 0), 0)} format="number" color="#ec4899" />
          </div>

          {/* ── Line Graph ── */}
          {dailyData.length > 0 ? (
            <div style={styles.chartSection}>
              <div style={styles.chartHeader}>
                <span style={styles.chartTitle}>Trends</span>
                <div style={styles.metricPicker}>
                  {DAILY_METRICS.map(m => (
                    <button key={m.key} onClick={() => toggleGraphMetric(m.key)}
                      style={{
                        ...styles.metricChip,
                        ...(graphMetrics.includes(m.key) ? {
                          background: LINE_COLORS[graphMetrics.indexOf(m.key)] + '22',
                          borderColor: LINE_COLORS[graphMetrics.indexOf(m.key)],
                          color: LINE_COLORS[graphMetrics.indexOf(m.key)],
                        } : {}),
                      }}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <LineGraph data={dailyData} metrics={graphMetrics} />
              <div style={styles.legendRow}>
                {graphMetrics.map((key, i) => {
                  const m = DAILY_METRICS.find(d => d.key === key);
                  return (
                    <span key={key} style={styles.legendItem}>
                      <span style={{ ...styles.legendDot, background: LINE_COLORS[i] }} />
                      {m?.label || key}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={styles.emptyCard}>
              <p style={styles.emptyText}>No daily data yet. Upload a date-based CSV from YouTube Studio Advanced Mode.</p>
            </div>
          )}

          {/* ── Video Table ── */}
          <div style={styles.tableHeader}>
            <span style={styles.tableTitle}>Videos ({videoData.length})</span>
            <div style={{ position: 'relative' }}>
              <button onClick={() => setShowColMenu(!showColMenu)} style={styles.colMenuBtn}>
                ⚙ Columns
              </button>
              {showColMenu && (
                <div style={styles.colMenu}>
                  {VIDEO_COLUMNS.filter(c => !c.sticky).map(c => (
                    <label key={c.key} style={styles.colMenuItem}>
                      <input type="checkbox" checked={visibleCols.has(c.key)}
                        onChange={() => toggleCol(c.key)} style={styles.checkbox} />
                      {c.label}
                    </label>
                  ))}
                  <button onClick={() => setShowColMenu(false)} style={styles.colMenuClose}>Done</button>
                </div>
              )}
            </div>
          </div>

          {videoData.length > 0 ? (
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {activeVisibleCols.map(col => (
                      <th key={col.key} onClick={() => handleSort(col.key)}
                        style={{
                          ...styles.th,
                          cursor: 'pointer',
                          ...(col.sticky ? styles.thSticky : {}),
                          ...(col.type !== 'text' ? { textAlign: 'right' } : {}),
                        }}>
                        {col.label}
                        {sortCol === col.key && <span style={{ marginLeft: '4px', color: '#a5b4fc' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedVideos.map((row, i) => (
                    <tr key={row.id} style={i % 2 === 0 ? styles.trEven : {}}>
                      {activeVisibleCols.map(col => (
                        <td key={col.key} style={{
                          ...styles.td,
                          ...(col.sticky ? { ...styles.tdSticky, background: i % 2 === 0 ? 'rgba(255,255,255,0.01)' : '#12121f' } : {}),
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
            </div>
          ) : (
            <div style={styles.emptyCard}>
              <p style={styles.emptyText}>No video data for this date range. Upload a per-video CSV or adjust the time filter.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// Totals Card
// ═══════════════════════════════════════════════
function TotalCard({ label, value, format, color }) {
  let display;
  if (format === 'currency') display = '$' + Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  else if (format === 'decimal') display = Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
  else display = Number(value).toLocaleString();

  return (
    <div style={styles.totalCard}>
      <div style={{ ...styles.totalCardAccent, background: color }} />
      <div style={styles.totalCardLabel}>{label}</div>
      <div style={styles.totalCardValue}>{display}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Line Graph (SVG, no library)
// ═══════════════════════════════════════════════
function LineGraph({ data, metrics }) {
  const W = 900, H = 280, PAD = { top: 20, right: 20, bottom: 40, left: 60 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  if (!data.length || !metrics.length) return null;

  // X axis: evenly spaced dates
  const dates = data.map(d => d.date);
  const xStep = plotW / Math.max(dates.length - 1, 1);

  // Y axis: find max across all selected metrics
  const allVals = metrics.flatMap(m => data.map(d => Number(d[m]) || 0));
  const maxVal = Math.max(...allVals, 1);
  const yScale = plotH / maxVal;

  // Dynamic tick count based on date range
  const tickCount = Math.min(dates.length, 12);
  const tickInterval = Math.max(1, Math.floor(dates.length / tickCount));

  function buildPath(metricKey) {
    return data.map((d, i) => {
      const x = PAD.left + i * xStep;
      const y = PAD.top + plotH - ((Number(d[metricKey]) || 0) * yScale);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }

  // Y axis labels
  const yTicks = 5;
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => {
    const val = (maxVal / yTicks) * i;
    return { val, y: PAD.top + plotH - (val * yScale) };
  });

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: '300px' }}>
        {/* Grid lines */}
        {yLabels.map((yl, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={yl.y} x2={W - PAD.right} y2={yl.y} stroke="rgba(255,255,255,0.05)" />
            <text x={PAD.left - 8} y={yl.y + 4} fill="rgba(255,255,255,0.3)" fontSize="10" textAnchor="end">
              {formatCompact(yl.val)}
            </text>
          </g>
        ))}

        {/* X axis date labels */}
        {dates.map((date, i) => {
          if (i % tickInterval !== 0 && i !== dates.length - 1) return null;
          const x = PAD.left + i * xStep;
          return (
            <text key={i} x={x} y={H - 8} fill="rgba(255,255,255,0.3)" fontSize="10" textAnchor="middle">
              {new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </text>
          );
        })}

        {/* Lines */}
        {metrics.map((m, i) => (
          <path key={m} d={buildPath(m)} fill="none" stroke={LINE_COLORS[i]} strokeWidth="2" strokeLinejoin="round" />
        ))}
      </svg>
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
    const result = []; let current = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { result.push(current.trim()); current = ''; }
      else current += ch;
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

// ── Map daily CSV ──
function mapDailyCSV(channel, parsed, userId) {
  const { headers, rows } = parsed;
  const colMap = {
    'Date': '_date', 'Views': 'views', 'Engaged views': 'engaged_views',
    'Watch time (hours)': 'watch_time_hours', 'Average view duration': '_avg_dur',
    'Average percentage viewed (%)': 'average_percentage_viewed', 'Stayed to watch (%)': 'stayed_to_watch_pct',
    'Unique viewers': 'unique_viewers', 'New viewers': 'new_viewers', 'Returning viewers': 'returning_viewers',
    'Regular viewers': 'regular_viewers', 'Average views per viewer': 'average_views_per_viewer',
    'Subscribers': 'subscribers', 'Impressions': 'impressions',
    'Impressions click-through rate (%)': 'impressions_ctr',
    'Videos added': 'videos_added', 'Videos published': 'videos_published',
    'Estimated revenue (USD)': 'estimated_revenue', 'YouTube Premium (USD)': 'youtube_premium_revenue',
    'YouTube ad revenue (USD)': 'ad_revenue', 'Watch Page ads (USD)': 'watch_page_ads_revenue',
    'Estimated AdSense revenue (USD)': 'adsense_revenue', 'Ad impressions': 'ad_impressions',
    'CPM (USD)': 'cpm', 'RPM (USD)': 'rpm', 'YouTube Premium views': 'youtube_premium_views',
  };
  const headerMap = {};
  headers.forEach(h => { if (colMap[h]) headerMap[h] = colMap[h]; });

  const dbRows = []; let minD = null, maxD = null;
  for (const row of rows) {
    const dateH = Object.keys(headerMap).find(h => headerMap[h] === '_date');
    const rawDate = dateH ? row[dateH]?.trim() : '';
    if (!rawDate || rawDate.toLowerCase() === 'total') continue;
    const date = parseDate(rawDate);
    if (!date) continue;
    if (!minD || date < minD) minD = date;
    if (!maxD || date > maxD) maxD = date;

    const dbRow = { channel, date, uploaded_by: userId };
    for (const [csvH, dbF] of Object.entries(headerMap)) {
      if (dbF === '_date') continue;
      const raw = row[csvH];
      if (raw === '' || raw === undefined) continue;
      if (dbF === '_avg_dur') { const s = parseDuration(raw); if (s !== null) dbRow.average_view_duration_seconds = s; }
      else { const n = parseNumber(raw); if (n !== null) dbRow[dbF] = n; }
    }
    dbRows.push(dbRow);
  }
  return { rows: dbRows, dateRange: { start: minD, end: maxD } };
}

// ── Map per-video CSV ──
function mapVideoCSV(channel, parsed, userId) {
  const { headers, rows } = parsed;
  const colMap = {
    'Content': 'video_id', 'Video title': 'video_title', 'Video publish time': '_date', 'Duration': '_duration',
    'Views': 'views', 'Engaged views': 'engaged_views', 'Watch time (hours)': 'watch_time_hours',
    'Average view duration': '_avg_dur', 'Average percentage viewed (%)': 'average_percentage_viewed',
    'Stayed to watch (%)': 'stayed_to_watch_pct', 'Unique viewers': 'unique_viewers',
    'New viewers': 'new_viewers', 'Returning viewers': 'returning_viewers', 'Regular viewers': 'regular_viewers',
    'Subscribers': 'subscribers', 'Post subscribers': 'post_subscribers',
    'Impressions': 'impressions', 'Impressions click-through rate (%)': 'impressions_ctr',
    'Estimated revenue (USD)': 'estimated_revenue', 'YouTube Premium (USD)': 'youtube_premium_revenue',
    'YouTube ad revenue (USD)': 'ad_revenue', 'Watch Page ads (USD)': 'watch_page_ads_revenue',
    'Estimated AdSense revenue (USD)': 'adsense_revenue', 'Ad impressions': 'ad_impressions',
    'CPM (USD)': 'cpm', 'RPM (USD)': 'rpm', 'YouTube Premium views': 'youtube_premium_views',
  };
  const headerMap = {};
  headers.forEach(h => { if (colMap[h]) headerMap[h] = colMap[h]; });

  const dbRows = []; let minD = null, maxD = null;
  for (const row of rows) {
    const vidIdH = Object.keys(headerMap).find(h => headerMap[h] === 'video_id');
    const vidId = vidIdH ? row[vidIdH]?.trim() : '';
    if (!vidId || vidId.toLowerCase() === 'total') continue;

    const dbRow = { channel, uploaded_by: userId };
    for (const [csvH, dbF] of Object.entries(headerMap)) {
      const raw = row[csvH];
      if (raw === '' || raw === undefined) continue;
      if (dbF === '_date') { const d = parseDate(raw); if (d) { dbRow.publish_date = d; if (!minD || d < minD) minD = d; if (!maxD || d > maxD) maxD = d; } }
      else if (dbF === '_duration') { const s = parseDuration(raw); if (s !== null) dbRow.duration_seconds = s; }
      else if (dbF === '_avg_dur') { const s = parseDuration(raw); if (s !== null) dbRow.average_view_duration_seconds = s; }
      else if (dbF === 'video_id' || dbF === 'video_title') dbRow[dbF] = raw;
      else { const n = parseNumber(raw); if (n !== null) dbRow[dbF] = n; }
    }
    if (dbRow.video_id) dbRows.push(dbRow);
  }
  return { rows: dbRows, dateRange: { start: minD, end: maxD } };
}

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════
function parseDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
  const m = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && months[m[1].toLowerCase()]) return `${m[3]}-${months[m[1].toLowerCase()]}-${m[2].padStart(2,'0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  const p = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (p) { const y = p[3].length===2?'20'+p[3]:p[3]; return `${y}-${p[1].padStart(2,'0')}-${p[2].padStart(2,'0')}`; }
  return null;
}
function parseDuration(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const parts = s.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length===3) return parts[0]*3600+parts[1]*60+parts[2];
  if (parts.length===2) return parts[0]*60+parts[1];
  return null;
}
function parseNumber(val) {
  if (val===''||val==null) return null;
  const n = Number(String(val).replace(/[,%$]/g,'').trim());
  return isNaN(n)?null:n;
}
function formatCell(val, type) {
  if (val==null||val==='') return '—';
  switch(type) {
    case 'number': return Number(val).toLocaleString();
    case 'decimal': return Number(val).toLocaleString(undefined,{maximumFractionDigits:2});
    case 'percent': return Number(val).toFixed(2)+'%';
    case 'currency': return '$'+Number(val).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
    case 'duration': { const s=Math.round(Number(val)),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60; return h>0?`${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${m}:${String(sec).padStart(2,'0')}`; }
    case 'date': return new Date(val+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    default: return String(val);
  }
}
function formatCompact(n) {
  if (n>=1e6) return (n/1e6).toFixed(1)+'M';
  if (n>=1e3) return (n/1e3).toFixed(1)+'K';
  if (n%1!==0) return n.toFixed(1);
  return n.toLocaleString();
}

// ═══════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════
const styles = {
  page: { padding: '32px 40px' },
  topBar: { display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'24px' },
  pageTitle: { fontSize:'28px', fontWeight:700, color:'#fff', margin:'0 0 4px', letterSpacing:'-0.5px' },
  pageSubtitle: { fontSize:'14px', color:'rgba(255,255,255,0.4)', margin:0 },
  tabBar: { display:'flex', gap:'2px', marginBottom:'20px', overflowX:'auto', borderBottom:'1px solid rgba(255,255,255,0.06)' },
  tab: { display:'flex', alignItems:'center', gap:'8px', padding:'10px 16px', background:'none', border:'none', borderBottom:'2px solid transparent', color:'rgba(255,255,255,0.45)', fontSize:'13px', fontWeight:500, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' },
  tabActive: { color:'#fff', borderBottomWidth:'2px', borderBottomStyle:'solid' },
  tabDisabled: { opacity:0.35, cursor:'default' },
  comingSoon: { fontSize:'10px', background:'rgba(255,255,255,0.06)', padding:'2px 6px', borderRadius:'4px', color:'rgba(255,255,255,0.3)' },
  uploadBar: { display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'12px', padding:'16px 20px', background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.06)', borderLeft:'3px solid', borderRadius:'12px', marginBottom:'16px' },
  uploadBarLeft: { display:'flex', alignItems:'center', gap:'12px' },
  uploadBarTitle: { fontSize:'15px', fontWeight:700, color:'#fff' },
  uploadBarSub: { fontSize:'12px', color:'rgba(255,255,255,0.35)' },
  uploadBtn: { padding:'8px 16px', background:'rgba(255,255,255,0.04)', border:'1px solid', borderRadius:'8px', fontSize:'12px', fontWeight:600, cursor:'pointer', fontFamily:'inherit' },
  // Filters
  filterBar: { display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap', marginBottom:'20px', padding:'12px 16px', background:'rgba(255,255,255,0.02)', borderRadius:'10px', border:'1px solid rgba(255,255,255,0.06)' },
  filterChip: { padding:'6px 14px', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:'20px', color:'rgba(255,255,255,0.5)', fontSize:'12px', fontWeight:500, cursor:'pointer', fontFamily:'inherit' },
  filterChipActive: { background:'rgba(99,102,241,0.15)', borderColor:'rgba(99,102,241,0.4)', color:'#a5b4fc' },
  filterInput: { padding:'6px 10px', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:'6px', color:'#fff', fontSize:'12px', fontFamily:'inherit', outline:'none' },
  filterRange: { fontSize:'12px', color:'rgba(255,255,255,0.25)', marginLeft:'auto' },
  // Totals
  totalsGrid: { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:'12px', marginBottom:'20px' },
  totalCard: { background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.06)', borderRadius:'12px', padding:'16px 20px', position:'relative', overflow:'hidden' },
  totalCardAccent: { position:'absolute', top:0, left:0, right:0, height:'3px' },
  totalCardLabel: { fontSize:'11px', fontWeight:600, color:'rgba(255,255,255,0.35)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:'6px' },
  totalCardValue: { fontSize:'22px', fontWeight:700, color:'#fff', fontVariantNumeric:'tabular-nums' },
  // Chart
  chartSection: { background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.06)', borderRadius:'12px', padding:'20px', marginBottom:'20px' },
  chartHeader: { marginBottom:'12px' },
  chartTitle: { fontSize:'15px', fontWeight:700, color:'#fff', marginRight:'16px' },
  metricPicker: { display:'flex', flexWrap:'wrap', gap:'4px', marginTop:'8px' },
  metricChip: { padding:'4px 10px', background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:'14px', color:'rgba(255,255,255,0.4)', fontSize:'11px', fontWeight:500, cursor:'pointer', fontFamily:'inherit' },
  legendRow: { display:'flex', gap:'16px', marginTop:'12px' },
  legendItem: { display:'flex', alignItems:'center', gap:'6px', fontSize:'12px', color:'rgba(255,255,255,0.5)' },
  legendDot: { width:'10px', height:'10px', borderRadius:'3px' },
  // Table
  tableHeader: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' },
  tableTitle: { fontSize:'15px', fontWeight:700, color:'#fff' },
  colMenuBtn: { padding:'6px 14px', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:'8px', color:'rgba(255,255,255,0.5)', fontSize:'12px', cursor:'pointer', fontFamily:'inherit' },
  colMenu: { position:'absolute', right:0, top:'100%', marginTop:'4px', background:'#1a1a2e', border:'1px solid rgba(255,255,255,0.1)', borderRadius:'12px', padding:'12px', minWidth:'220px', maxHeight:'400px', overflowY:'auto', zIndex:100, display:'flex', flexDirection:'column', gap:'6px' },
  colMenuItem: { display:'flex', alignItems:'center', gap:'8px', fontSize:'12px', color:'rgba(255,255,255,0.6)', cursor:'pointer' },
  colMenuClose: { marginTop:'8px', padding:'6px', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:'6px', color:'rgba(255,255,255,0.5)', fontSize:'11px', cursor:'pointer', fontFamily:'inherit' },
  tableWrap: { background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.06)', borderRadius:'12px', overflow:'auto', maxHeight:'600px' },
  table: { width:'100%', borderCollapse:'collapse', fontSize:'13px', minWidth:'900px' },
  th: { padding:'10px 14px', textAlign:'left', fontWeight:600, fontSize:'11px', color:'rgba(255,255,255,0.4)', textTransform:'uppercase', letterSpacing:'0.5px', borderBottom:'1px solid rgba(255,255,255,0.06)', position:'sticky', top:0, background:'#16162a', zIndex:1, whiteSpace:'nowrap', userSelect:'none' },
  thSticky: { position:'sticky', left:0, zIndex:3, background:'#16162a', minWidth:'200px', maxWidth:'300px' },
  td: { padding:'8px 14px', borderBottom:'1px solid rgba(255,255,255,0.03)', color:'rgba(255,255,255,0.6)', whiteSpace:'nowrap' },
  tdSticky: { position:'sticky', left:0, zIndex:1, maxWidth:'300px', overflow:'hidden', textOverflow:'ellipsis', fontWeight:500, color:'#e2e8f0' },
  tdValue: { fontWeight:600, color:'#e2e8f0', fontVariantNumeric:'tabular-nums' },
  trEven: { background:'rgba(255,255,255,0.01)' },
  checkbox: { accentColor:'#6366f1', cursor:'pointer' },
  loadingText: { padding:'40px', textAlign:'center', color:'rgba(255,255,255,0.3)', fontSize:'14px' },
  emptyCard: { background:'rgba(255,255,255,0.02)', border:'1px dashed rgba(255,255,255,0.08)', borderRadius:'14px', padding:'32px', textAlign:'center', marginBottom:'20px' },
  emptyText: { color:'rgba(255,255,255,0.35)', fontSize:'14px', margin:0 },
};
