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
  { value: 'substack_article', label: 'Substack Article' },
  { value: 'other', label: 'Other' },
];
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

  // Campaign state
  const [showCampaignForm, setShowCampaignForm] = useState(null); // sponsorId or null
  const [editingCampaign, setEditingCampaign] = useState(null);
  const [campaignForm, setCampaignForm] = useState({ name: '', description: '', start_date: '', end_date: '', contact_name: '', contact_email: '', payment_amount: '', payment_status: 'unpaid' });
  const [briefFile, setBriefFile] = useState(null);

  // Sponsor view mode
  const [sponsorViewMode, setSponsorViewMode] = useState(() => localStorage.getItem('sponsor_view') || 'list');
  const [allDeliverables, setAllDeliverables] = useState([]);
  const [expandedDeliverableId, setExpandedDeliverableId] = useState(null);

  // Form state
  const [form, setForm] = useState({
    name: '', type: 'youtube_video', channel: '',
    start_date: '', deadline: '', notes: '', status: 'concept',
  });

  useEffect(() => {
    localStorage.setItem('projects_view', viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem('sponsor_view', sponsorViewMode);
  }, [sponsorViewMode]);

  const fetchProjects = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('projects')
        .select(`
          *,
          project_assignments(*, profile:profiles(id, full_name, title)),
          project_attachments(*),
          concept:concepts(id, name, color),
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_stage_assignments' }, () => {
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
    const channel = supabase
      .channel('shorts-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shorts_queue' }, () => {
        fetchShorts();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeSection, fetchShorts]);

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
    if (!window.confirm('Delete this clip from the queue?')) return;
    await supabase.from('shorts_queue').delete().eq('id', shortId);
    fetchShorts();
  }

  function onShortsDragEnd(result) {
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
      reordered.forEach((item, idx) => {
        if (item.sort_order !== idx) {
          supabase.from('shorts_queue').update({ sort_order: idx }).eq('id', item.id).then();
        }
      });
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

  useEffect(() => {
    if (activeSection !== 'sponsors') return;
    fetchSponsors();
    const channel = supabase
      .channel('sponsors-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sponsors' }, () => fetchSponsors())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sponsor_deliverables' }, () => fetchSponsors())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sponsor_campaigns' }, () => fetchSponsors())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliverable_stage_assignments' }, () => fetchSponsors())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeSection, fetchSponsors]);

  function resetSponsorForm() {
    setSponsorName('');
    setSponsorNotes('');
    setEditingSponsor(null); setShowSponsorForm(false);
  }

  function resetDeliverableForm() {
    setDeliverableTitle(''); setDeliverableType('long_form_read');
    setDueDate(''); setDeliverableNotes('');
    setDeliverablePlatforms([]); setDeliverableNeedsReview(false); setDeliverableCampaignId('');
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
    if (!window.confirm('Delete this sponsor and all its deliverables?')) return;
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
    resetDeliverableForm();
    fetchSponsors();
  }

  async function handleDeleteDeliverable(deliverable) {
    if (deliverable.calendar_event_id) {
      await supabase.from('calendar_events').delete().eq('id', deliverable.calendar_event_id);
    }
    await supabase.from('sponsor_deliverables').delete().eq('id', deliverable.id);
    fetchSponsors();
  }

  async function handleDeliverableStageChange(deliverableId, newStage) {
    const updates = {
      status: newStage,
      completed_at: newStage === 'posted' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    await supabase.from('sponsor_deliverables').update(updates).eq('id', deliverableId);
    fetchSponsors();
  }

  // Campaign CRUD
  function resetCampaignForm() {
    setCampaignForm({ name: '', description: '', start_date: '', end_date: '', contact_name: '', contact_email: '', payment_amount: '', payment_status: 'unpaid' });
    setBriefFile(null);
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
      payment_amount: campaignForm.payment_amount ? parseFloat(campaignForm.payment_amount) : 0,
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
    // Upload brief if file selected
    if (briefFile && campaignId) {
      const filePath = `${campaignId}/${Date.now()}_${briefFile.name}`;
      const { error: uploadError } = await supabase.storage.from('campaign-briefs').upload(filePath, briefFile);
      if (uploadError) { alert('Brief upload failed: ' + uploadError.message); } else {
        const { data: urlData } = supabase.storage.from('campaign-briefs').getPublicUrl(filePath);
        await supabase.from('sponsor_campaigns').update({ brief_url: urlData.publicUrl, brief_name: briefFile.name }).eq('id', campaignId);
      }
    }
    // Sync revenue_event based on payment status
    const revenueKey = `sponsor_campaign_${campaignId}`;
    if (payload.payment_status === 'paid' && payload.payment_amount > 0) {
      const amountCents = Math.round(payload.payment_amount * 100);
      await supabase.from('revenue_events').upsert({
        stripe_event_id: revenueKey,
        event_type: 'sponsorship',
        amount_cents: amountCents,
        net_amount_cents: amountCents,
        product_category: 'sponsorship',
        occurred_at: payload.end_date || new Date().toISOString(),
        platform_account_id: null,
        metadata: { source: 'sponsor_campaign', campaign_id: campaignId, sponsor_id: sponsorId },
      }, { onConflict: 'stripe_event_id' });
    } else {
      await supabase.from('revenue_events').delete().eq('stripe_event_id', revenueKey);
    }

    resetCampaignForm();
    fetchSponsors();
  }

  async function handleRemoveBrief(campaignId, briefUrl) {
    if (!window.confirm('Remove this brief file?')) return;
    // Extract storage path from URL
    const pathMatch = briefUrl.match(/campaign-briefs\/(.+)$/);
    if (pathMatch) {
      await supabase.storage.from('campaign-briefs').remove([decodeURIComponent(pathMatch[1])]);
    }
    await supabase.from('sponsor_campaigns').update({ brief_url: null, brief_name: null }).eq('id', campaignId);
    fetchSponsors();
  }

  async function handleDeleteCampaign(campaignId) {
    if (!window.confirm('Delete this campaign? Deliverables will be uncampaigned.')) return;
    await supabase.from('sponsor_campaigns').delete().eq('id', campaignId);
    fetchSponsors();
  }

  // Deliverable stage assignments
  async function handleAssignDeliverableStage(deliverableId, stage, userId) {
    const { error } = await supabase.from('deliverable_stage_assignments').insert({
      deliverable_id: deliverableId, stage, user_id: userId,
    });
    if (error && error.code !== '23505') console.error('Error assigning stage:', error);
    fetchSponsors();
  }

  async function handleRemoveDeliverableStageAssignment(id) {
    await supabase.from('deliverable_stage_assignments').delete().eq('id', id);
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

  // Kanban drag for deliverables
  function onDeliverablesDragEnd(result) {
    if (!result.destination) return;
    const { draggableId, destination } = result;
    const newStage = destination.droppableId;
    const deliverable = allDeliverables.find(d => d.id === draggableId);
    if (deliverable && deliverable.status !== newStage) {
      handleDeliverableStageChange(draggableId, newStage);
    }
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

  const archivedCount = projects.filter(p => p.is_archived).length;

  const filtered = projects.filter(p => {
    if (showArchived) {
      if (!p.is_archived) return false;
    } else {
      if (p.is_archived) return false;
    }
    if (filterStatus !== 'all' && p.status !== filterStatus) return false;
    if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const editingCount = shorts.filter(s => s.stage === 'editing').length;
  const readyCount = shorts.filter(s => s.stage === 'ready_to_post').length;
  const activeSponsorsCount = sponsors.filter(s => s.status === 'active').length;

  function renderDeliverableRow(d, sponsor) {
    const isDetailExpanded = expandedDeliverableId === d.id;
    const stageAssignments = d.deliverable_stage_assignments || [];
    const currentStageAssignments = stageAssignments.filter(a => a.stage === d.status);
    return (
      <div key={d.id} style={styles.deliverableRow}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, flexWrap: 'wrap' }}>
          {/* Mini stage pipeline */}
          <div style={{ display: 'flex', gap: '2px' }}>
            {DELIVERABLE_STAGES.map(stage => (
              <button
                key={stage}
                onClick={(e) => { e.stopPropagation(); handleDeliverableStageChange(d.id, stage); }}
                title={DELIVERABLE_STAGE_LABELS[stage]}
                style={{
                  width: '18px', height: '18px', borderRadius: '4px', border: 'none', cursor: 'pointer', padding: 0,
                  background: d.status === stage ? DELIVERABLE_STAGE_COLORS[stage] : DELIVERABLE_STAGES.indexOf(d.status) > DELIVERABLE_STAGES.indexOf(stage) ? `${DELIVERABLE_STAGE_COLORS[stage]}40` : 'rgba(255,255,255,0.06)',
                  transition: 'all 0.15s',
                }}
              />
            ))}
          </div>
          <span style={{ fontSize: '14px', flexShrink: 0 }}>{DELIVERABLE_TYPES[d.deliverable_type]?.icon || '📋'}</span>
          <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setExpandedDeliverableId(isDetailExpanded ? null : d.id)}>
            <div style={{ fontSize: '13px', color: d.status === 'posted' ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.85)', textDecoration: d.status === 'posted' ? 'line-through' : 'none' }}>
              {d.title}
            </div>
          </div>
          {/* Platform pills */}
          {(d.platforms || []).map(p => (
            <span key={p} style={{ fontSize: '9px', fontWeight: 600, padding: '2px 5px', borderRadius: '4px', background: 'rgba(99,102,241,0.12)', color: '#a5b4fc' }}>{p}</span>
          ))}
          {d.needs_review && (
            <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 5px', borderRadius: '4px', background: 'rgba(236,72,153,0.15)', color: '#f9a8d4', textTransform: 'uppercase', letterSpacing: '0.3px' }}>REVIEW</span>
          )}
          {/* Stage assigned avatars */}
          {currentStageAssignments.length > 0 && (
            <div style={{ display: 'flex', marginLeft: '4px' }}>
              {currentStageAssignments.map(a => (
                <div key={a.id} style={styles.kanbanAvatar} title={a.profile?.full_name}>{a.profile?.full_name?.charAt(0)}</div>
              ))}
            </div>
          )}
          {d.due_date && (
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>
              {new Date(d.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
          <button onClick={() => startEditDeliverable(d)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: '12px', padding: '2px 4px' }} title="Edit">✎</button>
          <button onClick={() => handleDeleteDeliverable(d)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: '12px', padding: '2px 4px' }} title="Delete">✕</button>
        </div>
        {/* Expanded stage assignments */}
        {isDetailExpanded && (
          <div style={{ width: '100%', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            {DELIVERABLE_STAGES.map(stage => {
              const stageAs = stageAssignments.filter(a => a.stage === stage);
              return (
                <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', borderLeft: d.status === stage ? `2px solid ${DELIVERABLE_STAGE_COLORS[stage]}` : '2px solid transparent', paddingLeft: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: DELIVERABLE_STAGE_COLORS[stage], width: '90px', flexShrink: 0 }}>{DELIVERABLE_STAGE_LABELS[stage]}</span>
                  <div style={{ display: 'flex', gap: '4px', flex: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                    {stageAs.map(a => (
                      <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(99,102,241,0.1)', padding: '2px 6px', borderRadius: '6px' }}>
                        <div style={{ ...styles.kanbanAvatar, width: '18px', height: '18px', fontSize: '9px', marginLeft: 0, border: 'none' }}>{a.profile?.full_name?.charAt(0)}</div>
                        <span style={{ fontSize: '11px', color: '#a5b4fc' }}>{a.profile?.full_name}</span>
                        <button onClick={() => handleRemoveDeliverableStageAssignment(a.id)} style={styles.removeBtn}>✕</button>
                      </div>
                    ))}
                    <select
                      onChange={(e) => { if (e.target.value) { handleAssignDeliverableStage(d.id, stage, e.target.value); e.target.value = ''; } }}
                      defaultValue=""
                      style={{ ...styles.smallSelect, padding: '3px 6px', fontSize: '11px' }}
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
        )}
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
          Sponsors
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
          <p style={styles.pageSubtitle}>{projects.length - archivedCount} active{archivedCount > 0 ? ` · ${archivedCount} archived` : ''}</p>
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
          {archivedCount > 0 && (
            <button
              onClick={() => setShowArchived(!showArchived)}
              style={{
                ...styles.filterBtn,
                ...(showArchived ? {
                  background: 'rgba(107,114,128,0.2)',
                  color: '#9ca3af',
                  borderColor: 'rgba(107,114,128,0.4)',
                } : {}),
              }}
            >
              Archived ({archivedCount})
            </button>
          )}
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
                onArchiveProject={handleArchiveProject}
                onUnarchiveProject={handleUnarchiveProject}
                onLinkConcept={handleLinkConcept}
                onNavigate={onNavigate}
                concepts={concepts}
                isAdmin={isAdmin}
                onAddChecklistItem={handleAddChecklistItem}
                onToggleChecklistItem={handleToggleChecklistItem}
                onDeleteChecklistItem={handleDeleteChecklistItem}
                onAssignProjectStage={handleAssignProjectStage}
                onRemoveProjectStageAssignment={handleRemoveProjectStageAssignment}
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
      <div style={styles.topBar}>
        <div>
          <h1 style={styles.pageTitle}>Sponsors</h1>
          <p style={styles.pageSubtitle}>
            {activeSponsorsCount} active · {sponsors.filter(s => s.status === 'completed').length} completed
            {(() => {
              const allCampaigns = sponsors.flatMap(s => s.sponsor_campaigns || []);
              const totalPay = allCampaigns.reduce((sum, c) => sum + (parseFloat(c.payment_amount) || 0), 0);
              const totalReceived = allCampaigns.filter(c => c.payment_status === 'paid').reduce((sum, c) => sum + (parseFloat(c.payment_amount) || 0), 0);
              if (totalPay === 0) return null;
              return <span style={{ color: '#22c55e', marginLeft: '8px' }}>
                · ${totalReceived.toLocaleString()} received of ${totalPay.toLocaleString()}
              </span>;
            })()}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={styles.viewToggle}>
            <button
              onClick={() => setSponsorViewMode('list')}
              style={{
                ...styles.viewToggleBtn,
                ...(sponsorViewMode === 'list' ? styles.viewToggleBtnActive : {}),
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
              onClick={() => setSponsorViewMode('board')}
              style={{
                ...styles.viewToggleBtn,
                ...(sponsorViewMode === 'board' ? styles.viewToggleBtnActive : {}),
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
          <button onClick={() => { resetSponsorForm(); setShowSponsorForm(!showSponsorForm); }} style={styles.addBtn}>
            {showSponsorForm && !editingSponsor ? '✕ Cancel' : '+ New Sponsor'}
          </button>
        </div>
      </div>

      {/* Sponsor KPI Summary */}
      {(() => {
        const allCampaigns = sponsors.flatMap(s => s.sponsor_campaigns || []);
        const totalDeal = allCampaigns.reduce((sum, c) => sum + (parseFloat(c.payment_amount) || 0), 0);
        const totalPaid = allCampaigns.filter(c => c.payment_status === 'paid').reduce((sum, c) => sum + (parseFloat(c.payment_amount) || 0), 0);
        const totalOwed = totalDeal - totalPaid;
        if (totalDeal === 0) return null;
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '24px' }}>
            {[
              { label: 'Total Deal Value', value: totalDeal, color: '#6366f1' },
              { label: 'Total Paid', value: totalPaid, color: '#22c55e' },
              { label: 'Total Owed', value: totalOwed, color: totalOwed > 0 ? '#f59e0b' : '#22c55e' },
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
        );
      })()}

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

      {/* Sponsor List / Board */}
      {sponsorLoading ? (
        <p style={styles.emptyText}>Loading sponsors...</p>
      ) : sponsorViewMode === 'list' ? (
        sponsors.length === 0 ? (
          <div style={styles.emptyCard}>
            <p style={styles.emptyText}>No sponsors yet. Add one to get started.</p>
          </div>
        ) : (
          <div style={styles.projectList}>
            {sponsors.map(sponsor => {
              const isExpanded = expandedSponsorId === sponsor.id;
              const deliverables = sponsor.sponsor_deliverables || [];
              const campaigns = sponsor.sponsor_campaigns || [];
              const postedDels = deliverables.filter(d => d.status === 'posted').length;
              return (
                <div key={sponsor.id} style={styles.sponsorCard}>
                  <div style={styles.sponsorCardHeader} onClick={() => setExpandedSponsorId(isExpanded ? null : sponsor.id)}>
                    <div style={styles.projectRowLeft}>
                      <span style={{ fontSize: '18px' }}>🤝</span>
                      <div>
                        <div style={styles.projectRowName}>{sponsor.name}</div>
                        <div style={styles.projectRowMeta}>
                          {campaigns.length > 0 ? `${campaigns.length} campaign${campaigns.length > 1 ? 's' : ''}` : 'No campaigns'}
                        </div>
                      </div>
                    </div>
                    <div style={styles.projectRowRight}>
                      <span style={{ ...styles.statusTag, background: `${SPONSOR_STATUS_COLORS[sponsor.status]}15`, color: SPONSOR_STATUS_COLORS[sponsor.status] }}>
                        {sponsor.status}
                      </span>
                      {deliverables.length > 0 && (
                        <span style={styles.checklistBadge}>{postedDels}/{deliverables.length}</span>
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
                                  <label style={styles.label}>Payment Amount</label>
                                  <input value={campaignForm.payment_amount} onChange={e => setCampaignForm({ ...campaignForm, payment_amount: e.target.value })} placeholder="0.00" type="number" step="0.01" min="0" style={styles.input} />
                                </div>
                              )}
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
                                <label style={styles.label}>Brief (PDF/DOCX)</label>
                                <input type="file" accept=".pdf,.docx,.doc" onChange={e => setBriefFile(e.target.files[0] || null)} style={{ ...styles.input, padding: '6px 8px' }} />
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
                          const allPosted = campaignDels.length > 0 && campaignDels.every(d => d.status === 'posted');
                          const postedCount = campaignDels.filter(d => d.status === 'posted').length;
                          return (
                            <div key={campaign.id} style={{ marginBottom: '8px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', padding: '10px 12px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', flex: 1 }}>{campaign.name}</span>
                                {campaign.start_date && campaign.end_date && (
                                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>
                                    {new Date(campaign.start_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(campaign.end_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  </span>
                                )}
                                {isAdmin && campaign.payment_amount > 0 && (
                                  <span style={{ ...styles.paymentBadge, background: `${PAYMENT_STATUS_COLORS[campaign.payment_status]}15`, color: PAYMENT_STATUS_COLORS[campaign.payment_status] }}>
                                    ${Number(campaign.payment_amount).toLocaleString()}
                                  </span>
                                )}
                                {isAdmin && (
                                  <span style={{ ...styles.statusTag, background: `${PAYMENT_STATUS_COLORS[campaign.payment_status]}15`, color: PAYMENT_STATUS_COLORS[campaign.payment_status] }}>
                                    {campaign.payment_status}
                                  </span>
                                )}
                                {allPosted && (
                                  <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: 'rgba(34,197,94,0.15)', color: '#86efac', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Delivered!</span>
                                )}
                                {campaignDels.length > 0 && (
                                  <span style={styles.checklistBadge}>{postedCount}/{campaignDels.length}</span>
                                )}
                                <button onClick={() => { setCampaignForm({ name: campaign.name, description: campaign.description || '', start_date: campaign.start_date || '', end_date: campaign.end_date || '', contact_name: campaign.contact_name || '', contact_email: campaign.contact_email || '', payment_amount: campaign.payment_amount || '', payment_status: campaign.payment_status || 'unpaid' }); setEditingCampaign(campaign.id); setShowCampaignForm(sponsor.id); }} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: '12px', padding: '2px 4px' }} title="Edit">✎</button>
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
                                  </div>
                                  <div style={styles.field}>
                                    <label style={styles.label}>Notes</label>
                                    <textarea value={deliverableNotes} onChange={e => setDeliverableNotes(e.target.value)} placeholder="Requirements, talking points..." rows={2} style={{ ...styles.input, resize: 'vertical' }} />
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
        )
      ) : (
        /* Kanban Board View */
        <DragDropContext onDragEnd={onDeliverablesDragEnd}>
          <div style={styles.boardContainer}>
            {DELIVERABLE_STAGES.map(stage => {
              const columnDels = allDeliverables.filter(d => d.status === stage);
              return (
                <Droppable droppableId={stage} key={stage}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      style={{
                        ...styles.boardColumn,
                        background: snapshot.isDraggingOver ? `${DELIVERABLE_STAGE_COLORS[stage]}08` : 'rgba(255,255,255,0.02)',
                      }}
                    >
                      <div style={styles.boardColumnHeader}>
                        <div style={{ ...styles.boardColumnDot, background: DELIVERABLE_STAGE_COLORS[stage] }} />
                        <span style={{ ...styles.boardColumnTitle, color: DELIVERABLE_STAGE_COLORS[stage] }}>{DELIVERABLE_STAGE_LABELS[stage]}</span>
                        <span style={styles.boardColumnCount}>{columnDels.length}</span>
                      </div>
                      <div style={styles.boardColumnBody}>
                        {columnDels.map((d, index) => (
                          <Draggable key={d.id} draggableId={d.id} index={index}>
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
                                <DeliverableKanbanCard deliverable={d} />
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                        {columnDels.length === 0 && (
                          <div style={{ padding: '24px 16px', textAlign: 'center' }}>
                            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.2)', margin: 0 }}>No deliverables</p>
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
    </div>
  );
}

function ProjectRow({
  project, teamMembers, profile, isSelected, onToggle,
  onStatusChange, onAssign, onRemoveAssignment,
  onAddAttachment, onRemoveAttachment, onAddComment, onDeleteComment,
  onDeleteProject, onArchiveProject, onUnarchiveProject,
  onLinkConcept, onNavigate, concepts,
  isAdmin,
  onAddChecklistItem, onToggleChecklistItem, onDeleteChecklistItem,
  onAssignProjectStage, onRemoveProjectStageAssignment,
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
    <div style={{
      ...styles.projectRow,
      ...(project.is_archived ? { opacity: 0.6 } : {}),
    }}>
      <div style={styles.projectRowMain} onClick={onToggle}>
        <div style={styles.projectRowLeft}>
          <div style={{
            ...styles.statusDot,
            background: project.is_archived ? '#6b7280' : STATUS_COLORS[project.status],
          }} />
          <div>
            <div style={styles.projectRowName}>
              {project.name}
              {project.is_archived && <span style={styles.archivedTag}>Archived</span>}
            </div>
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

          {/* Stage Assignments */}
          <div style={styles.detailSection}>
            <h4 style={styles.detailLabel}>Stage Assignments</h4>
            <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', margin: '0 0 10px 0' }}>
              Assign team members to stages. They'll see this on their dashboard when the project enters their stage.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {STATUSES.map(stage => {
                const stageAs = (project.project_stage_assignments || []).filter(a => a.stage === stage);
                const isCurrentStage = project.status === stage;
                return (
                  <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: '6px', background: isCurrentStage ? `${STATUS_COLORS[stage]}08` : 'transparent', borderLeft: isCurrentStage ? `2px solid ${STATUS_COLORS[stage]}` : '2px solid transparent' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: STATUS_COLORS[stage], width: '80px', flexShrink: 0 }}>{STATUS_LABELS[stage]}</span>
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
          {(project.project_stage_assignments || []).filter(a => a.stage === project.status).slice(0, 3).map(a => (
            <div key={a.id} style={{ ...styles.kanbanAvatar, background: 'rgba(236,72,153,0.25)', color: '#f9a8d4' }} title={`${a.profile?.full_name} (stage)`}>{a.profile?.full_name?.charAt(0)}</div>
          ))}
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

function DeliverableKanbanCard({ deliverable }) {
  const d = deliverable;
  const currentStageAssignments = (d.deliverable_stage_assignments || []).filter(a => a.stage === d.status);
  return (
    <>
      <div style={styles.kanbanCardName}>{d.title}</div>
      <div style={styles.kanbanCardMeta}>
        <span style={{ ...styles.kanbanTypeBadge, background: `${DELIVERABLE_STAGE_COLORS[d.status]}15`, color: DELIVERABLE_STAGE_COLORS[d.status] }}>
          {DELIVERABLE_TYPES[d.deliverable_type]?.icon} {DELIVERABLE_TYPES[d.deliverable_type]?.label}
        </span>
      </div>
      <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginBottom: '6px' }}>
        {d.sponsor_name}{d.campaign_name ? ` · ${d.campaign_name}` : ''}
      </div>
      {((d.platforms || []).length > 0 || d.needs_review) && (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px' }}>
          {(d.platforms || []).map(p => (
            <span key={p} style={{ fontSize: '9px', fontWeight: 600, padding: '2px 5px', borderRadius: '4px', background: 'rgba(99,102,241,0.12)', color: '#a5b4fc' }}>{p}</span>
          ))}
          {d.needs_review && (
            <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 5px', borderRadius: '4px', background: 'rgba(236,72,153,0.15)', color: '#f9a8d4', textTransform: 'uppercase', letterSpacing: '0.3px' }}>REVIEW</span>
          )}
        </div>
      )}
      <div style={styles.kanbanCardFooter}>
        <div style={styles.kanbanAvatars}>
          {currentStageAssignments.slice(0, 3).map(a => (
            <div key={a.id} style={styles.kanbanAvatar} title={a.profile?.full_name}>{a.profile?.full_name?.charAt(0)}</div>
          ))}
        </div>
        {d.due_date && (
          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
            {new Date(d.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>
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
};
