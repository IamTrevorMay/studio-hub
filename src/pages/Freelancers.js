import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';

const TABS = ['Team', 'Assignments', 'Hours'];

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

/* ─────────────────────────────────────────── */
/*  Component                                  */
/* ─────────────────────────────────────────── */

function Freelancers() {
  const { profile, isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState('Team');

  /* ── Team state ── */
  const [freelancers, setFreelancers] = useState([]);
  const [flProfiles, setFlProfiles] = useState({});
  const [assignmentCounts, setAssignmentCounts] = useState({});
  const [expandedFreelancer, setExpandedFreelancer] = useState(null);
  const [flAssignments, setFlAssignments] = useState([]);
  const [flHoursSummary, setFlHoursSummary] = useState([]);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteMsg, setInviteMsg] = useState(null);

  /* ── Assignments state ── */
  const [assignments, setAssignments] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [freelancerFilter, setFreelancerFilter] = useState('all');
  const [showNewAssignment, setShowNewAssignment] = useState(false);
  const [expandedAssignment, setExpandedAssignment] = useState(null);
  const [assignmentComments, setAssignmentComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [commentPosting, setCommentPosting] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState(null);

  // New assignment form
  const [newAssign, setNewAssign] = useState({
    freelancer_id: '', title: '', description: '', assignment_type: 'other',
    due_date: '', pay_amount: '', project_id: '', deliverable_id: '', mayday_video_id: '',
  });

  /* ── Hours state ── */
  const [hours, setHours] = useState([]);
  const [hoursFreelancerFilter, setHoursFreelancerFilter] = useState('all');

  /* ─────────────────────────────────────────── */
  /*  Data fetching                              */
  /* ─────────────────────────────────────────── */

  const fetchTeam = useCallback(async () => {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email, avatar_url')
      .eq('role', 'freelancer')
      .order('full_name');
    setFreelancers(profiles || []);

    const { data: fpData } = await supabase.from('freelancer_profiles').select('*');
    const fpMap = {};
    (fpData || []).forEach(fp => { fpMap[fp.id] = fp; });
    setFlProfiles(fpMap);

    const { data: acData } = await supabase
      .from('freelancer_assignments')
      .select('freelancer_id, status');
    const counts = {};
    (acData || []).forEach(a => {
      if (a.status !== 'completed') {
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
    const { data } = await supabase
      .from('freelancer_assignments')
      .select('*, freelancer:profiles!freelancer_assignments_freelancer_id_fkey(full_name, avatar_url), created_by_profile:profiles!freelancer_assignments_created_by_fkey(full_name)')
      .order('created_at', { ascending: false });
    setAssignments(data || []);
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
    const { data } = await supabase
      .from('freelancer_hours')
      .select('*, freelancer:profiles!freelancer_hours_freelancer_id_fkey(full_name, avatar_url)')
      .order('period_start', { ascending: false });
    setHours(data || []);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    if (activeTab === 'Team') fetchTeam();
    if (activeTab === 'Assignments') { fetchAssignments(); fetchTeam(); }
    if (activeTab === 'Hours') { fetchHours(); fetchTeam(); }
  }, [activeTab, isAdmin, fetchTeam, fetchAssignments, fetchHours]);

  useEffect(() => {
    if (expandedAssignment) fetchComments(expandedAssignment);
  }, [expandedAssignment, fetchComments]);

  /* ─────────────────────────────────────────── */
  /*  Handlers                                   */
  /* ─────────────────────────────────────────── */

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteLoading(true);
    setInviteMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${process.env.REACT_APP_SUPABASE_URL}/functions/v1/invite-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ email: inviteEmail.trim(), role: 'freelancer' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to send invite');
      setInviteMsg({ type: 'success', text: `Invite sent to ${inviteEmail.trim()}` });
      setInviteEmail('');
      setShowInviteForm(false);
    } catch (err) {
      setInviteMsg({ type: 'error', text: err.message });
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCreateAssignment = async () => {
    if (!newAssign.freelancer_id || !newAssign.title.trim()) return;
    const row = {
      freelancer_id: newAssign.freelancer_id,
      title: newAssign.title.trim(),
      description: newAssign.description.trim() || null,
      assignment_type: newAssign.assignment_type,
      due_date: newAssign.due_date || null,
      pay_amount: newAssign.pay_amount ? parseFloat(newAssign.pay_amount) : null,
      project_id: newAssign.project_id.trim() || null,
      deliverable_id: newAssign.deliverable_id.trim() || null,
      mayday_video_id: newAssign.mayday_video_id.trim() || null,
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

    setNewAssign({ freelancer_id: '', title: '', description: '', assignment_type: 'other', due_date: '', pay_amount: '', project_id: '', deliverable_id: '', mayday_video_id: '' });
    setShowNewAssignment(false);
    fetchAssignments();
  };

  const handleUpdateAssignment = async () => {
    if (!editingAssignment) return;
    const { id, title, description, assignment_type, due_date, pay_amount, status } = editingAssignment;
    const updates = {
      title, description: description || null,
      assignment_type, due_date: due_date || null,
      pay_amount: pay_amount ? parseFloat(pay_amount) : null,
      status,
      completed_at: status === 'completed' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    await supabase.from('freelancer_assignments').update(updates).eq('id', id);
    setEditingAssignment(null);
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
    }

    setNewComment('');
    setCommentPosting(false);
    fetchComments(assignment.id);
  };

  const handleReviewHours = async (hourEntry) => {
    await supabase.from('freelancer_hours').update({
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', hourEntry.id);

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

  const avatarLetter = (name) => (name || '?')[0].toUpperCase();

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
    return true;
  });

  const filteredHours = hours.filter(h => {
    if (hoursFreelancerFilter !== 'all' && h.freelancer_id !== hoursFreelancerFilter) return false;
    return true;
  });

  /* ─────────────────────────────────────────── */
  /*  Render                                     */
  /* ─────────────────────────────────────────── */

  return (
    <div style={styles.page}>
      <h1 style={styles.pageTitle}>Freelancers</h1>

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
                Invite Freelancer
              </button>
            ) : (
              <div style={styles.card}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input
                    type="email"
                    placeholder="Email address"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    style={styles.input}
                    onKeyDown={e => e.key === 'Enter' && handleInvite()}
                  />
                  <button
                    style={styles.primaryBtn}
                    onClick={handleInvite}
                    disabled={inviteLoading}
                  >
                    {inviteLoading ? 'Sending...' : 'Send Invite'}
                  </button>
                  <button
                    style={styles.secondaryBtn}
                    onClick={() => { setShowInviteForm(false); setInviteEmail(''); setInviteMsg(null); }}
                  >
                    Cancel
                  </button>
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
            <p style={styles.emptyText}>No freelancers yet. Invite one above.</p>
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
                      <div style={styles.avatar}>
                        {avatarLetter(fl.full_name)}
                      </div>

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
                        {fp.specialty && (
                          <span style={styles.badge}>
                            {SPECIALTY_LABELS[fp.specialty] || fp.specialty}
                          </span>
                        )}
                        {fp.hourly_rate && (
                          <span style={{ ...styles.badge, background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}>
                            ${Number(fp.hourly_rate).toFixed(0)}/hr
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
                                <span style={{ ...styles.statusBadge, ...STATUS_BADGE_COLORS[a.status] }}>
                                  {STATUS_LABELS[a.status]}
                                </span>
                                <span style={{ color: '#fff', fontSize: 13, flex: 1 }}>{a.title}</span>
                                {a.due_date && <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Due {formatDate(a.due_date)}</span>}
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
                                <span style={{ fontSize: 13, color: '#818cf8', fontWeight: 600 }}>
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

            {/* Freelancer dropdown */}
            <select
              value={freelancerFilter}
              onChange={e => setFreelancerFilter(e.target.value)}
              style={styles.select}
            >
              <option value="all">All Freelancers</option>
              {freelancers.map(fl => (
                <option key={fl.id} value={fl.id}>{fl.full_name || fl.email}</option>
              ))}
            </select>
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
                  <label style={styles.label}>Freelancer *</label>
                  <select
                    value={newAssign.freelancer_id}
                    onChange={e => setNewAssign(p => ({ ...p, freelancer_id: e.target.value }))}
                    style={styles.select}
                  >
                    <option value="">Select...</option>
                    {freelancers.map(fl => (
                      <option key={fl.id} value={fl.id}>{fl.full_name || fl.email}</option>
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
                <div style={{ ...styles.formField, gridColumn: '1 / -1' }}>
                  <label style={styles.label}>Description</label>
                  <textarea
                    value={newAssign.description}
                    onChange={e => setNewAssign(p => ({ ...p, description: e.target.value }))}
                    style={{ ...styles.input, minHeight: 70, resize: 'vertical' }}
                    placeholder="Optional description"
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Type</label>
                  <select
                    value={newAssign.assignment_type}
                    onChange={e => setNewAssign(p => ({ ...p, assignment_type: e.target.value }))}
                    style={styles.select}
                  >
                    {TYPE_OPTIONS.map(t => (
                      <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                    ))}
                  </select>
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
                <div style={styles.formField}>
                  <label style={styles.label}>Project ID</label>
                  <input
                    value={newAssign.project_id}
                    onChange={e => setNewAssign(p => ({ ...p, project_id: e.target.value }))}
                    style={styles.input}
                    placeholder="Optional UUID"
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Deliverable ID</label>
                  <input
                    value={newAssign.deliverable_id}
                    onChange={e => setNewAssign(p => ({ ...p, deliverable_id: e.target.value }))}
                    style={styles.input}
                    placeholder="Optional UUID"
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Mayday Video ID</label>
                  <input
                    value={newAssign.mayday_video_id}
                    onChange={e => setNewAssign(p => ({ ...p, mayday_video_id: e.target.value }))}
                    style={styles.input}
                    placeholder="Optional UUID"
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button style={styles.primaryBtn} onClick={handleCreateAssignment}>
                  Create
                </button>
                <button style={styles.secondaryBtn} onClick={() => setShowNewAssignment(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Assignment list */}
          {filteredAssignments.length === 0 ? (
            <p style={styles.emptyText}>No assignments found.</p>
          ) : (
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
                        {a.due_date && (
                          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                            Due {formatDate(a.due_date)}
                          </span>
                        )}
                        {a.pay_amount && (
                          <span style={{ fontSize: 13, color: '#34d399', fontWeight: 600 }}>
                            ${Number(a.pay_amount).toFixed(2)}
                          </span>
                        )}
                        <span style={{ ...styles.statusBadge, ...STATUS_BADGE_COLORS[a.status] }}>
                          {STATUS_LABELS[a.status]}
                        </span>
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
                                assignment_type: a.assignment_type,
                                due_date: a.due_date || '',
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
                              <div style={{ ...styles.formField, gridColumn: '1 / -1' }}>
                                <label style={styles.label}>Description</label>
                                <textarea
                                  value={editingAssignment.description}
                                  onChange={e => setEditingAssignment(p => ({ ...p, description: e.target.value }))}
                                  style={{ ...styles.input, minHeight: 60, resize: 'vertical' }}
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
                            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                              <button style={styles.primaryBtn} onClick={handleUpdateAssignment}>
                                Save
                              </button>
                              <button style={styles.secondaryBtn} onClick={() => setEditingAssignment(null)}>
                                Cancel
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
              <option value="all">All Freelancers</option>
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
                      <span style={{ fontSize: 15, color: '#818cf8', fontWeight: 700 }}>
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
/*  Styles                                     */
/* ─────────────────────────────────────────── */

const styles = {
  page: {
    padding: '32px 40px',
    minHeight: '100vh',
    background: '#0f0f1a',
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
    background: '#6366f1',
    color: '#fff',
    borderColor: '#6366f1',
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
    background: '#6366f1',
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
    background: 'rgba(99,102,241,0.12)',
    color: '#a5b4fc',
  },

  /* Buttons */
  primaryBtn: {
    padding: '8px 18px',
    borderRadius: 8,
    border: 'none',
    background: '#6366f1',
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
    background: '#6366f1',
    color: '#fff',
    borderColor: '#6366f1',
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
