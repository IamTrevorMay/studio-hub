import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import BottomSheet from '../components/mobile/BottomSheet';
import ContractorAssignmentModal from '../components/ContractorAssignmentModal';
import { mobileTokens, mobileTapButton } from '../utils/mobileTokens';
import usePersistedTab from '../hooks/usePersistedTab';

// Mobile Contractors: list-and-tap design for the three things an admin
// reaches for from a phone — review/edit contractor assignments, comment
// on stuck items, and approve submitted hours. Team CRUD + document
// signing stay on desktop.

const TABS = ['Assignments', 'Hours'];

const STATUS_COLORS = {
  assigned:    { bg: 'rgba(96,165,250,0.15)',  fg: '#60a5fa' },
  in_progress: { bg: 'rgba(251,191,36,0.15)',  fg: '#fbbf24' },
  completed:   { bg: 'rgba(52,211,153,0.15)',  fg: '#34d399' },
};
const STATUS_LABELS = { assigned: 'Assigned', in_progress: 'In Progress', completed: 'Completed' };

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d.length === 10 ? d + 'T00:00:00' : d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtShortDate(d) {
  if (!d) return '';
  const dt = new Date(d.length === 10 ? d + 'T00:00:00' : d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function FreelancersMobile() {
  const { profile, isAdmin } = useAuth();
  const [tab, setTab] = usePersistedTab('freelancers-tab-mobile', 'Assignments', ['Assignments', 'Hours']);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [openAssignment, setOpenAssignment] = useState(null);
  const [openHours, setOpenHours] = useState(null);

  if (!isAdmin) return <div style={styles.empty}>Admin access required.</div>;

  return (
    <div style={styles.root}>
      <div style={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{ ...styles.tab, ...(t === tab ? styles.tabActive : {}) }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Assignments' && (
        <AssignmentsPane
          onOpen={setOpenAssignment}
          onEdit={setEditing}
        />
      )}
      {tab === 'Hours' && (
        <HoursPane currentUserId={profile?.id} onOpen={setOpenHours} />
      )}

      <button onClick={() => setCreating(true)} style={styles.fab} aria-label="New assignment">+</button>

      <ContractorAssignmentModal
        open={creating || !!editing}
        existing={editing || undefined}
        onClose={() => { setCreating(false); setEditing(null); }}
        onCreated={() => { setCreating(false); }}
        onSaved={() => { setEditing(null); }}
        currentUserId={profile?.id}
      />

      <BottomSheet
        open={!!openAssignment}
        onClose={() => setOpenAssignment(null)}
        title={openAssignment?.title || 'Assignment'}
        maxHeight="90vh"
      >
        {openAssignment && (
          <AssignmentDetail
            assignment={openAssignment}
            currentUserId={profile?.id}
            onEdit={() => { const a = openAssignment; setOpenAssignment(null); setEditing(a); }}
            onClose={() => setOpenAssignment(null)}
          />
        )}
      </BottomSheet>

      <BottomSheet
        open={!!openHours}
        onClose={() => setOpenHours(null)}
        title="Hours review"
        maxHeight="80vh"
      >
        {openHours && (
          <HoursDetail
            entry={openHours}
            currentUserId={profile?.id}
            onReviewed={() => setOpenHours(null)}
          />
        )}
      </BottomSheet>
    </div>
  );
}

// ─── Assignments ──────────────────────────────────────────────

function AssignmentsPane({ onOpen, onEdit }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('freelancer_assignments')
      .select('*, freelancer:profiles!freelancer_assignments_freelancer_id_fkey(full_name, avatar_url)')
      .order('created_at', { ascending: false })
      .limit(100);
    setRows(data || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter((r) => statusFilter === 'all' || r.status === statusFilter);

  return (
    <div style={styles.pane}>
      <div style={styles.filterRow}>
        {['all', 'assigned', 'in_progress', 'completed'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              ...styles.filterPill,
              ...(statusFilter === s ? styles.filterPillActive : {}),
            }}
          >
            {s === 'all' ? 'All' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={styles.empty}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={styles.empty}>No assignments.</div>
      ) : (
        <div style={styles.list}>
          {filtered.map((a) => {
            const c = STATUS_COLORS[a.status] || STATUS_COLORS.assigned;
            // Parse date-only as LOCAL midnight, else US timezones flag it overdue on the due date itself.
            const overdue = a.due_date && new Date(a.due_date + 'T00:00:00') < new Date() && a.status !== 'completed';
            return (
              <button key={a.id} onClick={() => onOpen(a)} style={styles.row}>
                <div style={styles.rowTop}>
                  <span style={{ ...styles.pill, background: c.bg, color: c.fg }}>{STATUS_LABELS[a.status] || a.status}</span>
                  {a.declined_at && (
                    <span style={{ ...styles.pill, background: 'rgba(239,68,68,0.15)', color: '#fca5a5' }}>Declined</span>
                  )}
                  {overdue && (
                    <span style={{ ...styles.pill, background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>Overdue</span>
                  )}
                  {a.pay_amount && (
                    <span style={styles.payPill}>${Number(a.pay_amount).toLocaleString()}</span>
                  )}
                  <span style={{ flex: 1 }} />
                  {a.due_date && (
                    <span style={styles.dueText}>Due {fmtShortDate(a.due_date)}</span>
                  )}
                </div>
                <div style={styles.rowTitle}>{a.title || 'Untitled'}</div>
                <div style={styles.rowSub}>{a.freelancer?.full_name || 'Unknown contractor'}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AssignmentDetail({ assignment, currentUserId, onEdit, onClose }) {
  const [comments, setComments] = useState([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingComments(true);
      const { data } = await supabase
        .from('freelancer_assignment_comments')
        .select('*, author:profiles!freelancer_assignment_comments_author_id_fkey(full_name, avatar_url)')
        .eq('assignment_id', assignment.id)
        .order('created_at', { ascending: true });
      if (!cancelled) { setComments(data || []); setLoadingComments(false); }
    })();
    return () => { cancelled = true; };
  }, [assignment.id]);

  async function postComment() {
    if (!newComment.trim() || posting) return;
    setPosting(true);
    try {
      await supabase.from('freelancer_assignment_comments').insert({
        assignment_id: assignment.id,
        author_id: currentUserId,
        body: newComment.trim(),
      });
      if (assignment.freelancer_id !== currentUserId) {
        await supabase.from('notifications').insert({
          user_id: assignment.freelancer_id,
          type: 'fl_comment',
          title: 'New Comment',
          body: `New comment on "${assignment.title}"`,
          link_tab: 'fl_dashboard',
          link_target: assignment.id,
        });
      }
      const { data } = await supabase
        .from('freelancer_assignment_comments')
        .select('*, author:profiles!freelancer_assignment_comments_author_id_fkey(full_name, avatar_url)')
        .eq('assignment_id', assignment.id)
        .order('created_at', { ascending: true });
      setComments(data || []);
      setNewComment('');
    } finally {
      setPosting(false); // release even on error so the Post button doesn't lock
    }
  }

  return (
    <div style={detailStyles.root}>
      <div>
        <div style={detailStyles.subline}>{assignment.freelancer?.full_name || 'Unknown'}</div>
        {assignment.description && <p style={detailStyles.desc}>{assignment.description}</p>}
        <div style={detailStyles.metaGrid}>
          <DetailMeta label="Status" value={STATUS_LABELS[assignment.status] || assignment.status} />
          <DetailMeta label="Due" value={fmtDate(assignment.due_date)} />
          <DetailMeta label="Pay" value={assignment.pay_amount ? `$${Number(assignment.pay_amount).toLocaleString()}` : '—'} />
          <DetailMeta label="Created" value={fmtDate(assignment.created_at)} />
        </div>
        {assignment.asset_url && (
          <a href={assignment.asset_url} target="_blank" rel="noopener noreferrer" style={detailStyles.assetLink}>
            Open asset →
          </a>
        )}
      </div>

      <div style={detailStyles.commentsSection}>
        <div style={detailStyles.sectionLabel}>Comments ({comments.length})</div>
        {loadingComments ? (
          <div style={detailStyles.commentEmpty}>Loading…</div>
        ) : comments.length === 0 ? (
          <div style={detailStyles.commentEmpty}>No comments yet.</div>
        ) : (
          <div style={detailStyles.commentList}>
            {comments.map((c) => (
              <div key={c.id} style={detailStyles.commentRow}>
                <div style={detailStyles.commentMeta}>
                  <span style={detailStyles.commentAuthor}>{c.author?.full_name || 'Unknown'}</span>
                  <span style={detailStyles.commentTime}>{fmtShortDate(c.created_at)}</span>
                </div>
                <div style={detailStyles.commentBody}>{c.body}</div>
              </div>
            ))}
          </div>
        )}
        <div style={detailStyles.composer}>
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Write a comment…"
            rows={2}
            style={detailStyles.composerInput}
          />
          <button
            onClick={postComment}
            disabled={!newComment.trim() || posting}
            style={{ ...detailStyles.composerBtn, opacity: newComment.trim() && !posting ? 1 : 0.5 }}
          >
            {posting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>

      <div style={detailStyles.actions}>
        <button onClick={onClose} style={detailStyles.secondaryBtn}>Close</button>
        <button onClick={onEdit} style={detailStyles.primaryBtn}>Edit</button>
      </div>
    </div>
  );
}

// ─── Hours ────────────────────────────────────────────────────

function HoursPane({ currentUserId, onOpen }) {
  const [filter, setFilter] = useState('pending');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('freelancer_hours')
      .select('*, freelancer:profiles!freelancer_hours_freelancer_id_fkey(full_name)')
      .order('period_start', { ascending: false })
      .limit(100);
    setRows(data || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load, currentUserId]);

  const filtered = rows.filter((r) => {
    if (filter === 'pending') return !r.reviewed_at;
    if (filter === 'reviewed') return !!r.reviewed_at;
    return true;
  });

  return (
    <div style={styles.pane}>
      <div style={styles.filterRow}>
        {[['pending', 'Pending'], ['reviewed', 'Reviewed'], ['all', 'All']].map(([k, l]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            style={{ ...styles.filterPill, ...(filter === k ? styles.filterPillActive : {}) }}
          >
            {l}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={styles.empty}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={styles.empty}>No hours{filter === 'pending' ? ' to review' : ''}.</div>
      ) : (
        <div style={styles.list}>
          {filtered.map((h) => (
            <button key={h.id} onClick={() => onOpen(h)} style={styles.row}>
              <div style={styles.rowTop}>
                {h.reviewed_at ? (
                  <span style={{ ...styles.pill, background: 'rgba(52,211,153,0.15)', color: '#34d399' }}>Reviewed</span>
                ) : (
                  <span style={{ ...styles.pill, background: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}>Pending</span>
                )}
                <span style={{ flex: 1 }} />
                <span style={styles.hoursValue}>{Number(h.total_hours || 0).toFixed(1)}h</span>
              </div>
              <div style={styles.rowTitle}>{h.freelancer?.full_name || 'Unknown'}</div>
              <div style={styles.rowSub}>{fmtDate(h.period_start)} – {fmtDate(h.period_end)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HoursDetail({ entry, currentUserId, onReviewed }) {
  const [working, setWorking] = useState(false);

  async function approve() {
    if (working || entry.reviewed_at) return;
    setWorking(true);
    try {
      await supabase.from('freelancer_hours').update({
        reviewed_by: currentUserId,
        reviewed_at: new Date().toISOString(),
      }).eq('id', entry.id).is('reviewed_at', null);
      const periodLabel = `${fmtDate(entry.period_start)} – ${fmtDate(entry.period_end)}`;
      await supabase.from('notifications').insert({
        user_id: entry.freelancer_id,
        type: 'fl_hours_reviewed',
        title: 'Hours Reviewed',
        body: `Your hours for ${periodLabel} have been reviewed.`,
        link_tab: 'fl_hours',
        link_target: null,
      });
      onReviewed();
    } finally {
      setWorking(false); // release even on error so the button doesn't lock
    }
  }

  return (
    <div style={detailStyles.root}>
      <div style={detailStyles.metaGrid}>
        <DetailMeta label="Period" value={`${fmtDate(entry.period_start)} – ${fmtDate(entry.period_end)}`} />
        <DetailMeta label="Hours" value={`${Number(entry.total_hours || 0).toFixed(2)}h`} />
        <DetailMeta label="Status" value={entry.reviewed_at ? `Reviewed ${fmtShortDate(entry.reviewed_at)}` : 'Pending'} />
        {entry.notes && <DetailMeta label="Notes" value={entry.notes} />}
      </div>

      <div style={detailStyles.actions}>
        {!entry.reviewed_at && (
          <button onClick={approve} disabled={working} style={detailStyles.primaryBtn}>
            {working ? 'Saving…' : 'Mark reviewed'}
          </button>
        )}
      </div>
    </div>
  );
}

function DetailMeta({ label, value }) {
  return (
    <div style={detailStyles.metaCell}>
      <div style={detailStyles.metaLabel}>{label}</div>
      <div style={detailStyles.metaValue}>{value}</div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────

const styles = {
  root: {
    display: 'flex', flexDirection: 'column', minHeight: '100%',
    background: '#0f0f1a', color: '#e2e8f0', position: 'relative',
  },
  tabs: {
    display: 'flex', gap: 6, padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px ${mobileTokens.space.sm}px`,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  tab: {
    flex: 1, ...mobileTapButton, minHeight: 36,
    padding: '8px 12px', borderRadius: mobileTokens.radius.pill,
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.55)', fontSize: mobileTokens.font.sm, fontWeight: 600,
  },
  tabActive: { background: 'rgba(99,102,241,0.18)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.3)' },
  pane: { flex: 1, minHeight: 0, padding: `0 ${mobileTokens.space.lg}px ${mobileTokens.space.xxxl}px` },
  filterRow: { display: 'flex', flexWrap: 'wrap', gap: 6, padding: `${mobileTokens.space.md}px 0` },
  filterPill: {
    ...mobileTapButton, minHeight: 32, padding: '5px 12px',
    borderRadius: mobileTokens.radius.pill,
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.55)', fontSize: mobileTokens.font.xs, fontWeight: 600,
  },
  filterPillActive: { background: 'rgba(99,102,241,0.18)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.35)' },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  row: {
    ...mobileTapButton, width: '100%', textAlign: 'left',
    padding: `${mobileTokens.space.md}px`,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: mobileTokens.radius.md,
    display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch',
  },
  rowTop: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  rowTitle: { fontSize: mobileTokens.font.md, fontWeight: 600, color: '#fff', lineHeight: 1.3 },
  rowSub: { fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.5)' },
  pill: { fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: 0.4 },
  payPill: { fontSize: 11, fontWeight: 700, color: '#34d399' },
  dueText: { fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.45)' },
  hoursValue: { fontSize: mobileTokens.font.md, fontWeight: 700, color: '#a5b4fc' },
  empty: { padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: mobileTokens.font.md },
  fab: {
    position: 'fixed', right: 18, bottom: 86,
    width: 56, height: 56, borderRadius: '50%',
    background: '#6366f1', color: '#fff', border: 'none',
    fontSize: 30, lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit',
    boxShadow: '0 8px 22px rgba(99,102,241,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
  },
};

const detailStyles = {
  root: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.lg },
  subline: { fontSize: mobileTokens.font.sm, color: 'rgba(255,255,255,0.55)' },
  desc: { margin: '6px 0 0', fontSize: mobileTokens.font.sm, color: '#e2e8f0', lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  metaGrid: { marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 },
  metaCell: { display: 'flex', flexDirection: 'column', gap: 2 },
  metaLabel: { fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  metaValue: { fontSize: mobileTokens.font.sm, color: '#fff', fontWeight: 600 },
  assetLink: {
    display: 'inline-block', marginTop: 12,
    color: '#a5b4fc', fontSize: mobileTokens.font.sm, fontWeight: 600,
    textDecoration: 'underline',
  },
  commentsSection: { display: 'flex', flexDirection: 'column', gap: 8 },
  sectionLabel: { fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  commentEmpty: { padding: 12, fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.35)', fontStyle: 'italic', textAlign: 'center' },
  commentList: { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 240, overflowY: 'auto' },
  commentRow: { padding: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 },
  commentMeta: { display: 'flex', justifyContent: 'space-between', marginBottom: 4 },
  commentAuthor: { fontSize: mobileTokens.font.xs, fontWeight: 600, color: '#a5b4fc' },
  commentTime: { fontSize: 10, color: 'rgba(255,255,255,0.4)' },
  commentBody: { fontSize: mobileTokens.font.sm, color: '#e2e8f0', whiteSpace: 'pre-wrap' },
  composer: { display: 'flex', gap: 8, alignItems: 'flex-end' },
  composerInput: {
    flex: 1, background: 'rgba(0,0,0,0.25)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
    padding: 10, color: '#fff', fontSize: mobileTokens.font.sm,
    outline: 'none', fontFamily: 'inherit', resize: 'vertical',
  },
  composerBtn: {
    background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8,
    padding: '10px 14px', fontSize: mobileTokens.font.sm, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  primaryBtn: {
    background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8,
    padding: '10px 18px', fontSize: mobileTokens.font.sm, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  secondaryBtn: {
    background: 'transparent', color: 'rgba(255,255,255,0.7)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
    padding: '10px 18px', fontSize: mobileTokens.font.sm, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
};
