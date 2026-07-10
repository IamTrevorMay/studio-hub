import React, { useState, useEffect, useCallback } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import AgencyThread from '../components/AgencyThread';
import { DELIVERABLE_TYPES, REVIEW_STATUS_OPTIONS } from './Deliverables';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamily, shadows, zIndex } from '../lib/styleTokens';
import { button, input, pill, modalOverlay, modal } from '../lib/styleRecipes';

// Read-only partner portal for the ad agency ('agency' role). Locked,
// sidebar-free page: upcoming deliverable statuses, campaign briefs,
// comment threads, and ad-read proposal submission. Data access is
// enforced by RLS (agency_deliverables / agency_briefs views + own
// ad_read_proposals rows) — this page only ever reads those.

const REVIEW_STATUS_BY_VALUE = REVIEW_STATUS_OPTIONS.reduce((acc, o) => { acc[o.value] = o; return acc; }, {});
const PROPOSAL_STATUS_TONES = {
  pending: { bg: colors.warning.bg, color: colors.warning.fgSoft, label: 'Pending review' },
  accepted: { bg: colors.success.bg, color: colors.success.fgSoft, label: 'Accepted' },
  declined: { bg: colors.danger.bg, color: colors.danger.fgSoft, label: 'Declined' },
};
const CHANNEL_OPTIONS = [
  { value: 'mayday', label: 'Mayday' },
  { value: 'tmb', label: 'TM Baseball' },
  { value: 'socials', label: 'Social' },
];
const POLL_MS = 20000;

// Date-only strings must not go through new Date('YYYY-MM-DD') (parses as
// UTC and shifts a day in PT) — see src/lib/ptDate.js conventions.
function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function isPastDue(dateStr) {
  if (!dateStr) return false;
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return dateStr < todayKey;
}
function fmtMonth(yyyymm) {
  if (!yyyymm) return '';
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
function timeframeFromItems(items) {
  const months = [...new Set(items.map((it) => it.due_month).filter(Boolean))].sort();
  if (months.length === 0) return null;
  if (months.length === 1) return fmtMonth(months[0]);
  return `${fmtMonth(months[0])} – ${fmtMonth(months[months.length - 1])}`;
}
function blankItem() {
  return { title: '', deliverable_type: 'long_form_read', channel: 'mayday', due_month: '', pay: '' };
}

export default function AgencyPortal() {
  const { profile, signOut } = useAuth();

  const [deliverables, setDeliverables] = useState([]);
  const [briefs, setBriefs] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openThreadKey, setOpenThreadKey] = useState(null); // 'deliverable:<id>' | 'proposal:<id>'
  const [showCompleted, setShowCompleted] = useState(false);
  const [briefModal, setBriefModal] = useState(null); // { label, onepager_md }

  // Proposal form
  const [showProposalForm, setShowProposalForm] = useState(false);
  const [proposalForm, setProposalForm] = useState({ sponsor_name: '', description: '' });
  const [proposalItems, setProposalItems] = useState([blankItem()]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Markdown styles for brief one-pagers (same block Deliverables injects)
  useEffect(() => {
    if (typeof document === 'undefined' || document.getElementById('brief-md-styles')) return;
    const el = document.createElement('style');
    el.id = 'brief-md-styles';
    el.textContent = `
      .brief-md h2 { font-size: 14px; font-weight: 700; color: #fff; margin: 18px 0 8px; letter-spacing: -0.01em; text-transform: uppercase; }
      .brief-md h2:first-child { margin-top: 0; }
      .brief-md p { margin: 0 0 10px; color: rgba(255,255,255,0.78); }
      .brief-md ul { margin: 0 0 12px; padding-left: 20px; color: rgba(255,255,255,0.78); }
      .brief-md li { margin-bottom: 4px; }
      .brief-md strong { color: #fff; font-weight: 600; }
      .brief-md a { color: #a5b4fc; }
      .brief-md code { background: rgba(99,102,241,0.15); padding: 1px 6px; border-radius: 4px; font-size: 12px; }
    `;
    document.head.appendChild(el);
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const [dRes, bRes, pRes, cRes] = await Promise.all([
        supabase.from('agency_deliverables').select('*').order('due_date', { ascending: true, nullsFirst: false }),
        supabase.from('agency_briefs').select('*').order('position', { ascending: true }),
        supabase.from('ad_read_proposals').select('*, items:ad_read_proposal_items(id, title, deliverable_type, channel, due_month, pay, position)').order('created_at', { ascending: false }),
        supabase.from('agency_comments').select('*, author:profiles(id, full_name, nickname)').order('created_at', { ascending: true }),
      ]);
      if (!dRes.error) setDeliverables(dRes.data || []);
      if (!bRes.error) setBriefs(bRes.data || []);
      if (!pRes.error) setProposals(pRes.data || []);
      if (!cRes.error) setComments(cRes.data || []);
    } catch (err) {
      console.error('Error fetching agency portal data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useVisibilityRefresh(fetchAll);

  useEffect(() => {
    fetchAll();
    // Comments and own proposals stream over realtime; deliverable/brief
    // changes are outside the agency's RLS read set, so a short poll keeps
    // statuses fresh instead.
    const channel = supabase.channel('agency-portal-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agency_comments' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ad_read_proposals' }, () => fetchAll())
      .subscribe();
    const interval = setInterval(fetchAll, POLL_MS);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [fetchAll]);

  const commentsByEntity = comments.reduce((acc, c) => {
    const key = `${c.entity_type}:${c.entity_id}`;
    (acc[key] = acc[key] || []).push(c);
    return acc;
  }, {});

  async function postComment(entityType, entityId, body) {
    const { error } = await supabase.from('agency_comments').insert({
      entity_type: entityType,
      entity_id: entityId,
      author_id: profile.id,
      body,
    });
    if (error) {
      console.error('Error posting comment:', error);
      alert('Could not post your comment. Please try again.');
      return;
    }
    fetchAll();
  }

  function updateItem(idx, patch) {
    setProposalItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function handleSubmitProposal(e) {
    e.preventDefault();
    setFormError('');
    if (!proposalForm.sponsor_name.trim()) { setFormError('Please add the brand / sponsor name.'); return; }
    const items = proposalItems.filter((it) => it.title.trim());
    if (items.length === 0) { setFormError('Add at least one deliverable with a title.'); return; }
    setSubmitting(true);
    try {
      const { data: proposal, error } = await supabase
        .from('ad_read_proposals')
        .insert({
          sponsor_name: proposalForm.sponsor_name.trim(),
          description: proposalForm.description.trim() || null,
          timeframe: timeframeFromItems(items),
          status: 'pending',
          created_by: profile.id,
        })
        .select()
        .single();
      if (error) throw error;
      const { error: itemsError } = await supabase.from('ad_read_proposal_items').insert(
        items.map((it, i) => ({
          proposal_id: proposal.id,
          title: it.title.trim(),
          deliverable_type: it.deliverable_type,
          channel: it.channel || null,
          due_month: it.due_month || null,
          pay: it.pay === '' ? null : Number(it.pay),
          position: i,
        }))
      );
      if (itemsError) throw itemsError;
      setShowProposalForm(false);
      setProposalForm({ sponsor_name: '', description: '' });
      setProposalItems([blankItem()]);
      fetchAll();
    } catch (err) {
      console.error('Error submitting proposal:', err);
      setFormError('Something went wrong submitting the proposal. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const upcoming = deliverables.filter((d) => !d.delivered);
  const completed = deliverables.filter((d) => d.delivered);

  function renderThreadToggle(entityType, entityId) {
    const key = `${entityType}:${entityId}`;
    const thread = commentsByEntity[key] || [];
    const last = thread[thread.length - 1];
    const hasTeamReply = last && last.author_role !== 'agency';
    const isOpen = openThreadKey === key;
    return (
      <button
        onClick={() => setOpenThreadKey(isOpen ? null : key)}
        style={{ ...styles.threadToggle, ...(isOpen ? styles.threadToggleOpen : {}) }}
      >
        💬 {thread.length > 0 ? thread.length : 'Comment'}
        {hasTeamReply && !isOpen && <span style={styles.replyDot} />}
      </button>
    );
  }

  function renderDeliverableCard(d) {
    const statusOpt = REVIEW_STATUS_BY_VALUE[d.review_status] || REVIEW_STATUS_OPTIONS[0];
    const typeInfo = DELIVERABLE_TYPES[d.deliverable_type];
    const dBriefs = briefs.filter((b) => b.campaign_id && b.campaign_id === d.campaign_id);
    const key = `deliverable:${d.id}`;
    const overdue = !d.delivered && isPastDue(d.due_date);
    return (
      <div key={d.id} style={styles.card}>
        <div style={styles.cardTop}>
          <div style={styles.cardTitleWrap}>
            <span style={styles.cardTitle}>{typeInfo?.icon ? `${typeInfo.icon} ` : ''}{d.title || typeInfo?.label || 'Deliverable'}</span>
            <div style={styles.cardMetaRow}>
              {d.brand_name && <span style={styles.brandChip}>{d.brand_name}</span>}
              {!d.brand_name && d.sponsor_name && <span style={styles.brandChip}>{d.sponsor_name}</span>}
              {typeInfo && <span style={styles.metaText}>{typeInfo.label}</span>}
              {(d.platforms || []).length > 0 && <span style={styles.metaText}>{d.platforms.join(' · ')}</span>}
            </div>
          </div>
          <div style={styles.cardRight}>
            <span style={{ ...styles.statusPill, background: statusOpt.bg, color: statusOpt.color }}>
              {d.delivered ? 'Delivered' : statusOpt.label}
            </span>
            <span style={{ ...styles.dueDate, ...(overdue ? { color: colors.danger.fgSoft } : {}) }}>
              Due {fmtDate(d.due_date)}
            </span>
          </div>
        </div>
        <div style={styles.cardActions}>
          {dBriefs.map((b) => (
            b.url
              ? <a key={b.id} href={b.url} target="_blank" rel="noopener noreferrer" style={styles.briefLink}>📄 {b.label || 'Brief'}</a>
              : b.onepager_md
                ? <button key={b.id} onClick={() => setBriefModal({ label: b.label || d.brand_name || 'Brief', onepager_md: b.onepager_md })} style={styles.briefLink}>📄 {b.label || 'Brief'}</button>
                : null
          ))}
          {renderThreadToggle('deliverable', d.id)}
        </div>
        {openThreadKey === key && (
          <div style={styles.threadWrap}>
            <AgencyThread
              comments={commentsByEntity[key] || []}
              onPost={(body) => postComment('deliverable', d.id, body)}
              emptyText="Start the conversation — the Mayday team is notified of every comment."
            />
          </div>
        )}
      </div>
    );
  }

  function renderProposalCard(p) {
    const tone = PROPOSAL_STATUS_TONES[p.status] || PROPOSAL_STATUS_TONES.pending;
    const key = `proposal:${p.id}`;
    const items = [...(p.items || [])].sort((a, b) => (a.position || 0) - (b.position || 0));
    return (
      <div key={p.id} style={styles.card}>
        <div style={styles.cardTop}>
          <div style={styles.cardTitleWrap}>
            <span style={styles.cardTitle}>{p.sponsor_name}</span>
            <div style={styles.cardMetaRow}>
              {p.timeframe && <span style={styles.metaText}>{p.timeframe}</span>}
              <span style={styles.metaText}>Submitted {fmtDate((p.created_at || '').slice(0, 10))}</span>
            </div>
          </div>
          <span style={{ ...styles.statusPill, background: tone.bg, color: tone.color }}>{tone.label}</span>
        </div>
        {p.description && <div style={styles.proposalDesc}>{p.description}</div>}
        {items.length > 0 && (
          <ul style={styles.itemList}>
            {items.map((it) => (
              <li key={it.id} style={styles.itemRow}>
                <span>{DELIVERABLE_TYPES[it.deliverable_type]?.icon} {it.title}</span>
                <span style={styles.metaText}>{[it.due_month ? fmtMonth(it.due_month) : null, it.pay != null ? `$${Number(it.pay).toLocaleString()}` : null].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        )}
        <div style={styles.cardActions}>{renderThreadToggle('proposal', p.id)}</div>
        {openThreadKey === key && (
          <div style={styles.threadWrap}>
            <AgencyThread
              comments={commentsByEntity[key] || []}
              onPost={(body) => postComment('proposal', p.id, body)}
              emptyText="Questions about this proposal? Leave a note for the team."
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <img src="/logo.png" alt="Mayday Studio" style={styles.logo} />
          <div>
            <div style={styles.headerTitle}>Mayday Studio</div>
            <div style={styles.headerSub}>Deliverables Portal</div>
          </div>
        </div>
        <div style={styles.headerRight}>
          <span style={styles.liveChip}><span style={styles.liveDot} />Live</span>
          <button onClick={signOut} style={button({ variant: 'ghost', size: 'sm' })}>Sign out</button>
        </div>
      </header>

      <main style={styles.main}>
        <section style={styles.section}>
          <div style={styles.sectionHead}>
            <h2 style={styles.sectionTitle}>Upcoming Deliverables</h2>
            <span style={styles.sectionCount}>{upcoming.length}</span>
          </div>
          {loading && <div style={styles.emptyState}>Loading…</div>}
          {!loading && upcoming.length === 0 && <div style={styles.emptyState}>Nothing in the pipeline right now.</div>}
          {upcoming.map(renderDeliverableCard)}
          {completed.length > 0 && (
            <button onClick={() => setShowCompleted((v) => !v)} style={styles.completedToggle}>
              {showCompleted ? '▾' : '▸'} Delivered ({completed.length})
            </button>
          )}
          {showCompleted && completed.map(renderDeliverableCard)}
        </section>

        <section style={styles.section}>
          <div style={styles.sectionHead}>
            <h2 style={styles.sectionTitle}>Your Proposals</h2>
            <button onClick={() => { setShowProposalForm(true); setFormError(''); }} style={button({ variant: 'primary', size: 'sm' })}>
              + Submit Proposal
            </button>
          </div>
          {!loading && proposals.length === 0 && <div style={styles.emptyState}>No proposals yet — submit one to get a campaign on the books.</div>}
          {proposals.map(renderProposalCard)}
        </section>
      </main>

      {showProposalForm && (
        <div style={modalOverlay()} onClick={() => !submitting && setShowProposalForm(false)}>
          <div style={{ ...modal({ width: 620 }), maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Submit a Proposal</h3>
            <form onSubmit={handleSubmitProposal} style={styles.form}>
              <label style={styles.label}>
                Brand / sponsor
                <input
                  value={proposalForm.sponsor_name}
                  onChange={(e) => setProposalForm((f) => ({ ...f, sponsor_name: e.target.value }))}
                  placeholder="e.g. SeatGeek"
                  style={input()}
                />
              </label>
              <label style={styles.label}>
                Description (optional)
                <textarea
                  value={proposalForm.description}
                  onChange={(e) => setProposalForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Campaign context, goals, creative direction…"
                  rows={3}
                  style={{ ...input(), resize: 'vertical', fontFamily: 'inherit' }}
                />
              </label>

              <div style={styles.itemsHead}>
                <span style={styles.label}>Deliverables</span>
                <button type="button" onClick={() => setProposalItems((prev) => [...prev, blankItem()])} style={button({ variant: 'secondary', size: 'sm' })}>
                  + Add
                </button>
              </div>
              {proposalItems.map((it, idx) => (
                <div key={idx} style={styles.itemForm}>
                  <input
                    value={it.title}
                    onChange={(e) => updateItem(idx, { title: e.target.value })}
                    placeholder="Deliverable title"
                    style={{ ...input({ size: 'sm' }), gridColumn: '1 / -1' }}
                  />
                  <select value={it.deliverable_type} onChange={(e) => updateItem(idx, { deliverable_type: e.target.value })} style={input({ size: 'sm' })}>
                    {Object.entries(DELIVERABLE_TYPES).map(([value, t]) => <option key={value} value={value}>{t.label}</option>)}
                  </select>
                  <select value={it.channel} onChange={(e) => updateItem(idx, { channel: e.target.value })} style={input({ size: 'sm' })}>
                    {CHANNEL_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                  <input type="month" value={it.due_month} onChange={(e) => updateItem(idx, { due_month: e.target.value })} style={input({ size: 'sm' })} />
                  <div style={styles.itemTail}>
                    <input
                      type="number" min="0" step="1"
                      value={it.pay}
                      onChange={(e) => updateItem(idx, { pay: e.target.value })}
                      placeholder="$ (optional)"
                      style={input({ size: 'sm' })}
                    />
                    {proposalItems.length > 1 && (
                      <button type="button" onClick={() => setProposalItems((prev) => prev.filter((_, i) => i !== idx))} style={styles.removeItemBtn} title="Remove">✕</button>
                    )}
                  </div>
                </div>
              ))}

              {formError && <div style={styles.formError}>{formError}</div>}
              <div style={styles.formActions}>
                <button type="button" onClick={() => setShowProposalForm(false)} disabled={submitting} style={button({ variant: 'ghost', size: 'md', disabled: submitting })}>Cancel</button>
                <button type="submit" disabled={submitting} style={button({ variant: 'primary', size: 'md', disabled: submitting })}>
                  {submitting ? 'Submitting…' : 'Submit Proposal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {briefModal && (
        <div style={modalOverlay()} onClick={() => setBriefModal(null)}>
          <div style={{ ...modal({ width: 680 }), maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>{briefModal.label}</h3>
            <div
              className="brief-md"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(briefModal.onepager_md || '')) }}
            />
            <div style={styles.formActions}>
              <button onClick={() => setBriefModal(null)} style={button({ variant: 'secondary', size: 'md' })}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: colors.bg,
    color: colors.text,
    fontFamily,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${spacing.lg}px ${spacing.xxl}px`,
    borderBottom: `1px solid ${colors.border}`,
    position: 'sticky',
    top: 0,
    background: colors.bg,
    zIndex: zIndex.dropdown,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: spacing.md },
  logo: { width: 36, height: 36, borderRadius: radii.md },
  headerTitle: { fontSize: fontSizes.xl, fontWeight: fontWeights.bold, letterSpacing: -0.2 },
  headerSub: { fontSize: fontSizes.xs, color: colors.textSubtle },
  headerRight: { display: 'flex', alignItems: 'center', gap: spacing.md },
  liveChip: {
    ...pill('success'),
    fontSize: fontSizes.xxs,
    padding: `2px ${spacing.sm}px`,
  },
  liveDot: {
    width: 6, height: 6, borderRadius: radii.circle,
    background: colors.success.fg,
    display: 'inline-block',
  },
  main: {
    maxWidth: 860,
    margin: '0 auto',
    padding: `${spacing.xxl}px ${spacing.xl}px ${spacing.xxxl * 2}px`,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.xxxl,
  },
  section: { display: 'flex', flexDirection: 'column', gap: spacing.md },
  sectionHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  sectionTitle: { fontSize: fontSizes.xxl, fontWeight: fontWeights.bold, margin: 0, letterSpacing: -0.3 },
  sectionCount: {
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.pill,
    padding: `2px ${spacing.md}px`,
    fontSize: fontSizes.sm,
    color: colors.textSubtle,
  },
  emptyState: {
    color: colors.textDim,
    fontSize: fontSizes.md,
    padding: `${spacing.xl}px 0`,
    textAlign: 'center',
  },
  card: {
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.lg,
    padding: spacing.lg,
    boxShadow: shadows.sm,
  },
  cardTop: { display: 'flex', justifyContent: 'space-between', gap: spacing.lg, flexWrap: 'wrap' },
  cardTitleWrap: { display: 'flex', flexDirection: 'column', gap: spacing.xs, minWidth: 200, flex: 1 },
  cardTitle: { fontSize: fontSizes.lg, fontWeight: fontWeights.semibold },
  cardMetaRow: { display: 'flex', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  brandChip: {
    background: colors.accentSoft,
    color: colors.accentFg,
    borderRadius: radii.pill,
    padding: `1px ${spacing.sm}px`,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
  },
  metaText: { color: colors.textSubtle, fontSize: fontSizes.xs },
  cardRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: spacing.xs },
  statusPill: {
    borderRadius: radii.pill,
    padding: `2px ${spacing.md}px`,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    whiteSpace: 'nowrap',
  },
  dueDate: { fontSize: fontSizes.xs, color: colors.textSubtle },
  cardActions: { display: 'flex', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' },
  briefLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing.xs,
    background: 'transparent',
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: radii.pill,
    padding: `2px ${spacing.md}px`,
    fontSize: fontSizes.xs,
    color: colors.textMuted,
    cursor: 'pointer',
    textDecoration: 'none',
    fontFamily: 'inherit',
  },
  threadToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing.xs,
    background: 'transparent',
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: radii.pill,
    padding: `2px ${spacing.md}px`,
    fontSize: fontSizes.xs,
    color: colors.textMuted,
    cursor: 'pointer',
    fontFamily: 'inherit',
    position: 'relative',
  },
  threadToggleOpen: {
    borderColor: colors.accentBorder,
    background: colors.accentSoft,
    color: colors.accentFg,
  },
  replyDot: {
    width: 8, height: 8, borderRadius: radii.circle,
    background: colors.accent,
    display: 'inline-block',
  },
  threadWrap: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTop: `1px solid ${colors.border}`,
  },
  proposalDesc: {
    color: colors.textMuted,
    fontSize: fontSizes.md,
    marginTop: spacing.sm,
    whiteSpace: 'pre-wrap',
  },
  itemList: {
    listStyle: 'none',
    margin: `${spacing.md}px 0 0`,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.xs,
  },
  itemRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: spacing.md,
    fontSize: fontSizes.sm,
    color: colors.textMuted,
    padding: `${spacing.xs}px ${spacing.sm}px`,
    background: colors.bgHover,
    borderRadius: radii.sm,
  },
  completedToggle: {
    background: 'transparent',
    border: 'none',
    color: colors.textSubtle,
    fontSize: fontSizes.sm,
    cursor: 'pointer',
    textAlign: 'left',
    padding: `${spacing.sm}px 0`,
    fontFamily: 'inherit',
  },
  modalTitle: { margin: `0 0 ${spacing.lg}px`, fontSize: fontSizes.xl, fontWeight: fontWeights.bold },
  form: { display: 'flex', flexDirection: 'column', gap: spacing.lg },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.xs,
    fontSize: fontSizes.sm,
    color: colors.textMuted,
    fontWeight: fontWeights.medium,
  },
  itemsHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  itemForm: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr 1fr',
    gap: spacing.sm,
    padding: spacing.md,
    background: colors.bgHover,
    borderRadius: radii.md,
  },
  itemTail: { display: 'flex', gap: spacing.xs, alignItems: 'center' },
  removeItemBtn: {
    background: 'transparent',
    border: 'none',
    color: colors.textDim,
    cursor: 'pointer',
    fontSize: fontSizes.md,
    padding: spacing.xs,
    fontFamily: 'inherit',
  },
  formError: { color: colors.danger.fgSoft, fontSize: fontSizes.sm },
  formActions: { display: 'flex', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
};
