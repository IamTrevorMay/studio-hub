import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import FullScreenSheet from '../components/mobile/FullScreenSheet';
import { mobileTokens } from '../utils/mobileTokens';

// Studio owner (Trevor) — sole recipient of contractor-comment notifications.
const STUDIO_OWNER_ID = 'c3290048-436b-46c6-b3f0-fdf7923d0c3b';

const STATUS_LABELS = { assigned: 'Assigned', in_progress: 'In Progress', completed: 'Completed' };
const STATUS_COLORS = { assigned: '#60a5fa', in_progress: '#fbbf24', completed: '#34d399' };

const TYPE_ICONS = { edit: '✂️', design: '🎨', write: '✍️', other: '📋' };

function fmtDue(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (diff < 0) return { label, sub: `${Math.abs(diff)}d overdue`, color: '#ef4444' };
  if (diff === 0) return { label, sub: 'Today', color: '#fbbf24' };
  if (diff <= 3) return { label, sub: `${diff}d left`, color: '#fcd34d' };
  return { label, sub: `${diff}d left`, color: 'rgba(255,255,255,0.5)' };
}

function fmtRelative(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function greet() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function FreelancerDashboardMobile() {
  const { profile } = useAuth();
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('open'); // open | all | completed
  const [selectedId, setSelectedId] = useState(null);

  const fetchAssignments = useCallback(async () => {
    if (!profile?.id) return;
    const { data } = await supabase
      .from('freelancer_assignments')
      .select('*, created_by_profile:profiles!freelancer_assignments_created_by_fkey(full_name)')
      .eq('freelancer_id', profile.id)
      .order('created_at', { ascending: false });
    setAssignments(data || []);
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => { fetchAssignments(); }, [fetchAssignments]);

  useEffect(() => {
    if (!profile?.id) return;
    const ch = supabase.channel(`fl-dashboard-mobile-${profile.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'freelancer_assignments',
        filter: `freelancer_id=eq.${profile.id}`,
      }, () => fetchAssignments())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [profile?.id, fetchAssignments]);

  const visible = assignments.filter((a) => {
    if (filter === 'open') return a.status === 'assigned' || a.status === 'in_progress';
    if (filter === 'completed') return a.status === 'completed';
    return true;
  });

  const counts = {
    open: assignments.filter((a) => a.status === 'assigned' || a.status === 'in_progress').length,
    completed: assignments.filter((a) => a.status === 'completed').length,
  };

  return (
    <div style={styles.root}>
      <header style={styles.greeting}>
        <div style={styles.avatar}>{(profile?.full_name || '?').charAt(0).toUpperCase()}</div>
        <div>
          <div style={styles.greetSmall}>{greet()},</div>
          <div style={styles.greetName}>{profile?.full_name?.split(' ')[0] || 'there'}</div>
        </div>
      </header>

      <div style={styles.statRow}>
        <Stat label="Open" value={counts.open} accent="#a5b4fc" />
        <Stat label="Completed" value={counts.completed} accent="#86efac" />
      </div>

      <div style={styles.filterBar}>
        <FilterChip label="Open" count={counts.open} active={filter === 'open'} onClick={() => setFilter('open')} />
        <FilterChip label="Completed" count={counts.completed} active={filter === 'completed'} onClick={() => setFilter('completed')} />
        <FilterChip label="All" count={assignments.length} active={filter === 'all'} onClick={() => setFilter('all')} />
      </div>

      {loading ? (
        <p style={styles.empty}>Loading…</p>
      ) : visible.length === 0 ? (
        <div style={styles.emptyCard}>
          <p style={styles.emptyTitle}>{filter === 'open' ? 'Nothing on your plate' : 'No assignments here'}</p>
          <p style={styles.emptyHint}>You're all caught up.</p>
        </div>
      ) : (
        <ul style={styles.list}>
          {visible.map((a) => {
            const accent = STATUS_COLORS[a.status] || '#94a3b8';
            const due = fmtDue(a.due_date);
            return (
              <li key={a.id}>
                <button onClick={() => setSelectedId(a.id)} style={styles.card}>
                  <div style={{ ...styles.statusBar, background: accent }} />
                  <div style={styles.cardBody}>
                    <div style={styles.cardHeader}>
                      <span style={styles.cardIcon}>{TYPE_ICONS[a.type] || '📋'}</span>
                      <span style={styles.cardTitle}>{a.title}</span>
                      <span style={{ ...styles.statusPill, background: `${accent}22`, color: accent, borderColor: `${accent}55` }}>
                        {STATUS_LABELS[a.status] || a.status}
                      </span>
                    </div>
                    {due && (
                      <div style={{ ...styles.dueRow, color: due.color }}>
                        <span>Due {due.label}</span>
                        <span>·</span>
                        <span>{due.sub}</span>
                      </div>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <FullScreenSheet
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        title="Assignment"
      >
        {selectedId && (
          <AssignmentDetail
            assignmentId={selectedId}
            assignment={assignments.find((a) => a.id === selectedId)}
            profile={profile}
            onChanged={fetchAssignments}
          />
        )}
      </FullScreenSheet>
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div style={{ ...styles.statValue, color: accent }}>{value}</div>
    </div>
  );
}

function FilterChip({ label, count, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      ...styles.chip,
      background: active ? 'rgba(99,102,241,0.16)' : 'rgba(255,255,255,0.05)',
      color: active ? '#a5b4fc' : 'rgba(255,255,255,0.7)',
      borderColor: active ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.1)',
      fontWeight: active ? 600 : 500,
    }}>{label} <span style={{ color: 'rgba(255,255,255,0.4)' }}>· {count}</span></button>
  );
}

function AssignmentDetail({ assignmentId, assignment, profile, onChanged }) {
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [updating, setUpdating] = useState(false);
  const endRef = useRef(null);

  const fetchComments = useCallback(async () => {
    const { data } = await supabase
      .from('freelancer_assignment_comments')
      .select('*, author:profiles!freelancer_assignment_comments_author_id_fkey(full_name)')
      .eq('assignment_id', assignmentId)
      .order('created_at', { ascending: true });
    setComments(data || []);
  }, [assignmentId]);

  useEffect(() => { fetchComments(); }, [fetchComments]);

  useEffect(() => {
    const ch = supabase.channel(`fl-assignment-${assignmentId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'freelancer_assignment_comments',
        filter: `assignment_id=eq.${assignmentId}`,
      }, () => fetchComments())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [assignmentId, fetchComments]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [comments]);

  async function postComment(e) {
    e.preventDefault();
    if (!text.trim() || posting) return;
    setPosting(true);
    const body = text.trim();
    setText('');
    try {
      await supabase.from('freelancer_assignment_comments').insert({
        assignment_id: assignmentId,
        author_id: profile.id,
        body,
      });
      if (assignment && profile.id !== STUDIO_OWNER_ID) {
        await supabase.from('notifications').insert({
          user_id: STUDIO_OWNER_ID,
          type: 'fl_comment',
          title: 'New Comment',
          body: `${profile.full_name} commented on "${assignment.title}"`,
          link_tab: 'freelancers',
          link_target: assignmentId,
        });
      }
    } finally {
      setPosting(false);
    }
  }

  async function setStatus(next) {
    if (updating || !assignment) return;
    setUpdating(true);
    try {
      const updates = { status: next, updated_at: new Date().toISOString() };
      if (next === 'completed') updates.completed_at = new Date().toISOString();
      await supabase.from('freelancer_assignments').update(updates).eq('id', assignmentId);
      if (next === 'completed' && assignment.created_by) {
        await supabase.from('notifications').insert({
          user_id: assignment.created_by,
          type: 'fl_assignment_completed',
          title: 'Assignment Completed',
          body: `${profile.full_name} completed "${assignment.title}"`,
          link_tab: 'freelancers',
          link_target: assignmentId,
        });
      }
      onChanged && onChanged();
    } finally {
      // Always release — a thrown query would otherwise lock the buttons forever.
      setUpdating(false);
    }
  }

  if (!assignment) return null;
  const accent = STATUS_COLORS[assignment.status] || '#94a3b8';
  const due = fmtDue(assignment.due_date);

  return (
    <div style={detailStyles.root}>
      <div>
        <div style={{ ...detailStyles.statusPill, background: `${accent}22`, color: accent, borderColor: `${accent}55` }}>
          {STATUS_LABELS[assignment.status] || assignment.status}
        </div>
        <h3 style={detailStyles.title}>{assignment.title}</h3>
        {due && (
          <div style={{ ...detailStyles.dueRow, color: due.color }}>
            <span>Due {due.label}</span>
            <span>·</span>
            <span>{due.sub}</span>
          </div>
        )}
        {assignment.description && <p style={detailStyles.description}>{assignment.description}</p>}
        {assignment.created_by_profile?.full_name && (
          <div style={detailStyles.metaLine}>From {assignment.created_by_profile.full_name}</div>
        )}
      </div>

      <div style={detailStyles.statusActions}>
        {assignment.status === 'assigned' && (
          <button onClick={() => setStatus('in_progress')} disabled={updating} style={detailStyles.statusBtn}>Start</button>
        )}
        {assignment.status === 'in_progress' && (
          <button onClick={() => setStatus('completed')} disabled={updating} style={{ ...detailStyles.statusBtn, background: 'linear-gradient(135deg, #22c55e, #4ade80)' }}>Mark complete</button>
        )}
        {assignment.status === 'completed' && (
          <button onClick={() => setStatus('in_progress')} disabled={updating} style={detailStyles.statusBtnSecondary}>Reopen</button>
        )}
      </div>

      <div style={detailStyles.commentsSection}>
        <div style={detailStyles.commentsHeader}>Comments · {comments.length}</div>
        <div style={detailStyles.commentsList}>
          {comments.length === 0 ? (
            <p style={detailStyles.empty}>No comments yet.</p>
          ) : (
            comments.map((c) => {
              const mine = c.author_id === profile?.id;
              return (
                <div key={c.id} style={{ ...detailStyles.bubbleRow, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    ...detailStyles.bubble,
                    background: mine ? 'linear-gradient(135deg, #6366f1, #818cf8)' : 'rgba(255,255,255,0.06)',
                    color: mine ? '#fff' : '#e2e8f0',
                  }}>
                    {!mine && <div style={detailStyles.bubbleSender}>{c.author?.full_name || 'Unknown'}</div>}
                    <div>{c.body}</div>
                    <div style={{ ...detailStyles.bubbleTime, color: mine ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.4)' }}>
                      {fmtRelative(c.created_at)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={endRef} />
        </div>
        <form onSubmit={postComment} style={detailStyles.composer}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment…" style={detailStyles.input} />
          <button type="submit" disabled={!text.trim() || posting} style={{ ...detailStyles.sendBtn, opacity: text.trim() ? 1 : 0.4 }} aria-label="Send">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M2 10l16-7-7 16-2-7-7-2z" /></svg>
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  root: {
    minHeight: '100%',
    background: '#0f0f1a',
    color: '#e2e8f0',
    padding: `${mobileTokens.space.md}px 0 ${mobileTokens.space.xxxl}px`,
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.md,
  },
  greeting: {
    display: 'flex',
    alignItems: 'center',
    gap: mobileTokens.space.md,
    padding: `0 ${mobileTokens.space.lg}px`,
  },
  avatar: {
    width: 44, height: 44, borderRadius: mobileTokens.radius.md,
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: mobileTokens.font.lg, fontWeight: 700, flexShrink: 0,
  },
  greetSmall: { fontSize: mobileTokens.font.sm, color: 'rgba(255,255,255,0.5)' },
  greetName: {
    fontSize: mobileTokens.font.xl, fontWeight: 700, color: '#fff',
    letterSpacing: '-0.3px', lineHeight: 1.1,
  },
  statRow: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: mobileTokens.space.sm,
    padding: `0 ${mobileTokens.space.lg}px`,
  },
  statCard: {
    background: 'rgba(255,255,255,0.04)',
    borderRadius: mobileTokens.radius.md,
    padding: mobileTokens.space.md,
  },
  statLabel: {
    fontSize: 10, color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600,
  },
  statValue: {
    fontSize: mobileTokens.font.title, fontWeight: 700, letterSpacing: '-0.3px',
  },
  filterBar: {
    display: 'flex', gap: mobileTokens.space.sm,
    padding: `0 ${mobileTokens.space.lg}px`,
    flexWrap: 'wrap',
  },
  chip: {
    minHeight: 36, padding: `${mobileTokens.space.sm}px ${mobileTokens.space.md}px`,
    border: '1px solid', borderRadius: mobileTokens.radius.pill,
    fontSize: mobileTokens.font.sm, cursor: 'pointer', fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  empty: {
    color: 'rgba(255,255,255,0.4)', textAlign: 'center', fontSize: mobileTokens.font.md,
    padding: mobileTokens.space.xxl, margin: 0,
  },
  emptyCard: {
    margin: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px`,
    padding: mobileTokens.space.xl, background: 'rgba(255,255,255,0.04)',
    borderRadius: mobileTokens.radius.lg, textAlign: 'center',
  },
  emptyTitle: { fontSize: mobileTokens.font.lg, fontWeight: 600, color: '#fff', margin: 0 },
  emptyHint: { fontSize: mobileTokens.font.sm, color: 'rgba(255,255,255,0.5)', margin: `${mobileTokens.space.sm}px 0 0` },
  list: {
    listStyle: 'none', margin: 0, padding: `0 ${mobileTokens.space.lg}px`,
    display: 'flex', flexDirection: 'column', gap: mobileTokens.space.sm,
  },
  card: {
    width: '100%', display: 'flex', background: 'rgba(255,255,255,0.04)',
    border: 'none', borderRadius: mobileTokens.radius.md, overflow: 'hidden',
    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', color: '#e2e8f0',
    minHeight: mobileTokens.tap + 16,
  },
  statusBar: { width: 4, flexShrink: 0 },
  cardBody: { flex: 1, padding: mobileTokens.space.md, minWidth: 0 },
  cardHeader: { display: 'flex', alignItems: 'center', gap: mobileTokens.space.sm },
  cardIcon: { fontSize: 18, flexShrink: 0 },
  cardTitle: {
    flex: 1, fontSize: mobileTokens.font.md, fontWeight: 600, color: '#fff',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  statusPill: {
    fontSize: 10, fontWeight: 700, padding: '2px 8px',
    borderRadius: mobileTokens.radius.pill, border: '1px solid',
    textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0,
  },
  dueRow: {
    marginTop: 6,
    display: 'flex', gap: 6,
    fontSize: mobileTokens.font.sm, fontWeight: 500,
  },
};

const detailStyles = {
  root: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.md },
  statusPill: {
    display: 'inline-block', padding: '4px 10px',
    borderRadius: mobileTokens.radius.pill, border: '1px solid',
    fontSize: mobileTokens.font.xs, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: mobileTokens.space.sm,
  },
  title: {
    margin: 0, fontSize: mobileTokens.font.xl, fontWeight: 700,
    color: '#fff', letterSpacing: '-0.3px', lineHeight: 1.2,
  },
  dueRow: {
    marginTop: mobileTokens.space.sm,
    display: 'flex', gap: 6,
    fontSize: mobileTokens.font.sm, fontWeight: 500,
  },
  description: {
    marginTop: mobileTokens.space.md, marginBottom: 0,
    fontSize: mobileTokens.font.md, color: 'rgba(255,255,255,0.75)',
    lineHeight: 1.5, whiteSpace: 'pre-wrap',
  },
  metaLine: {
    marginTop: mobileTokens.space.sm,
    fontSize: mobileTokens.font.sm, color: 'rgba(255,255,255,0.5)',
  },
  statusActions: { display: 'flex', gap: mobileTokens.space.sm },
  statusBtn: {
    flex: 1, minHeight: mobileTokens.tap + 4, padding: mobileTokens.space.md,
    background: 'linear-gradient(135deg, #6366f1, #818cf8)', border: 'none',
    borderRadius: mobileTokens.radius.md, color: '#fff',
    fontSize: mobileTokens.font.md, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  statusBtnSecondary: {
    flex: 1, minHeight: mobileTokens.tap + 4, padding: mobileTokens.space.md,
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.md, color: '#e2e8f0',
    fontSize: mobileTokens.font.md, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  commentsSection: {
    display: 'flex', flexDirection: 'column', gap: mobileTokens.space.sm,
    marginTop: mobileTokens.space.md,
    borderTop: '1px solid rgba(255,255,255,0.06)',
    paddingTop: mobileTokens.space.md,
  },
  commentsHeader: {
    fontSize: mobileTokens.font.sm, fontWeight: 700,
    color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.5px',
  },
  commentsList: {
    display: 'flex', flexDirection: 'column', gap: mobileTokens.space.sm,
    maxHeight: '50vh', overflowY: 'auto',
  },
  empty: {
    color: 'rgba(255,255,255,0.4)', fontSize: mobileTokens.font.sm, margin: 0,
    textAlign: 'center', padding: mobileTokens.space.lg,
  },
  bubbleRow: { display: 'flex', width: '100%' },
  bubble: {
    maxWidth: '78%', padding: `${mobileTokens.space.sm}px ${mobileTokens.space.md}px`,
    borderRadius: mobileTokens.radius.lg, fontSize: mobileTokens.font.md,
    lineHeight: 1.4, wordBreak: 'break-word', whiteSpace: 'pre-wrap',
  },
  bubbleSender: {
    fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.6)',
    fontWeight: 600, marginBottom: 2,
  },
  bubbleTime: { fontSize: mobileTokens.font.xs, marginTop: 4 },
  composer: { display: 'flex', gap: mobileTokens.space.sm },
  input: {
    flex: 1, minHeight: mobileTokens.tap,
    padding: `${mobileTokens.space.sm}px ${mobileTokens.space.md}px`,
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.pill, color: '#fff',
    fontSize: mobileTokens.font.base, outline: 'none', fontFamily: 'inherit',
  },
  sendBtn: {
    width: mobileTokens.tap, height: mobileTokens.tap, border: 'none',
    borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    color: '#fff', cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit', flexShrink: 0,
  },
};
