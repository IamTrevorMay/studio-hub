// Kanban-style Workflows panel.
// Each workflow = a board. Columns = stages. Cards = workflow_instances.
// Card movement generates tasks per resolved assignee.

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { callWorkflowFn } from '../../lib/workflowApi';
import { colors, spacing, radii, fontSizes, fontWeights, transitions } from '../../lib/styleTokens';
import { button, input, pill, modalOverlay, modal } from '../../lib/styleRecipes';

// ─── Constants ───────────────────────────────────────────────

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || '';
const CARD_STATUS_TONES = {
  active: colors.accent,
  blocked: colors.warning.fg,
  complete: colors.success.fg,
  cancelled: colors.textDim,
};

// ─── Small helpers ───────────────────────────────────────────

function makeColumnKey(prefix = 'col') {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

async function callFn(fnName, body) {
  // Falls through to workflowApi for the two existing fns; for the new
  // workflow-move-card fn we hit the same edge-runtime URL pattern.
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

  return (
    <div ref={ref} style={chipStyles.wrap}>
      <div style={chipStyles.chipRow}>
        {selected.map((p) => (
          <span key={p.id} style={chipStyles.chip}>
            {p.name}
            <button onClick={() => remove(p.id)} style={chipStyles.chipX}>×</button>
          </span>
        ))}
        <button onClick={() => setOpen((v) => !v)} style={chipStyles.addBtn}>
          {selected.length === 0 ? placeholder : '+'}
        </button>
      </div>
      {open && (
        <div style={chipStyles.menu}>
          <input
            autoFocus
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={chipStyles.search}
          />
          <div style={chipStyles.options}>
            {filtered.length === 0 ? (
              <div style={chipStyles.empty}>No matches</div>
            ) : filtered.map((p) => (
              <div
                key={p.id}
                onClick={() => add(p.id)}
                style={chipStyles.option}
              >
                <span>{p.name}</span>
                <span style={chipStyles.optionRole}>{p.role}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Card detail modal ───────────────────────────────────────

function CardModal({ card, columns, profiles, onClose, onSave, onDelete }) {
  const [title, setTitle] = useState(card.title || '');
  const [notes, setNotes] = useState((card.context && card.context.notes) || '');
  const [linkUrl, setLinkUrl] = useState((card.context && card.context.link_url) || '');
  const [overrides, setOverrides] = useState({ ...(card.assignee_overrides || {}) });
  const [saving, setSaving] = useState(false);

  const setOverride = (stepKey, ids) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (!ids || ids.length === 0) delete next[stepKey];
      else next[stepKey] = ids;
      return next;
    });
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

  return (
    <div style={modalOverlay()} onClick={onClose}>
      <div style={{ ...modal({ width: 600 }), maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg }}>
          <h3 style={{ fontSize: fontSizes.xl, fontWeight: fontWeights.bold, color: colors.text, margin: 0 }}>Card</h3>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: colors.textDim, fontSize: 22, cursor: 'pointer' }}
          >×</button>
        </div>

        <label style={fieldLabel}>Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ ...input(), marginBottom: spacing.lg }}
          placeholder="Card title"
        />

        <label style={fieldLabel}>Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={{ ...input(), minHeight: 70, resize: 'vertical', marginBottom: spacing.lg }}
          placeholder="Optional notes"
        />

        <label style={fieldLabel}>Link URL</label>
        <input
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          style={{ ...input(), marginBottom: spacing.lg }}
          placeholder="https://…"
        />

        <div style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>
          <label style={fieldLabel}>Per-stage assignees (overrides column default)</label>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
          {columns.map((c) => (
            <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
              <span style={{ fontSize: fontSizes.sm, color: colors.textMuted }}>{c.title_template || c.step_key}</span>
              <AssigneeChips
                value={overrides[c.step_key] || []}
                profiles={profiles}
                onChange={(ids) => setOverride(c.step_key, ids)}
                placeholder="Use column default…"
              />
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: spacing.sm, justifyContent: 'space-between', marginTop: spacing.xl }}>
          <button
            onClick={() => { if (window.confirm('Delete this card? Open tasks will be skipped.')) onDelete(); }}
            style={button({ variant: 'danger', size: 'sm' })}
          >Delete card</button>
          <div style={{ display: 'flex', gap: spacing.sm }}>
            <button onClick={onClose} style={button({ variant: 'ghost', size: 'sm' })}>Cancel</button>
            <button onClick={save} disabled={saving || !title.trim()} style={button({ variant: 'primary', size: 'sm' })}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Card tile (in column) ───────────────────────────────────

function CardTile({ card, openTaskCount, onClick, onDragStart, onDragEnd }) {
  const tone = CARD_STATUS_TONES[card.status] || colors.accent;
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, card)}
      onDragEnd={onDragEnd}
      onClick={() => onClick(card)}
      style={{
        ...cardTileBase,
        borderLeft: `3px solid ${tone}`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: spacing.sm, alignItems: 'flex-start' }}>
        <span style={{ fontSize: fontSizes.md, fontWeight: fontWeights.semibold, color: colors.text, flex: 1, lineHeight: 1.3 }}>
          {card.title || 'Untitled'}
        </span>
        {card.status === 'blocked' && (
          <span style={pill('warning')}>Blocked</span>
        )}
      </div>
      {openTaskCount > 0 && (
        <span style={{ fontSize: fontSizes.xs, color: colors.textDim }}>
          {openTaskCount} open task{openTaskCount === 1 ? '' : 's'}
        </span>
      )}
    </div>
  );
}

// ─── Column ──────────────────────────────────────────────────

function Column({
  column, cards, openCounts, profiles,
  onRename, onSetDefault, onDelete,
  onCardClick, onAddCard, onDragStart, onDragEnd, onDropCard,
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(column.title_template || '');

  useEffect(() => { setTitleDraft(column.title_template || ''); }, [column.title_template]);

  const commitTitle = () => {
    setEditingTitle(false);
    if (titleDraft.trim() && titleDraft.trim() !== column.title_template) {
      onRename(titleDraft.trim());
    }
  };

  return (
    <div
      style={columnStyle}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
      onDrop={(e) => { e.preventDefault(); onDropCard(column); }}
    >
      <div style={columnHeader}>
        {editingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') { setEditingTitle(false); setTitleDraft(column.title_template || ''); } }}
            style={{ ...input({ size: 'sm' }), fontWeight: fontWeights.semibold }}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
            <h3
              onClick={() => setEditingTitle(true)}
              style={{ fontSize: fontSizes.lg, fontWeight: fontWeights.semibold, color: colors.text, margin: 0, cursor: 'text' }}
            >
              {column.title_template || column.step_key}
            </h3>
            <div style={{ display: 'flex', gap: spacing.xs, alignItems: 'center' }}>
              <span style={{ fontSize: fontSizes.xs, color: colors.textDim }}>{cards.length}</span>
              <button
                onClick={() => { if (window.confirm(`Delete column "${column.title_template}"? Cards in it will be skipped.`)) onDelete(); }}
                style={{ background: 'transparent', border: 'none', color: colors.textDim, fontSize: 16, cursor: 'pointer', padding: '0 4px' }}
                title="Delete column"
              >×</button>
            </div>
          </div>
        )}
        <div style={{ marginTop: spacing.sm }}>
          <span style={{ fontSize: fontSizes.xxs, color: colors.textDim, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Default assignees
          </span>
          <AssigneeChips
            value={column.default_assignee_ids || []}
            profiles={profiles}
            onChange={(ids) => onSetDefault(ids)}
            placeholder="None — cards will block here"
          />
        </div>
      </div>

      <div style={cardListStyle}>
        {cards.map((c) => (
          <CardTile
            key={c.id}
            card={c}
            openTaskCount={openCounts[c.id] || 0}
            onClick={onCardClick}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        ))}
      </div>

      <button onClick={onAddCard} style={addCardBtn}>+ Add card</button>
    </div>
  );
}

// ─── Main panel ──────────────────────────────────────────────

export default function KanbanPanel({ showToast }) {
  const [boards, setBoards] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [listLoading, setListLoading] = useState(true);

  const [columns, setColumns] = useState([]);
  const [cards, setCards] = useState([]);
  const [openCountsByCard, setOpenCountsByCard] = useState({}); // { cardId: number }
  const [boardLoading, setBoardLoading] = useState(false);

  const [profiles, setProfiles] = useState([]);

  const [showNewBoard, setShowNewBoard] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');

  const [showNewCard, setShowNewCard] = useState(false);
  const [newCardTitle, setNewCardTitle] = useState('');

  const [openCard, setOpenCard] = useState(null);
  const draggedCardRef = useRef(null);

  const selectedBoard = boards.find((b) => b.id === selectedId);

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

  // ─── Load boards ──────────────────────────────────────────

  const fetchBoards = useCallback(async () => {
    const { data, error } = await supabase
      .from('workflows')
      .select('id, slug, name, is_active')
      .order('created_at', { ascending: true });
    if (error) { showToast?.('Failed to load boards', 'error'); }
    else setBoards(data || []);
    setListLoading(false);
  }, [showToast]);

  useEffect(() => { fetchBoards(); }, [fetchBoards]);

  // ─── Load selected board (columns + cards) ────────────────

  const fetchBoardDetail = useCallback(async () => {
    if (!selectedId) { setColumns([]); setCards([]); setOpenCountsByCard({}); return; }
    setBoardLoading(true);
    try {
      const [{ data: cols }, { data: cardRows }] = await Promise.all([
        supabase
          .from('workflow_steps')
          .select('id, workflow_id, step_key, title_template, position, default_assignee_ids')
          .eq('workflow_id', selectedId)
          .order('position', { ascending: true }),
        supabase
          .from('workflow_instances')
          .select('id, workflow_id, status, title, context, current_step_key, assignee_overrides, started_at')
          .eq('workflow_id', selectedId)
          .in('status', ['active', 'blocked'])
          .order('started_at', { ascending: true }),
      ]);

      setColumns((cols || []).map((c) => ({ ...c, default_assignee_ids: c.default_assignee_ids || [] })));
      setCards(cardRows || []);

      const cardIds = (cardRows || []).map((c) => c.id);
      if (cardIds.length > 0) {
        const { data: openTasks } = await supabase
          .from('tasks')
          .select('workflow_instance_id')
          .in('workflow_instance_id', cardIds)
          .in('status', ['active', 'on_hold', 'pending']);
        const counts = {};
        for (const t of openTasks || []) {
          counts[t.workflow_instance_id] = (counts[t.workflow_instance_id] || 0) + 1;
        }
        setOpenCountsByCard(counts);
      } else {
        setOpenCountsByCard({});
      }
    } finally {
      setBoardLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { fetchBoardDetail(); }, [fetchBoardDetail]);

  // Realtime: refresh on instance/task changes for the selected board.
  useEffect(() => {
    if (!selectedId) return;
    const ch = supabase
      .channel(`kanban-board-${selectedId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_instances', filter: `workflow_id=eq.${selectedId}` }, fetchBoardDetail)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, fetchBoardDetail)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_steps', filter: `workflow_id=eq.${selectedId}` }, fetchBoardDetail)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [selectedId, fetchBoardDetail]);

  // ─── Board CRUD ───────────────────────────────────────────

  const createBoard = async () => {
    const name = newBoardName.trim();
    if (!name) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
    const { data, error } = await supabase
      .from('workflows')
      .insert({ name, slug: `${slug}_${Date.now().toString(36)}`, is_active: true, source: 'data', trigger_mode: 'manual' })
      .select('id, slug, name, is_active')
      .single();
    if (error) { showToast?.(error.message, 'error'); return; }
    setBoards((prev) => [...prev, data]);
    setSelectedId(data.id);
    setShowNewBoard(false);
    setNewBoardName('');
    showToast?.('Board created');
  };

  const deleteBoard = async () => {
    if (!selectedBoard) return;
    if (!window.confirm(`Delete board "${selectedBoard.name}" and all its cards + tasks?`)) return;
    await supabase.from('workflows').delete().eq('id', selectedBoard.id);
    setSelectedId(null);
    fetchBoards();
    showToast?.('Board deleted');
  };

  const toggleBoardActive = async (board) => {
    const next = !board.is_active;
    await supabase.from('workflows').update({ is_active: next }).eq('id', board.id);
    setBoards((prev) => prev.map((b) => (b.id === board.id ? { ...b, is_active: next } : b)));
  };

  // ─── Column CRUD ──────────────────────────────────────────

  const addColumn = async () => {
    if (!selectedId) return;
    const pos = columns.length > 0 ? Math.max(...columns.map((c) => c.position)) + 1 : 0;
    const { error } = await supabase.from('workflow_steps').insert({
      workflow_id: selectedId,
      step_key: makeColumnKey(),
      title_template: `Column ${columns.length + 1}`,
      position: pos,
      assignee_type: 'static',
      action_type: 'complete',
      action_label: 'Mark Complete',
    });
    if (error) showToast?.(error.message, 'error');
    else fetchBoardDetail();
  };

  const renameColumn = async (column, newTitle) => {
    await supabase.from('workflow_steps').update({ title_template: newTitle }).eq('id', column.id);
    fetchBoardDetail();
  };

  const setColumnDefault = async (column, ids) => {
    const had = (column.default_assignee_ids || []).length > 0;
    const willHave = ids.length > 0;
    let applyToCurrent = false;
    if (had || willHave) {
      const cardsHere = cards.filter((c) => c.current_step_key === column.step_key && c.status !== 'complete');
      if (cardsHere.length > 0) {
        applyToCurrent = window.confirm(
          `Apply new default to ${cardsHere.length} card${cardsHere.length === 1 ? '' : 's'} currently in this column?`,
        );
      }
    }
    await supabase.from('workflow_steps').update({ default_assignee_ids: ids }).eq('id', column.id);
    if (applyToCurrent) {
      const cardsHere = cards.filter((c) => c.current_step_key === column.step_key && c.status !== 'complete');
      for (const c of cardsHere) {
        // Re-enter the column by calling move-card with the same column.
        try {
          await callFn('workflow-move-card', { instance_id: c.id, target_step_key: column.step_key });
        } catch (err) { console.error('reapply default:', err); }
      }
    }
    fetchBoardDetail();
  };

  const deleteColumn = async (column) => {
    await supabase.from('workflow_steps').delete().eq('id', column.id);
    fetchBoardDetail();
  };

  // ─── Card actions ─────────────────────────────────────────

  const createCard = async () => {
    if (!selectedBoard || !newCardTitle.trim()) return;
    if (columns.length === 0) { showToast?.('Add at least one column first', 'error'); return; }
    try {
      await callFn('workflow-start', {
        workflow_id: selectedBoard.id,
        title: newCardTitle.trim(),
        context: {},
      });
      setShowNewCard(false);
      setNewCardTitle('');
      fetchBoardDetail();
    } catch (err) {
      showToast?.(err.message, 'error');
    }
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

  const deleteCard = async (card) => {
    // Skip open tasks then delete instance.
    await supabase
      .from('tasks')
      .update({ status: 'skipped', completed_at: new Date().toISOString() })
      .eq('workflow_instance_id', card.id)
      .in('status', ['active', 'on_hold', 'pending']);
    await supabase.from('workflow_instances').delete().eq('id', card.id);
    setOpenCard(null);
    fetchBoardDetail();
  };

  // ─── Drag-drop ────────────────────────────────────────────

  const onDragStart = (e, card) => {
    draggedCardRef.current = card;
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragEnd = () => { draggedCardRef.current = null; };

  const onDropCard = async (column) => {
    const card = draggedCardRef.current;
    draggedCardRef.current = null;
    if (!card) return;
    if (card.current_step_key === column.step_key) return;
    try {
      await callFn('workflow-move-card', { instance_id: card.id, target_step_key: column.step_key });
      fetchBoardDetail();
    } catch (err) {
      showToast?.(err.message, 'error');
    }
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
    <div style={{ display: 'flex', gap: spacing.xxl, flex: 1, minHeight: 0 }}>
      {/* Left: board list */}
      <div style={leftPanelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg }}>
          <h2 style={{ fontSize: fontSizes.xl, fontWeight: fontWeights.bold, color: colors.text, margin: 0 }}>Boards</h2>
          <button onClick={() => setShowNewBoard(true)} style={button({ variant: 'primary', size: 'sm' })}>+ New</button>
        </div>
        {listLoading ? (
          <div style={{ textAlign: 'center', color: colors.textDim, padding: spacing.xl }}>Loading…</div>
        ) : boards.length === 0 ? (
          <p style={{ color: colors.textDim, fontSize: fontSizes.sm, textAlign: 'center', padding: spacing.xl }}>No boards yet</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
            {boards.map((b) => (
              <div
                key={b.id}
                onClick={() => setSelectedId(b.id)}
                style={{
                  ...listItemStyle,
                  ...(selectedId === b.id ? listItemSelected : {}),
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: fontSizes.md, color: colors.text, fontWeight: fontWeights.semibold }}>{b.name}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleBoardActive(b); }}
                    title={b.is_active ? 'Active' : 'Inactive'}
                    style={{
                      width: 10, height: 10, borderRadius: '50%', border: 'none', cursor: 'pointer',
                      background: b.is_active ? colors.success.fg : colors.borderStrong,
                    }}
                  />
                </div>
                <span style={{ fontSize: fontSizes.xs, color: colors.textDim, fontFamily: 'monospace' }}>{b.slug}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right: board view */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {!selectedBoard ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: colors.textDim }}>
            Select a board to view or create one
          </div>
        ) : boardLoading ? (
          <div style={{ textAlign: 'center', color: colors.textDim, padding: spacing.xxl }}>Loading…</div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg }}>
              <h2 style={{ fontSize: fontSizes.xl, fontWeight: fontWeights.bold, color: colors.text, margin: 0 }}>{selectedBoard.name}</h2>
              <div style={{ display: 'flex', gap: spacing.sm }}>
                <button onClick={addColumn} style={button({ variant: 'secondary', size: 'sm' })}>+ Column</button>
                <button onClick={deleteBoard} style={button({ variant: 'ghost', size: 'sm' })}>Delete board</button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: spacing.lg, overflowX: 'auto', flex: 1, paddingBottom: spacing.lg, alignItems: 'flex-start' }}>
              {columns.length === 0 ? (
                <div style={{ color: colors.textDim, padding: spacing.xl }}>
                  No columns yet. Click "+ Column" to add the first stage.
                </div>
              ) : columns.map((col) => (
                <Column
                  key={col.id}
                  column={col}
                  cards={cardsByColumn[col.step_key] || []}
                  openCounts={openCountsByCard}
                  profiles={profiles}
                  onRename={(t) => renameColumn(col, t)}
                  onSetDefault={(ids) => setColumnDefault(col, ids)}
                  onDelete={() => deleteColumn(col)}
                  onCardClick={(c) => setOpenCard(c)}
                  onAddCard={() => { setShowNewCard(true); setNewCardTitle(''); }}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onDropCard={() => onDropCard(col)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* New board modal */}
      {showNewBoard && (
        <div style={modalOverlay()} onClick={() => setShowNewBoard(false)}>
          <div style={modal({ width: 420 })} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: fontSizes.xl, color: colors.text, margin: `0 0 ${spacing.lg}px` }}>New Board</h3>
            <input
              autoFocus
              value={newBoardName}
              onChange={(e) => setNewBoardName(e.target.value)}
              placeholder="Board name (e.g. Mayday Video)"
              onKeyDown={(e) => { if (e.key === 'Enter') createBoard(); }}
              style={{ ...input(), marginBottom: spacing.lg }}
            />
            <div style={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowNewBoard(false)} style={button({ variant: 'ghost', size: 'sm' })}>Cancel</button>
              <button onClick={createBoard} disabled={!newBoardName.trim()} style={button({ variant: 'primary', size: 'sm' })}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* New card modal */}
      {showNewCard && (
        <div style={modalOverlay()} onClick={() => setShowNewCard(false)}>
          <div style={modal({ width: 420 })} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: fontSizes.xl, color: colors.text, margin: `0 0 ${spacing.lg}px` }}>New Card</h3>
            <input
              autoFocus
              value={newCardTitle}
              onChange={(e) => setNewCardTitle(e.target.value)}
              placeholder="Card title"
              onKeyDown={(e) => { if (e.key === 'Enter') createCard(); }}
              style={{ ...input(), marginBottom: spacing.lg }}
            />
            <div style={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowNewCard(false)} style={button({ variant: 'ghost', size: 'sm' })}>Cancel</button>
              <button onClick={createCard} disabled={!newCardTitle.trim()} style={button({ variant: 'primary', size: 'sm' })}>Create</button>
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
          onClose={() => setOpenCard(null)}
          onSave={(patch) => saveCard(openCard, patch)}
          onDelete={() => deleteCard(openCard)}
        />
      )}
    </div>
  );
}

// Suppress lint warning for the imported callWorkflowFn (kept for parity with workflowApi).
// eslint-disable-next-line no-unused-vars
const _kept = callWorkflowFn;
// eslint-disable-next-line no-unused-vars
const _t = transitions;
// eslint-disable-next-line no-unused-vars
const _r = radii;

// ─── Styles ──────────────────────────────────────────────────

const leftPanelStyle = {
  width: 260,
  minWidth: 260,
  borderRight: `1px solid ${colors.border}`,
  paddingRight: spacing.xl,
  display: 'flex',
  flexDirection: 'column',
};

const listItemStyle = {
  padding: `${spacing.sm}px ${spacing.md}px`,
  borderRadius: radii.md,
  cursor: 'pointer',
  border: '1px solid transparent',
  transition: transitions.fast,
  display: 'flex',
  flexDirection: 'column',
  gap: spacing.xs,
};

const listItemSelected = {
  background: colors.accentSoft,
  border: `1px solid ${colors.accentBorder}`,
};

const columnStyle = {
  width: 280,
  minWidth: 280,
  background: colors.bgRaised,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.lg,
  padding: spacing.md,
  display: 'flex',
  flexDirection: 'column',
  gap: spacing.sm,
  alignSelf: 'flex-start',
  maxHeight: 'calc(100vh - 240px)',
};

const columnHeader = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing.sm,
  paddingBottom: spacing.sm,
  borderBottom: `1px solid ${colors.border}`,
};

const cardListStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing.sm,
  overflowY: 'auto',
  flex: 1,
  minHeight: 80,
  padding: `${spacing.xs}px 0`,
};

const cardTileBase = {
  background: colors.bgHover,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.md,
  padding: spacing.md,
  cursor: 'grab',
  display: 'flex',
  flexDirection: 'column',
  gap: spacing.xs,
  transition: transitions.fast,
};

const addCardBtn = {
  background: 'transparent',
  border: `1px dashed ${colors.borderStrong}`,
  borderRadius: radii.md,
  padding: `${spacing.sm}px ${spacing.md}px`,
  color: colors.textMuted,
  fontSize: fontSizes.sm,
  cursor: 'pointer',
  width: '100%',
};

const fieldLabel = {
  fontSize: fontSizes.xxs,
  color: colors.textDim,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  fontWeight: fontWeights.bold,
  display: 'block',
  marginBottom: spacing.xs,
};

const chipStyles = {
  wrap: { position: 'relative', width: '100%' },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center', marginTop: spacing.xs },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: `2px ${spacing.sm}px`,
    background: colors.accentSoft,
    color: colors.accentFg,
    borderRadius: radii.pill,
    fontSize: fontSizes.xs,
    border: `1px solid ${colors.accentBorder}`,
  },
  chipX: {
    background: 'transparent',
    border: 'none',
    color: colors.accentFg,
    cursor: 'pointer',
    fontSize: 14,
    padding: 0,
    lineHeight: 1,
  },
  addBtn: {
    background: 'transparent',
    border: `1px dashed ${colors.borderStrong}`,
    color: colors.textMuted,
    borderRadius: radii.pill,
    padding: `2px ${spacing.sm}px`,
    cursor: 'pointer',
    fontSize: fontSizes.xs,
  },
  menu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: spacing.xs,
    background: colors.bgModal,
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: radii.md,
    zIndex: 100,
    overflow: 'hidden',
  },
  search: {
    ...input({ size: 'sm' }),
    borderRadius: 0,
    border: 'none',
    borderBottom: `1px solid ${colors.border}`,
  },
  options: { maxHeight: 200, overflowY: 'auto' },
  option: {
    padding: `${spacing.xs}px ${spacing.sm}px`,
    cursor: 'pointer',
    fontSize: fontSizes.sm,
    color: colors.textMuted,
    display: 'flex',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  optionRole: { fontSize: fontSizes.xxs, color: colors.textDim, textTransform: 'uppercase' },
  empty: { padding: spacing.sm, fontSize: fontSizes.sm, color: colors.textDim, textAlign: 'center' },
};
