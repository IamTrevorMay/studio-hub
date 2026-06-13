import React, { useMemo, useState } from 'react';
import { supabase } from '../../../supabaseClient';

// CSV → mailer_subscribers (+ optional audience attach).
// Header row required. Recognized columns: email (required), name,
// source, plus anything else gets folded into custom_fields jsonb.
//
// Parser is intentionally small — handles "quoted, commas" + escaped
// quotes ("") + CR/LF line endings. Doesn't try to be RFC 4180-perfect
// (no multi-line quoted cells), which is enough for the manual paste
// + small-file workflow this modal exists for.

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 0 && r.some((c) => c.trim() !== ''));
}

function isEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export default function CsvImportModal({ open, onClose, audiences, onImported }) {
  const [audienceId, setAudienceId] = useState('');
  const [text, setText] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    const rows = parseCsv(text);
    if (rows.length === 0) return null;
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const emailIdx = header.indexOf('email');
    if (emailIdx === -1) {
      return { error: 'CSV must include an "email" column in the header row.' };
    }
    const nameIdx = header.indexOf('name');
    const sourceIdx = header.indexOf('source');
    const extraIdxs = header
      .map((h, i) => ({ h, i }))
      .filter(({ h, i }) => i !== emailIdx && i !== nameIdx && i !== sourceIdx && h);
    const items = [];
    const skipped = [];
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      const email = (cells[emailIdx] || '').trim().toLowerCase();
      if (!isEmail(email)) { skipped.push({ email, reason: 'invalid email' }); continue; }
      const custom = {};
      for (const { h, i } of extraIdxs) {
        const v = (cells[i] || '').trim();
        if (v) custom[h] = v;
      }
      items.push({
        email,
        name: nameIdx >= 0 ? (cells[nameIdx] || '').trim() || null : null,
        source: sourceIdx >= 0 ? (cells[sourceIdx] || '').trim() || null : null,
        custom_fields: custom,
      });
    }
    return { items, skipped, total: rows.length - 1 };
  }, [text]);

  async function runImport() {
    if (!parsed || parsed.error || !parsed.items.length) return;
    setImporting(true); setError(null); setResult(null);
    try {
      // Upsert subscribers by email. Existing rows keep their status —
      // a re-import should not un-suppress someone who unsubscribed.
      const { data: upserted, error: upErr } = await supabase
        .from('mailer_subscribers')
        .upsert(parsed.items, { onConflict: 'email', ignoreDuplicates: false })
        .select('id, email');
      if (upErr) throw upErr;

      let added = 0;
      if (audienceId && upserted && upserted.length > 0) {
        const rows = upserted.map((s) => ({ audience_id: audienceId, subscriber_id: s.id }));
        const { error: joinErr } = await supabase
          .from('mailer_audience_subscribers')
          .upsert(rows, { onConflict: 'audience_id,subscriber_id', ignoreDuplicates: true });
        if (joinErr) throw joinErr;
        added = rows.length;
      }

      setResult({ imported: upserted?.length || 0, joined: added, skipped: parsed.skipped.length });
      if (onImported) onImported();
    } catch (e) {
      setError(e.message);
    } finally {
      setImporting(false);
    }
  }

  if (!open) return null;
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>Import subscribers from CSV</h2>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        <div style={styles.body}>
          <div style={styles.help}>
            Paste rows below or use the file picker. First row must be the header.
            Recognized columns: <code>email</code> (required), <code>name</code>, <code>source</code>.
            Unknown columns become <code>custom_fields</code> entries.
          </div>
          <label style={styles.fileBtn}>
            Choose CSV file…
            <input
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const reader = new FileReader();
                reader.onload = () => setText(String(reader.result || ''));
                reader.readAsText(f);
                e.target.value = '';
              }}
            />
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'email,name\nada@example.com,Ada Lovelace\nalan@example.com,Alan Turing'}
            style={styles.textarea}
            spellCheck={false}
          />

          <label style={styles.audienceRow}>
            <span style={styles.label}>Add to audience</span>
            <select value={audienceId} onChange={(e) => setAudienceId(e.target.value)} style={styles.select}>
              <option value="">— None —</option>
              {(audiences || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>

          {parsed && parsed.error && <div style={styles.error}>{parsed.error}</div>}
          {parsed && !parsed.error && (
            <div style={styles.preview}>
              <div>{parsed.items.length} ready to import · {parsed.skipped.length} skipped (invalid email)</div>
              {parsed.skipped.length > 0 && (
                <div style={{ marginTop: 4, color: '#f87171', fontSize: 11 }}>
                  Skipped: {parsed.skipped.slice(0, 5).map((s) => s.email || '(blank)').join(', ')}
                  {parsed.skipped.length > 5 ? `… (+${parsed.skipped.length - 5} more)` : ''}
                </div>
              )}
            </div>
          )}
          {error && <div style={styles.error}>{error}</div>}
          {result && (
            <div style={styles.success}>
              Imported {result.imported} · added to audience: {result.joined} · skipped: {result.skipped}
            </div>
          )}
        </div>
        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onClose}>Close</button>
          <button
            style={{ ...styles.primaryBtn, opacity: parsed && !parsed.error && parsed.items.length > 0 && !importing ? 1 : 0.5 }}
            disabled={!parsed || parsed.error || parsed.items.length === 0 || importing}
            onClick={runImport}
          >
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 },
  modal: { background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, width: 'min(620px, 92vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  title: { fontSize: 18, fontWeight: 700, color: '#fff', margin: 0 },
  closeBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 26, cursor: 'pointer', padding: 0 },
  body: { padding: '16px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 24px', borderTop: '1px solid rgba(255,255,255,0.06)' },
  help: { fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 },
  fileBtn: { display: 'inline-block', padding: '6px 12px', fontSize: 12, fontWeight: 600, color: '#c7d2fe', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6, cursor: 'pointer', alignSelf: 'flex-start' },
  textarea: { background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '10px', color: '#fff', fontSize: 12, fontFamily: 'monospace', minHeight: 160, outline: 'none', resize: 'vertical' },
  audienceRow: { display: 'flex', alignItems: 'center', gap: 10 },
  label: { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', letterSpacing: 0.4, textTransform: 'uppercase', minWidth: 130 },
  select: { background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '7px 10px', color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'inherit', flex: 1 },
  preview: { padding: 10, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 6, color: '#c7d2fe', fontSize: 12 },
  error: { padding: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', borderRadius: 6, fontSize: 12 },
  success: { padding: 10, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#86efac', borderRadius: 6, fontSize: 12 },
  primaryBtn: { background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  cancelBtn: { background: 'transparent', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
};
