import React, { useState, useEffect, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useSupabaseQuery } from '../hooks/useSupabaseQuery';

const STATUSES = ['concept', 'script', 'production', 'edit', 'review', 'published'];
const STATUS_LABELS = {
  concept: 'Concept', script: 'Script', production: 'Production',
  edit: 'Edit', review: 'Review', published: 'Published',
};
const STATUS_COLORS = {
  concept: '#8b5cf6', script: '#3b82f6', production: '#f59e0b',
  edit: '#f97316', review: '#ec4899', published: '#22c55e',
};
const PROJECT_TYPES = [
  { value: 'youtube_video', label: 'YouTube Video' },
  { value: 'short_form', label: 'Short Form' },
  { value: 'social_post', label: 'Social Post' },
  { value: 'podcast', label: 'Podcast' },
  { value: 'other', label: 'Other' },
];
const ASSIGNMENT_ROLES = ['producer', 'writer', 'editor', 'designer', 'reviewer', 'other'];

export default function Projects({ onNavigate }) {
  const { profile, isAdmin } = useAuth();
  const { safeQuery } = useSupabaseQuery();
  const [projects, setProjects] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [concepts, setConcepts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('projects_view') || 'list');

  // Form state
  const [form, setForm] = useState({
    name: '', type: 'youtube_video', channel: '',
    start_date: '', deadline: '', notes: '', status: 'concept',
  });

  useEffect(() => {
    localStorage.setItem('projects_view', viewMode);
  }, [viewMode]);

  const fetchProjects = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('projects')
        .select(`
          *,
          project_assignments(*, profile:profiles(id, full_name, title)),
          project_attachments(*),
          concept:concepts(id, name, color),
          project_checklists(*)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setProjects(data || []);
    } catch (err) {
      console.error('Error:', err);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => setLoading(false), 5000);
    fetchProjects().finally(() => clearTimeout(timeout));
    fetchTeamMembers();
    fetchConcepts();

    const channel = supabase
      .channel('projects-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => {
        fetchProjects();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_checklists' }, () => {
        fetchProjects();
      })
      .subscribe();

    return () => {
      clearTimeout(timeout);
      supabase.removeChannel(channel);
    };
  }, [fetchProjects]);

  async function fetchTeamMembers() {
    try {
      const { data } = await supabase.from('profiles').select('id, full_name, title');
      setTeamMembers(data || []);
    } catch (err) {
      console.error('Error fetching team:', err);
    }
  }

  async function handleCreateProject(e) {
    e.preventDefault();
    const { error } = await supabase.from('projects').insert({
      ...form,
      created_by: profile.id,
    });
    if (error) {
      alert('Error creating project: ' + error.message);
      return;
    }
    setForm({ name: '', type: 'youtube_video', channel: '', start_date: '', deadline: '', notes: '', status: 'concept' });
    setShowForm(false);
    fetchProjects();
  }

  async function handleStatusChange(projectId, newStatus) {
    const project = projects.find(p => p.id === projectId);
    await supabase.from('projects').update({ status: newStatus }).eq('id', projectId);
    // Notify assigned users
    if (project?.project_assignments) {
      const notifs = project.project_assignments
        .filter(a => a.user_id !== profile.id)
        .map(a => ({
          user_id: a.user_id,
          type: 'status_change',
          title: `${project.name} moved to ${STATUS_LABELS[newStatus]}`,
          body: `${profile.full_name} changed the status`,
          link_tab: 'projects',
          link_target: projectId,
        }));
      if (notifs.length > 0) {
        await supabase.from('notifications').insert(notifs);
      }
    }
    fetchProjects();
  }

  async function handleAssign(projectId, userId, role) {
    await supabase.from('project_assignments').insert({
      project_id: projectId, user_id: userId, assignment_role: role,
    });
    // Notify assigned user
    if (userId !== profile.id) {
      const project = projects.find(p => p.id === projectId);
      await supabase.from('notifications').insert({
        user_id: userId,
        type: 'assignment',
        title: `You were assigned to ${project?.name || 'a project'}`,
        body: `Role: ${role} — by ${profile.full_name}`,
        link_tab: 'projects',
        link_target: projectId,
      });
    }
    fetchProjects();
  }

  async function handleRemoveAssignment(assignmentId) {
    await supabase.from('project_assignments').delete().eq('id', assignmentId);
    fetchProjects();
  }

  async function handleAddAttachment(projectId, name, url, type) {
    await supabase.from('project_attachments').insert({
      project_id: projectId, name, url, type, uploaded_by: profile.id,
    });
    fetchProjects();
  }

  async function handleRemoveAttachment(attachmentId) {
    await supabase.from('project_attachments').delete().eq('id', attachmentId);
    fetchProjects();
  }

  async function handleAddComment(projectId, content) {
    if (!profile?.id || !content.trim()) return;
    const { error } = await supabase.from('project_comments').insert({
      project_id: projectId, user_id: profile.id, content: content.trim(),
    });
    if (error) console.error('Error adding comment:', error);
    // Notify project assignees
    const project = projects.find(p => p.id === projectId);
    if (project?.project_assignments) {
      const notifs = project.project_assignments
        .filter(a => a.user_id !== profile.id)
        .map(a => ({
          user_id: a.user_id,
          type: 'comment',
          title: `New comment on ${project.name}`,
          body: content.trim().substring(0, 100),
          link_tab: 'projects',
          link_target: projectId,
        }));
      if (notifs.length > 0) {
        await supabase.from('notifications').insert(notifs);
      }
    }
  }

  async function handleDeleteComment(commentId) {
    const { error } = await supabase.from('project_comments').delete().eq('id', commentId);
    if (error) console.error('Error deleting comment:', error);
  }

  async function fetchConcepts() {
    try {
      const { data } = await supabase.from('concepts').select('id, name, color').order('name');
      setConcepts(data || []);
    } catch (err) {
      console.error('Error fetching concepts:', err);
    }
  }

  async function handleDeleteProject(projectId) {
    if (!window.confirm('Delete this project and all its data?')) return;
    await supabase.from('projects').delete().eq('id', projectId);
    fetchProjects();
  }

  async function handleLinkConcept(projectId, conceptId) {
    await supabase.from('projects').update({ concept_id: conceptId || null }).eq('id', projectId);
    fetchProjects();
  }

  async function handleAddChecklistItem(projectId, stage, content) {
    if (!content.trim()) return;
    await supabase.from('project_checklists').insert({
      project_id: projectId, stage, content: content.trim(), created_by: profile.id,
    });
    fetchProjects();
  }

  async function handleToggleChecklistItem(itemId, isComplete) {
    await supabase.from('project_checklists').update({
      is_complete: !isComplete, updated_at: new Date().toISOString(),
    }).eq('id', itemId);
    fetchProjects();
  }

  async function handleDeleteChecklistItem(itemId) {
    await supabase.from('project_checklists').delete().eq('id', itemId);
    fetchProjects();
  }

  function onDragEnd(result) {
    if (!result.destination) return;
    const { draggableId, destination } = result;
    const newStatus = destination.droppableId;
    const project = projects.find(p => p.id === draggableId);
    if (project && project.status !== newStatus) {
      handleStatusChange(draggableId, newStatus);
    }
  }

  const filtered = projects.filter(p => {
    if (filterStatus !== 'all' && p.status !== filterStatus) return false;
    if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={styles.page}>
      <div style={styles.topBar}>
        <div>
          <h1 style={styles.pageTitle}>Projects</h1>
          <p style={styles.pageSubtitle}>{projects.length} total projects</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} style={styles.addBtn}>
          {showForm ? '✕ Cancel' : '+ New Project'}
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <form onSubmit={handleCreateProject} style={styles.formCard}>
          <div style={styles.formGrid}>
            <div style={styles.field}>
              <label style={styles.label}>Project Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. iPhone 17 Review"
                required
                style={styles.input}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Type *</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                style={styles.select}
              >
                {PROJECT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Channel</label>
              <input
                value={form.channel}
                onChange={(e) => setForm({ ...form, channel: e.target.value })}
                placeholder="e.g. Main YouTube, TikTok"
                style={styles.input}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                style={styles.select}
              >
                {STATUSES.map(s => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Start Date *</label>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                required
                style={styles.input}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Deadline *</label>
              <input
                type="date"
                value={form.deadline}
                onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                required
                style={styles.input}
              />
            </div>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Brief, script notes, special requirements..."
              rows={3}
              style={{ ...styles.input, resize: 'vertical' }}
            />
          </div>
          <button type="submit" style={styles.submitBtn}>Create Project</button>
        </form>
      )}

      {/* Filters */}
      <div style={styles.filterRow}>
        <div style={styles.statusFilters}>
          <button
            onClick={() => setFilterStatus('all')}
            style={{
              ...styles.filterBtn,
              ...(filterStatus === 'all' ? styles.filterBtnActive : {}),
            }}
          >All</button>
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              style={{
                ...styles.filterBtn,
                ...(filterStatus === s ? {
                  background: `${STATUS_COLORS[s]}20`,
                  color: STATUS_COLORS[s],
                  borderColor: `${STATUS_COLORS[s]}40`,
                } : {}),
              }}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={styles.viewToggle}>
            <button
              onClick={() => setViewMode('list')}
              style={{
                ...styles.viewToggleBtn,
                ...(viewMode === 'list' ? styles.viewToggleBtnActive : {}),
              }}
              title="List view"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="2" width="14" height="2" rx="0.5" />
                <rect x="1" y="7" width="14" height="2" rx="0.5" />
                <rect x="1" y="12" width="14" height="2" rx="0.5" />
              </svg>
            </button>
            <button
              onClick={() => setViewMode('board')}
              style={{
                ...styles.viewToggleBtn,
                ...(viewMode === 'board' ? styles.viewToggleBtnActive : {}),
              }}
              title="Board view"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="1" width="4" height="14" rx="1" />
                <rect x="6" y="1" width="4" height="10" rx="1" />
                <rect x="11" y="1" width="4" height="12" rx="1" />
              </svg>
            </button>
          </div>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search projects..."
            style={styles.searchInput}
          />
        </div>
      </div>

      {/* Project List / Board */}
      {loading ? (
        <p style={styles.emptyText}>Loading projects...</p>
      ) : viewMode === 'list' ? (
        filtered.length === 0 ? (
          <div style={styles.emptyCard}>
            <p style={styles.emptyText}>No projects found.</p>
          </div>
        ) : (
          <div style={styles.projectList}>
            {filtered.map(project => (
              <ProjectRow
                key={project.id}
                project={project}
                teamMembers={teamMembers}
                profile={profile}
                isSelected={selectedProject === project.id}
                onToggle={() => setSelectedProject(selectedProject === project.id ? null : project.id)}
                onStatusChange={handleStatusChange}
                onAssign={handleAssign}
                onRemoveAssignment={handleRemoveAssignment}
                onAddAttachment={handleAddAttachment}
                onRemoveAttachment={handleRemoveAttachment}
                onAddComment={handleAddComment}
                onDeleteComment={handleDeleteComment}
                onDeleteProject={handleDeleteProject}
                onLinkConcept={handleLinkConcept}
                onNavigate={onNavigate}
                concepts={concepts}
                isAdmin={isAdmin}
                onAddChecklistItem={handleAddChecklistItem}
                onToggleChecklistItem={handleToggleChecklistItem}
                onDeleteChecklistItem={handleDeleteChecklistItem}
              />
            ))}
          </div>
        )
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <div style={styles.boardContainer}>
            {STATUSES.map(status => {
              const columnProjects = filtered.filter(p => p.status === status);
              return (
                <Droppable droppableId={status} key={status}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      style={{
                        ...styles.boardColumn,
                        background: snapshot.isDraggingOver ? 'rgba(99,102,241,0.06)' : 'rgba(255,255,255,0.02)',
                      }}
                    >
                      <div style={styles.boardColumnHeader}>
                        <div style={{ ...styles.boardColumnDot, background: STATUS_COLORS[status] }} />
                        <span style={{ ...styles.boardColumnTitle, color: STATUS_COLORS[status] }}>{STATUS_LABELS[status]}</span>
                        <span style={styles.boardColumnCount}>{columnProjects.length}</span>
                      </div>
                      <div style={styles.boardColumnBody}>
                        {columnProjects.map((project, index) => (
                          <Draggable key={project.id} draggableId={project.id} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                style={{
                                  ...styles.kanbanCard,
                                  ...(snapshot.isDragging ? { boxShadow: '0 8px 24px rgba(0,0,0,0.4)', border: '1px solid rgba(99,102,241,0.3)' } : {}),
                                  ...provided.draggableProps.style,
                                }}
                              >
                                <KanbanCard project={project} />
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    </div>
                  )}
                </Droppable>
              );
            })}
          </div>
        </DragDropContext>
      )}
    </div>
  );
}

function ProjectRow({
  project, teamMembers, profile, isSelected, onToggle,
  onStatusChange, onAssign, onRemoveAssignment,
  onAddAttachment, onRemoveAttachment, onAddComment, onDeleteComment,
  onDeleteProject, onLinkConcept, onNavigate, concepts,
  isAdmin,
  onAddChecklistItem, onToggleChecklistItem, onDeleteChecklistItem,
}) {
  const [assignUserId, setAssignUserId] = useState('');
  const [assignRole, setAssignRole] = useState('editor');
  const [attachName, setAttachName] = useState('');
  const [attachUrl, setAttachUrl] = useState('');
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newChecklistContent, setNewChecklistContent] = useState('');
  const [showAllStages, setShowAllStages] = useState(false);

  useEffect(() => {
    if (!isSelected) return;
    fetchComments();
    const channel = supabase
      .channel(`comments-${project.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'project_comments',
        filter: `project_id=eq.${project.id}`,
      }, () => fetchComments())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isSelected, project.id]);

  async function fetchComments() {
    setLoadingComments(true);
    try {
      const { data } = await supabase
        .from('project_comments')
        .select('*, profile:profiles(id, full_name)')
        .eq('project_id', project.id)
        .order('created_at', { ascending: true });
      setComments(data || []);
    } catch (err) {
      console.error('Error fetching comments:', err);
    } finally {
      setLoadingComments(false);
    }
  }

  async function handleSubmitComment(e) {
    e.preventDefault();
    if (!commentText.trim()) return;
    await onAddComment(project.id, commentText);
    setCommentText('');
    fetchComments(); // Manual re-fetch in case realtime isn't enabled
  }

  const daysLeft = Math.ceil(
    (new Date(project.deadline) - new Date()) / (1000 * 60 * 60 * 24)
  );

  return (
    <div style={styles.projectRow}>
      <div style={styles.projectRowMain} onClick={onToggle}>
        <div style={styles.projectRowLeft}>
          <div style={{
            ...styles.statusDot,
            background: STATUS_COLORS[project.status],
          }} />
          <div>
            <div style={styles.projectRowName}>{project.name}</div>
            <div style={styles.projectRowMeta}>
              {project.type.replace('_', ' ')}
              {project.channel && ` · ${project.channel}`}
              {' · '}
              <span style={{ color: daysLeft < 0 ? '#ef4444' : daysLeft <= 3 ? '#f97316' : 'inherit' }}>
                {daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`}
              </span>
            </div>
          </div>
        </div>
        <div style={styles.projectRowRight}>
          <div style={styles.assigneeAvatars}>
            {project.project_assignments?.slice(0, 4).map(a => (
              <div key={a.id} style={styles.miniAvatar} title={`${a.profile?.full_name} (${a.assignment_role})`}>
                {a.profile?.full_name?.charAt(0)}
              </div>
            ))}
            {project.project_assignments?.length > 4 && (
              <div style={styles.miniAvatarMore}>+{project.project_assignments.length - 4}</div>
            )}
          </div>
          {(() => {
            const cl = project.project_checklists || [];
            const stageItems = cl.filter(c => c.stage === project.status);
            const done = stageItems.filter(c => c.is_complete).length;
            const tot = stageItems.length;
            return tot > 0 ? (
              <span style={styles.checklistBadge}>{done}/{tot}</span>
            ) : null;
          })()}
          <span style={{
            ...styles.statusTag,
            background: `${STATUS_COLORS[project.status]}15`,
            color: STATUS_COLORS[project.status],
          }}>
            {STATUS_LABELS[project.status]}
          </span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="rgba(255,255,255,0.3)"
            style={{ transform: isSelected ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>
            <path d="M4 6l4 4 4-4" />
          </svg>
        </div>
      </div>

      {isSelected && (
        <div style={styles.projectDetail}>
          {/* Status Pipeline */}
          <div style={styles.detailSection}>
            <h4 style={styles.detailLabel}>Status Pipeline</h4>
            <div style={styles.pipeline}>
              {STATUSES.map((s, i) => {
                const isActive = s === project.status;
                const isPast = STATUSES.indexOf(project.status) > i;
                return (
                  <button
                    key={s}
                    onClick={() => onStatusChange(project.id, s)}
                    style={{
                      ...styles.pipelineStep,
                      background: isActive
                        ? `${STATUS_COLORS[s]}25`
                        : isPast
                          ? 'rgba(255,255,255,0.04)'
                          : 'transparent',
                      borderColor: isActive ? STATUS_COLORS[s] : 'rgba(255,255,255,0.08)',
                      color: isActive ? STATUS_COLORS[s] : isPast ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.25)',
                    }}
                  >
                    {isPast && '✓ '}{STATUS_LABELS[s]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Checklist */}
          <div style={styles.detailSection}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h4 style={styles.detailLabel}>Checklist — {STATUS_LABELS[project.status]}</h4>
              {(project.project_checklists || []).some(c => c.stage !== project.status) && (
                <button
                  onClick={() => setShowAllStages(!showAllStages)}
                  style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  {showAllStages ? 'Show current only' : 'Show all stages'}
                </button>
              )}
            </div>
            {(() => {
              const checklists = project.project_checklists || [];
              const stagesToShow = showAllStages ? STATUSES : [project.status];
              return stagesToShow.map(stage => {
                const items = checklists.filter(c => c.stage === stage);
                const completedCount = items.filter(c => c.is_complete).length;
                if (!showAllStages && items.length === 0 && stage === project.status) {
                  return (
                    <div key={stage}>
                      <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.25)', margin: '4px 0 8px' }}>No checklist items yet.</p>
                      <div style={styles.assignForm}>
                        <input
                          value={newChecklistContent}
                          onChange={(e) => setNewChecklistContent(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newChecklistContent.trim()) {
                              onAddChecklistItem(project.id, stage, newChecklistContent);
                              setNewChecklistContent('');
                            }
                          }}
                          placeholder="Add checklist item..."
                          style={styles.smallInput}
                        />
                        <button
                          onClick={() => {
                            if (newChecklistContent.trim()) {
                              onAddChecklistItem(project.id, stage, newChecklistContent);
                              setNewChecklistContent('');
                            }
                          }}
                          style={styles.smallBtn}
                          disabled={!newChecklistContent.trim()}
                        >Add</button>
                      </div>
                    </div>
                  );
                }
                if (showAllStages && items.length === 0) return null;
                return (
                  <div key={stage} style={{ marginBottom: showAllStages ? '12px' : '0' }}>
                    {showAllStages && (
                      <div style={{ fontSize: '11px', fontWeight: 600, color: STATUS_COLORS[stage], marginBottom: '6px', textTransform: 'uppercase' }}>
                        {STATUS_LABELS[stage]} ({completedCount}/{items.length})
                      </div>
                    )}
                    {items.length > 0 && (
                      <div style={{ marginBottom: '6px', background: 'rgba(255,255,255,0.04)', borderRadius: '6px', height: '4px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${items.length > 0 ? (completedCount / items.length) * 100 : 0}%`, background: STATUS_COLORS[stage], borderRadius: '6px', transition: 'width 0.2s' }} />
                      </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      {items.map(item => (
                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', borderRadius: '6px', background: 'rgba(255,255,255,0.02)' }}>
                          <input
                            type="checkbox"
                            checked={item.is_complete}
                            onChange={() => onToggleChecklistItem(item.id, item.is_complete)}
                            style={{ width: '16px', height: '16px', accentColor: '#6366f1', cursor: 'pointer', flexShrink: 0 }}
                          />
                          <span style={{ flex: 1, fontSize: '13px', color: item.is_complete ? 'rgba(255,255,255,0.3)' : '#e2e8f0', textDecoration: item.is_complete ? 'line-through' : 'none' }}>
                            {item.content}
                          </span>
                          <button
                            onClick={() => onDeleteChecklistItem(item.id)}
                            style={styles.removeBtn}
                          >✕</button>
                        </div>
                      ))}
                    </div>
                    {stage === project.status && (
                      <div style={{ ...styles.assignForm, marginTop: '6px' }}>
                        <input
                          value={newChecklistContent}
                          onChange={(e) => setNewChecklistContent(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newChecklistContent.trim()) {
                              onAddChecklistItem(project.id, stage, newChecklistContent);
                              setNewChecklistContent('');
                            }
                          }}
                          placeholder="Add checklist item..."
                          style={styles.smallInput}
                        />
                        <button
                          onClick={() => {
                            if (newChecklistContent.trim()) {
                              onAddChecklistItem(project.id, stage, newChecklistContent);
                              setNewChecklistContent('');
                            }
                          }}
                          style={styles.smallBtn}
                          disabled={!newChecklistContent.trim()}
                        >Add</button>
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>

          {/* Notes */}
          {project.notes && (
            <div style={styles.detailSection}>
              <h4 style={styles.detailLabel}>Notes</h4>
              <p style={styles.notesText}>{project.notes}</p>
            </div>
          )}

          {/* Dates */}
          <div style={styles.detailSection}>
            <h4 style={styles.detailLabel}>Timeline</h4>
            <p style={styles.datesText}>
              {new Date(project.start_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              {' → '}
              {new Date(project.deadline).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>

          {/* Team Assignments */}
          <div style={styles.detailSection}>
            <h4 style={styles.detailLabel}>Team</h4>
            <div style={styles.assignmentList}>
              {project.project_assignments?.map(a => (
                <div key={a.id} style={styles.assignmentItem}>
                  <div style={styles.assignmentAvatar}>
                    {a.profile?.full_name?.charAt(0)}
                  </div>
                  <span style={styles.assignmentName}>{a.profile?.full_name}</span>
                  <span style={styles.assignmentRole}>{a.assignment_role}</span>
                  <button
                    onClick={() => onRemoveAssignment(a.id)}
                    style={styles.removeBtn}
                  >✕</button>
                </div>
              ))}
            </div>
            <div style={styles.assignForm}>
              <select
                value={assignUserId}
                onChange={(e) => setAssignUserId(e.target.value)}
                style={styles.smallSelect}
              >
                <option value="">Select person...</option>
                {teamMembers.map(m => (
                  <option key={m.id} value={m.id}>{m.full_name}</option>
                ))}
              </select>
              <select
                value={assignRole}
                onChange={(e) => setAssignRole(e.target.value)}
                style={styles.smallSelect}
              >
                {ASSIGNMENT_ROLES.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <button
                onClick={() => {
                  if (assignUserId) {
                    onAssign(project.id, assignUserId, assignRole);
                    setAssignUserId('');
                  }
                }}
                style={styles.smallBtn}
                disabled={!assignUserId}
              >
                Assign
              </button>
            </div>
          </div>

          {/* Attachments */}
          <div style={styles.detailSection}>
            <h4 style={styles.detailLabel}>Attachments & Links</h4>
            <div style={styles.attachmentList}>
              {project.project_attachments?.map(a => (
                <div key={a.id} style={styles.attachmentItem}>
                  <a href={a.url} target="_blank" rel="noopener noreferrer" style={styles.attachmentLink}>
                    📎 {a.name}
                  </a>
                  <button onClick={() => onRemoveAttachment(a.id)} style={styles.removeBtn}>✕</button>
                </div>
              ))}
            </div>
            <div style={styles.assignForm}>
              <input
                value={attachName}
                onChange={(e) => setAttachName(e.target.value)}
                placeholder="Link name"
                style={styles.smallInput}
              />
              <input
                value={attachUrl}
                onChange={(e) => setAttachUrl(e.target.value)}
                placeholder="https://..."
                style={{ ...styles.smallInput, flex: 2 }}
              />
              <button
                onClick={() => {
                  if (attachName && attachUrl) {
                    onAddAttachment(project.id, attachName, attachUrl, 'link');
                    setAttachName('');
                    setAttachUrl('');
                  }
                }}
                style={styles.smallBtn}
                disabled={!attachName || !attachUrl}
              >Add</button>
            </div>
          </div>

          {/* Comments */}
          <div style={styles.detailSection}>
            <h4 style={styles.detailLabel}>Comments ({comments.length})</h4>
            {loadingComments ? (
              <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)' }}>Loading...</p>
            ) : (
              <div style={styles.commentsList}>
                {comments.map(c => (
                  <div key={c.id} style={styles.commentItem}>
                    <div style={styles.commentHeader}>
                      <div style={styles.commentAvatar}>{c.profile?.full_name?.charAt(0)}</div>
                      <span style={styles.commentAuthor}>{c.profile?.full_name}</span>
                      <span style={styles.commentTime}>
                        {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {' '}
                        {new Date(c.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </span>
                      {(c.user_id === profile?.id || isAdmin) && (
                        <button onClick={async () => { await onDeleteComment(c.id); fetchComments(); }} style={styles.commentDeleteBtn}>✕</button>
                      )}
                    </div>
                    <p style={styles.commentContent}>{c.content}</p>
                  </div>
                ))}
                {comments.length === 0 && (
                  <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.25)', margin: '4px 0' }}>No comments yet.</p>
                )}
              </div>
            )}
            <form onSubmit={handleSubmitComment} style={styles.commentForm}>
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Add a comment..."
                style={{ ...styles.smallInput, flex: 1 }}
              />
              <button type="submit" style={styles.smallBtn} disabled={!commentText.trim()}>Post</button>
            </form>
          </div>

          {/* Linked Concept */}
          <div style={styles.detailSection}>
            <h4 style={styles.detailLabel}>Linked Concept</h4>
            {project.concept ? (
              <div style={styles.conceptLinkRow}>
                <button
                  onClick={() => onNavigate && onNavigate('ideation', project.concept.id)}
                  style={styles.conceptLinkBtn}
                >
                  <span style={{ ...styles.conceptLinkDot, background: project.concept.color }} />
                  {project.concept.name} →
                </button>
                <button onClick={() => onLinkConcept(project.id, null)} style={styles.removeBtn}>✕</button>
              </div>
            ) : (
              <div style={styles.assignForm}>
                <select
                  onChange={(e) => { if (e.target.value) onLinkConcept(project.id, e.target.value); }}
                  defaultValue=""
                  style={styles.smallSelect}
                >
                  <option value="" disabled>Select a concept...</option>
                  {concepts.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Delete Project */}
          {(project.created_by === profile?.id || isAdmin) && (
            <div style={styles.detailSection}>
              <button
                onClick={() => onDeleteProject(project.id)}
                style={styles.deleteProjectBtn}
              >🗑 Delete Project</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KanbanCard({ project }) {
  const daysLeft = Math.ceil(
    (new Date(project.deadline) - new Date()) / (1000 * 60 * 60 * 24)
  );
  const checklists = project.project_checklists || [];
  const stageItems = checklists.filter(c => c.stage === project.status);
  const completed = stageItems.filter(c => c.is_complete).length;
  const total = stageItems.length;

  return (
    <>
      <div style={styles.kanbanCardName}>{project.name}</div>
      <div style={styles.kanbanCardMeta}>
        <span style={{
          ...styles.kanbanTypeBadge,
          background: `${STATUS_COLORS[project.status]}15`,
          color: STATUS_COLORS[project.status],
        }}>
          {project.type.replace('_', ' ')}
        </span>
        {project.channel && <span style={styles.kanbanChannel}>{project.channel}</span>}
      </div>
      <div style={styles.kanbanCardFooter}>
        <div style={styles.kanbanAvatars}>
          {project.project_assignments?.slice(0, 3).map(a => (
            <div key={a.id} style={styles.kanbanAvatar} title={a.profile?.full_name}>
              {a.profile?.full_name?.charAt(0)}
            </div>
          ))}
          {project.project_assignments?.length > 3 && (
            <div style={styles.kanbanAvatarMore}>+{project.project_assignments.length - 3}</div>
          )}
        </div>
        <span style={{
          fontSize: '11px', fontWeight: 600,
          color: daysLeft < 0 ? '#ef4444' : daysLeft <= 3 ? '#f97316' : 'rgba(255,255,255,0.4)',
        }}>
          {daysLeft < 0 ? `${Math.abs(daysLeft)}d over` : `${daysLeft}d`}
        </span>
      </div>
      {total > 0 && (
        <div style={styles.kanbanProgress}>
          <div style={styles.kanbanProgressBar}>
            <div style={{ ...styles.kanbanProgressFill, width: `${(completed / total) * 100}%` }} />
          </div>
          <span style={styles.kanbanProgressText}>{completed}/{total}</span>
        </div>
      )}
    </>
  );
}

const styles = {
  page: { padding: '32px 40px' },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '24px',
  },
  pageTitle: {
    fontSize: '28px', fontWeight: 700, color: '#ffffff',
    margin: '0 0 4px 0', letterSpacing: '-0.5px',
  },
  pageSubtitle: {
    fontSize: '14px', color: 'rgba(255,255,255,0.4)', margin: 0,
  },
  addBtn: {
    padding: '10px 20px',
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    border: 'none', borderRadius: '10px',
    color: '#fff', fontSize: '14px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  formCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '14px', padding: '24px',
    marginBottom: '24px',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '16px', marginBottom: '16px',
  },
  field: { display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' },
  label: {
    fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase', letterSpacing: '0.5px',
  },
  input: {
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px', color: '#fff', fontSize: '14px',
    fontFamily: 'inherit', outline: 'none',
  },
  select: {
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px', color: '#fff', fontSize: '14px',
    fontFamily: 'inherit', outline: 'none',
  },
  submitBtn: {
    padding: '10px 24px',
    background: '#6366f1', border: 'none', borderRadius: '8px',
    color: '#fff', fontSize: '14px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  filterRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: '20px', flexWrap: 'wrap', gap: '12px',
  },
  statusFilters: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  filterBtn: {
    padding: '6px 14px', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px', background: 'transparent',
    color: 'rgba(255,255,255,0.45)', fontSize: '12px', fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
  },
  filterBtnActive: {
    background: 'rgba(99,102,241,0.15)', color: '#a5b4fc',
    borderColor: 'rgba(99,102,241,0.3)',
  },
  searchInput: {
    padding: '8px 14px', background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px',
    color: '#fff', fontSize: '13px', fontFamily: 'inherit',
    outline: 'none', width: '220px',
  },
  projectList: { display: 'flex', flexDirection: 'column', gap: '4px' },
  projectRow: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '12px', overflow: 'hidden',
  },
  projectRowMain: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 20px', cursor: 'pointer', transition: 'background 0.1s',
  },
  projectRowLeft: { display: 'flex', alignItems: 'center', gap: '14px' },
  statusDot: { width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0 },
  projectRowName: { fontSize: '15px', fontWeight: 600, color: '#e2e8f0' },
  projectRowMeta: {
    fontSize: '12px', color: 'rgba(255,255,255,0.35)', marginTop: '2px',
    textTransform: 'capitalize',
  },
  projectRowRight: { display: 'flex', alignItems: 'center', gap: '12px' },
  assigneeAvatars: { display: 'flex', marginRight: '4px' },
  miniAvatar: {
    width: '26px', height: '26px', borderRadius: '8px',
    background: 'rgba(99,102,241,0.25)', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    fontSize: '11px', fontWeight: 600, color: '#a5b4fc',
    marginLeft: '-6px', border: '2px solid #12121f',
  },
  miniAvatarMore: {
    width: '26px', height: '26px', borderRadius: '8px',
    background: 'rgba(255,255,255,0.08)', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    fontSize: '10px', color: 'rgba(255,255,255,0.4)',
    marginLeft: '-6px', border: '2px solid #12121f',
  },
  statusTag: {
    padding: '4px 10px', borderRadius: '6px',
    fontSize: '11px', fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: '0.3px',
  },
  projectDetail: {
    padding: '0 20px 20px',
    borderTop: '1px solid rgba(255,255,255,0.05)',
  },
  detailSection: { marginTop: '18px' },
  detailLabel: {
    fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase', letterSpacing: '0.5px',
    margin: '0 0 10px 0',
  },
  pipeline: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  pipelineStep: {
    padding: '8px 14px', borderRadius: '8px',
    border: '1px solid', fontSize: '12px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
    background: 'transparent', transition: 'all 0.15s',
  },
  notesText: {
    fontSize: '14px', color: 'rgba(255,255,255,0.6)',
    margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap',
  },
  datesText: {
    fontSize: '14px', color: 'rgba(255,255,255,0.5)', margin: 0,
  },
  assignmentList: { display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' },
  assignmentItem: {
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '6px 10px', background: 'rgba(255,255,255,0.03)',
    borderRadius: '8px',
  },
  assignmentAvatar: {
    width: '28px', height: '28px', borderRadius: '8px',
    background: 'rgba(99,102,241,0.2)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '12px', fontWeight: 600, color: '#a5b4fc',
  },
  assignmentName: { flex: 1, fontSize: '13px', color: '#e2e8f0' },
  assignmentRole: {
    fontSize: '11px', color: 'rgba(255,255,255,0.4)',
    textTransform: 'capitalize',
  },
  removeBtn: {
    background: 'none', border: 'none',
    color: 'rgba(255,255,255,0.25)', cursor: 'pointer',
    fontSize: '12px', padding: '4px',
  },
  assignForm: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  smallSelect: {
    padding: '7px 10px', background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px',
    color: '#fff', fontSize: '12px', fontFamily: 'inherit', outline: 'none',
  },
  smallInput: {
    padding: '7px 10px', background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px',
    color: '#fff', fontSize: '12px', fontFamily: 'inherit',
    outline: 'none', flex: 1, minWidth: '100px',
  },
  smallBtn: {
    padding: '7px 14px', background: '#6366f1',
    border: 'none', borderRadius: '6px',
    color: '#fff', fontSize: '12px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  attachmentList: { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '10px' },
  attachmentItem: {
    display: 'flex', alignItems: 'center', gap: '8px',
    padding: '6px 10px', background: 'rgba(255,255,255,0.03)',
    borderRadius: '8px',
  },
  attachmentLink: {
    flex: 1, color: '#a5b4fc', fontSize: '13px',
    textDecoration: 'none',
  },
  emptyCard: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px dashed rgba(255,255,255,0.08)',
    borderRadius: '14px', padding: '40px', textAlign: 'center',
  },
  emptyText: { color: 'rgba(255,255,255,0.35)', fontSize: '14px', margin: 0 },
  commentsList: { display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px', maxHeight: '300px', overflow: 'auto' },
  commentItem: { padding: '8px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)' },
  commentHeader: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' },
  commentAvatar: { width: '22px', height: '22px', borderRadius: '6px', background: 'rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 600, color: '#a5b4fc', flexShrink: 0 },
  commentAuthor: { fontSize: '12px', fontWeight: 600, color: '#e2e8f0' },
  commentTime: { fontSize: '10px', color: 'rgba(255,255,255,0.25)', marginLeft: 'auto' },
  commentDeleteBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: '11px', padding: '2px 4px' },
  commentContent: { fontSize: '13px', color: 'rgba(255,255,255,0.65)', margin: 0, lineHeight: 1.4 },
  commentForm: { display: 'flex', gap: '8px' },
  conceptLinkRow: { display: 'flex', alignItems: 'center', gap: '8px' },
  conceptLinkBtn: { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '8px', color: '#a5b4fc', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  conceptLinkDot: { width: '8px', height: '8px', borderRadius: '3px', flexShrink: 0 },
  deleteProjectBtn: { padding: '8px 16px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', color: '#fca5a5', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', width: '100%' },
  viewToggle: {
    display: 'flex',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: '8px',
    padding: '2px',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  viewToggleBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '28px',
    border: 'none',
    borderRadius: '6px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.35)',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  viewToggleBtnActive: {
    background: 'rgba(99,102,241,0.2)',
    color: '#a5b4fc',
  },
  boardContainer: {
    display: 'flex',
    gap: '12px',
    overflowX: 'auto',
    paddingBottom: '16px',
  },
  boardColumn: {
    flex: '1 0 200px',
    minWidth: '200px',
    maxWidth: '280px',
    borderRadius: '12px',
    border: '1px solid rgba(255,255,255,0.06)',
    display: 'flex',
    flexDirection: 'column',
    transition: 'background 0.15s',
  },
  boardColumnHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 14px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  boardColumnDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  boardColumnTitle: {
    fontSize: '12px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
  },
  boardColumnCount: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.3)',
    marginLeft: 'auto',
    background: 'rgba(255,255,255,0.06)',
    padding: '1px 7px',
    borderRadius: '10px',
    fontWeight: 600,
  },
  boardColumnBody: {
    padding: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    flex: 1,
    minHeight: '60px',
  },
  kanbanCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '10px',
    padding: '12px',
    cursor: 'grab',
    transition: 'border-color 0.15s',
  },
  kanbanCardName: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#e2e8f0',
    marginBottom: '6px',
    lineHeight: 1.3,
  },
  kanbanCardMeta: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    marginBottom: '8px',
    flexWrap: 'wrap',
  },
  kanbanTypeBadge: {
    fontSize: '10px',
    fontWeight: 600,
    padding: '2px 6px',
    borderRadius: '4px',
    textTransform: 'capitalize',
  },
  kanbanChannel: {
    fontSize: '10px',
    color: 'rgba(255,255,255,0.35)',
  },
  kanbanCardFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  kanbanAvatars: {
    display: 'flex',
  },
  kanbanAvatar: {
    width: '22px',
    height: '22px',
    borderRadius: '6px',
    background: 'rgba(99,102,241,0.25)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    fontWeight: 600,
    color: '#a5b4fc',
    marginLeft: '-4px',
    border: '2px solid #12121f',
  },
  kanbanAvatarMore: {
    width: '22px',
    height: '22px',
    borderRadius: '6px',
    background: 'rgba(255,255,255,0.08)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '9px',
    color: 'rgba(255,255,255,0.4)',
    marginLeft: '-4px',
    border: '2px solid #12121f',
  },
  kanbanProgress: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: '8px',
  },
  kanbanProgressBar: {
    flex: 1,
    height: '3px',
    background: 'rgba(255,255,255,0.06)',
    borderRadius: '2px',
    overflow: 'hidden',
  },
  kanbanProgressFill: {
    height: '100%',
    background: '#6366f1',
    borderRadius: '2px',
    transition: 'width 0.2s',
  },
  kanbanProgressText: {
    fontSize: '10px',
    color: 'rgba(255,255,255,0.35)',
    fontWeight: 600,
  },
  checklistBadge: {
    fontSize: '11px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.4)',
    background: 'rgba(255,255,255,0.06)',
    padding: '2px 7px',
    borderRadius: '6px',
  },
};
