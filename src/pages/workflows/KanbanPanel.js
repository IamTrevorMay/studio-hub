// Kanban-style Workflows panel — sign-off model.
// Each workflow = a board. Columns = stages. Cards = workflow_instances.
// Cards move automatically when all assignees sign off on the column's task.

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { supabase } from '../../supabaseClient';
import { WORKFLOWS_CREATION_DISABLED } from '../../lib/workflowApi';
import ProgressTable from '../../components/workflows/ProgressTable';
import TaskEditModal from '../../components/TaskEditModal';
import backdropDismiss from '../../lib/backdropDismiss';
import { colors } from '../../lib/styleTokens';

// ─── Constants ───────────────────────────────────────────────

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || '';
const TEAM_ROLES = ['admin', 'assistant', 'member', 'partner'];
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const CARD_STATUS_TONES = {
  active: '#5b8fc7',
  blocked: '#eab308',
  complete: '#22c55e',
  cancelled: 'rgba(255,255,255,0.4)',
};

const TRIGGER_OPTIONS = [
  { value: 'manual', label: 'Manual only' },
  { value: 'drive_folder', label: 'New file in Google Drive folder' },
  { value: 'new_video', label: 'New video published' },
  { value: 'new_project', label: 'New project created' },
  { value: 'new_proposal', label: 'New proposal created' },
  { value: 'new_beat_sheet_mayday', label: 'Beat sheet added to Mayday' },
  { value: 'new_beat_sheet_tm_baseball', label: 'Beat sheet added to TM Baseball' },
];

// ─── Small helpers ───────────────────────────────────────────

function makeColumnKey(prefix = 'col') {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

async function callFn(fnName, body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `${fnName} failed`);
  return data;
}

function formatAuditDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ─── Multi-assignee chip picker ──────────────────────────────

function AssigneeChips({ value, profiles, onChange, placeholder = 'Add assignee…' }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  const selected = useMemo(
    () => (value || []).map((id) => profiles.find((p) => p.id === id)).filter(Boolean),
    [value, profiles],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const ids = new Set(value || []);
    return profiles
      .filter((p) => !ids.has(p.id))
      .filter((p) => !s || (p.name || '').toLowerCase().includes(s) || (p.role || '').toLowerCase().includes(s));
  }, [profiles, q, value]);

  const remove = (id) => onChange((value || []).filter((v) => v !== id));
  const add = (id) => { onChange([...(value || []), id]); setQ(''); };

  // The menu renders position: fixed so the modal's overflowY:auto can't
  // clip it; anchored to the field, flipping above near the viewport bottom.
  const [menuPos, setMenuPos] = useState({});
  const toggleMenu = () => {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      const openUp = window.innerHeight - r.bottom < 260;
      setMenuPos({
        left: r.left,
        width: r.width,
        ...(openUp ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      });
    }
    setOpen((v) => !v);
  };

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', marginTop: 4 }}>
        {selected.map((p) => (
          <span key={p.id} style={styles.chip}>
            {p.name}
            <button onClick={() => remove(p.id)} style={styles.chipX}>×</button>
          </span>
        ))}
        <button onClick={toggleMenu} style={styles.addChipBtn}>
          {selected.length === 0 ? placeholder : '+'}
        </button>
      </div>
      {open && (
        <div style={{ ...styles.chipMenu, position: 'fixed', top: menuPos.top, bottom: menuPos.bottom, left: menuPos.left, right: 'auto', width: menuPos.width, marginTop: 0 }}>
          <input
            autoFocus
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={styles.chipSearch}
          />
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 8, fontSize: 12, color: 'rgba(255,255,255,0.4)', textAlign: 'center' }}>No matches</div>
            ) : filtered.map((p) => (
              <div
                key={p.id}
                onClick={() => add(p.id)}
                style={styles.chipOption}
              >
                <span>{p.name}</span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>{p.role}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Column settings panel ──────────────────────────────────

function ColumnSettings({ column, profiles, isFirst, triggerConfig, triggerMode, onUpdateColumn, onUpdateTrigger }) {
  const [taskTitleTpl, setTaskTitleTpl] = useState(column.description_template || '');
  const [triggerType, setTriggerType] = useState((triggerConfig && triggerConfig.type) || 'manual');
  const [folderId, setFolderId] = useState((triggerConfig && triggerConfig.folder_id) || '');

  useEffect(() => {
    setTaskTitleTpl(column.description_template || '');
  }, [column.description_template]);

  const saveDescription = () => {
    if (taskTitleTpl !== (column.description_template || '')) {
      onUpdateColumn({ description_template: taskTitleTpl || null });
    }
  };

  const saveTrigger = (type) => {
    setTriggerType(type);
    if (type === 'manual') {
      onUpdateTrigger('manual', {});
    } else if (type === 'drive_folder') {
      onUpdateTrigger('auto', { type: 'drive_folder', folder_id: folderId });
    } else {
      onUpdateTrigger('auto', { type });
    }
  };

  return (
    <div style={{ padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 4 }}>
      {isFirst && (
        <div>
          <label style={styles.fieldLabel}>Creation action</label>
          <select
            value={triggerType}
            onChange={(e) => saveTrigger(e.target.value)}
            style={styles.selectBase}
          >
            {TRIGGER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {triggerType === 'drive_folder' && (
            <input
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              onBlur={() => onUpdateTrigger('auto', { type: 'drive_folder', folder_id: folderId })}
              placeholder="Google Drive folder ID"
              style={{ ...styles.inputBase, marginTop: 6 }}
            />
          )}
        </div>
      )}

      <div>
        <label style={styles.fieldLabel}>Entry action</label>
        <div style={{ ...styles.selectBase, opacity: 0.6, cursor: 'not-allowed' }}>Create task</div>
      </div>

      <div>
        <label style={styles.fieldLabel}>Task description (optional)</label>
        <textarea
          value={taskTitleTpl}
          onChange={(e) => setTaskTitleTpl(e.target.value)}
          onBlur={saveDescription}
          style={{ ...styles.inputBase, minHeight: 48, resize: 'vertical' }}
          placeholder="Optional task description…"
        />
      </div>
    </div>
  );
}

// ─── Card detail modal ───────────────────────────────────────

function CardModal({ card, columns, profiles, signOffData, onClose, onSave, onDelete, onReassign, auditTrail }) {
  const [title, setTitle] = useState(card.title || '');
  const [notes, setNotes] = useState((card.context && card.context.notes) || '');
  const [linkUrl, setLinkUrl] = useState((card.context && card.context.link_url) || '');
  const [overrides, setOverrides] = useState({ ...(card.assignee_overrides || {}) });
  const [saving, setSaving] = useState(false);
  const [confirmReassign, setConfirmReassign] = useState(null); // { stepKey, ids }

  const setOverride = (stepKey, ids) => {
    const currentCol = columns.find((c) => c.step_key === stepKey);
    const isCurrentColumn = card.current_step_key === stepKey;

    // If this is the active column and card is in progress, prompt for reassign.
    if (isCurrentColumn && card.status === 'active' && !currentCol?.is_terminal) {
      setConfirmReassign({ stepKey, ids });
      return;
    }

    setOverrides((prev) => {
      const next = { ...prev };
      if (!ids || ids.length === 0) delete next[stepKey];
      else next[stepKey] = ids;
      return next;
    });
  };

  const handleConfirmReassign = async () => {
    if (!confirmReassign) return;
    const { stepKey, ids } = confirmReassign;
    setConfirmReassign(null);

    // Update overrides locally.
    setOverrides((prev) => {
      const next = { ...prev };
      if (!ids || ids.length === 0) delete next[stepKey];
      else next[stepKey] = ids;
      return next;
    });

    // Call reassign endpoint.
    if (onReassign) {
      await onReassign(card, stepKey, ids);
    }
  };

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        context: { ...(card.context || {}), notes, link_url: linkUrl },
        assignee_overrides: overrides,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  // Sign-off progress for current column.
  const currentSignOffs = signOffData || [];
  const signedCount = currentSignOffs.filter((s) => s.signed_off_at).length;
  const totalCount = currentSignOffs.length;

  return (
    <div style={styles.modalOverlay} {...backdropDismiss(onClose)}>
      <div style={{ ...styles.modal, maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#ffffff', margin: 0 }}>Card</h3>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 22, cursor: 'pointer' }}
          >×</button>
        </div>

        <label style={styles.fieldLabel}>Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ ...styles.inputBase, marginBottom: 16 }}
          placeholder="Card title"
        />

        <label style={styles.fieldLabel}>Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={{ ...styles.inputBase, minHeight: 70, resize: 'vertical', marginBottom: 16 }}
          placeholder="Optional notes"
        />

        <label style={styles.fieldLabel}>Link URL</label>
        <input
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          style={{ ...styles.inputBase, marginBottom: 16 }}
          placeholder="https://…"
        />

        {/* Sign-off progress */}
        {totalCount > 0 && (
          <div style={{ marginBottom: 16, padding: 12, background: 'rgba(255,255,255,0.04)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
            <label style={styles.fieldLabel}>Sign-off progress</label>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>
              {signedCount} of {totalCount} signed off
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
              {currentSignOffs.map((s) => {
                const p = profiles.find((pr) => pr.id === s.user_id);
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: s.signed_off_at ? '#22c55e' : 'rgba(255,255,255,0.2)',
                    }} />
                    <span style={{ fontSize: 12, color: s.signed_off_at ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.5)' }}>
                      {p?.name || 'Unknown'}
                    </span>
                    {s.signed_off_at && (
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
                        {formatAuditDate(s.signed_off_at)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ marginTop: 16, marginBottom: 8 }}>
          <label style={styles.fieldLabel}>Per-stage assignees (overrides column default)</label>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {columns.filter((c) => !c.is_terminal).map((c) => (
            <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{c.title_template || c.step_key}</span>
                {card.current_step_key === c.step_key && (
                  <span style={{ fontSize: 10, color: colors.accent, fontWeight: 600 }}>CURRENT</span>
                )}
                {!overrides[c.step_key] && (
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Default</span>
                )}
              </div>
              <AssigneeChips
                value={overrides[c.step_key] || []}
                profiles={profiles}
                onChange={(ids) => setOverride(c.step_key, ids)}
                placeholder="Use column default…"
              />
            </div>
          ))}
        </div>

        {/* Audit trail */}
        {auditTrail && auditTrail.length > 0 && (
          <div style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
            <label style={styles.fieldLabel}>Change history</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
              {auditTrail.map((entry) => (
                <div key={entry.id} style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                  <span>{formatAuditDate(entry.created_at)}</span>
                  {entry.change_type === 'assignee_changed' && (
                    <span> — Assignees changed for {entry.column_step_key}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 20 }}>
          <button
            onClick={() => { if (window.confirm('Delete this card? Open tasks will be skipped.')) onDelete(); }}
            style={styles.dangerBtn}
          >Delete card</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={styles.ghostBtn}>Cancel</button>
            <button onClick={save} disabled={saving || !title.trim()} style={styles.primaryBtn}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {/* Reassign confirmation */}
        {confirmReassign && (
          <div style={styles.modalOverlay} {...backdropDismiss(() => setConfirmReassign(null))}>
            <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#ffffff', margin: '0 0 8px' }}>Reassign active task?</h3>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: '0 0 16px' }}>
                Changing assignees for this column will reassign the active task. Continue?
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setConfirmReassign(null)} style={styles.ghostBtn}>Cancel</button>
                <button onClick={handleConfirmReassign} style={styles.primaryBtn}>Reassign</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Card tile (in column) ───────────────────────────────────

function CardTile({ card, signOffProgress, onClick, onContextMenu }) {
  const tone = CARD_STATUS_TONES[card.status] || '#5b8fc7';
  return (
    <div
      onClick={() => onClick(card)}
      onContextMenu={onContextMenu}
      style={{
        ...styles.cardTile,
        borderLeft: `3px solid ${tone}`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', flex: 1, lineHeight: 1.3 }}>
          {card.title || 'Untitled'}
        </span>
        {card.status === 'blocked' && (
          <span style={styles.warningPill}>Blocked</span>
        )}
      </div>
      {signOffProgress && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2 }}>
            <div style={{
              width: `${signOffProgress.total > 0 ? (signOffProgress.done / signOffProgress.total) * 100 : 0}%`,
              height: '100%',
              background: signOffProgress.done === signOffProgress.total ? '#22c55e' : '#5b8fc7',
              borderRadius: 2,
              transition: 'width 200ms ease-out',
            }} />
          </div>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>
            {signOffProgress.done}/{signOffProgress.total}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Column ──────────────────────────────────────────────────

function KanbanColumn({
  column, cards, signOffMap, profiles, isFirst, isLast, triggerConfig, triggerMode,
  onRename, onSetDefault, onUpdateColumn, onUpdateTrigger, onDelete,
  onCardClick, onAddCard, onCardContextMenu,
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(column.title_template || '');
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => { setTitleDraft(column.title_template || ''); }, [column.title_template]);

  const commitTitle = () => {
    setEditingTitle(false);
    if (titleDraft.trim() && titleDraft.trim() !== column.title_template) {
      onRename(titleDraft.trim());
    }
  };

  return (
    <div style={styles.column}>
      <div style={styles.columnHeader}>
        {editingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') { setEditingTitle(false); setTitleDraft(column.title_template || ''); } }}
            style={{ ...styles.inputBase, fontWeight: 600, fontSize: 14 }}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <h3
                onClick={() => !column.is_terminal && setEditingTitle(true)}
                style={{ fontSize: 14, fontWeight: 600, color: '#ffffff', margin: 0, cursor: column.is_terminal ? 'default' : 'text' }}
              >
                {column.title_template || column.step_key}
              </h3>
              {column.is_terminal && (
                <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 600 }}>COMPLETE</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{cards.length}</span>
              {!column.is_terminal && (
                <>
                  <button
                    onClick={() => setShowSettings((v) => !v)}
                    title="Column settings"
                    style={{ background: 'transparent', border: 'none', color: showSettings ? '#5b8fc7' : 'rgba(255,255,255,0.4)', fontSize: 14, cursor: 'pointer', padding: '0 4px' }}
                  >⚙</button>
                  <button
                    onClick={() => { if (window.confirm(`Delete column "${column.title_template}"? Cards in it will be skipped.`)) onDelete(); }}
                    style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 16, cursor: 'pointer', padding: '0 4px' }}
                    title="Delete column"
                  >×</button>
                </>
              )}
            </div>
          </div>
        )}

        {!column.is_terminal && (
          <div style={{ marginTop: 8 }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Default assignees
            </span>
            <AssigneeChips
              value={column.default_assignee_ids || []}
              profiles={profiles}
              onChange={(ids) => onSetDefault(ids)}
              placeholder="None — cards will block here"
            />
          </div>
        )}

        {showSettings && !column.is_terminal && (
          <ColumnSettings
            column={column}
            profiles={profiles}
            isFirst={isFirst}
            triggerConfig={triggerConfig}
            triggerMode={triggerMode}
            onUpdateColumn={onUpdateColumn}
            onUpdateTrigger={onUpdateTrigger}
          />
        )}
      </div>

      <div style={styles.cardList}>
        {cards.map((c) => (
          <CardTile
            key={c.id}
            card={c}
            signOffProgress={signOffMap[c.id] || null}
            onClick={onCardClick}
            onContextMenu={(e) => onCardContextMenu(e, c)}
          />
        ))}
      </div>

      {!column.is_terminal && (
        <button onClick={onAddCard} style={styles.addCardBtn}>+ Add card</button>
      )}
    </div>
  );
}

// ─── Team section ────────────────────────────────────────────

// ─── Main panel ──────────────────────────────────────────────

export default function KanbanPanel({ boardId, onBack, showToast }) {
  const [boardData, setBoardData] = useState(null);

  const [columns, setColumns] = useState([]);
  const [cards, setCards] = useState([]);
  const [signOffMap, setSignOffMap] = useState({}); // { cardId: { done, total } }
  const [boardLoading, setBoardLoading] = useState(false);

  const [profiles, setProfiles] = useState([]);
  const [teamPending, setTeamPending] = useState([]);
  const [teamDone, setTeamDone] = useState([]);
  const [editingTask, setEditingTask] = useState(null);
  // tasks.id Set whose admin assignee has the linked sprint card in
  // their "In Progress" column → force-active pill in ProgressTable.
  const [sprintActiveTaskIds, setSprintActiveTaskIds] = useState(() => new Set());

  const [showNewCard, setShowNewCard] = useState(false);
  const [newCardTitle, setNewCardTitle] = useState('');
  const [creatingCard, setCreatingCard] = useState(false);

  const [openCard, setOpenCard] = useState(null);
  const [openCardSignOffs, setOpenCardSignOffs] = useState([]);
  const [openCardAudit, setOpenCardAudit] = useState([]);
  const [cardCtxMenu, setCardCtxMenu] = useState(null);

  // ─── Load profiles ─────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, status')
        .order('full_name', { ascending: true, nullsFirst: false });
      if (cancelled || !data) return;
      setProfiles(
        data
          .filter((p) => p.status !== 'archived')
          .map((p) => ({ id: p.id, name: p.full_name || p.email || 'Unknown', role: p.role || 'member' })),
      );
    })();
    return () => { cancelled = true; };
  }, []);

  // ─── Load board metadata ───────────────────────────────────

  useEffect(() => {
    if (!boardId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('workflows')
        .select('id, slug, name, description, is_active, trigger_mode, trigger_config')
        .eq('id', boardId)
        .single();
      if (!cancelled && data) setBoardData(data);
    })();
    return () => { cancelled = true; };
  }, [boardId]);

  // ─── Load team tasks (refetchable so save→update cycles refresh) ───

  const fetchTeamTasks = useCallback(async () => {
    const cutoff = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
    // Same column set as the main Workflows Progress fetch so the
    // shared TaskEditModal has everything it needs without a re-query.
    const TASK_COLS = 'id, title, description, assignee_id, due_date, status, snoozed_until, hold_reason, planned_date, workflow_instance_id, automation_id, created_at';
    const TASK_DONE_COLS = TASK_COLS + ', completed_at';
    const [{ data: pend }, { data: completed }] = await Promise.all([
      supabase.from('tasks').select(TASK_COLS)
        .in('status', ['active', 'pending', 'on_hold'])
        .not('assignee_id', 'is', null),
      supabase.from('tasks').select(TASK_DONE_COLS)
        .eq('status', 'complete')
        .gte('completed_at', cutoff)
        .not('assignee_id', 'is', null),
    ]);
    setTeamPending(pend || []);
    setTeamDone(completed || []);

    const { data: sprintRows } = await supabase
      .from('personal_tasks')
      .select('task_id, profiles!personal_tasks_created_by_fkey!inner(role)')
      .eq('status', 'in_progress')
      .not('task_id', 'is', null)
      .eq('profiles.role', 'admin');
    setSprintActiveTaskIds(new Set((sprintRows || []).map((r) => r.task_id)));
  }, []);

  useEffect(() => { fetchTeamTasks(); }, [fetchTeamTasks]);

  const team = useMemo(() => profiles.filter((p) => TEAM_ROLES.includes(p.role)), [profiles]);

  // Drilled-into-a-workflow view: only show tasks tied to this
  // workflow's instances (the cards array == workflow_instances).
  // Direct (non-workflow) tasks live in the main Workflows view, not
  // here, so they get filtered out.
  const instanceIdSet = useMemo(() => new Set((cards || []).map((c) => c.id)), [cards]);
  const scopedPending = useMemo(
    () => teamPending.filter((t) => t.workflow_instance_id && instanceIdSet.has(t.workflow_instance_id)),
    [teamPending, instanceIdSet],
  );
  const scopedDone = useMemo(
    () => teamDone.filter((t) => t.workflow_instance_id && instanceIdSet.has(t.workflow_instance_id)),
    [teamDone, instanceIdSet],
  );

  const byAssignee = useMemo(() => {
    const map = {};
    const ensure = (id) => (map[id] || (map[id] = { pending: [], done: [] }));
    for (const t of scopedPending) if (t.assignee_id) ensure(t.assignee_id).pending.push(t);
    for (const t of scopedDone) if (t.assignee_id) ensure(t.assignee_id).done.push(t);
    return map;
  }, [scopedPending, scopedDone]);

  // Only show people who actually have a task on this workflow.
  const scopedTeam = useMemo(
    () => team.filter((p) => byAssignee[p.id] && (byAssignee[p.id].pending.length > 0 || byAssignee[p.id].done.length > 0)),
    [team, byAssignee],
  );

  // ─── Load board detail (columns + cards + sign-offs) ────

  const fetchBoardDetail = useCallback(async () => {
    if (!boardId) { setColumns([]); setCards([]); setSignOffMap({}); return; }
    setBoardLoading(true);
    try {
      const [{ data: cols }, { data: cardRows }] = await Promise.all([
        supabase
          .from('workflow_steps')
          .select('id, workflow_id, step_key, title_template, description_template, position, default_assignee_ids, entry_action_type, is_terminal')
          .eq('workflow_id', boardId)
          .order('position', { ascending: true }),
        supabase
          .from('workflow_instances')
          .select('id, workflow_id, status, title, context, current_step_key, assignee_overrides, started_at')
          .eq('workflow_id', boardId)
          .in('status', ['active', 'blocked', 'complete'])
          .order('started_at', { ascending: true }),
      ]);

      const mappedCols = (cols || []).map((c) => ({
        ...c,
        default_assignee_ids: c.default_assignee_ids || [],
        entry_action_type: c.entry_action_type || 'create_task',
        is_terminal: c.is_terminal || false,
      }));
      setColumns(mappedCols);

      // Filter out archived (cancelled) cards but keep complete for terminal column.
      setCards(cardRows || []);

      // Fetch sign-off progress for active cards.
      const activeCardIds = (cardRows || []).filter((c) => c.status === 'active').map((c) => c.id);
      if (activeCardIds.length > 0) {
        const { data: tasks } = await supabase
          .from('tasks')
          .select('id, workflow_instance_id, requires_sign_off')
          .in('workflow_instance_id', activeCardIds)
          .eq('status', 'active')
          .eq('requires_sign_off', true);

        const taskIds = (tasks || []).map((t) => t.id);
        if (taskIds.length > 0) {
          const { data: signOffs } = await supabase
            .from('task_sign_offs')
            .select('task_id, signed_off_at')
            .in('task_id', taskIds);

          // Group by card via task.
          const taskToCard = {};
          for (const t of tasks || []) taskToCard[t.id] = t.workflow_instance_id;

          const map = {};
          for (const so of signOffs || []) {
            const cardId = taskToCard[so.task_id];
            if (!cardId) continue;
            if (!map[cardId]) map[cardId] = { done: 0, total: 0 };
            map[cardId].total++;
            if (so.signed_off_at) map[cardId].done++;
          }
          setSignOffMap(map);
        } else {
          setSignOffMap({});
        }
      } else {
        setSignOffMap({});
      }
    } finally {
      setBoardLoading(false);
    }
  }, [boardId]);

  useEffect(() => { fetchBoardDetail(); }, [fetchBoardDetail]);

  // Realtime: refresh on instance/task/sign-off changes for the board.
  useEffect(() => {
    if (!boardId) return;
    const ch = supabase
      .channel(`kanban-board-${boardId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_instances', filter: `workflow_id=eq.${boardId}` }, fetchBoardDetail)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, fetchBoardDetail)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_sign_offs' }, fetchBoardDetail)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_steps', filter: `workflow_id=eq.${boardId}` }, fetchBoardDetail)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [boardId, fetchBoardDetail]);

  // ─── Card context menu (right-click → advance) ───────────

  useEffect(() => {
    if (!cardCtxMenu) return;
    const close = () => setCardCtxMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [cardCtxMenu]);

  const handleAdvanceCard = async () => {
    if (!cardCtxMenu) return;
    const card = cardCtxMenu.card;
    setCardCtxMenu(null);
    const col = columns.find((c) => c.step_key === card.current_step_key);
    if (!col) return;
    const colIdx = columns.indexOf(col);
    const next = columns[colIdx + 1];
    if (!next) return;
    try {
      await callFn('workflow-move-card', { instance_id: card.id, target_step_key: next.step_key });
      fetchBoardDetail();
    } catch (err) {
      showToast?.(err.message, 'error');
    }
  };

  // ─── Column CRUD ──────────────────────────────────────────

  const addColumn = async () => {
    if (!boardId) return;
    // Insert before the terminal column.
    const terminalCol = columns.find((c) => c.is_terminal);
    const nonTerminal = columns.filter((c) => !c.is_terminal);
    const pos = nonTerminal.length > 0 ? Math.max(...nonTerminal.map((c) => c.position)) + 1 : 0;

    // Ensure terminal stays last.
    if (terminalCol && pos >= terminalCol.position) {
      await supabase.from('workflow_steps').update({ position: pos + 1000 }).eq('id', terminalCol.id);
    }

    const { error } = await supabase.from('workflow_steps').insert({
      workflow_id: boardId,
      step_key: makeColumnKey(),
      title_template: `Column ${nonTerminal.length + 1}`,
      position: pos,
      assignee_type: 'static',
      action_type: 'complete',
      action_label: 'Mark Complete',
      entry_action_type: 'create_task',
      is_terminal: false,
    });
    if (error) showToast?.(error.message, 'error');
    else fetchBoardDetail();
  };

  const renameColumn = async (column, newTitle) => {
    await supabase.from('workflow_steps').update({ title_template: newTitle }).eq('id', column.id);
    fetchBoardDetail();
  };

  const updateColumnFields = async (column, fields) => {
    await supabase.from('workflow_steps').update(fields).eq('id', column.id);
    fetchBoardDetail();
  };

  const updateTrigger = async (triggerMode, triggerConfig) => {
    if (!boardId) return;
    await supabase.from('workflows').update({ trigger_mode: triggerMode, trigger_config: triggerConfig }).eq('id', boardId);
    setBoardData((prev) => prev ? { ...prev, trigger_mode: triggerMode, trigger_config: triggerConfig } : prev);
  };

  const setColumnDefault = async (column, ids) => {
    await supabase.from('workflow_steps').update({ default_assignee_ids: ids }).eq('id', column.id);
    fetchBoardDetail();
  };

  const deleteColumn = async (column) => {
    if (column.is_terminal) return; // Cannot delete terminal column.
    await supabase.from('workflow_steps').delete().eq('id', column.id);
    fetchBoardDetail();
  };

  const reorderColumns = async (result) => {
    if (!result.destination) return;
    const srcIdx = result.source.index;
    const dstIdx = result.destination.index;
    if (srcIdx === dstIdx) return;

    // Work with non-terminal columns only (terminal stays pinned at end).
    const nonTerminal = columns.filter((c) => !c.is_terminal);
    const terminal = columns.filter((c) => c.is_terminal);
    const reordered = Array.from(nonTerminal);
    const [moved] = reordered.splice(srcIdx, 1);
    reordered.splice(dstIdx, 0, moved);

    // Optimistic update. Re-bump terminal columns to sit strictly after the
    // reindexed non-terminal range, otherwise a non-terminal position could
    // collide with the terminal column's stale position and it would stop
    // sorting last.
    const updated = reordered.map((c, i) => ({ ...c, position: i }));
    const updatedTerminal = terminal.map((c, i) => ({ ...c, position: updated.length + i }));
    setColumns([...updated, ...updatedTerminal]);

    // Persist new positions; refetch on any failure so the board doesn't drift
    // from the DB.
    const results = await Promise.all([
      ...updated.map((c, i) => supabase.from('workflow_steps').update({ position: i }).eq('id', c.id)),
      ...updatedTerminal.map((c) => supabase.from('workflow_steps').update({ position: c.position }).eq('id', c.id)),
    ]);
    if (results.some((r) => r.error)) fetchBoardDetail();
  };

  // ─── Card actions ─────────────────────────────────────────

  const createCard = async () => {
    if (WORKFLOWS_CREATION_DISABLED) {
      showToast?.('Workflow creation is disabled while the unified board is being built', 'error');
      return;
    }
    if (!boardData || !newCardTitle.trim() || creatingCard) return;
    const nonTerminal = columns.filter((c) => !c.is_terminal);
    if (nonTerminal.length === 0) { showToast?.('Add at least one column first', 'error'); return; }
    setCreatingCard(true);
    try {
      await callFn('workflow-start', {
        workflow_id: boardData.id,
        title: newCardTitle.trim(),
        context: {},
      });
      setShowNewCard(false);
      setNewCardTitle('');
      fetchBoardDetail();
    } catch (err) {
      showToast?.(err.message, 'error');
    } finally {
      setCreatingCard(false);
    }
  };

  const openCardDetail = async (card) => {
    setOpenCard(card);

    // Fetch sign-offs for this card's active task.
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id')
      .eq('workflow_instance_id', card.id)
      .eq('status', 'active')
      .eq('requires_sign_off', true);

    if (tasks && tasks.length > 0) {
      const { data: signOffs } = await supabase
        .from('task_sign_offs')
        .select('*')
        .eq('task_id', tasks[0].id)
        .order('created_at', { ascending: true });
      setOpenCardSignOffs(signOffs || []);
    } else {
      setOpenCardSignOffs([]);
    }

    // Fetch audit trail.
    const { data: audit } = await supabase
      .from('workflow_card_audit')
      .select('*')
      .eq('instance_id', card.id)
      .order('created_at', { ascending: false })
      .limit(20);
    setOpenCardAudit(audit || []);
  };

  const saveCard = async (card, patch) => {
    await supabase
      .from('workflow_instances')
      .update({
        title: patch.title,
        context: patch.context,
        assignee_overrides: patch.assignee_overrides,
      })
      .eq('id', card.id);
    fetchBoardDetail();
  };

  const reassignCard = async (card, stepKey, newIds) => {
    // Find the active task for this card in this column.
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id')
      .eq('workflow_instance_id', card.id)
      .eq('step_key', stepKey)
      .eq('status', 'active')
      .eq('requires_sign_off', true);

    if (!tasks || tasks.length === 0) {
      // No active task — just update overrides.
      return;
    }

    // Call the engine's reassign via a direct service call.
    try {
      await callFn('workflow-move-card', {
        instance_id: card.id,
        target_step_key: stepKey,
      });
    } catch (err) {
      showToast?.(err.message, 'error');
    }

    // Also update the assignee_overrides on the card.
    const overrides = { ...(card.assignee_overrides || {}) };
    if (!newIds || newIds.length === 0) delete overrides[stepKey];
    else overrides[stepKey] = newIds;
    await supabase.from('workflow_instances').update({ assignee_overrides: overrides }).eq('id', card.id);

    fetchBoardDetail();
  };

  const deleteCard = async (card) => {
    await supabase
      .from('tasks')
      .update({ status: 'skipped', completed_at: new Date().toISOString() })
      .eq('workflow_instance_id', card.id)
      .in('status', ['active', 'on_hold', 'pending']);
    await supabase.from('workflow_instances').delete().eq('id', card.id);
    setOpenCard(null);
    fetchBoardDetail();
  };

  // ─── Group cards by column ────────────────────────────────

  const cardsByColumn = useMemo(() => {
    const map = {};
    for (const col of columns) map[col.step_key] = [];
    for (const c of cards) {
      const key = c.current_step_key;
      if (key && map[key]) map[key].push(c);
    }
    return map;
  }, [cards, columns]);

  // ─── Render ───────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Back button */}
      <button
        onClick={onBack}
        style={{
          background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 13,
          cursor: 'pointer', padding: '4px 0', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6,
          fontFamily: 'inherit', fontWeight: 600,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Flows
      </button>

      {/* Board view — full width */}
      {!boardData || boardLoading ? (
        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)', padding: 24 }}>Loading…</div>
      ) : (
        <>
          {WORKFLOWS_CREATION_DISABLED && (
            <div style={{
              padding: '10px 14px',
              marginBottom: 12,
              background: 'rgba(245, 158, 11, 0.12)',
              border: '1px solid rgba(245, 158, 11, 0.35)',
              borderRadius: 8,
              color: '#fbbf24',
              fontSize: 13,
              lineHeight: 1.45,
            }}>
              <strong>Workflow creation paused.</strong> New cards can't be added while the unified content board is being built. In-flight cards continue to advance normally.
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#ffffff', margin: 0 }}>{boardData.name}</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={addColumn} style={styles.secondaryBtn}>+ Column</button>
            </div>
          </div>

          <DragDropContext onDragEnd={reorderColumns}>
            <Droppable droppableId="columns" direction="horizontal" type="COLUMN">
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  style={{ display: 'flex', gap: 16, overflowX: 'auto', flex: 1, paddingBottom: 16, alignItems: 'flex-start' }}
                >
                  {columns.length === 0 ? (
                    <div style={{ color: 'rgba(255,255,255,0.4)', padding: 20 }}>
                      No columns yet. Click "+ Column" to add the first stage.
                    </div>
                  ) : (
                    <>
                      {columns.filter((c) => !c.is_terminal).map((col, idx) => (
                        <Draggable key={col.id} draggableId={col.id} index={idx}>
                          {(dragProvided, dragSnapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                              style={{
                                ...dragProvided.draggableProps.style,
                                opacity: dragSnapshot.isDragging ? 0.8 : 1,
                              }}
                            >
                              <KanbanColumn
                                column={col}
                                cards={cardsByColumn[col.step_key] || []}
                                signOffMap={signOffMap}
                                profiles={profiles}
                                isFirst={idx === 0}
                                isLast={false}
                                triggerConfig={boardData.trigger_config}
                                triggerMode={boardData.trigger_mode}
                                onRename={(t) => renameColumn(col, t)}
                                onSetDefault={(ids) => setColumnDefault(col, ids)}
                                onUpdateColumn={(fields) => updateColumnFields(col, fields)}
                                onUpdateTrigger={updateTrigger}
                                onDelete={() => deleteColumn(col)}
                                onCardClick={(c) => openCardDetail(c)}
                                onAddCard={() => { setShowNewCard(true); setNewCardTitle(''); }}
                                onCardContextMenu={(e, c) => { e.preventDefault(); setCardCtxMenu({ x: e.clientX, y: e.clientY, card: c }); }}
                              />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                      {columns.filter((c) => c.is_terminal).map((col) => (
                        <KanbanColumn
                          key={col.id}
                          column={col}
                          cards={cardsByColumn[col.step_key] || []}
                          signOffMap={signOffMap}
                          profiles={profiles}
                          isFirst={false}
                          isLast={true}
                          triggerConfig={boardData.trigger_config}
                          triggerMode={boardData.trigger_mode}
                          onRename={(t) => renameColumn(col, t)}
                          onSetDefault={(ids) => setColumnDefault(col, ids)}
                          onUpdateColumn={(fields) => updateColumnFields(col, fields)}
                          onUpdateTrigger={updateTrigger}
                          onDelete={() => deleteColumn(col)}
                          onCardClick={(c) => openCardDetail(c)}
                          onAddCard={() => { setShowNewCard(true); setNewCardTitle(''); }}
                          onCardContextMenu={(e, c) => { e.preventDefault(); setCardCtxMenu({ x: e.clientX, y: e.clientY, card: c }); }}
                        />
                      ))}
                    </>
                  )}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </>
      )}

      {/* Progress section (matches main Workflows view formatting) */}
      <ProgressTable
        groups={[{ key: 'team', label: 'Team', profiles: scopedTeam, byAssignee }]}
        sprintActiveTaskIds={sprintActiveTaskIds}
        onTaskClick={(task) => setEditingTask(task)}
      />

      {/* Task edit modal */}
      <TaskEditModal
        open={!!editingTask}
        task={editingTask}
        profiles={profiles}
        onClose={() => setEditingTask(null)}
        onSaved={fetchTeamTasks}
      />

      {/* New card modal */}
      {showNewCard && (
        <div style={styles.modalOverlay} {...backdropDismiss(() => setShowNewCard(false))}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, color: '#ffffff', margin: '0 0 16px' }}>New Card</h3>
            <input
              autoFocus
              value={newCardTitle}
              onChange={(e) => setNewCardTitle(e.target.value)}
              placeholder="Card title"
              onKeyDown={(e) => { if (e.key === 'Enter') createCard(); }}
              style={{ ...styles.inputBase, marginBottom: 16 }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowNewCard(false)} style={styles.ghostBtn}>Cancel</button>
              <button onClick={createCard} disabled={!newCardTitle.trim() || creatingCard} style={styles.primaryBtn}>{creatingCard ? 'Creating…' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Card detail modal */}
      {openCard && (
        <CardModal
          card={openCard}
          columns={columns}
          profiles={profiles}
          signOffData={openCardSignOffs}
          auditTrail={openCardAudit}
          onClose={() => { setOpenCard(null); setOpenCardSignOffs([]); setOpenCardAudit([]); }}
          onSave={(patch) => saveCard(openCard, patch)}
          onDelete={() => deleteCard(openCard)}
          onReassign={reassignCard}
        />
      )}

      {/* Card right-click context menu (advance) */}
      {cardCtxMenu && (
        <div
          style={{
            position: 'fixed',
            zIndex: 9999,
            top: cardCtxMenu.y,
            left: cardCtxMenu.x,
            background: colors.bgRaised,
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8,
            padding: 4,
            minWidth: 180,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{
            fontSize: 11, color: 'rgba(255,255,255,0.4)', padding: '6px 10px 4px',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {cardCtxMenu.card.title || 'Untitled'}
          </div>
          <button
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', background: 'none', border: 'none', borderRadius: 6,
              padding: '7px 10px', color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', textAlign: 'left',
            }}
            onClick={handleAdvanceCard}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
            Move to next column
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const styles = {
  // Chips
  chip: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '2px 8px', background: colors.accentA15, color: colors.accentFg,
    borderRadius: 999, fontSize: 11, border: '1px solid rgba(91, 143, 199,0.35)',
  },
  chipX: {
    background: 'transparent', border: 'none', color: colors.accentFg,
    cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1,
  },
  addChipBtn: {
    background: 'transparent', border: '1px dashed rgba(255,255,255,0.12)',
    color: 'rgba(255,255,255,0.5)', borderRadius: 999, padding: '2px 8px',
    cursor: 'pointer', fontSize: 11,
  },
  chipMenu: {
    position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
    background: colors.bgRaised, border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8, zIndex: 100, overflow: 'hidden',
  },
  chipSearch: {
    padding: '4px 8px', background: 'rgba(255,255,255,0.04)',
    border: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)',
    color: '#ffffff', fontSize: 12, outline: 'none', width: '100%', boxSizing: 'border-box',
  },
  chipOption: {
    padding: '4px 8px', cursor: 'pointer', fontSize: 12, color: 'rgba(255,255,255,0.5)',
    display: 'flex', justifyContent: 'space-between', gap: 8,
  },

  // Input / select
  inputBase: {
    padding: '8px 12px', background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6,
    color: '#ffffff', fontSize: 13, fontFamily: 'inherit',
    outline: 'none', width: '100%', boxSizing: 'border-box',
  },
  selectBase: {
    padding: '6px 8px', background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6,
    color: '#ffffff', fontSize: 12, fontFamily: 'inherit',
    outline: 'none', width: '100%', boxSizing: 'border-box',
  },
  fieldLabel: {
    fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase',
    letterSpacing: 0.5, fontWeight: 700, display: 'block', marginBottom: 4,
  },

  // Buttons
  primaryBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
    padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
    cursor: 'pointer', border: 'none', background: colors.accent, color: colors.white,
    whiteSpace: 'nowrap',
  },
  primaryBtnSm: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
    cursor: 'pointer', border: 'none', background: colors.accent, color: colors.white,
  },
  secondaryBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
    cursor: 'pointer', border: 'none', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)',
  },
  ghostBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
    cursor: 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
    color: 'rgba(255,255,255,0.5)',
  },
  dangerBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
    cursor: 'pointer', border: 'none', background: '#ef4444', color: '#ffffff',
  },

  // Pills
  warningPill: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600,
    letterSpacing: 0.3, border: '1px solid rgba(234,179,8,0.35)',
    background: 'rgba(234,179,8,0.15)', color: '#eab308',
    lineHeight: 1.4, whiteSpace: 'nowrap',
  },

  // Column
  column: {
    width: 280, minWidth: 280, background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10,
    padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
    alignSelf: 'flex-start', maxHeight: 'calc(100vh - 240px)',
  },
  columnHeader: {
    display: 'flex', flexDirection: 'column', gap: 8,
    paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  cardList: {
    display: 'flex', flexDirection: 'column', gap: 8,
    overflowY: 'auto', flex: 1, minHeight: 80, padding: '4px 0',
  },

  // Card tile
  cardTile: {
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 8, padding: 12, cursor: 'pointer',
    display: 'flex', flexDirection: 'column', gap: 4,
    transition: 'all 120ms ease-out',
  },

  addCardBtn: {
    background: 'transparent', border: '1px dashed rgba(255,255,255,0.12)',
    borderRadius: 8, padding: '8px 12px', color: 'rgba(255,255,255,0.5)',
    fontSize: 12, cursor: 'pointer', width: '100%',
  },

  // Modal
  modalOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    background: colors.bgRaised, border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 14, padding: 20, width: 600, maxWidth: '90vw',
    boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
  },
};
