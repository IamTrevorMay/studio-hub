import { DATE_RANGES, BUCKET_DEFS } from './constants';

// Analytics dates are Pacific-anchored (same as snapshot-daily-work, Metricool,
// Google Calendar flows). Using toISOString().split('T')[0] would silently slip
// into UTC after ~16:00 PT and shift every range one day into the future.
const PT_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric', month: '2-digit', day: '2-digit',
});

export function toPTDateString(d) { return PT_DATE_FMT.format(d); }
export function todayStr() { return toPTDateString(new Date()); }
export function daysAgoStr(n) { const d = new Date(); d.setDate(d.getDate() - n); return toPTDateString(d); }

export function getMonthRange(year, month) {
  const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const end = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

export function getYearRange(year) {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export function getDateRange(rangeKey, customStart, customEnd, filterMonth, filterYear) {
  if (rangeKey === 'month') return getMonthRange(filterYear, filterMonth);
  if (rangeKey === 'year') return getYearRange(filterYear);
  if (rangeKey === 'lifetime') return { start: '2000-01-01', end: todayStr() };
  if (rangeKey === 'custom' && customStart && customEnd) {
    return { start: customStart, end: customEnd };
  }
  const preset = DATE_RANGES.find(r => r.key === rangeKey);
  const days = preset?.days || 30;
  return { start: daysAgoStr(days), end: todayStr() };
}

export function getPreviousPeriod(start, end) {
  const daysDiff = Math.ceil((new Date(end) - new Date(start)) / 86400000);
  const prevStart = daysAgoStr(daysDiff + Math.ceil((new Date() - new Date(start)) / 86400000));
  const prevEnd = new Date(new Date(start).getTime() - 86400000).toISOString().split('T')[0];
  return { start: prevStart, end: prevEnd };
}

export function pctChange(curr, prev) {
  if (prev === 0) return curr > 0 ? 100 : 0;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

export function getBucketDateRange(bucketKey, year) {
  const def = BUCKET_DEFS[bucketKey];
  if (!def) return null;
  if (def.crossesYear) {
    return {
      start: `${year}-${String(def.startMonth).padStart(2, '0')}-${String(def.startDay).padStart(2, '0')}`,
      end: `${year + 1}-${String(def.endMonth).padStart(2, '0')}-${String(def.endDay).padStart(2, '0')}`,
      label: `${year} ${def.label}`,
    };
  }
  return {
    start: `${year}-${String(def.startMonth).padStart(2, '0')}-${String(def.startDay).padStart(2, '0')}`,
    end: `${year}-${String(def.endMonth).padStart(2, '0')}-${String(def.endDay).padStart(2, '0')}`,
    label: `${year} ${def.label}`,
  };
}

export function getYearsInRange(startStr, endStr) {
  const startY = new Date(startStr).getFullYear();
  const endY = new Date(endStr).getFullYear();
  const years = [];
  for (let y = startY; y <= endY; y++) years.push(y);
  return years;
}

export function getContentTypeAccountIds(accounts, activeAccountIds, contentTypeFilter) {
  if (!contentTypeFilter || contentTypeFilter === 'all') {
    return activeAccountIds.length > 0 ? activeAccountIds : accounts.map(a => a.id);
  }
  const shortFormPlatforms = ['tiktok', 'instagram', 'facebook'];
  const longFormPlatforms = ['youtube', 'twitch'];
  const editorialPlatforms = ['substack'];
  let platforms;
  if (contentTypeFilter === 'short') platforms = shortFormPlatforms;
  else if (contentTypeFilter === 'long') platforms = longFormPlatforms;
  else if (contentTypeFilter === 'editorial') platforms = editorialPlatforms;
  else return activeAccountIds.length > 0 ? activeAccountIds : accounts.map(a => a.id);
  const filtered = accounts.filter(a => platforms.includes(a.platform));
  const ids = filtered.map(a => a.id);
  if (activeAccountIds.length > 0) return ids.filter(id => activeAccountIds.includes(id));
  return ids;
}

/** Parse a date string that may be "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS" into a local Date */
export function toLocalDate(s) {
  return new Date(String(s).slice(0, 10) + 'T00:00:00');
}

export function formatCompact(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  if (n % 1 !== 0) return n.toFixed(1);
  return n.toLocaleString();
}

export function formatCurrency(cents) {
  return '$' + (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Fetch all rows from a query, paginating past Supabase's 1000-row default limit
export async function fetchAllRows(query) {
  const PAGE = 1000;
  let allData = [];
  let from = 0;
  while (true) {
    const { data } = await query.range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    allData = allData.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return allData;
}

export function getDaysInRange(startStr, endStr) {
  const days = [];
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(d.toISOString().split('T')[0]);
  }
  return days;
}

export function getISOWeekKey(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay() + 1); // Monday
  return d.toISOString().slice(0, 10);
}

export function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  function splitRow(line) {
    const result = []; let current = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        // RFC4180 escaped quote: "" inside a quoted field is a literal "
        if (inQ && line[i + 1] === '"') { current += '"'; i++; }
        else inQ = !inQ;
      }
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

export function parseDate(val, fallbackYear) {
  if (!val) return null;
  const s = String(val).trim();
  const shortMonths = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
  const fullMonths = {january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',july:'07',august:'08',september:'09',october:'10',november:'11',december:'12'};
  // "Jan 15, 2025" or "January 15, 2025"
  const m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mm = shortMonths[m[1].toLowerCase().slice(0,3)];
    if (mm) return `${m[3]}-${mm}-${m[2].padStart(2,'0')}`;
  }
  // "January 15" or "Jan 15" (no year — use fallbackYear or current year)
  const mNoYear = s.match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (mNoYear) {
    const mm = fullMonths[mNoYear[1].toLowerCase()] || shortMonths[mNoYear[1].toLowerCase().slice(0,3)];
    if (mm) {
      const yr = fallbackYear || new Date().getFullYear();
      return `${yr}-${mm}-${mNoYear[2].padStart(2,'0')}`;
    }
  }
  // "2025-01-15"
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  // "1/15/2025" or "1-15-2025"
  const p = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (p) { const y = p[3].length===2?'20'+p[3]:p[3]; return `${y}-${p[1].padStart(2,'0')}-${p[2].padStart(2,'0')}`; }
  return null;
}

export function parseDuration(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const parts = s.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length===3) return parts[0]*3600+parts[1]*60+parts[2];
  if (parts.length===2) return parts[0]*60+parts[1];
  return null;
}

export function parseNumber(val) {
  if (val===''||val==null) return null;
  const n = Number(String(val).replace(/[,%$]/g,'').trim());
  return isNaN(n)?null:n;
}

export function mapDailyCSV(channel, parsed, userId) {
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

export function mapVideoCSV(channel, parsed, userId) {
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
