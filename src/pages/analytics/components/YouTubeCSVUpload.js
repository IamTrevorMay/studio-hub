import React, { useState, useRef } from 'react';
import { supabase } from '../../../supabaseClient';
import { parseCSV, mapDailyCSV, mapVideoCSV } from '../utils';
import { styles } from '../styles';

const YT_CSV_PLATFORMS = [
  { key: 'youtube_trevormay', label: 'Trevor May Baseball', channel: 'trevormay', color: '#ff0000' },
  { key: 'youtube_moremayday', label: 'More Mayday', channel: 'moremayday', color: '#ff4444' },
];

export default function YouTubeCSVUpload({ profile }) {
  const [csvPlatform, setCsvPlatform] = useState(YT_CSV_PLATFORMS[0].key);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const fileInputRef = useRef(null);
  const videoFileInputRef = useRef(null);

  const platform = YT_CSV_PLATFORMS.find(p => p.key === csvPlatform);

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
    } catch (err) { setUploadResult({ error: err.message }); }
    setUploading(false);
    if (videoFileInputRef.current) videoFileInputRef.current.value = '';
  }

  return (
    <div style={{ padding: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', marginTop: '8px' }}>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        {YT_CSV_PLATFORMS.map(p => (
          <button key={p.key} onClick={() => setCsvPlatform(p.key)}
            style={{
              ...styles.filterChip,
              ...(csvPlatform === p.key ? { background: p.color + '22', borderColor: p.color + '66', color: p.color } : {}),
            }}>
            {p.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        {uploadResult && (
          <span style={{ fontSize: '12px', fontWeight: 500, color: uploadResult.error ? '#f87171' : '#4ade80' }}>
            {uploadResult.error ? `Error: ${uploadResult.error}` : `${uploadResult.count} ${uploadResult.type} rows imported`}
          </span>
        )}
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
          style={{ ...styles.uploadBtn, borderColor: (platform?.color || '#666') + '66', color: platform?.color || '#666' }}>
          {uploading ? 'Uploading...' : 'Upload Daily CSV'}
        </button>
        <input ref={fileInputRef} type="file" accept=".csv" onChange={handleDailyUpload} style={{ display: 'none' }} />
        <button onClick={() => videoFileInputRef.current?.click()} disabled={uploading}
          style={{ ...styles.uploadBtn, borderColor: (platform?.color || '#666') + '66', color: platform?.color || '#666' }}>
          {uploading ? 'Uploading...' : 'Upload Video CSV'}
        </button>
        <input ref={videoFileInputRef} type="file" accept=".csv" onChange={handleVideoUpload} style={{ display: 'none' }} />
      </div>
    </div>
  );
}
