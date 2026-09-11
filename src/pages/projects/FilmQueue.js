import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import useVisibilityRefresh from '../../hooks/useVisibilityRefresh';
import backdropDismiss from '../../lib/backdropDismiss';
import {
  packSession,
  orderTheLine,
  queueTypeLabel,
  queueTypeColor,
  defaultMinutesFor,
  STATUS_BY_VALUE,
  SESSION_MINUTES_LIMIT,
  SESSION_ITEM_LIMIT,
} from '../../lib/filmQueue';
import { colors } from '../../lib/styleTokens';

const STAFF_PICKER_ROLES = ['admin', 'director', 'director_creative', 'director_comms', 'member'];

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtSessionDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

// The Film Queue view: counts up top, the packed next session, then the line
// of approved-but-unpacked items. Writer/editor assignments are edited here
// (admins), and only here — never on the beat sheet.
export default function FilmQueue({ onNavigate }) {
  const { profile, isAdmin } = useAuth();
  const [items, setItems] = useState([]); // film_queue_items + embedded sheet
  const [sessions, setSessions] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openItemId, setOpenItemId] = useState(null);
  const [showInEdit, setShowInEdit] = useState(false);
  const [savingDate, setSavingDate] = useState(false);

  const fetchAll = useCallback(async () => {
    const [itemsRes, sessionsRes, profilesRes] = await Promise.all([
      supabase
        .from('film_queue_items')
        .select('*, sheet:beat_sheets(id, title, status, estimated_minutes, approved_at, film_date)')
        .in('state', ['queued', 'filmed'])
        .order('created_at', { ascending: true }),
      supabase
        .from('film_sessions')
        .select('*')
        .or(`locked_at.is.null,session_date.gte.${todayIso()}`)
        .order('session_date', { ascending: true }),
      supabase
        .from('profiles')
        .select('id, full_name, email, role, deactivated_at')
        .in('role', STAFF_PICKER_ROLES)
        .order('full_name', { ascending: true, nullsFirst: false }),
    ]);
    if (itemsRes.error) console.error('Error loading film queue:', itemsRes.error);
    else setItems(itemsRes.data || []);
    if (sessionsRes.error) console.error('Error loading sessions:', sessionsRes.error);
    else setSessions(sessionsRes.data || []);
    if (profilesRes.error) console.error('Error loading profiles:', profilesRes.error);
    else setProfiles(profilesRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useVisibilityRefresh(fetchAll);

  const nameOf = useCallback((id) => {
    if (!id) return '—';
    const p = profiles.find((x) => x.id === id);
    return p?.full_name || p?.email || 'Unknown';
  }, [profiles]);
  const pickerProfiles = useMemo(() => profiles.filter((p) => !p.deactivated_at), [profiles]);

  // Line items enriched with the fields the packer reads.
  const queueItems = useMemo(() => items
    .filter((i) => i.state === 'queued' && i.sheet)
    .map((i) => ({
      ...i,
      estimated_minutes: i.sheet.estimated_minutes ?? defaultMinutesFor(i.queue_type),
      approved_at: i.sheet.approved_at,
    })), [items]);
  const inEditItems = useMemo(() => items.filter((i) => i.state === 'filmed'), [items]);

  const draftingCount = queueItems.filter((i) => i.sheet.status === 'drafting').length;
  const reviewCount = queueItems.filter((i) => i.sheet.status === 'ready_for_review').length;

  // The session on display: the locked session for today (shoot morning), or
  // the next unlocked one. Before the 6am lock the pack is derived; after it,
  // membership is stamped on the rows.
  const lockedToday = sessions.find((s) => s.locked_at && s.session_date === todayIso());
  const upcomingUnlocked = sessions.find((s) => !s.locked_at);
  const displaySession = lockedToday || upcomingUnlocked || null;
  const sessionLocked = !!displaySession?.locked_at;

  const approvedUnpacked = useMemo(
    () => queueItems.filter((i) => i.sheet.status === 'approved' && !i.session_id),
    [queueItems],
  );

  const { sessionRows, lineRows, packedMinutes } = useMemo(() => {
    if (sessionLocked) {
      const rows = queueItems
        .filter((i) => i.session_id === displaySession.id)
        .sort((a, b) => (a.slate_order || 0) - (b.slate_order || 0));
      const minutes = rows.reduce((s, i) => s + (Number(i.estimated_minutes) || 0), 0);
      return { sessionRows: rows, lineRows: orderTheLine(approvedUnpacked), packedMinutes: minutes };
    }
    const { packed, remaining, totalMinutes } = packSession(approvedUnpacked);
    return { sessionRows: displaySession ? packed : [], lineRows: displaySession ? remaining : orderTheLine(approvedUnpacked), packedMinutes: totalMinutes };
  }, [queueItems, approvedUnpacked, displaySession, sessionLocked]);

  async function setSessionDate(dateStr) {
    if (!dateStr || savingDate) return;
    setSavingDate(true);
    const existing = upcomingUnlocked;
    const query = existing
      ? supabase.from('film_sessions').update({ session_date: dateStr }).eq('id', existing.id)
      : supabase.from('film_sessions').insert({ session_date: dateStr, created_by: profile?.id || null });
    const { error } = await query;
    if (error) {
      console.error('Error saving session date:', error);
      alert(`Could not save session date: ${error.message}`);
    }
    await fetchAll();
    setSavingDate(false);
  }

  async function saveItem(item, patch) {
    const queuePatch = {};
    if ('writer_id' in patch) queuePatch.writer_id = patch.writer_id || null;
    if ('editor_id' in patch) queuePatch.editor_id = patch.editor_id || null;
    if (Object.keys(queuePatch).length > 0) {
      const { error } = await supabase
        .from('film_queue_items')
        .update({ ...queuePatch, updated_at: new Date().toISOString() })
        .eq('id', item.id);
      if (error) { alert(`Could not save: ${error.message}`); return; }
    }
    if ('estimated_minutes' in patch) {
      const minutes = Math.max(1, Math.round(Number(patch.estimated_minutes) || 0));
      const { error } = await supabase
        .from('beat_sheets')
        .update({ estimated_minutes: minutes })
        .eq('id', item.beat_sheet_id);
      if (error) { alert(`Could not save minutes: ${error.message}`); return; }
    }
    fetchAll();
  }

  const openItem = openItemId ? items.find((i) => i.id === openItemId) : null;

  function renderRow(item, index, showSlate) {
    const status = STATUS_BY_VALUE[item.sheet.status] || STATUS_BY_VALUE.drafting;
    return (
      <div
        key={item.id}
        style={styles.row}
        onClick={() => setOpenItemId(item.id)}
        title="Open item"
      >
        <span style={styles.slateCell}>{showSlate ? index + 1 : ''}</span>
        <span style={styles.titleCell}>{item.sheet.title}</span>
        <span>
          <span style={{ ...styles.typeChip, background: `${queueTypeColor(item.queue_type)}26`, color: queueTypeColor(item.queue_type), borderColor: `${queueTypeColor(item.queue_type)}55` }}>
            {queueTypeLabel(item.queue_type)}
          </span>
        </span>
        <span style={styles.minutesCell}>{item.estimated_minutes}m</span>
        <span style={styles.personCell}>{nameOf(item.writer_id)}</span>
        <span style={styles.personCell}>{nameOf(item.editor_id)}</span>
        <span>
          <span style={{ ...styles.statusChip, background: `${status.color}22`, color: status.color, borderColor: `${status.color}55` }}>
            {status.label}
          </span>
        </span>
      </div>
    );
  }

  if (loading) return <p style={styles.emptyText}>Loading film queue...</p>;

  return (
    <div style={styles.wrap}>
      {/* ── Counts ── */}
      <div style={styles.countsRow}>
        <div style={styles.countCard}>
          <span style={styles.countValue}>{draftingCount}</span>
          <span style={styles.countLabel}>drafting</span>
        </div>
        <div style={styles.countCard}>
          <span style={{ ...styles.countValue, color: colors.gold }}>{reviewCount}</span>
          <span style={styles.countLabel}>awaiting review</span>
        </div>
      </div>

      {/* ── Next session ── */}
      <section style={{ ...styles.section, ...styles.sessionSection }}>
        <div style={styles.sectionHeader}>
          <span style={{ ...styles.sectionTitle, color: colors.accentFg }}>Next Session</span>
          {displaySession ? (
            <>
              <span style={styles.sessionDate}>{fmtSessionDate(displaySession.session_date)}</span>
              {sessionLocked && <span style={styles.lockedBadge}>Locked</span>}
              <span style={styles.sessionStats}>
                {packedMinutes} / {SESSION_MINUTES_LIMIT} min · {sessionRows.length} / {SESSION_ITEM_LIMIT} items
              </span>
            </>
          ) : (
            <span style={styles.sessionStats}>No session scheduled</span>
          )}
          <div style={{ flex: 1 }} />
          {isAdmin && !sessionLocked && (
            <label style={styles.dateLabel}>
              {displaySession ? 'Session date' : 'Set session date'}
              <input
                type="date"
                value={displaySession?.session_date || ''}
                min={todayIso()}
                disabled={savingDate}
                onChange={(e) => setSessionDate(e.target.value)}
                style={styles.dateInput}
              />
            </label>
          )}
          {isAdmin && sessionLocked && !upcomingUnlocked && (
            <label style={styles.dateLabel}>
              Next session date
              <input
                type="date"
                value=""
                min={todayIso()}
                disabled={savingDate}
                onChange={(e) => setSessionDate(e.target.value)}
                style={styles.dateInput}
              />
            </label>
          )}
        </div>
        {displaySession ? (
          <>
            <div style={{ ...styles.rowGrid, ...styles.theadRow }}>
              <span style={styles.th}>#</span>
              <span style={styles.th}>Title</span>
              <span style={styles.th}>Type</span>
              <span style={styles.th}>Min</span>
              <span style={styles.th}>Writer</span>
              <span style={styles.th}>Editor</span>
              <span style={styles.th}>Status</span>
            </div>
            {sessionRows.map((item, i) => renderRow(item, i, true))}
            {sessionRows.length === 0 && (
              <p style={styles.emptyText}>Nothing packed yet — approved items fill in automatically.</p>
            )}
          </>
        ) : (
          <p style={styles.emptyText}>
            {isAdmin ? 'Set a session date to start packing approved beat sheets.' : 'No filming session scheduled yet.'}
          </p>
        )}
      </section>

      {/* ── The line ── */}
      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionTitle}>The Line</span>
          <span style={styles.sectionCount}>{lineRows.length}</span>
          <span style={styles.sectionHint}>Approved, waiting for a session — ads first, then oldest approved.</span>
        </div>
        <div style={{ ...styles.rowGrid, ...styles.theadRow }}>
          <span style={styles.th} />
          <span style={styles.th}>Title</span>
          <span style={styles.th}>Type</span>
          <span style={styles.th}>Min</span>
          <span style={styles.th}>Writer</span>
          <span style={styles.th}>Editor</span>
          <span style={styles.th}>Status</span>
        </div>
        {lineRows.map((item, i) => renderRow(item, i, false))}
        {lineRows.length === 0 && (
          <p style={styles.emptyText}>The line is empty — everything approved is packed.</p>
        )}
      </section>

      {/* ── In edit (filmed, cut not delivered yet) ── */}
      {inEditItems.length > 0 && (
        <section style={styles.section}>
          <button style={styles.collapseHeader} onClick={() => setShowInEdit((v) => !v)}>
            <span style={styles.sectionTitle}>In Edit</span>
            <span style={styles.sectionCount}>{inEditItems.length}</span>
            <span style={styles.chevron}>{showInEdit ? '▲' : '▼'}</span>
          </button>
          {showInEdit && inEditItems.map((item) => (
            <div key={item.id} style={{ ...styles.row, gridTemplateColumns: 'minmax(200px, 2fr) 110px minmax(120px, 1fr) 120px' }} onClick={() => setOpenItemId(item.id)}>
              <span style={styles.titleCell}>{item.sheet?.title || 'Untitled'}</span>
              <span>
                <span style={{ ...styles.typeChip, background: `${queueTypeColor(item.queue_type)}26`, color: queueTypeColor(item.queue_type), borderColor: `${queueTypeColor(item.queue_type)}55` }}>
                  {queueTypeLabel(item.queue_type)}
                </span>
              </span>
              <span style={styles.personCell}>{nameOf(item.editor_id)}</span>
              <span style={styles.personCell}>
                {item.filmed_at ? `Sent ${new Date(item.filmed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
              </span>
            </div>
          ))}
        </section>
      )}

      {/* ── Item modal ── */}
      {openItem && (
        <FilmQueueItemModal
          item={openItem}
          isAdmin={isAdmin}
          pickerProfiles={pickerProfiles}
          nameOf={nameOf}
          onSave={saveItem}
          onOpenSheet={() => {
            setOpenItemId(null);
            if (onNavigate) onNavigate('production', openItem.beat_sheet_id);
          }}
          onClose={() => setOpenItemId(null)}
        />
      )}
    </div>
  );
}

// Click-to-open item modal: the writer and editor assignments live here (and
// only here — deliberately not on the beat sheet). Admin-tier edits; everyone
// else reads.
function FilmQueueItemModal({ item, isAdmin, pickerProfiles, nameOf, onSave, onOpenSheet, onClose }) {
  const [writerId, setWriterId] = useState(item.writer_id || '');
  const [editorId, setEditorId] = useState(item.editor_id || '');
  const [minutes, setMinutes] = useState(item.sheet?.estimated_minutes ?? defaultMinutesFor(item.queue_type));
  const [saving, setSaving] = useState(false);

  const status = STATUS_BY_VALUE[item.sheet?.status] || STATUS_BY_VALUE.drafting;
  const titles = Array.isArray(item.source_titles) ? item.source_titles : [];
  const dirty = writerId !== (item.writer_id || '')
    || editorId !== (item.editor_id || '')
    || Number(minutes) !== (item.sheet?.estimated_minutes ?? defaultMinutesFor(item.queue_type));

  async function commit() {
    if (saving) return;
    setSaving(true);
    await onSave(item, { writer_id: writerId, editor_id: editorId, estimated_minutes: minutes });
    setSaving(false);
    onClose();
  }

  return (
    <div style={styles.modalOverlay} {...backdropDismiss(onClose)}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>{item.sheet?.title || 'Untitled'}</h3>
        <div style={styles.modalChipRow}>
          <span style={{ ...styles.typeChip, background: `${queueTypeColor(item.queue_type)}26`, color: queueTypeColor(item.queue_type), borderColor: `${queueTypeColor(item.queue_type)}55` }}>
            {queueTypeLabel(item.queue_type)}
          </span>
          <span style={{ ...styles.statusChip, background: `${status.color}22`, color: status.color, borderColor: `${status.color}55` }}>
            {status.label}
          </span>
          {item.sheet?.film_date && (
            <span style={styles.filmDateChip}>Films {fmtSessionDate(item.sheet.film_date)}</span>
          )}
        </div>

        {isAdmin ? (
          <>
            <div style={styles.modalFieldLabel}>Writer</div>
            <select value={writerId} onChange={(e) => setWriterId(e.target.value)} style={styles.modalSelect}>
              <option value="">— Unassigned —</option>
              {pickerProfiles.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
              ))}
            </select>
            <div style={styles.modalFieldLabel}>Editor</div>
            <select value={editorId} onChange={(e) => setEditorId(e.target.value)} style={styles.modalSelect}>
              <option value="">— Unassigned —</option>
              {pickerProfiles.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
              ))}
            </select>
            <div style={styles.modalFieldLabel}>Estimated minutes</div>
            <input
              type="number"
              min={1}
              max={120}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              style={styles.modalSelect}
            />
          </>
        ) : (
          <div style={styles.readonlyBlock}>
            <div><span style={styles.readonlyLabel}>Writer</span> {nameOf(item.writer_id)}</div>
            <div><span style={styles.readonlyLabel}>Editor</span> {nameOf(item.editor_id)}</div>
            <div><span style={styles.readonlyLabel}>Estimated</span> {item.sheet?.estimated_minutes ?? defaultMinutesFor(item.queue_type)} min</div>
          </div>
        )}

        {(item.source_context || titles.length > 0) && (
          <div style={styles.sourceBlock}>
            <div style={styles.modalFieldLabel}>From the idea</div>
            {item.source_context && <p style={styles.sourceContext}>{item.source_context}</p>}
            {titles.length > 0 && (
              <ul style={styles.sourceTitles}>
                {titles.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            )}
          </div>
        )}

        <div style={styles.modalBtnRow}>
          <button onClick={onOpenSheet} style={styles.openSheetBtn}>Open Beat Sheet</button>
          <div style={{ flex: 1 }} />
          {isAdmin && (
            <button
              onClick={commit}
              disabled={saving || !dirty}
              style={{ ...styles.saveBtn, opacity: saving || !dirty ? 0.4 : 1 }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
          <button onClick={onClose} style={styles.cancelBtn}>Close</button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', gap: '20px' },
  countsRow: { display: 'flex', gap: '12px' },
  countCard: {
    display: 'flex', alignItems: 'baseline', gap: '8px',
    background: colors.whiteA03, border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '12px', padding: '12px 18px',
  },
  countValue: { fontSize: '22px', fontWeight: 700, color: colors.textBright },
  countLabel: {
    fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px',
    color: colors.textDim,
  },
  section: {
    background: colors.whiteA02,
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: '12px',
    padding: '14px 16px 16px',
  },
  sessionSection: {
    background: colors.accentA06,
    border: '1px solid rgba(91, 143, 199, 0.25)',
  },
  sectionHeader: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' },
  sectionTitle: { fontSize: '15px', fontWeight: 700, color: colors.textBright },
  sectionCount: {
    fontSize: '11px', fontWeight: 600, color: colors.textDim,
    background: colors.whiteA06, padding: '2px 8px', borderRadius: '10px',
  },
  sectionHint: { fontSize: '11px', color: colors.textDim },
  sessionDate: { fontSize: '14px', fontWeight: 700, color: colors.white },
  sessionStats: { fontSize: '12px', fontWeight: 600, color: colors.textSubtle },
  lockedBadge: {
    fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
    color: colors.gold, background: colors.warning.bg, border: '1px solid rgba(251,191,36,0.4)',
    padding: '2px 8px', borderRadius: '10px',
  },
  dateLabel: {
    display: 'flex', alignItems: 'center', gap: '8px',
    fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
    color: colors.textDim,
  },
  dateInput: {
    padding: '5px 8px', background: colors.whiteA06,
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px',
    color: colors.textBright, fontSize: '12px', fontFamily: 'inherit', outline: 'none',
    colorScheme: 'dark',
  },
  rowGrid: {
    display: 'grid',
    gridTemplateColumns: '28px minmax(200px, 2fr) 110px 52px minmax(110px, 1fr) minmax(110px, 1fr) 130px',
    gap: '12px',
    alignItems: 'center',
  },
  theadRow: { padding: '4px 10px 8px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  th: {
    fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
    color: colors.textDim,
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '28px minmax(200px, 2fr) 110px 52px minmax(110px, 1fr) minmax(110px, 1fr) 130px',
    gap: '12px',
    alignItems: 'center',
    padding: '10px',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '8px',
    cursor: 'pointer',
  },
  slateCell: { fontSize: '12px', fontWeight: 700, color: colors.textDim },
  titleCell: { fontSize: '13px', color: colors.textBright, wordBreak: 'break-word' },
  minutesCell: { fontSize: '12px', fontWeight: 600, color: colors.textMuted },
  personCell: { fontSize: '12px', color: colors.textSubtle },
  typeChip: {
    display: 'inline-block', padding: '2px 8px', borderRadius: '10px', border: '1px solid',
    fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap',
  },
  statusChip: {
    display: 'inline-block', padding: '2px 8px', borderRadius: '10px', border: '1px solid',
    fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap',
  },
  filmDateChip: {
    display: 'inline-block', padding: '2px 8px', borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.15)', fontSize: '11px', fontWeight: 600,
    color: colors.textMuted, whiteSpace: 'nowrap',
  },
  collapseHeader: {
    display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
    background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
  },
  chevron: { fontSize: '10px', color: colors.textDim, marginLeft: 'auto' },
  emptyText: { color: colors.textDim, fontSize: '13px', margin: '8px 4px 4px 4px' },
  // ── Modal ──
  modalOverlay: {
    position: 'fixed', inset: 0, zIndex: 1100,
    background: colors.bgOverlay,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '24px',
  },
  modal: {
    background: colors.bgModal,
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '14px',
    padding: '20px',
    width: '100%',
    maxWidth: '460px',
    maxHeight: '80vh',
    overflowY: 'auto',
    boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
  },
  modalTitle: { fontSize: '16px', fontWeight: 700, color: colors.white, margin: '0 0 10px 0' },
  modalChipRow: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' },
  modalFieldLabel: {
    fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
    color: colors.textDim, margin: '14px 0 6px',
  },
  modalSelect: {
    width: '100%', padding: '7px 10px',
    background: colors.whiteA06, border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px', color: colors.textBright, fontSize: '13px', fontFamily: 'inherit',
    outline: 'none', boxSizing: 'border-box',
  },
  readonlyBlock: {
    display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '12px',
    fontSize: '13px', color: colors.textBright,
  },
  readonlyLabel: {
    display: 'inline-block', width: '80px',
    fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
    color: colors.textDim,
  },
  sourceBlock: {
    marginTop: '4px', padding: '10px', background: colors.whiteA03,
    border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px',
  },
  sourceContext: { fontSize: '12px', color: colors.textMuted, margin: '0 0 6px', whiteSpace: 'pre-wrap' },
  sourceTitles: { margin: 0, paddingLeft: '18px', fontSize: '12px', color: colors.textMuted },
  modalBtnRow: { display: 'flex', gap: '8px', marginTop: '18px', alignItems: 'center' },
  openSheetBtn: {
    padding: '8px 14px', background: colors.whiteA06,
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px',
    color: colors.textBright, fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  saveBtn: {
    padding: '8px 20px', background: colors.accent, border: 'none', borderRadius: '8px',
    color: colors.white, fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  cancelBtn: {
    padding: '8px 16px', background: colors.whiteA06,
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
    color: colors.textMuted, fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit',
  },
};
