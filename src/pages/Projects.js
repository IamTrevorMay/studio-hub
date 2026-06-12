import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useSupabaseQuery } from '../hooks/useSupabaseQuery';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import UnifiedBoard from './projects/UnifiedBoard';
import { labelFor as stageTaskLabel, defaultStageConfigForType } from '../lib/kanbanStages';


const STATUSES = ['queue', 'write', 'pre_production', 'film', 'review', 'edit', 'post_production', 'publish'];
const STATUS_LABELS = {
  queue: 'Queue', write: 'Write', pre_production: 'Pre-Production', film: 'Film',
  review: 'Review', edit: 'Edit', post_production: 'Post-Production', publish: 'Published',
};
const STATUS_COLORS = {
  queue: '#8b5cf6', write: '#3b82f6', pre_production: '#0ea5e9', film: '#f59e0b',
  review: '#ec4899', edit: '#f97316', post_production: '#a855f7', publish: '#22c55e',
};
const PROJECT_TYPES = [
  { value: 'mayday_video', label: 'Mayday Video' },
  { value: 'tm_baseball_video', label: 'TM Baseball Video' },
  { value: 'podcast', label: 'Podcast' },
  { value: 'short_form', label: 'Short Form' },
];
const CHANNELS = ['Trevor May Baseball', 'More Mayday', 'AWA Wiffle'];
const ASSIGNMENT_ROLES = ['producer', 'writer', 'editor', 'designer', 'reviewer', 'other'];

const SHORTS_STAGES = ['editing', 'ready_to_post', 'posted'];
const SHORTS_STAGE_LABELS = {
  editing: 'Editing', ready_to_post: 'Ready to Post', posted: 'Posted',
};
const SHORTS_STAGE_COLORS = {
  editing: '#f59e0b', ready_to_post: '#3b82f6', posted: '#22c55e',
};
const POSTING_PLATFORMS = ['YouTube Shorts', 'TikTok', 'Instagram Reels', 'X/Twitter', 'Facebook'];



export default function Projects({ onNavigate }) {
  const { profile, isAdmin, refreshKey } = useAuth();
  const confirm = useConfirm();
  const { safeQuery } = useSupabaseQuery();
  const [projects, setProjects] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('projects_view') || 'board');
  const [showArchived, setShowArchived] = useState(false);
  const [rowCtxMenu, setRowCtxMenu] = useState(null); // { x, y, project }
  const [activeSection, setActiveSection] = useState('projects');

  // Shorts Queue state
  const [shorts, setShorts] = useState([]);
  const [shortsLoading, setShortsLoading] = useState(false);
  const [showShortForm, setShowShortForm] = useState(false);
  const [shortForm, setShortForm] = useState({
    title: '', source_show: '', urgency: 'evergreen', post_by: '', notes: '', assigned_to: '',
  });
  const [editingShort, setEditingShort] = useState(null);
  const [stagePrompt, setStagePrompt] = useState(null);

  const [showArchivedSection, setShowArchivedSection] = useState(false);


  const formRef = useRef(null);

  // Form dropdown data
  const [writeDocs, setWriteDocs] = useState([]);
  const [beatSheets, setBeatSheets] = useState([]);
  const [adReadDeliverables, setAdReadDeliverables] = useState([]);

  // Form state
  const [form, setForm] = useState({
    name: '', type: 'mayday_video', channel: '',
    start_date: '', deadline: '', status: 'queue',
    write_doc_id: '', write_doc_name: '', beat_sheet_id: '', ad_read_id: '',
  });

  useEffect(() => {
    localStorage.setItem('projects_view', viewMode);
  }, [viewMode]);


  const fetchProjects = useCallback(async () => {
    console.log('[Projects] fetchProjects called at', new Date().toISOString());
    try {
      const { data, error } = await supabase
        .from('projects')
        .select(`
          *,
          creator:profiles!created_by(id, full_name),
          project_assignments(*, profile:profiles(id, full_name, title)),
          project_attachments(*),
          project_checklists(*),
          project_stage_assignments(*, profile:profiles(id, full_name, title, role))
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

  const fetchTeamMembers = useCallback(async () => {
    try {
      const { data } = await supabase.from('profiles').select('id, full_name, title');
      setTeamMembers(data || []);
    } catch (err) {
      console.error('Error fetching team:', err);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
    fetchTeamMembers();
  }, [fetchProjects, fetchTeamMembers]);

  // Load dropdown data for project form and edit view
  useEffect(() => {
    fetchWriteDocs();
    fetchBeatSheets();
    fetchAdReadDeliverables();
  }, []); // eslint-disable-line

  useEffect(() => {
    const channel = supabase
      .channel('projects-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => {
        fetchProjects();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_checklists' }, () => {
        fetchProjects();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_stage_assignments' }, () => {
        fetchProjects();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchProjects, refreshKey]);

  useVisibilityRefresh(fetchProjects);

  const DRIVE_FN_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-drive-write`;

  async function fetchWriteDocs() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      const rootRes = await fetch(DRIVE_FN_URL, { headers: { Authorization: `Bearer ${token}` } });
      const rootData = await rootRes.json();
      const rootItems = rootData.items || [];
      const docs = rootItems.filter(i => i.type === 'doc');
      const folders = rootItems.filter(i => i.type === 'folder');
      for (const folder of folders) {
        const folderRes = await fetch(`${DRIVE_FN_URL}?folderId=${encodeURIComponent(folder.id)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const folderData = await folderRes.json();
        (folderData.items || []).filter(i => i.type === 'doc').forEach(doc => {
          docs.push({ ...doc, folderName: folder.name });
        });
      }
      setWriteDocs(docs);
    } catch (err) {
      console.error('Error fetching write docs:', err);
    }
  }

  async function fetchBeatSheets() {
    try {
      const { data, error } = await supabase
        .from('beat_sheets')
        .select('id, title, folder')
        .order('created_at', { ascending: false });
      if (!error) setBeatSheets(data || []);
    } catch (err) {
      console.error('Error fetching beat sheets:', err);
    }
  }

  async function fetchAdReadDeliverables() {
    try {
      const { data, error } = await supabase
        .from('sponsor_deliverables')
        .select('id, title, status, sponsor_id, campaign_id, sponsors(name), sponsor_campaigns(name)')
        .neq('status', 'posted')
        .order('created_at', { ascending: false });
      if (!error) {
        setAdReadDeliverables((data || []).map(d => ({
          ...d,
          sponsor_name: d.sponsors?.name || 'Unknown Sponsor',
          campaign_name: d.sponsor_campaigns?.name || null,
        })));
      }
    } catch (err) {
      console.error('Error fetching ad read deliverables:', err);
    }
  }

  async function handleCreateProject(e, seriesId) {
    e.preventDefault();
    const insert = {
      name: form.name,
      type: form.type,
      channel: form.channel || null,
      status: form.status,
      start_date: form.start_date || null,
      deadline: form.deadline || null,
      series_id: seriesId || null,
      created_by: profile.id,
      write_doc_id: form.write_doc_id || null,
      write_doc_name: form.write_doc_name || null,
      beat_sheet_id: form.beat_sheet_id || null,
      ad_read_id: form.ad_read_id || null,
      stage_config: defaultStageConfigForType(form.type),
    };
    const { data: created, error } = await supabase.from('projects').insert(insert).select('id').single();
    if (error) {
      alert('Error creating project: ' + error.message);
      return;
    }
    setForm({ name: '', type: 'mayday_video', channel: '', start_date: '', deadline: '', status: 'queue', write_doc_id: '', write_doc_name: '', beat_sheet_id: '', ad_read_id: '' });
    setShowForm(false);
    fetchProjects();
  }

  async function handleUpdateProject(projectId, updates) {
    const { error } = await supabase.from('projects').update(updates).eq('id', projectId);
    if (error) {
      console.error('Error updating project:', error);
      return;
    }
    fetchProjects();
  }

  async function handleStatusChange(projectId, newStatus) {
    const project = projects.find(p => p.id === projectId);
    const { error } = await supabase.from('projects').update({ status: newStatus }).eq('id', projectId);
    if (error) { console.error('Status change failed:', error); return; }
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

  // --- Shorts Queue ---
  const fetchShorts = useCallback(async () => {
    setShortsLoading(true);
    try {
      const { data, error } = await supabase
        .from('shorts_queue')
        .select('*, creator:profiles!created_by(id, full_name), assignee:profiles!assigned_to(id, full_name)')
        .order('created_at', { ascending: true });
      if (error) throw error;
      setShorts(data || []);
    } catch (err) {
      console.error('Error fetching shorts:', err);
      setShorts([]);
    } finally {
      setShortsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSection !== 'shorts') return;
    fetchShorts();
  }, [activeSection, fetchShorts]);

  useEffect(() => {
    if (activeSection !== 'shorts') return;
    const channel = supabase
      .channel('shorts-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shorts_queue' }, () => {
        fetchShorts();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeSection, fetchShorts, refreshKey]);

  function sortShorts(items) {
    return [...items].sort((a, b) => {
      // Time-sensitive first
      if (a.urgency !== b.urgency) {
        return a.urgency === 'time_sensitive' ? -1 : 1;
      }
      // Within time-sensitive: sort by post_by ascending (most urgent first)
      if (a.urgency === 'time_sensitive' && a.post_by && b.post_by) {
        return new Date(a.post_by) - new Date(b.post_by);
      }
      // Manual sort_order, then created_at
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return new Date(a.created_at) - new Date(b.created_at);
    });
  }

  async function handleCreateShort(e) {
    e.preventDefault();
    const insertData = {
      title: shortForm.title,
      source_show: shortForm.source_show || null,
      urgency: shortForm.urgency,
      post_by: shortForm.urgency === 'time_sensitive' && shortForm.post_by ? shortForm.post_by : null,
      notes: shortForm.notes || null,
      assigned_to: shortForm.assigned_to || null,
      created_by: profile.id,
    };
    const { error } = await supabase.from('shorts_queue').insert(insertData);
    if (error) { alert('Error creating clip: ' + error.message); return; }
    // Notify assigned user
    if (shortForm.assigned_to && shortForm.assigned_to !== profile.id) {
      await supabase.from('notifications').insert({
        user_id: shortForm.assigned_to,
        type: 'assignment',
        title: `New clip assigned: ${shortForm.title}`,
        body: `${profile.full_name} added a new clip to the Shorts Queue`,
        link_tab: 'projects',
      });
    }
    setShortForm({ title: '', source_show: '', urgency: 'evergreen', post_by: '', notes: '', assigned_to: '' });
    setShowShortForm(false);
    fetchShorts();
  }

  async function handleUpdateShortStage(shortId, newStage, extras = {}) {
    const clip = shorts.find(s => s.id === shortId);
    const { error } = await supabase.from('shorts_queue').update({
      stage: newStage, ...extras, updated_at: new Date().toISOString(),
    }).eq('id', shortId);
    if (error) { console.error('Error updating short stage:', error); return; }
    // Notify assigned user on stage change
    if (clip?.assigned_to && clip.assigned_to !== profile.id) {
      await supabase.from('notifications').insert({
        user_id: clip.assigned_to,
        type: 'status_change',
        title: `Clip "${clip.title}" moved to ${SHORTS_STAGE_LABELS[newStage]}`,
        body: `${profile.full_name} updated the clip stage`,
        link_tab: 'projects',
      });
    }
    fetchShorts();
  }

  async function handleUpdateShort(shortId, updates) {
    const { error } = await supabase.from('shorts_queue').update({
      ...updates, updated_at: new Date().toISOString(),
    }).eq('id', shortId);
    if (error) console.error('Error updating short:', error);
    fetchShorts();
  }

  async function handleDeleteShort(shortId) {
    if (!(await confirm('Delete this clip from the queue?'))) return;
    await supabase.from('shorts_queue').delete().eq('id', shortId);
    fetchShorts();
  }

  async function onShortsDragEnd(result) {
    if (!result.destination) return;
    const { draggableId, source, destination } = result;
    const newStage = destination.droppableId;
    const clip = shorts.find(s => s.id === draggableId);
    if (!clip) return;

    if (clip.stage !== newStage) {
      // Stage transition prompts
      if (newStage === 'ready_to_post' && !clip.drive_link) {
        setStagePrompt({ id: draggableId, newStage, type: 'drive_link', title: clip.title });
        return;
      }
      if (newStage === 'posted') {
        setStagePrompt({ id: draggableId, newStage, type: 'posted_info', title: clip.title });
        return;
      }
      handleUpdateShortStage(draggableId, newStage);
    } else {
      // Reorder within column
      const columnItems = sortShorts(shorts.filter(s => s.stage === newStage));
      const oldIndex = columnItems.findIndex(s => s.id === draggableId);
      if (oldIndex === destination.index) return;
      // Calculate new sort_order based on neighbors
      const reordered = [...columnItems];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(destination.index, 0, moved);
      await Promise.all(reordered.map((item, idx) =>
        item.sort_order !== idx
          ? supabase.from('shorts_queue').update({ sort_order: idx }).eq('id', item.id)
          : null
      ).filter(Boolean));
      fetchShorts();
    }
  }

  async function handleArchiveProject(projectId) {
    await supabase.from('projects').update({ is_archived: true }).eq('id', projectId);
    fetchProjects();
  }

  async function handleUnarchiveProject(projectId) {
    await supabase.from('projects').update({ is_archived: false }).eq('id', projectId);
    fetchProjects();
  }

  async function handleDeleteProject(projectId) {
    if (!(await confirm('Delete this project and all its data?'))) return;
    await supabase.from('projects').delete().eq('id', projectId);
    fetchProjects();
  }

  async function handleDuplicateProject(project) {
    const { error } = await supabase.from('projects').insert({
      name: `${project.name} (copy)`,
      type: project.type,
      status: 'queue',
      start_column: 'queue',
      deadline: project.deadline || null,
      stage_config: project.stage_config || {},
      created_by: profile?.id || null,
    });
    if (error) { alert(`Duplicate failed: ${error.message}`); return; }
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

  // Project stage assignments
  async function handleAssignProjectStage(projectId, stage, userId) {
    const { error } = await supabase.from('project_stage_assignments').insert({
      project_id: projectId, stage, user_id: userId,
    });
    if (error && error.code !== '23505') console.error('Error assigning stage:', error);
    // Notify assigned user
    if (userId !== profile.id) {
      const project = projects.find(p => p.id === projectId);
      await supabase.from('notifications').insert({
        user_id: userId,
        type: 'assignment',
        title: `Stage assignment: ${project?.name || 'a project'}`,
        body: `${profile.full_name} assigned you to the "${STATUS_LABELS[stage]}" stage`,
        link_tab: 'projects',
        link_target: projectId,
      });
    }
    fetchProjects();
  }

  async function handleRemoveProjectStageAssignment(id) {
    await supabase.from('project_stage_assignments').delete().eq('id', id);
    fetchProjects();
  }


  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Categorize projects into sections
  const searchFilter = (p) => !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase());
  const statusFilter = (p) => filterStatus === 'all' || p.status === filterStatus;

  // Creative projects only for the list-view sections. A project is "current"
  // as long as it has a deadline (start date is optional).
  const creativeActive = projects.filter(p => !p.is_archived && p.status !== 'publish');
  const currentProjects = creativeActive.filter(p =>
    p.deadline && searchFilter(p) && statusFilter(p)
  );
  const comingUpProjects = creativeActive.filter(p =>
    !p.deadline && searchFilter(p) && statusFilter(p)
  );
  const completedProjects = projects.filter(p => {
    if (p.is_archived || p.status !== 'publish') return false;
    // Published within last 7 days (use updated_at as proxy for when it was published)
    const publishedDate = new Date(p.updated_at);
    return publishedDate >= sevenDaysAgo && searchFilter(p);
  });
  const archivedProjects = projects.filter(p => {
    if (p.is_archived) return true;
    if (p.status !== 'publish') return false;
    const publishedDate = new Date(p.updated_at);
    return publishedDate < sevenDaysAgo;
  }).filter(searchFilter);

  const archivedCount = archivedProjects.length;

  const editingCount = shorts.filter(s => s.stage === 'editing').length;
  const readyCount = shorts.filter(s => s.stage === 'ready_to_post').length;

  return (
    <div style={styles.page}>
      {/* Section Toggle */}
      <div style={styles.sectionTabs}>
        <button
          onClick={() => setActiveSection('projects')}
          style={{
            ...styles.sectionTab,
            ...(activeSection === 'projects' ? styles.sectionTabActive : {}),
          }}
        >Projects</button>
        <button
          onClick={() => setActiveSection('shorts')}
          style={{
            ...styles.sectionTab,
            ...(activeSection === 'shorts' ? styles.sectionTabActive : {}),
          }}
        >
          Shorts Queue
          {(editingCount + readyCount) > 0 && (
            <span style={styles.sectionTabBadge}>{editingCount + readyCount}</span>
          )}
        </button>
      </div>

      {activeSection === 'projects' && (
      <>
      <div style={styles.topBar}>
        <div>
          <h1 style={styles.pageTitle}>Projects</h1>
          <p style={styles.pageSubtitle}>{currentProjects.length + comingUpProjects.length} active{completedProjects.length > 0 ? ` · ${completedProjects.length} completed` : ''}{archivedCount > 0 ? ` · ${archivedCount} archived` : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setShowForm(!showForm)} style={styles.addBtn}>
            {showForm ? '✕ Cancel' : '+ New Project'}
          </button>
        </div>
      </div>

      {/* Create Form */}
      {showForm && (
        <form ref={formRef} onSubmit={handleCreateProject} style={styles.formCard}>
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
              <select
                value={form.channel}
                onChange={(e) => setForm({ ...form, channel: e.target.value })}
                style={styles.input}
              >
                <option value="">Select channel...</option>
                {CHANNELS.map((ch) => <option key={ch} value={ch}>{ch}</option>)}
              </select>
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
              <label style={styles.label}>Start Date</label>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                style={styles.input}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Deadline</label>
              <input
                type="date"
                value={form.deadline}
                onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                style={styles.input}
              />
            </div>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Write Doc</label>
            <select
              value={form.write_doc_id}
              onChange={(e) => {
                const doc = writeDocs.find(d => d.id === e.target.value);
                setForm({ ...form, write_doc_id: e.target.value, write_doc_name: doc?.name || '' });
              }}
              style={styles.select}
            >
              <option value="">Select a doc...</option>
              {writeDocs.map(doc => (
                <option key={doc.id} value={doc.id}>
                  {doc.folderName ? `${doc.folderName} / ${doc.name}` : doc.name}
                </option>
              ))}
            </select>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Script / Beat Sheet</label>
            <select
              value={form.beat_sheet_id}
              onChange={(e) => setForm({ ...form, beat_sheet_id: e.target.value })}
              style={styles.select}
            >
              <option value="">Select a beat sheet...</option>
              {beatSheets.map(bs => (
                <option key={bs.id} value={bs.id}>{bs.title}</option>
              ))}
            </select>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Ad Read</label>
            <select
              value={form.ad_read_id}
              onChange={(e) => setForm({ ...form, ad_read_id: e.target.value })}
              style={styles.select}
            >
              <option value="">Select a deliverable...</option>
              {adReadDeliverables.map(d => (
                <option key={d.id} value={d.id}>
                  {d.sponsor_name}{d.campaign_name ? ` — ${d.campaign_name}` : ''}{d.title ? `: ${d.title}` : ''}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" style={styles.submitBtn}>Create Project</button>
        </form>
      )}

      {/* Filters (list view only — kanban columns are self-filtering) */}
      <div style={styles.filterRow}>
        {viewMode === 'list' ? (
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
        ) : <div />}
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
          {viewMode === 'list' && (
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search projects..."
              style={styles.searchInput}
            />
          )}
        </div>
      </div>

      {/* ─── Sectioned Project Layout ─── */}
      {loading ? (
        <p style={styles.emptyText}>Loading projects...</p>
      ) : viewMode === 'board' ? (
        <UnifiedBoard />
      ) : (
        <>
        {/* ── Current Projects ── */}
        {currentProjects.length > 0 && (
          <div>
            <h2 style={styles.sectionHeading}>Current Projects ({currentProjects.length})</h2>
            <div style={styles.projectList}>
              {currentProjects.map(project => (
                <ProjectRow key={project.id} project={project} teamMembers={teamMembers} profile={profile}
                  isSelected={selectedProject === project.id} onToggle={() => setSelectedProject(selectedProject === project.id ? null : project.id)}
                  onStatusChange={handleStatusChange} onAssign={handleAssign} onRemoveAssignment={handleRemoveAssignment}
                  onAddAttachment={handleAddAttachment} onRemoveAttachment={handleRemoveAttachment} onAddComment={handleAddComment}
                  onDeleteComment={handleDeleteComment} onDeleteProject={handleDeleteProject} onArchiveProject={handleArchiveProject}
                  onUnarchiveProject={handleUnarchiveProject} onNavigate={onNavigate}
                  isAdmin={isAdmin} onAddChecklistItem={handleAddChecklistItem} onToggleChecklistItem={handleToggleChecklistItem}
                  onDeleteChecklistItem={handleDeleteChecklistItem} onAssignProjectStage={handleAssignProjectStage}
                  onRemoveProjectStageAssignment={handleRemoveProjectStageAssignment} onUpdateProject={handleUpdateProject}
                  linkedFieldData={{ writeDocs, beatSheets, adReadDeliverables }}
                  onContextMenu={isAdmin ? (e, p) => { e.preventDefault(); setRowCtxMenu({ x: e.clientX, y: e.clientY, project: p }); } : null}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Coming Up (no dates set) ── */}
        {comingUpProjects.length > 0 && (
          <div style={{ marginTop: '32px' }}>
            <h2 style={styles.sectionHeading}>Coming Up ({comingUpProjects.length})</h2>
            <div style={styles.projectList}>
              {comingUpProjects.map(project => (
                <ProjectRow key={project.id} project={project} teamMembers={teamMembers} profile={profile}
                  isSelected={selectedProject === project.id} onToggle={() => setSelectedProject(selectedProject === project.id ? null : project.id)}
                  onStatusChange={handleStatusChange} onAssign={handleAssign} onRemoveAssignment={handleRemoveAssignment}
                  onAddAttachment={handleAddAttachment} onRemoveAttachment={handleRemoveAttachment} onAddComment={handleAddComment}
                  onDeleteComment={handleDeleteComment} onDeleteProject={handleDeleteProject} onArchiveProject={handleArchiveProject}
                  onUnarchiveProject={handleUnarchiveProject} onNavigate={onNavigate}
                  isAdmin={isAdmin} onAddChecklistItem={handleAddChecklistItem} onToggleChecklistItem={handleToggleChecklistItem}
                  onDeleteChecklistItem={handleDeleteChecklistItem} onAssignProjectStage={handleAssignProjectStage}
                  onRemoveProjectStageAssignment={handleRemoveProjectStageAssignment} onUpdateProject={handleUpdateProject}
                  linkedFieldData={{ writeDocs, beatSheets, adReadDeliverables }}
                  onContextMenu={isAdmin ? (e, p) => { e.preventDefault(); setRowCtxMenu({ x: e.clientX, y: e.clientY, project: p }); } : null}
                />
              ))}
            </div>
          </div>
        )}



        {/* ── Completed (published < 7 days) ── */}
        {completedProjects.length > 0 && (
          <div style={{ marginTop: '32px' }}>
            <h2 style={styles.sectionHeading}>Completed ({completedProjects.length})</h2>
            <div style={styles.projectList}>
              {completedProjects.map(project => (
                <ProjectRow key={project.id} project={project} teamMembers={teamMembers} profile={profile}
                  isSelected={selectedProject === project.id} onToggle={() => setSelectedProject(selectedProject === project.id ? null : project.id)}
                  onStatusChange={handleStatusChange} onAssign={handleAssign} onRemoveAssignment={handleRemoveAssignment}
                  onAddAttachment={handleAddAttachment} onRemoveAttachment={handleRemoveAttachment} onAddComment={handleAddComment}
                  onDeleteComment={handleDeleteComment} onDeleteProject={handleDeleteProject} onArchiveProject={handleArchiveProject}
                  onUnarchiveProject={handleUnarchiveProject} onNavigate={onNavigate}
                  isAdmin={isAdmin} onAddChecklistItem={handleAddChecklistItem} onToggleChecklistItem={handleToggleChecklistItem}
                  onDeleteChecklistItem={handleDeleteChecklistItem} onAssignProjectStage={handleAssignProjectStage}
                  onRemoveProjectStageAssignment={handleRemoveProjectStageAssignment} onUpdateProject={handleUpdateProject}
                  linkedFieldData={{ writeDocs, beatSheets, adReadDeliverables }}
                  onContextMenu={isAdmin ? (e, p) => { e.preventDefault(); setRowCtxMenu({ x: e.clientX, y: e.clientY, project: p }); } : null}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Archived (published 7+ days, collapsed) ── */}
        {archivedProjects.length > 0 && (
          <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ width: showArchivedSection ? '100%' : 'auto' }}>
              <button
                onClick={() => setShowArchivedSection(!showArchivedSection)}
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '10px',
                  padding: '10px 16px',
                  color: 'rgba(255,255,255,0.4)',
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span>{showArchivedSection ? '▾' : '▸'}</span>
                Archived ({archivedProjects.length})
              </button>
              {showArchivedSection && (
                <div style={{ ...styles.projectList, marginTop: '12px', opacity: 0.6 }}>
                  {archivedProjects.map(project => (
                    <ProjectRow key={project.id} project={project} teamMembers={teamMembers} profile={profile}
                      isSelected={selectedProject === project.id} onToggle={() => setSelectedProject(selectedProject === project.id ? null : project.id)}
                      onStatusChange={handleStatusChange} onAssign={handleAssign} onRemoveAssignment={handleRemoveAssignment}
                      onAddAttachment={handleAddAttachment} onRemoveAttachment={handleRemoveAttachment} onAddComment={handleAddComment}
                      onDeleteComment={handleDeleteComment} onDeleteProject={handleDeleteProject} onArchiveProject={handleArchiveProject}
                      onUnarchiveProject={handleUnarchiveProject} onNavigate={onNavigate}
                      isAdmin={isAdmin} onAddChecklistItem={handleAddChecklistItem} onToggleChecklistItem={handleToggleChecklistItem}
                      onDeleteChecklistItem={handleDeleteChecklistItem} onAssignProjectStage={handleAssignProjectStage}
                      onRemoveProjectStageAssignment={handleRemoveProjectStageAssignment} onUpdateProject={handleUpdateProject}
                      onContextMenu={isAdmin ? (e, p) => { e.preventDefault(); setRowCtxMenu({ x: e.clientX, y: e.clientY, project: p }); } : null}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty state */}
        {currentProjects.length === 0 && comingUpProjects.length === 0 && completedProjects.length === 0 && (
          <div style={styles.emptyCard}>
            <p style={styles.emptyText}>No projects found.</p>
          </div>
        )}
        </>
      )}
      </>
      )}

      {activeSection === 'shorts' && (
      /* ====== SHORTS QUEUE SECTION ====== */
      <>
      <div style={styles.topBar}>
        <div>
          <h1 style={styles.pageTitle}>Shorts Queue</h1>
          <p style={styles.pageSubtitle}>
            {editingCount} editing · {readyCount} ready to post
          </p>
        </div>
        <button onClick={() => setShowShortForm(!showShortForm)} style={styles.addBtn}>
          {showShortForm ? '✕ Cancel' : '+ New Clip'}
        </button>
      </div>

      {/* Add Clip Form */}
      {showShortForm && (
        <form onSubmit={handleCreateShort} style={styles.formCard}>
          <div style={styles.formGrid}>
            <div style={styles.field}>
              <label style={styles.label}>Title *</label>
              <input
                value={shortForm.title}
                onChange={(e) => setShortForm({ ...shortForm, title: e.target.value })}
                placeholder="e.g. LeBron dunk reaction"
                required
                style={styles.input}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Source Show</label>
              <input
                value={shortForm.source_show}
                onChange={(e) => setShortForm({ ...shortForm, source_show: e.target.value })}
                placeholder="e.g. Monday Show 3/3"
                style={styles.input}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Urgency</label>
              <div style={styles.urgencyToggle}>
                <button
                  type="button"
                  onClick={() => setShortForm({ ...shortForm, urgency: 'time_sensitive' })}
                  style={{
                    ...styles.urgencyBtn,
                    ...(shortForm.urgency === 'time_sensitive' ? styles.urgencyBtnTimeSensitive : {}),
                  }}
                >Time-Sensitive</button>
                <button
                  type="button"
                  onClick={() => setShortForm({ ...shortForm, urgency: 'evergreen' })}
                  style={{
                    ...styles.urgencyBtn,
                    ...(shortForm.urgency === 'evergreen' ? styles.urgencyBtnEvergreen : {}),
                  }}
                >Evergreen</button>
              </div>
            </div>
            {shortForm.urgency === 'time_sensitive' && (
              <div style={styles.field}>
                <label style={styles.label}>Post By</label>
                <input
                  type="date"
                  value={shortForm.post_by}
                  onChange={(e) => setShortForm({ ...shortForm, post_by: e.target.value })}
                  style={styles.input}
                />
              </div>
            )}
            <div style={styles.field}>
              <label style={styles.label}>Assign To</label>
              <select
                value={shortForm.assigned_to}
                onChange={(e) => setShortForm({ ...shortForm, assigned_to: e.target.value })}
                style={styles.select}
              >
                <option value="">Unassigned</option>
                {teamMembers.map(m => (
                  <option key={m.id} value={m.id}>{m.full_name}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Notes</label>
            <textarea
              value={shortForm.notes}
              onChange={(e) => setShortForm({ ...shortForm, notes: e.target.value })}
              placeholder="Timestamps, context, special instructions..."
              rows={2}
              style={{ ...styles.input, resize: 'vertical' }}
            />
          </div>
          <button type="submit" style={styles.submitBtn}>Add to Queue</button>
        </form>
      )}

      {/* Stage Transition Prompt Modal */}
      {stagePrompt && (
        <StagePromptModal
          prompt={stagePrompt}
          onSubmit={(extras) => {
            handleUpdateShortStage(stagePrompt.id, stagePrompt.newStage, extras);
            setStagePrompt(null);
          }}
          onCancel={() => setStagePrompt(null)}
        />
      )}

      {/* Three-column stage view */}
      {shortsLoading ? (
        <p style={styles.emptyText}>Loading shorts queue...</p>
      ) : (
        <DragDropContext onDragEnd={onShortsDragEnd}>
          <div style={styles.shortsBoardContainer}>
            {SHORTS_STAGES.map(stage => {
              const stageShorts = sortShorts(shorts.filter(s => s.stage === stage));
              return (
                <Droppable droppableId={stage} key={stage}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      style={{
                        ...styles.shortsColumn,
                        background: snapshot.isDraggingOver
                          ? `${SHORTS_STAGE_COLORS[stage]}08`
                          : 'rgba(255,255,255,0.02)',
                      }}
                    >
                      <div style={styles.shortsColumnHeader}>
                        <div style={{ ...styles.boardColumnDot, background: SHORTS_STAGE_COLORS[stage] }} />
                        <span style={{ ...styles.boardColumnTitle, color: SHORTS_STAGE_COLORS[stage] }}>
                          {SHORTS_STAGE_LABELS[stage]}
                        </span>
                        <span style={styles.boardColumnCount}>{stageShorts.length}</span>
                      </div>
                      <div style={styles.boardColumnBody}>
                        {stageShorts.map((clip, index) => (
                          <Draggable key={clip.id} draggableId={clip.id} index={index}>
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
                                <ShortsCard
                                  clip={clip}
                                  teamMembers={teamMembers}
                                  onUpdate={(updates) => handleUpdateShort(clip.id, updates)}
                                  onDelete={() => handleDeleteShort(clip.id)}
                                  isEditing={editingShort === clip.id}
                                  onToggleEdit={() => setEditingShort(editingShort === clip.id ? null : clip.id)}
                                />
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                        {stageShorts.length === 0 && (
                          <div style={styles.shortsEmptyColumn}>
                            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.2)', margin: 0 }}>
                              {stage === 'editing' ? 'No clips to edit' : stage === 'ready_to_post' ? 'No clips ready' : 'No recent posts'}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </Droppable>
              );
            })}
          </div>
        </DragDropContext>
      )}
      </>
      )}

      {/* Deliverables section removed — now lives at /deliverables */}

      {rowCtxMenu && (
        <RowContextMenu
          x={rowCtxMenu.x}
          y={rowCtxMenu.y}
          onClose={() => setRowCtxMenu(null)}
          onDuplicate={async () => { await handleDuplicateProject(rowCtxMenu.project); setRowCtxMenu(null); }}
          onArchive={async () => { await handleArchiveProject(rowCtxMenu.project.id); setRowCtxMenu(null); }}
          onDelete={async () => { await handleDeleteProject(rowCtxMenu.project.id); setRowCtxMenu(null); }}
        />
      )}
    </div>
  );
}

function RowContextMenu({ x, y, onClose, onDuplicate, onArchive, onDelete }) {
  const items = [
    { label: 'Duplicate', onClick: onDuplicate },
    { label: 'Archive', onClick: onArchive },
    { label: 'Delete', onClick: onDelete, danger: true },
  ];
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
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: '8px',
          padding: '4px',
          minWidth: '160px',
          boxShadow: '0 12px 32px rgba(0,0,0,0.7)',
        }}
      >
        {items.map((it) => (
          <button
            key={it.label}
            type="button"
            onClick={it.onClick}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              background: 'transparent',
              border: 'none',
              padding: '8px 12px',
              fontSize: '13px',
              color: it.danger ? '#ef4444' : '#fff',
              cursor: 'pointer',
              borderRadius: '6px',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            {it.label}
          </button>
        ))}
      </div>
    </>
  );
}

function ProjectRow({
  project, teamMembers, profile, isSelected, onToggle,
  onStatusChange, onAssign, onRemoveAssignment,
  onAddAttachment, onRemoveAttachment, onAddComment, onDeleteComment,
  onDeleteProject, onArchiveProject, onUnarchiveProject,
  onNavigate,
  isAdmin,
  onAddChecklistItem, onToggleChecklistItem, onDeleteChecklistItem,
  onAssignProjectStage, onRemoveProjectStageAssignment,
  onUpdateProject,
  linkedFieldData = {},
  onContextMenu,
}) {
  const { writeDocs = [], beatSheets = [], adReadDeliverables = [] } = linkedFieldData;
  const typeList = PROJECT_TYPES;
  const statusList = STATUSES;
  const statusLabels = STATUS_LABELS;
  const statusColors = STATUS_COLORS;

  const [assignUserId, setAssignUserId] = useState('');
  const [assignRole, setAssignRole] = useState('editor');
  const [attachName, setAttachName] = useState('');
  const [attachUrl, setAttachUrl] = useState('');
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newChecklistContent, setNewChecklistContent] = useState('');
  const [showAllStages, setShowAllStages] = useState(false);

  // Inline editing state
  const [editingField, setEditingField] = useState(null);
  const [editName, setEditName] = useState(project.name || '');
  const [editType, setEditType] = useState(project.type || 'youtube_video');
  const [editChannel, setEditChannel] = useState(project.channel || '');
  const [editStartDate, setEditStartDate] = useState(project.start_date || '');
  const [editDeadline, setEditDeadline] = useState(project.deadline || '');
  const [editNotes, setEditNotes] = useState(project.notes || '');
  const [editStageTimelines, setEditStageTimelines] = useState(project.stage_timelines || {});
  const [editStageConfig, setEditStageConfig] = useState(project.stage_config || {});

  useEffect(() => {
    setEditStageTimelines(project.stage_timelines || {});
  }, [project.stage_timelines]);

  useEffect(() => {
    setEditStageConfig(project.stage_config || {});
  }, [project.stage_config]);

  function saveStageDate(stage, field, value) {
    const updated = { ...editStageTimelines, [stage]: { ...(editStageTimelines[stage] || {}), [field]: value } };
    // Remove empty entries
    if (!updated[stage].start && !updated[stage].end) delete updated[stage];
    setEditStageTimelines(updated);
    onUpdateProject(project.id, { stage_timelines: updated });
  }

  function saveStageSkip(stage, skip) {
    const next = { ...editStageConfig };
    const existing = { ...(next[stage] || {}) };
    if (skip) {
      existing.skip = true;
    } else {
      delete existing.skip;
    }
    if (Object.keys(existing).length === 0) {
      delete next[stage];
    } else {
      next[stage] = existing;
    }
    setEditStageConfig(next);
    onUpdateProject(project.id, { stage_config: next });
  }

  function saveField(field, value) {
    onUpdateProject(project.id, { [field]: value });
    setEditingField(null);
  }

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

  const daysLeft = project.deadline ? Math.ceil(
    (new Date(project.deadline) - new Date()) / (1000 * 60 * 60 * 24)
  ) : null;

  return (
    <div
      style={{
        ...styles.projectRow,
        ...(project.is_archived ? { opacity: 0.6 } : {}),
      }}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, project) : undefined}
    >
      <div style={styles.projectRowMain} onClick={onToggle}>
        <div style={styles.projectRowLeft}>
          <div style={{
            ...styles.statusDot,
            background: project.is_archived ? '#6b7280' : statusColors[project.status],
          }} />
          <div>
            <div style={styles.projectRowName}>
              {project.name}
              {project.is_archived && <span style={styles.archivedTag}>Archived</span>}
            </div>
            <div style={styles.projectRowMeta}>
              {typeList.find(t => t.value === project.type)?.label || project.type.replace('_', ' ')}
              {project.channel && ` · ${project.channel}`}
              {project.series && <span style={{ color: 'rgba(255,255,255,0.35)' }}> · {project.series.title}</span>}
              {daysLeft != null && <>
              {' · '}
              <span style={{ color: daysLeft < 0 ? '#ef4444' : daysLeft <= 3 ? '#f97316' : 'inherit' }}>
                {daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`}
              </span>
              </>}
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
            background: `${statusColors[project.status]}15`,
            color: statusColors[project.status],
          }}>
            {statusLabels[project.status]}
          </span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="rgba(255,255,255,0.3)"
            style={{ transform: isSelected ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>
            <path d="M4 6l4 4 4-4" />
          </svg>
        </div>
      </div>

      {isSelected && (
        <div style={styles.projectDetail}>
          {/* Editable Name / Type / Channel */}
          <div style={styles.detailSection}>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: 2, minWidth: '180px' }}>
                <label style={styles.detailLabel}>Name</label>
                {editingField === 'name' ? (
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => { if (editName.trim() && editName !== project.name) saveField('name', editName.trim()); else setEditingField(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setEditName(project.name); setEditingField(null); } }}
                    style={styles.inlineInput}
                    autoFocus
                  />
                ) : (
                  <div onClick={() => { setEditName(project.name || ''); setEditingField('name'); }} style={styles.inlineDisplay}>{project.name}</div>
                )}
              </div>
              <div style={{ flex: 1, minWidth: '140px' }}>
                <label style={styles.detailLabel}>Type</label>
                {editingField === 'type' ? (
                  <select
                    value={editType}
                    onChange={(e) => { setEditType(e.target.value); saveField('type', e.target.value); }}
                    onBlur={() => setEditingField(null)}
                    style={styles.inlineInput}
                    autoFocus
                  >
                    {typeList.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                ) : (
                  <div onClick={() => { setEditType(project.type || typeList[0].value); setEditingField('type'); }} style={styles.inlineDisplay}>
                    {typeList.find(t => t.value === project.type)?.label || project.type}
                  </div>
                )}
              </div>
              {!isBusiness && (
                <div style={{ flex: 1, minWidth: '140px' }}>
                  <label style={styles.detailLabel}>Channel</label>
                  {editingField === 'channel' ? (
                    <select
                      value={editChannel}
                      onChange={(e) => { setEditChannel(e.target.value); }}
                      onBlur={() => { if (editChannel !== project.channel) saveField('channel', editChannel); else setEditingField(null); }}
                      style={styles.inlineInput}
                      autoFocus
                    >
                      <option value="">No channel</option>
                      {CHANNELS.map((ch) => <option key={ch} value={ch}>{ch}</option>)}
                    </select>
                  ) : (
                    <div onClick={() => { setEditChannel(project.channel || ''); setEditingField('channel'); }} style={styles.inlineDisplay}>
                      {project.channel || <span style={{ color: 'rgba(255,255,255,0.2)' }}>No channel</span>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Status Pipeline */}
          <div style={styles.detailSection}>
            <h4 style={styles.detailLabel}>Status Pipeline</h4>
            <div style={styles.pipeline}>
              {statusList.map((s, i) => {
                const isActive = s === project.status;
                const isPast = statusList.indexOf(project.status) > i;
                return (
                  <button
                    key={s}
                    onClick={() => onStatusChange(project.id, s)}
                    style={{
                      ...styles.pipelineStep,
                      background: isActive
                        ? `${statusColors[s]}25`
                        : isPast
                          ? 'rgba(255,255,255,0.04)'
                          : 'transparent',
                      borderColor: isActive ? statusColors[s] : 'rgba(255,255,255,0.08)',
                      color: isActive ? statusColors[s] : isPast ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.25)',
                    }}
                  >
                    {isPast && '✓ '}{statusLabels[s]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Linked Fields */}
          {!isBusiness && (
            <div style={styles.detailSection}>
              <h4 style={styles.detailLabel}>Linked Fields</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', display: 'block', marginBottom: '4px' }}>Write Doc</label>
                  <select
                    value={project.write_doc_id || ''}
                    onChange={(e) => {
                      const doc = writeDocs.find(d => d.id === e.target.value);
                      onUpdateProject(project.id, { write_doc_id: e.target.value || null, write_doc_name: doc?.name || null });
                    }}
                    style={styles.inlineInput}
                  >
                    <option value="">None</option>
                    {writeDocs.map(doc => (
                      <option key={doc.id} value={doc.id}>
                        {doc.folderName ? `${doc.folderName} / ${doc.name}` : doc.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', display: 'block', marginBottom: '4px' }}>Script / Beat Sheet</label>
                  <select
                    value={project.beat_sheet_id || ''}
                    onChange={(e) => onUpdateProject(project.id, { beat_sheet_id: e.target.value || null })}
                    style={styles.inlineInput}
                  >
                    <option value="">None</option>
                    {beatSheets.map(bs => (
                      <option key={bs.id} value={bs.id}>{bs.title}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', display: 'block', marginBottom: '4px' }}>Ad Read</label>
                  <select
                    value={project.ad_read_id || ''}
                    onChange={(e) => onUpdateProject(project.id, { ad_read_id: e.target.value || null })}
                    style={styles.inlineInput}
                  >
                    <option value="">None</option>
                    {adReadDeliverables.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.sponsor_name}{d.campaign_name ? ` — ${d.campaign_name}` : ''}{d.title ? `: ${d.title}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Timeline */}
          <div style={styles.detailSection}>
            <h4 style={styles.detailLabel}>Timeline</h4>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <label style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', display: 'block', marginBottom: '4px' }}>Start</label>
                {editingField === 'start_date' ? (
                  <input
                    type="date"
                    value={editStartDate}
                    onChange={(e) => setEditStartDate(e.target.value)}
                    onBlur={() => { if (editStartDate !== project.start_date) saveField('start_date', editStartDate); else setEditingField(null); }}
                    style={styles.inlineInput}
                    autoFocus
                  />
                ) : (
                  <div onClick={() => { setEditStartDate(project.start_date || ''); setEditingField('start_date'); }} style={styles.inlineDisplay}>
                    {project.start_date ? new Date(project.start_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : <span style={{ color: 'rgba(255,255,255,0.2)' }}>Set start date</span>}
                  </div>
                )}
              </div>
              <span style={{ color: 'rgba(255,255,255,0.2)', marginTop: '16px' }}>→</span>
              <div>
                <label style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', display: 'block', marginBottom: '4px' }}>Deadline</label>
                {editingField === 'deadline' ? (
                  <input
                    type="date"
                    value={editDeadline}
                    onChange={(e) => setEditDeadline(e.target.value)}
                    onBlur={() => { if (editDeadline !== project.deadline) saveField('deadline', editDeadline); else setEditingField(null); }}
                    style={styles.inlineInput}
                    autoFocus
                  />
                ) : (
                  <div onClick={() => { setEditDeadline(project.deadline || ''); setEditingField('deadline'); }} style={styles.inlineDisplay}>
                    {project.deadline ? new Date(project.deadline).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : <span style={{ color: 'rgba(255,255,255,0.2)' }}>Set deadline</span>}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Assignments */}
          <div style={styles.detailSection}>
            <h4 style={styles.detailLabel}>Assignments</h4>
            <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', margin: '0 0 10px 0' }}>
              Pick a task per stage and assign team members. Skip removes the stage entirely.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {statusList.map(stage => {
                const stageAs = (project.project_stage_assignments || []).filter(a => a.stage === stage);
                const isCurrentStage = project.status === stage;
                const stageDates = editStageTimelines[stage] || {};
                const stageTask = stageTaskLabel(project.type, stage) || statusLabels[stage];
                const taskTitle = `${project.name} — ${stageTask}`;
                const isSkipped = !!editStageConfig[stage]?.skip;
                const taskValue = isSkipped ? 'skip' : 'task';
                return (
                  <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: '6px', background: isCurrentStage ? `${statusColors[stage]}08` : 'transparent', borderLeft: isCurrentStage ? `2px solid ${statusColors[stage]}` : '2px solid transparent', opacity: isSkipped ? 0.55 : 1 }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: statusColors[stage], width: '80px', flexShrink: 0 }}>{statusLabels[stage]}</span>
                    <select
                      value={taskValue}
                      onChange={(e) => saveStageSkip(stage, e.target.value === 'skip')}
                      title={taskTitle}
                      style={{ padding: '3px 6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#fff', fontSize: '11px', fontFamily: 'inherit', outline: 'none', minWidth: '180px', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    >
                      <option value="task">{taskTitle}</option>
                      <option value="skip">Skip</option>
                    </select>
                    <div style={{ display: 'flex', gap: '4px', flex: 1, flexWrap: 'wrap', alignItems: 'center', pointerEvents: isSkipped ? 'none' : 'auto' }}>
                      {stageAs.map(a => {
                        const tt = a.profile?.title || a.profile?.role;
                        return (
                          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(99,102,241,0.1)', padding: '2px 6px', borderRadius: '6px' }}>
                            <div style={{ width: '18px', height: '18px', borderRadius: '6px', background: 'rgba(99,102,241,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: 600, color: '#a5b4fc' }}>{a.profile?.full_name?.charAt(0)}</div>
                            <span style={{ fontSize: '11px', color: '#a5b4fc' }}>{a.profile?.full_name}</span>
                            {tt && <span style={{ fontSize: '10px', color: 'rgba(165,180,252,0.6)' }}>— {tt}</span>}
                            <button onClick={() => onRemoveProjectStageAssignment(a.id)} disabled={isSkipped} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)', cursor: isSkipped ? 'not-allowed' : 'pointer', fontSize: '12px', padding: '4px' }}>✕</button>
                          </div>
                        );
                      })}
                      <select
                        disabled={isSkipped}
                        onChange={(e) => { if (e.target.value) { onAssignProjectStage(project.id, stage, e.target.value); e.target.value = ''; } }}
                        defaultValue=""
                        style={{ padding: '3px 6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#fff', fontSize: '11px', fontFamily: 'inherit', outline: 'none' }}
                      >
                        <option value="">+ Assign</option>
                        {teamMembers.filter(m => !stageAs.some(a => a.user_id === m.id)).map(m => {
                          const tt = m.title;
                          return (
                            <option key={m.id} value={m.id}>{tt ? `${m.full_name} — ${tt}` : m.full_name}</option>
                          );
                        })}
                      </select>
                    </div>
                    <input
                      type="date"
                      value={stageDates.start || ''}
                      onChange={(e) => saveStageDate(stage, 'start', e.target.value)}
                      title="Stage start"
                      style={{ padding: '2px 4px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', color: stageDates.start ? '#fff' : 'rgba(255,255,255,0.2)', fontSize: '10px', fontFamily: 'inherit', outline: 'none', width: '110px', flexShrink: 0 }}
                    />
                    <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: '10px', flexShrink: 0 }}>→</span>
                    <input
                      type="date"
                      value={stageDates.end || ''}
                      onChange={(e) => saveStageDate(stage, 'end', e.target.value)}
                      title="Stage end"
                      style={{ padding: '2px 4px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', color: stageDates.end ? '#fff' : 'rgba(255,255,255,0.2)', fontSize: '10px', fontFamily: 'inherit', outline: 'none', width: '110px', flexShrink: 0 }}
                    />
                  </div>
                );
              })}
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

          {/* Archive / Delete Project */}
          {(project.created_by === profile?.id || isAdmin) && (
            <div style={styles.detailSection}>
              <div style={{ display: 'flex', gap: '8px' }}>
                {project.is_archived ? (
                  <button
                    onClick={() => onUnarchiveProject(project.id)}
                    style={styles.unarchiveProjectBtn}
                  >Restore from Archive</button>
                ) : (
                  <button
                    onClick={() => onArchiveProject(project.id)}
                    style={styles.archiveProjectBtn}
                  >Archive Project</button>
                )}
                <button
                  onClick={() => onDeleteProject(project.id)}
                  style={styles.deleteProjectBtn}
                >Delete</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KanbanCard({ project }) {
  const daysLeft = project.deadline ? Math.ceil(
    (new Date(project.deadline) - new Date()) / (1000 * 60 * 60 * 24)
  ) : null;
  const checklists = project.project_checklists || [];
  const stageItems = checklists.filter(c => c.stage === project.status);
  const completed = stageItems.filter(c => c.is_complete).length;
  const total = stageItems.length;
  const typeLabel = PROJECT_TYPES.find(t => t.value === project.type)?.label || project.type.replace('_', ' ');

  return (
    <>
      <div style={styles.kanbanCardName}>{project.name}</div>
      <div style={styles.kanbanCardMeta}>
        <span style={{
          ...styles.kanbanTypeBadge,
          background: `${STATUS_COLORS[project.status]}15`,
          color: STATUS_COLORS[project.status],
        }}>
          {typeLabel}
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
          {(project.project_stage_assignments || []).filter(a => a.stage === project.status).slice(0, 3).map(a => (
            <div key={a.id} style={{ ...styles.kanbanAvatar, background: 'rgba(236,72,153,0.25)', color: '#f9a8d4' }} title={`${a.profile?.full_name} (stage)`}>{a.profile?.full_name?.charAt(0)}</div>
          ))}
        </div>
        {daysLeft != null && (
          <span style={{
            fontSize: '11px', fontWeight: 600,
            color: daysLeft < 0 ? '#ef4444' : daysLeft <= 3 ? '#f97316' : 'rgba(255,255,255,0.4)',
          }}>
            {daysLeft < 0 ? `${Math.abs(daysLeft)}d over` : `${daysLeft}d`}
          </span>
        )}
      </div>
      {total > 0 && (
        <div style={styles.kanbanProgress}>
          <div style={styles.kanbanProgressBar}>
            <div style={{ ...styles.kanbanProgressFill, width: `${(completed / total) * 100}%` }} />
          </div>
          <span style={styles.kanbanProgressText}>{completed}/{total}</span>
        </div>
      )}
      {project.creator?.full_name && (
        <div style={styles.kanbanAddedBy}>Added by {project.creator.full_name}</div>
      )}
    </>
  );
}

function ShortsCard({ clip, teamMembers, onUpdate, onDelete, isEditing, onToggleEdit }) {
  const [editDriveLink, setEditDriveLink] = useState(clip.drive_link || '');
  const [editNotes, setEditNotes] = useState(clip.notes || '');
  const [editAssignedTo, setEditAssignedTo] = useState(clip.assigned_to || '');

  const postByDays = clip.post_by
    ? Math.ceil((new Date(clip.post_by) - new Date()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
        <div style={styles.kanbanCardName}>{clip.title}</div>
        <button onClick={onToggleEdit} style={{ ...styles.removeBtn, fontSize: '14px', padding: '0 4px' }}>
          {isEditing ? '✕' : '⋯'}
        </button>
      </div>
      {clip.source_show && (
        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginBottom: '6px' }}>
          {clip.source_show}
        </div>
      )}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
        <span style={{
          fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px',
          textTransform: 'uppercase', letterSpacing: '0.3px',
          background: clip.urgency === 'time_sensitive' ? 'rgba(239,68,68,0.15)' : 'rgba(107,114,128,0.15)',
          color: clip.urgency === 'time_sensitive' ? '#fca5a5' : '#9ca3af',
        }}>
          {clip.urgency === 'time_sensitive' ? 'TIME SENSITIVE' : 'EVERGREEN'}
        </span>
        {clip.post_by && (
          <span style={{
            fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px',
            background: postByDays !== null && postByDays <= 1 ? 'rgba(239,68,68,0.15)' : postByDays !== null && postByDays <= 3 ? 'rgba(249,115,22,0.15)' : 'rgba(255,255,255,0.06)',
            color: postByDays !== null && postByDays <= 1 ? '#fca5a5' : postByDays !== null && postByDays <= 3 ? '#fdba74' : 'rgba(255,255,255,0.4)',
          }}>
            Post by {new Date(clip.post_by + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
        {clip.posted_platform && (
          <span style={{
            fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px',
            background: 'rgba(34,197,94,0.15)', color: '#86efac',
          }}>
            {clip.posted_platform}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {clip.assignee && (
            <div style={styles.kanbanAvatar} title={clip.assignee.full_name}>
              {clip.assignee.full_name?.charAt(0)}
            </div>
          )}
          {clip.drive_link && (
            <a
              href={clip.drive_link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ fontSize: '11px', color: '#a5b4fc', textDecoration: 'none' }}
              title="Open Drive link"
            >
              Drive ↗
            </a>
          )}
          {clip.posted_url && (
            <a
              href={clip.posted_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ fontSize: '11px', color: '#86efac', textDecoration: 'none' }}
              title="View post"
            >
              View ↗
            </a>
          )}
        </div>
      </div>
      {clip.notes && !isEditing && (
        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginTop: '6px', lineHeight: 1.3 }}>
          {clip.notes.length > 60 ? clip.notes.substring(0, 60) + '…' : clip.notes}
        </div>
      )}
      {isEditing && (
        <div style={{ marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <input
              value={editDriveLink}
              onChange={(e) => setEditDriveLink(e.target.value)}
              placeholder="Google Drive link..."
              style={styles.smallInput}
              onClick={(e) => e.stopPropagation()}
            />
            <select
              value={editAssignedTo}
              onChange={(e) => setEditAssignedTo(e.target.value)}
              style={styles.smallSelect}
              onClick={(e) => e.stopPropagation()}
            >
              <option value="">Unassigned</option>
              {teamMembers.map(m => (
                <option key={m.id} value={m.id}>{m.full_name}</option>
              ))}
            </select>
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder="Notes..."
              rows={2}
              style={{ ...styles.smallInput, resize: 'vertical' }}
              onClick={(e) => e.stopPropagation()}
            />
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdate({
                    drive_link: editDriveLink || null,
                    notes: editNotes || null,
                    assigned_to: editAssignedTo || null,
                  });
                  onToggleEdit();
                }}
                style={styles.smallBtn}
              >Save</button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                style={{ ...styles.smallBtn, background: 'rgba(239,68,68,0.15)', color: '#fca5a5' }}
              >Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StagePromptModal({ prompt, onSubmit, onCancel }) {
  const [driveLink, setDriveLink] = useState('');
  const [platform, setPlatform] = useState('');
  const [postedUrl, setPostedUrl] = useState('');

  return (
    <div style={styles.modalOverlay} onClick={onCancel}>
      <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        {prompt.type === 'drive_link' ? (
          <>
            <h3 style={{ color: '#e2e8f0', margin: '0 0 4px', fontSize: '16px' }}>
              Mark as Ready to Post
            </h3>
            <p style={{ color: 'rgba(255,255,255,0.4)', margin: '0 0 16px', fontSize: '13px' }}>
              "{prompt.title}" — paste the Google Drive link for the finished clip.
            </p>
            <input
              value={driveLink}
              onChange={(e) => setDriveLink(e.target.value)}
              placeholder="https://drive.google.com/..."
              style={{ ...styles.input, width: '100%', boxSizing: 'border-box', marginBottom: '12px' }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={onCancel} style={{ ...styles.smallBtn, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}>
                Cancel
              </button>
              <button onClick={() => onSubmit({ drive_link: driveLink || null })} style={styles.smallBtn}>
                {driveLink ? 'Save & Move' : 'Skip & Move'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 style={{ color: '#e2e8f0', margin: '0 0 4px', fontSize: '16px' }}>
              Mark as Posted
            </h3>
            <p style={{ color: 'rgba(255,255,255,0.4)', margin: '0 0 16px', fontSize: '13px' }}>
              "{prompt.title}" — where was this clip posted?
            </p>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              style={{ ...styles.select, width: '100%', boxSizing: 'border-box', marginBottom: '10px' }}
            >
              <option value="">Select platform...</option>
              {POSTING_PLATFORMS.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <input
              value={postedUrl}
              onChange={(e) => setPostedUrl(e.target.value)}
              placeholder="Link to live post (optional)"
              style={{ ...styles.input, width: '100%', boxSizing: 'border-box', marginBottom: '12px' }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={onCancel} style={{ ...styles.smallBtn, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}>
                Cancel
              </button>
              <button
                onClick={() => onSubmit({
                  posted_platform: platform || null,
                  posted_url: postedUrl || null,
                })}
                style={styles.smallBtn}
              >
                {platform ? 'Save & Move' : 'Skip & Move'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: { padding: '32px 40px' },
  sectionHeading: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    margin: '0 0 12px',
  },
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
  inlineInput: {
    padding: '8px 10px', background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(99,102,241,0.4)', borderRadius: '6px',
    color: '#fff', fontSize: '13px', fontFamily: 'inherit',
    outline: 'none', width: '100%', boxSizing: 'border-box',
  },
  inlineDisplay: {
    padding: '8px 10px', borderRadius: '6px',
    border: '1px solid transparent', cursor: 'pointer',
    fontSize: '13px', color: 'rgba(255,255,255,0.6)',
    transition: 'border-color 0.15s, background 0.15s',
    background: 'transparent',
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
  deleteProjectBtn: { padding: '8px 16px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', color: '#fca5a5', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  archiveProjectBtn: { flex: 1, padding: '8px 16px', background: 'rgba(107,114,128,0.08)', border: '1px solid rgba(107,114,128,0.2)', borderRadius: '8px', color: '#9ca3af', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  unarchiveProjectBtn: { flex: 1, padding: '8px 16px', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '8px', color: '#a5b4fc', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  archivedTag: { marginLeft: '8px', fontSize: '10px', fontWeight: 600, color: '#6b7280', background: 'rgba(107,114,128,0.15)', padding: '2px 6px', borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.3px', verticalAlign: 'middle' },
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
  columnAddBtn: {
    background: 'none',
    border: '1px dashed rgba(255,255,255,0.08)',
    borderRadius: '8px',
    padding: '7px',
    width: '100%',
    color: 'rgba(255,255,255,0.25)',
    fontSize: '12px',
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    textAlign: 'center',
    marginTop: '2px',
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
  kanbanAddedBy: {
    fontSize: '10px',
    color: 'rgba(255,255,255,0.3)',
    fontStyle: 'italic',
    marginTop: '6px',
  },
  checklistBadge: {
    fontSize: '11px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.4)',
    background: 'rgba(255,255,255,0.06)',
    padding: '2px 7px',
    borderRadius: '6px',
  },
  projectModalContent: {
    position: 'relative',
    background: '#12121f',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '14px',
    width: '860px',
    maxWidth: '95vw',
    maxHeight: '90vh',
    overflowY: 'auto',
    padding: '8px 12px',
  },
  projectModalClose: {
    position: 'absolute',
    top: '12px',
    right: '12px',
    width: '28px',
    height: '28px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    background: 'rgba(0,0,0,0.4)',
    color: 'rgba(255,255,255,0.6)',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: 'inherit',
    zIndex: 2,
  },
  // --- Section Tabs ---
  sectionTabs: {
    display: 'flex',
    gap: '4px',
    marginBottom: '24px',
    background: 'rgba(255,255,255,0.03)',
    borderRadius: '10px',
    padding: '3px',
    border: '1px solid rgba(255,255,255,0.06)',
    width: 'fit-content',
  },
  sectionTab: {
    padding: '8px 20px',
    border: 'none',
    borderRadius: '8px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.4)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  sectionTabActive: {
    background: 'rgba(99,102,241,0.15)',
    color: '#a5b4fc',
  },
  sectionTabBadge: {
    fontSize: '10px',
    fontWeight: 700,
    background: 'rgba(99,102,241,0.3)',
    color: '#c7d2fe',
    padding: '1px 6px',
    borderRadius: '8px',
    minWidth: '16px',
    textAlign: 'center',
  },
  // --- Shorts Queue ---
  urgencyToggle: {
    display: 'flex',
    gap: '4px',
    background: 'rgba(255,255,255,0.03)',
    borderRadius: '8px',
    padding: '3px',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  urgencyBtn: {
    flex: 1,
    padding: '8px 12px',
    border: 'none',
    borderRadius: '6px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.4)',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
  },
  urgencyBtnTimeSensitive: {
    background: 'rgba(239,68,68,0.15)',
    color: '#fca5a5',
  },
  urgencyBtnEvergreen: {
    background: 'rgba(107,114,128,0.2)',
    color: '#d1d5db',
  },
  shortsBoardContainer: {
    display: 'flex',
    gap: '12px',
    overflowX: 'auto',
    paddingBottom: '16px',
  },
  shortsColumn: {
    flex: '1 1 0',
    minWidth: '260px',
    borderRadius: '12px',
    border: '1px solid rgba(255,255,255,0.06)',
    display: 'flex',
    flexDirection: 'column',
    transition: 'background 0.15s',
  },
  shortsColumnHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 14px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  shortsEmptyColumn: {
    padding: '24px 16px',
    textAlign: 'center',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modalContent: {
    background: '#1a1a2e',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '14px',
    padding: '24px',
    width: '420px',
    maxWidth: '90vw',
  },
};
