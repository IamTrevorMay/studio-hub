import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../supabaseClient';
import { callEdgeFn } from '../../../lib/edgeFn';
import { useAuth } from '../../../contexts/AuthContext';

// Ashley's weekly tactical read — the coaching band that absorbs the old weekly
// narrative. Reads versioned ashley_reads rows (generated Saturday by the
// generate-ashley-read edge fn). Admins can Refresh (insert a new working
// version) and Save (pin the selected version). Two-level disclosure only:
// L1 = one glanceable line per point, L2 = the why + fix + grounding on expand.

const SURFACE_META = {
  yt_long: { label: 'YT Long', color: '#f87171' },
  yt_short: { label: 'YT Shorts', color: '#fbbf24' },
  tiktok: { label: 'TikTok', color: '#22d3ee' },
};
const SURFACE_ORDER = ['yt_long', 'yt_short', 'tiktok'];
const SEV = {
  win: { color: '#34d399', label: 'Win' },
  watch: { color: '#fbbf24', label: 'Watch' },
  fix: { color: '#f87171', label: 'Fix' },
};

function sortPoints(points) {
  return [...(points || [])]
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const sa = SURFACE_ORDER.indexOf(a.p.surface);
      const sb = SURFACE_ORDER.indexOf(b.p.surface);
      return (sa < 0 ? 99 : sa) - (sb < 0 ? 99 : sb) || a.i - b.i;
    });
}

export default function AshleyRead({ weekStart }) {
  const { isAdmin } = useAuth();
  const [versions, setVersions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState(null);

  const fetchVersions = useCallback(async (preferId) => {
    if (!weekStart) return;
    const { data, error } = await supabase
      .from('ashley_reads')
      .select('*')
      .eq('week_start', weekStart)
      .order('version_number', { ascending: false });
    if (!error) {
      setVersions(data || []);
      setSelectedId((prev) => preferId || prev || (data && data[0] ? data[0].id : null));
    }
    setLoading(false);
  }, [weekStart]);

  // Reset selection when the viewed week changes, then load that week's versions.
  useEffect(() => {
    setLoading(true);
    setSelectedId(null);
    setExpandedIdx(null);
    fetchVersions();
  }, [fetchVersions]);

  const selected = versions.find((v) => v.id === selectedId) || versions[0] || null;

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await callEdgeFn('generate-ashley-read', { week_start: weekStart });
      // Newly inserted version is the highest version_number → select it.
      const { data } = await supabase
        .from('ashley_reads')
        .select('*')
        .eq('week_start', weekStart)
        .order('version_number', { ascending: false });
      setVersions(data || []);
      setSelectedId(data && data[0] ? data[0].id : null);
      setExpandedIdx(null);
    } catch (err) {
      console.error('Ashley refresh failed:', err);
      window.alert(err.message || 'Refresh failed');
    }
    setRefreshing(false);
  };

  const handleSave = async () => {
    if (saving || !selected || selected.is_saved) return;
    setSaving(true);
    const { error } = await supabase
      .from('ashley_reads')
      .update({ is_saved: true })
      .eq('id', selected.id);
    if (error) { console.error('Ashley save failed:', error); window.alert(error.message || 'Save failed'); }
    else await fetchVersions(selected.id);
    setSaving(false);
  };

  if (loading) return <div style={styles.card}><p style={styles.loading}>Loading Ashley’s read…</p></div>;

  const meta = selected?.meta || {};
  const points = sortPoints(selected?.points);
  // Stale = the selected read was generated before the data-settling cutoff
  // (week_end + 2 days), so newer data may exist than what Ashley analyzed.
  const stale = selected && selected.generated_at && selected.week_end &&
    new Date(selected.generated_at) < new Date(new Date(selected.week_end + 'T00:00:00Z').getTime() + 2 * 864e5);

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <span style={styles.brand}>▸ Ashley — this week’s read</span>
        {versions.length > 0 && (
          <select
            value={selected?.id || ''}
            onChange={(e) => { setSelectedId(e.target.value); setExpandedIdx(null); }}
            style={styles.select}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version_number} · {v.is_saved ? (v.label ? `saved: ${v.label}` : 'saved ✓') : 'working'} · {v.generated_at ? new Date(v.generated_at).toLocaleDateString() : ''}
              </option>
            ))}
          </select>
        )}
        {selected && stale && <span style={styles.staleChip}>⟳ data may be newer than this read</span>}
        <div style={styles.headerActions}>
          {isAdmin && selected && (
            <button onClick={handleSave} disabled={saving || selected.is_saved} style={styles.saveBtn}>
              {selected.is_saved ? '✓ Saved' : saving ? 'Saving…' : 'Save'}
            </button>
          )}
          {isAdmin && (
            <button onClick={handleRefresh} disabled={refreshing} style={styles.refreshBtn}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
        </div>
      </div>

      {!selected ? (
        <p style={styles.empty}>
          {isAdmin ? 'No read yet. Generates Saturday, or click Refresh.' : 'No read yet. Generates Saturday.'}
        </p>
      ) : meta.generation_failed ? (
        <div style={styles.failBanner}>Ashley’s read was unavailable for this week. The next Refresh will retry.</div>
      ) : (
        <>
          {selected.headline && <div style={styles.headline}>{selected.headline}</div>}
          {meta.ctr_available === false && (
            <div style={styles.hint}>CTR not measured this period — upload the YouTube Studio CSV to unlock title/thumbnail reads.</div>
          )}
          {points.length === 0 ? (
            <p style={styles.empty}>No points in this read.</p>
          ) : (
            <div style={styles.points}>
              {points.map(({ p, i }) => {
                const sm = SURFACE_META[p.surface] || { label: p.surface, color: '#94a3b8' };
                const sev = SEV[p.severity] || { color: '#94a3b8', label: p.severity };
                const open = expandedIdx === i;
                return (
                  <div key={i} style={{ ...styles.point, borderLeftColor: sev.color }}>
                    <button
                      style={styles.pointHead}
                      onClick={() => setExpandedIdx(open ? null : i)}
                      aria-expanded={open}
                    >
                      <span style={{ ...styles.surfaceChip, color: sm.color, borderColor: sm.color + '55' }}>{sm.label}</span>
                      <span style={{ ...styles.sevDot, background: sev.color }} />
                      <span style={styles.pointTitle}>{p.title}</span>
                      {p.metric && <span style={styles.pointMetric}>{p.metric}</span>}
                      <span style={styles.caret}>{open ? '▲' : '▼'}</span>
                    </button>
                    {open && (
                      <div style={styles.pointBody}>
                        <p style={styles.detail}>{p.detail}</p>
                        <div style={styles.footer}>
                          {p.source_doc && <span>{p.source_doc}</span>}
                          {p.benchmark_date && <span> · benchmark {p.benchmark_date}</span>}
                        </div>
                        {p.suggested_action?.task_title && (
                          <div style={styles.suggested}>
                            <span style={styles.suggestedLabel}>Suggested:</span> {p.suggested_action.task_title}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div style={styles.generatedAt}>
            {selected.generated_by === 'cron' ? 'Auto-generated' : 'Refreshed'} {selected.generated_at ? new Date(selected.generated_at).toLocaleString() : ''}
          </div>
        </>
      )}
    </div>
  );
}

const styles = {
  card: { background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.18)', borderRadius: 10, padding: 16, marginBottom: 16 },
  header: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 },
  brand: { fontSize: 13, fontWeight: 700, color: '#c7d2fe', textTransform: 'uppercase', letterSpacing: '0.5px' },
  select: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#e7ebf2', fontSize: 12, padding: '5px 8px', fontFamily: 'inherit', cursor: 'pointer' },
  staleChip: { fontSize: 11, color: '#fbbf24', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 6, padding: '3px 7px' },
  headerActions: { marginLeft: 'auto', display: 'flex', gap: 8 },
  saveBtn: { padding: '6px 12px', background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 8, color: '#6ee7b7', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  refreshBtn: { padding: '6px 14px', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 8, color: '#a5b4fc', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  headline: { color: '#e7ebf2', fontSize: 15, fontWeight: 600, lineHeight: 1.45, marginBottom: 14 },
  hint: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 10, fontStyle: 'italic' },
  points: { display: 'flex', flexDirection: 'column', gap: 8 },
  point: { background: 'rgba(255,255,255,0.03)', borderLeft: '3px solid', borderRadius: 6, overflow: 'hidden' },
  pointHead: { display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit', flexWrap: 'wrap' },
  surfaceChip: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', border: '1px solid', borderRadius: 5, padding: '1px 6px', flexShrink: 0 },
  sevDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  pointTitle: { fontSize: 13.5, fontWeight: 600, color: '#e7ebf2', flex: 1, minWidth: 160 },
  pointMetric: { fontSize: 11.5, color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums' },
  caret: { fontSize: 10, color: 'rgba(255,255,255,0.35)', flexShrink: 0 },
  pointBody: { padding: '0 12px 12px 12px' },
  detail: { fontSize: 13, color: 'rgba(255,255,255,0.78)', lineHeight: 1.55, margin: '0 0 8px' },
  footer: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 8 },
  suggested: { fontSize: 12.5, color: 'rgba(255,255,255,0.72)', background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: '8px 10px' },
  suggestedLabel: { color: '#a5b4fc', fontWeight: 600 },
  loading: { color: 'rgba(255,255,255,0.42)', fontSize: 13, margin: 0 },
  empty: { color: 'rgba(255,255,255,0.42)', fontSize: 13, margin: 0 },
  failBanner: { background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, padding: '10px 14px', color: '#fbbf24', fontSize: 13 },
  generatedAt: { color: 'rgba(255,255,255,0.35)', fontSize: 11, textAlign: 'right', marginTop: 10 },
};
