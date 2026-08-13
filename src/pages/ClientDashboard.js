import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../supabaseClient';
import useRealtimeTable from '../hooks/useRealtimeTable';
import ContractorAssignmentModal from '../components/ContractorAssignmentModal';
import { getDisplayName, getDisplayInitial } from '../lib/displayName';
import { colors } from '../lib/styleTokens';

// Client portal home: the client's own projects (contractor_assignments rows
// they created), comment threads, and links out to the review room. All writes
// ride client-scoped RLS. Alerts live on the Notifications tab (cl_notifications)
// and the bell — this page deliberately carries no notifications strip.

const STATUS_LABELS = {
  assigned: 'Waiting to start',
  in_progress: 'In progress',
  completed: 'Completed',
};

const STATUS_COLORS = {
  assigned: { bg: 'rgba(96,165,250,0.15)', color: '#60a5fa' },
  in_progress: { bg: 'rgba(251,191,36,0.15)', color: '#fbbf24' },
  completed: { bg: 'rgba(52,211,153,0.15)', color: '#34d399' },
};

const FILTERS = [
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
];

function formatRelativeTime(dateString) {
  const now = new Date();
  const date = new Date(dateString);
  const diffMins = Math.floor((now - date) / 60000);
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

export default function ClientDashboard({ onNavigate, initialAssignmentId, onAssignmentOpened }) {
  const { profile } = useAuth();

  const [editors, setEditors] = useState([]);
  const [driveFolderUrl, setDriveFolderUrl] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [reviewsByAssignment, setReviewsByAssignment] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('active');
  const [selectedId, setSelectedId] = useState(null);

  // Comments (for the selected assignment)
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [postingComment, setPostingComment] = useState(false);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState(null);

  // Toast
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const showToast = useCallback((text, type = 'success') => {
    setToast({ text, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  // Consume the deep-link prop exactly once per incoming id.
  const openedInitialRef = useRef(null);

  // ── Data fetching ──────────────────────────────────────────────

  const fetchEditors = useCallback(async () => {
    const { data, error } = await supabase.rpc('client_editor_options');
    if (!error) setEditors(data || []);
  }, []);

  const fetchClientProfile = useCallback(async () => {
    if (!profile?.id) return;
    const { data } = await supabase
      .from('client_profiles')
      .select('drive_folder_url')
      .eq('id', profile.id)
      .maybeSingle();
    setDriveFolderUrl(data?.drive_folder_url || null);
  }, [profile?.id]);

  const fetchAssignments = useCallback(async () => {
    if (!profile?.id) return;
    // Column-name FK hint (the constraint kept its legacy
    // freelancer_assignments_freelancer_id_fkey name after the rename —
    // hinting by column is rename-proof and matches ContractorDashboard).
    const { data } = await supabase
      .from('contractor_assignments')
      .select('*, contractor:profiles!contractor_id(full_name, nickname, avatar_url, sub_role)')
      .eq('created_by', profile.id)
      .order('created_at', { ascending: false });
    const rows = data || [];
    setAssignments(rows);
    setLoading(false);

    const ids = rows.map(a => a.id);
    if (ids.length === 0) { setReviewsByAssignment({}); return; }
    const { data: revs } = await supabase
      .from('reviews')
      .select('id, assignment_id, review_versions(id, version_number, client_verdict)')
      .in('assignment_id', ids);
    const map = {};
    (revs || []).forEach(r => { if (r.assignment_id) map[r.assignment_id] = r; });
    setReviewsByAssignment(map);
  }, [profile?.id]);

  const fetchComments = useCallback(async (assignmentId) => {
    if (!assignmentId) return;
    const { data } = await supabase
      .from('contractor_assignment_comments')
      .select('*, author:profiles!author_id(full_name, nickname, avatar_url)')
      .eq('assignment_id', assignmentId)
      .order('created_at', { ascending: true });
    setComments(data || []);
  }, []);

  useEffect(() => {
    fetchEditors();
    fetchClientProfile();
    fetchAssignments();
  }, [fetchEditors, fetchClientProfile, fetchAssignments]);

  useEffect(() => {
    if (selectedId) fetchComments(selectedId);
    else setComments([]);
  }, [selectedId, fetchComments]);

  // Deep-link from AppLayout (notification click on another tab, etc.)
  useEffect(() => {
    if (!initialAssignmentId) { openedInitialRef.current = null; return; }
    if (loading) return;
    if (openedInitialRef.current === initialAssignmentId) return;
    if (assignments.some(a => a.id === initialAssignmentId)) {
      openedInitialRef.current = initialAssignmentId;
      const target = assignments.find(a => a.id === initialAssignmentId);
      if (target?.status === 'completed') setFilter('all');
      setSelectedId(initialAssignmentId);
      if (onAssignmentOpened) onAssignmentOpened();
    }
  }, [loading, initialAssignmentId, assignments, onAssignmentOpened]);

  // ── Realtime ───────────────────────────────────────────────────

  const refetchComments = useCallback(() => {
    if (selectedId) fetchComments(selectedId);
  }, [selectedId, fetchComments]);

  useRealtimeTable('cl-assignments', {
    table: 'contractor_assignments',
    filter: profile?.id ? `created_by=eq.${profile.id}` : undefined,
    onAny: fetchAssignments,
    enabled: !!profile?.id,
  });

  useRealtimeTable('cl-comments', {
    table: 'contractor_assignment_comments',
    filter: selectedId ? `assignment_id=eq.${selectedId}` : undefined,
    onAny: refetchComments,
    enabled: !!profile?.id && !!selectedId,
  });

  // ── Handlers ───────────────────────────────────────────────────

  async function handlePostComment() {
    if (!newComment.trim() || postingComment || !selectedId) return;
    setPostingComment(true);
    try {
      // DB triggers notify the other side — no notifications insert here
      // (clients can't insert notifications under RLS anyway).
      const { error } = await supabase.from('contractor_assignment_comments').insert({
        assignment_id: selectedId,
        author_id: profile.id,
        body: newComment.trim(),
      });
      if (error) throw error;
      setNewComment('');
      fetchComments(selectedId);
    } catch (err) {
      showToast('Comment failed: ' + err.message, 'error');
    } finally {
      setPostingComment(false);
    }
  }

  // ── Derived ────────────────────────────────────────────────────

  const filteredAssignments = assignments.filter(a => {
    if (filter === 'active') return a.status !== 'completed';
    if (filter === 'completed') return a.status === 'completed';
    return true;
  });

  // ── Render ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={styles.page}>
        <p style={styles.loadingText}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* Header row */}
      <div style={styles.headerRow}>
        <div>
          <h1 style={styles.title}>Your Projects</h1>
          <p style={styles.subtitle}>
            {assignments.length} total &middot; {assignments.filter(a => a.status === 'in_progress').length} in progress
          </p>
        </div>
        <div style={styles.headerActions}>
          {driveFolderUrl ? (
            <a href={driveFolderUrl} target="_blank" rel="noopener noreferrer" style={styles.folderLink}>
              Delivery folder ↗
            </a>
          ) : (
            <span style={styles.folderMissing}>Set your delivery folder in Profile</span>
          )}
          <button
            style={{ ...styles.newBtn, ...(editors.length === 0 ? styles.newBtnDisabled : {}) }}
            disabled={editors.length === 0}
            title={editors.length === 0 ? 'No editors assigned yet — contact the studio' : undefined}
            onClick={() => { setEditingAssignment(null); setModalOpen(true); }}
          >
            + New Assignment
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div style={styles.filterRow}>
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{ ...styles.filterPill, ...(filter === f.key ? styles.filterPillActive : {}) }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Cards */}
      <div style={styles.cardList}>
        {assignments.length === 0 && (
          <div style={styles.emptyCard}>
            <p style={styles.emptyTitle}>No projects yet</p>
            <p style={styles.emptyBody}>Assign your first project to an editor.</p>
            <button
              style={{ ...styles.newBtn, ...(editors.length === 0 ? styles.newBtnDisabled : {}) }}
              disabled={editors.length === 0}
              title={editors.length === 0 ? 'No editors assigned yet — contact the studio' : undefined}
              onClick={() => { setEditingAssignment(null); setModalOpen(true); }}
            >
              + New Assignment
            </button>
          </div>
        )}
        {assignments.length > 0 && filteredAssignments.length === 0 && (
          <p style={styles.emptyText}>No {filter === 'active' ? 'active' : 'completed'} projects.</p>
        )}
        {filteredAssignments.map(a => {
          const isSelected = selectedId === a.id;
          const statusStyle = STATUS_COLORS[a.status] || STATUS_COLORS.assigned;
          const dueStatus = getDueDateStatus(a.due_date);
          const review = reviewsByAssignment[a.id];
          const versions = review?.review_versions || [];
          const latestVersion = versions.length > 0
            ? versions.reduce((max, v) => (v.version_number > max.version_number ? v : max), versions[0])
            : null;
          const awaitingVerdict = latestVersion && !latestVersion.client_verdict;
          return (
            <div
              key={a.id}
              style={{ ...styles.card, ...(isSelected ? styles.cardSelected : {}) }}
            >
              <div
                style={styles.cardHead}
                onClick={() => setSelectedId(isSelected ? null : a.id)}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.cardTitleRow}>
                    <span style={styles.cardTitle}>{a.title}</span>
                    <span style={{ ...styles.statusChip, background: statusStyle.bg, color: statusStyle.color }}>
                      {STATUS_LABELS[a.status] || a.status}
                    </span>
                    {awaitingVerdict && a.status !== 'completed' && (
                      <span style={styles.awaitingBadge}>Awaiting your review</span>
                    )}
                  </div>
                  <div style={styles.cardMetaRow}>
                    {a.contractor && (
                      <span style={styles.editorMeta}>
                        {a.contractor.avatar_url ? (
                          <img src={a.contractor.avatar_url} alt="" style={styles.avatar} />
                        ) : (
                          <span style={styles.avatarFallback}>{getDisplayInitial(a.contractor)}</span>
                        )}
                        <span>{a.contractor.full_name || getDisplayName(a.contractor)}</span>
                        {a.contractor.sub_role && (
                          <span style={styles.subRole}>· {a.contractor.sub_role}</span>
                        )}
                      </span>
                    )}
                    {a.due_date && (
                      <span style={{
                        ...styles.dueDate,
                        ...(dueStatus === 'overdue' && a.status !== 'completed' ? styles.dueDateOverdue : {}),
                        ...(dueStatus === 'today' && a.status !== 'completed' ? styles.dueDateToday : {}),
                      }}>
                        Due {formatDueDate(a.due_date)}
                        {dueStatus === 'overdue' && a.status !== 'completed' ? ' — overdue' : ''}
                      </span>
                    )}
                  </div>
                </div>
                <span style={styles.cardCaret}>{isSelected ? '▲' : '▼'}</span>
              </div>

              {isSelected && (
                <div style={styles.cardDetail}>
                  {a.description && <p style={styles.description}>{a.description}</p>}

                  <div style={styles.detailActions}>
                    {review && (
                      <button
                        style={styles.reviewBtn}
                        onClick={() => onNavigate && onNavigate('cl_review', review.id)}
                      >
                        Review{latestVersion ? ` (v${latestVersion.version_number})` : ''} →
                      </button>
                    )}
                    {awaitingVerdict && (
                      <span style={styles.awaitingBadge}>Awaiting your review</span>
                    )}
                    {a.status !== 'completed' && (
                      <button
                        style={styles.editBtn}
                        onClick={() => { setEditingAssignment(a); setModalOpen(true); }}
                      >
                        Edit
                      </button>
                    )}
                  </div>

                  {/* Comments */}
                  <div style={styles.commentsSection}>
                    <p style={styles.commentsHeading}>Comments</p>
                    {comments.length === 0 && (
                      <p style={styles.noComments}>No comments yet.</p>
                    )}
                    {comments.map(c => {
                      const mine = c.author_id === profile.id;
                      return (
                        <div key={c.id} style={styles.commentRow}>
                          <span style={styles.commentAuthor}>
                            {mine ? 'You' : (c.author?.full_name || getDisplayName(c.author) || 'Studio')}
                          </span>
                          <span style={styles.commentTime}>{formatRelativeTime(c.created_at)}</span>
                          <p style={styles.commentBody}>{c.body}</p>
                        </div>
                      );
                    })}
                    <div style={styles.commentInputRow}>
                      <input
                        value={newComment}
                        onChange={e => setNewComment(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handlePostComment(); }}
                        style={styles.commentInput}
                        placeholder="Write a comment..."
                      />
                      <button
                        style={{
                          ...styles.commentSendBtn,
                          opacity: newComment.trim() && !postingComment ? 1 : 0.45,
                        }}
                        disabled={!newComment.trim() || postingComment}
                        onClick={handlePostComment}
                      >
                        {postingComment ? 'Sending…' : 'Send'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modal */}
      <ContractorAssignmentModal
        open={modalOpen}
        mode="client"
        contractorOptions={editors}
        existing={editingAssignment}
        currentUserId={profile?.id}
        showToast={showToast}
        onClose={() => { setModalOpen(false); setEditingAssignment(null); }}
        onCreated={fetchAssignments}
        onSaved={fetchAssignments}
      />

      {/* Toast */}
      {toast && (
        <div style={{
          ...styles.toast,
          ...(toast.type === 'error' ? styles.toastError : {}),
        }}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const styles = {
  page: {
    minHeight: '100vh',
    background: colors.bg,
    padding: '32px 24px',
    fontFamily: 'DM Sans, sans-serif',
    color: 'rgba(255,255,255,0.9)',
    maxWidth: 860,
    margin: '0 auto',
  },
  loadingText: {
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    marginTop: 80,
  },

  // Header
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 24,
    flexWrap: 'wrap',
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
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  folderLink: {
    color: colors.accentFg,
    fontSize: 13,
    fontWeight: 600,
    textDecoration: 'none',
    padding: '8px 14px',
    borderRadius: 8,
    border: `1px solid ${colors.accentBorder}`,
    background: colors.accentA08,
  },
  folderMissing: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.35)',
  },
  newBtn: {
    background: colors.accent,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '9px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
  },
  newBtnDisabled: {
    opacity: 0.45,
    cursor: 'not-allowed',
  },

  // Filters
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
  },
  filterPillActive: {
    background: colors.accent,
    color: '#fff',
    borderColor: colors.accent,
  },

  // Cards
  cardList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  card: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12,
    overflow: 'hidden',
  },
  cardSelected: {
    border: `1px solid ${colors.accentBorder}`,
  },
  cardHead: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '16px 18px',
    cursor: 'pointer',
  },
  cardTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: '#fff',
  },
  statusChip: {
    fontSize: 11,
    fontWeight: 600,
    padding: '3px 10px',
    borderRadius: 999,
    whiteSpace: 'nowrap',
  },
  awaitingBadge: {
    fontSize: 11,
    fontWeight: 700,
    padding: '3px 10px',
    borderRadius: 999,
    background: colors.accentSoft,
    color: colors.accentFg,
    border: `1px solid ${colors.accentBorder}`,
    whiteSpace: 'nowrap',
  },
  cardMetaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  editorMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    fontSize: 13,
    color: 'rgba(255,255,255,0.65)',
  },
  avatar: {
    width: 22,
    height: 22,
    borderRadius: '50%',
    objectFit: 'cover',
  },
  avatarFallback: {
    width: 22,
    height: 22,
    borderRadius: '50%',
    background: colors.accentA20,
    color: colors.accentFg,
    fontSize: 11,
    fontWeight: 700,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subRole: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
  },
  dueDate: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
  },
  dueDateOverdue: {
    color: '#f87171',
    fontWeight: 600,
  },
  dueDateToday: {
    color: '#fbbf24',
    fontWeight: 600,
  },
  cardCaret: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 11,
    marginTop: 4,
    flexShrink: 0,
  },
  cardDetail: {
    borderTop: '1px solid rgba(255,255,255,0.06)',
    padding: '16px 18px',
  },
  description: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 1.5,
    margin: '0 0 14px',
    whiteSpace: 'pre-wrap',
  },
  detailActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  reviewBtn: {
    background: colors.accent,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '7px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
  },
  editBtn: {
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.75)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    padding: '7px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
  },

  // Comments
  commentsSection: {
    borderTop: '1px solid rgba(255,255,255,0.06)',
    paddingTop: 14,
  },
  commentsHeading: {
    fontSize: 12,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    margin: '0 0 10px',
  },
  noComments: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.35)',
    margin: '0 0 10px',
  },
  commentRow: {
    marginBottom: 12,
  },
  commentAuthor: {
    fontSize: 12,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.8)',
    marginRight: 8,
  },
  commentTime: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
  },
  commentBody: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 1.45,
    margin: '3px 0 0',
    whiteSpace: 'pre-wrap',
  },
  commentInputRow: {
    display: 'flex',
    gap: 8,
    marginTop: 8,
  },
  commentInput: {
    flex: 1,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: '9px 12px',
    color: '#fff',
    fontSize: 13,
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  commentSendBtn: {
    background: colors.accent,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '9px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
  },

  // Empty state
  emptyCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px dashed rgba(255,255,255,0.12)',
    borderRadius: 12,
    padding: '40px 24px',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.85)',
    margin: 0,
  },
  emptyBody: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
    margin: '0 0 14px',
  },
  emptyText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    padding: '24px 0',
  },

  // Toast
  toast: {
    position: 'fixed',
    bottom: 24,
    left: '50%',
    transform: 'translateX(-50%)',
    background: colors.bgHover,
    border: `1px solid ${colors.accentBorder}`,
    color: '#fff',
    borderRadius: 10,
    padding: '10px 18px',
    fontSize: 13,
    fontWeight: 600,
    zIndex: 2000,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  toastError: {
    border: '1px solid rgba(239,68,68,0.5)',
    color: '#f87171',
  },
};
