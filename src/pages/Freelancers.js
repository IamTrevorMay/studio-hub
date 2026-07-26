import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { fetchAllRows } from './analytics/utils';
import usePersistedTab from '../hooks/usePersistedTab';
import { colors } from '../lib/styleTokens';

const TABS = ['Assignments', 'Hours', 'Documents', 'Team'];

const STATUS_OPTIONS = ['assigned', 'in_progress', 'completed'];
const STATUS_LABELS = { assigned: 'Assigned', in_progress: 'In Progress', completed: 'Completed' };
const STATUS_BADGE_COLORS = {
  assigned:    { bg: 'rgba(96,165,250,0.15)',  color: '#60a5fa' },
  in_progress: { bg: 'rgba(251,191,36,0.15)',  color: '#fbbf24' },
  completed:   { bg: 'rgba(52,211,153,0.15)',  color: '#34d399' },
};

const TYPE_OPTIONS = ['edit', 'design', 'write', 'other'];
const TYPE_LABELS = { edit: 'Edit', design: 'Design', write: 'Write', other: 'Other' };

const SPECIALTY_LABELS = { editor: 'Editor', designer: 'Designer', writer: 'Writer', other: 'Other' };

const FREELANCER_TITLES = [
  'Long Form Editor', 'Short Form Editor', 'Podcast Editor',
  'Graphic Designer', 'Developer', 'Writer', 'Producer', 'Production/Camera',
];

/* ─────────────────────────────────────────── */
/*  Component                                  */
/* ─────────────────────────────────────────── */

function Freelancers({ initialAssignmentId, onAssignmentOpened } = {}) {
  const { profile, isAdmin } = useAuth();
  const [activeTab, setActiveTab] = usePersistedTab('freelancers-tab', 'Assignments', ['Assignments', 'Hours', 'Documents', 'Team']);

  /* ── Team state ── */
  const [freelancers, setFreelancers] = useState([]);
  const [flProfiles, setFlProfiles] = useState({});
  const [assignmentCounts, setAssignmentCounts] = useState({});
  const [expandedFreelancer, setExpandedFreelancer] = useState(null);
  const [flAssignments, setFlAssignments] = useState([]);
  const [flHoursSummary, setFlHoursSummary] = useState([]);
  const [payBreakdowns, setPayBreakdowns] = useState({}); // { [hoursEntryId]: compute_freelancer_pay result }
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteTitle, setInviteTitle] = useState('');
  const [invitePaymentType, setInvitePaymentType] = useState('hourly');
  const [inviteRate, setInviteRate] = useState('');
  const [inviteRetainerEnabled, setInviteRetainerEnabled] = useState(false);
  const [inviteRetainerMin, setInviteRetainerMin] = useState('');
  const [inviteOvertimeEnabled, setInviteOvertimeEnabled] = useState(false);
  const [inviteOvertimeMax, setInviteOvertimeMax] = useState('');
  const [inviteOvertimeMult, setInviteOvertimeMult] = useState('1.5');
  const [inviteContractFile, setInviteContractFile] = useState(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteMsg, setInviteMsg] = useState(null);
  const [cloudFolders, setCloudFolders] = useState([]);
  const [cloudFoldersLoading, setCloudFoldersLoading] = useState(false);
  const [cloudFoldersError, setCloudFoldersError] = useState(null);
  const [blockedFolders, setBlockedFolders] = useState(new Set());
  const [driveFolders, setDriveFolders] = useState([]);
  const [driveFoldersLoading, setDriveFoldersLoading] = useState(false);
  const [selectedDriveFolder, setSelectedDriveFolder] = useState(null);
  const [editingContractor, setEditingContractor] = useState(null);
  const [editForm, setEditForm] = useState({ full_name: '', title: '', payment_type: 'hourly', rate: '', assigned_drive_folder_id: '', assigned_drive_folder_name: '', retainer_enabled: false, retainer_min_hours: '', overtime_enabled: false, overtime_max_hours: '', overtime_multiplier: '1.5' });
  const [editSaving, setEditSaving] = useState(false);
  const [deleteConfirming, setDeleteConfirming] = useState(null);

  /* ── Assignments state ── */
  const [assignments, setAssignments] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [freelancerFilter, setFreelancerFilter] = useState('all');
  const [showNewAssignment, setShowNewAssignment] = useState(false);
  const [creatingAssign, setCreatingAssign] = useState(false);
  const [expandedAssignment, setExpandedAssignment] = useState(null);
  const [assignmentComments, setAssignmentComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [commentPosting, setCommentPosting] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState(null);
  const [timeFilter, setTimeFilter] = useState('7d');
  const [viewMode, setViewMode] = useState('list');

  // New assignment form
  const [newAssign, setNewAssign] = useState({
    freelancer_id: '', title: '', description: '', asset_url: '',
    due_date: '', due_time: '', pay_amount: '', content_type: 'video',
  });

  /* ── Hours state ── */
  const [hours, setHours] = useState([]);
  const [hoursFreelancerFilter, setHoursFreelancerFilter] = useState('all');

  /* ── Documents state ── */
  const [docs, setDocs] = useState([]);
  const [docsFreelancerFilter, setDocsFreelancerFilter] = useState('all');
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadForm, setUploadForm] = useState({ title: '', description: '', doc_type: 'signing', freelancer_ids: [] });
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadLoading, setUploadLoading] = useState(false);

  /* ─────────────────────────────────────────── */
  /*  Data fetching                              */
  /* ─────────────────────────────────────────── */

  const fetchTeam = useCallback(async () => {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email, avatar_url, title, assigned_drive_folder_id, assigned_drive_folder_name')
      .eq('role', 'freelancer')
      .order('full_name');
    setFreelancers(profiles || []);

    const { data: fpData } = await supabase.from('freelancer_profiles').select('*');
    const fpMap = {};
    (fpData || []).forEach(fp => { fpMap[fp.id] = fp; });
    setFlProfiles(fpMap);

    const acData = await fetchAllRows(
      supabase
        .from('freelancer_assignments')
        .select('freelancer_id, status, declined_at')
        .order('freelancer_id', { ascending: true })
    );
    const counts = {};
    acData.forEach(a => {
      if (a.status !== 'completed' && !a.declined_at) {
        counts[a.freelancer_id] = (counts[a.freelancer_id] || 0) + 1;
      }
    });
    setAssignmentCounts(counts);
  }, []);

  const fetchFreelancerDetail = useCallback(async (fId) => {
    const { data: assigns } = await supabase
      .from('freelancer_assignments')
      .select('*')
      .eq('freelancer_id', fId)
      .order('created_at', { ascending: false })
      .limit(10);
    setFlAssignments(assigns || []);

    const { data: hrs } = await supabase
      .from('freelancer_hours')
      .select('*')
      .eq('freelancer_id', fId)
      .order('period_start', { ascending: false })
      .limit(5);
    setFlHoursSummary(hrs || []);
  }, []);

  const fetchAssignments = useCallback(async () => {
    const data = await fetchAllRows(
      supabase
        .from('freelancer_assignments')
        .select('*, freelancer:profiles!freelancer_assignments_freelancer_id_fkey(full_name, avatar_url), created_by_profile:profiles!freelancer_assignments_created_by_fkey(full_name)')
        .order('created_at', { ascending: false })
    );
    setAssignments(data);
  }, []);

  const fetchComments = useCallback(async (assignmentId) => {
    const { data } = await supabase
      .from('freelancer_assignment_comments')
      .select('*, author:profiles!freelancer_assignment_comments_author_id_fkey(full_name, avatar_url)')
      .eq('assignment_id', assignmentId)
      .order('created_at', { ascending: true });
    setAssignmentComments(data || []);
  }, []);

  const fetchHours = useCallback(async () => {
    const data = await fetchAllRows(
      supabase
        .from('freelancer_hours')
        .select('*, freelancer:profiles!freelancer_hours_freelancer_id_fkey(full_name, avatar_url)')
        .order('period_start', { ascending: false })
    );
    setHours(data);
  }, []);

  const fetchDocs = useCallback(async () => {
    const { data } = await supabase
      .from('freelancer_documents')
      .select('*, freelancer:profiles!freelancer_documents_freelancer_id_fkey(full_name)')
      .order('created_at', { ascending: false });
    setDocs(data || []);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    if (activeTab === 'Team') fetchTeam();
    if (activeTab === 'Assignments') { fetchAssignments(); fetchTeam(); }
    if (activeTab === 'Hours') { fetchHours(); fetchTeam(); }
    if (activeTab === 'Documents') { fetchDocs(); fetchTeam(); }
  }, [activeTab, isAdmin, fetchTeam, fetchAssignments, fetchHours, fetchDocs]);

  useEffect(() => {
    if (expandedAssignment) fetchComments(expandedAssignment);
  }, [expandedAssignment, fetchComments]);

  // Pay breakdown (retainer/overtime) per submitted hours entry, for hourly
  // contractors only. Uses the server-side compute_freelancer_pay so the
  // money math shown here matches the single source of truth.
  useEffect(() => {
    if (!isAdmin) return;
    const hourly = (hours || []).filter(h => flProfiles[h.freelancer_id]?.payment_type === 'hourly');
    if (hourly.length === 0) { setPayBreakdowns({}); return; }
    let cancelled = false;
    (async () => {
      const results = await Promise.all(hourly.map(async (h) => {
        const { data, error } = await supabase.rpc('compute_freelancer_pay', {
          p_freelancer: h.freelancer_id,
          p_start: h.period_start,
          p_end: h.period_end,
        });
        return [h.id, error ? null : data];
      }));
      if (!cancelled) setPayBreakdowns(Object.fromEntries(results));
    })();
    return () => { cancelled = true; };
  }, [hours, flProfiles, isAdmin]);

  // Deep-link from a notification (bell / dashboard card): open the assignment.
  useEffect(() => {
    if (!initialAssignmentId) return;
    setActiveTab('Assignments');
    setExpandedAssignment(initialAssignmentId);
    onAssignmentOpened?.();
  }, [initialAssignmentId, onAssignmentOpened]);

  // Mark fl_stuck + fl_comment notifications for this assignment as read when expanded.
  useEffect(() => {
    if (!expandedAssignment || !profile?.id) return;
    (async () => {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', profile.id)
        .in('type', ['fl_stuck', 'fl_comment'])
        .eq('link_target', expandedAssignment)
        .eq('is_read', false);
    })();
  }, [expandedAssignment, profile?.id]);

  // Fetch Cloud folders when invite form opens
  useEffect(() => {
    if (!showInviteForm) return;
    let cancelled = false;
    const fetchCloudFolders = async () => {
      setCloudFoldersLoading(true);
      setCloudFoldersError(null);
      setBlockedFolders(new Set());
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const resp = await fetch(`${process.env.REACT_APP_SUPABASE_URL}/functions/v1/cloud-folders`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!resp.ok) throw new Error('Failed to load folders');
        const folders = await resp.json();
        if (!cancelled) setCloudFolders(folders);
      } catch (err) {
        if (!cancelled) setCloudFoldersError(err.message);
      } finally {
        if (!cancelled) setCloudFoldersLoading(false);
      }
    };
    fetchCloudFolders();
    return () => { cancelled = true; };
  }, [showInviteForm]);

  // Fetch Drive contractor folders when invite form opens
  useEffect(() => {
    if (!showInviteForm && !editingContractor) return;
    let cancelled = false;
    const fetchDriveFolders = async () => {
      setDriveFoldersLoading(true);
      setSelectedDriveFolder(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const resp = await fetch(`${process.env.REACT_APP_SUPABASE_URL}/functions/v1/drive-list-contractor-folders`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!resp.ok) throw new Error('Failed to load folders');
        const json = await resp.json();
        if (!cancelled) setDriveFolders(json.folders || []);
      } catch (err) {
        console.error('Failed to fetch drive folders:', err);
        if (!cancelled) setDriveFolders([]);
      } finally {
        if (!cancelled) setDriveFoldersLoading(false);
      }
    };
    fetchDriveFolders();
    return () => { cancelled = true; };
  }, [showInviteForm, editingContractor]);

  /* ─────────────────────────────────────────── */
  /*  Handlers                                   */
  /* ─────────────────────────────────────────── */

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !inviteTitle || !inviteRate) return;
    setInviteLoading(true);
    setInviteMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      // If a contract file was selected, upload it to a pending path keyed by email hash
      let contractStoragePath = null;
      let contractFileName = null;
      if (inviteContractFile) {
        const emailHash = btoa(inviteEmail.trim().toLowerCase()).replace(/[^a-zA-Z0-9]/g, '');
        const safeName = inviteContractFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        contractStoragePath = `pending/${emailHash}/${safeName}`;
        contractFileName = inviteContractFile.name;
        const { error: uploadErr } = await supabase.storage
          .from('freelancer-documents')
          .upload(contractStoragePath, inviteContractFile, { upsert: true });
        if (uploadErr) throw new Error('Failed to upload contract: ' + uploadErr.message);
      }

      const res = await fetch(`${process.env.REACT_APP_SUPABASE_URL}/functions/v1/invite-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: 'freelancer',
          title: inviteTitle,
          payment_type: invitePaymentType,
          rate: parseFloat(inviteRate),
          retainer_enabled: invitePaymentType === 'hourly' ? inviteRetainerEnabled : false,
          retainer_min_hours: invitePaymentType === 'hourly' && inviteRetainerEnabled && inviteRetainerMin
            ? parseFloat(inviteRetainerMin) : null,
          overtime_enabled: invitePaymentType === 'hourly' ? inviteOvertimeEnabled : false,
          overtime_max_hours: invitePaymentType === 'hourly' && inviteOvertimeEnabled && inviteOvertimeMax
            ? parseFloat(inviteOvertimeMax) : null,
          overtime_multiplier: invitePaymentType === 'hourly' && inviteOvertimeMult
            ? parseFloat(inviteOvertimeMult) : 1.5,
          contract_storage_path: contractStoragePath,
          contract_file_name: contractFileName,
          blocked_folders: [...blockedFolders],
          assigned_drive_folder_id: selectedDriveFolder?.id || null,
          assigned_drive_folder_name: selectedDriveFolder?.name || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to send invite');
      setInviteMsg({ type: 'success', text: `Invite sent to ${inviteEmail.trim()}` });
      setInviteEmail('');
      setInviteTitle('');
      setInvitePaymentType('hourly');
      setInviteRate('');
      setInviteRetainerEnabled(false);
      setInviteRetainerMin('');
      setInviteOvertimeEnabled(false);
      setInviteOvertimeMax('');
      setInviteOvertimeMult('1.5');
      setInviteContractFile(null);
      setBlockedFolders(new Set());
      setSelectedDriveFolder(null);
      setShowInviteForm(false);
    } catch (err) {
      setInviteMsg({ type: 'error', text: err.message });
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCreateAssignment = async () => {
    if (!newAssign.freelancer_id || !newAssign.title.trim()) return;
    if (creatingAssign) return; // guard against double-click → duplicate rows + notifications
    setCreatingAssign(true);
    try {
      const row = {
        freelancer_id: newAssign.freelancer_id,
        title: newAssign.title.trim(),
        description: newAssign.description.trim() || null,
        asset_url: newAssign.asset_url.trim() || null,
        due_date: newAssign.due_date || null,
        due_time: newAssign.due_time || null,
        pay_amount: newAssign.pay_amount ? parseFloat(newAssign.pay_amount) : null,
        content_type: newAssign.content_type,
        created_by: profile.id,
      };
      const { error } = await supabase.from('freelancer_assignments').insert(row);
      if (error) { console.error(error); return; }

      // Notify freelancer
      await supabase.from('notifications').insert({
        user_id: newAssign.freelancer_id,
        type: 'assignment',
        title: 'New Assignment',
        body: `You have been assigned "${newAssign.title.trim()}"`,
        link_tab: 'fl_dashboard',
        link_target: null,
      });

      setNewAssign({ freelancer_id: '', title: '', description: '', asset_url: '', due_date: '', due_time: '', pay_amount: '', content_type: 'video' });
      setShowNewAssignment(false);
      fetchAssignments();
    } finally {
      setCreatingAssign(false);
    }
  };

  const handleUpdateAssignment = async () => {
    if (!editingAssignment) return;
    const { id, title, description, asset_url, assignment_type, content_type, due_date, due_time, pay_amount, status } = editingAssignment;
    const updates = {
      title, description: description || null,
      asset_url: (asset_url || '').trim() || null,
      assignment_type, content_type: content_type || 'video',
      due_date: due_date || null,
      due_time: due_time || null,
      pay_amount: pay_amount ? parseFloat(pay_amount) : null,
      status,
      completed_at: status === 'completed' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    await supabase.from('freelancer_assignments').update(updates).eq('id', id);
    setEditingAssignment(null);
    fetchAssignments();
  };

  const handleArchiveAssignment = async (id) => {
    await supabase.from('freelancer_assignments').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    setExpandedAssignment(null);
    fetchAssignments();
  };

  const startEditContractor = (fl) => {
    const fp = flProfiles[fl.id] || {};
    setEditingContractor(fl.id);
    setEditForm({
      full_name: fl.full_name || '',
      title: fl.title || '',
      payment_type: fp.payment_type || 'hourly',
      rate: fp.rate != null ? String(fp.rate) : '',
      assigned_drive_folder_id: fl.assigned_drive_folder_id || '',
      assigned_drive_folder_name: fl.assigned_drive_folder_name || '',
      retainer_enabled: !!fp.retainer_enabled,
      retainer_min_hours: fp.retainer_min_hours != null ? String(fp.retainer_min_hours) : '',
      overtime_enabled: !!fp.overtime_enabled,
      overtime_max_hours: fp.overtime_max_hours != null ? String(fp.overtime_max_hours) : '',
      overtime_multiplier: fp.overtime_multiplier != null ? String(fp.overtime_multiplier) : '1.5',
    });
  };

  const handleSaveContractor = async (flId) => {
    setEditSaving(true);
    try {
      await supabase.from('profiles').update({
        full_name: editForm.full_name.trim(),
        title: editForm.title,
        assigned_drive_folder_id: editForm.assigned_drive_folder_id || null,
        assigned_drive_folder_name: editForm.assigned_drive_folder_name || null,
      }).eq('id', flId);

      await supabase.from('freelancer_profiles').upsert({
        id: flId,
        payment_type: editForm.payment_type,
        rate: editForm.rate ? parseFloat(editForm.rate) : null,
        retainer_enabled: editForm.retainer_enabled,
        retainer_min_hours: editForm.retainer_enabled && editForm.retainer_min_hours
          ? parseFloat(editForm.retainer_min_hours) : null,
        overtime_enabled: editForm.overtime_enabled,
        overtime_max_hours: editForm.overtime_enabled && editForm.overtime_max_hours
          ? parseFloat(editForm.overtime_max_hours) : null,
        overtime_multiplier: editForm.overtime_multiplier
          ? parseFloat(editForm.overtime_multiplier) : 1.5,
      }, { onConflict: 'id' });

      setEditingContractor(null);
      fetchTeam();
    } catch (err) {
      console.error('Failed to save contractor:', err);
    }
    setEditSaving(false);
  };

  const handleDeleteContractor = async (flId) => {
    await supabase.from('profiles').update({ role: 'deactivated' }).eq('id', flId);
    setDeleteConfirming(null);
    setExpandedFreelancer(null);
    fetchTeam();
  };

  const handleDeleteAssignment = async (assignment) => {
    if (!assignment) return;
    const who = assignment.freelancer?.full_name || 'this contractor';
    if (!window.confirm(`Delete assignment "${assignment.title}" for ${who}? This cannot be undone.`)) return;
    const { error } = await supabase.from('freelancer_assignments').delete().eq('id', assignment.id);
    if (error) { console.error(error); window.alert(`Failed to delete: ${error.message}`); return; }
    setEditingAssignment(null);
    setExpandedAssignment(null);
    fetchAssignments();
  };

  const handlePostComment = async (assignment) => {
    if (!newComment.trim() || commentPosting) return;
    setCommentPosting(true);
    await supabase.from('freelancer_assignment_comments').insert({
      assignment_id: assignment.id,
      author_id: profile.id,
      body: newComment.trim(),
    });

    // Notify freelancer if admin is posting
    if (assignment.freelancer_id !== profile.id) {
      await supabase.from('notifications').insert({
        user_id: assignment.freelancer_id,
        type: 'fl_comment',
        title: 'New Comment',
        body: `${profile.full_name} commented on "${assignment.title}"`,
        link_tab: 'fl_dashboard',
        link_target: assignment.id,
      });

      supabase.functions.invoke('send-notification-email', {
        body: {
          trigger_key: 'fl_comment_on_mine',
          recipient_id: assignment.freelancer_id,
          context: { assignment_title: assignment.title, person_name: profile.full_name },
        },
      }).catch(() => {});
    }

    setNewComment('');
    setCommentPosting(false);
    fetchComments(assignment.id);
  };

  const handleReviewHours = async (hourEntry) => {
    // Already reviewed → no-op, so a second click can't re-stamp + send a dup notification.
    if (hourEntry.reviewed_at) return;
    await supabase.from('freelancer_hours').update({
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', hourEntry.id).is('reviewed_at', null);

    const periodLabel = `${formatDate(hourEntry.period_start)} - ${formatDate(hourEntry.period_end)}`;
    await supabase.from('notifications').insert({
      user_id: hourEntry.freelancer_id,
      type: 'fl_hours_reviewed',
      title: 'Hours Reviewed',
      body: `Your hours for ${periodLabel} have been reviewed.`,
      link_tab: 'fl_hours',
      link_target: null,
    });

    fetchHours();
  };

  /* ── Document handlers ── */

  const handleUploadDoc = async () => {
    if (!uploadFile || !uploadForm.title.trim() || uploadForm.freelancer_ids.length === 0) return;
    setUploadLoading(true);
    try {
      for (const fId of uploadForm.freelancer_ids) {
        const storagePath = `${fId}/${Date.now()}_${uploadFile.name}`;
        const { error: uploadError } = await supabase.storage
          .from('freelancer-documents')
          .upload(storagePath, uploadFile);
        if (uploadError) throw uploadError;

        const { error: insertError } = await supabase.from('freelancer_documents').insert({
          freelancer_id: fId,
          uploaded_by: profile.id,
          title: uploadForm.title.trim(),
          description: uploadForm.description.trim() || null,
          doc_type: uploadForm.doc_type,
          storage_path: storagePath,
          file_name: uploadFile.name,
        });
        if (insertError) throw insertError;
      }
      setShowUploadForm(false);
      setUploadForm({ title: '', description: '', doc_type: 'signing', freelancer_ids: [] });
      setUploadFile(null);
      fetchDocs();
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Upload failed: ' + err.message);
    }
    setUploadLoading(false);
  };

  const handleDeleteDoc = async (doc) => {
    if (!window.confirm(`Delete "${doc.title}" for ${doc.freelancer?.full_name}?`)) return;
    await supabase.storage.from('freelancer-documents').remove([doc.storage_path]);
    await supabase.from('freelancer_documents').delete().eq('id', doc.id);
    fetchDocs();
  };

  /* ─────────────────────────────────────────── */
  /*  Helpers                                    */
  /* ─────────────────────────────────────────── */

  const formatDate = (d) => {
    if (!d) return '--';
    const dt = new Date(d + (d.length === 10 ? 'T00:00:00' : ''));
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTimestamp = (ts) => {
    if (!ts) return '';
    const dt = new Date(ts);
    return dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  // due_time is a bare `time` column ('HH:MM:SS') → '3:30 PM'
  const formatDueTime = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  };

  const avatarLetter = (name) => (name || '?')[0].toUpperCase();

  const TIME_FILTERS = [
    { key: 'today', label: 'Today' },
    { key: '7d', label: 'Last 7 Days' },
    { key: 'pay_period', label: 'This Pay Period' },
    { key: 'month', label: 'This Month' },
  ];

  const getTimeFilterRange = (key) => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    switch (key) {
      case 'today':
        return { start: startOfDay, end: endOfDay };
      case '7d':
        return { start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), end: now };
      case 'pay_period': {
        const day = now.getDate();
        if (day <= 15) {
          return {
            start: new Date(now.getFullYear(), now.getMonth(), 1),
            end: new Date(now.getFullYear(), now.getMonth(), 15, 23, 59, 59, 999),
          };
        }
        return {
          start: new Date(now.getFullYear(), now.getMonth(), 16),
          end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
        };
      }
      case 'month':
        return {
          start: new Date(now.getFullYear(), now.getMonth(), 1),
          end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
        };
      default:
        return { start: new Date(0), end: now };
    }
  };

  const formatShortDate = (d) => {
    if (!d) return '';
    const dt = new Date(d);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  /* ─────────────────────────────────────────── */
  /*  Admin gate                                 */
  /* ─────────────────────────────────────────── */

  if (!isAdmin) {
    return (
      <div style={styles.page}>
        <p style={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginTop: 80 }}>
          Admin access required.
        </p>
      </div>
    );
  }

  /* ─────────────────────────────────────────── */
  /*  Filtered data                              */
  /* ─────────────────────────────────────────── */

  const filteredAssignments = assignments.filter(a => {
    if (statusFilter !== 'all' && a.status !== statusFilter) return false;
    if (freelancerFilter !== 'all' && a.freelancer_id !== freelancerFilter) return false;
    const { start, end } = getTimeFilterRange(timeFilter);
    const created = a.created_at ? new Date(a.created_at) : null;
    const completed = a.completed_at ? new Date(a.completed_at) : null;
    const inRange = (d) => d && d >= start && d <= end;
    if (!inRange(created) && !inRange(completed)) return false;
    return true;
  });

  const filteredHours = hours.filter(h => {
    if (hoursFreelancerFilter !== 'all' && h.freelancer_id !== hoursFreelancerFilter) return false;
    return true;
  });

  const filteredDocs = docs.filter(d => {
    if (docsFreelancerFilter !== 'all' && d.freelancer_id !== docsFreelancerFilter) return false;
    return true;
  });

  /* ─────────────────────────────────────────── */
  /*  Render                                     */
  /* ─────────────────────────────────────────── */

  return (
    <div style={styles.page}>
      <h1 style={styles.pageTitle}>Contractors</h1>

      {/* Tab bar */}
      <div style={styles.tabBar}>
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              ...styles.tabPill,
              ...(activeTab === tab ? styles.tabPillActive : {}),
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════ */}
      {/*  TAB 1: TEAM                           */}
      {/* ══════════════════════════════════════ */}
      {activeTab === 'Team' && (
        <div>
          {/* Invite section */}
          <div style={{ marginBottom: 24 }}>
            {!showInviteForm ? (
              <button style={styles.primaryBtn} onClick={() => setShowInviteForm(true)}>
                Invite Contractor
              </button>
            ) : (
              <div style={styles.card}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {/* Email */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={styles.fieldLabel}>Email</label>
                    <input
                      type="email"
                      placeholder="Email address"
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      style={styles.input}
                    />
                  </div>

                  {/* Title */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={styles.fieldLabel}>Title</label>
                    <select
                      value={inviteTitle}
                      onChange={e => setInviteTitle(e.target.value)}
                      style={styles.select}
                    >
                      <option value="">Select title...</option>
                      {FREELANCER_TITLES.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>

                  {/* Payment Type */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={styles.fieldLabel}>Payment Type</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {['hourly', 'project'].map(pt => (
                        <button
                          key={pt}
                          type="button"
                          onClick={() => setInvitePaymentType(pt)}
                          style={{
                            padding: '6px 16px',
                            borderRadius: 6,
                            border: '1px solid',
                            borderColor: invitePaymentType === pt ? '#5b8fc7' : 'rgba(255,255,255,0.12)',
                            background: invitePaymentType === pt ? 'rgba(91, 143, 199,0.15)' : 'rgba(255,255,255,0.04)',
                            color: invitePaymentType === pt ? '#8fb4d8' : 'rgba(255,255,255,0.6)',
                            fontSize: 13,
                            fontWeight: 600,
                            fontFamily: 'DM Sans, sans-serif',
                            cursor: 'pointer',
                          }}
                        >
                          {pt === 'hourly' ? 'Hourly' : 'By Project'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Rate */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={styles.fieldLabel}>
                      {invitePaymentType === 'hourly' ? 'Hourly Rate' : 'Project Rate'}
                    </label>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.4)', fontSize: 14, pointerEvents: 'none' }}>$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={inviteRate}
                        onChange={e => setInviteRate(e.target.value)}
                        style={{ ...styles.input, paddingLeft: 24 }}
                      />
                    </div>
                  </div>

                  {/* Hourly Payroll Settings (retainer + overtime) */}
                  {invitePaymentType === 'hourly' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: 14 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: colors.accentFg, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Hourly Payroll Settings
                      </div>
                      {/* Retainer */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#fff' }}>
                          <input
                            type="checkbox"
                            checked={inviteRetainerEnabled}
                            onChange={e => setInviteRetainerEnabled(e.target.checked)}
                            style={{ accentColor: '#5b8fc7' }}
                          />
                          Retainer (guaranteed minimum)
                        </label>
                        {inviteRetainerEnabled && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>min hrs / retainer week</span>
                            <input
                              type="number"
                              min="0"
                              step="0.25"
                              value={inviteRetainerMin}
                              onChange={e => setInviteRetainerMin(e.target.value)}
                              style={{ ...styles.input, width: 90 }}
                            />
                          </span>
                        )}
                      </div>
                      {/* Overtime */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#fff' }}>
                          <input
                            type="checkbox"
                            checked={inviteOvertimeEnabled}
                            onChange={e => setInviteOvertimeEnabled(e.target.checked)}
                            style={{ accentColor: '#5b8fc7' }}
                          />
                          Overtime (needs approval)
                        </label>
                        {inviteOvertimeEnabled && (
                          <>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>after (hrs)</span>
                              <input
                                type="number"
                                min="0"
                                step="0.25"
                                value={inviteOvertimeMax}
                                onChange={e => setInviteOvertimeMax(e.target.value)}
                                style={{ ...styles.input, width: 90 }}
                              />
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>× rate</span>
                              <input
                                type="number"
                                min="1"
                                step="0.1"
                                value={inviteOvertimeMult}
                                onChange={e => setInviteOvertimeMult(e.target.value)}
                                style={{ ...styles.input, width: 70 }}
                              />
                            </span>
                          </>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
                        Retainer weeks split each pay period: 1–7, 8–15, 16–22, 23–EOM. The floor is guaranteed per week; the overtime cap resets each week. Over-cap hours pay at the multiplier only after an admin or Director of Creative approves.
                      </div>
                    </div>
                  )}

                  {/* Contract Upload */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={styles.fieldLabel}>Contract (optional)</label>
                    {inviteContractFile ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {inviteContractFile.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => setInviteContractFile(null)}
                          style={{ background: 'none', border: 'none', color: '#f87171', fontSize: 12, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <label style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        padding: '10px 16px', borderRadius: 6, border: '1px dashed rgba(255,255,255,0.15)',
                        background: 'rgba(255,255,255,0.02)', cursor: 'pointer', fontSize: 13,
                        color: 'rgba(255,255,255,0.45)',
                      }}>
                        Upload PDF
                        <input
                          type="file"
                          accept=".pdf"
                          style={{ display: 'none' }}
                          onChange={e => { if (e.target.files[0]) setInviteContractFile(e.target.files[0]); }}
                        />
                      </label>
                    )}
                  </div>

                  {/* Assigned Drive Folder */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={styles.fieldLabel}>Assigned Folder (optional)</label>
                    {driveFoldersLoading ? (
                      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Loading folders...</span>
                    ) : driveFolders.length > 0 ? (
                      <select
                        value={selectedDriveFolder ? selectedDriveFolder.id : ''}
                        onChange={e => {
                          const folder = driveFolders.find(f => f.id === e.target.value);
                          setSelectedDriveFolder(folder || null);
                        }}
                        style={styles.select}
                      >
                        <option value="">None</option>
                        {driveFolders.map(f => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>No folders available</span>
                    )}
                  </div>

                  {/* Mayday Cloud Access */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={styles.fieldLabel}>Mayday Cloud Access</label>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>
                      Uncheck folders this contractor should not access
                    </span>
                    {cloudFoldersLoading ? (
                      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Loading folders...</span>
                    ) : cloudFoldersError ? (
                      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>Could not load Cloud folders</span>
                    ) : cloudFolders.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto', padding: '8px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                        {cloudFolders.map(folder => (
                          <label key={folder.path} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>
                            <input
                              type="checkbox"
                              checked={!blockedFolders.has(folder.path)}
                              onChange={() => {
                                setBlockedFolders(prev => {
                                  const next = new Set(prev);
                                  if (next.has(folder.path)) next.delete(folder.path);
                                  else next.add(folder.path);
                                  return next;
                                });
                              }}
                              style={{ accentColor: '#5b8fc7' }}
                            />
                            {folder.name}
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                    <button
                      style={{
                        ...styles.primaryBtn,
                        opacity: (!inviteEmail.trim() || !inviteTitle || !inviteRate) ? 0.5 : 1,
                      }}
                      onClick={handleInvite}
                      disabled={inviteLoading || !inviteEmail.trim() || !inviteTitle || !inviteRate}
                    >
                      {inviteLoading ? 'Sending...' : 'Send Invite'}
                    </button>
                    <button
                      style={styles.secondaryBtn}
                      onClick={() => {
                        setShowInviteForm(false);
                        setInviteEmail('');
                        setInviteTitle('');
                        setInvitePaymentType('hourly');
                        setInviteRate('');
                        setInviteContractFile(null);
                        setBlockedFolders(new Set());
                        setSelectedDriveFolder(null);
                        setInviteMsg(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
            {inviteMsg && (
              <p style={{
                marginTop: 8,
                fontSize: 13,
                color: inviteMsg.type === 'success' ? '#34d399' : '#f87171',
              }}>
                {inviteMsg.text}
              </p>
            )}
          </div>

          {/* Freelancer list */}
          {freelancers.length === 0 ? (
            <p style={styles.emptyText}>No contractors yet. Invite one above.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {freelancers.map(fl => {
                const fp = flProfiles[fl.id] || {};
                const activeCount = assignmentCounts[fl.id] || 0;
                const isExpanded = expandedFreelancer === fl.id;
                return (
                  <div key={fl.id} style={styles.card}>
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}
                      onClick={() => {
                        if (isExpanded) {
                          setExpandedFreelancer(null);
                        } else {
                          setExpandedFreelancer(fl.id);
                          fetchFreelancerDetail(fl.id);
                        }
                      }}
                    >
                      {/* Avatar */}
                      {fl.avatar_url ? (
                        <img
                          src={fl.avatar_url}
                          alt=""
                          style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                        />
                      ) : (
                        <div style={styles.avatar}>
                          {avatarLetter(fl.full_name)}
                        </div>
                      )}

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: '#fff', fontSize: 15 }}>
                          {fl.full_name || 'Unnamed'}
                        </div>
                        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
                          {fl.email}
                        </div>
                      </div>

                      {/* Badges */}
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                        {fl.title && (
                          <span style={styles.badge}>
                            {fl.title}
                          </span>
                        )}
                        {fp.rate && (
                          <span style={{ ...styles.badge, background: colors.accentA15, color: colors.accentFg }}>
                            ${Number(fp.rate).toFixed(0)}{fp.payment_type === 'hourly' ? '/hr' : '/proj'}
                          </span>
                        )}
                        <span style={{ ...styles.badge, background: activeCount > 0 ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.06)', color: activeCount > 0 ? '#fbbf24' : 'rgba(255,255,255,0.4)' }}>
                          {activeCount} active
                        </span>
                        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
                          {isExpanded ? '\u25B2' : '\u25BC'}
                        </span>
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16 }}>
                        {/* Recent assignments */}
                        <h4 style={styles.sectionLabel}>Recent Assignments</h4>
                        {flAssignments.length === 0 ? (
                          <p style={styles.emptyTextSmall}>No assignments.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {flAssignments.map(a => (
                              <div key={a.id} style={styles.miniRow}>
                                {a.declined_at ? (
                                  <span style={{ ...styles.statusBadge, background: 'rgba(239,68,68,0.15)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}>
                                    Declined
                                  </span>
                                ) : (
                                  <span style={{ ...styles.statusBadge, ...STATUS_BADGE_COLORS[a.status] }}>
                                    {STATUS_LABELS[a.status]}
                                  </span>
                                )}
                                <span style={{ color: '#fff', fontSize: 13, flex: 1 }}>{a.title}</span>
                                {a.due_date && <span style={{ fontSize: 12, color: colors.textDim }}>Due {formatDate(a.due_date)}{a.due_time ? ` · ${formatDueTime(a.due_time)}` : ''}</span>}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Hours summary */}
                        <h4 style={{ ...styles.sectionLabel, marginTop: 16 }}>Recent Hours</h4>
                        {flHoursSummary.length === 0 ? (
                          <p style={styles.emptyTextSmall}>No hours submitted.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {flHoursSummary.map(h => (
                              <div key={h.id} style={styles.miniRow}>
                                <span style={{ color: '#fff', fontSize: 13, flex: 1 }}>
                                  {formatDate(h.period_start)} - {formatDate(h.period_end)}
                                </span>
                                <span style={{ fontSize: 13, color: colors.accentFg, fontWeight: 600 }}>
                                  {Number(h.total_hours).toFixed(1)}h
                                </span>
                                {h.reviewed_at ? (
                                  <span style={{ fontSize: 12, color: '#34d399' }}>Reviewed</span>
                                ) : (
                                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>Pending</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Contractor details / edit */}
                        <h4 style={{ ...styles.sectionLabel, marginTop: 16 }}>Details</h4>
                        {editingContractor === fl.id ? (
                          <div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px' }}>
                              <div style={styles.formField}>
                                <label style={styles.label}>Name</label>
                                <input
                                  value={editForm.full_name}
                                  onChange={e => setEditForm(p => ({ ...p, full_name: e.target.value }))}
                                  style={styles.input}
                                />
                              </div>
                              <div style={styles.formField}>
                                <label style={styles.label}>Title</label>
                                <select
                                  value={editForm.title}
                                  onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))}
                                  style={styles.select}
                                >
                                  <option value="">Select title...</option>
                                  {FREELANCER_TITLES.map(t => (
                                    <option key={t} value={t}>{t}</option>
                                  ))}
                                </select>
                              </div>
                              <div style={styles.formField}>
                                <label style={styles.label}>Payment Type</label>
                                <select
                                  value={editForm.payment_type}
                                  onChange={e => setEditForm(p => ({ ...p, payment_type: e.target.value }))}
                                  style={styles.select}
                                >
                                  <option value="hourly">Hourly</option>
                                  <option value="project">By Project</option>
                                </select>
                              </div>
                              <div style={styles.formField}>
                                <label style={styles.label}>Rate ($)</label>
                                <input
                                  type="number"
                                  value={editForm.rate}
                                  onChange={e => setEditForm(p => ({ ...p, rate: e.target.value }))}
                                  style={styles.input}
                                  min="0"
                                  step="0.01"
                                />
                              </div>
                              {editForm.payment_type === 'hourly' && (
                                <div style={{ ...styles.formField, gridColumn: '1 / -1', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: 14, gap: 12 }}>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: colors.accentFg, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                    Hourly Payroll Settings
                                  </div>
                                  {/* Retainer */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#fff' }}>
                                      <input
                                        type="checkbox"
                                        checked={editForm.retainer_enabled}
                                        onChange={e => setEditForm(p => ({ ...p, retainer_enabled: e.target.checked }))}
                                      />
                                      Retainer (guaranteed minimum)
                                    </label>
                                    {editForm.retainer_enabled && (
                                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>min hrs / retainer week</span>
                                        <input
                                          type="number"
                                          min="0"
                                          step="0.25"
                                          value={editForm.retainer_min_hours}
                                          onChange={e => setEditForm(p => ({ ...p, retainer_min_hours: e.target.value }))}
                                          style={{ ...styles.input, width: 90 }}
                                        />
                                      </span>
                                    )}
                                  </div>
                                  {/* Overtime */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#fff' }}>
                                      <input
                                        type="checkbox"
                                        checked={editForm.overtime_enabled}
                                        onChange={e => setEditForm(p => ({ ...p, overtime_enabled: e.target.checked }))}
                                      />
                                      Overtime (needs approval)
                                    </label>
                                    {editForm.overtime_enabled && (
                                      <>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>after (hrs)</span>
                                          <input
                                            type="number"
                                            min="0"
                                            step="0.25"
                                            value={editForm.overtime_max_hours}
                                            onChange={e => setEditForm(p => ({ ...p, overtime_max_hours: e.target.value }))}
                                            style={{ ...styles.input, width: 90 }}
                                          />
                                        </span>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>× rate</span>
                                          <input
                                            type="number"
                                            min="1"
                                            step="0.1"
                                            value={editForm.overtime_multiplier}
                                            onChange={e => setEditForm(p => ({ ...p, overtime_multiplier: e.target.value }))}
                                            style={{ ...styles.input, width: 70 }}
                                          />
                                        </span>
                                      </>
                                    )}
                                  </div>
                                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
                                    Retainer weeks split each pay period: 1–7, 8–15, 16–22, 23–EOM. The floor is guaranteed per week; the overtime cap resets each week. Over-cap hours pay at the multiplier only after an admin or Director of Creative approves.
                                  </div>
                                </div>
                              )}
                              <div style={{ ...styles.formField, gridColumn: '1 / -1' }}>
                                <label style={styles.label}>Assigned Drive Folder</label>
                                {driveFoldersLoading ? (
                                  <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Loading folders...</span>
                                ) : driveFolders.length > 0 ? (
                                  <select
                                    value={editForm.assigned_drive_folder_id}
                                    onChange={e => {
                                      const folder = driveFolders.find(f => f.id === e.target.value);
                                      setEditForm(p => ({
                                        ...p,
                                        assigned_drive_folder_id: folder?.id || '',
                                        assigned_drive_folder_name: folder?.name || '',
                                      }));
                                    }}
                                    style={styles.select}
                                  >
                                    <option value="">None</option>
                                    {driveFolders.map(f => (
                                      <option key={f.id} value={f.id}>{f.name}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>No folders available</span>
                                )}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                              <button
                                style={styles.primaryBtn}
                                onClick={() => handleSaveContractor(fl.id)}
                                disabled={editSaving}
                              >
                                {editSaving ? 'Saving...' : 'Save'}
                              </button>
                              <button style={styles.secondaryBtn} onClick={() => setEditingContractor(null)}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px' }}>
                              <div>
                                <div style={styles.fieldLabel}>Email</div>
                                <div style={{ color: '#fff', fontSize: 13, marginTop: 2 }}>{fl.email || '--'}</div>
                              </div>
                              <div>
                                <div style={styles.fieldLabel}>Title</div>
                                <div style={{ color: '#fff', fontSize: 13, marginTop: 2 }}>{fl.title || '--'}</div>
                              </div>
                              {fp.payment_type && (
                                <div>
                                  <div style={styles.fieldLabel}>Payment Type</div>
                                  <div style={{ color: '#fff', fontSize: 13, marginTop: 2 }}>
                                    {fp.payment_type === 'hourly' ? 'Hourly' : 'By Project'}
                                  </div>
                                </div>
                              )}
                              {fp.rate != null && (
                                <div>
                                  <div style={styles.fieldLabel}>Rate</div>
                                  <div style={{ color: '#fff', fontSize: 13, marginTop: 2 }}>
                                    ${Number(fp.rate).toFixed(2)}{fp.payment_type === 'hourly' ? '/hr' : '/proj'}
                                  </div>
                                </div>
                              )}
                              {fp.payment_type === 'hourly' && (fp.retainer_enabled || fp.overtime_enabled) && (
                                <div style={{ gridColumn: '1 / -1' }}>
                                  <div style={styles.fieldLabel}>Payroll Rules</div>
                                  <div style={{ color: '#fff', fontSize: 13, marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    {fp.retainer_enabled && (
                                      <span style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 5, padding: '2px 8px' }}>
                                        Retainer floor {fp.retainer_min_hours != null ? `${fp.retainer_min_hours}h/wk` : '—'}
                                      </span>
                                    )}
                                    {fp.overtime_enabled && (
                                      <span style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 5, padding: '2px 8px' }}>
                                        OT &gt; {fp.overtime_max_hours != null ? `${fp.overtime_max_hours}h/wk` : '—'} @ {Number(fp.overtime_multiplier || 1.5)}×
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}
                              {fl.assigned_drive_folder_name && (
                                <div style={{ gridColumn: '1 / -1' }}>
                                  <div style={styles.fieldLabel}>Assigned Drive Folder</div>
                                  <div style={{ color: '#fff', fontSize: 13, marginTop: 2 }}>
                                    {fl.assigned_drive_folder_name}
                                  </div>
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                              <button style={styles.secondaryBtn} onClick={() => startEditContractor(fl)}>
                                Edit
                              </button>
                              {deleteConfirming === fl.id ? (
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                  <span style={{ fontSize: 13, color: '#f87171' }}>Remove contractor?</span>
                                  <button
                                    style={{ ...styles.primaryBtn, background: '#ef4444', fontSize: 12, padding: '6px 14px' }}
                                    onClick={() => handleDeleteContractor(fl.id)}
                                  >
                                    Yes, Remove
                                  </button>
                                  <button
                                    style={{ ...styles.secondaryBtn, fontSize: 12, padding: '6px 14px' }}
                                    onClick={() => setDeleteConfirming(null)}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  style={{ ...styles.secondaryBtn, borderColor: 'rgba(248,113,113,0.3)', color: '#f87171' }}
                                  onClick={() => setDeleteConfirming(fl.id)}
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════ */}
      {/*  TAB 2: ASSIGNMENTS                    */}
      {/* ══════════════════════════════════════ */}
      {activeTab === 'Assignments' && (
        <div>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
            {/* Status pills */}
            <button
              onClick={() => setStatusFilter('all')}
              style={{ ...styles.filterPill, ...(statusFilter === 'all' ? styles.filterPillActive : {}) }}
            >
              All
            </button>
            {STATUS_OPTIONS.map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                style={{ ...styles.filterPill, ...(statusFilter === s ? styles.filterPillActive : {}) }}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}

            {/* Divider */}
            <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)' }} />

            {/* Time filter pills */}
            {TIME_FILTERS.map(tf => (
              <button
                key={tf.key}
                onClick={() => setTimeFilter(tf.key)}
                style={{ ...styles.filterPill, ...(timeFilter === tf.key ? styles.filterPillActive : {}) }}
              >
                {tf.label}
              </button>
            ))}

            {/* Freelancer dropdown */}
            <select
              value={freelancerFilter}
              onChange={e => setFreelancerFilter(e.target.value)}
              style={styles.select}
            >
              <option value="all">All Contractors</option>
              {freelancers.map(fl => (
                <option key={fl.id} value={fl.id}>{fl.full_name || fl.email}</option>
              ))}
            </select>

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* View toggle */}
            <div style={{ display: 'flex', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, overflow: 'hidden' }}>
              <button
                onClick={() => setViewMode('list')}
                style={{ ...styles.filterPill, borderRadius: 0, border: 'none', padding: '6px 10px', ...(viewMode === 'list' ? styles.filterPillActive : {}) }}
                title="List view"
              >
                ☰
              </button>
              <button
                onClick={() => setViewMode('kanban')}
                style={{ ...styles.filterPill, borderRadius: 0, border: 'none', borderLeft: '1px solid rgba(255,255,255,0.08)', padding: '6px 10px', ...(viewMode === 'kanban' ? styles.filterPillActive : {}) }}
                title="Kanban view"
              >
                ▥
              </button>
            </div>
          </div>

          {/* New assignment button/form */}
          {!showNewAssignment ? (
            <button style={{ ...styles.primaryBtn, marginBottom: 20 }} onClick={() => setShowNewAssignment(true)}>
              New Assignment
            </button>
          ) : (
            <div style={{ ...styles.card, marginBottom: 20 }}>
              <h3 style={{ color: '#fff', fontSize: 15, fontWeight: 600, marginBottom: 14, marginTop: 0 }}>Create Assignment</h3>
              <div style={styles.formGrid}>
                <div style={styles.formField}>
                  <label style={styles.label}>Contractor *</label>
                  <select
                    value={newAssign.freelancer_id}
                    onChange={e => setNewAssign(p => ({ ...p, freelancer_id: e.target.value }))}
                    style={styles.select}
                  >
                    <option value="">Select...</option>
                    {freelancers.map(fl => (
                      <option key={fl.id} value={fl.id}>{fl.full_name || fl.email}{fl.title ? ` — ${fl.title}` : ''}</option>
                    ))}
                  </select>
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Title *</label>
                  <input
                    value={newAssign.title}
                    onChange={e => setNewAssign(p => ({ ...p, title: e.target.value }))}
                    style={styles.input}
                    placeholder="Assignment title"
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Content Type</label>
                  <select
                    value={newAssign.content_type}
                    onChange={e => setNewAssign(p => ({ ...p, content_type: e.target.value }))}
                    style={styles.select}
                  >
                    <option value="video">Video</option>
                    <option value="podcast">Podcast</option>
                  </select>
                </div>
                <div style={{ ...styles.formField, gridColumn: '1 / -1' }}>
                  <label style={styles.label}>Description</label>
                  <textarea
                    value={newAssign.description}
                    onChange={e => setNewAssign(p => ({ ...p, description: e.target.value }))}
                    style={{ ...styles.input, minHeight: 70, resize: 'vertical' }}
                    placeholder="Optional description"
                  />
                </div>
                <div style={{ ...styles.formField, gridColumn: '1 / -1' }}>
                  <label style={styles.label}>Asset Link</label>
                  <input
                    value={newAssign.asset_url}
                    onChange={e => setNewAssign(p => ({ ...p, asset_url: e.target.value }))}
                    style={styles.input}
                    placeholder="Paste an Assets Library, Drive, or other URL"
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Due Date</label>
                  <input
                    type="date"
                    value={newAssign.due_date}
                    onChange={e => setNewAssign(p => ({ ...p, due_date: e.target.value }))}
                    style={styles.input}
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Due Time</label>
                  <input
                    type="time"
                    value={newAssign.due_time}
                    onChange={e => setNewAssign(p => ({ ...p, due_time: e.target.value }))}
                    style={styles.input}
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Pay Amount ($)</label>
                  <input
                    type="number"
                    value={newAssign.pay_amount}
                    onChange={e => setNewAssign(p => ({ ...p, pay_amount: e.target.value }))}
                    style={styles.input}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button style={styles.primaryBtn} onClick={handleCreateAssignment} disabled={creatingAssign}>
                  {creatingAssign ? 'Creating…' : 'Create'}
                </button>
                <button style={styles.secondaryBtn} onClick={() => setShowNewAssignment(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Kanban view */}
          {viewMode === 'kanban' && (
            <div style={styles.kanbanContainer}>
              {[
                { key: 'assigned', label: 'Assigned' },
                { key: 'in_progress', label: 'In Progress' },
                { key: 'completed', label: 'Completed' },
              ].map(col => {
                const colItems = filteredAssignments.filter(a => a.status === col.key);
                const colors = STATUS_BADGE_COLORS[col.key] || {};
                return (
                  <div key={col.key} style={styles.kanbanColumn}>
                    <div style={{ ...styles.kanbanColumnHeader, background: colors.bg || 'rgba(255,255,255,0.05)' }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: colors.color || '#fff' }}>{col.label}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: colors.color || 'rgba(255,255,255,0.5)' }}>{colItems.length}</span>
                    </div>
                    <div style={styles.kanbanColumnBody}>
                      {colItems.length === 0 ? (
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', textAlign: 'center', padding: '20px 0' }}>
                          No assignments
                        </div>
                      ) : colItems.map(a => (
                        <div key={a.id} style={styles.kanbanCard}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                            <div style={{ ...styles.avatar, width: 26, height: 26, fontSize: 11 }}>
                              {avatarLetter(a.freelancer?.full_name)}
                            </div>
                            <span style={{ fontWeight: 600, color: '#fff', fontSize: 13 }}>
                              {a.freelancer?.full_name || 'Unknown'}
                            </span>
                          </div>
                          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', marginBottom: 6 }}>
                            {a.title}
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                            <span style={{ ...styles.typeBadge }}>
                              {TYPE_LABELS[a.assignment_type] || a.assignment_type}
                            </span>
                            {a.due_date && (
                              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                                Due {formatDate(a.due_date)}{a.due_time ? ` · ${formatDueTime(a.due_time)}` : ''}
                              </span>
                            )}
                            {a.pay_amount && (
                              <span style={{ fontSize: 11, color: '#34d399', fontWeight: 600 }}>
                                ${Number(a.pay_amount).toFixed(2)}
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                            {a.created_at && (
                              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
                                Assigned {formatShortDate(a.created_at)}
                              </span>
                            )}
                            {a.status === 'completed' && a.completed_at && (
                              <span style={{ fontSize: 10, color: '#34d399' }}>
                                Completed {formatShortDate(a.completed_at)}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Assignment list */}
          {viewMode === 'list' && filteredAssignments.length === 0 ? (
            <p style={styles.emptyText}>No assignments found.</p>
          ) : viewMode === 'list' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {filteredAssignments.map(a => {
                const isExpanded = expandedAssignment === a.id;
                const isEditing = editingAssignment?.id === a.id;
                return (
                  <div key={a.id} style={styles.card}>
                    {/* Assignment header row */}
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                      onClick={() => {
                        if (isExpanded) {
                          setExpandedAssignment(null);
                          setEditingAssignment(null);
                        } else {
                          setExpandedAssignment(a.id);
                          setEditingAssignment(null);
                        }
                      }}
                    >
                      <div style={styles.avatar}>
                        {avatarLetter(a.freelancer?.full_name)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, color: '#fff', fontSize: 14 }}>
                            {a.freelancer?.full_name || 'Unknown'}
                          </span>
                          <span style={{ ...styles.typeBadge }}>
                            {TYPE_LABELS[a.assignment_type] || a.assignment_type}
                          </span>
                        </div>
                        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)', marginTop: 3 }}>
                          {a.title}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                        {a.created_at && (
                          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
                            Assigned {formatShortDate(a.created_at)}
                          </span>
                        )}
                        {a.status === 'completed' && a.completed_at && (
                          <span style={{ fontSize: 11, color: '#34d399' }}>
                            Completed {formatShortDate(a.completed_at)}
                          </span>
                        )}
                        {a.due_date && (
                          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                            Due {formatDate(a.due_date)}{a.due_time ? ` · ${formatDueTime(a.due_time)}` : ''}
                          </span>
                        )}
                        {a.pay_amount && (
                          <span style={{ fontSize: 13, color: '#34d399', fontWeight: 600 }}>
                            ${Number(a.pay_amount).toFixed(2)}
                          </span>
                        )}
                        {a.declined_at ? (
                          <span
                            style={{
                              ...styles.statusBadge,
                              background: 'rgba(239,68,68,0.15)',
                              color: '#fca5a5',
                              border: '1px solid rgba(239,68,68,0.3)',
                            }}
                            title={`Declined ${formatTimestamp(a.declined_at)}`}
                          >
                            Declined
                          </span>
                        ) : (
                          <span style={{ ...styles.statusBadge, ...STATUS_BADGE_COLORS[a.status] }}>
                            {STATUS_LABELS[a.status]}
                          </span>
                        )}
                        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
                          {isExpanded ? '\u25B2' : '\u25BC'}
                        </span>
                      </div>
                    </div>

                    {/* Expanded: description, edit, comments */}
                    {isExpanded && (
                      <div style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16 }}>
                        {/* Edit toggle */}
                        {!isEditing ? (
                          <div>
                            {a.description && (
                              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, margin: '0 0 12px', lineHeight: 1.5 }}>
                                {a.description}
                              </p>
                            )}
                            {a.asset_url && (
                              <p style={{ margin: '0 0 12px' }}>
                                <a
                                  href={a.asset_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '6px 12px',
                                    background: colors.accentA15,
                                    color: colors.accentFg,
                                    borderRadius: 8,
                                    fontSize: 13,
                                    fontWeight: 500,
                                    textDecoration: 'none',
                                    border: '1px solid rgba(91, 143, 199,0.3)',
                                  }}
                                >
                                  Open asset link
                                </a>
                              </p>
                            )}
                            {a.created_by_profile && (
                              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', margin: '0 0 12px' }}>
                                Created by {a.created_by_profile.full_name} on {formatTimestamp(a.created_at)}
                              </p>
                            )}
                            <button
                              style={styles.secondaryBtn}
                              onClick={() => setEditingAssignment({
                                id: a.id,
                                title: a.title,
                                description: a.description || '',
                                asset_url: a.asset_url || '',
                                assignment_type: a.assignment_type,
                                content_type: a.content_type || 'video',
                                due_date: a.due_date || '',
                                due_time: (a.due_time || '').slice(0, 5),
                                pay_amount: a.pay_amount || '',
                                status: a.status,
                              })}
                            >
                              Edit
                            </button>
                          </div>
                        ) : (
                          <div>
                            <div style={styles.formGrid}>
                              <div style={styles.formField}>
                                <label style={styles.label}>Title</label>
                                <input
                                  value={editingAssignment.title}
                                  onChange={e => setEditingAssignment(p => ({ ...p, title: e.target.value }))}
                                  style={styles.input}
                                />
                              </div>
                              <div style={styles.formField}>
                                <label style={styles.label}>Type</label>
                                <select
                                  value={editingAssignment.assignment_type}
                                  onChange={e => setEditingAssignment(p => ({ ...p, assignment_type: e.target.value }))}
                                  style={styles.select}
                                >
                                  {TYPE_OPTIONS.map(t => (
                                    <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                                  ))}
                                </select>
                              </div>
                              <div style={styles.formField}>
                                <label style={styles.label}>Content Type</label>
                                <select
                                  value={editingAssignment.content_type || 'video'}
                                  onChange={e => setEditingAssignment(p => ({ ...p, content_type: e.target.value }))}
                                  style={styles.select}
                                >
                                  <option value="video">Video</option>
                                  <option value="podcast">Podcast</option>
                                </select>
                              </div>
                              <div style={{ ...styles.formField, gridColumn: '1 / -1' }}>
                                <label style={styles.label}>Description</label>
                                <textarea
                                  value={editingAssignment.description}
                                  onChange={e => setEditingAssignment(p => ({ ...p, description: e.target.value }))}
                                  style={{ ...styles.input, minHeight: 60, resize: 'vertical' }}
                                />
                              </div>
                              <div style={{ ...styles.formField, gridColumn: '1 / -1' }}>
                                <label style={styles.label}>Asset Link</label>
                                <input
                                  value={editingAssignment.asset_url || ''}
                                  onChange={e => setEditingAssignment(p => ({ ...p, asset_url: e.target.value }))}
                                  style={styles.input}
                                  placeholder="Paste an Assets Library, Drive, or other URL"
                                />
                              </div>
                              <div style={styles.formField}>
                                <label style={styles.label}>Due Date</label>
                                <input
                                  type="date"
                                  value={editingAssignment.due_date}
                                  onChange={e => setEditingAssignment(p => ({ ...p, due_date: e.target.value }))}
                                  style={styles.input}
                                />
                              </div>
                              <div style={styles.formField}>
                                <label style={styles.label}>Due Time</label>
                                <input
                                  type="time"
                                  value={editingAssignment.due_time}
                                  onChange={e => setEditingAssignment(p => ({ ...p, due_time: e.target.value }))}
                                  style={styles.input}
                                />
                              </div>
                              <div style={styles.formField}>
                                <label style={styles.label}>Pay Amount ($)</label>
                                <input
                                  type="number"
                                  value={editingAssignment.pay_amount}
                                  onChange={e => setEditingAssignment(p => ({ ...p, pay_amount: e.target.value }))}
                                  style={styles.input}
                                  min="0"
                                  step="0.01"
                                />
                              </div>
                              <div style={styles.formField}>
                                <label style={styles.label}>Status</label>
                                <select
                                  value={editingAssignment.status}
                                  onChange={e => setEditingAssignment(p => ({ ...p, status: e.target.value }))}
                                  style={styles.select}
                                >
                                  {STATUS_OPTIONS.map(s => (
                                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
                              <button style={styles.primaryBtn} onClick={handleUpdateAssignment}>
                                Save
                              </button>
                              <button style={styles.secondaryBtn} onClick={() => setEditingAssignment(null)}>
                                Cancel
                              </button>
                              <button
                                style={{
                                  marginLeft: 'auto',
                                  padding: '8px 14px',
                                  background: 'rgba(239,68,68,0.12)',
                                  color: '#fca5a5',
                                  border: '1px solid rgba(239,68,68,0.3)',
                                  borderRadius: 8,
                                  fontSize: 13,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  fontFamily: 'inherit',
                                }}
                                onClick={() => handleDeleteAssignment(a)}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Comment thread */}
                        <div style={{ marginTop: 20, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16 }}>
                          <h4 style={styles.sectionLabel}>Comments</h4>
                          {assignmentComments.length === 0 ? (
                            <p style={styles.emptyTextSmall}>No comments yet.</p>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                              {assignmentComments.map(c => (
                                <div key={c.id} style={styles.commentRow}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                    <span style={{ fontWeight: 600, fontSize: 13, color: '#fff' }}>
                                      {c.author?.full_name || 'Unknown'}
                                    </span>
                                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                                      {formatTimestamp(c.created_at)}
                                    </span>
                                  </div>
                                  <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>
                                    {c.body}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 8 }}>
                            <input
                              placeholder="Add a comment..."
                              value={newComment}
                              onChange={e => setNewComment(e.target.value)}
                              style={{ ...styles.input, flex: 1 }}
                              onKeyDown={e => e.key === 'Enter' && handlePostComment(a)}
                            />
                            <button
                              style={styles.primaryBtn}
                              onClick={() => handlePostComment(a)}
                              disabled={commentPosting || !newComment.trim()}
                            >
                              Post
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════ */}
      {/*  TAB 3: HOURS                          */}
      {/* ══════════════════════════════════════ */}
      {activeTab === 'Hours' && (
        <div>
          {/* Filter */}
          <div style={{ marginBottom: 16 }}>
            <select
              value={hoursFreelancerFilter}
              onChange={e => setHoursFreelancerFilter(e.target.value)}
              style={styles.select}
            >
              <option value="all">All Contractors</option>
              {freelancers.map(fl => (
                <option key={fl.id} value={fl.id}>{fl.full_name || fl.email}</option>
              ))}
            </select>
          </div>

          {/* Hours list */}
          {filteredHours.length === 0 ? (
            <p style={styles.emptyText}>No hours submitted.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filteredHours.map(h => (
                <div key={h.id} style={styles.card}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={styles.avatar}>
                      {avatarLetter(h.freelancer?.full_name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: '#fff', fontSize: 14 }}>
                        {h.freelancer?.full_name || 'Unknown'}
                      </div>
                      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                        {formatDate(h.period_start)} - {formatDate(h.period_end)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 15, color: colors.accentFg, fontWeight: 700 }}> // style-lint-ignore
                        {Number(h.total_hours).toFixed(1)}h
                      </span>
                      {h.notes && (
                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {h.notes}
                        </span>
                      )}
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
                        Submitted {formatTimestamp(h.submitted_at)}
                      </span>
                      {h.reviewed_at ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: '#34d399', fontSize: 16 }}>{'\u2713'}</span>
                          <span style={{ fontSize: 12, color: '#34d399' }}>
                            Reviewed {formatTimestamp(h.reviewed_at)}
                          </span>
                        </div>
                      ) : (
                        <button
                          style={styles.reviewBtn}
                          onClick={() => handleReviewHours(h)}
                        >
                          Review
                        </button>
                      )}
                    </div>
                  </div>
                  {payBreakdowns[h.id] && payBreakdowns[h.id].payment_type === 'hourly' && (
                    <PayBreakdown data={payBreakdowns[h.id]} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════ */}
      {/*  TAB 4: DOCUMENTS                      */}
      {/* ══════════════════════════════════════ */}
      {activeTab === 'Documents' && (
        <div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
            <button style={styles.primaryBtn} onClick={() => setShowUploadForm(v => !v)}>
              {showUploadForm ? 'Cancel' : 'Upload Document'}
            </button>
            <select
              value={docsFreelancerFilter}
              onChange={e => setDocsFreelancerFilter(e.target.value)}
              style={styles.select}
            >
              <option value="all">All Contractors</option>
              {freelancers.map(fl => (
                <option key={fl.id} value={fl.id}>{fl.full_name || fl.email}</option>
              ))}
            </select>
          </div>

          {showUploadForm && (
            <div style={{ ...styles.card, marginBottom: 20 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: '#e2e8f0', margin: '0 0 14px' }}>Upload Document</h3>
              <div style={styles.formGrid}>
                <div style={styles.formField}>
                  <label style={styles.label}>Title</label>
                  <input
                    type="text"
                    value={uploadForm.title}
                    onChange={e => setUploadForm(p => ({ ...p, title: e.target.value }))}
                    placeholder="Document title"
                    style={styles.input}
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Type</label>
                  <select
                    value={uploadForm.doc_type}
                    onChange={e => setUploadForm(p => ({ ...p, doc_type: e.target.value }))}
                    style={styles.select}
                  >
                    <option value="signing">Signing</option>
                    <option value="reference">Reference</option>
                  </select>
                </div>
                <div style={{ ...styles.formField, gridColumn: '1 / -1' }}>
                  <label style={styles.label}>Description (optional)</label>
                  <input
                    type="text"
                    value={uploadForm.description}
                    onChange={e => setUploadForm(p => ({ ...p, description: e.target.value }))}
                    placeholder="Brief description"
                    style={styles.input}
                  />
                </div>
                <div style={{ ...styles.formField, gridColumn: '1 / -1' }}>
                  <label style={styles.label}>Contractor(s)</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {freelancers.map(fl => {
                      const sel = uploadForm.freelancer_ids.includes(fl.id);
                      return (
                        <button
                          key={fl.id}
                          type="button"
                          onClick={() => setUploadForm(p => ({
                            ...p,
                            freelancer_ids: sel
                              ? p.freelancer_ids.filter(x => x !== fl.id)
                              : [...p.freelancer_ids, fl.id],
                          }))}
                          style={{
                            ...styles.filterPill,
                            ...(sel ? styles.filterPillActive : {}),
                          }}
                        >
                          {fl.full_name || fl.email}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>PDF File</label>
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={e => setUploadFile(e.target.files?.[0] || null)}
                    style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}
                  />
                </div>
              </div>
              <div style={{ marginTop: 14 }}>
                <button
                  onClick={handleUploadDoc}
                  disabled={uploadLoading || !uploadFile || !uploadForm.title.trim() || uploadForm.freelancer_ids.length === 0}
                  style={{
                    ...styles.primaryBtn,
                    ...(uploadLoading ? { opacity: 0.5 } : {}),
                  }}
                >
                  {uploadLoading ? 'Uploading...' : 'Upload'}
                </button>
              </div>
            </div>
          )}

          {filteredDocs.length === 0 ? (
            <p style={styles.emptyText}>No documents uploaded yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredDocs.map(doc => (
                <div key={doc.id} style={{ ...styles.card, display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>
                      {doc.title}
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                      {doc.freelancer?.full_name || 'Unknown'} · {doc.file_name} · {formatDate(doc.created_at?.slice(0, 10))}
                    </div>
                    {doc.description && (
                      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{doc.description}</div>
                    )}
                  </div>
                  <span style={{
                    ...styles.typeBadge,
                    ...(doc.doc_type === 'reference' ? { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' } : {}),
                  }}>
                    {doc.doc_type === 'signing' ? 'Sign' : 'Reference'}
                  </span>
                  {doc.doc_type === 'signing' && (
                    <span style={{
                      ...styles.statusBadge,
                      ...(doc.signed_at
                        ? { background: 'rgba(34,197,94,0.15)', color: '#34d399' }
                        : { background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }),
                    }}>
                      {doc.signed_at ? 'Signed' : 'Pending'}
                    </span>
                  )}
                  <button
                    onClick={() => handleDeleteDoc(doc)}
                    style={{
                      padding: '4px 10px', background: 'transparent',
                      border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6,
                      color: '#ef4444', fontSize: 12, cursor: 'pointer',
                      fontFamily: 'DM Sans, sans-serif', flexShrink: 0,
                    }}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────── */
/*  Pay breakdown (admin reviewer)             */
/* ─────────────────────────────────────────── */

function PayBreakdown({ data }) {
  if (!data || !Array.isArray(data.windows)) return null;
  const money = (n) => `$${Number(n || 0).toFixed(2)}`;
  const fmtDay = (s) => {
    if (!s) return '';
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const computedHours = Number(data.total_hours || 0);
  return (
    <div style={pbStyles.wrap}>
      <div style={pbStyles.header}>
        <span style={pbStyles.title}>Computed pay</span>
        <span style={pbStyles.total}>{money(data.total_pay)}</span>
      </div>
      <div style={pbStyles.subline}>
        Rate {money(data.rate)}/hr · {computedHours}h from completed assignments
      </div>
      <div style={pbStyles.grid}>
        {data.windows.map((w, i) => (
          <div key={i} style={pbStyles.window}>
            <div style={pbStyles.winHead}>
              {fmtDay(w.window_start)}–{fmtDay(w.window_end)}
              <span style={pbStyles.winPay}>{money(w.pay)}</span>
            </div>
            <div style={pbStyles.winMeta}>
              <span>{Number(w.hours)}h logged</span>
              {w.floor_applied && <span style={pbStyles.floorTag}>retainer floor {Number(w.retainer_min)}h</span>}
              {Number(w.overtime_hours) > 0 && (
                <span style={pbStyles.otTag}>
                  {Number(w.overtime_hours)}h OT × {Number(w.overtime_multiplier)}{w.approved ? '' : ' (unapproved)'}
                </span>
              )}
              {w.overtime_max != null && Number(w.hours) > Number(w.overtime_max) && !w.approved && (
                <span style={pbStyles.pendingTag}>over cap — OT not approved</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const pbStyles = {
  wrap: { marginTop: 12, paddingTop: 12, borderTop: `1px solid ${colors.border}` },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { fontSize: 11, fontWeight: 700, color: colors.accentFg, textTransform: 'uppercase', letterSpacing: 0.5 },
  total: { fontSize: 16, fontWeight: 700, color: colors.text },
  subline: { fontSize: 12, color: colors.textSubtle, marginTop: 4 },
  grid: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 },
  window: { flex: '1 1 200px', background: colors.bgInput, borderRadius: 8, padding: '8px 12px' },
  winHead: { display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: colors.textMuted },
  winPay: { color: colors.text },
  winMeta: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4, fontSize: 11, color: colors.textDim },
  floorTag: { color: colors.accentFg },
  otTag: { color: colors.emerald.fgSoft },
  pendingTag: { color: colors.gold },
};

/* ─────────────────────────────────────────── */
/*  Styles                                     */
/* ─────────────────────────────────────────── */

const styles = {
  page: {
    padding: '36px 40px 64px',
    maxWidth: '1500px',
    margin: '0 auto',
    minHeight: '100vh',
    background: colors.bg,
    fontFamily: 'DM Sans, sans-serif',
  },
  pageTitle: {
    fontSize: 26,
    fontWeight: 700,
    color: '#fff',
    margin: '0 0 24px',
  },

  /* Tabs */
  tabBar: {
    display: 'flex',
    gap: 8,
    marginBottom: 28,
  },
  tabPill: {
    padding: '8px 18px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.55)',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
    transition: 'all 0.15s',
  },
  tabPillActive: {
    background: colors.accent,
    color: '#fff',
    borderColor: colors.accent,
  },

  /* Cards */
  card: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 20,
  },

  /* Avatar */
  avatar: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: colors.accent,
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: 15,
    flexShrink: 0,
  },

  /* Badges */
  badge: {
    padding: '3px 10px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 500,
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.6)',
  },
  statusBadge: {
    padding: '3px 10px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  typeBadge: {
    padding: '2px 8px',
    borderRadius: 5,
    fontSize: 11,
    fontWeight: 500,
    background: colors.accentA12,
    color: colors.accentFg,
  },

  /* Buttons */
  primaryBtn: {
    padding: '8px 18px',
    borderRadius: 8,
    border: 'none',
    background: colors.accent,
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
  },
  secondaryBtn: {
    padding: '8px 18px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'transparent',
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
  },
  reviewBtn: {
    padding: '5px 14px',
    borderRadius: 7,
    border: '1px solid rgba(52,211,153,0.3)',
    background: 'rgba(52,211,153,0.1)',
    color: '#34d399',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
  },

  /* Filters */
  filterPill: {
    padding: '6px 14px',
    borderRadius: 7,
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
  },
  filterPillActive: {
    background: colors.accent,
    color: '#fff',
    borderColor: colors.accent,
  },

  /* Form */
  formGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 14,
  },
  formField: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: 500,
    color: 'rgba(255,255,255,0.45)',
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.05)',
    color: '#fff',
    fontSize: 13,
    fontFamily: 'DM Sans, sans-serif',
    outline: 'none',
  },
  select: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.05)',
    color: '#fff',
    fontSize: 13,
    fontFamily: 'DM Sans, sans-serif',
    outline: 'none',
  },

  /* Section labels */
  sectionLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    margin: '0 0 10px',
  },

  /* Kanban */
  kanbanContainer: { display: 'flex', gap: 16, minHeight: 400 },
  kanbanColumn: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  kanbanColumnHeader: { padding: '10px 12px', borderRadius: '10px 10px 0 0', marginBottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  kanbanColumnBody: { flex: 1, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '0 0 10px 10px', padding: 8, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' },
  kanbanCard: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: 12 },

  /* Mini rows (in expanded freelancer) */
  miniRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '6px 10px',
    borderRadius: 6,
    background: 'rgba(255,255,255,0.02)',
  },

  /* Comments */
  commentRow: {
    padding: '10px 12px',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.03)',
  },

  /* Empty states */
  emptyText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 14,
    textAlign: 'center',
    padding: '40px 0',
  },
  emptyTextSmall: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 13,
    margin: '4px 0',
  },
};

export default Freelancers;
