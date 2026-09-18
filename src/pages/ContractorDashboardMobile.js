import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import FullScreenSheet from '../components/mobile/FullScreenSheet';
import { mobileTokens } from '../utils/mobileTokens';
import { colors } from '../lib/styleTokens';
import { getCurrentPayPeriod } from '../lib/payPeriods';

// Studio owner (Trevor) — sole recipient of contractor-comment notifications.
const STUDIO_OWNER_ID = 'c3290048-436b-46c6-b3f0-fdf7923d0c3b';

const STATUS_LABELS = { assigned: 'Assigned', in_progress: 'In Progress', completed: 'Completed' };
const STATUS_COLORS = { assigned: '#60a5fa', in_progress: '#fbbf24', completed: '#34d399' };


function fmtDue(iso, time) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  let label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (time) {
    // bare `time` column ('HH:MM:SS') → '3:30 PM'
    const [h, m] = time.split(':').map(Number);
    label += ` · ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }
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

export default function ContractorDashboardMobile() {
  const { profile } = useAuth();
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('open'); // open | all | completed
  // This pay period's earnings, computed server-side like Payroll (contractor_earnings RPC).
  const [earnings, setEarnings] = useState(null);
  useEffect(() => {
    if (!profile?.id) return undefined;
    let cancelled = false;
    const period = getCurrentPayPeriod();
    supabase.rpc('contractor_earnings', { p_start: period.start, p_end: period.end })
      .then(({ data, error }) => { if (!cancelled) setEarnings(error ? null : { period, data }); });
    return () => { cancelled = true; };
  }, [profile?.id, assignments]);
  const [selectedId, setSelectedId] = useState(null);

  const fetchAssignments = useCallback(async () => {
    if (!profile?.id) return;
    const { data } = await supabase
      .from('contractor_assignments')
      .select('*, created_by_profile:profiles!created_by(full_name, role)')
      .eq('contractor_id', profile.id)
      .order('created_at', { ascending: false });
    setAssignments(data || []);
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => { fetchAssignments(); }, [fetchAssignments]);

  useEffect(() => {
    if (!profile?.id) return;
    const ch = supabase.channel(`fl-dashboard-mobile-${profile.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'contractor_assignments',
        filter: `contractor_id=eq.${profile.id}`,
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
        <Stat label="Open" value={counts.open} accent="#8fb4d8" />
        <Stat label="Completed" value={counts.completed} accent="#86efac" />
      </div>

      <div style={styles.filterBar}>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={styles.filterSelect} aria-label="Filter assignments">
          <option value="open">Open · {counts.open}</option>
          <option value="completed">Completed · {counts.completed}</option>
          <option value="all">All · {assignments.length}</option>
        </select>
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
            const due = fmtDue(a.due_date, a.due_time);
            return (
              <li key={a.id}>
                <button onClick={() => setSelectedId(a.id)} style={styles.card}>
                  <div style={{ ...styles.statusBar, background: accent }} />
                  <div style={styles.cardBody}>
                    <div style={styles.cardHeader}>
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

      {earnings?.data && (
        <section style={styles.earnCard}>
          <div style={styles.earnTop}>
            <div>
              <div style={styles.statLabel}>Earnings · {earnings.period.label}</div>
              <div style={styles.earnDetail}>
                {earnings.data.completed_count} completed
                {earnings.data.payment_type === 'hourly' ? ` · ${Number(earnings.data.hours || 0).toFixed(1)} hrs` : ''}
                {earnings.data.paid ? ' · Paid' : ''}
              </div>
            </div>
            <div style={styles.earnAmount}>
              ${((earnings.data.amount_cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        </section>
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

function AssignmentDetail({ assignmentId, assignment, profile, onChanged }) {
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deliveryUrl, setDeliveryUrl] = useState('');
  const endRef = useRef(null);

  const fetchComments = useCallback(async () => {
    const { data } = await supabase
      .from('contractor_assignment_comments')
      .select('*, author:profiles!author_id(full_name)')
      .eq('assignment_id', assignmentId)
      .order('created_at', { ascending: true });
    setComments(data || []);
  }, [assignmentId]);

  useEffect(() => { fetchComments(); }, [fetchComments]);

  useEffect(() => {
    const ch = supabase.channel(`fl-assignment-${assignmentId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'contractor_assignment_comments',
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
    try {
      await supabase.from('contractor_assignment_comments').insert({
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
      setText(''); // clear only after successful insert
    } catch (err) {
      console.error('postComment failed', err); // keep typed text on failure
    } finally {
      setPosting(false);
    }
  }

  async function setStatus(next, extra = {}) {
    if (updating || !assignment) return;
    setUpdating(true);
    try {
      const updates = { status: next, updated_at: new Date().toISOString(), ...extra };
      if (next === 'completed') updates.completed_at = new Date().toISOString();
      const { error } = await supabase.from('contractor_assignments').update(updates).eq('id', assignmentId);
      if (error) { window.alert(error.message); return; }
      // Client creators are notified by DB triggers (and get the finished link there).
      const creatorIsClient = assignment.created_by_profile?.role === 'client';
      if (next === 'completed' && assignment.created_by && !creatorIsClient) {
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
  const isClientCreated = assignment.created_by_profile?.role === 'client';
  const accent = STATUS_COLORS[assignment.status] || '#94a3b8';
  const due = fmtDue(assignment.due_date, assignment.due_time);

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
        {(assignment.project_folder_url || assignment.delivery_url) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {assignment.project_folder_url && (
              <a href={assignment.project_folder_url} target="_blank" rel="noopener noreferrer" style={detailStyles.assetLink}>Project folder ↗</a>
            )}
            {assignment.delivery_url && (
              <a href={assignment.delivery_url} target="_blank" rel="noopener noreferrer" style={detailStyles.assetLink}>Finished project ↗</a>
            )}
          </div>
        )}
      </div>

      <div style={detailStyles.statusActions}>
        {assignment.status === 'assigned' && (
          <button onClick={() => setStatus('in_progress')} disabled={updating} style={detailStyles.statusBtn}>Accept</button>
        )}
        {assignment.status === 'in_progress' && !isClientCreated && (
          <button onClick={() => setStatus('completed')} disabled={updating} style={{ ...detailStyles.statusBtn, background: 'linear-gradient(135deg, #22c55e, #4ade80)' }}>Mark complete</button>
        )}
        {assignment.status === 'in_progress' && isClientCreated && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
            <input
              type="url"
              value={deliveryUrl}
              onChange={(e) => setDeliveryUrl(e.target.value)}
              placeholder="Link to the finished project"
              style={detailStyles.input}
            />
            <button
              onClick={() => setStatus('completed', { delivery_url: deliveryUrl.trim() })}
              disabled={updating || !/^https?:\/\/\S+$/i.test(deliveryUrl.trim())}
              style={{ ...detailStyles.statusBtn, background: 'linear-gradient(135deg, #22c55e, #4ade80)', opacity: /^https?:\/\/\S+$/i.test(deliveryUrl.trim()) ? 1 : 0.5 }}
            >
              Complete
            </button>
          </div>
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
                    background: mine ? 'linear-gradient(135deg, #5b8fc7, #8fb4d8)' : 'rgba(255,255,255,0.06)',
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
    background: colors.bg,
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
    background: 'linear-gradient(135deg, #5b8fc7, #8fb4d8)',
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
  filterSelect: {
    minHeight: 40, padding: `0 ${mobileTokens.space.md}px`,
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.md, color: '#fff',
    fontSize: mobileTokens.font.sm, fontFamily: 'inherit', outline: 'none', width: '100%',
  },
  earnCard: {
    margin: `${mobileTokens.space.lg}px ${mobileTokens.space.lg}px 0`,
    padding: mobileTokens.space.lg, background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)', borderRadius: mobileTokens.radius.lg,
  },
  earnTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: mobileTokens.space.md },
  earnDetail: { fontSize: mobileTokens.font.sm, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  earnAmount: { fontSize: 22, fontWeight: 700, color: '#86efac' },
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
  assetLink: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '6px 12px',
    background: 'rgba(99,102,241,0.12)',
    color: '#a5b4fc',
    border: '1px solid rgba(99,102,241,0.3)',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    textDecoration: 'none',
  },
  metaLine: {
    marginTop: mobileTokens.space.sm,
    fontSize: mobileTokens.font.sm, color: 'rgba(255,255,255,0.5)',
  },
  statusActions: { display: 'flex', gap: mobileTokens.space.sm },
  statusBtn: {
    flex: 1, minHeight: mobileTokens.tap + 4, padding: mobileTokens.space.md,
    background: 'linear-gradient(135deg, #5b8fc7, #8fb4d8)', border: 'none',
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
    borderRadius: '50%', background: 'linear-gradient(135deg, #5b8fc7, #8fb4d8)',
    color: '#fff', cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit', flexShrink: 0,
  },
};
