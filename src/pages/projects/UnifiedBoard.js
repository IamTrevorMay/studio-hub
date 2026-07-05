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
  typeColors,
  defaultStageConfigForType,
  defaultAssigneeRowsForType,
} from '../../lib/kanbanStages';

const SELECT = `
  id, name, type, status, deadline, on_hold, hold_reason, archived_at, stage_config, sort_order,
  project_stage_assignments(id, stage, user_id, profile:profiles(id, full_name, nickname, title, role))
`;

function sortByDueDate(a, b) {
  if (!a.deadline && !b.deadline) return a.name.localeCompare(b.name);
  if (!a.deadline) return 1;
  if (!b.deadline) return -1;
  return new Date(a.deadline) - new Date(b.deadline);
}

function sortBySortOrder(a, b) {
  const aOrd = a.sort_order ?? Infinity;
  const bOrd = b.sort_order ?? Infinity;
  if (aOrd !== bOrd) return aOrd - bOrd;
  return sortByDueDate(a, b);
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
  const [editProject, setEditProject] = useState(null);
  const [cardCtxMenu, setCardCtxMenu] = useState(null); // { x, y, project }
  const [busy, setBusy] = useState(false);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [archivedProjects, setArchivedProjects] = useState([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [taskPlannedDates, setTaskPlannedDates] = useState({});

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

  const fetchPlannedDates = useCallback(async () => {
    const { data } = await supabase
      .from('tasks')
      .select('related_entity_id, assignee_id, planned_date')
      .eq('related_entity_type', 'project')
      .not('planned_date', 'is', null)
      .in('status', ['pending', 'active', 'on_hold']);
    if (!data) return;
    const map = {};
    for (const t of data) {
      if (!t.related_entity_id || !t.assignee_id) continue;
      if (!map[t.related_entity_id]) map[t.related_entity_id] = {};
      map[t.related_entity_id][t.assignee_id] = t.planned_date;
    }
    setTaskPlannedDates(map);
  }, []);

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
    fetchPlannedDates();
    const channel = supabase
      .channel('unified-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, fetchProjects)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_stage_assignments' }, fetchProjects)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, fetchPlannedDates)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchProjects, fetchPlannedDates]);

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

  const backlogProjects = useMemo(
    () => filteredTyped.filter((p) => p.status === 'backlog' && !p.on_hold).sort(sortByDueDate),
    [filteredTyped],
  );

  const byStage = useMemo(() => {
    const map = Object.fromEntries(CANONICAL_STAGES.map((s) => [s, []]));
    filteredTyped.filter((p) => !p.on_hold && p.status !== 'backlog').forEach((p) => {
      if (map[p.status]) map[p.status].push(p);
    });
    Object.entries(map).forEach(([stage, arr]) => {
      arr.sort(stage === 'queue' ? sortBySortOrder : sortByDueDate);
    });
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

  // Persist sort_order for a list of queue projects (optimistic — state already updated).
  async function persistQueueOrder(orderedProjects) {
    const updates = orderedProjects.map((p, i) => ({ id: p.id, sort_order: i }));
    for (const u of updates) {
      await supabase.from('projects').update({ sort_order: u.sort_order }).eq('id', u.id);
    }
  }

  async function onDragEnd(result) {
    const { draggableId, source, destination } = result;
    if (!destination) return;
    const destId = destination.droppableId;
    const srcId = source.droppableId;
    if (destId === srcId && destination.index === source.index) return;

    // Parse composite queue droppable IDs (e.g. "queue::mayday_video")
    const isDestQueue = destId.startsWith('queue::');
    const isSrcQueue = srcId.startsWith('queue::');
    const destStage = isDestQueue ? 'queue' : destId;
    const srcStage = isSrcQueue ? 'queue' : srcId;
    const destType = isDestQueue ? destId.split('::')[1] : null;
    const srcType = isSrcQueue ? srcId.split('::')[1] : null;

    const project = projects.find((p) => p.id === draggableId);
    if (!project) return;

    // Within-Queue reorder (same type section)
    if (isSrcQueue && isDestQueue && srcType === destType) {
      const queueProjects = byStage.queue || [];
      const typeGroup = queueProjects.filter((p) => (p.type || 'other') === srcType);
      const reordered = [...typeGroup];
      const [moved] = reordered.splice(source.index, 1);
      reordered.splice(destination.index, 0, moved);
      // Optimistic update: rebuild full queue with this type group reordered
      const otherGroups = queueProjects.filter((p) => (p.type || 'other') !== srcType);
      const newQueue = [];
      for (const opt of PROJECT_TYPE_OPTIONS) {
        if (opt.value === srcType) newQueue.push(...reordered);
        else newQueue.push(...otherGroups.filter((p) => p.type === opt.value));
      }
      const others = otherGroups.filter((p) => !PROJECT_TYPE_OPTIONS.some((o) => o.value === p.type));
      newQueue.push(...others);
      // Update sort_order locally
      newQueue.forEach((p, i) => { p.sort_order = i; });
      setProjects((prev) => prev.map((p) => {
        const updated = newQueue.find((q) => q.id === p.id);
        return updated ? { ...p, sort_order: updated.sort_order } : p;
      }));
      persistQueueOrder(newQueue);
      return;
    }

    // Cross-type drop within Queue — disallow (can't change card type by dragging)
    if (isSrcQueue && isDestQueue && srcType !== destType) return;

    // Validate target is a known stage
    const validTargets = [...CANONICAL_STAGES, 'backlog'];
    if (!validTargets.includes(destStage)) return;

    // Same stage, no reorder for non-Queue columns
    if (destStage === srcStage && !isDestQueue) return;

    // Backlog ops: admin-only, no handoff modal.
    if (destStage === 'backlog' || srcStage === 'backlog') {
      if (!isAdmin) {
        alert('Only admins can move cards in or out of Backlog.');
        return;
      }
      // Backlog → Queue: move and assign sort_order at drop position
      if (srcStage === 'backlog' && destStage === 'queue') {
        await performMove(project, 'queue', null);
        // After move, assign sort_order within the project's type section
        const queueProjects = (byStage.queue || []).filter((p) => p.type === project.type);
        const newList = [...queueProjects];
        newList.splice(destination.index, 0, { ...project, status: 'queue' });
        persistQueueOrder(
          // Rebuild full queue order
          [...(byStage.queue || []).filter((p) => p.type !== project.type), ...newList]
        );
        return;
      }
      await performMove(project, destStage, null);
      return;
    }

    const sourceIdx = CANONICAL_STAGES.indexOf(srcStage);
    const targetIdx = CANONICAL_STAGES.indexOf(destStage);
    const isBackward = targetIdx < sourceIdx;
    if (isBackward && !isAdmin) {
      alert('Only admins can move a card backward.');
      return;
    }

    // Open optional handoff modal for forward moves; backward moves go straight.
    if (!isBackward) {
      setHandoffModal({ project, targetStage: destStage });
      return;
    }
    await performMove(project, destStage, null);
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

  async function duplicateProject(project) {
    setBusy(true);
    try {
      const { error } = await supabase.from('projects').insert({
        name: `${project.name} (copy)`,
        type: project.type,
        status: 'queue',
        start_column: 'queue',
        deadline: project.deadline || null,
        stage_config: project.stage_config || {},
        created_by: profile?.id,
      });
      if (error) throw error;
      fetchProjects();
    } catch (err) {
      alert(`Duplicate failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function archiveProject(project) {
    setBusy(true);
    try {
      const { error } = await supabase
        .from('projects')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', project.id);
      if (error) throw error;
      fetchProjects();
    } catch (err) {
      alert(`Archive failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteProject(project) {
    if (!window.confirm(`Delete "${project.name}" permanently? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('projects').delete().eq('id', project.id);
      if (error) throw error;
      fetchProjects();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    } finally {
      setBusy(false);
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
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: spacing.md }}>
              <div style={s.columnsRow}>
                {CANONICAL_STAGES.map((stage) => stage === 'queue' ? (
                  <QueueColumn
                    key={stage}
                    projects={byStage.queue}
                    taskPlannedDates={taskPlannedDates}
                    canDragProject={canDrag}
                    onCardClick={(p) => setEditProject(p)}
                    onCardContextMenu={isAdmin ? (e, p) => { e.preventDefault(); setCardCtxMenu({ x: e.clientX, y: e.clientY, project: p }); } : null}
                  />
                ) : (
                  <Column
                    key={stage}
                    stage={stage}
                    projects={byStage[stage]}
                    taskPlannedDates={taskPlannedDates}
                    canDragProject={canDrag}
                    onCardClick={(p) => setEditProject(p)}
                    onCardContextMenu={isAdmin ? (e, p) => { e.preventDefault(); setCardCtxMenu({ x: e.clientX, y: e.clientY, project: p }); } : null}
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

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={() => setNewProjectOpen(true)} style={s.primaryBtn}>+ New Project</button>
              </div>

              <BacklogSection
                projects={backlogProjects}
                canDragProject={canDrag}
                onCardClick={(p) => setEditProject(p)}
                onCardContextMenu={isAdmin ? (e, p) => { e.preventDefault(); setCardCtxMenu({ x: e.clientX, y: e.clientY, project: p }); } : null}
              />
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
          onEdit={() => {
            const project = actionSheet.project;
            setActionSheet(null);
            setEditProject(project);
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
      {editProject && (
        <EditProjectModal
          project={editProject}
          isAdmin={isAdmin}
          userId={profile?.id}
          onClose={() => setEditProject(null)}
          onSaved={fetchProjects}
        />
      )}
      {cardCtxMenu && (
        <CardContextMenu
          x={cardCtxMenu.x}
          y={cardCtxMenu.y}
          onClose={() => setCardCtxMenu(null)}
          onDuplicate={async () => { await duplicateProject(cardCtxMenu.project); setCardCtxMenu(null); }}
          onArchive={async () => { await archiveProject(cardCtxMenu.project); setCardCtxMenu(null); }}
          onDelete={async () => { await deleteProject(cardCtxMenu.project); setCardCtxMenu(null); }}
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

function Column({ stage, projects, canDragProject, onCardClick, onCardContextMenu, footer, taskPlannedDates }) {
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
                    onClick={() => { if (!dragSnap.isDragging) onCardClick?.(p); }}
                    onContextMenu={onCardContextMenu ? (e) => onCardContextMenu(e, p) : undefined}
                    style={{
                      ...drag.draggableProps.style,
                      ...s.card,
                      cursor: 'pointer',
                      opacity: canDragProject(p) ? 1 : 0.65,
                      boxShadow: dragSnap.isDragging ? '0 8px 20px rgba(0,0,0,0.4)' : 'none',
                    }}
                  >
                    <KanbanCard project={p} taskPlannedDates={taskPlannedDates} />
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

// ─── QueueColumn ─────────────────────────────────────────────────

function QueueColumn({ projects, canDragProject, onCardClick, onCardContextMenu, taskPlannedDates }) {
  const typeGroups = useMemo(() => {
    const groups = [];
    for (const opt of PROJECT_TYPE_OPTIONS) {
      const items = projects.filter((p) => p.type === opt.value);
      if (items.length > 0) groups.push({ key: opt.value, label: opt.label, items });
    }
    const other = projects.filter((p) => !PROJECT_TYPE_OPTIONS.some((o) => o.value === p.type));
    if (other.length > 0) groups.push({ key: 'other', label: 'Other', items: other });
    return groups;
  }, [projects]);

  return (
    <div style={s.column}>
      <div style={{ ...s.columnHeader, color: STAGE_COLORS.queue }}>
        <span style={s.columnTitle}>QUEUE</span>
        <span style={s.columnCount}>{projects.length}</span>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: spacing.md, overflowY: 'auto' }}>
        {typeGroups.map((group) => {
          const tc = typeColors(group.key);
          return (
            <div key={group.key}>
              <div style={{ ...s.queueSectionHeader, color: tc.fg }}>
                <span>{group.label}</span>
                <span style={{ color: colors.textDim, fontWeight: fontWeights.regular }}>{group.items.length}</span>
              </div>
              <Droppable droppableId={`queue::${group.key}`}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    style={{
                      display: 'flex', flexDirection: 'column', gap: spacing.sm,
                      borderRadius: radii.sm, padding: spacing.xs, minHeight: 32,
                      background: snapshot.isDraggingOver ? colors.bgHover : 'transparent',
                    }}
                  >
                    {group.items.map((p, idx) => (
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
                            onClick={() => { if (!dragSnap.isDragging) onCardClick?.(p); }}
                            onContextMenu={onCardContextMenu ? (e) => onCardContextMenu(e, p) : undefined}
                            style={{
                              ...drag.draggableProps.style,
                              ...s.card,
                              cursor: 'pointer',
                              opacity: canDragProject(p) ? 1 : 0.65,
                              boxShadow: dragSnap.isDragging ? '0 8px 20px rgba(0,0,0,0.4)' : 'none',
                            }}
                          >
                            <KanbanCard project={p} taskPlannedDates={taskPlannedDates} priorityNumber={idx + 1} />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          );
        })}
        {typeGroups.length === 0 && (
          <Droppable droppableId="queue::other">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} style={{ minHeight: 100, padding: spacing.sm }}>
                <div style={{ color: colors.textDim, fontSize: fontSizes.sm }}>No cards in queue</div>
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        )}
      </div>
    </div>
  );
}

// ─── CardContextMenu ─────────────────────────────────────────────

function CardContextMenu({ x, y, onClose, onDuplicate, onArchive, onDelete }) {
  return (
    <>
      <div
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
        style={{ position: 'fixed', inset: 0, zIndex: 998 }}
      />
      <div
        style={{
          position: 'fixed',
          left: x,
          top: y,
          zIndex: 999,
          background: '#1a1a2e',
          border: `1px solid rgba(255,255,255,0.15)`,
          borderRadius: radii.md,
          padding: spacing.xs,
          minWidth: 160,
          boxShadow: '0 12px 32px rgba(0,0,0,0.7)',
        }}
      >
        <CtxItem label="Duplicate" onClick={onDuplicate} />
        <CtxItem label="Archive" onClick={onArchive} />
        <CtxItem label="Delete" onClick={onDelete} danger />
      </div>
    </>
  );
}

function CtxItem({ label, onClick, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: 'transparent',
        border: 'none',
        padding: `${spacing.sm}px ${spacing.md}px`,
        fontSize: fontSizes.sm,
        color: danger ? (colors.danger?.fg || '#ef4444') : colors.text,
        cursor: 'pointer',
        borderRadius: radii.sm,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = colors.bgHover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {label}
    </button>
  );
}

// ─── BacklogSection ──────────────────────────────────────────────

function BacklogSection({ projects, canDragProject, onCardClick, onCardContextMenu }) {
  return (
    <div style={s.backlog.wrap}>
      <div style={s.backlog.header}>
        <span style={s.backlog.title}>BACKLOG</span>
        <span style={s.backlog.count}>{projects.length}</span>
      </div>
      <Droppable droppableId="backlog" direction="horizontal">
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            style={{
              ...s.backlog.body,
              background: snapshot.isDraggingOver ? colors.bgHover : 'transparent',
            }}
          >
            {projects.length === 0 ? (
              <div style={s.backlog.empty}>Drag cards here to park them.</div>
            ) : projects.map((p, idx) => (
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
                    onClick={() => { if (!dragSnap.isDragging) onCardClick?.(p); }}
                    onContextMenu={onCardContextMenu ? (e) => onCardContextMenu(e, p) : undefined}
                    style={{
                      ...drag.draggableProps.style,
                      ...s.backlog.card,
                      cursor: 'pointer',
                      opacity: canDragProject(p) ? 1 : 0.65,
                      boxShadow: dragSnap.isDragging ? '0 8px 20px rgba(0,0,0,0.4)' : 'none',
                    }}
                  >
                    <div style={s.cardTitle}>{p.name}</div>
                    <div style={s.cardMeta}>
                      <span style={{ ...s.typeTag, color: typeColors(p.type).fg, background: typeColors(p.type).bg, borderColor: typeColors(p.type).border }}>{typeLabel(p.type)}</span>
                      {p.deadline && (
                        <span style={s.dueDate}>
                          {new Date(p.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
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
                <span style={{ ...s.typeTag, color: typeColors(p.type).fg, background: typeColors(p.type).bg, borderColor: typeColors(p.type).border }}>{typeLabel(p.type)}</span>
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

function KanbanCard({ project, taskPlannedDates, priorityNumber }) {
  const stageAssignments = (project.project_stage_assignments || [])
    .filter((a) => a.stage === project.status);
  const assignees = stageAssignments.map((a) => getDisplayName(a.profile)).filter(Boolean);
  const projectPlanned = taskPlannedDates?.[project.id];
  return (
    <>
      <div style={s.cardTitle}>
        {priorityNumber != null && (
          <span style={s.priorityBadge}>#{priorityNumber}</span>
        )}
        {project.name}
      </div>
      <div style={s.cardMeta}>
        <span style={{ ...s.typeTag, color: typeColors(project.type).fg, background: typeColors(project.type).bg, borderColor: typeColors(project.type).border }}>{typeLabel(project.type)}</span>
        {project.deadline && (
          <span style={s.dueDate}>
            {new Date(project.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>
      {assignees.length > 0 && (
        <div style={s.assigneeRow}>
          {stageAssignments.slice(0, 3).map((a, i) => {
            const name = getDisplayName(a.profile);
            if (!name) return null;
            const pd = projectPlanned?.[a.user_id];
            return (
              <span key={a.id}>
                {i > 0 && ' · '}
                {name}
                {pd && (
                  <span style={s.plannedBadge}>
                    {new Date(pd + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                )}
              </span>
            );
          })}
        </div>
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
                    <span style={{ ...s.typeTag, color: typeColors(p.type).fg, background: typeColors(p.type).bg, borderColor: typeColors(p.type).border }}>{typeLabel(p.type)}</span>
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

function ActionSheet({ project, isAdmin, userId, onClose, onMove, onHold, onEdit }) {
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

        {onEdit && (
          <button onClick={onEdit} style={{ ...s.mobile.sheetBtn, marginTop: spacing.sm }}>
            Edit card
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
    const patch = { type: newType };
    // Seed default per-type skips only if the project hasn't customized stage_config.
    if (!p.stage_config || Object.keys(p.stage_config).length === 0) {
      patch.stage_config = defaultStageConfigForType(newType);
    }
    const { error } = await supabase.from('projects').update(patch).eq('id', p.id);
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
  const [startColumn, setStartColumn] = useState('queue');
  const [deadline, setDeadline] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const { data: created, error } = await supabase.from('projects').insert({
      name: name.trim(),
      type,
      status: startColumn,
      start_column: startColumn,
      deadline: deadline || null,
      created_by: createdBy,
      stage_config: defaultStageConfigForType(type),
    }).select('id').single();
    if (error) {
      setBusy(false);
      alert(`Create failed: ${error.message}`);
      return;
    }
    const assigneeRows = defaultAssigneeRowsForType(type, created.id);
    if (assigneeRows.length) {
      const { error: aErr } = await supabase.from('project_stage_assignments').insert(assigneeRows);
      if (aErr) console.error('Default assignee seed failed:', aErr);
    }
    setBusy(false);
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
        <Field label="Post Date">
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

// ─── EditProjectModal ────────────────────────────────────────────

function EditProjectModal({ project, isAdmin, userId, onClose, onSaved }) {
  const [name, setName] = useState(project.name || '');
  const [type, setType] = useState(project.type || PROJECT_TYPE_OPTIONS[0].value);
  const [status, setStatus] = useState(project.status);
  const [deadline, setDeadline] = useState(project.deadline ? project.deadline.slice(0, 10) : '');
  const [postTime, setPostTime] = useState(project.post_time || '');
  const [busy, setBusy] = useState(false);
  const [stageConfig, setStageConfig] = useState(project.stage_config || {});
  const [stageAssignments, setStageAssignments] = useState(project.project_stage_assignments || []);
  const [teamMembers, setTeamMembers] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, nickname, role, title, status')
        .neq('status', 'archived');
      if (cancelled) return;
      setTeamMembers((data || []).sort((a, b) =>
        (a.full_name || a.nickname || '').localeCompare(b.full_name || b.nickname || ''),
      ));
    })();
    return () => { cancelled = true; };
  }, []);

  const isAssignee = stageAssignments
    .some((a) => a.stage === project.status && a.user_id === userId);
  const canEdit = isAdmin || isAssignee;
  const canMoveBackward = isAdmin;
  const currentIdx = CANONICAL_STAGES.indexOf(project.status);
  const stageOptions = CANONICAL_STAGES.filter((_, idx) => {
    if (idx === currentIdx) return true;
    if (idx < currentIdx) return canMoveBackward;
    return canEdit;
  });

  async function saveStageSkip(stage, skip) {
    const next = { ...stageConfig };
    const existing = { ...(next[stage] || {}) };
    if (skip) existing.skip = true;
    else delete existing.skip;
    if (Object.keys(existing).length === 0) delete next[stage];
    else next[stage] = existing;
    setStageConfig(next);
    const { error } = await supabase
      .from('projects')
      .update({ stage_config: next })
      .eq('id', project.id);
    if (error) alert(`Failed to save skip: ${error.message}`);
    else onSaved?.();
  }

  async function assignStage(stage, profileId) {
    const { data, error } = await supabase
      .from('project_stage_assignments')
      .insert({ project_id: project.id, stage, user_id: profileId })
      .select('id, stage, user_id, profile:profiles(id, full_name, nickname)')
      .single();
    if (error && error.code !== '23505') {
      alert(`Assign failed: ${error.message}`);
      return;
    }
    if (data) setStageAssignments((prev) => [...prev, data]);
    onSaved?.();
  }

  async function removeStageAssignment(id) {
    const { error } = await supabase
      .from('project_stage_assignments')
      .delete()
      .eq('id', id);
    if (error) { alert(`Remove failed: ${error.message}`); return; }
    setStageAssignments((prev) => prev.filter((a) => a.id !== id));
    onSaved?.();
  }

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const patch = {
        name: name.trim(),
        type,
        deadline: deadline || null,
        post_time: postTime || null,
      };
      const { error } = await supabase.from('projects').update(patch).eq('id', project.id);
      if (error) throw error;
      if (status !== project.status) {
        await callEdgeFn('card-move', {
          project_id: project.id,
          target_stage: status,
        });
      }
      // Calendar event lifecycle for video types
      const VIDEO_TYPES = ['mayday_video', 'tm_baseball_video'];
      if (VIDEO_TYPES.includes(type)) {
        const eventType = type === 'mayday_video' ? 'video_post' : 'tmbb_video';
        if (deadline && postTime) {
          const start = new Date(`${deadline}T${postTime}:00`);
          const end = new Date(start.getTime() + 60 * 60 * 1000);
          if (project.calendar_event_id) {
            await supabase.from('calendar_events').update({
              title: name.trim(),
              event_type: eventType,
              start_date: start.toISOString(),
              end_date: end.toISOString(),
            }).eq('id', project.calendar_event_id);
          } else {
            const { data: evData } = await supabase.from('calendar_events').insert({
              title: name.trim(),
              event_type: eventType,
              start_date: start.toISOString(),
              end_date: end.toISOString(),
              all_day: false,
              created_by: userId,
            }).select().single();
            if (evData) {
              await supabase.from('projects').update({ calendar_event_id: evData.id }).eq('id', project.id);
            }
          }
        } else if (project.calendar_event_id) {
          await supabase.from('calendar_events').delete().eq('id', project.calendar_event_id);
          await supabase.from('projects').update({ calendar_event_id: null }).eq('id', project.id);
        }
      }
      onSaved?.();
      onClose();
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!isAdmin) return;
    if (!window.confirm(`Archive "${project.name}"?`)) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from('projects')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', project.id);
      if (error) throw error;
      onSaved?.();
      onClose();
    } catch (err) {
      alert(`Archive failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Edit project" onClose={onClose} wide>
      <form onSubmit={submit}>
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={!canEdit}
            style={s.input}
          />
        </Field>
        <Field label="Type">
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            disabled={!canEdit}
            style={s.input}
          >
            {PROJECT_TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Stage">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            disabled={!canEdit}
            style={s.input}
          >
            {stageOptions.map((st) => (
              <option key={st} value={st}>{labelFor(type, st)}</option>
            ))}
          </select>
        </Field>
        <div style={{ display: 'flex', gap: spacing.sm }}>
          <div style={{ flex: 1 }}>
            <Field label="Post Date">
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                disabled={!canEdit}
                style={s.input}
              />
            </Field>
          </div>
          {['mayday_video', 'tm_baseball_video'].includes(type) && (
            <div style={{ flex: 1 }}>
              <Field label="Time">
                <input
                  type="time"
                  value={postTime}
                  onChange={(e) => setPostTime(e.target.value)}
                  disabled={!canEdit}
                  style={s.input}
                />
              </Field>
            </div>
          )}
        </div>

        {/* Assignments */}
        <div style={{ marginTop: spacing.md, marginBottom: spacing.md }}>
          <label style={s.fieldLabel}>Assignments</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
            {CANONICAL_STAGES.map((stage) => {
              const stageAs = stageAssignments.filter((a) => a.stage === stage);
              const isCurrentStage = project.status === stage;
              const isSkipped = !!stageConfig[stage]?.skip;
              const stageTask = labelFor(type, stage);
              const shortStage = stage === 'pre_production' ? 'PRE-PROD' : stage === 'post_production' ? 'POST-PROD' : stage.toUpperCase();
              return (
                <div
                  key={stage}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: spacing.sm,
                    padding: '6px 8px',
                    borderRadius: radii.sm,
                    background: isCurrentStage ? `${STAGE_COLORS[stage]}18` : 'rgba(255,255,255,0.02)',
                    borderLeft: isCurrentStage ? `2px solid ${STAGE_COLORS[stage]}` : '2px solid transparent',
                    opacity: isSkipped ? 0.55 : 1,
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 600, color: STAGE_COLORS[stage], width: 70, flexShrink: 0 }}>
                    {shortStage}
                  </span>
                  <select
                    value={isSkipped ? 'skip' : 'task'}
                    onChange={(e) => saveStageSkip(stage, e.target.value === 'skip')}
                    disabled={!isAdmin}
                    title={stageTask}
                    style={{ ...s.input, padding: '4px 6px', fontSize: 12, minWidth: 200, maxWidth: 280, width: 'auto' }}
                  >
                    <option value="task">{stageTask}</option>
                    <option value="skip">Skip</option>
                  </select>
                  <div style={{ display: 'flex', gap: 4, flex: 1, flexWrap: 'wrap', alignItems: 'center', pointerEvents: isSkipped ? 'none' : 'auto' }}>
                    {stageAs.map((a) => {
                      const nm = getDisplayName(a.profile);
                      const tt = a.profile?.title || a.profile?.role;
                      return (
                        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(99,102,241,0.12)', padding: '2px 6px', borderRadius: 6 }}>
                          <span style={{ fontSize: 11, color: '#a5b4fc' }}>{nm}</span>
                          {tt && (
                            <span style={{ fontSize: 10, color: 'rgba(165,180,252,0.6)' }}>— {tt}</span>
                          )}
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => removeStageAssignment(a.id)}
                              disabled={isSkipped}
                              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: isSkipped ? 'not-allowed' : 'pointer', fontSize: 12, padding: 0 }}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {isAdmin && (
                      <select
                        disabled={isSkipped}
                        defaultValue=""
                        onChange={(e) => { if (e.target.value) { assignStage(stage, e.target.value); e.target.value = ''; } }}
                        style={{ ...s.input, padding: '3px 6px', fontSize: 11, minWidth: 90, width: 'auto' }}
                      >
                        <option value="">+ Assign</option>
                        {teamMembers.filter((m) => !stageAs.some((a) => a.user_id === m.id)).map((m) => {
                          const nm = m.full_name || m.nickname || 'Unknown';
                          const tt = m.title || m.role;
                          return (
                            <option key={m.id} value={m.id}>{tt ? `${nm} — ${tt}` : nm}</option>
                          );
                        })}
                      </select>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={s.modalActions}>
          {isAdmin && (
            <button
              type="button"
              onClick={archive}
              style={{ ...s.ghostBtn, marginRight: 'auto', color: colors.danger?.fg || '#ef4444' }}
              disabled={busy}
            >
              Archive
            </button>
          )}
          <button type="button" onClick={onClose} style={s.ghostBtn} disabled={busy}>Cancel</button>
          <button type="submit" style={s.primaryBtn} disabled={busy || !canEdit}>
            {busy ? 'Saving…' : 'Save'}
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
    display: 'grid', gridTemplateColumns: `repeat(${CANONICAL_STAGES.length}, minmax(170px, 1fr))`,
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
    textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: fontWeights.semibold,
    padding: '1px 6px', borderRadius: radii.sm,
    border: '1px solid transparent',
  },
  priorityBadge: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
    color: colors.textSubtle,
    marginRight: 6,
    fontVariantNumeric: 'tabular-nums',
  },
  queueSectionHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    fontSize: 10, fontWeight: fontWeights.bold, letterSpacing: 0.8,
    textTransform: 'uppercase',
    padding: `${spacing.xs}px ${spacing.xs}px 2px`,
  },
  dueDate: { color: colors.textMuted, fontWeight: fontWeights.medium },
  assigneeRow: {
    marginTop: spacing.xs, color: colors.textSubtle, fontSize: fontSizes.xs,
  },
  plannedBadge: {
    fontSize: 9, color: '#facc15', background: 'rgba(250,204,21,0.12)',
    borderRadius: 3, padding: '1px 4px', marginLeft: 4, fontWeight: 600,
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

  backlog: {
    wrap: {
      background: colors.bgRaised,
      border: `1px solid ${colors.border}`,
      borderRadius: radii.md,
      padding: spacing.md,
      width: '100%',
    },
    header: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontSize: fontSizes.xs, fontWeight: fontWeights.bold, letterSpacing: 1,
      color: STAGE_COLORS.backlog,
      paddingBottom: spacing.sm, marginBottom: spacing.sm,
      borderBottom: `1px solid ${colors.border}`,
    },
    title: {},
    count: { color: colors.textDim, fontWeight: fontWeights.regular },
    body: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: spacing.sm,
      minHeight: 80,
      padding: spacing.sm,
      borderRadius: radii.sm,
      alignItems: 'flex-start',
    },
    empty: {
      color: colors.textDim,
      fontStyle: 'italic',
      fontSize: fontSizes.sm,
      padding: `${spacing.sm}px ${spacing.md}px`,
    },
    card: {
      background: colors.bg,
      border: `1px solid ${colors.border}`,
      borderRadius: radii.sm,
      padding: spacing.sm,
      minWidth: 220,
      maxWidth: 280,
      flex: '0 1 240px',
    },
  },
};
