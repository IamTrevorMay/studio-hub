import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';

const STATUS_LABELS = {
  assigned: 'Assigned',
  in_progress: 'In Progress',
  completed: 'Completed',
};

const STATUS_BADGE_COLORS = {
  assigned: { bg: 'rgba(96,165,250,0.15)', color: '#60a5fa' },
  in_progress: { bg: 'rgba(251,191,36,0.15)', color: '#fbbf24' },
  completed: { bg: 'rgba(52,211,153,0.15)', color: '#34d399' },
};

const TYPE_ICONS = {
  edit: '\u2702\uFE0F',
  design: '\uD83C\uDFA8',
  write: '\u270D\uFE0F',
  other: '\uD83D\uDCCB',
};

function formatRelativeTime(dateString) {
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDueDate(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getDueDateStatus(dateString) {
  if (!dateString) return 'none';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateString + 'T00:00:00');
  due.setHours(0, 0, 0, 0);
  if (due < today) return 'overdue';
  if (due.getTime() === today.getTime()) return 'today';
  return 'future';
}

export default function FreelancerDashboard({ onNavigate }) {
  const { profile } = useAuth();

  const [assignments, setAssignments] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  // ── Data Fetching ──────────────────────────────────────────────

  const fetchAssignments = useCallback(async () => {
    if (!profile?.id) return;
    const { data } = await supabase
      .from('freelancer_assignments')
      .select('*, created_by_profile:profiles!freelancer_assignments_created_by_fkey(full_name, avatar_url)')
      .eq('freelancer_id', profile.id)
      .order('created_at', { ascending: false });
    setAssignments(data || []);
    setLoading(false);
  }, [profile?.id]);

  const fetchComments = useCallback(async (assignmentId) => {
    if (!assignmentId) return;
    const { data } = await supabase
      .from('freelancer_assignment_comments')
      .select('*, author:profiles!freelancer_assignment_comments_author_id_fkey(full_name, avatar_url)')
      .eq('assignment_id', assignmentId)
      .order('created_at', { ascending: true });
    setComments(data || []);
  }, []);

  useEffect(() => {
    fetchAssignments();
  }, [fetchAssignments]);

  useEffect(() => {
    if (selectedId) {
      fetchComments(selectedId);
    } else {
      setComments([]);
    }
  }, [selectedId, fetchComments]);

  // ── Realtime ───────────────────────────────────────────────────

  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase.channel('fl-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'freelancer_assignments', filter: `freelancer_id=eq.${profile.id}` }, () => fetchAssignments())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'freelancer_assignment_comments' }, () => { if (selectedId) fetchComments(selectedId); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id, fetchAssignments, fetchComments, selectedId]);

  // ── Handlers ───────────────────────────────────────────────────

  async function handleStatusChange(assignment, newStatus) {
    const updates = { status: newStatus, updated_at: new Date().toISOString() };
    if (newStatus === 'completed') updates.completed_at = new Date().toISOString();
    await supabase.from('freelancer_assignments').update(updates).eq('id', assignment.id);

    if (newStatus === 'completed' && assignment.created_by) {
      await supabase.from('notifications').insert({
        user_id: assignment.created_by,
        type: 'fl_assignment_completed',
        title: 'Assignment Completed',
        body: `${profile.full_name} completed "${assignment.title}"`,
        link_tab: 'freelancers',
        link_target: assignment.id,
      });
    }
    fetchAssignments();
  }

  async function handlePostComment() {
    if (!newComment.trim()) return;
    await supabase.from('freelancer_assignment_comments').insert({
      assignment_id: selectedId,
      author_id: profile.id,
      body: newComment.trim(),
    });

    const assignment = assignments.find(a => a.id === selectedId);
    if (assignment?.created_by && assignment.created_by !== profile.id) {
      await supabase.from('notifications').insert({
        user_id: assignment.created_by,
        type: 'fl_comment',
        title: 'New Comment',
        body: `${profile.full_name} commented on "${assignment.title}"`,
        link_tab: 'freelancers',
        link_target: assignment.id,
      });
    }
    setNewComment('');
    fetchComments(selectedId);
  }

  // ── Derived ────────────────────────────────────────────────────

  const filteredAssignments = statusFilter === 'all'
    ? assignments
    : assignments.filter(a => a.status === statusFilter);

  // ── Render ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={styles.page}>
        <p style={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginTop: 80 }}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>My Assignments</h1>
        <p style={styles.subtitle}>
          {assignments.length} total &middot; {assignments.filter(a => a.status === 'in_progress').length} in progress
        </p>
      </div>

      {/* Status Filter Pills */}
      <div style={styles.filterRow}>
        {['all', 'assigned', 'in_progress', 'completed'].map(f => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            style={{
              ...styles.filterPill,
              ...(statusFilter === f ? styles.filterPillActive : {}),
            }}
          >
            {f === 'all' ? 'All' : STATUS_LABELS[f]}
          </button>
        ))}
      </div>

      {/* Assignment Cards */}
      <div style={styles.cardList}>
        {filteredAssignments.length === 0 && (
          <p style={styles.emptyText}>
            {statusFilter === 'all' ? 'No assignments yet.' : `No ${STATUS_LABELS[statusFilter]?.toLowerCase()} assignments.`}
          </p>
        )}

        {filteredAssignments.map(a => {
          const isExpanded = selectedId === a.id;
          const dueDateStatus = getDueDateStatus(a.due_date);
          const badge = STATUS_BADGE_COLORS[a.status] || STATUS_BADGE_COLORS.assigned;
          const typeIcon = TYPE_ICONS[a.type] || TYPE_ICONS.other;

          return (
            <div key={a.id} style={styles.cardWrapper}>
              {/* Card header (always visible) */}
              <div
                style={{
                  ...styles.card,
                  ...(isExpanded ? styles.cardExpanded : {}),
                }}
                onClick={() => setSelectedId(isExpanded ? null : a.id)}
              >
                <div style={styles.cardRow}>
                  {/* Left: icon + title + due */}
                  <div style={styles.cardLeft}>
                    <span style={styles.typeIcon}>{typeIcon}</span>
                    <div>
                      <span style={styles.cardTitle}>{a.title}</span>
                      {a.due_date && (
                        <span style={{
                          ...styles.dueDate,
                          color: dueDateStatus === 'overdue' ? '#ef4444'
                            : dueDateStatus === 'today' ? '#fbbf24'
                            : 'rgba(255,255,255,0.45)',
                        }}>
                          Due {formatDueDate(a.due_date)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: pay + status */}
                  <div style={styles.cardRight}>
                    {a.pay_amount_cents != null && a.pay_amount_cents > 0 && (
                      <span style={styles.payBadge}>
                        ${(a.pay_amount_cents / 100).toFixed(2)}
                      </span>
                    )}
                    <span style={{
                      ...styles.statusBadge,
                      background: badge.bg,
                      color: badge.color,
                    }}>
                      {STATUS_LABELS[a.status] || a.status}
                    </span>
                  </div>
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div style={styles.expandedSection}>
                  {/* Description */}
                  {a.description && (
                    <p style={styles.description}>{a.description}</p>
                  )}

                  {/* Linked references */}
                  {a.project_id && (
                    <p style={styles.linkedRef}>Project: {a.project_id}</p>
                  )}
                  {a.deliverable_id && (
                    <p style={styles.linkedRef}>Deliverable: {a.deliverable_id}</p>
                  )}

                  {/* Assigned by */}
                  {a.created_by_profile?.full_name && (
                    <p style={styles.assignedBy}>
                      Assigned by {a.created_by_profile.full_name}
                    </p>
                  )}

                  {/* Status action buttons */}
                  <div style={styles.actionRow}>
                    {a.status === 'assigned' && (
                      <button
                        style={styles.actionButton}
                        onClick={(e) => { e.stopPropagation(); handleStatusChange(a, 'in_progress'); }}
                      >
                        Start Working
                      </button>
                    )}
                    {a.status === 'in_progress' && (
                      <button
                        style={{ ...styles.actionButton, ...styles.actionButtonComplete }}
                        onClick={(e) => { e.stopPropagation(); handleStatusChange(a, 'completed'); }}
                      >
                        Mark Complete
                      </button>
                    )}
                    {a.status === 'completed' && (
                      <div style={styles.completedIndicator}>
                        <span style={{ color: '#34d399', marginRight: 6 }}>&#10003;</span>
                        Completed {a.completed_at ? formatRelativeTime(a.completed_at) : ''}
                      </div>
                    )}
                  </div>

                  {/* Comment Thread */}
                  <div style={styles.commentSection}>
                    <h4 style={styles.commentHeader}>Comments</h4>

                    {comments.length === 0 && (
                      <p style={styles.noComments}>No comments yet.</p>
                    )}

                    {comments.map(c => (
                      <div key={c.id} style={styles.commentRow}>
                        <div style={styles.commentAvatar}>
                          {(c.author?.full_name || '?')[0].toUpperCase()}
                        </div>
                        <div style={styles.commentBody}>
                          <div style={styles.commentMeta}>
                            <span style={styles.commentAuthor}>{c.author?.full_name || 'Unknown'}</span>
                            <span style={styles.commentTime}>{formatRelativeTime(c.created_at)}</span>
                          </div>
                          <p style={styles.commentText}>{c.body}</p>
                        </div>
                      </div>
                    ))}

                    {/* New comment input */}
                    <div style={styles.commentInputRow}>
                      <input
                        type="text"
                        placeholder="Write a comment..."
                        value={newComment}
                        onChange={e => setNewComment(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handlePostComment(); }}
                        style={styles.commentInput}
                      />
                      <button
                        onClick={handlePostComment}
                        disabled={!newComment.trim()}
                        style={{
                          ...styles.postButton,
                          opacity: newComment.trim() ? 1 : 0.4,
                        }}
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
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const styles = {
  page: {
    minHeight: '100vh',
    background: '#0f0f1a',
    padding: '32px 24px',
    fontFamily: 'DM Sans, sans-serif',
    color: 'rgba(255,255,255,0.9)',
    maxWidth: 800,
    margin: '0 auto',
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    color: '#fff',
    margin: 0,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.45)',
    margin: '6px 0 0',
  },

  // Filter pills
  filterRow: {
    display: 'flex',
    gap: 8,
    marginBottom: 24,
    flexWrap: 'wrap',
  },
  filterPill: {
    padding: '6px 16px',
    borderRadius: 20,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
    transition: 'all 0.15s',
  },
  filterPillActive: {
    background: '#6366f1',
    color: '#fff',
    borderColor: '#6366f1',
  },

  // Card list
  cardList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  emptyText: {
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'center',
    padding: '40px 0',
    fontSize: 14,
  },

  // Card
  cardWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  card: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: '16px 20px',
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  cardExpanded: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottom: 'none',
  },
  cardRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  typeIcon: {
    fontSize: 20,
    flexShrink: 0,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: '#fff',
    display: 'block',
  },
  dueDate: {
    fontSize: 12,
    marginTop: 2,
    display: 'block',
  },
  cardRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  payBadge: {
    fontSize: 13,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.7)',
  },
  statusBadge: {
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    whiteSpace: 'nowrap',
  },

  // Expanded section
  expandedSection: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderTop: 'none',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    padding: '16px 20px 20px',
  },
  description: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 1.6,
    margin: '0 0 12px',
  },
  linkedRef: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    margin: '0 0 4px',
    fontFamily: 'monospace',
  },
  assignedBy: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    margin: '8px 0 0',
    fontStyle: 'italic',
  },

  // Action buttons
  actionRow: {
    marginTop: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  actionButton: {
    padding: '8px 20px',
    borderRadius: 8,
    border: 'none',
    background: '#6366f1',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
    transition: 'opacity 0.15s',
  },
  actionButtonComplete: {
    background: '#22c55e',
  },
  completedIndicator: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    display: 'flex',
    alignItems: 'center',
  },

  // Comments
  commentSection: {
    marginTop: 20,
    borderTop: '1px solid rgba(255,255,255,0.06)',
    paddingTop: 16,
  },
  commentHeader: {
    fontSize: 13,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.6)',
    margin: '0 0 12px',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  noComments: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.3)',
    margin: '0 0 12px',
  },
  commentRow: {
    display: 'flex',
    gap: 10,
    marginBottom: 12,
  },
  commentAvatar: {
    width: 30,
    height: 30,
    borderRadius: '50%',
    background: '#6366f1',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 700,
    flexShrink: 0,
  },
  commentBody: {
    flex: 1,
    minWidth: 0,
  },
  commentMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  commentAuthor: {
    fontSize: 13,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.8)',
  },
  commentTime: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
  },
  commentText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    margin: 0,
    lineHeight: 1.5,
  },
  commentInputRow: {
    display: 'flex',
    gap: 8,
    marginTop: 12,
  },
  commentInput: {
    flex: 1,
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    color: '#fff',
    fontSize: 13,
    fontFamily: 'DM Sans, sans-serif',
    outline: 'none',
  },
  postButton: {
    padding: '8px 16px',
    borderRadius: 8,
    border: 'none',
    background: '#6366f1',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
    transition: 'opacity 0.15s',
  },
};
