import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import useIsMobile from '../../hooks/useIsMobile';
import { callEdgeFn } from '../../lib/edgeFn';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../lib/styleTokens';
import {
  CANONICAL_STAGES,
  PROJECT_TYPE_OPTIONS,
  STAGE_COLORS,
  labelFor,
  typeLabel,
} from '../../lib/kanbanStages';

const SELECT = `
  id, name, type, status, deadline, on_hold, hold_reason, archived_at,
  project_stage_assignments(id, stage, user_id, profile:profiles(id, full_name, nickname))
`;

function sortByDueDate(a, b) {
  if (!a.deadline && !b.deadline) return a.name.localeCompare(b.name);
  if (!a.deadline) return 1;
  if (!b.deadline) return -1;
  return new Date(a.deadline) - new Date(b.deadline);
}

function getDisplayName(profile) {
  if (!profile) return '';
  return profile.full_name || profile.nickname || '';
}

function isCurrentStageAssignee(project, userId) {
  return (project.project_stage_assignments || []).some(
    (a) => a.stage === project.status && a.user_id === userId,
  );
}

export default function UnifiedBoard() {
  const { profile, isAdmin } = useAuth();
  const isMobile = useIsMobile();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState(() => PROJECT_TYPE_OPTIONS.map((t) => t.value));
  const [holdLaneOpen, setHoldLaneOpen] = useState(false);
  const [retagOpen, setRetagOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [holdModal, setHoldModal] = useState(null);
  const [handoffModal, setHandoffModal] = useState(null);
  const [actionSheet, setActionSheet] = useState(null); // mobile only: { project }
  const [busy, setBusy] = useState(false);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [archivedProjects, setArchivedProjects] = useState([]);
  const [archivedLoading, setArchivedLoading] = useState(false);

  const loadArchived = useCallback(async () => {
    setArchivedLoading(true);
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, type, deadline, archived_at')
      .eq('status', 'publish')
      .not('archived_at', 'is', null)
      .gte('archived_at', since)
      .order('archived_at', { ascending: false });
    if (error) {
      console.error('loadArchived', error);
      setArchivedLoading(false);
      return;
    }
    setArchivedProjects(data || []);
    setArchivedLoading(false);
  }, []);

  useEffect(() => {
    if (archivedExpanded) loadArchived();
  }, [archivedExpanded, loadArchived]);

  const fetchProjects = useCallback(async () => {
    const { data, error } = await supabase
      .from('projects')
      .select(SELECT)
      .is('archived_at', null);
    if (error) {
      console.error('UnifiedBoard fetch error', error);
      setLoading(false);
      return;
    }
    setProjects(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProjects();
    const channel = supabase
      .channel('unified-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, fetchProjects)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_stage_assignments' }, fetchProjects)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchProjects]);

  const untyped = useMemo(() => projects.filter((p) => !p.type), [projects]);
  const typed = useMemo(() => projects.filter((p) => p.type), [projects]);

  const filteredTyped = useMemo(
    () => typed.filter((p) => typeFilter.includes(p.type)),
    [typed, typeFilter],
  );

  const heldProjects = useMemo(
    () => filteredTyped.filter((p) => p.on_hold).sort(sortByDueDate),
    [filteredTyped],
  );

  const byStage = useMemo(() => {
    const map = Object.fromEntries(CANONICAL_STAGES.map((s) => [s, []]));
    filteredTyped.filter((p) => !p.on_hold).forEach((p) => {
      if (map[p.status]) map[p.status].push(p);
    });
    Object.values(map).forEach((arr) => arr.sort(sortByDueDate));
    return map;
  }, [filteredTyped]);

  function toggleType(t) {
    setTypeFilter((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  }

  function canDrag(project) {
    if (project.on_hold) return false;
    if (isAdmin) return true;
    return isCurrentStageAssignee(project, profile?.id);
  }

  async function onDragEnd(result) {
    const { draggableId, source, destination } = result;
    if (!destination) return;
    const targetStage = destination.droppableId;
    const sourceStage = source.droppableId;
    if (targetStage === sourceStage) return;
    if (!CANONICAL_STAGES.includes(targetStage)) return;
    const project = projects.find((p) => p.id === draggableId);
    if (!project) return;

    const sourceIdx = CANONICAL_STAGES.indexOf(sourceStage);
    const targetIdx = CANONICAL_STAGES.indexOf(targetStage);
    const isBackward = targetIdx < sourceIdx;
    if (isBackward && !isAdmin) {
      alert('Only admins can move a card backward.');
      return;
    }

    // Open optional handoff modal for forward moves; backward moves go straight.
    if (!isBackward) {
      setHandoffModal({ project, targetStage });
      return;
    }
    await performMove(project, targetStage, null);
  }

  async function performMove(project, targetStage, handoffNote) {
    setBusy(true);
    try {
      await callEdgeFn('card-move', {
        project_id: project.id,
        target_stage: targetStage,
        handoff_note: handoffNote || undefined,
      });
      fetchProjects();
    } catch (err) {
      alert(`Move failed: ${err.message}`);
    } finally {
      setBusy(false);
      setHandoffModal(null);
    }
  }

  async function performHold(project, action, reason) {
    setBusy(true);
    try {
      await callEdgeFn('card-hold', {
        project_id: project.id,
        action,
        reason: reason || undefined,
      });
      fetchProjects();
    } catch (err) {
      alert(`Hold failed: ${err.message}`);
    } finally {
      setBusy(false);
      setHoldModal(null);
    }
  }

  if (loading) {
    return (
      <div style={{ color: colors.textSubtle, padding: spacing.xxl, textAlign: 'center' }}>Loading board…</div>
    );
  }

  return (
    <div style={s.board}>
      {/* Re-tag banner */}
      {untyped.length > 0 && (
        <div style={s.retagBanner}>
          <span style={{ color: colors.warning.fgSoft, fontWeight: fontWeights.semibold }}>
            {untyped.length} project{untyped.length === 1 ? '' : 's'} need{untyped.length === 1 ? 's' : ''} a type
          </span>
          <button onClick={() => setRetagOpen(true)} style={s.bannerBtn}>Review</button>
        </div>
      )}

      {/* Top bar */}
      <div style={s.topBar}>
        <div style={s.filterRow}>
          {PROJECT_TYPE_OPTIONS.map((t) => {
            const active = typeFilter.includes(t.value);
            return (
              <button
                key={t.value}
                onClick={() => toggleType(t.value)}
                style={{
                  ...s.chip,
                  ...(active ? s.chipActive : null),
                }}
              >{t.label}</button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: spacing.sm }}>
          <button
            onClick={() => setHoldLaneOpen((v) => !v)}
            style={{ ...s.toggleBtn, ...(holdLaneOpen ? s.toggleBtnActive : null) }}
          >
            Hold {heldProjects.length > 0 ? `(${heldProjects.length})` : ''}
          </button>
          <button onClick={() => setNewProjectOpen(true)} style={s.primaryBtn}>+ New Project</button>
        </div>
      </div>

      {/* Board */}
      {isMobile ? (
        <MobileBoard
          byStage={byStage}
          heldProjects={heldProjects}
          holdLaneOpen={holdLaneOpen}
          isAdmin={isAdmin}
          onCardTap={(p) => setActionSheet({ project: p })}
          onUnhold={(p) => setHoldModal({ project: p, action: 'unhold' })}
          archivedExpanded={archivedExpanded}
          archivedProjects={archivedProjects}
          archivedLoading={archivedLoading}
          onToggleArchived={() => setArchivedExpanded((v) => !v)}
        />
      ) : (
        <div style={s.boardWrap}>
          <DragDropContext onDragEnd={onDragEnd}>
            <div style={s.columnsRow}>
              {CANONICAL_STAGES.map((stage) => (
                <Column
                  key={stage}
                  stage={stage}
                  projects={byStage[stage]}
                  canDragProject={canDrag}
                  footer={stage === 'publish' ? (
                    <ArchivedExpander
                      expanded={archivedExpanded}
                      loading={archivedLoading}
                      projects={archivedProjects}
                      onToggle={() => setArchivedExpanded((v) => !v)}
                    />
                  ) : null}
                />
              ))}
            </div>
          </DragDropContext>

          {holdLaneOpen && (
            <HoldLane
              projects={heldProjects}
              isAdmin={isAdmin}
              onUnhold={(p) => setHoldModal({ project: p, action: 'unhold' })}
            />
          )}
        </div>
      )}

      {actionSheet && (
        <ActionSheet
          project={actionSheet.project}
          isAdmin={isAdmin}
          userId={profile?.id}
          onClose={() => setActionSheet(null)}
          onMove={(targetStage) => {
            const project = actionSheet.project;
            const idx = CANONICAL_STAGES.indexOf(project.status);
            const tIdx = CANONICAL_STAGES.indexOf(targetStage);
            const isBackward = tIdx < idx;
            setActionSheet(null);
            if (isBackward) {
              performMove(project, targetStage, null);
            } else {
              setHandoffModal({ project, targetStage });
            }
          }}
          onHold={() => {
            const project = actionSheet.project;
            setActionSheet(null);
            setHoldModal({ project, action: 'hold' });
          }}
        />
      )}

      {/* Modals */}
      {newProjectOpen && (
        <NewProjectModal
          onClose={() => setNewProjectOpen(false)}
          onCreated={fetchProjects}
          createdBy={profile?.id}
        />
      )}
      {retagOpen && (
        <RetagModal
          untyped={untyped}
          onClose={() => { setRetagOpen(false); fetchProjects(); }}
        />
      )}
      {handoffModal && (
        <HandoffModal
          project={handoffModal.project}
          targetStage={handoffModal.targetStage}
          busy={busy}
          onSubmit={(note) => performMove(handoffModal.project, handoffModal.targetStage, note)}
          onCancel={() => setHandoffModal(null)}
        />
      )}
      {holdModal && (
        <HoldModal
          project={holdModal.project}
          action={holdModal.action}
          busy={busy}
          onSubmit={(reason) => performHold(holdModal.project, holdModal.action, reason)}
          onCancel={() => setHoldModal(null)}
        />
      )}

      {/* Floating admin hold button if a typed project is selected? Skipped — use card right-click later. */}
      {isAdmin && !holdLaneOpen && filteredTyped.some((p) => !p.on_hold) && (
        <div style={s.holdHint}>
          {/* placeholder for future card-detail panel hold action */}
        </div>
      )}
    </div>
  );
}

// ─── Column ──────────────────────────────────────────────────────

function Column({ stage, projects, canDragProject, footer }) {
  return (
    <div style={s.column}>
      <div style={{ ...s.columnHeader, color: STAGE_COLORS[stage] }}>
        <span style={s.columnTitle}>{stage.toUpperCase()}</span>
        <span style={s.columnCount}>{projects.length}</span>
      </div>
      <Droppable droppableId={stage}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            style={{
              ...s.columnBody,
              background: snapshot.isDraggingOver ? colors.bgHover : 'transparent',
            }}
          >
            {projects.map((p, idx) => (
              <Draggable
                key={p.id}
                draggableId={p.id}
                index={idx}
                isDragDisabled={!canDragProject(p)}
              >
                {(drag, dragSnap) => (
                  <div
                    ref={drag.innerRef}
                    {...drag.draggableProps}
                    {...drag.dragHandleProps}
                    style={{
                      ...drag.draggableProps.style,
                      ...s.card,
                      opacity: canDragProject(p) ? 1 : 0.65,
                      boxShadow: dragSnap.isDragging ? '0 8px 20px rgba(0,0,0,0.4)' : 'none',
                    }}
                  >
                    <KanbanCard project={p} />
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
      {footer}
    </div>
  );
}

// ─── ArchivedExpander ────────────────────────────────────────────

function ArchivedExpander({ expanded, loading, projects, onToggle }) {
  return (
    <div style={s.archived.wrap}>
      <button onClick={onToggle} style={s.archived.toggle}>
        <span>{expanded ? '▾' : '▸'} Published archive</span>
        {expanded && <span style={s.archived.count}>{projects.length}</span>}
      </button>
      {expanded && (
        <div style={s.archived.body}>
          {loading ? (
            <div style={s.archived.empty}>Loading…</div>
          ) : projects.length === 0 ? (
            <div style={s.archived.empty}>No recent published cards</div>
          ) : projects.map((p) => (
            <div key={p.id} style={s.archived.card}>
              <div style={{ ...s.cardTitle, fontSize: fontSizes.sm }}>{p.name}</div>
              <div style={{ ...s.cardMeta, fontSize: 10 }}>
                <span style={s.typeTag}>{typeLabel(p.type)}</span>
                {p.archived_at && (
                  <span style={s.archived.date}>
                    {new Date(p.archived_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── KanbanCard ──────────────────────────────────────────────────

function KanbanCard({ project }) {
  const assignees = (project.project_stage_assignments || [])
    .filter((a) => a.stage === project.status)
    .map((a) => getDisplayName(a.profile))
    .filter(Boolean);
  return (
    <>
      <div style={s.cardTitle}>{project.name}</div>
      <div style={s.cardMeta}>
        <span style={s.typeTag}>{typeLabel(project.type)}</span>
        {project.deadline && (
          <span style={s.dueDate}>
            {new Date(project.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>
      {assignees.length > 0 && (
        <div style={s.assigneeRow}>{assignees.slice(0, 3).join(' · ')}</div>
      )}
    </>
  );
}

// ─── MobileBoard ─────────────────────────────────────────────────

function MobileBoard({
  byStage, heldProjects, holdLaneOpen, isAdmin,
  onCardTap, onUnhold,
  archivedExpanded, archivedProjects, archivedLoading, onToggleArchived,
}) {
  const stages = holdLaneOpen ? [...CANONICAL_STAGES, 'hold'] : CANONICAL_STAGES;
  const [stageIdx, setStageIdx] = useState(0);
  const railRef = useRef(null);

  useEffect(() => {
    if (stageIdx >= stages.length) setStageIdx(0);
  }, [stages.length, stageIdx]);

  // Sync rail scroll to stageIdx (programmatic).
  useEffect(() => {
    if (!railRef.current) return;
    const el = railRef.current;
    const target = el.children[stageIdx];
    if (target) el.scrollTo({ left: target.offsetLeft, behavior: 'smooth' });
  }, [stageIdx]);

  // Detect scroll-snap landing to update active dot.
  function onRailScroll() {
    if (!railRef.current) return;
    const el = railRef.current;
    const w = el.clientWidth;
    const idx = Math.round(el.scrollLeft / w);
    if (idx !== stageIdx && idx >= 0 && idx < stages.length) setStageIdx(idx);
  }

  const currentStage = stages[stageIdx];
  const isHoldStage = currentStage === 'hold';
  const cards = isHoldStage ? heldProjects : (byStage[currentStage] || []);
  const headerColor = isHoldStage ? colors.warning.fg : STAGE_COLORS[currentStage];
  const headerLabel = isHoldStage ? 'HOLD' : currentStage?.toUpperCase();

  return (
    <div style={s.mobile.wrap}>
      <div style={{ ...s.mobile.stageHeader, color: headerColor }}>
        <span style={s.mobile.stageTitle}>{headerLabel}</span>
        <span style={s.mobile.stageCount}>{cards.length}</span>
      </div>

      <div style={s.mobile.dots}>
        {stages.map((st, i) => (
          <button
            key={st}
            onClick={() => setStageIdx(i)}
            aria-label={st}
            style={{
              ...s.mobile.dot,
              background: i === stageIdx ? (st === 'hold' ? colors.warning.fg : STAGE_COLORS[st]) : colors.borderStrong,
            }}
          />
        ))}
      </div>

      <div ref={railRef} onScroll={onRailScroll} style={s.mobile.rail}>
        {stages.map((stage) => {
          const list = stage === 'hold' ? heldProjects : (byStage[stage] || []);
          return (
            <div key={stage} style={s.mobile.slide}>
              {list.length === 0 ? (
                <div style={s.mobile.empty}>No cards</div>
              ) : list.map((p) => (
                <div key={p.id} onClick={() => stage === 'hold' ? null : onCardTap(p)} style={s.mobile.card}>
                  <div style={s.cardTitle}>{p.name}</div>
                  <div style={s.cardMeta}>
                    <span style={s.typeTag}>{typeLabel(p.type)}</span>
                    {p.deadline && (
                      <span style={s.dueDate}>
                        {new Date(p.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </div>
                  {stage === 'hold' && p.hold_reason && (
                    <div style={s.holdReason}>{p.hold_reason}</div>
                  )}
                  {stage === 'hold' && isAdmin && (
                    <button onClick={(e) => { e.stopPropagation(); onUnhold(p); }} style={s.smallBtn}>Unhold</button>
                  )}
                </div>
              ))}
              {stage === 'publish' && (
                <ArchivedExpander
                  expanded={archivedExpanded}
                  loading={archivedLoading}
                  projects={archivedProjects}
                  onToggle={onToggleArchived}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── ActionSheet (mobile move/hold menu) ─────────────────────────

function ActionSheet({ project, isAdmin, userId, onClose, onMove, onHold }) {
  const currentIdx = CANONICAL_STAGES.indexOf(project.status);
  const isCurrentAssignee = (project.project_stage_assignments || [])
    .some((a) => a.stage === project.status && a.user_id === userId);
  const canForward = isAdmin || isCurrentAssignee;
  const canBackward = isAdmin;
  const targets = CANONICAL_STAGES.filter((stage, idx) => {
    if (idx === currentIdx) return false;
    if (idx > currentIdx) return canForward;
    return canBackward;
  });

  return (
    <div style={s.mobile.sheetOverlay} onClick={onClose}>
      <div style={s.mobile.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={s.mobile.sheetTitle}>{project.name}</div>
        <div style={s.mobile.sheetSub}>{typeLabel(project.type)} · currently {project.status}</div>

        {targets.length > 0 ? (
          <div style={{ marginTop: spacing.md }}>
            <div style={s.mobile.sheetSection}>MOVE TO</div>
            {targets.map((stage) => (
              <button key={stage} onClick={() => onMove(stage)} style={s.mobile.sheetBtn}>
                {labelFor(project.type, stage)}
                <span style={s.mobile.sheetDir}>
                  {CANONICAL_STAGES.indexOf(stage) > currentIdx ? '→' : '←'}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ color: colors.textSubtle, fontSize: fontSizes.sm, marginTop: spacing.md }}>
            You can't move this card from its current column.
          </div>
        )}

        {isAdmin && !project.on_hold && (
          <button onClick={onHold} style={{ ...s.mobile.sheetBtn, marginTop: spacing.md }}>
            Hold card
          </button>
        )}

        <button onClick={onClose} style={{ ...s.mobile.sheetBtn, ...s.mobile.sheetCancel }}>Cancel</button>
      </div>
    </div>
  );
}

// ─── HoldLane ────────────────────────────────────────────────────

function HoldLane({ projects, isAdmin, onUnhold }) {
  return (
    <div style={s.holdLane}>
      <div style={s.holdLaneHeader}>HOLD</div>
      {projects.length === 0 ? (
        <div style={s.holdEmpty}>No held cards</div>
      ) : (
        projects.map((p) => (
          <div key={p.id} style={{ ...s.card, opacity: 0.85 }}>
            <div style={s.cardTitle}>{p.name}</div>
            {p.hold_reason && (
              <div style={s.holdReason}>{p.hold_reason}</div>
            )}
            {isAdmin && (
              <button onClick={() => onUnhold(p)} style={s.smallBtn}>Unhold</button>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ─── HandoffModal ────────────────────────────────────────────────

function HandoffModal({ project, targetStage, busy, onSubmit, onCancel }) {
  const [note, setNote] = useState('');
  const targetTitle = labelFor(project.type, targetStage);
  return (
    <ModalShell title={`Move "${project.name}" to ${targetTitle}`} onClose={onCancel}>
      <div style={{ color: colors.textMuted, fontSize: fontSizes.md, marginBottom: spacing.md }}>
        Add an optional handoff note for the next assignee. Leave blank to skip.
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. raw footage in Drive; needs B-roll overlay at 2:14"
        style={s.textarea}
      />
      <div style={s.modalActions}>
        <button onClick={onCancel} style={s.ghostBtn} disabled={busy}>Cancel</button>
        <button onClick={() => onSubmit(note.trim() || null)} style={s.primaryBtn} disabled={busy}>
          {busy ? 'Moving…' : 'Move'}
        </button>
      </div>
    </ModalShell>
  );
}

// ─── HoldModal ───────────────────────────────────────────────────

function HoldModal({ project, action, busy, onSubmit, onCancel }) {
  const [reason, setReason] = useState('');
  const isHold = action === 'hold';
  return (
    <ModalShell title={`${isHold ? 'Hold' : 'Unhold'} "${project.name}"`} onClose={onCancel}>
      {isHold ? (
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this being held?"
          style={s.textarea}
        />
      ) : (
        <div style={{ color: colors.textMuted, fontSize: fontSizes.md }}>
          Restore this card to the board?
        </div>
      )}
      <div style={s.modalActions}>
        <button onClick={onCancel} style={s.ghostBtn} disabled={busy}>Cancel</button>
        <button
          onClick={() => onSubmit(isHold ? reason.trim() : null)}
          style={s.primaryBtn}
          disabled={busy || (isHold && !reason.trim())}
        >
          {busy ? 'Working…' : isHold ? 'Hold' : 'Unhold'}
        </button>
      </div>
    </ModalShell>
  );
}

// ─── RetagModal ──────────────────────────────────────────────────

function RetagModal({ untyped, onClose }) {
  const [busyId, setBusyId] = useState(null);
  async function retag(p, newType) {
    setBusyId(p.id);
    const { error } = await supabase.from('projects').update({ type: newType }).eq('id', p.id);
    if (error) alert(`Retag failed: ${error.message}`);
    setBusyId(null);
  }
  return (
    <ModalShell title="Type these projects" onClose={onClose} wide>
      {untyped.length === 0 ? (
        <div style={{ color: colors.textMuted, fontSize: fontSizes.md, padding: spacing.lg }}>
          All projects are tagged. ✓
        </div>
      ) : untyped.map((p) => (
        <div key={p.id} style={s.retagRow}>
          <div style={{ flex: 1 }}>
            <div style={{ color: colors.text, fontWeight: fontWeights.semibold }}>{p.name}</div>
            <div style={{ color: colors.textSubtle, fontSize: fontSizes.xs }}>status: {p.status}</div>
          </div>
          <select
            defaultValue=""
            disabled={busyId === p.id}
            onChange={(e) => e.target.value && retag(p, e.target.value)}
            style={s.input}
          >
            <option value="">Choose type…</option>
            {PROJECT_TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      ))}
      <div style={s.modalActions}>
        <button onClick={onClose} style={s.primaryBtn}>Done</button>
      </div>
    </ModalShell>
  );
}

// ─── NewProjectModal ─────────────────────────────────────────────

function NewProjectModal({ onClose, onCreated, createdBy }) {
  const [name, setName] = useState('');
  const [type, setType] = useState(PROJECT_TYPE_OPTIONS[0].value);
  const [startColumn, setStartColumn] = useState('idea');
  const [deadline, setDeadline] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const { error } = await supabase.from('projects').insert({
      name: name.trim(),
      type,
      status: startColumn,
      start_column: startColumn,
      deadline: deadline || null,
      category: 'creative',
      created_by: createdBy,
    });
    setBusy(false);
    if (error) {
      alert(`Create failed: ${error.message}`);
      return;
    }
    onCreated?.();
    onClose();
  }

  return (
    <ModalShell title="New project" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g. iPhone 17 Review"
            style={s.input}
          />
        </Field>
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value)} style={s.input}>
            {PROJECT_TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Start at column">
          <select value={startColumn} onChange={(e) => setStartColumn(e.target.value)} style={s.input}>
            {CANONICAL_STAGES.map((st) => (
              <option key={st} value={st}>{labelFor(type, st)}</option>
            ))}
          </select>
        </Field>
        <Field label="Deadline">
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            style={s.input}
          />
        </Field>
        <div style={s.modalActions}>
          <button type="button" onClick={onClose} style={s.ghostBtn} disabled={busy}>Cancel</button>
          <button type="submit" style={s.primaryBtn} disabled={busy}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: spacing.md }}>
      <label style={s.fieldLabel}>{label}</label>
      {children}
    </div>
  );
}

// ─── ModalShell ──────────────────────────────────────────────────

function ModalShell({ title, onClose, children, wide }) {
  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div
        style={{ ...s.modal, maxWidth: wide ? 640 : 480 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={s.modalHeader}>
          <span style={{ color: colors.text, fontSize: fontSizes.lg, fontWeight: fontWeights.semibold }}>{title}</span>
          <button onClick={onClose} style={s.closeBtn}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────

const s = {
  board: {
    display: 'flex', flexDirection: 'column', gap: spacing.md,
    color: colors.text,
  },
  retagBanner: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: `${spacing.sm}px ${spacing.lg}px`,
    background: colors.warning.bg, border: `1px solid ${colors.warning.border}`,
    borderRadius: radii.md,
    fontSize: fontSizes.md,
  },
  bannerBtn: {
    background: colors.warning.fg, color: '#000',
    border: 'none', borderRadius: radii.sm,
    padding: `${spacing.xs}px ${spacing.md}px`,
    fontSize: fontSizes.sm, fontWeight: fontWeights.semibold,
    cursor: 'pointer',
  },
  topBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.lg, flexWrap: 'wrap',
  },
  filterRow: { display: 'flex', gap: spacing.sm, flexWrap: 'wrap' },
  chip: {
    background: colors.bgRaised, border: `1px solid ${colors.border}`,
    color: colors.textMuted, borderRadius: radii.pill,
    padding: `${spacing.xs}px ${spacing.md}px`,
    fontSize: fontSizes.sm, cursor: 'pointer',
  },
  chipActive: {
    background: colors.accentSoft, borderColor: colors.accentBorder, color: colors.accentFg,
  },
  toggleBtn: {
    background: colors.bgRaised, border: `1px solid ${colors.border}`,
    color: colors.textMuted, borderRadius: radii.md,
    padding: `${spacing.xs}px ${spacing.md}px`,
    fontSize: fontSizes.sm, cursor: 'pointer',
  },
  toggleBtnActive: {
    background: colors.warning.bg, borderColor: colors.warning.border, color: colors.warning.fg,
  },
  primaryBtn: {
    background: colors.accent, color: colors.text, border: 'none',
    borderRadius: radii.md, padding: `${spacing.sm}px ${spacing.lg}px`,
    fontSize: fontSizes.md, fontWeight: fontWeights.semibold, cursor: 'pointer',
  },
  ghostBtn: {
    background: 'transparent', color: colors.textMuted,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.md, padding: `${spacing.sm}px ${spacing.lg}px`,
    fontSize: fontSizes.md, cursor: 'pointer',
  },
  smallBtn: {
    background: colors.bgRaised, color: colors.textMuted,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm, padding: `${spacing.xs}px ${spacing.sm}px`,
    fontSize: fontSizes.xs, cursor: 'pointer', marginTop: spacing.xs,
  },
  boardWrap: {
    display: 'flex', gap: spacing.md, alignItems: 'flex-start',
  },
  columnsRow: {
    display: 'grid', gridTemplateColumns: 'repeat(6, minmax(180px, 1fr))',
    gap: spacing.md, flex: 1, minWidth: 0,
  },
  column: {
    background: colors.bgRaised, border: `1px solid ${colors.border}`,
    borderRadius: radii.md, padding: spacing.sm,
    display: 'flex', flexDirection: 'column', minHeight: 400,
  },
  columnHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    fontSize: fontSizes.xs, fontWeight: fontWeights.bold, letterSpacing: 1,
    paddingBottom: spacing.sm, marginBottom: spacing.sm,
    borderBottom: `1px solid ${colors.border}`,
  },
  columnTitle: {},
  columnCount: { color: colors.textDim, fontWeight: fontWeights.regular },
  columnBody: {
    display: 'flex', flexDirection: 'column', gap: spacing.sm,
    flex: 1, borderRadius: radii.sm, padding: spacing.xs, minHeight: 100,
  },
  card: {
    background: colors.bgModal, border: `1px solid ${colors.border}`,
    borderRadius: radii.md, padding: spacing.md,
    fontSize: fontSizes.md, cursor: 'grab',
  },
  cardTitle: {
    color: colors.text, fontWeight: fontWeights.semibold,
    fontSize: fontSizes.md, marginBottom: spacing.xs,
  },
  cardMeta: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    fontSize: fontSizes.xs,
  },
  typeTag: {
    color: colors.textDim, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  dueDate: { color: colors.textMuted, fontWeight: fontWeights.medium },
  assigneeRow: {
    marginTop: spacing.xs, color: colors.textSubtle, fontSize: fontSizes.xs,
  },
  holdLane: {
    width: 240, flexShrink: 0,
    background: colors.warning.bg, border: `1px solid ${colors.warning.border}`,
    borderRadius: radii.md, padding: spacing.sm,
    display: 'flex', flexDirection: 'column', gap: spacing.sm,
    maxHeight: '70vh', overflowY: 'auto',
  },
  holdLaneHeader: {
    color: colors.warning.fg, fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold, letterSpacing: 1,
    padding: `0 ${spacing.xs}px ${spacing.sm}px`,
    borderBottom: `1px solid ${colors.warning.border}`,
  },
  holdEmpty: { color: colors.textDim, fontSize: fontSizes.sm, padding: spacing.sm },
  holdReason: {
    color: colors.warning.fgSoft, fontSize: fontSizes.xs,
    marginTop: spacing.xs, lineHeight: 1.4,
  },
  modalOverlay: {
    position: 'fixed', inset: 0, background: colors.bgOverlay,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: spacing.lg,
  },
  modal: {
    background: colors.bgModal, border: `1px solid ${colors.borderStrong}`,
    borderRadius: radii.lg, padding: spacing.xl,
    width: '100%',
    maxHeight: '85vh', overflowY: 'auto',
  },
  modalHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  closeBtn: {
    background: 'transparent', color: colors.textMuted, border: 'none',
    fontSize: fontSizes.lg, cursor: 'pointer',
  },
  modalActions: {
    display: 'flex', gap: spacing.sm, justifyContent: 'flex-end',
    marginTop: spacing.lg,
  },
  fieldLabel: {
    display: 'block', color: colors.textSubtle,
    fontSize: fontSizes.xs, marginBottom: spacing.xs,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  input: {
    width: '100%', background: colors.bgInput,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.text, padding: `${spacing.sm}px ${spacing.md}px`,
    fontSize: fontSizes.md, fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  textarea: {
    width: '100%', background: colors.bgInput,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.text, padding: spacing.md,
    fontSize: fontSizes.md, fontFamily: 'inherit',
    minHeight: 100, resize: 'vertical', boxSizing: 'border-box',
  },
  retagRow: {
    display: 'flex', alignItems: 'center', gap: spacing.md,
    padding: `${spacing.sm}px 0`,
    borderBottom: `1px solid ${colors.border}`,
  },
  holdHint: { display: 'none' },

  archived: {
    wrap: {
      marginTop: spacing.sm,
      borderTop: `1px dashed ${colors.border}`,
      paddingTop: spacing.sm,
    },
    toggle: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      width: '100%',
      background: 'transparent', border: 'none',
      color: colors.textSubtle, fontSize: fontSizes.xs,
      textTransform: 'uppercase', letterSpacing: 0.5,
      padding: `${spacing.xs}px 0`, cursor: 'pointer',
    },
    count: { color: colors.textDim },
    body: {
      display: 'flex', flexDirection: 'column', gap: spacing.xs,
      marginTop: spacing.xs,
    },
    empty: {
      color: colors.textDim, fontSize: fontSizes.xs,
      padding: `${spacing.sm}px 0`,
    },
    card: {
      background: 'transparent', border: `1px dashed ${colors.border}`,
      borderRadius: radii.sm, padding: spacing.sm,
      opacity: 0.65,
    },
    date: { color: colors.textDim },
  },

  mobile: {
    wrap: { display: 'flex', flexDirection: 'column', gap: spacing.sm },
    stageHeader: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: `0 ${spacing.xs}px`,
      fontSize: fontSizes.xs, fontWeight: fontWeights.bold, letterSpacing: 1,
    },
    stageTitle: {},
    stageCount: { color: colors.textDim, fontWeight: fontWeights.regular },
    dots: {
      display: 'flex', gap: spacing.xs, justifyContent: 'center',
      padding: `${spacing.xs}px 0`,
    },
    dot: {
      width: 8, height: 8, borderRadius: '50%',
      border: 'none', cursor: 'pointer', padding: 0,
      transition: 'background 120ms',
    },
    rail: {
      display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory',
      WebkitOverflowScrolling: 'touch',
      gap: 0,
      scrollbarWidth: 'none',
    },
    slide: {
      flex: '0 0 100%', scrollSnapAlign: 'start',
      display: 'flex', flexDirection: 'column', gap: spacing.sm,
      minHeight: 300, padding: `${spacing.sm}px ${spacing.xs}px`,
    },
    empty: {
      color: colors.textDim, fontSize: fontSizes.sm,
      padding: spacing.lg, textAlign: 'center',
    },
    card: {
      background: colors.bgModal, border: `1px solid ${colors.border}`,
      borderRadius: radii.md, padding: spacing.md,
      cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
    },
    sheetOverlay: {
      position: 'fixed', inset: 0, background: colors.bgOverlay,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      zIndex: 1000,
    },
    sheet: {
      background: colors.bgModal, border: `1px solid ${colors.borderStrong}`,
      borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg,
      padding: spacing.lg,
      width: '100%', maxWidth: 480,
      maxHeight: '80vh', overflowY: 'auto',
    },
    sheetTitle: {
      color: colors.text, fontSize: fontSizes.lg, fontWeight: fontWeights.semibold,
    },
    sheetSub: {
      color: colors.textSubtle, fontSize: fontSizes.xs, marginTop: spacing.xs,
      textTransform: 'uppercase', letterSpacing: 0.5,
    },
    sheetSection: {
      color: colors.textSubtle, fontSize: fontSizes.xs,
      textTransform: 'uppercase', letterSpacing: 0.5,
      marginBottom: spacing.xs,
    },
    sheetBtn: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      width: '100%',
      background: colors.bgRaised, border: `1px solid ${colors.border}`,
      color: colors.text, borderRadius: radii.md,
      padding: `${spacing.md}px ${spacing.lg}px`,
      fontSize: fontSizes.md, fontWeight: fontWeights.medium,
      cursor: 'pointer', marginBottom: spacing.xs,
    },
    sheetDir: { color: colors.textDim, fontSize: fontSizes.lg },
    sheetCancel: {
      marginTop: spacing.md, justifyContent: 'center',
      color: colors.textMuted, background: 'transparent',
    },
  },
};
