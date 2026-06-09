import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../../supabaseClient';
import { PLATFORM_META } from '../constants';
import { parseCSV, parseDate, parseNumber } from '../utils';
import { styles } from '../styles';

export default function TikTokCSVUpload({ profile, accounts }) {
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [csvYear, setCsvYear] = useState(new Date().getFullYear());
  const fileInputRef = useRef(null);

  const tiktokAccount = accounts.find(a => a.platform === 'tiktok');
  const color = PLATFORM_META.tiktok?.color || '#00F2EA';
  const [lastDataDate, setLastDataDate] = useState(null);

  useEffect(() => {
    if (!tiktokAccount) return;
    supabase.from('platform_daily_metrics')
      .select('date')
      .eq('platform_account_id', tiktokAccount.id)
      .gt('views', 0)
      .order('date', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data?.[0]) setLastDataDate(data[0].date);
      });
  }, [tiktokAccount?.id, uploadResult]);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file || !tiktokAccount) return;
    setUploading(true); setUploadResult(null);

    // Create ingestion log entry
    const { data: logEntry } = await supabase.from('ingestion_logs')
      .insert({ platform_account_id: tiktokAccount.id, job_type: 'manual_csv_upload_tiktok', status: 'running' })
      .select().single();

    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      if (!parsed.rows.length) throw new Error('No valid rows found');

      const rows = [];
      for (const row of parsed.rows) {
        const date = parseDate(row['Date'] || row['date'] || row['DATE'], csvYear);
        if (!date) continue;
        const views = parseNumber(row['Video Views'] || row['Views'] || row['Video views'] || row['views'] || '0');
        const likes = parseNumber(row['Likes'] || row['likes'] || '0');
        const comments = parseNumber(row['Comments'] || row['comments'] || '0');
        const shares = parseNumber(row['Shares'] || row['shares'] || '0');

        rows.push({
          platform_account_id: tiktokAccount.id,
          date,
          views: views || 0,
          likes: likes || 0,
          comments: comments || 0,
          shares: shares || 0,
          metadata: {},
        });
      }
      if (!rows.length) throw new Error('No valid rows found after parsing');

      let inserted = 0;
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const { data: result, error } = await supabase.from('platform_daily_metrics')
          .upsert(batch, { onConflict: 'platform_account_id,date' }).select();
        if (error) { console.error(error); continue; }
        inserted += result?.length || 0;
      }
      setUploadResult({ success: true, count: inserted });

      const sortedDates = rows.map(r => r.date).sort();
      if (logEntry?.id) await supabase.from('ingestion_logs').update({
        status: 'success', records_processed: rows.length, records_created: inserted, completed_at: new Date().toISOString(),
        metadata: { date_start: sortedDates[0], date_end: sortedDates[sortedDates.length - 1] },
      }).eq('id', logEntry.id);
    } catch (err) {
      setUploadResult({ error: err.message });
      if (logEntry?.id) await supabase.from('ingestion_logs').update({
        status: 'failed', error_message: err.message, completed_at: new Date().toISOString(),
      }).eq('id', logEntry.id);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  if (!tiktokAccount) return <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px', margin: 0 }}>No TikTok account found.</p>;

  return (
    <div>
      <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', margin: '0 0 10px' }}>
        Upload a CSV exported from TikTok Studio. Select the year for the data (TikTok CSVs don't include the year).
        {lastDataDate && (
          <span style={{ marginLeft: '8px', color: '#4ade80', fontWeight: 600 }}>
            Last date with data: {new Date(lastDataDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        )}
      </p>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>Year</label>
          <select value={csvYear} onChange={e => setCsvYear(Number(e.target.value))} style={{ ...styles.filterSelect, padding: '8px 10px' }}>
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
          style={{ ...styles.uploadBtn, borderColor: color + '66', color, alignSelf: 'flex-end' }}>
          {uploading ? 'Uploading...' : 'Upload TikTok CSV'}
        </button>
        <input ref={fileInputRef} type="file" accept=".csv" onChange={handleUpload} style={{ display: 'none' }} />
        {uploadResult && (
          <span style={{ fontSize: '12px', fontWeight: 500, color: uploadResult.error ? '#f87171' : '#4ade80', alignSelf: 'flex-end' }}>
            {uploadResult.error ? `Error: ${uploadResult.error}` : `${uploadResult.count} rows imported`}
          </span>
        )}
      </div>
    </div>
  );
}
