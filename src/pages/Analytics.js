import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';

const PLATFORMS = [
  { key: 'youtube_trevormay', label: 'Trevor May Baseball', icon: '🎬', color: '#ff0000', channel: 'trevormay' },
  { key: 'youtube_moremayday', label: 'More Mayday', icon: '🎬', color: '#ff4444', channel: 'moremayday' },
  { key: 'tiktok', label: 'IamTrevorMay TikTok', icon: '🎵', color: '#00f2ea' },
  { key: 'facebook', label: 'Trevor May Facebook', icon: '📘', color: '#1877f2' },
  { key: 'instagram', label: 'trevmay65 Instagram', icon: '📸', color: '#e4405f' },
  { key: 'substack', label: 'Mayday Substack', icon: '📰', color: '#ff6719' },
];

export default function Analytics() {
  const { profile } = useAuth();
  const [activePlatform, setActivePlatform] = useState(PLATFORMS[0].key);
  const [platformMeta, setPlatformMeta] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAllMeta();
  }, []);

  async function fetchAllMeta() {
    setLoading(true);
    const meta = {};

    // Get date ranges for each platform
    for (const p of PLATFORMS) {
      const tableName = p.key.startsWith('youtube_') ? 'analytics_youtube' : `analytics_${p.key}`;
      const isYt = p.key.startsWith('youtube_');

      let query = supabase.from(tableName).select('date', { count: 'exact', head: false });
      if (isYt) query = query.eq('channel', p.channel);
      const { data: dates, count } = await query.order('date', { ascending: true }).limit(1);

      let latestQuery = supabase.from(tableName).select('date');
      if (isYt) latestQuery = latestQuery.eq('channel', p.channel);
      const { data: latestDates } = await latestQuery.order('date', { ascending: false }).limit(1);

      // Get last upload
      const { data: uploads } = await supabase.from('analytics_uploads')
        .select('created_at, filename, row_count')
        .eq('platform', p.key)
        .order('created_at', { ascending: false })
        .limit(1);

      meta[p.key] = {
        dateStart: dates?.[0]?.date || null,
        dateEnd: latestDates?.[0]?.date || null,
        rowCount: count || 0,
        lastUpload: uploads?.[0] || null,
      };
    }

    setPlatformMeta(meta);
    setLoading(false);
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
            <span style={styles.tabLabel}>{p.label}</span>
            {platformMeta[p.key]?.rowCount > 0 && (
              <span style={{ ...styles.tabBadge, background: p.color + '22', color: p.color }}>
                {platformMeta[p.key].rowCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Active Platform Section */}
      <PlatformSection
        platform={platform}
        meta={platformMeta[activePlatform]}
        profile={profile}
        onDataChanged={fetchAllMeta}
        loading={loading}
      />
    </div>
  );
}

// ─── Platform Section ───
function PlatformSection({ platform, meta, profile, onDataChanged, loading }) {
  const [data, setData] = useState([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [metricFilter, setMetricFilter] = useState('all');
  const [availableMetrics, setAvailableMetrics] = useState([]);
  const [showUploadHistory, setShowUploadHistory] = useState(false);
  const [uploadHistory, setUploadHistory] = useState([]);
  const [sortCol, setSortCol] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const fileInputRef = useRef(null);

  useEffect(() => {
    fetchData();
  }, [platform.key, filterStart, filterEnd, metricFilter, sortCol, sortDir]);

  async function fetchData() {
    setDataLoading(true);
    const tableName = platform.key.startsWith('youtube_') ? 'analytics_youtube' : `analytics_${platform.key}`;
    const isYt = platform.key.startsWith('youtube_');

    let query = supabase.from(tableName).select('*');
    if (isYt) query = query.eq('channel', platform.channel);
    if (filterStart) query = query.gte('date', filterStart);
    if (filterEnd) query = query.lte('date', filterEnd);
    if (metricFilter !== 'all') query = query.eq('metric_name', metricFilter);
    query = query.order(sortCol, { ascending: sortDir === 'asc' }).limit(500);

    const { data: rows } = await query;
    setData(rows || []);

    // Fetch available metrics
    let metricsQuery = supabase.from(tableName).select('metric_name');
    if (isYt) metricsQuery = metricsQuery.eq('channel', platform.channel);
    const { data: metricRows } = await metricsQuery;
    const unique = [...new Set((metricRows || []).map(r => r.metric_name))].sort();
    setAvailableMetrics(unique);

    setDataLoading(false);
  }

  async function fetchUploadHistory() {
    const { data } = await supabase.from('analytics_uploads')
      .select('*, uploader:profiles!analytics_uploads_uploaded_by_fkey(full_name)')
      .eq('platform', platform.key)
      .order('created_at', { ascending: false });
    setUploadHistory(data || []);
    setShowUploadHistory(true);
  }

  async function handleCSVUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadResult(null);

    try {
      const text = await file.text();
      const parsed = parseCSV(text);

      if (parsed.rows.length === 0) {
        setUploadResult({ error: 'No data rows found in CSV' });
        setUploading(false);
        return;
      }

      const { rows, dateRange } = processCSVForPlatform(platform, parsed);

      if (rows.length === 0) {
        setUploadResult({ error: 'Could not parse any valid rows. Check CSV format.' });
        setUploading(false);
        return;
      }

      // Insert in batches of 100
      let inserted = 0;
      let skipped = 0;
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const tableName = platform.key.startsWith('youtube_') ? 'analytics_youtube' : `analytics_${platform.key}`;
        const { data: result, error } = await supabase.from(tableName)
          .upsert(batch, { onConflict: getConflictKeys(platform), ignoreDuplicates: true })
          .select();
        if (error) {
          console.error('Batch insert error:', error);
          skipped += batch.length;
        } else {
          inserted += result?.length || 0;
          skipped += batch.length - (result?.length || 0);
        }
      }

      // Log the upload
      await supabase.from('analytics_uploads').insert({
        platform: platform.key,
        filename: file.name,
        row_count: inserted,
        date_range_start: dateRange.start,
        date_range_end: dateRange.end,
        uploaded_by: profile.id,
      });

      setUploadResult({ success: true, inserted, skipped, total: rows.length });
      fetchData();
      onDataChanged();
    } catch (err) {
      console.error('Upload error:', err);
      setUploadResult({ error: err.message || 'Upload failed' });
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const hasData = meta?.rowCount > 0;

  return (
    <div style={styles.section}>
      {/* Data Status Banner */}
      <div style={{ ...styles.statusBanner, borderLeftColor: platform.color }}>
        <div style={styles.statusGrid}>
          <div style={styles.statusItem}>
            <span style={styles.statusLabel}>Date Range</span>
            <span style={styles.statusValue}>
              {meta?.dateStart && meta?.dateEnd
                ? `${formatDate(meta.dateStart)} — ${formatDate(meta.dateEnd)}`
                : 'No data yet'}
            </span>
          </div>
          <div style={styles.statusItem}>
            <span style={styles.statusLabel}>Data Points</span>
            <span style={styles.statusValue}>{meta?.rowCount?.toLocaleString() || 0}</span>
          </div>
          <div style={styles.statusItem}>
            <span style={styles.statusLabel}>Last Upload</span>
            <span style={styles.statusValue}>
              {meta?.lastUpload
                ? `${formatDateTime(meta.lastUpload.created_at)}`
                : 'Never'}
            </span>
          </div>
          {meta?.lastUpload && (
            <div style={styles.statusItem}>
              <span style={styles.statusLabel}>Last File</span>
              <span style={styles.statusValue} title={meta.lastUpload.filename}>
                {meta.lastUpload.filename?.length > 25
                  ? meta.lastUpload.filename.slice(0, 25) + '...'
                  : meta.lastUpload.filename}
              </span>
            </div>
          )}
        </div>
        <div style={styles.statusActions}>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{ ...styles.uploadBtn, background: platform.color + '22', color: platform.color, borderColor: platform.color + '44' }}
            disabled={uploading}
          >
            {uploading ? '⏳ Processing...' : '📄 Upload CSV'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleCSVUpload}
            style={{ display: 'none' }}
          />
          {hasData && (
            <button onClick={fetchUploadHistory} style={styles.historyBtn}>
              📋 Upload History
            </button>
          )}
        </div>
      </div>

      {/* Upload Result */}
      {uploadResult && (
        <div style={{
          ...styles.resultBanner,
          ...(uploadResult.error ? styles.resultError : styles.resultSuccess),
        }}>
          {uploadResult.error
            ? `❌ ${uploadResult.error}`
            : `✅ Imported ${uploadResult.inserted} rows (${uploadResult.skipped} duplicates skipped)`}
          <button onClick={() => setUploadResult(null)} style={styles.resultClose}>✕</button>
        </div>
      )}

      {/* CSV Format Help */}
      {!hasData && (
        <div style={styles.helpCard}>
          <h3 style={styles.helpTitle}>📊 Getting Started with {platform.label}</h3>
          <p style={styles.helpText}>
            Upload a CSV file exported from {platform.key.startsWith('youtube_') ? 'YouTube Studio' : platform.label}.
          </p>
          <CSVFormatGuide platform={platform} />
        </div>
      )}

      {/* Filters */}
      {hasData && (
        <div style={styles.filterBar}>
          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>From</label>
            <input
              type="date"
              value={filterStart}
              onChange={e => setFilterStart(e.target.value)}
              style={styles.filterInput}
            />
          </div>
          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>To</label>
            <input
              type="date"
              value={filterEnd}
              onChange={e => setFilterEnd(e.target.value)}
              style={styles.filterInput}
            />
          </div>
          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>Metric</label>
            <select
              value={metricFilter}
              onChange={e => setMetricFilter(e.target.value)}
              style={styles.filterSelect}
            >
              <option value="all">All Metrics</option>
              {availableMetrics.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          {(filterStart || filterEnd || metricFilter !== 'all') && (
            <button
              onClick={() => { setFilterStart(''); setFilterEnd(''); setMetricFilter('all'); }}
              style={styles.clearBtn}
            >
              Clear Filters
            </button>
          )}
        </div>
      )}

      {/* Data Table */}
      {hasData && (
        <div style={styles.tableWrap}>
          {dataLoading ? (
            <p style={styles.loadingText}>Loading data...</p>
          ) : data.length === 0 ? (
            <p style={styles.loadingText}>No data matches your filters</p>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <SortHeader col="date" label="Date" sortCol={sortCol} sortDir={sortDir} onSort={(c, d) => { setSortCol(c); setSortDir(d); }} />
                  <SortHeader col="metric_name" label="Metric" sortCol={sortCol} sortDir={sortDir} onSort={(c, d) => { setSortCol(c); setSortDir(d); }} />
                  <SortHeader col="metric_value" label="Value" sortCol={sortCol} sortDir={sortDir} onSort={(c, d) => { setSortCol(c); setSortDir(d); }} />
                  <th style={styles.th}>{getContentLabel(platform)}</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={row.id || i} style={i % 2 === 0 ? styles.trEven : {}}>
                    <td style={styles.td}>{formatDate(row.date)}</td>
                    <td style={styles.td}>
                      <span style={styles.metricBadge}>{row.metric_name}</span>
                    </td>
                    <td style={{ ...styles.td, ...styles.tdValue }}>{formatNumber(row.metric_value)}</td>
                    <td style={styles.td}>{getContentTitle(platform, row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data.length >= 500 && (
            <p style={styles.limitNote}>Showing first 500 rows. Use filters to narrow results.</p>
          )}
        </div>
      )}

      {/* Upload History Modal */}
      {showUploadHistory && (
        <div style={styles.modalOverlay} onClick={() => setShowUploadHistory(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Upload History — {platform.label}</h3>
            <div style={styles.historyList}>
              {uploadHistory.length === 0 ? (
                <p style={styles.loadingText}>No uploads yet</p>
              ) : (
                uploadHistory.map(u => (
                  <div key={u.id} style={styles.historyItem}>
                    <div style={styles.historyFile}>{u.filename}</div>
                    <div style={styles.historyMeta}>
                      {u.row_count} rows · {u.date_range_start && u.date_range_end
                        ? `${formatDate(u.date_range_start)} — ${formatDate(u.date_range_end)}`
                        : 'Unknown range'}
                    </div>
                    <div style={styles.historyMeta}>
                      {u.uploader?.full_name} · {formatDateTime(u.created_at)}
                    </div>
                  </div>
                ))
              )}
            </div>
            <button onClick={() => setShowUploadHistory(false)} style={styles.modalClose}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sort Header ───
function SortHeader({ col, label, sortCol, sortDir, onSort }) {
  const active = sortCol === col;
  return (
    <th
      style={{ ...styles.th, cursor: 'pointer', userSelect: 'none' }}
      onClick={() => onSort(col, active && sortDir === 'asc' ? 'desc' : 'asc')}
    >
      {label} {active ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );
}

// ─── CSV Format Guide ───
function CSVFormatGuide({ platform }) {
  const guides = {
    youtube_trevormay: 'Export from YouTube Studio → Analytics → Advanced Mode → Export (CSV). The system accepts the standard YouTube Studio export format with columns like Date, Views, Watch time, Subscribers, etc.',
    youtube_moremayday: 'Same as above — export from YouTube Studio → Analytics → Advanced Mode → Export (CSV).',
    tiktok: 'Export from TikTok Analytics (Business/Creator account) → Download data. Or export from Metricool. Expected columns: Date, Views, Likes, Comments, Shares, etc.',
    facebook: 'Export from Meta Business Suite → Insights → Export Data (CSV). Or export from Metricool. Expected columns: Date, Reach, Impressions, Engagement, etc.',
    instagram: 'Export from Meta Business Suite → Instagram Insights → Export. Or export from Metricool. Expected columns: Date, Impressions, Reach, Followers, etc.',
    substack: 'Export from Substack Dashboard → Stats. Expected columns: Date, Title, Opens, Open Rate, Clicks, Subscribers, etc.',
  };

  return (
    <div style={styles.guideBox}>
      <p style={styles.guideText}>{guides[platform.key]}</p>
      <p style={styles.guideNote}>
        💡 The system auto-detects column names from your CSV header row. Each row becomes a data point with a date, metric name, and value.
        Duplicate data (same date + metric + content) is automatically skipped.
      </p>
    </div>
  );
}

// ─── CSV Parser ───
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };

  // Handle quoted fields
  function splitRow(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
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
    headers.forEach((h, idx) => {
      row[h] = vals[idx] || '';
    });
    rows.push(row);
  }

  return { headers, rows };
}

// ─── Process CSV rows into platform-specific DB format ───
function processCSVForPlatform(platform, parsed) {
  const { headers, rows } = parsed;
  const dbRows = [];
  let minDate = null, maxDate = null;

  // Find the date column
  const dateCol = headers.find(h =>
    /^date$/i.test(h) || /^day$/i.test(h) || /^period$/i.test(h)
  ) || headers[0];

  // Find metric columns (everything that's not date and not a text identifier)
  const textCols = new Set();
  const idCols = new Set();

  // Identify text/id columns
  headers.forEach(h => {
    const lower = h.toLowerCase();
    if (lower === dateCol.toLowerCase()) return;
    if (/title|name|url|link|id|description|slug|permalink|post$/i.test(lower)) {
      if (/id$/i.test(lower) || /url|link|permalink/i.test(lower)) idCols.add(h);
      else textCols.add(h);
    }
  });

  // All remaining numeric columns are metrics
  const metricCols = headers.filter(h => {
    if (h === dateCol) return false;
    if (textCols.has(h) || idCols.has(h)) return false;
    // Check first non-empty value
    const firstVal = rows.find(r => r[h] !== '')?.[h];
    if (firstVal === undefined) return false;
    return !isNaN(parseNumber(firstVal));
  });

  // If no metric columns found, treat all non-date non-text cols as metrics
  if (metricCols.length === 0) {
    headers.forEach(h => {
      if (h !== dateCol && !textCols.has(h) && !idCols.has(h)) metricCols.push(h);
    });
  }

  const titleCol = [...textCols][0] || null;
  const idCol = [...idCols][0] || null;

  for (const row of rows) {
    const dateStr = parseDate(row[dateCol]);
    if (!dateStr) continue;

    if (!minDate || dateStr < minDate) minDate = dateStr;
    if (!maxDate || dateStr > maxDate) maxDate = dateStr;

    const title = titleCol ? row[titleCol] : null;
    const contentId = idCol ? row[idCol] : null;

    for (const metricCol of metricCols) {
      const val = parseNumber(row[metricCol]);
      if (val === null || isNaN(val)) continue;

      const dbRow = {
        date: dateStr,
        metric_name: metricCol,
        metric_value: val,
      };

      // Platform-specific fields
      if (platform.key.startsWith('youtube_')) {
        dbRow.channel = platform.channel;
        dbRow.video_title = title;
        dbRow.video_id = contentId;
      } else if (platform.key === 'tiktok') {
        dbRow.post_title = title;
        dbRow.post_id = contentId;
      } else if (platform.key === 'facebook') {
        dbRow.post_title = title;
        dbRow.post_id = contentId;
      } else if (platform.key === 'instagram') {
        dbRow.post_title = title;
        dbRow.post_id = contentId;
      } else if (platform.key === 'substack') {
        dbRow.post_title = title;
        dbRow.post_url = contentId;
      }

      dbRows.push(dbRow);
    }
  }

  return {
    rows: dbRows,
    dateRange: { start: minDate, end: maxDate },
  };
}

function getConflictKeys(platform) {
  if (platform.key.startsWith('youtube_')) return 'channel,date,metric_name,video_id';
  if (platform.key === 'tiktok') return 'date,metric_name,post_id';
  if (platform.key === 'facebook') return 'date,metric_name,post_id';
  if (platform.key === 'instagram') return 'date,metric_name,post_id';
  if (platform.key === 'substack') return 'date,metric_name,post_title';
  return '';
}

function getContentLabel(platform) {
  if (platform.key.startsWith('youtube_')) return 'Video';
  if (platform.key === 'substack') return 'Post';
  return 'Content';
}

function getContentTitle(platform, row) {
  if (platform.key.startsWith('youtube_')) return row.video_title || '—';
  if (platform.key === 'substack') return row.post_title || '—';
  return row.post_title || '—';
}

// ─── Helpers ───
function parseDate(val) {
  if (!val) return null;
  // Try ISO format first
  const iso = new Date(val);
  if (!isNaN(iso.getTime())) {
    return iso.toISOString().split('T')[0];
  }
  // Try MM/DD/YYYY
  const parts = val.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (parts) {
    const year = parts[3].length === 2 ? '20' + parts[3] : parts[3];
    return `${year}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
  }
  return null;
}

function parseNumber(val) {
  if (val === '' || val === null || val === undefined) return null;
  const clean = String(val).replace(/[,%$]/g, '').trim();
  const num = Number(clean);
  return isNaN(num) ? null : num;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatNumber(val) {
  if (val === null || val === undefined) return '—';
  if (Number.isInteger(val)) return val.toLocaleString();
  return Number(val).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// ─── Styles ───
const styles = {
  page: { padding: '32px 40px' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' },
  pageTitle: { fontSize: '28px', fontWeight: 700, color: '#ffffff', margin: '0 0 4px 0', letterSpacing: '-0.5px' },
  pageSubtitle: { fontSize: '14px', color: 'rgba(255,255,255,0.4)', margin: 0 },

  tabBar: { display: 'flex', gap: '4px', marginBottom: '24px', overflowX: 'auto', paddingBottom: '2px', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  tab: {
    display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', background: 'none', border: 'none',
    borderBottom: '2px solid transparent', color: 'rgba(255,255,255,0.45)', fontSize: '13px', fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', transition: 'all 0.15s',
  },
  tabActive: { color: '#ffffff', borderBottomWidth: '2px', borderBottomStyle: 'solid' },
  tabLabel: {},
  tabBadge: { fontSize: '11px', padding: '2px 7px', borderRadius: '10px', fontWeight: 600 },

  section: { marginTop: '8px' },

  statusBanner: {
    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
    borderLeft: '3px solid', borderRadius: '12px', padding: '20px 24px', marginBottom: '20px',
  },
  statusGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '16px' },
  statusItem: { display: 'flex', flexDirection: 'column', gap: '4px' },
  statusLabel: { fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  statusValue: { fontSize: '15px', fontWeight: 600, color: '#e2e8f0' },
  statusActions: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  uploadBtn: {
    padding: '9px 18px', border: '1px solid', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
  },
  historyBtn: {
    padding: '9px 18px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '13px', fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit',
  },

  resultBanner: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px',
    borderRadius: '10px', marginBottom: '16px', fontSize: '13px', fontWeight: 500,
  },
  resultSuccess: { background: 'rgba(34,197,94,0.1)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)' },
  resultError: { background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' },
  resultClose: { background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '16px', padding: '0 4px' },

  helpCard: {
    background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)',
    borderRadius: '14px', padding: '32px', textAlign: 'center',
  },
  helpTitle: { fontSize: '18px', fontWeight: 700, color: '#ffffff', margin: '0 0 8px 0' },
  helpText: { fontSize: '14px', color: 'rgba(255,255,255,0.5)', margin: '0 0 16px 0' },
  guideBox: { background: 'rgba(255,255,255,0.03)', borderRadius: '10px', padding: '16px', textAlign: 'left' },
  guideText: { fontSize: '13px', color: 'rgba(255,255,255,0.55)', margin: '0 0 10px 0', lineHeight: 1.6 },
  guideNote: { fontSize: '12px', color: 'rgba(255,255,255,0.35)', margin: 0, lineHeight: 1.5 },

  filterBar: { display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: '20px', flexWrap: 'wrap' },
  filterGroup: { display: 'flex', flexDirection: 'column', gap: '4px' },
  filterLabel: { fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  filterInput: {
    padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px', color: '#fff', fontSize: '13px', fontFamily: 'inherit', outline: 'none',
  },
  filterSelect: {
    padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px', color: '#fff', fontSize: '13px', fontFamily: 'inherit', outline: 'none', minWidth: '160px',
  },
  clearBtn: {
    padding: '8px 14px', background: 'none', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px', color: 'rgba(255,255,255,0.4)', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit',
  },

  tableWrap: {
    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px', overflow: 'auto', maxHeight: '600px',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th: {
    padding: '12px 16px', textAlign: 'left', fontWeight: 600, fontSize: '11px',
    color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px',
    borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0,
    background: '#16162a', zIndex: 1,
  },
  td: { padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.7)' },
  tdValue: { fontWeight: 600, color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' },
  trEven: { background: 'rgba(255,255,255,0.01)' },
  metricBadge: {
    display: 'inline-block', padding: '2px 8px', background: 'rgba(99,102,241,0.1)',
    borderRadius: '6px', fontSize: '12px', color: '#a5b4fc', fontWeight: 500,
  },
  limitNote: { padding: '12px 16px', fontSize: '12px', color: 'rgba(255,255,255,0.3)', textAlign: 'center' },
  loadingText: { padding: '24px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '14px' },

  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', padding: '24px', minWidth: '400px', maxWidth: '550px', maxHeight: '70vh', overflow: 'auto' },
  modalTitle: { fontSize: '16px', fontWeight: 700, color: '#fff', margin: '0 0 16px 0' },
  modalClose: {
    width: '100%', padding: '10px', background: 'none', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit', marginTop: '12px',
  },
  historyList: { display: 'flex', flexDirection: 'column', gap: '8px' },
  historyItem: {
    padding: '12px 14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '8px',
  },
  historyFile: { fontSize: '14px', fontWeight: 600, color: '#e2e8f0', marginBottom: '4px' },
  historyMeta: { fontSize: '12px', color: 'rgba(255,255,255,0.35)' },
};
