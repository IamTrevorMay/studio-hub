import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useSupabaseQuery } from '../hooks/useSupabaseQuery';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';


const STATUSES = ['concept', 'script', 'production', 'edit', 'review', 'published'];
const STATUS_LABELS = {
  concept: 'Idea', script: 'Script/Beat Sheet', production: 'Production',
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
  { value: 'substack_article', label: 'Substack Article' },
  { value: 'other', label: 'Other' },
];
const BUSINESS_PROJECT_TYPES = [
  { value: 'sponsorship', label: 'Sponsorship' },
  { value: 'collaboration', label: 'Collaboration' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'administration', label: 'Administration' },
  { value: 'other', label: 'Other' },
];
const BUSINESS_STATUSES = ['backlog', 'in_progress', 'holding', 'completed'];
const BUSINESS_STATUS_LABELS = {
  backlog: 'Backlog', in_progress: 'In Progress', holding: 'Holding', completed: 'Completed',
};
const BUSINESS_STATUS_COLORS = {
  backlog: '#8b5cf6', in_progress: '#3b82f6', holding: '#f59e0b', completed: '#22c55e',
};
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

const DELIVERABLE_TYPES = {
  long_form_read: { label: 'Long Form Read', icon: '📖' },
  live_read: { label: 'Live Read', icon: '🎙️' },
  short_form_video: { label: 'Short Form Video', icon: '📱' },
};
const DELIVERABLE_STAGES = ['script', 'production', 'editing', 'sent_for_review', 'posted'];
const DELIVERABLE_STAGE_LABELS = {
  script: 'Script', production: 'Production', editing: 'Editing',
  sent_for_review: 'Sent for Review', posted: 'Posted',
};
const DELIVERABLE_STAGE_COLORS = {
  script: '#3b82f6', production: '#f59e0b', editing: '#f97316',
  sent_for_review: '#ec4899', posted: '#22c55e',
};
const DELIVERABLE_PLATFORMS = ['YouTube', 'TikTok', 'Instagram', 'X/Twitter', 'Facebook', 'Substack', 'Podcast'];
const SPONSOR_STATUS_COLORS = { active: '#10b981', completed: '#6366f1', cancelled: '#ef4444' };
const PAYMENT_STATUS_COLORS = { unpaid: '#ef4444', partial: '#f59e0b', paid: '#10b981' };
const CHANNEL_COLORS = {
  mayday: { bg: 'rgba(99,102,241,0.12)', color: '#a5b4fc', label: 'MD' },
  tmb: { bg: 'rgba(239,68,68,0.12)', color: '#fca5a5', label: 'TMB' },
  socials: { bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)', label: 'SOC' },
};

const MAYDAY_SEGMENTS = ['Maysplaining', "Punchin' Tickets", 'Mayday Update', 'Internet Says', 'Going Deep'];
const MAYDAY_SEGMENT_COLORS = {
  'Maysplaining':    { bg: 'rgba(99,102,241,0.15)',  color: '#a5b4fc' },
  "Punchin' Tickets":{ bg: 'rgba(239,68,68,0.15)',   color: '#fca5a5' },
  'Mayday Update':   { bg: 'rgba(34,197,94,0.15)',   color: '#86efac' },
  'Internet Says':   { bg: 'rgba(245,158,11,0.15)',  color: '#fcd34d' },
  'Going Deep':      { bg: 'rgba(236,72,153,0.15)',  color: '#f9a8d4' },
};
const MAYDAY_STAGES = ['idea', 'script', 'gather_broadcast', 'film', 'editor', 'thumbnail_post', 'complete'];
const MAYDAY_STAGE_LABELS = {
  idea: 'Idea', script: 'Script', gather_broadcast: 'Gather Assets + Broadcast',
  film: 'Film', editor: 'Editor', thumbnail_post: 'Thumbnail + Post', complete: 'Complete',
};
const MAYDAY_STAGE_COLORS = {
  idea: '#8b5cf6', script: '#3b82f6', gather_broadcast: '#f59e0b',
  film: '#ef4444', editor: '#f97316', thumbnail_post: '#ec4899', complete: '#22c55e',
};

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

  // Sponsors state
  const [sponsors, setSponsors] = useState([]);
  const [sponsorLoading, setSponsorLoading] = useState(false);
  const [expandedSponsorId, setExpandedSponsorId] = useState(null);
  const [showSponsorForm, setShowSponsorForm] = useState(false);
  const [editingSponsor, setEditingSponsor] = useState(null);
  const [sponsorName, setSponsorName] = useState('');
  const [sponsorNotes, setSponsorNotes] = useState('');
  const [showDeliverableForm, setShowDeliverableForm] = useState(null); // campaignId or null
  const [editingDeliverable, setEditingDeliverable] = useState(null);
  const [deliverableTitle, setDeliverableTitle] = useState('');
  const [deliverableType, setDeliverableType] = useState('long_form_read');
  const [dueDate, setDueDate] = useState('');
  const [deliverableNotes, setDeliverableNotes] = useState('');
  const [deliverablePlatforms, setDeliverablePlatforms] = useState([]);
  const [deliverableNeedsReview, setDeliverableNeedsReview] = useState(false);
  const [deliverableCampaignId, setDeliverableCampaignId] = useState('');
  const [deliverablePay, setDeliverablePay] = useState('');
  const [deliverableBeatSheetId, setDeliverableBeatSheetId] = useState('');
  const [deliverableVideoEventId, setDeliverableVideoEventId] = useState('');
  const [deliverableChannel, setDeliverableChannel] = useState('');

  // Video events for sponsor calendar
  const [videoEvents, setVideoEvents] = useState([]);
  const [videoSlotConfig, setVideoSlotConfig] = useState([]);
  const [slotDropdown, setSlotDropdown] = useState(null); // { dateStr, channel, x, y }
  const slotDropdownRef = useRef(null);
  const [sponsorCalOpen, setSponsorCalOpen] = useState(false);
  const [sponsorCalMonth, setSponsorCalMonth] = useState(() => new Date());

  // Campaign state
  const [showCampaignForm, setShowCampaignForm] = useState(null); // sponsorId or null
  const [editingCampaign, setEditingCampaign] = useState(null);
  const [campaignForm, setCampaignForm] = useState({ name: '', description: '', start_date: '', end_date: '', contact_name: '', contact_email: '', payment_status: 'unpaid' });
  const [briefFile, setBriefFile] = useState(null);
  const [briefMode, setBriefMode] = useState('upload'); // 'upload' | 'link'
  const [briefLinkUrl, setBriefLinkUrl] = useState('');
  const [briefLinkLabel, setBriefLinkLabel] = useState('');

  const [allDeliverables, setAllDeliverables] = useState([]);

  const [showArchivedSection, setShowArchivedSection] = useState(false);

  // Reads state
  const [reads, setReads] = useState([]);
  const [readsLoading, setReadsLoading] = useState(false);
  const [showReadForm, setShowReadForm] = useState(false);
  const [editingRead, setEditingRead] = useState(null);
  const [readForm, setReadForm] = useState({ sponsor_id: '', payout: '', long_form: '', file: null, removeFile: false });
  const [expandedReadId, setExpandedReadId] = useState(null);
  const readFileInputRef = useRef(null);

  // Proposals state
  const [proposals, setProposals] = useState([]);
  const [proposalsLoading, setProposalsLoading] = useState(false);
  const [showProposalForm, setShowProposalForm] = useState(false);
  const [proposalForm, setProposalForm] = useState({ sponsor_name: '', timeframe: '', num_videos: '', pay: '', description: '' });

  // Mayday Videos state
  const [maydayVideos, setMaydayVideos] = useState([]);
  const [maydayLoading, setMaydayLoading] = useState(false);
  const [showMaydayForm, setShowMaydayForm] = useState(false);
  const [maydayForm, setMaydayForm] = useState({ title: '', post_date: '', segment: '', write_doc_id: '', write_doc_name: '', beat_sheet_id: '', ad_read_id: '' });
  const [editingMayday, setEditingMayday] = useState(null);

  const formRef = useRef(null);

  // Form dropdown data
  const [writeDocs, setWriteDocs] = useState([]);
  const [beatSheets, setBeatSheets] = useState([]);
  const [adReadDeliverables, setAdReadDeliverables] = useState([]);

  // Form state
  const [form, setForm] = useState({
    name: '', category: 'creative', type: 'youtube_video', channel: '',
    start_date: '', deadline: '', status: 'concept',
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
          project_stage_assignments(*, profile:profiles(id, full_name))
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

  function openFormWithPreset(category, status) {
    const types = category === 'business' ? BUSINESS_PROJECT_TYPES : PROJECT_TYPES;
    setForm({ name: '', category, type: types[0].value, channel: '', start_date: '', deadline: '', status, write_doc_id: '', write_doc_name: '', beat_sheet_id: '', ad_read_id: '' });
    setShowForm(true);
    fetchWriteDocs();
    fetchBeatSheets();
    fetchAdReadDeliverables();
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  async function handleCreateProject(e, seriesId) {
    e.preventDefault();
    const insert = {
      name: form.name,
      category: form.category,
      type: form.type,
      channel: form.category === 'business' ? null : (form.channel || null),
      status: form.status,
      start_date: form.start_date || null,
      deadline: form.deadline || null,
      series_id: seriesId || null,
      created_by: profile.id,
      write_doc_id: form.write_doc_id || null,
      write_doc_name: form.write_doc_name || null,
      beat_sheet_id: form.beat_sheet_id || null,
      ad_read_id: form.ad_read_id || null,
    };
    const { error } = await supabase.from('projects').insert(insert);
    if (error) {
      alert('Error creating project: ' + error.message);
      return;
    }
    setForm({ name: '', category: 'creative', type: 'youtube_video', channel: '', start_date: '', deadline: '', status: 'concept', write_doc_id: '', write_doc_name: '', beat_sheet_id: '', ad_read_id: '' });
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

  // --- Sponsors ---
  const fetchSponsors = useCallback(async () => {
    setSponsorLoading(true);
    try {
      const { data, error } = await supabase
        .from('sponsors')
        .select('*, sponsor_deliverables(*, deliverable_stage_assignments(*, profile:profiles(id, full_name))), sponsor_campaigns(*)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setSponsors(data || []);
      // Flatten deliverables for kanban view
      const flat = [];
      (data || []).forEach(s => {
        (s.sponsor_deliverables || []).forEach(d => {
          const campaign = (s.sponsor_campaigns || []).find(c => c.id === d.campaign_id);
          flat.push({ ...d, sponsor_name: s.name, sponsor_id: s.id, campaign_name: campaign?.name || null });
        });
      });
      setAllDeliverables(flat);
    } catch (err) {
      console.error('Error fetching sponsors:', err);
      setSponsors([]);
    } finally {
      setSponsorLoading(false);
    }
  }, []);

  const fetchVideoEvents = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('calendar_events')
        .select('*')
        .eq('event_type', 'video_post')
        .order('start_date', { ascending: true });
      if (error) throw error;
      setVideoEvents(data || []);
    } catch (err) {
      console.error('Error fetching video events:', err);
    }
  }, []);

  const fetchVideoSlotConfig = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('video_slot_config')
        .select('channel, day_of_week');
      if (error) throw error;
      setVideoSlotConfig(data || []);
    } catch (err) {
      console.error('Error fetching video slot config:', err);
    }
  }, []);

  const handleAssignSlot = useCallback(async (deliverableId, dateStr) => {
    try {
      await supabase.from('sponsor_deliverables').update({ slot_date: dateStr }).eq('id', deliverableId);
      setSlotDropdown(null);
      await fetchSponsors();
    } catch (err) {
      console.error('Error assigning slot:', err);
    }
  }, [fetchSponsors]);

  const handleClearSlot = useCallback(async (deliverableId) => {
    try {
      await supabase.from('sponsor_deliverables').update({ slot_date: null, video_event_id: null }).eq('id', deliverableId);
      setSlotDropdown(null);
      await fetchSponsors();
    } catch (err) {
      console.error('Error clearing slot:', err);
    }
  }, [fetchSponsors]);

  // Close slot dropdown on click outside
  useEffect(() => {
    if (!slotDropdown) return;
    const handler = (e) => {
      if (slotDropdownRef.current && !slotDropdownRef.current.contains(e.target)) {
        setSlotDropdown(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [slotDropdown]);

  useEffect(() => {
    if (activeSection !== 'sponsors') return;
    fetchSponsors();
    fetchVideoEvents();
    fetchVideoSlotConfig();
  }, [activeSection, fetchSponsors, fetchVideoEvents, fetchVideoSlotConfig]);

  useEffect(() => {
    if (activeSection !== 'sponsors') return;
    const channel = supabase
      .channel('sponsors-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sponsors' }, () => fetchSponsors())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sponsor_deliverables' }, () => fetchSponsors())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sponsor_campaigns' }, () => fetchSponsors())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliverable_stage_assignments' }, () => fetchSponsors())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' }, () => fetchVideoEvents())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeSection, fetchSponsors, fetchVideoEvents, refreshKey]);

  // Auto-attach slotted deliverables to video events when dates match
  useEffect(() => {
    if (!videoEvents.length || !allDeliverables.length) return;
    const updates = [];
    videoEvents.forEach(ev => {
      const evDate = ev.start_date?.split('T')[0];
      if (!evDate) return;
      allDeliverables.forEach(d => {
        if (d.video_event_id) return; // already linked
        if (!d.slot_date) return; // not slotted
        if (d.slot_date !== evDate) return;
        updates.push({ id: d.id, video_event_id: ev.id });
      });
    });
    if (!updates.length) return;
    (async () => {
      for (const u of updates) {
        await supabase.from('sponsor_deliverables').update({ video_event_id: u.video_event_id }).eq('id', u.id);
      }
      fetchSponsors();
    })();
  }, [videoEvents, allDeliverables, fetchSponsors]); // eslint-disable-line

  // ===== Reads fetch =====
  const fetchReads = useCallback(async () => {
    setReadsLoading(true);
    try {
      const { data, error } = await supabase
        .from('sponsor_reads')
        .select('*, sponsor:sponsors(id, name)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setReads(data || []);
    } catch (err) {
      console.error('Error fetching reads:', err);
      setReads([]);
    } finally {
      setReadsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSection !== 'sponsors' && activeSection !== 'mayday') return;
    fetchReads();
  }, [activeSection, fetchReads]);

  useEffect(() => {
    if (activeSection !== 'sponsors' && activeSection !== 'mayday') return;
    const channel = supabase
      .channel('reads-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sponsor_reads' }, () => fetchReads())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeSection, fetchReads, refreshKey]);

  // ===== Proposals fetch =====
  const fetchProposals = useCallback(async () => {
    setProposalsLoading(true);
    try {
      const { data, error } = await supabase
        .from('ad_read_proposals')
        .select('*, creator:profiles(id, full_name)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setProposals(data || []);
    } catch (err) {
      console.error('Error fetching proposals:', err);
      setProposals([]);
    } finally {
      setProposalsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSection !== 'sponsors') return;
    fetchProposals();
  }, [activeSection, fetchProposals]);

  useEffect(() => {
    if (activeSection !== 'sponsors') return;
    const channel = supabase
      .channel('proposals-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ad_read_proposals' }, () => fetchProposals())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeSection, fetchProposals, refreshKey]);

  // ===== Mayday Videos fetch =====
  const fetchMaydayVideos = useCallback(async () => {
    setMaydayLoading(true);
    try {
      const { data, error } = await supabase
        .from('mayday_videos')
        .select('*, sponsor_read:sponsor_reads(id, sponsor:sponsors(id, name))')
        .eq('is_archived', false)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      setMaydayVideos(data || []);
    } catch (err) {
      console.error('Error fetching mayday videos:', err);
      setMaydayVideos([]);
    } finally {
      setMaydayLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSection !== 'mayday') return;
    fetchMaydayVideos();
  }, [activeSection, fetchMaydayVideos]);

  useEffect(() => {
    if (activeSection !== 'mayday') return;
    const channel = supabase
      .channel('mayday-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mayday_videos' }, () => fetchMaydayVideos())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeSection, fetchMaydayVideos, refreshKey]);

  // ===== Read handlers =====
  async function handleSaveRead(e) {
    e.preventDefault();
    const payload = {
      sponsor_id: readForm.sponsor_id,
      payout: readForm.payout ? parseFloat(readForm.payout) : null,
      long_form: readForm.long_form || null,
      updated_at: new Date().toISOString(),
    };

    // Handle file removal
    if (editingRead && readForm.removeFile && editingRead.file_path) {
      await supabase.storage.from('resources').remove([editingRead.file_path]);
      payload.file_path = null;
      payload.file_type = null;
      payload.file_size = null;
      payload.original_filename = null;
    }

    // Handle file upload
    if (readForm.file) {
      // Remove old file if replacing
      if (editingRead && editingRead.file_path) {
        await supabase.storage.from('resources').remove([editingRead.file_path]);
      }
      const filePath = `reads/${Date.now()}_${readForm.file.name}`;
      const { error: uploadError } = await supabase.storage.from('resources').upload(filePath, readForm.file);
      if (uploadError) { alert('File upload failed: ' + uploadError.message); return; }
      payload.file_path = filePath;
      payload.file_type = readForm.file.name.split('.').pop().toLowerCase();
      payload.file_size = readForm.file.size;
      payload.original_filename = readForm.file.name;
    }

    if (editingRead) {
      const { error } = await supabase.from('sponsor_reads').update(payload).eq('id', editingRead.id);
      if (error) { alert('Error updating read: ' + error.message); return; }
    } else {
      payload.created_by = profile.id;
      const { error } = await supabase.from('sponsor_reads').insert(payload);
      if (error) { alert('Error creating read: ' + error.message); return; }
    }
    resetReadForm();
    fetchReads();
  }

  async function handleDeleteRead(read) {
    if (!(await confirm('Delete this read?'))) return;
    if (read.file_path) {
      await supabase.storage.from('resources').remove([read.file_path]);
    }
    await supabase.from('sponsor_reads').delete().eq('id', read.id);
    fetchReads();
  }

  function startEditRead(read) {
    setEditingRead(read);
    setReadForm({ sponsor_id: read.sponsor_id, payout: read.payout || '', long_form: read.long_form || '', file: null, removeFile: false });
    setShowReadForm(true);
  }

  function resetReadForm() {
    setReadForm({ sponsor_id: '', payout: '', long_form: '', file: null, removeFile: false });
    setEditingRead(null);
    setShowReadForm(false);
    if (readFileInputRef.current) readFileInputRef.current.value = '';
  }

  // ===== Mayday handlers =====
  async function handleCreateMayday(e) {
    e.preventDefault();
    const { data: vData, error } = await supabase.from('mayday_videos').insert({
      title: maydayForm.title,
      post_date: maydayForm.post_date || null,
      created_by: profile.id,
      segment: maydayForm.segment || null,
      write_doc_id: maydayForm.write_doc_id || null,
      write_doc_name: maydayForm.write_doc_name || null,
      beat_sheet_id: maydayForm.beat_sheet_id || null,
      ad_read_id: maydayForm.ad_read_id || null,
    }).select().single();
    if (error) { alert('Error creating video: ' + error.message); return; }

    // Auto-create calendar event if post_date set
    if (maydayForm.post_date && vData) {
      const { data: evData } = await supabase.from('calendar_events').insert({
        title: `📹 ${maydayForm.title}`,
        event_type: 'video_post',
        start_date: `${maydayForm.post_date}T09:00:00`,
        end_date: `${maydayForm.post_date}T10:00:00`,
        all_day: true,
        created_by: profile.id,
      }).select().single();
      if (evData) {
        await supabase.from('mayday_videos').update({ calendar_event_id: evData.id }).eq('id', vData.id);
      }
    }

    // Auto-create a backlog task for the admin
    if (vData) {
      const { data: adminProfile } = await supabase
        .from('profiles').select('id').eq('role', 'admin').limit(1).single();
      if (adminProfile) {
        const { data: lastTask } = await supabase
          .from('personal_tasks')
          .select('position')
          .eq('created_by', adminProfile.id)
          .eq('status', 'backlog')
          .order('position', { ascending: false })
          .limit(1)
          .maybeSingle();
        await supabase.from('personal_tasks').insert({
          created_by: adminProfile.id,
          content: maydayForm.title,
          category: 'production',
          status: 'backlog',
          mayday_video_id: vData.id,
          position: (lastTask?.position ?? -1) + 1,
        });
      }
    }

    setMaydayForm({ title: '', post_date: '', segment: '', write_doc_id: '', write_doc_name: '', beat_sheet_id: '', ad_read_id: '' });
    setShowMaydayForm(false);
    fetchMaydayVideos();
  }

  async function handleUpdateMayday(videoId, updates) {
    // Calendar sync when post_date changes
    if ('post_date' in updates) {
      const video = maydayVideos.find(v => v.id === videoId);
      const postDate = updates.post_date;
      if (postDate && video?.calendar_event_id) {
        // Update existing event
        await supabase.from('calendar_events').update({
          title: `📹 ${video.title}`,
          start_date: `${postDate}T09:00:00`,
          end_date: `${postDate}T10:00:00`,
        }).eq('id', video.calendar_event_id);
      } else if (postDate && !video?.calendar_event_id) {
        // Create new event
        const { data: evData } = await supabase.from('calendar_events').insert({
          title: `📹 ${video.title}`,
          event_type: 'video_post',
          start_date: `${postDate}T09:00:00`,
          end_date: `${postDate}T10:00:00`,
          all_day: true,
          created_by: profile.id,
        }).select().single();
        if (evData) {
          updates.calendar_event_id = evData.id;
        }
      } else if (!postDate && video?.calendar_event_id) {
        // Remove event
        await supabase.from('calendar_events').delete().eq('id', video.calendar_event_id);
        updates.calendar_event_id = null;
      }
    }

    const { error } = await supabase.from('mayday_videos').update({
      ...updates, updated_at: new Date().toISOString(),
    }).eq('id', videoId);
    if (error) console.error('Error updating mayday video:', error);
    fetchMaydayVideos();
  }

  async function handleDeleteMayday(videoId) {
    if (!(await confirm('Delete this video?'))) return;
    const video = maydayVideos.find(v => v.id === videoId);
    if (video?.calendar_event_id) {
      await supabase.from('calendar_events').delete().eq('id', video.calendar_event_id);
    }
    await supabase.from('mayday_videos').delete().eq('id', videoId);
    fetchMaydayVideos();
  }

  async function onMaydayDragEnd(result) {
    if (!result.destination) return;
    const { draggableId, source, destination } = result;
    const newStage = destination.droppableId;
    const video = maydayVideos.find(v => v.id === draggableId);
    if (!video) return;

    if (video.stage !== newStage) {
      handleUpdateMayday(draggableId, { stage: newStage });
    } else {
      // Reorder within column
      const columnItems = maydayVideos.filter(v => v.stage === newStage).sort((a, b) => a.sort_order - b.sort_order);
      const oldIndex = columnItems.findIndex(v => v.id === draggableId);
      if (oldIndex === destination.index) return;
      const reordered = [...columnItems];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(destination.index, 0, moved);
      await Promise.all(reordered.map((item, idx) =>
        item.sort_order !== idx
          ? supabase.from('mayday_videos').update({ sort_order: idx }).eq('id', item.id)
          : null
      ).filter(Boolean));
      fetchMaydayVideos();
    }
  }

  // ===== Proposal handlers =====
  function resetProposalForm() {
    setProposalForm({ sponsor_name: '', timeframe: '', num_videos: '', pay: '', description: '' });
    setShowProposalForm(false);
  }

  async function handleCreateProposal(e) {
    e.preventDefault();
    const { error } = await supabase.from('ad_read_proposals').insert({
      sponsor_name: proposalForm.sponsor_name,
      timeframe: proposalForm.timeframe || null,
      num_videos: proposalForm.num_videos ? parseInt(proposalForm.num_videos) : null,
      pay: proposalForm.pay ? parseFloat(proposalForm.pay) : null,
      description: proposalForm.description || null,
      created_by: profile.id,
    });
    if (error) { alert('Error creating proposal: ' + error.message); return; }
    resetProposalForm();
    fetchProposals();
  }

  async function handleConfirmProposal(proposal) {
    try {
      // Find or create sponsor
      let sponsorId;
      const { data: existing } = await supabase
        .from('sponsors')
        .select('id')
        .ilike('name', proposal.sponsor_name)
        .limit(1)
        .single();
      if (existing) {
        sponsorId = existing.id;
      } else {
        const { data: newSponsor, error: sErr } = await supabase
          .from('sponsors')
          .insert({ name: proposal.sponsor_name, created_by: profile.id })
          .select()
          .single();
        if (sErr) throw sErr;
        sponsorId = newSponsor.id;
      }

      // Create campaign
      const campaignPayload = {
        sponsor_id: sponsorId,
        name: proposal.sponsor_name + ' Campaign',
        description: proposal.description || null,
        payment_status: 'unpaid',
      };
      // Parse timeframe if it matches YYYY-MM-DD - YYYY-MM-DD
      if (proposal.timeframe) {
        const match = proposal.timeframe.match(/^(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})$/);
        if (match) {
          campaignPayload.start_date = match[1];
          campaignPayload.end_date = match[2];
        }
      }
      const { error: cErr } = await supabase
        .from('sponsor_campaigns')
        .insert(campaignPayload);
      if (cErr) throw cErr;

      // Mark proposal accepted
      await supabase.from('ad_read_proposals').update({ status: 'accepted' }).eq('id', proposal.id);
      fetchProposals();
      fetchSponsors();
    } catch (err) {
      alert('Error confirming proposal: ' + err.message);
    }
  }

  async function handleDeclineProposal(id) {
    await supabase.from('ad_read_proposals').update({ status: 'declined' }).eq('id', id);
    fetchProposals();
  }

  function resetSponsorForm() {
    setSponsorName('');
    setSponsorNotes('');
    setEditingSponsor(null); setShowSponsorForm(false);
  }

  function resetDeliverableForm() {
    setDeliverableTitle(''); setDeliverableType('long_form_read');
    setDueDate(''); setDeliverableNotes('');
    setDeliverablePlatforms([]); setDeliverableNeedsReview(false); setDeliverableCampaignId('');
    setDeliverablePay(''); setDeliverableBeatSheetId(''); setDeliverableVideoEventId('');
    setDeliverableChannel('');
    setEditingDeliverable(null); setShowDeliverableForm(null);
  }

  function startEditSponsor(sponsor) {
    setSponsorName(sponsor.name);
    setSponsorNotes(sponsor.notes || '');
    setEditingSponsor(sponsor.id);
    setShowSponsorForm(true);
  }

  function startEditDeliverable(d) {
    setDeliverableTitle(d.title);
    setDeliverableType(d.deliverable_type);
    setDueDate(d.due_date || '');
    setDeliverableNotes(d.notes || '');
    setDeliverablePlatforms(d.platforms || []);
    setDeliverableNeedsReview(d.needs_review || false);
    setDeliverableCampaignId(d.campaign_id || '');
    setDeliverablePay(d.pay != null ? String(d.pay) : '');
    setDeliverableBeatSheetId(d.beat_sheet_id || '');
    setDeliverableVideoEventId(d.video_event_id || '');
    setDeliverableChannel(d.channel || '');
    setEditingDeliverable(d.id);
    setShowDeliverableForm(d.campaign_id);
  }

  async function handleSaveSponsor(e) {
    e.preventDefault();
    const payload = {
      name: sponsorName,
      notes: sponsorNotes || null,
      updated_at: new Date().toISOString(),
    };
    if (editingSponsor) {
      const { error } = await supabase.from('sponsors').update(payload).eq('id', editingSponsor);
      if (error) { alert('Error updating sponsor: ' + error.message); return; }
    } else {
      const { error } = await supabase.from('sponsors').insert({ ...payload, created_by: profile.id });
      if (error) { alert('Error creating sponsor: ' + error.message); return; }
    }
    resetSponsorForm();
    fetchSponsors();
  }

  async function handleDeleteSponsor(sponsorId) {
    if (!(await confirm('Delete this sponsor and all its deliverables?'))) return;
    // Delete linked calendar events first
    const sponsor = sponsors.find(s => s.id === sponsorId);
    if (sponsor?.sponsor_deliverables) {
      const eventIds = sponsor.sponsor_deliverables
        .filter(d => d.calendar_event_id)
        .map(d => d.calendar_event_id);
      if (eventIds.length > 0) {
        await supabase.from('calendar_events').delete().in('id', eventIds);
      }
    }
    await supabase.from('sponsors').delete().eq('id', sponsorId);
    if (expandedSponsorId === sponsorId) setExpandedSponsorId(null);
    fetchSponsors();
  }

  async function handleSaveDeliverable(e, sponsorId, campaignId) {
    e.preventDefault();
    const sponsor = sponsors.find(s => s.id === sponsorId);
    if (editingDeliverable) {
      // Update existing deliverable
      const deliverable = sponsor?.sponsor_deliverables?.find(d => d.id === editingDeliverable);
      const { error } = await supabase.from('sponsor_deliverables').update({
        title: deliverableTitle,
        deliverable_type: deliverableType,
        due_date: dueDate || null,
        notes: deliverableNotes || null,
        platforms: deliverablePlatforms,
        needs_review: deliverableNeedsReview,
        campaign_id: campaignId || deliverableCampaignId || null,
        pay: deliverablePay ? parseFloat(deliverablePay) : null,
        beat_sheet_id: deliverableBeatSheetId || null,
        video_event_id: deliverableVideoEventId || null,
        channel: deliverableChannel || null,
        updated_at: new Date().toISOString(),
      }).eq('id', editingDeliverable);
      if (error) { alert('Error updating deliverable: ' + error.message); return; }

      // Sync calendar event
      if (dueDate && deliverable?.calendar_event_id) {
        // Update existing event
        await supabase.from('calendar_events').update({
          title: `🤝 ${sponsor?.name}: ${deliverableTitle}`,
          start_date: `${dueDate}T09:00:00`,
          end_date: `${dueDate}T10:00:00`,
        }).eq('id', deliverable.calendar_event_id);
      } else if (dueDate && !deliverable?.calendar_event_id) {
        // Create new event
        const { data: evData } = await supabase.from('calendar_events').insert({
          title: `🤝 ${sponsor?.name}: ${deliverableTitle}`,
          event_type: 'sponsor',
          start_date: `${dueDate}T09:00:00`,
          end_date: `${dueDate}T10:00:00`,
          all_day: true,
          created_by: profile.id,
        }).select().single();
        if (evData) {
          await supabase.from('sponsor_deliverables').update({ calendar_event_id: evData.id }).eq('id', editingDeliverable);
        }
      } else if (!dueDate && deliverable?.calendar_event_id) {
        // Remove event
        await supabase.from('calendar_events').delete().eq('id', deliverable.calendar_event_id);
        await supabase.from('sponsor_deliverables').update({ calendar_event_id: null }).eq('id', editingDeliverable);
      }
    } else {
      // Insert new deliverable
      const { data: dData, error } = await supabase.from('sponsor_deliverables').insert({
        sponsor_id: sponsorId,
        title: deliverableTitle,
        deliverable_type: deliverableType,
        due_date: dueDate || null,
        notes: deliverableNotes || null,
        platforms: deliverablePlatforms,
        needs_review: deliverableNeedsReview,
        campaign_id: campaignId || null,
        pay: deliverablePay ? parseFloat(deliverablePay) : null,
        beat_sheet_id: deliverableBeatSheetId || null,
        video_event_id: deliverableVideoEventId || null,
        channel: deliverableChannel || null,
      }).select().single();
      if (error) { alert('Error creating deliverable: ' + error.message); return; }

      // Auto-create calendar event if due_date set
      if (dueDate && dData) {
        const { data: evData } = await supabase.from('calendar_events').insert({
          title: `🤝 ${sponsor?.name}: ${deliverableTitle}`,
          event_type: 'sponsor',
          start_date: `${dueDate}T09:00:00`,
          end_date: `${dueDate}T10:00:00`,
          all_day: true,
          created_by: profile.id,
        }).select().single();
        if (evData) {
          await supabase.from('sponsor_deliverables').update({ calendar_event_id: evData.id }).eq('id', dData.id);
        }
      }
    }

    // Auto-create beat in linked beat sheet
    if (deliverableBeatSheetId && deliverableNotes) {
      try {
        const { data: sheet } = await supabase
          .from('beat_sheets')
          .select('beats')
          .eq('id', deliverableBeatSheetId)
          .single();
        if (sheet) {
          const existingBeats = sheet.beats || [];
          const newBeat = {
            id: crypto.randomUUID(),
            title: 'Ad Read\n\n' + deliverableNotes,
            context: '',
            graphics: [],
            videos: [],
          };
          await supabase.from('beat_sheets').update({
            beats: [...existingBeats, newBeat],
            updated_at: new Date().toISOString(),
          }).eq('id', deliverableBeatSheetId);
        }
      } catch (err) {
        console.error('Error auto-creating beat:', err);
      }
    }

    const syncCampId = campaignId || deliverableCampaignId;
    if (syncCampId) await syncCampaignRevenue(syncCampId);

    resetDeliverableForm();
    fetchSponsors();
  }

  async function handleDeleteDeliverable(deliverable) {
    if (deliverable.calendar_event_id) {
      await supabase.from('calendar_events').delete().eq('id', deliverable.calendar_event_id);
    }
    await supabase.from('sponsor_deliverables').delete().eq('id', deliverable.id);
    if (deliverable.campaign_id) await syncCampaignRevenue(deliverable.campaign_id);
    fetchSponsors();
  }

  async function handleToggleDelivered(deliverableId, currentValue) {
    const newValue = !currentValue;
    await supabase.from('sponsor_deliverables').update({
      delivered: newValue,
      updated_at: new Date().toISOString(),
    }).eq('id', deliverableId);
    fetchSponsors();
  }

  // Campaign CRUD
  function resetCampaignForm() {
    setCampaignForm({ name: '', description: '', start_date: '', end_date: '', contact_name: '', contact_email: '', payment_status: 'unpaid' });
    setBriefFile(null);
    setBriefMode('upload');
    setBriefLinkUrl('');
    setBriefLinkLabel('');
    setEditingCampaign(null); setShowCampaignForm(null);
  }

  async function handleSaveCampaign(e, sponsorId) {
    e.preventDefault();
    const payload = {
      sponsor_id: sponsorId,
      name: campaignForm.name,
      description: campaignForm.description || null,
      start_date: campaignForm.start_date || null,
      end_date: campaignForm.end_date || null,
      contact_name: campaignForm.contact_name || null,
      contact_email: campaignForm.contact_email || null,
      payment_status: campaignForm.payment_status || 'unpaid',
      updated_at: new Date().toISOString(),
    };
    let campaignId = editingCampaign;
    if (editingCampaign) {
      const { error } = await supabase.from('sponsor_campaigns').update(payload).eq('id', editingCampaign);
      if (error) { alert('Error updating campaign: ' + error.message); return; }
    } else {
      const { data, error } = await supabase.from('sponsor_campaigns').insert(payload).select().single();
      if (error) { alert('Error creating campaign: ' + error.message); return; }
      campaignId = data.id;
    }
    // Save brief: upload file or set link
    if (campaignId) {
      if (briefMode === 'upload' && briefFile) {
        const filePath = `${campaignId}/${Date.now()}_${briefFile.name}`;
        const { error: uploadError } = await supabase.storage.from('campaign-briefs').upload(filePath, briefFile);
        if (uploadError) { alert('Brief upload failed: ' + uploadError.message); } else {
          const { data: urlData } = supabase.storage.from('campaign-briefs').getPublicUrl(filePath);
          await supabase.from('sponsor_campaigns').update({ brief_url: urlData.publicUrl, brief_name: briefFile.name }).eq('id', campaignId);
        }
      } else if (briefMode === 'link' && briefLinkUrl.trim()) {
        const url = briefLinkUrl.trim();
        let label = briefLinkLabel.trim();
        if (!label) {
          try { label = new URL(url).hostname.replace(/^www\./, ''); } catch { label = 'Brief'; }
        }
        await supabase.from('sponsor_campaigns').update({ brief_url: url, brief_name: label }).eq('id', campaignId);
      }
    }
    await syncCampaignRevenue(campaignId);

    resetCampaignForm();
    fetchSponsors();
  }

  async function syncCampaignRevenue(campaignId) {
    if (!campaignId) return;
    const revenueKey = `sponsor_campaign_${campaignId}`;
    const { data: campaign } = await supabase
      .from('sponsor_campaigns')
      .select('id, sponsor_id, payment_status, end_date')
      .eq('id', campaignId)
      .single();
    if (!campaign) {
      await supabase.from('revenue_events').delete().eq('stripe_event_id', revenueKey);
      return;
    }
    const { data: dels } = await supabase
      .from('sponsor_deliverables')
      .select('pay')
      .eq('campaign_id', campaignId);
    const totalPay = (dels || []).reduce((sum, d) => sum + (parseFloat(d.pay) || 0), 0);
    if (campaign.payment_status === 'paid' && totalPay > 0) {
      const amountCents = Math.round(totalPay * 100);
      await supabase.from('revenue_events').upsert({
        stripe_event_id: revenueKey,
        event_type: 'sponsorship',
        amount_cents: amountCents,
        net_amount_cents: amountCents,
        product_category: 'sponsorship',
        occurred_at: campaign.end_date || new Date().toISOString(),
        platform_account_id: null,
        metadata: { source: 'sponsor_campaign', campaign_id: campaignId, sponsor_id: campaign.sponsor_id },
      }, { onConflict: 'stripe_event_id' });
    } else {
      await supabase.from('revenue_events').delete().eq('stripe_event_id', revenueKey);
    }
  }

  async function handleRemoveBrief(campaignId, briefUrl) {
    if (!(await confirm('Remove this brief file?'))) return;
    // Extract storage path from URL
    const pathMatch = briefUrl.match(/campaign-briefs\/(.+)$/);
    if (pathMatch) {
      await supabase.storage.from('campaign-briefs').remove([decodeURIComponent(pathMatch[1])]);
    }
    await supabase.from('sponsor_campaigns').update({ brief_url: null, brief_name: null }).eq('id', campaignId);
    fetchSponsors();
  }

  async function handleDeleteCampaign(campaignId) {
    if (!(await confirm('Delete this campaign? Deliverables will be uncampaigned.'))) return;
    await supabase.from('sponsor_campaigns').delete().eq('id', campaignId);
    fetchSponsors();
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

  async function onDragEnd(result) {
    if (!result.destination) return;
    const { draggableId, source, destination } = result;
    const srcStatus = source.droppableId.includes(':') ? source.droppableId.split(':')[1] : source.droppableId;
    const destStatus = destination.droppableId.includes(':') ? destination.droppableId.split(':')[1] : destination.droppableId;
    const board = source.droppableId.includes(':') ? source.droppableId.split(':')[0] : 'creative';
    const isSameColumn = srcStatus === destStatus;
    if (isSameColumn && source.index === destination.index) return;

    const project = projects.find(p => p.id === draggableId);
    if (!project) return;

    const boardProjects = board === 'business' ? businessBoardProjects : creativeBoardProjects;
    const colSort = (a, b) => {
      const d = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      return d !== 0 ? d : new Date(a.created_at) - new Date(b.created_at);
    };

    if (isSameColumn) {
      const col = boardProjects.filter(p => p.status === srcStatus).sort(colSort);
      const reordered = Array.from(col);
      const [moved] = reordered.splice(source.index, 1);
      reordered.splice(destination.index, 0, moved);
      const updates = reordered.map((p, i) => ({ id: p.id, sort_order: (i + 1) * 10 }));
      // Optimistic update
      setProjects(prev => prev.map(p => {
        const u = updates.find(u => u.id === p.id);
        return u ? { ...p, sort_order: u.sort_order } : p;
      }));
      await Promise.all(updates.map(u =>
        supabase.from('projects').update({ sort_order: u.sort_order }).eq('id', u.id)
      ));
    } else {
      const destCol = boardProjects
        .filter(p => p.status === destStatus && p.id !== draggableId)
        .sort(colSort);
      const inserted = Array.from(destCol);
      inserted.splice(destination.index, 0, { id: draggableId, sort_order: 0 });
      const updates = inserted.map((p, i) => ({ id: p.id, sort_order: (i + 1) * 10 }));
      const newSortOrder = updates.find(u => u.id === draggableId)?.sort_order ?? (destination.index + 1) * 10;
      // Optimistic update
      setProjects(prev => prev.map(p => {
        if (p.id === draggableId) return { ...p, status: destStatus, sort_order: newSortOrder };
        const u = updates.find(u => u.id === p.id);
        return u ? { ...p, sort_order: u.sort_order } : p;
      }));
      await supabase.from('projects').update({ status: destStatus, sort_order: newSortOrder }).eq('id', draggableId);
      await Promise.all(updates.filter(u => u.id !== draggableId).map(u =>
        supabase.from('projects').update({ sort_order: u.sort_order }).eq('id', u.id)
      ));
      // Notifications
      if (project.project_assignments?.length) {
        const notifs = project.project_assignments
          .filter(a => a.user_id !== profile.id)
          .map(a => ({
            user_id: a.user_id, type: 'status_change',
            title: `${project.name} moved to ${STATUS_LABELS[destStatus]}`,
            body: `${profile.full_name} changed the status`,
            link_tab: 'projects', link_target: project.id,
          }));
        if (notifs.length) await supabase.from('notifications').insert(notifs);
      }
    }
  }

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Categorize projects into sections
  const searchFilter = (p) => !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase());
  const statusFilter = (p) => filterStatus === 'all' || p.status === filterStatus;

  // Creative projects only for the list-view sections. A project is "current"
  // as long as it has a deadline (start date is optional).
  const creativeActive = projects.filter(p => (p.category || 'creative') === 'creative' && !p.is_archived && p.status !== 'published');
  const currentProjects = creativeActive.filter(p =>
    p.deadline && searchFilter(p) && statusFilter(p)
  );
  const comingUpProjects = creativeActive.filter(p =>
    !p.deadline && searchFilter(p) && statusFilter(p)
  );
  const completedProjects = projects.filter(p => {
    if (p.is_archived || p.status !== 'published') return false;
    // Published within last 7 days (use updated_at as proxy for when it was published)
    const publishedDate = new Date(p.updated_at);
    return publishedDate >= sevenDaysAgo && searchFilter(p);
  });
  const archivedProjects = projects.filter(p => {
    if (p.is_archived) return true;
    if (p.status !== 'published') return false;
    const publishedDate = new Date(p.updated_at);
    return publishedDate < sevenDaysAgo;
  }).filter(searchFilter);

  // Kanban board datasets (separated by category)
  const creativeBoardProjects = projects.filter(p =>
    (p.category || 'creative') === 'creative' && !p.is_archived
    && searchFilter(p) && statusFilter(p)
  );
  const businessBoardProjects = projects.filter(p =>
    p.category === 'business' && !p.is_archived && searchFilter(p)
  );
  const archivedCount = archivedProjects.length;

  const editingCount = shorts.filter(s => s.stage === 'editing').length;
  const readyCount = shorts.filter(s => s.stage === 'ready_to_post').length;
  const activeSponsorsCount = sponsors.filter(s => {
    const dels = s.sponsor_deliverables || [];
    return dels.length === 0 || dels.some(d => !d.delivered);
  }).length;
  const pendingProposals = proposals.filter(p => p.status === 'pending');
  const resolvedProposals = proposals.filter(p => p.status !== 'pending');
  const activeMaydayCount = maydayVideos.filter(v => v.stage !== 'complete').length;

  function renderDeliverableRow(d, sponsor) {
    return (
      <div key={d.id} style={styles.deliverableRow}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, flexWrap: 'wrap' }}>
          <button
            onClick={(e) => { e.stopPropagation(); handleToggleDelivered(d.id, d.delivered); }}
            style={{
              padding: '3px 10px', borderRadius: '6px', border: 'none', cursor: 'pointer',
              fontSize: '11px', fontWeight: 600, fontFamily: 'inherit', transition: 'all 0.15s',
              background: d.delivered ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)',
              color: d.delivered ? '#86efac' : 'rgba(255,255,255,0.7)',
            }}
          >
            {d.delivered ? 'Delivered' : 'Open'}
          </button>
          <span style={{ fontSize: '14px', flexShrink: 0 }}>{DELIVERABLE_TYPES[d.deliverable_type]?.icon || '📋'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', color: d.delivered ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.85)', textDecoration: d.delivered ? 'line-through' : 'none' }}>
              {d.title}
            </div>
          </div>
          {d.channel && CHANNEL_COLORS[d.channel] && (
            <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 5px', borderRadius: '4px', background: CHANNEL_COLORS[d.channel].bg, color: CHANNEL_COLORS[d.channel].color }}>
              {CHANNEL_COLORS[d.channel].label}
            </span>
          )}
          {(d.platforms || []).map(p => (
            <span key={p} style={{ fontSize: '9px', fontWeight: 600, padding: '2px 5px', borderRadius: '4px', background: 'rgba(99,102,241,0.12)', color: '#a5b4fc' }}>{p}</span>
          ))}
          {d.needs_review && (
            <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 5px', borderRadius: '4px', background: 'rgba(236,72,153,0.15)', color: '#f9a8d4', textTransform: 'uppercase', letterSpacing: '0.3px' }}>REVIEW</span>
          )}
          {d.due_date && (
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>
              {new Date(d.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
          {d.video_event_id && (() => {
            const ev = videoEvents.find(e => e.id === d.video_event_id);
            return ev ? (
              <span style={{ fontSize: '9px', fontWeight: 600, padding: '2px 5px', borderRadius: '4px',
                background: 'rgba(168,85,247,0.12)', color: '#c084fc' }}>
                {'\uD83D\uDCF9'} {new Date(ev.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — {ev.title}
              </span>
            ) : null;
          })()}
          <button onClick={() => startEditDeliverable(d)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: '12px', padding: '2px 4px' }} title="Edit">✎</button>
          <button onClick={() => handleDeleteDeliverable(d)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: '12px', padding: '2px 4px' }} title="Delete">✕</button>
        </div>
      </div>
    );
  }

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
          onClick={() => setActiveSection('mayday')}
          style={{
            ...styles.sectionTab,
            ...(activeSection === 'mayday' ? styles.sectionTabActive : {}),
          }}
        >
          Mayday
          {activeMaydayCount > 0 && (
            <span style={styles.sectionTabBadge}>{activeMaydayCount}</span>
          )}
        </button>
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
        <button
          onClick={() => setActiveSection('sponsors')}
          style={{
            ...styles.sectionTab,
            ...(activeSection === 'sponsors' ? styles.sectionTabActive : {}),
          }}
        >
          Deliverables
          {activeSponsorsCount > 0 && (
            <span style={styles.sectionTabBadge}>{activeSponsorsCount}</span>
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
              <label style={styles.label}>Category *</label>
              <select
                value={form.category}
                onChange={(e) => {
                  const nextCategory = e.target.value;
                  const nextTypes = nextCategory === 'business' ? BUSINESS_PROJECT_TYPES : PROJECT_TYPES;
                  const nextStatuses = nextCategory === 'business' ? BUSINESS_STATUSES : STATUSES;
                  setForm({
                    ...form,
                    category: nextCategory,
                    type: nextTypes[0].value,
                    status: nextStatuses[0],
                    channel: nextCategory === 'business' ? '' : form.channel,
                  });
                }}
                style={styles.select}
              >
                <option value="creative">Creative</option>
                <option value="business">Business</option>
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Type *</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                style={styles.select}
              >
                {(form.category === 'business' ? BUSINESS_PROJECT_TYPES : PROJECT_TYPES).map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            {form.category === 'creative' && (
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
            )}
            <div style={styles.field}>
              <label style={styles.label}>Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                style={styles.select}
              >
                {form.category === 'business'
                  ? BUSINESS_STATUSES.map(s => (
                      <option key={s} value={s}>{BUSINESS_STATUS_LABELS[s]}</option>
                    ))
                  : STATUSES.map(s => (
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
          {form.category === 'creative' && (
            <>
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
            </>
          )}
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
        <>
        <DragDropContext onDragEnd={onDragEnd}>
          {/* Creative Board */}
          <h2 style={{ ...styles.sectionHeading, marginTop: 0 }}>Creative</h2>
          <div style={styles.boardContainer}>
            {STATUSES.map(status => {
              const columnProjects = creativeBoardProjects
                .filter(p => p.status === status)
                .sort((a, b) => {
                  const d = (a.sort_order ?? 0) - (b.sort_order ?? 0);
                  return d !== 0 ? d : new Date(a.created_at) - new Date(b.created_at);
                });
              return (
                <Droppable droppableId={`creative:${status}`} key={`creative:${status}`}>
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
                                onClick={() => setSelectedProject(project.id)}
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
                        <button onClick={() => openFormWithPreset('creative', status)} style={styles.columnAddBtn}>+ Add</button>
                      </div>
                    </div>
                  )}
                </Droppable>
              );
            })}
          </div>

          {/* Business Board */}
          <h2 style={{ ...styles.sectionHeading, marginTop: '32px' }}>Business</h2>
          <div style={styles.boardContainer}>
            {BUSINESS_STATUSES.map(status => {
              const columnProjects = businessBoardProjects
                .filter(p => p.status === status)
                .sort((a, b) => {
                  const d = (a.sort_order ?? 0) - (b.sort_order ?? 0);
                  return d !== 0 ? d : new Date(a.created_at) - new Date(b.created_at);
                });
              return (
                <Droppable droppableId={`business:${status}`} key={`business:${status}`}>
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
                        <div style={{ ...styles.boardColumnDot, background: BUSINESS_STATUS_COLORS[status] }} />
                        <span style={{ ...styles.boardColumnTitle, color: BUSINESS_STATUS_COLORS[status] }}>{BUSINESS_STATUS_LABELS[status]}</span>
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
                                onClick={() => setSelectedProject(project.id)}
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
                        <button onClick={() => openFormWithPreset('business', status)} style={styles.columnAddBtn}>+ Add</button>
                      </div>
                    </div>
                  )}
                </Droppable>
              );
            })}
          </div>
        </DragDropContext>

        {/* Project details modal (board view) */}
        {selectedProject && (() => {
          const proj = projects.find(p => p.id === selectedProject);
          if (!proj) return null;
          return (
            <div style={styles.modalOverlay} onClick={() => setSelectedProject(null)}>
              <div style={styles.projectModalContent} onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setSelectedProject(null)}
                  style={styles.projectModalClose}
                  title="Close"
                  aria-label="Close"
                >✕</button>
                <ProjectRow
                  project={proj} teamMembers={teamMembers} profile={profile}
                  isSelected={true} onToggle={() => setSelectedProject(null)}
                  onStatusChange={handleStatusChange} onAssign={handleAssign} onRemoveAssignment={handleRemoveAssignment}
                  onAddAttachment={handleAddAttachment} onRemoveAttachment={handleRemoveAttachment} onAddComment={handleAddComment}
                  onDeleteComment={handleDeleteComment} onDeleteProject={(id) => { handleDeleteProject(id); setSelectedProject(null); }} onArchiveProject={(id) => { handleArchiveProject(id); setSelectedProject(null); }}
                  onUnarchiveProject={handleUnarchiveProject} onNavigate={onNavigate}
                  isAdmin={isAdmin} onAddChecklistItem={handleAddChecklistItem} onToggleChecklistItem={handleToggleChecklistItem}
                  onDeleteChecklistItem={handleDeleteChecklistItem} onAssignProjectStage={handleAssignProjectStage}
                  onRemoveProjectStageAssignment={handleRemoveProjectStageAssignment} onUpdateProject={handleUpdateProject}
                  linkedFieldData={{ writeDocs, beatSheets, adReadDeliverables }}
                />
              </div>
            </div>
          );
        })()}
        </>
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

      {activeSection === 'mayday' && (
      /* ====== MAYDAY VIDEOS SECTION ====== */
      <>
      <div style={styles.topBar}>
        <div>
          <h1 style={styles.pageTitle}>Mayday Videos</h1>
          <p style={styles.pageSubtitle}>
            {activeMaydayCount} active · {maydayVideos.filter(v => v.stage === 'complete').length} complete
          </p>
        </div>
        <button onClick={() => setShowMaydayForm(!showMaydayForm)} style={styles.addBtn}>
          {showMaydayForm ? '✕ Cancel' : '+ Add Video'}
        </button>
      </div>

      {showMaydayForm && (
        <form onSubmit={handleCreateMayday} style={styles.formCard}>
          <div style={styles.formGrid}>
            <div style={styles.field}>
              <label style={styles.label}>Title *</label>
              <input
                value={maydayForm.title}
                onChange={(e) => setMaydayForm({ ...maydayForm, title: e.target.value })}
                placeholder="e.g. Behind the scenes at spring training"
                required
                style={styles.input}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Segment</label>
              <select
                value={maydayForm.segment}
                onChange={(e) => setMaydayForm({ ...maydayForm, segment: e.target.value })}
                style={styles.select}
              >
                <option value="">None</option>
                {MAYDAY_SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Post Date</label>
              <input
                type="date"
                value={maydayForm.post_date}
                onChange={(e) => setMaydayForm({ ...maydayForm, post_date: e.target.value })}
                style={styles.input}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Write Doc</label>
              <select
                value={maydayForm.write_doc_id}
                onChange={(e) => {
                  const doc = writeDocs.find(d => d.id === e.target.value);
                  setMaydayForm({ ...maydayForm, write_doc_id: e.target.value, write_doc_name: doc?.name || '' });
                }}
                style={styles.select}
              >
                <option value="">None</option>
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
                value={maydayForm.beat_sheet_id}
                onChange={(e) => setMaydayForm({ ...maydayForm, beat_sheet_id: e.target.value })}
                style={styles.select}
              >
                <option value="">None</option>
                {beatSheets.map(bs => (
                  <option key={bs.id} value={bs.id}>{bs.title}</option>
                ))}
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Ad Read</label>
              <select
                value={maydayForm.ad_read_id}
                onChange={(e) => setMaydayForm({ ...maydayForm, ad_read_id: e.target.value })}
                style={styles.select}
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
          <button type="submit" style={styles.submitBtn}>Add Video</button>
        </form>
      )}

      {maydayLoading ? (
        <p style={styles.emptyText}>Loading videos...</p>
      ) : (
        <DragDropContext onDragEnd={onMaydayDragEnd}>
          <div style={styles.shortsBoardContainer}>
            {MAYDAY_STAGES.map(stage => {
              const stageVideos = maydayVideos.filter(v => v.stage === stage).sort((a, b) => a.sort_order - b.sort_order);
              return (
                <Droppable droppableId={stage} key={stage}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      style={{
                        ...styles.shortsColumn,
                        background: snapshot.isDraggingOver
                          ? `${MAYDAY_STAGE_COLORS[stage]}08`
                          : 'rgba(255,255,255,0.02)',
                        minWidth: '180px',
                      }}
                    >
                      <div style={styles.shortsColumnHeader}>
                        <div style={{ ...styles.boardColumnDot, background: MAYDAY_STAGE_COLORS[stage] }} />
                        <span style={{ ...styles.boardColumnTitle, color: MAYDAY_STAGE_COLORS[stage], fontSize: '11px' }}>
                          {MAYDAY_STAGE_LABELS[stage]}
                        </span>
                        <span style={styles.boardColumnCount}>{stageVideos.length}</span>
                      </div>
                      <div style={styles.boardColumnBody}>
                        {stageVideos.map((video, index) => (
                          <Draggable key={video.id} draggableId={video.id} index={index}>
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
                                <MaydayCard
                                  video={video}
                                  reads={reads}
                                  onUpdate={(updates) => handleUpdateMayday(video.id, updates)}
                                  onDelete={() => handleDeleteMayday(video.id)}
                                  isEditing={editingMayday === video.id}
                                  onToggleEdit={() => setEditingMayday(editingMayday === video.id ? null : video.id)}
                                  linkedFieldData={{ writeDocs, beatSheets, adReadDeliverables }}
                                />
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                        {stageVideos.length === 0 && (
                          <div style={styles.shortsEmptyColumn}>
                            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.2)', margin: 0 }}>
                              No videos
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

      {activeSection === 'sponsors' && (
      /* ====== SPONSORS SECTION ====== */
      <>
      {/* ── Proposals ── */}
      <div style={{ padding: '0 24px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>Proposals</h2>
            {pendingProposals.length > 0 && (
              <span style={{ background: '#ef4444', color: '#fff', borderRadius: '10px', padding: '1px 7px', fontSize: '12px', fontWeight: 600 }}>
                {pendingProposals.length}
              </span>
            )}
          </div>
          <button
            onClick={() => setShowProposalForm(v => !v)}
            style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}
          >
            {showProposalForm ? 'Cancel' : '+ New Proposal'}
          </button>
        </div>

        {/* Proposal form */}
        {showProposalForm && (
          <form onSubmit={handleCreateProposal} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '16px', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <input
              value={proposalForm.sponsor_name}
              onChange={e => setProposalForm(f => ({ ...f, sponsor_name: e.target.value }))}
              placeholder="Sponsor Name *"
              required
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '13px' }}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
              <input
                value={proposalForm.timeframe}
                onChange={e => setProposalForm(f => ({ ...f, timeframe: e.target.value }))}
                placeholder="Time Frame"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '13px' }}
              />
              <input
                type="number"
                value={proposalForm.num_videos}
                onChange={e => setProposalForm(f => ({ ...f, num_videos: e.target.value }))}
                placeholder="# of Videos"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '13px' }}
              />
              <input
                type="number"
                value={proposalForm.pay}
                onChange={e => setProposalForm(f => ({ ...f, pay: e.target.value }))}
                placeholder="Pay ($)"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '13px' }}
              />
            </div>
            <textarea
              value={proposalForm.description}
              onChange={e => setProposalForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Description / notes"
              rows={2}
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '13px', resize: 'vertical' }}
            />
            <button type="submit" style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 14px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' }}>
              Submit Proposal
            </button>
          </form>
        )}

        {/* Pending proposals */}
        {proposalsLoading && pendingProposals.length === 0 ? (
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px' }}>Loading...</p>
        ) : pendingProposals.length === 0 ? (
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px', margin: '4px 0' }}>No pending proposals</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px', marginBottom: '8px' }}>
            {pendingProposals.map(p => (
              <div key={p.id} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '14px', borderLeft: '3px solid #f59e0b' }}>
                <div style={{ fontWeight: 600, fontSize: '14px', color: '#fff', marginBottom: '6px' }}>{p.sponsor_name}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginBottom: '6px' }}>
                  {p.timeframe && <span>{p.timeframe}</span>}
                  {p.num_videos && <span>{p.num_videos} video{p.num_videos !== 1 ? 's' : ''}</span>}
                  {p.pay && <span style={{ color: '#22c55e' }}>${Number(p.pay).toLocaleString()}</span>}
                </div>
                {p.description && <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>{p.description}</div>}
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginBottom: '10px' }}>
                  Proposed by {p.creator?.full_name || 'Unknown'} · {new Date(p.created_at).toLocaleDateString()}
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => handleConfirmProposal(p)}
                    style={{ background: '#22c55e', color: '#fff', border: 'none', borderRadius: '5px', padding: '5px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => handleDeclineProposal(p.id)}
                    style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: '5px', padding: '5px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Resolved proposals */}
        {resolvedProposals.length > 0 && (
          <details style={{ marginTop: '4px' }}>
            <summary style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', cursor: 'pointer', userSelect: 'none' }}>
              {resolvedProposals.length} resolved proposal{resolvedProposals.length !== 1 ? 's' : ''}
            </summary>
            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {resolvedProposals.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'rgba(255,255,255,0.5)', padding: '4px 0' }}>
                  <span style={{
                    background: p.status === 'accepted' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                    color: p.status === 'accepted' ? '#22c55e' : '#ef4444',
                    borderRadius: '4px', padding: '1px 6px', fontSize: '11px', fontWeight: 600,
                  }}>
                    {p.status}
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.7)' }}>{p.sponsor_name}</span>
                  {p.pay && <span style={{ color: 'rgba(255,255,255,0.4)' }}>${Number(p.pay).toLocaleString()}</span>}
                  <span style={{ color: 'rgba(255,255,255,0.3)' }}>{new Date(p.created_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
      <div style={styles.topBar}>
        <div>
          <h1 style={styles.pageTitle}>Sponsors</h1>
          <p style={styles.pageSubtitle}>
            {activeSponsorsCount} active · {sponsors.length - activeSponsorsCount} inactive
          </p>
        </div>
        <button onClick={() => { resetSponsorForm(); setShowSponsorForm(!showSponsorForm); }} style={styles.addBtn}>
          {showSponsorForm && !editingSponsor ? '✕ Cancel' : '+ New Sponsor'}
        </button>
      </div>
      {/* Sponsor Form */}
      {showSponsorForm && (
        <form onSubmit={handleSaveSponsor} style={styles.formCard}>
          <div style={styles.formGrid}>
            <div style={styles.field}>
              <label style={styles.label}>Sponsor Name *</label>
              <input value={sponsorName} onChange={e => setSponsorName(e.target.value)} placeholder="e.g. NordVPN" required style={styles.input} />
            </div>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Notes</label>
            <textarea value={sponsorNotes} onChange={e => setSponsorNotes(e.target.value)} placeholder="Deal details, talking points..." rows={3} style={{ ...styles.input, resize: 'vertical' }} />
          </div>
          <button type="submit" style={styles.submitBtn}>{editingSponsor ? 'Update Sponsor' : 'Create Sponsor'}</button>
        </form>
      )}

      {/* Sponsor List */}
      {sponsorLoading ? (
        <p style={styles.emptyText}>Loading sponsors...</p>
      ) : sponsors.length === 0 ? (
        <div style={styles.emptyCard}>
          <p style={styles.emptyText}>No sponsors yet. Add one to get started.</p>
        </div>
      ) : (
        <div style={styles.projectList}>
          {[...sponsors].sort((a, b) => {
              const aActive = (a.sponsor_deliverables || []).length === 0 || (a.sponsor_deliverables || []).some(d => !d.delivered);
              const bActive = (b.sponsor_deliverables || []).length === 0 || (b.sponsor_deliverables || []).some(d => !d.delivered);
              if (aActive && !bActive) return -1;
              if (!aActive && bActive) return 1;
              return new Date(b.created_at) - new Date(a.created_at);
            }).map(sponsor => {
              const isExpanded = expandedSponsorId === sponsor.id;
              const deliverables = sponsor.sponsor_deliverables || [];
              const campaigns = sponsor.sponsor_campaigns || [];
              const isActive = deliverables.length === 0 || deliverables.some(d => !d.delivered);
              const deliveredCount = deliverables.filter(d => d.delivered).length;
              return (
                <div key={sponsor.id} style={styles.sponsorCard}>
                  <div style={styles.sponsorCardHeader} onClick={() => setExpandedSponsorId(isExpanded ? null : sponsor.id)}>
                    <div style={styles.projectRowLeft}>
                      <div>
                        <div style={styles.projectRowName}>{sponsor.name}</div>
                        <div style={styles.projectRowMeta}>
                          {campaigns.length > 0 ? `${campaigns.length} campaign${campaigns.length > 1 ? 's' : ''}` : 'No campaigns'}
                        </div>
                      </div>
                    </div>
                    <div style={styles.projectRowRight}>
                      <span style={{ ...styles.statusTag, background: isActive ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)', color: isActive ? '#10b981' : 'rgba(255,255,255,0.4)' }}>
                        {isActive ? 'Active' : 'Inactive'}
                      </span>
                      {deliverables.length > 0 && (
                        <span style={styles.checklistBadge}>{deliveredCount}/{deliverables.length}</span>
                      )}
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="rgba(255,255,255,0.3)"
                        style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>
                        <path d="M4 6l4 4 4-4" />
                      </svg>
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={styles.projectDetail}>
                      {sponsor.notes && (
                        <div style={styles.detailSection}>
                          <h4 style={styles.detailLabel}>Notes</h4>
                          <p style={{ margin: 0, fontSize: '13px', color: 'rgba(255,255,255,0.6)', whiteSpace: 'pre-wrap' }}>{sponsor.notes}</p>
                        </div>
                      )}

                      {/* Campaigns */}
                      <div style={styles.detailSection}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <h4 style={styles.detailLabel}>Campaigns</h4>
                          <button
                            onClick={(e) => { e.stopPropagation(); resetCampaignForm(); setShowCampaignForm(showCampaignForm === sponsor.id ? null : sponsor.id); }}
                            style={{ background: 'none', border: 'none', color: '#a5b4fc', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
                          >
                            {showCampaignForm === sponsor.id && !editingCampaign ? '✕ Cancel' : '+ Add Campaign'}
                          </button>
                        </div>

                        {showCampaignForm === sponsor.id && (
                          <form onSubmit={(e) => handleSaveCampaign(e, sponsor.id)} style={{ ...styles.formCard, marginBottom: '12px' }}>
                            <div style={styles.formGrid}>
                              <div style={styles.field}>
                                <label style={styles.label}>Campaign Name *</label>
                                <input value={campaignForm.name} onChange={e => setCampaignForm({ ...campaignForm, name: e.target.value })} placeholder="e.g. Q1 Launch" required style={styles.input} />
                              </div>
                              <div style={styles.field}>
                                <label style={styles.label}>Start Date</label>
                                <input type="date" value={campaignForm.start_date} onChange={e => setCampaignForm({ ...campaignForm, start_date: e.target.value })} style={styles.input} />
                              </div>
                              <div style={styles.field}>
                                <label style={styles.label}>End Date</label>
                                <input type="date" value={campaignForm.end_date} onChange={e => setCampaignForm({ ...campaignForm, end_date: e.target.value })} style={styles.input} />
                              </div>
                              <div style={styles.field}>
                                <label style={styles.label}>Contact Name</label>
                                <input value={campaignForm.contact_name} onChange={e => setCampaignForm({ ...campaignForm, contact_name: e.target.value })} placeholder="e.g. John Smith" style={styles.input} />
                              </div>
                              <div style={styles.field}>
                                <label style={styles.label}>Contact Email</label>
                                <input value={campaignForm.contact_email} onChange={e => setCampaignForm({ ...campaignForm, contact_email: e.target.value })} placeholder="john@sponsor.com" type="email" style={styles.input} />
                              </div>
                              {isAdmin && (
                                <div style={styles.field}>
                                  <label style={styles.label}>Payment Status</label>
                                  <select value={campaignForm.payment_status} onChange={e => setCampaignForm({ ...campaignForm, payment_status: e.target.value })} style={styles.select}>
                                    <option value="unpaid">Unpaid</option>
                                    <option value="partial">Partial</option>
                                    <option value="paid">Paid</option>
                                  </select>
                                </div>
                              )}
                              <div style={styles.field}>
                                <label style={styles.label}>Brief</label>
                                <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                                  {['upload', 'link'].map(m => (
                                    <button
                                      key={m}
                                      type="button"
                                      onClick={() => setBriefMode(m)}
                                      style={{
                                        flex: 1, padding: '4px 8px', borderRadius: '6px', border: '1px solid',
                                        fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                                        background: briefMode === m ? 'rgba(99,102,241,0.2)' : 'transparent',
                                        color: briefMode === m ? '#a5b4fc' : 'rgba(255,255,255,0.35)',
                                        borderColor: briefMode === m ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.08)',
                                        textTransform: 'capitalize',
                                      }}
                                    >{m}</button>
                                  ))}
                                </div>
                                {briefMode === 'upload' ? (
                                  <input type="file" accept=".pdf,.docx,.doc" onChange={e => setBriefFile(e.target.files[0] || null)} style={{ ...styles.input, padding: '6px 8px' }} />
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <input type="url" value={briefLinkUrl} onChange={e => setBriefLinkUrl(e.target.value)} placeholder="https://..." style={styles.input} />
                                    <input value={briefLinkLabel} onChange={e => setBriefLinkLabel(e.target.value)} placeholder="Label (optional)" style={styles.input} />
                                  </div>
                                )}
                              </div>
                            </div>
                            <div style={styles.field}>
                              <label style={styles.label}>Description</label>
                              <textarea value={campaignForm.description} onChange={e => setCampaignForm({ ...campaignForm, description: e.target.value })} placeholder="Campaign details..." rows={2} style={{ ...styles.input, resize: 'vertical' }} />
                            </div>
                            <button type="submit" style={styles.submitBtn}>{editingCampaign ? 'Update Campaign' : 'Create Campaign'}</button>
                          </form>
                        )}

                        {campaigns.length > 0 && campaigns.map(campaign => {
                          const campaignDels = deliverables.filter(d => d.campaign_id === campaign.id);
                          const allDeliveredCamp = campaignDels.length > 0 && campaignDels.every(d => d.delivered);
                          const campDeliveredCount = campaignDels.filter(d => d.delivered).length;
                          const campTotalPay = campaignDels.reduce((sum, d) => sum + (parseFloat(d.pay) || 0), 0);
                          return (
                            <div key={campaign.id} style={{ marginBottom: '8px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', padding: '10px 12px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', flex: 1 }}>{campaign.name}</span>
                                {campaign.start_date && campaign.end_date && (
                                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>
                                    {new Date(campaign.start_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(campaign.end_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  </span>
                                )}
                                {isAdmin && campTotalPay > 0 && (
                                  <span style={{ ...styles.paymentBadge, background: `${PAYMENT_STATUS_COLORS[campaign.payment_status]}15`, color: PAYMENT_STATUS_COLORS[campaign.payment_status] }}>
                                    ${campTotalPay.toLocaleString()}
                                  </span>
                                )}
                                {isAdmin && (
                                  <span style={{ ...styles.statusTag, background: `${PAYMENT_STATUS_COLORS[campaign.payment_status]}15`, color: PAYMENT_STATUS_COLORS[campaign.payment_status] }}>
                                    {campaign.payment_status}
                                  </span>
                                )}
                                <span style={{
                                  fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.3px',
                                  background: allDeliveredCamp ? 'rgba(34,197,94,0.15)' : 'rgba(99,102,241,0.15)',
                                  color: allDeliveredCamp ? '#86efac' : '#a5b4fc',
                                }}>
                                  {allDeliveredCamp ? 'Closed' : 'Open'}
                                </span>
                                {campaignDels.length > 0 && (
                                  <span style={styles.checklistBadge}>{campDeliveredCount}/{campaignDels.length}</span>
                                )}
                                <button onClick={() => { setCampaignForm({ name: campaign.name, description: campaign.description || '', start_date: campaign.start_date || '', end_date: campaign.end_date || '', contact_name: campaign.contact_name || '', contact_email: campaign.contact_email || '', payment_status: campaign.payment_status || 'unpaid' }); setEditingCampaign(campaign.id); setShowCampaignForm(sponsor.id); }} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: '12px', padding: '2px 4px' }} title="Edit">✎</button>
                                <button onClick={() => handleDeleteCampaign(campaign.id)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: '12px', padding: '2px 4px' }} title="Delete">✕</button>
                              </div>
                              {/* Campaign contact + brief info */}
                              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '6px', alignItems: 'center' }}>
                                {(campaign.contact_name || campaign.contact_email) && (
                                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
                                    {campaign.contact_name}{campaign.contact_email && ` (${campaign.contact_email})`}
                                  </span>
                                )}
                                {campaign.brief_url && (
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                    <a href={campaign.brief_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '11px', color: '#a5b4fc', textDecoration: 'none' }}>
                                      📄 {campaign.brief_name || 'Brief'}
                                    </a>
                                    <button onClick={() => handleRemoveBrief(campaign.id, campaign.brief_url)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: '10px', padding: '0 2px' }} title="Remove brief">✕</button>
                                  </span>
                                )}
                              </div>
                              {campaignDels.length > 0 && <div style={{ marginTop: '8px' }}>{campaignDels.map(d => renderDeliverableRow(d, sponsor))}</div>}
                              {/* Add Deliverable inside campaign */}
                              <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                                <button
                                  onClick={(e) => { e.stopPropagation(); resetDeliverableForm(); setDeliverableCampaignId(campaign.id); setShowDeliverableForm(showDeliverableForm === campaign.id ? null : campaign.id); }}
                                  style={{ background: 'none', border: 'none', color: '#a5b4fc', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
                                >
                                  {showDeliverableForm === campaign.id && !editingDeliverable ? '✕ Cancel' : '+ Add Deliverable'}
                                </button>
                              </div>
                              {showDeliverableForm === campaign.id && (
                                <form onSubmit={(e) => handleSaveDeliverable(e, sponsor.id, campaign.id)} style={{ ...styles.formCard, marginTop: '8px' }}>
                                  <div style={styles.formGrid}>
                                    <div style={styles.field}>
                                      <label style={styles.label}>Title *</label>
                                      <input value={deliverableTitle} onChange={e => setDeliverableTitle(e.target.value)} placeholder="e.g. Mid-roll integration" required style={styles.input} />
                                    </div>
                                    <div style={styles.field}>
                                      <label style={styles.label}>Type</label>
                                      <select value={deliverableType} onChange={e => setDeliverableType(e.target.value)} style={styles.select}>
                                        {Object.entries(DELIVERABLE_TYPES).map(([k, v]) => (
                                          <option key={k} value={k}>{v.icon} {v.label}</option>
                                        ))}
                                      </select>
                                    </div>
                                    <div style={styles.field}>
                                      <label style={styles.label}>Channel</label>
                                      <select value={deliverableChannel} onChange={e => setDeliverableChannel(e.target.value)} style={styles.select}>
                                        <option value="">— Select channel —</option>
                                        <option value="mayday">Mayday</option>
                                        <option value="tmb">Trevor May Baseball</option>
                                        <option value="socials">Socials</option>
                                      </select>
                                    </div>
                                    <div style={styles.field}>
                                      <label style={styles.label}>Due Date</label>
                                      <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={styles.input} />
                                    </div>
                                    <div style={styles.field}>
                                      <label style={styles.label}>Platforms</label>
                                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                        {DELIVERABLE_PLATFORMS.map(p => (
                                          <button key={p} type="button" onClick={() => setDeliverablePlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])} style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: deliverablePlatforms.includes(p) ? 'rgba(99,102,241,0.2)' : 'transparent', color: deliverablePlatforms.includes(p) ? '#a5b4fc' : 'rgba(255,255,255,0.35)', borderColor: deliverablePlatforms.includes(p) ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.08)' }}>{p}</button>
                                        ))}
                                      </div>
                                    </div>
                                    <div style={styles.field}>
                                      <label style={styles.label}>Needs Review</label>
                                      <select value={deliverableNeedsReview ? 'yes' : 'no'} onChange={e => setDeliverableNeedsReview(e.target.value === 'yes')} style={styles.select}>
                                        <option value="no">No</option>
                                        <option value="yes">Yes</option>
                                      </select>
                                    </div>
                                    <div style={styles.field}>
                                      <label style={styles.label}>Pay ($)</label>
                                      <input type="number" step="0.01" value={deliverablePay} onChange={e => setDeliverablePay(e.target.value)} placeholder="0.00" style={styles.input} />
                                    </div>
                                    <div style={styles.field}>
                                      <label style={styles.label}>Beat Sheet</label>
                                      <select value={deliverableBeatSheetId} onChange={e => setDeliverableBeatSheetId(e.target.value)} style={styles.select}>
                                        <option value="">None</option>
                                        {beatSheets.map(bs => (
                                          <option key={bs.id} value={bs.id}>{bs.title}</option>
                                        ))}
                                      </select>
                                    </div>
                                    <div style={styles.field}>
                                      <label style={styles.label}>Attached Video</label>
                                      <select value={deliverableVideoEventId} onChange={e => setDeliverableVideoEventId(e.target.value)} style={styles.select}>
                                        <option value="">None</option>
                                        {videoEvents.map(ev => (
                                          <option key={ev.id} value={ev.id}>
                                            {'\uD83D\uDCF9'} {new Date(ev.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — {ev.title}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  </div>
                                  <div style={styles.field}>
                                    <label style={styles.label}>Ad Copy</label>
                                    <textarea value={deliverableNotes} onChange={e => setDeliverableNotes(e.target.value)} placeholder="Ad copy, talking points, key messaging..." rows={2} style={{ ...styles.input, resize: 'vertical' }} />
                                  </div>
                                  <button type="submit" style={styles.submitBtn}>{editingDeliverable ? 'Update Deliverable' : 'Add Deliverable'}</button>
                                </form>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Uncampaigned Deliverables (legacy) */}
                      {(() => {
                        const uncampaigned = deliverables.filter(d => !d.campaign_id);
                        if (uncampaigned.length === 0) return null;
                        return (
                          <div style={styles.detailSection}>
                            <h4 style={{ ...styles.detailLabel, marginBottom: '8px' }}>Uncampaigned</h4>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              {uncampaigned.map(d => renderDeliverableRow(d, sponsor))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Sponsor Actions */}
                      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                        <button onClick={() => startEditSponsor(sponsor)} style={{ ...styles.filterBtn, fontSize: '12px' }}>Edit</button>
                        <button onClick={() => handleDeleteSponsor(sponsor.id)} style={{ ...styles.filterBtn, fontSize: '12px', color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}>Delete</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
      )}
        </div>

      {/* ====== UPCOMING AD READS SECTION ====== */}
      {(() => {
        const upcomingReads = allDeliverables
          .filter(d => !d.delivered)
          .sort((a, b) => {
            if (!a.due_date && !b.due_date) return 0;
            if (!a.due_date) return 1;
            if (!b.due_date) return -1;
            return a.due_date.localeCompare(b.due_date);
          });
        const totalPay = upcomingReads.reduce((sum, d) => sum + (parseFloat(d.pay) || 0), 0);
        return (
          <div style={{ minWidth: 0 }}>
            <div style={styles.topBar}>
              <div>
                <h1 style={styles.pageTitle}>Upcoming Deliverables</h1>
                <p style={styles.pageSubtitle}>
                  {upcomingReads.length} deliverable{upcomingReads.length !== 1 ? 's' : ''}
                  {totalPay > 0 ? ` · $${totalPay.toLocaleString()} total` : ''}
                </p>
              </div>
              <button onClick={() => setSponsorCalOpen(v => !v)} style={styles.sponsorCalToggle}>
                {sponsorCalOpen ? 'Calendar ▲' : 'Calendar ▼'}
              </button>
            </div>

            {upcomingReads.length === 0 ? (
              <div style={styles.emptyCard}>
                <p style={styles.emptyText}>No upcoming deliverables. Add deliverables to sponsors above.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {upcomingReads.map(d => {
                  const linkedSheet = beatSheets.find(bs => bs.id === d.beat_sheet_id);
                  return (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', minWidth: 0 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff', marginBottom: '2px' }}>{d.title}</div>
                        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                          <span>{d.sponsor_name}</span>
                          {d.campaign_name && <><span style={{ opacity: 0.4 }}>/</span><span>{d.campaign_name}</span></>}
                          {d.due_date && <><span style={{ opacity: 0.4 }}>/</span><span>{new Date(d.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></>}
                        </div>
                      </div>
                      {d.pay != null && (
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#22c55e', whiteSpace: 'nowrap' }}>
                          ${parseFloat(d.pay).toLocaleString()}
                        </span>
                      )}
                      {(() => {
                        const ev = d.video_event_id ? videoEvents.find(e => e.id === d.video_event_id) : null;
                        if (ev) return (
                          <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '5px', whiteSpace: 'nowrap', background: 'rgba(168,85,247,0.12)', color: '#c084fc' }}>
                            {'\uD83D\uDCF9'} {ev.title?.length > 16 ? ev.title.slice(0, 16) + '\u2026' : ev.title}
                          </span>
                        );
                        if (d.slot_date) return (
                          <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '5px', whiteSpace: 'nowrap', background: 'rgba(99,102,241,0.1)', color: '#a5b4fc' }}>
                            Slotted {new Date(d.slot_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        );
                        return null;
                      })()}
                      <span style={{
                        fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '6px', whiteSpace: 'nowrap',
                        background: linkedSheet ? 'rgba(99,102,241,0.1)' : 'rgba(239,68,68,0.1)',
                        color: linkedSheet ? '#a5b4fc' : '#fca5a5',
                      }}>
                        {linkedSheet ? linkedSheet.title : 'Unassigned'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Sponsor Calendar */}
            {sponsorCalOpen && (() => {
              const year = sponsorCalMonth.getFullYear();
              const month = sponsorCalMonth.getMonth();
              const firstDay = new Date(year, month, 1);
              const lastDay = new Date(year, month + 1, 0);
              const startPad = firstDay.getDay();
              const totalDays = lastDay.getDate();
              const weeks = [];
              let currentDay = 1 - startPad;
              while (currentDay <= totalDays) {
                const week = [];
                for (let i = 0; i < 7; i++) {
                  week.push(new Date(year, month, currentDay));
                  currentDay++;
                }
                weeks.push(week);
              }
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const monthLabel = sponsorCalMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
              return (
                <div style={styles.sponsorCalWrapper}>
                  <div style={styles.sponsorCalNav}>
                    <button onClick={() => setSponsorCalMonth(new Date(year, month - 1, 1))} style={styles.sponsorCalNavBtn}>{'\u2190'}</button>
                    <span style={{ fontSize: '15px', fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>{monthLabel}</span>
                    <button onClick={() => setSponsorCalMonth(new Date(year, month + 1, 1))} style={styles.sponsorCalNavBtn}>{'\u2192'}</button>
                  </div>
                  <div style={styles.sponsorCalGrid}>
                    {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
                      <div key={d} style={styles.sponsorCalWeekdayCell}>{d}</div>
                    ))}
                    {weeks.flat().map((date, idx) => {
                      const inMonth = date.getMonth() === month;
                      const isToday = date.getTime() === today.getTime();
                      const dateStr = date.toISOString().split('T')[0];
                      const dayEvents = videoEvents.filter(ev => {
                        const evDate = ev.start_date?.split('T')[0];
                        return evDate === dateStr;
                      });
                      return (
                        <div key={idx} style={{
                          ...styles.sponsorCalDayCell,
                          opacity: inMonth ? 1 : 0.3,
                          background: isToday ? 'rgba(99,102,241,0.1)' : 'transparent',
                        }}>
                          <div style={{ fontSize: '11px', color: isToday ? '#a5b4fc' : 'rgba(255,255,255,0.5)', fontWeight: isToday ? 700 : 400, marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <span>{date.getDate()}</span>
                            {videoSlotConfig.filter(s => s.day_of_week === date.getDay()).map(s => {
                              const ch = CHANNEL_COLORS[s.channel] || CHANNEL_COLORS.socials;
                              const slottedDel = allDeliverables.find(d => d.slot_date === dateStr && d.channel === s.channel);
                              const isOpen = slotDropdown && slotDropdown.dateStr === dateStr && slotDropdown.channel === s.channel;
                              return (
                                <span key={s.channel} style={{ position: 'relative', display: 'inline-block' }}>
                                  <span
                                    onClick={(e) => { e.stopPropagation(); setSlotDropdown(isOpen ? null : { dateStr, channel: s.channel, x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom }); }}
                                    style={{ fontSize: '7px', fontWeight: 700, padding: '1px 3px', borderRadius: '3px', background: slottedDel ? ch.bg.replace('0.12', '0.3') : ch.bg, color: ch.color, letterSpacing: '0.5px', lineHeight: 1, cursor: 'pointer', opacity: slottedDel ? 1 : 0.6, maxWidth: '48px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}
                                    title={slottedDel ? `${slottedDel.sponsor_name} — ${slottedDel.campaign_name || slottedDel.title || ''}` : ch.label}
                                  >
                                    {slottedDel ? (slottedDel.sponsor_name?.length > 5 ? slottedDel.sponsor_name.slice(0, 5) + '\u2026' : slottedDel.sponsor_name) : ch.label}
                                  </span>
                                  {isOpen && (
                                    <div ref={slotDropdownRef} style={{ position: 'fixed', left: slotDropdown.x, top: slotDropdown.y + 2, zIndex: 9999, background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', padding: '4px 0', minWidth: '180px', maxHeight: '200px', overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                                      {slottedDel && (
                                        <div
                                          onClick={(e) => { e.stopPropagation(); handleClearSlot(slottedDel.id); }}
                                          style={{ padding: '6px 10px', fontSize: '11px', color: '#f87171', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.08)' }}
                                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                        >
                                          ✕ Clear: {slottedDel.sponsor_name}
                                        </div>
                                      )}
                                      {(() => {
                                        const available = allDeliverables.filter(d => !d.video_event_id && !d.slot_date && d.channel === s.channel);
                                        if (!available.length) return (
                                          <div style={{ padding: '6px 10px', fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>No deliverables</div>
                                        );
                                        return available.map(d => (
                                          <div
                                            key={d.id}
                                            onClick={(e) => { e.stopPropagation(); handleAssignSlot(d.id, dateStr); }}
                                            style={{ padding: '6px 10px', fontSize: '11px', color: 'rgba(255,255,255,0.8)', cursor: 'pointer' }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                          >
                                            {d.sponsor_name} — {d.title || d.campaign_name || 'Untitled'}
                                          </div>
                                        ));
                                      })()}
                                    </div>
                                  )}
                                </span>
                              );
                            })}
                          </div>
                          {dayEvents.map(ev => {
                            const attachedDels = allDeliverables.filter(d => d.video_event_id === ev.id);
                            return (
                              <div key={ev.id}>
                                <div style={styles.sponsorCalEventPill} title={ev.title}>
                                  {'\uD83D\uDCF9'} {ev.title?.length > 14 ? ev.title.slice(0, 14) + '\u2026' : ev.title}
                                </div>
                                {attachedDels.map(del => (
                                  <div key={del.id} style={styles.sponsorCalBadge} title={del.campaign_name || del.sponsor_name}>
                                    {'\uD83E\uDD1D'} {(del.campaign_name || del.sponsor_name || '').length > 12 ? (del.campaign_name || del.sponsor_name || '').slice(0, 12) + '\u2026' : (del.campaign_name || del.sponsor_name)}
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}
      </div>

      {/* ====== MONEY SECTION ====== */}
      {(() => {
        const allCampaigns = sponsors.flatMap(s => s.sponsor_campaigns || []);
        const campaignTotals = new Map(
          allCampaigns.map(c => [
            c.id,
            allDeliverables
              .filter(d => d.campaign_id === c.id)
              .reduce((sum, d) => sum + (parseFloat(d.pay) || 0), 0),
          ])
        );
        const totalDeal = Array.from(campaignTotals.values()).reduce((sum, v) => sum + v, 0);
        const totalPaid = allCampaigns
          .filter(c => c.payment_status === 'paid')
          .reduce((sum, c) => sum + (campaignTotals.get(c.id) || 0), 0);
        const totalOwed = totalDeal - totalPaid;
        const upcomingValue = allDeliverables
          .filter(d => !d.delivered)
          .reduce((sum, d) => sum + (parseFloat(d.pay) || 0), 0);
        const lateCampaigns = allCampaigns.filter(campaign => {
          const campaignDels = allDeliverables.filter(d => d.campaign_id === campaign.id);
          const allDel = campaignDels.length > 0 && campaignDels.every(d => d.delivered);
          return allDel && campaign.payment_status !== 'paid';
        });
        const lateValue = lateCampaigns.reduce((sum, c) => sum + (campaignTotals.get(c.id) || 0), 0);
        if (totalDeal === 0) return null;
        return (
          <div style={{ marginTop: '40px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '24px' }}>
            <div style={{ marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#fff' }}>Money</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px' }}>
              {[
                { label: 'Total Deal Value', value: totalDeal, color: '#6366f1' },
                { label: 'Total Paid', value: totalPaid, color: '#22c55e' },
                { label: 'Total Owed', value: totalOwed, color: totalOwed > 0 ? '#f59e0b' : '#22c55e' },
                { label: 'Upcoming', value: upcomingValue, color: '#6366f1' },
                { label: 'Late', value: lateValue, color: lateValue > 0 ? '#ef4444' : '#22c55e' },
              ].map(card => (
                <div key={card.label} style={{
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '14px', padding: '20px 24px', position: 'relative', overflow: 'hidden',
                }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, width: '3px', height: '100%', background: card.color }} />
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>{card.label}</div>
                  <div style={{ fontSize: '28px', fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
                    ${card.value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
      </>
      )}
    </div>
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
}) {
  const { writeDocs = [], beatSheets = [], adReadDeliverables = [] } = linkedFieldData;
  const isBusiness = project.category === 'business';
  const typeList = isBusiness ? BUSINESS_PROJECT_TYPES : PROJECT_TYPES;
  const statusList = isBusiness ? BUSINESS_STATUSES : STATUSES;
  const statusLabels = isBusiness ? BUSINESS_STATUS_LABELS : STATUS_LABELS;
  const statusColors = isBusiness ? BUSINESS_STATUS_COLORS : STATUS_COLORS;

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

  useEffect(() => {
    setEditStageTimelines(project.stage_timelines || {});
  }, [project.stage_timelines]);

  function saveStageDate(stage, field, value) {
    const updated = { ...editStageTimelines, [stage]: { ...(editStageTimelines[stage] || {}), [field]: value } };
    // Remove empty entries
    if (!updated[stage].start && !updated[stage].end) delete updated[stage];
    setEditStageTimelines(updated);
    onUpdateProject(project.id, { stage_timelines: updated });
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
    <div style={{
      ...styles.projectRow,
      ...(project.is_archived ? { opacity: 0.6 } : {}),
    }}>
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

          {/* Stage Timeline & Assignments */}
          <div style={styles.detailSection}>
            <h4 style={styles.detailLabel}>Stage Timeline & Assignments</h4>
            <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', margin: '0 0 10px 0' }}>
              Set date ranges and assign team members to each stage.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {statusList.map(stage => {
                const stageAs = (project.project_stage_assignments || []).filter(a => a.stage === stage);
                const isCurrentStage = project.status === stage;
                const stageDates = editStageTimelines[stage] || {};
                return (
                  <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: '6px', background: isCurrentStage ? `${statusColors[stage]}08` : 'transparent', borderLeft: isCurrentStage ? `2px solid ${statusColors[stage]}` : '2px solid transparent' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: statusColors[stage], width: '80px', flexShrink: 0 }}>{statusLabels[stage]}</span>
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
                    <div style={{ display: 'flex', gap: '4px', flex: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                      {stageAs.map(a => (
                        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(99,102,241,0.1)', padding: '2px 6px', borderRadius: '6px' }}>
                          <div style={{ width: '18px', height: '18px', borderRadius: '6px', background: 'rgba(99,102,241,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: 600, color: '#a5b4fc' }}>{a.profile?.full_name?.charAt(0)}</div>
                          <span style={{ fontSize: '11px', color: '#a5b4fc' }}>{a.profile?.full_name}</span>
                          <button onClick={() => onRemoveProjectStageAssignment(a.id)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', fontSize: '12px', padding: '4px' }}>✕</button>
                        </div>
                      ))}
                      <select
                        onChange={(e) => { if (e.target.value) { onAssignProjectStage(project.id, stage, e.target.value); e.target.value = ''; } }}
                        defaultValue=""
                        style={{ padding: '3px 6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#fff', fontSize: '11px', fontFamily: 'inherit', outline: 'none' }}
                      >
                        <option value="">+ Assign</option>
                        {teamMembers.filter(m => !stageAs.some(a => a.user_id === m.id)).map(m => (
                          <option key={m.id} value={m.id}>{m.full_name}</option>
                        ))}
                      </select>
                    </div>
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
  const isBusiness = project.category === 'business';
  const typeList = isBusiness ? BUSINESS_PROJECT_TYPES : PROJECT_TYPES;
  const statusColors = isBusiness ? BUSINESS_STATUS_COLORS : STATUS_COLORS;
  const typeLabel = typeList.find(t => t.value === project.type)?.label || project.type.replace('_', ' ');

  return (
    <>
      <div style={styles.kanbanCardName}>{project.name}</div>
      <div style={styles.kanbanCardMeta}>
        <span style={{
          ...styles.kanbanTypeBadge,
          background: `${statusColors[project.status]}15`,
          color: statusColors[project.status],
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

function MaydayCard({ video, reads, onUpdate, onDelete, isEditing, onToggleEdit, linkedFieldData = {} }) {
  const { writeDocs = [], beatSheets = [], adReadDeliverables = [] } = linkedFieldData;
  const [editTitle, setEditTitle] = useState(video.title || '');
  const [editPostDate, setEditPostDate] = useState(video.post_date || '');
  const [editSegment, setEditSegment] = useState(video.segment || '');
  const [editWriteDocId, setEditWriteDocId] = useState(video.write_doc_id || '');
  const [editWriteDocName, setEditWriteDocName] = useState(video.write_doc_name || '');
  const [editBeatSheetId, setEditBeatSheetId] = useState(video.beat_sheet_id || '');
  const [editAdReadId, setEditAdReadId] = useState(video.ad_read_id || '');

  const sponsorName = video.sponsor_read?.sponsor?.name;

  const postDateDays = video.post_date
    ? Math.ceil((new Date(video.post_date) - new Date()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
        <div style={styles.kanbanCardName}>{video.title}</div>
        <button onClick={onToggleEdit} style={{ ...styles.removeBtn, fontSize: '14px', padding: '0 4px' }}>
          {isEditing ? '✕' : '⋯'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {video.segment && (
          <span style={{
            fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px',
            background: MAYDAY_SEGMENT_COLORS[video.segment]?.bg || 'rgba(255,255,255,0.08)',
            color: MAYDAY_SEGMENT_COLORS[video.segment]?.color || 'rgba(255,255,255,0.5)',
            textTransform: 'uppercase', letterSpacing: '0.3px',
          }}>
            {video.segment}
          </span>
        )}
        {sponsorName && (
          <span style={{
            fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px',
            background: 'rgba(99,102,241,0.15)', color: '#a5b4fc',
            textTransform: 'uppercase', letterSpacing: '0.3px',
          }}>
            {sponsorName}
          </span>
        )}
        {video.post_date && (
          <span style={{
            fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px',
            background: postDateDays !== null && postDateDays <= 1 ? 'rgba(239,68,68,0.15)' : postDateDays !== null && postDateDays <= 3 ? 'rgba(249,115,22,0.15)' : 'rgba(255,255,255,0.06)',
            color: postDateDays !== null && postDateDays <= 1 ? '#fca5a5' : postDateDays !== null && postDateDays <= 3 ? '#fdba74' : 'rgba(255,255,255,0.4)',
          }}>
            Post {new Date(video.post_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>
      {isEditing && (
        <div style={{ marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              style={styles.smallSelect}
              placeholder="Title"
            />
            <select
              value={editSegment}
              onChange={(e) => setEditSegment(e.target.value)}
              style={styles.smallSelect}
              onClick={(e) => e.stopPropagation()}
            >
              <option value="">No segment</option>
              {MAYDAY_SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <input
              type="date"
              value={editPostDate}
              onChange={(e) => setEditPostDate(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              style={styles.smallSelect}
              placeholder="Post date"
            />
            <select
              value={editWriteDocId}
              onChange={(e) => {
                const doc = writeDocs.find(d => d.id === e.target.value);
                setEditWriteDocId(e.target.value);
                setEditWriteDocName(doc?.name || '');
              }}
              style={styles.smallSelect}
              onClick={(e) => e.stopPropagation()}
            >
              <option value="">No write doc</option>
              {writeDocs.map(doc => (
                <option key={doc.id} value={doc.id}>
                  {doc.folderName ? `${doc.folderName} / ${doc.name}` : doc.name}
                </option>
              ))}
            </select>
            <select
              value={editBeatSheetId}
              onChange={(e) => setEditBeatSheetId(e.target.value)}
              style={styles.smallSelect}
              onClick={(e) => e.stopPropagation()}
            >
              <option value="">No beat sheet</option>
              {beatSheets.map(bs => (
                <option key={bs.id} value={bs.id}>{bs.title}</option>
              ))}
            </select>
            <select
              value={editAdReadId}
              onChange={(e) => setEditAdReadId(e.target.value)}
              style={styles.smallSelect}
              onClick={(e) => e.stopPropagation()}
            >
              <option value="">No ad read</option>
              {adReadDeliverables.map(d => (
                <option key={d.id} value={d.id}>
                  {d.sponsor_name}{d.campaign_name ? ` — ${d.campaign_name}` : ''}{d.title ? `: ${d.title}` : ''}
                </option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdate({
                    title: editTitle,
                    post_date: editPostDate || null,
                    segment: editSegment || null,
                    write_doc_id: editWriteDocId || null,
                    write_doc_name: editWriteDocName || null,
                    beat_sheet_id: editBeatSheetId || null,
                    ad_read_id: editAdReadId || null,
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
  // --- Sponsors ---
  sponsorCard: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px',
    overflow: 'hidden',
    transition: 'border-color 0.15s',
  },
  sponsorCardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px',
    cursor: 'pointer',
    gap: '12px',
  },
  paymentBadge: {
    fontSize: '12px',
    fontWeight: 700,
    padding: '3px 10px',
    borderRadius: '8px',
    whiteSpace: 'nowrap',
  },
  deliverableRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 10px',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.04)',
  },
  sponsorCalToggle: {
    padding: '10px 16px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '10px',
    color: 'rgba(255,255,255,0.7)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  sponsorCalWrapper: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '14px',
    padding: '16px',
    marginBottom: '24px',
  },
  sponsorCalNav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    marginBottom: '12px',
  },
  sponsorCalNavBtn: {
    background: 'none',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    color: 'rgba(255,255,255,0.6)',
    cursor: 'pointer',
    padding: '4px 10px',
    fontSize: '14px',
    fontFamily: 'inherit',
  },
  sponsorCalGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: '1px',
  },
  sponsorCalWeekdayCell: {
    textAlign: 'center',
    fontSize: '11px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.35)',
    padding: '4px 0 8px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  sponsorCalDayCell: {
    minHeight: '70px',
    padding: '4px',
    borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.04)',
  },
  sponsorCalEventPill: {
    fontSize: '9px',
    fontWeight: 600,
    padding: '2px 4px',
    borderRadius: '4px',
    background: 'rgba(168,85,247,0.15)',
    color: '#c084fc',
    marginBottom: '2px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sponsorCalBadge: {
    fontSize: '8px',
    fontWeight: 600,
    padding: '1px 4px',
    borderRadius: '3px',
    background: 'rgba(16,185,129,0.15)',
    color: '#6ee7b7',
    marginBottom: '1px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
};
