import React, { useEffect, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import { listMarkers, createMarker, updateMarker, deleteMarker } from './api';

// Per-session clip marker list. The producer drops markers at notable
// moments; the editor pulls them later. Time is tracked as elapsed
// seconds since session.started_at.

export default function ClipMarkerPanel({ session }) {
  const [markers, setMarkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function load() {
    setLoading(true); setError(null);
    try { const res = await listMarkers(session.id); setMarkers(res.markers || []); }
    catch (e) { setError(e.message); }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [session.id]);

  function elapsedSec() {
    if (!session.started_at) return 0;
    return Math.max(0, Math.floor((now - new Date(session.started_at).getTime()) / 1000));
  }

  async function drop(type) {
    const start = elapsedSec();
    try {
      await createMarker({
        session_id: session.id,
        title: type === 'short' ? 'Short clip' : type === 'long' ? 'Long clip' : 'Marker',
        start_time: start,
        end_time: type === 'short' ? start + 30 : type === 'long' ? start + 120 : null,
        clip_type: type,
        sort_order: markers.length,
      });
      await load();
    } catch (e) { setError(e.message); }
  }

  async function patch(m, p) {
    setMarkers(markers.map((x) => (x.id === m.id ? { ...x, ...p } : x)));
    try { await updateMarker(m.id, p); }
    catch (e) { setError(e.message); await load(); }
  }
  async function del(m) {
    try { await deleteMarker(m.id); await load(); }
    catch (e) { setError(e.message); }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.headerRow}>
        <div style={styles.title}>Clip markers</div>
        <span style={styles.clock}>{fmt(elapsedSec())}</span>
      </div>
      <div style={styles.btnRow}>
        <button onClick={() => drop('short')} style={{ ...styles.btn, background: colors.accent }}>+ Short (30s)</button>
        <button onClick={() => drop('long')}  style={{ ...styles.btn, background: colors.warning.fg }}>+ Long (2m)</button>
        <button onClick={() => drop('point')} style={{ ...styles.btn, background: colors.bgInput, color: colors.text }}>+ Point</button>
      </div>
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.list}>
        {loading ? <div style={styles.empty}>Loading…</div>
          : markers.length === 0 ? <div style={styles.empty}>No markers yet.</div>
          : markers.map((m) => (
            <div key={m.id} style={styles.row}>
              <div style={styles.timeChip}>{fmt(m.start_time)}{m.end_time != null ? ` → ${fmt(m.end_time)}` : ''}</div>
              <input
                value={m.title || ''} onChange={(e) => patch(m, { title: e.target.value })}
                style={{ ...styles.input, flex: 1 }} placeholder="Title"
              />
              <button onClick={() => del(m)} style={styles.delBtn}>×</button>
            </div>
          ))}
      </div>
    </div>
  );
}

function fmt(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${m}:${String(ss).padStart(2, '0')}`;
}

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', gap: spacing.xs, padding: spacing.md, overflow: 'hidden' },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: fontSizes.sm, fontWeight: fontWeights.semibold, color: colors.text },
  clock: { fontFamily: 'monospace', fontSize: fontSizes.sm, color: colors.accentFg },
  btnRow: { display: 'flex', gap: spacing.xs },
  btn: {
    flex: 1, padding: `${spacing.xs}px ${spacing.sm}px`,
    color: '#fff', border: 'none', borderRadius: radii.sm,
    fontSize: fontSizes.xxs, fontWeight: fontWeights.medium, cursor: 'pointer', fontFamily: 'inherit',
  },
  error: { padding: spacing.xs, background: colors.danger.bg, color: colors.danger.fg, borderRadius: radii.sm, fontSize: fontSizes.xxs },
  list: { flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: spacing.xs },
  empty: { padding: spacing.md, textAlign: 'center', color: colors.textSubtle, fontSize: fontSizes.xs },
  row: { display: 'flex', alignItems: 'center', gap: spacing.xs, padding: spacing.xs, background: colors.bgRaised, border: `1px solid ${colors.border}`, borderRadius: radii.sm },
  timeChip: { fontFamily: 'monospace', fontSize: fontSizes.xxs, color: colors.textMuted, minWidth: 60 },
  input: {
    padding: `${spacing.xs}px ${spacing.sm}px`, background: colors.bgInput,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.text, fontSize: fontSizes.xs, fontFamily: 'inherit', outline: 'none',
  },
  delBtn: { width: 22, height: 22, borderRadius: radii.sm, background: 'transparent', border: `1px solid ${colors.border}`, color: colors.danger.fg, cursor: 'pointer', fontSize: 12 },
};
