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
  const { isAdmin, profile } = useAuth();
  const [versions, setVersions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [assignees, setAssignees] = useState([]);
  const [initiatives, setInitiatives] = useState([]);

  // Admin-only: options for the per-point action controls (assignee + BD initiative).
  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    (async () => {
      const { data: profs } = await supabase
        .from('profiles').select('id, full_name, nickname, role')
        .in('role', ['admin', 'assistant', 'member']).order('full_name');
      const { data: inits } = await supabase
        .from('bd_initiatives').select('id, title, workstream')
        .is('completed_at', null).order('title');
      if (!alive) return;
      setAssignees((profs || []).map((p) => ({ id: p.id, name: p.full_name || p.nickname || 'Unknown' })));
      setInitiatives(inits || []);
    })();
    return () => { alive = false; };
  }, [isAdmin]);

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

  // Write an action's result back into the selected version's points jsonb.
  // Because reads are versioned + Save-pinnable, this state is durable per version.
  const applyAction = async (origIdx, patch) => {
    if (!selected) return;
    const full = { ...patch, action_at: new Date().toISOString() };
    const newPoints = (selected.points || []).map((pt, k) => (k === origIdx ? { ...pt, ...full } : pt));
    const { error } = await supabase.from('ashley_reads').update({ points: newPoints }).eq('id', selected.id);
    if (error) { window.alert(error.message || 'Could not record action'); return; }
    setVersions((vs) => vs.map((v) => (v.id === selected.id ? { ...v, points: newPoints } : v)));
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
                        <PointAction
                          point={p}
                          origIdx={i}
                          isAdmin={isAdmin}
                          assignees={assignees}
                          initiatives={initiatives}
                          currentUserId={profile?.id}
                          onActioned={applyAction}
                        />
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

// Per-point INSIGHT → ACTION control. Turns a point into a task (assign-task
// edge fn) or logs it as a Business Dev decision (bd_tasks insert), then reports
// the result up so the parent can write action_* back into the version's points.
function PointAction({ point, origIdx, isAdmin, assignees, initiatives, currentUserId, onActioned }) {
  const sa = point.suggested_action || {};
  const [mode, setMode] = useState(null); // null | 'task' | 'decision'
  const [title, setTitle] = useState(sa.task_title || '');
  const [assigneeId, setAssigneeId] = useState(currentUserId || '');
  const [initiativeId, setInitiativeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);

  if (point.action_status && point.action_status !== 'none') {
    const tasked = point.action_status === 'tasked';
    return (
      <div style={styles.actioned}>
        ✓ {tasked ? 'Tasked' : 'Logged as decision'}
        <span style={styles.actionedHint}>{tasked ? ' — see My Tasks' : ' — see Business Dev'}</span>
      </div>
    );
  }
  if (!isAdmin) {
    return sa.task_title
      ? <div style={styles.suggested}><span style={styles.suggestedLabel}>Suggested:</span> {sa.task_title}</div>
      : null;
  }

  const submitTask = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const notes = `${sa.task_notes || ''} — via Ashley (${point.surface})`.trim();
      const res = await callEdgeFn('assign-task', {
        op: 'create',
        title: title.trim(),
        assignee_ids: [assigneeId || currentUserId],
        notes,
        due_date: dueDate || null,
        link_url: sa.link_url || null,
      });
      await onActioned(origIdx, {
        action_status: 'tasked', action_type: 'task',
        action_target_id: res?.created_task_ids?.[0] || null,
      });
    } catch (e) { window.alert(e.message || 'Failed to create task'); }
    setBusy(false);
  };

  const submitDecision = async () => {
    if (!title.trim() || !initiativeId || busy) return;
    setBusy(true);
    try {
      const notes = `${sa.task_notes || ''} — logged from Ashley Analytics read`.trim();
      const { data, error } = await supabase.from('bd_tasks').insert({
        initiative_id: initiativeId,
        title: title.trim(),
        notes,
        owner_id: currentUserId,
        due_date: dueDate || null,
      }).select('id').single();
      if (error) throw error;
      await onActioned(origIdx, {
        action_status: 'logged', action_type: 'decision',
        action_target_id: data?.id || null,
      });
    } catch (e) { window.alert(e.message || 'Failed to log decision'); }
    setBusy(false);
  };

  if (!mode) {
    return (
      <div style={styles.actionBar}>
        {sa.task_title && <span style={styles.suggestedInline}>{sa.task_title}</span>}
        <div style={styles.actionBtns}>
          <button style={styles.taskBtn} onClick={() => setMode('task')}>→ Task</button>
          <button
            style={{ ...styles.decisionBtn, ...(initiatives.length ? {} : styles.btnDisabled) }}
            disabled={!initiatives.length}
            title={initiatives.length ? '' : 'Create a Business Dev initiative first'}
            onClick={() => setMode('decision')}
          >⚑ Log as decision</button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.form}>
      <input style={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
      {mode === 'task' ? (
        <select style={styles.input} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
          {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      ) : (
        <select style={styles.input} value={initiativeId} onChange={(e) => setInitiativeId(e.target.value)}>
          <option value="">Select initiative…</option>
          {initiatives.map((it) => <option key={it.id} value={it.id}>{it.title}</option>)}
        </select>
      )}
      <input style={styles.input} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      <div style={styles.formBtns}>
        <button style={styles.cancelBtn} onClick={() => setMode(null)} disabled={busy}>Cancel</button>
        <button
          style={styles.confirmBtn}
          onClick={mode === 'task' ? submitTask : submitDecision}
          disabled={busy || !title.trim() || (mode === 'decision' && !initiativeId)}
        >{busy ? 'Saving…' : mode === 'task' ? 'Create task' : 'Log decision'}</button>
      </div>
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
  actionBar: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: '8px 10px' },
  suggestedInline: { fontSize: 12.5, color: 'rgba(255,255,255,0.72)', flex: 1, minWidth: 140 },
  actionBtns: { display: 'flex', gap: 6, marginLeft: 'auto' },
  taskBtn: { padding: '5px 10px', background: 'rgba(99,102,241,0.14)', border: '1px solid rgba(99,102,241,0.32)', borderRadius: 6, color: '#a5b4fc', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' },
  decisionBtn: { padding: '5px 10px', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 6, color: '#fcd34d', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' },
  btnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
  form: { display: 'flex', flexWrap: 'wrap', gap: 8, background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: 10, alignItems: 'center' },
  input: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#e7ebf2', fontSize: 12.5, padding: '6px 9px', fontFamily: 'inherit', flex: '1 1 140px', minWidth: 120 },
  formBtns: { display: 'flex', gap: 6, marginLeft: 'auto' },
  cancelBtn: { padding: '6px 12px', background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  confirmBtn: { padding: '6px 12px', background: 'rgba(52,211,153,0.14)', border: '1px solid rgba(52,211,153,0.32)', borderRadius: 6, color: '#6ee7b7', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  actioned: { fontSize: 12.5, fontWeight: 600, color: '#6ee7b7', background: 'rgba(52,211,153,0.08)', borderRadius: 6, padding: '8px 10px' },
  actionedHint: { color: 'rgba(255,255,255,0.45)', fontWeight: 400 },
  loading: { color: 'rgba(255,255,255,0.42)', fontSize: 13, margin: 0 },
  empty: { color: 'rgba(255,255,255,0.42)', fontSize: 13, margin: 0 },
  failBanner: { background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, padding: '10px 14px', color: '#fbbf24', fontSize: 13 },
  generatedAt: { color: 'rgba(255,255,255,0.35)', fontSize: 11, textAlign: 'right', marginTop: 10 },
};
