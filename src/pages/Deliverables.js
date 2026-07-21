import React, { useState, useEffect, useCallback, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { toast } from '../contexts/ToastContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import { callWorkflowFn } from '../lib/workflowApi';
import { ptMonthKey, ptDayKey } from '../lib/ptDate';
import BeatSheetChooserModal from '../components/BeatSheetChooserModal';
import { colors } from '../lib/styleTokens';

export const DELIVERABLE_TYPES = {
  long_form_read: { label: 'Long Form Read', icon: '\u{1F4D6}' },
  live_read: { label: 'Live Read', icon: '\u{1F399}\uFE0F' },
  short_form_video: { label: 'Short Form Video', icon: '\u{1F4F1}' },
};
const DELIVERABLE_PLATFORMS = ['YouTube', 'TikTok', 'Instagram', 'X/Twitter', 'Facebook', 'Substack', 'Podcast'];
const SPONSOR_STATUS_COLORS = { active: '#10b981', completed: '#5b8fc7', cancelled: '#ef4444' };
const PAYMENT_STATUS_COLORS = { unpaid: '#ef4444', partial: '#f59e0b', paid: '#10b981' };
export const CHANNEL_COLORS = {
  mayday: { bg: 'rgba(91, 143, 199,0.12)', color: '#8fb4d8', label: 'Mayday' },
  tmb: { bg: 'rgba(239,68,68,0.12)', color: '#fca5a5', label: 'TM Baseball' },
  socials: { bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)', label: 'Social' },
};
// Production-pipeline statuses for the Status column (stored in
// sponsor_deliverables.review_status — values enforced by a DB check).
export const REVIEW_STATUS_OPTIONS = [
  { value: 'queued', label: 'Queued', bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.55)' },
  { value: 'writing', label: 'Writing', bg: 'rgba(91, 143, 199,0.15)', color: '#8fb4d8' },
  { value: 'filming', label: 'Filming', bg: 'rgba(168,85,247,0.15)', color: '#c084fc' },
  { value: 'ready_for_review', label: 'Ready for Review', bg: 'rgba(245,158,11,0.15)', color: '#fbbf24' },
  { value: 'in_review', label: 'In Review', bg: 'rgba(14,165,233,0.15)', color: '#38bdf8' },
  { value: 'complete', label: 'Complete', bg: 'rgba(34,197,94,0.15)', color: '#22c55e' },
];
const REVIEW_STATUS_BY_VALUE = REVIEW_STATUS_OPTIONS.reduce((acc, o) => { acc[o.value] = o; return acc; }, {});

export default function Deliverables({ initialBrandId, onBrandOpened }) {
  const { profile, isAdmin, refreshKey } = useAuth();
  const confirm = useConfirm();

  // Sponsors state
  const [sponsors, setSponsors] = useState([]);
  const [sponsorLoading, setSponsorLoading] = useState(false);
  const [expandedBrandId, setExpandedBrandId] = useState(null);
  const [brandActiveOpen, setBrandActiveOpen] = useState(true);
  const [brandInactiveOpen, setBrandInactiveOpen] = useState(false);
  const [showDeliverableForm, setShowDeliverableForm] = useState(null);
  const [editingDeliverable, setEditingDeliverable] = useState(null);
  const [deliverableType, setDeliverableType] = useState('long_form_read');
  const [dueDate, setDueDate] = useState('');
  const [deliverableNotes, setDeliverableNotes] = useState('');
  const [adCopyModalOpen, setAdCopyModalOpen] = useState(false);
  const [beatSheetChooserOpen, setBeatSheetChooserOpen] = useState(false);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById('brief-md-styles')) return;
    const el = document.createElement('style');
    el.id = 'brief-md-styles';
    el.textContent = `
      .brief-md h2 { font-size: 14px; font-weight: 700; color: #fff; margin: 18px 0 8px; letter-spacing: -0.01em; text-transform: uppercase; }
      .brief-md h2:first-child { margin-top: 0; }
      .brief-md p { margin: 0 0 10px; color: rgba(255,255,255,0.78); }
      .brief-md ul { margin: 0 0 12px; padding-left: 20px; color: rgba(255,255,255,0.78); }
      .brief-md li { margin-bottom: 4px; }
      .brief-md strong { color: #fff; font-weight: 600; }
      .brief-md a { color: #8fb4d8; }
      .brief-md code { background: rgba(91, 143, 199,0.15); padding: 1px 6px; border-radius: 4px; font-size: 12px; }
    `;
    document.head.appendChild(el);
  }, []);
  const [deliverablePlatforms, setDeliverablePlatforms] = useState([]);
  const [deliverableNeedsReview, setDeliverableNeedsReview] = useState(false);
  const [deliverableBrandId, setDeliverableBrandId] = useState('');
  const [deliverablePay, setDeliverablePay] = useState('');
  const [deliverableVideoEventId, setDeliverableVideoEventId] = useState('');
  const [deliverableChannel, setDeliverableChannel] = useState('');
  const [deliverableReviewStatus, setDeliverableReviewStatus] = useState('queued');
  const [deliverableVideoUrl, setDeliverableVideoUrl] = useState('');
  const [deliverableReviewDue, setDeliverableReviewDue] = useState('');
  const [reviewDueEditId, setReviewDueEditId] = useState(null);

  // Video events for deliverable linking
  const [videoEvents, setVideoEvents] = useState([]);

  // Brand state
  const [showBrandForm, setShowBrandForm] = useState(false);
  const [editingBrand, setEditingBrand] = useState(null);
  const [brandForm, setBrandForm] = useState({ brand: '', description: '', start_date: '', end_date: '', contact_name: '', contact_email: '', payment_status: 'unpaid' });
  const [briefModalBrand, setBriefModalBrand] = useState(null);
  const [briefModalType, setBriefModalType] = useState('file'); // 'link' | 'file' | 'text'
  const [briefModalUrl, setBriefModalUrl] = useState('');
  const [briefModalLabel, setBriefModalLabel] = useState('');
  const [briefModalFile, setBriefModalFile] = useState(null);
  const [briefModalText, setBriefModalText] = useState('');
  const [briefModalSaving, setBriefModalSaving] = useState(false);
  const [briefModalProcessing, setBriefModalProcessing] = useState(false);
  const [briefModalError, setBriefModalError] = useState('');
  const [briefModalEditingId, setBriefModalEditingId] = useState(null);
  const [briefModalRegenerate, setBriefModalRegenerate] = useState(false);

  const [allDeliverables, setAllDeliverables] = useState([]);

  // Proposals state
  const [proposals, setProposals] = useState([]);
  const [proposalsLoading, setProposalsLoading] = useState(false);
  const [showProposalForm, setShowProposalForm] = useState(false);
  const [proposalsDrawerOpen, setProposalsDrawerOpen] = useState(false);
  const [proposalForm, setProposalForm] = useState({ sponsor_name: '', description: '' });
  const [proposalItems, setProposalItems] = useState([]); // [{ id?, title, deliverable_type, channel, due_month, pay, accepted }]
  const [editingProposal, setEditingProposal] = useState(null);
  const [draftProposalId, setDraftProposalId] = useState(null);

  // Read Slots state
  const [slotLimits, setSlotLimits] = useState([]);
  const [editingSlots, setEditingSlots] = useState(null);
  const [slotDraft, setSlotDraft] = useState({ mayday: '', tmb: '' });

  // Beat sheets for deliverable linking
  const [beatSheets, setBeatSheets] = useState([]);

  // Context menu + inline dropdowns for upcoming cards
  const [cardContextMenu, setCardContextMenu] = useState(null); // { x, y, deliverable }
  const [reviewDropdownId, setReviewDropdownId] = useState(null); // deliverable id showing status picker
  // Screen coords for the open inline dropdown. Position: fixed so the menu
  // escapes the table's overflowX container instead of being clipped by it.
  // Shared by both dropdowns — the click-away overlay guarantees only one is
  // open at a time. Clamped so the menu never runs off the viewport.
  const [inlineDropdownPos, setInlineDropdownPos] = useState({ top: 0, left: 0 });
  const openInlineDropdownAt = (el) => {
    const r = el.getBoundingClientRect();
    setInlineDropdownPos({
      top: Math.min(r.bottom + 4, window.innerHeight - 212),
      left: Math.min(r.left, window.innerWidth - 236),
    });
  };
  // Fixed-positioned menus don't follow their chip when the page scrolls —
  // close instead of drifting. Scrolls inside the menu itself are fine.
  useEffect(() => {
    if (!reviewDropdownId) return;
    const onScroll = (e) => {
      if (e.target instanceof Element && e.target.closest('[data-inline-dropdown]')) return;
      setReviewDropdownId(null);
    };
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [reviewDropdownId]);
  const [videoLinkModal, setVideoLinkModal] = useState(null); // deliverable pending finished-video link
  const [videoLinkInput, setVideoLinkInput] = useState('');

  // Table sorting + delivered toggle
  const [sortCol, setSortCol] = useState('schedule'); // default sort by schedule date
  const [sortDir, setSortDir] = useState('asc');
  const [showDelivered, setShowDelivered] = useState(false);

  // Schedule calendar modal
  const [scheduleModalDeliverable, setScheduleModalDeliverable] = useState(null);
  const [scheduleModalDate, setScheduleModalDate] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [scheduleModalHoveredEvent, setScheduleModalHoveredEvent] = useState(null);

  // Auto-expand a brand when navigated to from another page
  useEffect(() => {
    if (initialBrandId) {
      setExpandedBrandId(initialBrandId);
      if (onBrandOpened) onBrandOpened();
    }
  }, [initialBrandId, onBrandOpened]);

  // --- Data fetching ---
  const fetchSponsors = useCallback(async () => {
    setSponsorLoading(true);
    try {
      const { data, error } = await supabase
        .from('sponsors')
        .select('*, sponsor_deliverables(*, deliverable_stage_assignments(*, profile:profiles(id, full_name))), sponsor_campaigns(*, campaign_briefs(*))')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setSponsors(data || []);
      const flat = [];
      (data || []).forEach(s => {
        (s.sponsor_deliverables || []).forEach(d => {
          const brand = (s.sponsor_campaigns || []).find(c => c.id === d.campaign_id);
          flat.push({ ...d, sponsor_name: s.name, sponsor_id: s.id, brand_name: brand?.name || null, campaign_briefs: brand?.campaign_briefs || [] });
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
        .in('event_type', ['video_post', 'tmbb_video'])
        .order('start_date', { ascending: true });
      if (error) throw error;
      setVideoEvents(data || []);
    } catch (err) {
      console.error('Error fetching video events:', err);
    }
  }, []);

  const fetchProposals = useCallback(async () => {
    setProposalsLoading(true);
    try {
      const { data, error } = await supabase
        .from('ad_read_proposals')
        .select('*, creator:profiles(id, full_name), items:ad_read_proposal_items(id, title, deliverable_type, channel, due_month, pay, position)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const normalized = (data || []).map((p) => ({
        ...p,
        items: (p.items || []).sort((a, b) => (a.position || 0) - (b.position || 0)),
      }));
      setProposals(normalized);
    } catch (err) {
      console.error('Error fetching proposals:', err);
      setProposals([]);
    } finally {
      setProposalsLoading(false);
    }
  }, []);

  const fetchSlotLimits = useCallback(async () => {
    const { data, error } = await supabase
      .from('read_slot_limits')
      .select('*')
      .order('month', { ascending: true });
    if (error) console.error('Error fetching slot limits:', error);
    setSlotLimits(data || []);
  }, []);

  async function fetchBeatSheets() {
    try {
      const { data, error } = await supabase
        .from('beat_sheets')
        .select('id, title, folder, is_archived')
        .order('created_at', { ascending: false });
      if (!error) setBeatSheets(data || []);
    } catch (err) {
      console.error('Error fetching beat sheets:', err);
    }
  }

  useEffect(() => {
    fetchSponsors();
    fetchVideoEvents();
    fetchProposals();
    fetchSlotLimits();
    fetchBeatSheets();
  }, [fetchSponsors, fetchVideoEvents, fetchProposals, fetchSlotLimits]);

  useEffect(() => {
    const channel = supabase
      .channel('sponsors-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sponsors' }, () => fetchSponsors())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sponsor_deliverables' }, () => fetchSponsors())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sponsor_campaigns' }, () => fetchSponsors())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliverable_stage_assignments' }, () => fetchSponsors())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' }, () => fetchVideoEvents())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchSponsors, fetchVideoEvents, refreshKey]);

  useEffect(() => {
    const channel = supabase
      .channel('proposals-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ad_read_proposals' }, () => fetchProposals())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchProposals, refreshKey]);

  useVisibilityRefresh(fetchSponsors);

  // --- Proposal helpers ---
  function blankItem() {
    return { title: '', deliverable_type: 'long_form_read', channel: '', due_month: '', pay: '', accepted: false };
  }

  function formatMonthLabel(yyyymm) {
    if (!yyyymm) return '';
    const [y, m] = yyyymm.split('-').map(Number);
    if (!y || !m) return yyyymm;
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  function formatTimeframeFromItems(items) {
    const months = (items || []).map((i) => i.due_month).filter(Boolean).sort();
    if (months.length === 0) return null;
    const start = formatMonthLabel(months[0]);
    const end = formatMonthLabel(months[months.length - 1]);
    return start === end ? start : `${start} – ${end}`;
  }

  function monthBounds(items) {
    const months = (items || []).map((i) => i.due_month).filter(Boolean).sort();
    if (months.length === 0) return { start: null, end: null };
    const first = months[0] + '-01';
    const last = months[months.length - 1];
    const [ly, lm] = last.split('-').map(Number);
    const endD = new Date(ly, lm, 0); // last day of last month
    return { start: first, end: endD.toISOString().slice(0, 10) };
  }

  // --- Proposal handlers ---
  function resetProposalForm() {
    setProposalForm({ sponsor_name: '', description: '' });
    setProposalItems([]);
    setEditingProposal(null);
    setDraftProposalId(null);
    setShowProposalForm(false);
  }

  function openNewProposalForm() {
    setProposalForm({ sponsor_name: '', description: '' });
    setProposalItems([blankItem()]);
    setEditingProposal(null);
    setDraftProposalId(null);
    setShowProposalForm(true);
  }

  async function cancelProposalForm() {
    if (draftProposalId && !editingProposal) {
      const ok = await confirm('Discard this draft proposal and any deliverables you added?');
      if (!ok) return;
      await supabase.from('ad_read_proposals').delete().eq('id', draftProposalId);
    }
    resetProposalForm();
    fetchProposals();
  }

  function updateItem(idx, patch) {
    setProposalItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setProposalItems((prev) => [...prev, blankItem()]);
  }

  async function removeItem(idx) {
    const target = proposalItems[idx];
    if (target?.id) {
      const { error } = await supabase
        .from('ad_read_proposal_items')
        .delete()
        .eq('id', target.id);
      if (error) { toast.error('Error removing deliverable: ' + error.message); return; }
    }
    setProposalItems((prev) => prev.filter((_, i) => i !== idx));
  }

  // Ensure a backing proposal row exists (draft if new) and return its id.
  async function ensureProposalRow() {
    if (editingProposal) return editingProposal;
    if (draftProposalId) {
      // Keep draft fields in sync with the form (sponsor_name, description).
      await supabase.from('ad_read_proposals').update({
        sponsor_name: proposalForm.sponsor_name,
        description: proposalForm.description || null,
      }).eq('id', draftProposalId);
      return draftProposalId;
    }
    if (!proposalForm.sponsor_name.trim()) {
      toast.error('Sponsor name is required before accepting a deliverable.');
      return null;
    }
    const { data, error } = await supabase
      .from('ad_read_proposals')
      .insert({
        sponsor_name: proposalForm.sponsor_name,
        description: proposalForm.description || null,
        created_by: profile.id,
        status: 'draft',
      })
      .select()
      .single();
    if (error) { toast.error('Error starting draft: ' + error.message); return null; }
    setDraftProposalId(data.id);
    return data.id;
  }

  async function acceptItem(idx) {
    const it = proposalItems[idx];
    if (!it.title.trim()) {
      toast.error('Title is required.');
      return;
    }
    const proposalId = await ensureProposalRow();
    if (!proposalId) return;
    const row = {
      proposal_id: proposalId,
      title: it.title.trim(),
      deliverable_type: it.deliverable_type,
      channel: it.channel || null,
      due_month: it.due_month || null,
      pay: it.pay !== '' ? parseFloat(it.pay) : null,
      position: idx,
    };
    if (it.id) {
      const { error } = await supabase
        .from('ad_read_proposal_items')
        .update(row)
        .eq('id', it.id);
      if (error) { toast.error('Error saving deliverable: ' + error.message); return; }
      updateItem(idx, { accepted: true });
    } else {
      const { data, error } = await supabase
        .from('ad_read_proposal_items')
        .insert(row)
        .select()
        .single();
      if (error) { toast.error('Error saving deliverable: ' + error.message); return; }
      updateItem(idx, { id: data.id, accepted: true });
    }
  }

  function editItem(idx) {
    updateItem(idx, { accepted: false });
  }

  function allItemsAccepted() {
    if (proposalItems.length === 0) return false;
    return proposalItems.every((it) => it.accepted);
  }

  async function handleCreateProposal(e) {
    e.preventDefault();
    if (!proposalForm.sponsor_name.trim()) {
      toast.error('Sponsor name is required.');
      return;
    }
    if (proposalItems.length === 0) {
      toast.error('Add at least one deliverable.');
      return;
    }
    if (!allItemsAccepted()) {
      toast.error('Accept every deliverable before creating the proposal.');
      return;
    }
    const proposalId = await ensureProposalRow();
    if (!proposalId) return;
    const { error } = await supabase
      .from('ad_read_proposals')
      .update({
        sponsor_name: proposalForm.sponsor_name,
        description: proposalForm.description || null,
        status: 'pending',
      })
      .eq('id', proposalId);
    if (error) { toast.error('Error creating proposal: ' + error.message); return; }

    // Kick off the Ad Read Pipeline workflow — assigns a "Review proposal" task to the admin reviewer.
    try {
      const { instance_id } = await callWorkflowFn('workflow-start', {
        slug: 'ad_read_workflow',
        context: {
          proposal_id: proposalId,
          brand_name: proposalForm.sponsor_name,
        },
      });
      if (instance_id) {
        await supabase
          .from('ad_read_proposals')
          .update({ workflow_instance_id: instance_id })
          .eq('id', proposalId);
      }
    } catch (wfErr) {
      console.error('Failed to start ad read workflow:', wfErr);
    }

    // Emit event for kanban boards that auto-create cards on new proposals.
    try {
      await callWorkflowFn('workflow-trigger-event', {
        event: 'new_proposal_created',
        payload: { proposal_id: proposalId, sponsor_name: proposalForm.sponsor_name },
      });
    } catch (e) { console.error('Event trigger failed:', e); }

    resetProposalForm();
    fetchProposals();
  }

  async function handleConfirmProposal(proposal) {
    if (proposal.status === 'accepted') {
      toast.error('This proposal has already been accepted.');
      return;
    }
    try {
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

      const items = (proposal.items || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
      const bounds = monthBounds(items);
      const brandPayload = {
        sponsor_id: sponsorId,
        name: proposal.sponsor_name,
        description: proposal.description || null,
        payment_status: 'unpaid',
      };
      if (bounds.start) brandPayload.start_date = bounds.start;
      if (bounds.end) brandPayload.end_date = bounds.end;
      const { data: brand, error: cErr } = await supabase
        .from('sponsor_campaigns')
        .insert(brandPayload)
        .select()
        .single();
      if (cErr) throw cErr;

      if (items.length > 0) {
        const delivRows = items.map((it) => ({
          sponsor_id: sponsorId,
          campaign_id: brand.id,
          title: it.title,
          deliverable_type: it.deliverable_type,
          channel: it.channel || null,
          due_date: it.due_month ? it.due_month + '-01' : null,
          pay: it.pay != null ? Number(it.pay) : null,
          platforms: [],
          needs_review: false,
        }));
        const { error: dErr } = await supabase.from('sponsor_deliverables').insert(delivRows);
        if (dErr) throw dErr;
      }

      await supabase.from('ad_read_proposals').update({ status: 'accepted' }).eq('id', proposal.id);
      fetchProposals();
      fetchSponsors();
    } catch (err) {
      toast.error('Error confirming proposal: ' + err.message);
    }
  }

  async function handleDeclineProposal(id) {
    await supabase.from('ad_read_proposals').update({ status: 'declined' }).eq('id', id);
    fetchProposals();
  }

  function startEditProposal(p) {
    setEditingProposal(p.id);
    setDraftProposalId(null);
    setProposalForm({
      sponsor_name: p.sponsor_name,
      description: p.description || '',
    });
    setProposalItems((p.items || []).map((it) => ({
      id: it.id,
      title: it.title || '',
      deliverable_type: it.deliverable_type || 'long_form_read',
      channel: it.channel || '',
      due_month: it.due_month || '',
      pay: it.pay != null ? String(it.pay) : '',
      accepted: true,
    })));
    if (!p.items || p.items.length === 0) setProposalItems([blankItem()]);
    setShowProposalForm(true);
  }

  async function handleUpdateProposal(e) {
    e.preventDefault();
    if (!proposalForm.sponsor_name.trim()) {
      toast.error('Sponsor name is required.');
      return;
    }
    if (proposalItems.length === 0) {
      toast.error('Add at least one deliverable.');
      return;
    }
    if (!allItemsAccepted()) {
      toast.error('Accept every deliverable before saving.');
      return;
    }
    const { error } = await supabase.from('ad_read_proposals').update({
      sponsor_name: proposalForm.sponsor_name,
      description: proposalForm.description || null,
    }).eq('id', editingProposal);
    if (error) { toast.error('Error updating proposal: ' + error.message); return; }
    resetProposalForm();
    fetchProposals();
  }

  async function handleDeleteProposal(id) {
    if (!(await confirm('Delete this proposal?'))) return;
    await supabase.from('ad_read_proposals').delete().eq('id', id);
    fetchProposals();
  }

  // --- Read Slot handlers ---
  async function handleSaveSlotLimits(month) {
    for (const ch of ['mayday', 'tmb']) {
      const val = parseInt(slotDraft[ch]);
      if (isNaN(val) && !slotDraft[ch]) continue;
      const limit = isNaN(val) ? 0 : val;
      await supabase.from('read_slot_limits').upsert({
        month,
        channel: ch,
        slot_limit: limit,
        created_by: profile.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'month,channel' });
    }
    setEditingSlots(null);
    fetchSlotLimits();
  }

  // --- Deliverable handlers ---
  function resetDeliverableForm() {
    setDeliverableType('long_form_read');
    setDueDate(''); setDeliverableNotes('');
    setDeliverablePlatforms([]); setDeliverableNeedsReview(false); setDeliverableBrandId('');
    setDeliverablePay(''); setDeliverableVideoEventId('');
    setDeliverableChannel('');
    setDeliverableReviewStatus('queued');
    setDeliverableVideoUrl('');
    setDeliverableReviewDue('');
    setEditingDeliverable(null); setShowDeliverableForm(null);
  }

  function startEditDeliverable(d) {
    setDeliverableType(d.deliverable_type);
    setDueDate(d.due_date ? d.due_date.slice(0, 7) : '');
    setDeliverableNotes(d.ad_copy || d.notes || '');
    setDeliverablePlatforms(d.platforms || []);
    setDeliverableNeedsReview(d.needs_review || false);
    setDeliverableBrandId(d.campaign_id || '');
    setDeliverablePay(d.pay != null ? String(d.pay) : '');
    setDeliverableVideoEventId(d.video_event_id || '');
    setDeliverableChannel(d.channel || '');
    setDeliverableReviewStatus(d.review_status || 'queued');
    setDeliverableVideoUrl(d.video_url || '');
    setDeliverableReviewDue(d.review_due || '');
    setEditingDeliverable(d.id);
    setShowDeliverableForm(d.campaign_id);
  }

  async function handleSaveDeliverable(e, sponsorId, brandId) {
    e.preventDefault();
    const sponsor = sponsors.find(s => s.id === sponsorId);
    const autoTitle = `${DELIVERABLE_TYPES[deliverableType]?.label || deliverableType} — ${sponsor?.name || 'Sponsor'}`;
    if (editingDeliverable) {
      const deliverable = sponsor?.sponsor_deliverables?.find(d => d.id === editingDeliverable);
      const { error } = await supabase.from('sponsor_deliverables').update({
        title: autoTitle,
        deliverable_type: deliverableType,
        due_date: dueDate ? dueDate + '-01' : null,
        ad_copy: deliverableNotes || null,
        platforms: deliverablePlatforms,
        needs_review: deliverableNeedsReview,
        campaign_id: brandId || deliverableBrandId || null,
        pay: deliverablePay ? parseFloat(deliverablePay) : null,
        video_event_id: deliverableVideoEventId || null,
        channel: deliverableChannel || null,
        review_status: deliverableReviewStatus || 'queued',
        video_url: deliverableVideoUrl.trim() || null,
        delivered: !!deliverableVideoUrl.trim(),
        review_due: deliverableReviewDue || null,
        updated_at: new Date().toISOString(),
      }).eq('id', editingDeliverable);
      if (error) { toast.error('Error updating deliverable: ' + error.message); return; }

      const dueDateFull = dueDate ? dueDate + '-01' : null;
      if (dueDateFull && deliverable?.calendar_event_id) {
        await supabase.from('calendar_events').update({
          title: `\u{1F91D} ${sponsor?.name}: ${DELIVERABLE_TYPES[deliverableType]?.label || deliverableType}`,
          start_date: `${dueDateFull}T09:00:00`,
          end_date: `${dueDateFull}T10:00:00`,
        }).eq('id', deliverable.calendar_event_id);
      } else if (dueDateFull && !deliverable?.calendar_event_id) {
        const { data: evData } = await supabase.from('calendar_events').insert({
          title: `\u{1F91D} ${sponsor?.name}: ${DELIVERABLE_TYPES[deliverableType]?.label || deliverableType}`,
          event_type: 'sponsor',
          start_date: `${dueDateFull}T09:00:00`,
          end_date: `${dueDateFull}T10:00:00`,
          all_day: true,
          created_by: profile.id,
        }).select().single();
        if (evData) {
          await supabase.from('sponsor_deliverables').update({ calendar_event_id: evData.id }).eq('id', editingDeliverable);
        }
      } else if (!dueDateFull && deliverable?.calendar_event_id) {
        await supabase.from('calendar_events').delete().eq('id', deliverable.calendar_event_id);
        await supabase.from('sponsor_deliverables').update({ calendar_event_id: null }).eq('id', editingDeliverable);
      }
    } else {
      const { data: dData, error } = await supabase.from('sponsor_deliverables').insert({
        sponsor_id: sponsorId,
        title: autoTitle,
        deliverable_type: deliverableType,
        due_date: dueDate ? dueDate + '-01' : null,
        ad_copy: deliverableNotes || null,
        platforms: deliverablePlatforms,
        needs_review: deliverableNeedsReview,
        campaign_id: brandId || null,
        pay: deliverablePay ? parseFloat(deliverablePay) : null,
        video_event_id: deliverableVideoEventId || null,
        channel: deliverableChannel || null,
        review_status: deliverableReviewStatus || 'queued',
        video_url: deliverableVideoUrl.trim() || null,
        delivered: !!deliverableVideoUrl.trim(),
        review_due: deliverableReviewDue || null,
      }).select().single();
      if (error) { toast.error('Error creating deliverable: ' + error.message); return; }

      const newDueDateFull = dueDate ? dueDate + '-01' : null;
      if (newDueDateFull && dData) {
        const { data: evData } = await supabase.from('calendar_events').insert({
          title: `\u{1F91D} ${sponsor?.name}: ${DELIVERABLE_TYPES[deliverableType]?.label || deliverableType}`,
          event_type: 'sponsor',
          start_date: `${newDueDateFull}T09:00:00`,
          end_date: `${newDueDateFull}T10:00:00`,
          all_day: true,
          created_by: profile.id,
        }).select().single();
        if (evData) {
          await supabase.from('sponsor_deliverables').update({ calendar_event_id: evData.id }).eq('id', dData.id);
        }
      }
    }

    const syncCampId = brandId || deliverableBrandId;
    if (syncCampId) await syncBrandRevenue(syncCampId);

    resetDeliverableForm();
    fetchSponsors();
  }

  async function handleDeleteUnbranded() {
    if (!(await confirm(`Delete all ${unbrandedDeliverables.length} unbranded deliverables? This cannot be undone.`))) return;
    for (const d of unbrandedDeliverables) {
      if (d.calendar_event_id) {
        await supabase.from('calendar_events').delete().eq('id', d.calendar_event_id);
      }
      await supabase.from('sponsor_deliverables').delete().eq('id', d.id);
    }
    fetchSponsors();
  }

  async function handleDeleteDeliverable(deliverable) {
    if (deliverable.calendar_event_id) {
      await supabase.from('calendar_events').delete().eq('id', deliverable.calendar_event_id);
    }
    await supabase.from('sponsor_deliverables').delete().eq('id', deliverable.id);
    if (deliverable.campaign_id) await syncBrandRevenue(deliverable.campaign_id);
    fetchSponsors();
  }

  // Inline assign video event to deliverable from card dropdown
  async function handleInlineAssignVideo(deliverableId, videoEventId) {
    const { error } = await supabase.from('sponsor_deliverables').update({
      video_event_id: videoEventId || null,
      updated_at: new Date().toISOString(),
    }).eq('id', deliverableId);
    if (error) { console.error('Assign video failed:', error); return; }
    await fetchSponsors();
    setScheduleModalDeliverable(null);
  }

  async function handleInlineSetReviewStatus(deliverableId, status) {
    setReviewDropdownId(null);
    await supabase.from('sponsor_deliverables').update({
      review_status: status,
      updated_at: new Date().toISOString(),
    }).eq('id', deliverableId);
    fetchSponsors();
  }

  // Save finished-video link + mark delivered (from the "Video" button modal)
  function openVideoLinkModal(d) {
    setVideoLinkInput(d.video_url || '');
    setVideoLinkModal(d);
  }
  async function handleSaveVideoLink(e) {
    if (e) e.preventDefault();
    if (!videoLinkModal) return;
    const url = videoLinkInput.trim();
    if (!url) return;
    const { error } = await supabase.from('sponsor_deliverables').update({
      video_url: url,
      delivered: true,
      updated_at: new Date().toISOString(),
    }).eq('id', videoLinkModal.id);
    if (error) { toast.error('Error saving video link: ' + error.message); return; }
    setVideoLinkModal(null);
    setVideoLinkInput('');
    fetchSponsors();
  }

  // Inline "Review Due" chip on the table — date the ad must be submitted
  // for review by. Saves on picker change; empty value clears.
  async function handleSaveReviewDue(id, value) {
    setReviewDueEditId(null);
    const { error } = await supabase.from('sponsor_deliverables').update({
      review_due: value || null,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) { toast.error('Error saving review due date: ' + error.message); return; }
    fetchSponsors();
  }

  // Push the current ad copy into a chosen beat sheet (choose-at-push-time).
  // Stacks multiple ad reads per sheet, keyed by deliverable id: re-pushing the
  // SAME deliverable updates its own beat in place, a DIFFERENT deliverable
  // appends a new beat. Title starts with "Ad Read" (so existing detection still
  // works) and includes the sponsor/campaign name so stacked reads are distinct.
  const [pushingAdCopy, setPushingAdCopy] = useState(false);
  const [pushAdCopyDone, setPushAdCopyDone] = useState(false);
  async function pushAdCopyToSheet(sheetId) {
    if (!sheetId || !deliverableNotes) return;
    setPushingAdCopy(true);
    try {
      const { data: sheet } = await supabase
        .from('beat_sheets')
        .select('beats')
        .eq('id', sheetId)
        .single();
      if (!sheet) return;
      const existingBeats = sheet.beats || [];
      const editingD = allDeliverables.find(d => d.id === editingDeliverable);
      const sponsorName = editingD?.sponsor_name || '';
      const campaignName = editingD?.brand_name || '';
      let header = 'Ad Read';
      if (sponsorName) header += ' — ' + sponsorName + (campaignName ? ' (' + campaignName + ')' : '');
      const newBeatTitle = header + '\n\n' + deliverableNotes;
      const adReadIdx = editingDeliverable
        ? existingBeats.findIndex(b => b.deliverable_id === editingDeliverable)
        : -1;
      let updatedBeats;
      if (adReadIdx >= 0) {
        updatedBeats = existingBeats.map((b, i) => i === adReadIdx ? { ...b, title: newBeatTitle, deliverable_id: editingDeliverable } : b);
      } else {
        updatedBeats = [...existingBeats, {
          id: crypto.randomUUID(),
          title: newBeatTitle,
          context: '',
          graphics: [],
          videos: [],
          notes: '',
          deliverable_id: editingDeliverable,
        }];
      }
      await supabase.from('beat_sheets').update({
        beats: updatedBeats,
        updated_at: new Date().toISOString(),
      }).eq('id', sheetId);
      setBeatSheetChooserOpen(false);
      setPushAdCopyDone(true);
      setTimeout(() => setPushAdCopyDone(false), 2000);
    } catch (err) {
      console.error('Error pushing ad copy to beat sheet:', err);
    } finally {
      setPushingAdCopy(false);
    }
  }

  // Flush the ad-copy autosave immediately (used by the Ad Copy modal's
  // "Save & Close" so the write is guaranteed persisted before closing).
  async function saveAdCopyNow() {
    if (!editingDeliverable) return;
    if (adCopyTimerRef.current) clearTimeout(adCopyTimerRef.current);
    await supabase.from('sponsor_deliverables').update({
      ad_copy: deliverableNotes || null,
      updated_at: new Date().toISOString(),
    }).eq('id', editingDeliverable);
  }

  // Auto-save ad copy (debounced) when editing an existing deliverable
  const adCopyTimerRef = useRef(null);
  useEffect(() => {
    if (!editingDeliverable) return;
    if (adCopyTimerRef.current) clearTimeout(adCopyTimerRef.current);
    adCopyTimerRef.current = setTimeout(async () => {
      await supabase.from('sponsor_deliverables').update({
        ad_copy: deliverableNotes || null,
        updated_at: new Date().toISOString(),
      }).eq('id', editingDeliverable);
    }, 600);
    return () => { if (adCopyTimerRef.current) clearTimeout(adCopyTimerRef.current); };
  }, [deliverableNotes, editingDeliverable]);

  // Duplicate a deliverable
  async function handleDuplicateDeliverable(d) {
    setCardContextMenu(null);
    const { error } = await supabase.from('sponsor_deliverables').insert({
      title: d.title || '',
      deliverable_type: d.deliverable_type,
      due_date: d.due_date,
      ad_copy: d.ad_copy,
      platforms: d.platforms,
      needs_review: d.needs_review,
      campaign_id: d.campaign_id,
      sponsor_id: d.sponsor_id,
      pay: d.pay,
      channel: d.channel,
      delivered: false,
    });
    if (error) { toast.error('Error duplicating: ' + error.message); return; }
    fetchSponsors();
  }

  // Get video events not already attached to any deliverable (except current)
  function getAvailableVideoEvents(currentDeliverableId) {
    const usedIds = new Set(allDeliverables.filter(d => d.video_event_id && d.id !== currentDeliverableId).map(d => d.video_event_id));
    const today = new Date().toISOString().slice(0, 10);
    return videoEvents.filter(ev => !usedIds.has(ev.id) && ev.start_date && ev.start_date.slice(0, 10) >= today);
  }

  // --- Brand handlers ---
  function resetBrandForm() {
    setBrandForm({ brand: '', description: '', start_date: '', end_date: '', contact_name: '', contact_email: '', payment_status: 'unpaid' });
    setEditingBrand(null); setShowBrandForm(false);
  }

  function startEditBrand(brand) {
    setBrandForm({
      brand: brand.brand || brand.name || '',
      description: brand.description || '',
      start_date: brand.start_date || '',
      end_date: brand.end_date || '',
      contact_name: brand.contact_name || '',
      contact_email: brand.contact_email || '',
      payment_status: brand.payment_status || 'unpaid',
    });
    setEditingBrand(brand.id);
    setShowBrandForm(true);
  }

  async function handleSaveBrand(e) {
    e.preventDefault();
    const brandName = (brandForm.brand || '').trim();
    if (!brandName) { toast.error('Brand name is required'); return; }
    let sponsorId;
    const { data: existing } = await supabase
      .from('sponsors')
      .select('id')
      .ilike('name', brandName)
      .limit(1)
      .single();
    if (existing) {
      sponsorId = existing.id;
    } else {
      const { data: newSponsor, error: sErr } = await supabase
        .from('sponsors')
        .insert({ name: brandName, created_by: profile.id })
        .select()
        .single();
      if (sErr) { toast.error('Error creating brand: ' + sErr.message); return; }
      sponsorId = newSponsor.id;
    }
    const payload = {
      sponsor_id: sponsorId,
      name: brandName,
      description: brandForm.description || null,
      start_date: brandForm.start_date || null,
      end_date: brandForm.end_date || null,
      contact_name: brandForm.contact_name || null,
      contact_email: brandForm.contact_email || null,
      payment_status: brandForm.payment_status || 'unpaid',
      updated_at: new Date().toISOString(),
    };
    let brandId = editingBrand;
    if (editingBrand) {
      const { error } = await supabase.from('sponsor_campaigns').update(payload).eq('id', editingBrand);
      if (error) { toast.error('Error updating brand: ' + error.message); return; }
    } else {
      const { data, error } = await supabase.from('sponsor_campaigns').insert(payload).select().single();
      if (error) { toast.error('Error creating brand: ' + error.message); return; }
      brandId = data.id;
    }
    await syncBrandRevenue(brandId);

    resetBrandForm();
    fetchSponsors();
  }

  async function syncBrandRevenue(brandId) {
    if (!brandId) return;
    const revenueKey = `sponsor_campaign_${brandId}`;
    const { data: brand } = await supabase
      .from('sponsor_campaigns')
      .select('id, sponsor_id, payment_status, end_date')
      .eq('id', brandId)
      .single();
    if (!brand) {
      await supabase.from('revenue_events').delete().eq('stripe_event_id', revenueKey);
      return;
    }
    const { data: dels } = await supabase
      .from('sponsor_deliverables')
      .select('pay')
      .eq('campaign_id', brandId);
    const totalPay = (dels || []).reduce((sum, d) => sum + (parseFloat(d.pay) || 0), 0);
    if (brand.payment_status === 'paid' && totalPay > 0) {
      const amountCents = Math.round(totalPay * 100);
      await supabase.from('revenue_events').upsert({
        stripe_event_id: revenueKey,
        event_type: 'sponsorship',
        amount_cents: amountCents,
        net_amount_cents: amountCents,
        product_category: 'sponsorship',
        occurred_at: brand.end_date || new Date().toISOString(),
        platform_account_id: null,
        metadata: { source: 'sponsor_campaign', campaign_id: brandId, sponsor_id: brand.sponsor_id },
      }, { onConflict: 'stripe_event_id' });
    } else {
      await supabase.from('revenue_events').delete().eq('stripe_event_id', revenueKey);
    }
  }

  async function handleRemoveBrief(brief) {
    if (!(await confirm('Remove this brief?'))) return;
    if (brief.type === 'doc') {
      const pathMatch = brief.url.match(/campaign-briefs\/(.+)$/);
      if (pathMatch) {
        await supabase.storage.from('campaign-briefs').remove([decodeURIComponent(pathMatch[1])]);
      }
    }
    await supabase.from('campaign_briefs').delete().eq('id', brief.id);
    fetchSponsors();
  }

  function openBriefModal(brand) {
    setBriefModalBrand(brand);
    setBriefModalType('file');
    setBriefModalUrl('');
    setBriefModalLabel('');
    setBriefModalFile(null);
    setBriefModalText('');
    setBriefModalError('');
    setBriefModalEditingId(null);
    setBriefModalRegenerate(false);
  }

  function openBriefModalEdit(brand, brief) {
    setBriefModalBrand(brand);
    const t = brief.source_type || (brief.type === 'doc' ? 'file' : 'link');
    setBriefModalType(t);
    setBriefModalUrl(t === 'link' ? (brief.url || '') : '');
    setBriefModalLabel(brief.label || '');
    setBriefModalFile(null);
    setBriefModalText(t === 'text' ? (brief.source_text || '') : '');
    setBriefModalError('');
    setBriefModalEditingId(brief.id);
    setBriefModalRegenerate(false);
  }

  async function saveBriefModal() {
    if (!briefModalBrand) return;
    setBriefModalError('');
    setBriefModalSaving(true);
    const isEdit = !!briefModalEditingId;
    const nextPos = (briefModalBrand.campaign_briefs || []).length;
    try {
      if (briefModalType === 'link') {
        const url = briefModalUrl.trim();
        if (!url) { setBriefModalError('Enter a URL'); setBriefModalSaving(false); return; }
        let label = briefModalLabel.trim();
        if (!label) {
          try { label = new URL(url).hostname.replace(/^www\./, ''); } catch { label = 'Brief'; }
        }
        if (isEdit) {
          await supabase.from('campaign_briefs').update({
            type: 'link', source_type: 'link', label, url,
          }).eq('id', briefModalEditingId);
        } else {
          await supabase.from('campaign_briefs').insert({
            campaign_id: briefModalBrand.id,
            type: 'link', source_type: 'link', label, url, position: nextPos,
          });
        }
      } else if (briefModalType === 'file') {
        if (!isEdit && !briefModalFile) { setBriefModalError('Pick a PDF or DOCX file'); setBriefModalSaving(false); return; }
        let fileUrl = null;
        let originalLabel = briefModalLabel.trim();
        if (briefModalFile) {
          const filePath = `${briefModalBrand.id}/${Date.now()}_${briefModalFile.name}`;
          const { error: uploadError } = await supabase.storage.from('campaign-briefs').upload(filePath, briefModalFile);
          if (uploadError) { setBriefModalError('Upload failed: ' + uploadError.message); setBriefModalSaving(false); return; }
          const { data: urlData } = supabase.storage.from('campaign-briefs').getPublicUrl(filePath);
          fileUrl = urlData.publicUrl;
          if (!originalLabel) originalLabel = briefModalFile.name;
        }
        const label = originalLabel || 'Brief';
        const shouldRegen = !isEdit || briefModalFile || briefModalRegenerate;
        if (isEdit && !shouldRegen) {
          await supabase.from('campaign_briefs').update({ label }).eq('id', briefModalEditingId);
        } else {
          setBriefModalProcessing(true);
          let onepagerMd = null;
          const targetUrl = fileUrl || briefModalBrand.campaign_briefs?.find(b => b.id === briefModalEditingId)?.url;
          try {
            const { data: fnData, error: fnErr } = await supabase.functions.invoke('generate-brief-onepager', {
              body: { file_url: targetUrl },
            });
            if (fnErr) throw new Error(fnErr.message || 'Generation failed');
            onepagerMd = fnData?.onepager_md || null;
          } catch (err) {
            setBriefModalError('One-pager generation failed: ' + (err.message || err));
            setBriefModalProcessing(false);
            setBriefModalSaving(false);
            return;
          }
          setBriefModalProcessing(false);
          const payload = {
            type: 'doc', source_type: 'file', label,
            onepager_md: onepagerMd,
            generated_at: onepagerMd ? new Date().toISOString() : null,
          };
          if (fileUrl) payload.url = fileUrl;
          if (isEdit) {
            await supabase.from('campaign_briefs').update(payload).eq('id', briefModalEditingId);
          } else {
            await supabase.from('campaign_briefs').insert({
              campaign_id: briefModalBrand.id, ...payload, position: nextPos,
            });
          }
        }
      } else if (briefModalType === 'text') {
        const text = briefModalText.trim();
        if (!text) { setBriefModalError('Paste brief text'); setBriefModalSaving(false); return; }
        const label = briefModalLabel.trim() || 'Brief';
        const existing = isEdit ? (briefModalBrand.campaign_briefs || []).find(b => b.id === briefModalEditingId) : null;
        const textChanged = !isEdit || (existing && existing.source_text !== text);
        const shouldRegen = !isEdit || textChanged || briefModalRegenerate;
        if (isEdit && !shouldRegen) {
          await supabase.from('campaign_briefs').update({ label, source_text: text }).eq('id', briefModalEditingId);
        } else {
          setBriefModalProcessing(true);
          let onepagerMd = null;
          try {
            const { data: fnData, error: fnErr } = await supabase.functions.invoke('generate-brief-onepager', {
              body: { text },
            });
            if (fnErr) throw new Error(fnErr.message || 'Generation failed');
            onepagerMd = fnData?.onepager_md || null;
          } catch (err) {
            setBriefModalError('One-pager generation failed: ' + (err.message || err));
            setBriefModalProcessing(false);
            setBriefModalSaving(false);
            return;
          }
          setBriefModalProcessing(false);
          if (isEdit) {
            await supabase.from('campaign_briefs').update({
              label, source_text: text, type: 'doc', source_type: 'text',
              onepager_md: onepagerMd,
              generated_at: new Date().toISOString(),
            }).eq('id', briefModalEditingId);
          } else {
            const { data: inserted } = await supabase.from('campaign_briefs').insert({
              campaign_id: briefModalBrand.id,
              type: 'doc', source_type: 'text', source_text: text, label,
              onepager_md: onepagerMd,
              generated_at: new Date().toISOString(),
              position: nextPos,
            }).select('id').single();
            if (inserted?.id) {
              const briefUrl = `${window.location.origin}/brief/${inserted.id}`;
              await supabase.from('campaign_briefs').update({ url: briefUrl }).eq('id', inserted.id);
            }
          }
        }
      }
      fetchSponsors();
      setBriefModalBrand(null);
    } finally {
      setBriefModalSaving(false);
    }
  }

  async function handleDeleteBrand(brandId) {
    if (!(await confirm('Delete this brand and all its deliverables?'))) return;
    const brandDeliverables = allDeliverables.filter(d => d.campaign_id === brandId);
    for (const d of brandDeliverables) {
      if (d.calendar_event_id) {
        await supabase.from('calendar_events').delete().eq('id', d.calendar_event_id);
      }
    }
    await supabase.from('sponsor_deliverables').delete().eq('campaign_id', brandId);
    await supabase.from('sponsor_campaigns').delete().eq('id', brandId);
    fetchSponsors();
  }

  // --- Computed values ---
  const allBrandsFlat = sponsors.flatMap(s =>
    (s.sponsor_campaigns || []).map(c => ({
      ...c,
      brand: s.name,
      sponsor_id: s.id,
      deliverables: (s.sponsor_deliverables || []).filter(d => d.campaign_id === c.id),
    }))
  );
  const sortedBrands = [...allBrandsFlat].sort((a, b) => {
    const aActive = a.deliverables.length === 0 || a.deliverables.some(d => !d.delivered);
    const bActive = b.deliverables.length === 0 || b.deliverables.some(d => !d.delivered);
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    return new Date(b.created_at) - new Date(a.created_at);
  });
  const activeBrandsCount = allBrandsFlat.filter(c =>
    c.deliverables.length === 0 || c.deliverables.some(d => !d.delivered)
  ).length;
  const unbrandedDeliverables = sponsors.flatMap(s =>
    (s.sponsor_deliverables || []).filter(d => !d.campaign_id).map(d => ({ ...d, sponsor_name: s.name, sponsor_id: s.id }))
  );
  const pendingProposals = proposals.filter(p => p.status === 'pending');
  const resolvedProposals = proposals.filter(p => p.status !== 'pending' && p.status !== 'draft');


  function renderDeliverableRow(d, sponsor) {
    return (
      <div key={d.id} style={styles.deliverableRow}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, flexWrap: 'wrap' }}>
          {d.delivered && d.video_url ? (
            <a
              href={d.video_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                background: 'rgba(34,197,94,0.15)', color: '#86efac', textDecoration: 'none',
              }}
              title={d.video_url}
            >
              link
            </a>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); openVideoLinkModal(d); }}
              style={{
                padding: '3px 10px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                fontSize: '11px', fontWeight: 600, fontFamily: 'inherit', transition: 'all 0.15s',
                background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)',
              }}
            >
              Video
            </button>
          )}
          <span style={{ fontSize: '14px', flexShrink: 0 }}>{DELIVERABLE_TYPES[d.deliverable_type]?.icon || '\u{1F4CB}'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', color: d.delivered ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.85)', textDecoration: d.delivered ? 'line-through' : 'none' }}>
              {DELIVERABLE_TYPES[d.deliverable_type]?.label || d.deliverable_type}
            </div>
          </div>
          {d.channel && CHANNEL_COLORS[d.channel] && (
            <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 5px', borderRadius: '4px', background: CHANNEL_COLORS[d.channel].bg, color: CHANNEL_COLORS[d.channel].color }}>
              {CHANNEL_COLORS[d.channel].label}
            </span>
          )}
          {(d.platforms || []).map(p => (
            <span key={p} style={{ fontSize: '9px', fontWeight: 600, padding: '2px 5px', borderRadius: '4px', background: colors.accentA12, color: colors.accentFg }}>{p}</span>
          ))}
          {d.needs_review && (
            <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 5px', borderRadius: '4px', background: 'rgba(236,72,153,0.15)', color: '#f9a8d4', textTransform: 'uppercase', letterSpacing: '0.3px' }}>REVIEW</span>
          )}
          {d.due_date && (
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>
              {new Date(d.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
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
          <button onClick={() => startEditDeliverable(d)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: '12px', padding: '2px 4px' }} title="Edit">{'\u270E'}</button>
          <button onClick={() => handleDeleteDeliverable(d)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: '12px', padding: '2px 4px' }} title="Delete">{'\u2715'}</button>
        </div>
      </div>
    );
  }

  // Deliverable as a card (used in the brand stack). Turns green when delivered.
  function renderDeliverableCard(d) {
    const delivered = d.delivered;
    const ev = d.video_event_id ? videoEvents.find(e => e.id === d.video_event_id) : null;
    return (
      <div key={d.id} style={{ ...styles.delivCard, ...(delivered ? styles.delivCardDone : {}) }}>
        <div style={styles.delivCardTop}>
          <span style={{ fontSize: '15px', flexShrink: 0 }}>{DELIVERABLE_TYPES[d.deliverable_type]?.icon || '\u{1F4CB}'}</span>
          <span style={{ ...styles.delivCardTitle, ...(delivered ? { textDecoration: 'line-through', color: 'rgba(255,255,255,0.55)' } : {}) }}>{DELIVERABLE_TYPES[d.deliverable_type]?.label || d.deliverable_type}</span>
          <button onClick={(e) => { e.stopPropagation(); startEditDeliverable(d); }} style={styles.delivIconBtn} title="Edit">{'\u270e'}</button>
          <button onClick={(e) => { e.stopPropagation(); handleDeleteDeliverable(d); }} style={styles.delivIconBtn} title="Delete">{'\u2715'}</button>
        </div>
        <div style={styles.delivChips}>
          {d.channel && CHANNEL_COLORS[d.channel] && (
            <span style={{ ...styles.chip, background: CHANNEL_COLORS[d.channel].bg, color: CHANNEL_COLORS[d.channel].color }}>{CHANNEL_COLORS[d.channel].label}</span>
          )}
          {(d.platforms || []).map(p => (
            <span key={p} style={{ ...styles.chip, fontWeight: 600, background: colors.accentA12, color: colors.accentFg }}>{p}</span>
          ))}
          {d.needs_review && <span style={{ ...styles.chip, background: 'rgba(236,72,153,0.15)', color: '#f9a8d4' }}>REVIEW</span>}
          {ev && (
            <span style={{ ...styles.chip, fontWeight: 600, background: 'rgba(168,85,247,0.12)', color: '#c084fc' }}>
              {'\ud83d\udcf9'} {new Date(ev.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
          {d.due_date && (
            <span style={{ ...styles.chip, fontWeight: 600, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}>
              {new Date(d.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
            </span>
          )}
        </div>
        {delivered && d.video_url ? (
          <a
            href={d.video_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ ...styles.delivToggle, ...styles.delivToggleDone, textDecoration: 'none', display: 'block', textAlign: 'center' }}
            title={d.video_url}
          >
            {'\u2713'} link
          </a>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); openVideoLinkModal(d); }}
            style={{ ...styles.delivToggle, ...(delivered ? styles.delivToggleDone : {}) }}
          >
            {delivered ? '\u2713 Delivered' : 'Video'}
          </button>
        )}
      </div>
    );
  }

  // Single read-slot month card (Mayday / TM Baseball counts vs limits).
  function renderReadSlotCard(month) {
    const count = (ch) => allDeliverables.filter(d => d.channel === ch && d.due_date && d.due_date.slice(0, 7) === month).length;
    const limitOf = (ch) => { const r = slotLimits.find(s => s.month === month && s.channel === ch); return r ? r.slot_limit : null; };
    const unassigned = (ch) => allDeliverables.filter(d => d.channel === ch && d.due_date && d.due_date.slice(0, 7) === month && !d.delivered && !d.video_event_id).length;
    const maydayCount = count('mayday'), tmbCount = count('tmb');
    const maydayLimit = limitOf('mayday'), tmbLimit = limitOf('tmb');
    const maydayUnassigned = unassigned('mayday'), tmbUnassigned = unassigned('tmb');
    const isEditing = editingSlots === month;
    const monthLabel = (() => { const [y, mo] = month.split('-'); return new Date(+y, +mo - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); })();
    return (
      <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '10px', padding: '10px', width: '100%', height: '100%', boxSizing: 'border-box' }}>
        <div style={{ fontWeight: 600, fontSize: '12px', color: 'rgba(255,255,255,0.9)', marginBottom: '6px', textAlign: 'center' }}>{monthLabel}</div>
        {(() => {
          const chip = (n) => ({ fontSize: '9px', fontWeight: 600, padding: '2px 4px', borderRadius: '5px',
            ...(n > 0 ? { background: 'rgba(245,158,11,0.12)', color: '#f59e0b' } : { background: 'rgba(34,197,94,0.12)', color: '#22c55e' }) });
          return (
          <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
            <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
              <span style={chip(maydayUnassigned)}>{maydayUnassigned > 0 ? `${maydayUnassigned} open` : 'All set'}</span>
            </div>
            <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
              <span style={chip(tmbUnassigned)}>{tmbUnassigned > 0 ? `${tmbUnassigned} open` : 'All set'}</span>
            </div>
          </div>
          );
        })()}
        <div style={{ display: 'flex', gap: '6px' }}>
          <div style={{ flex: 1, minWidth: 0, background: colors.accentA08, border: '1px solid rgba(91, 143, 199,0.15)', borderRadius: '6px', padding: '7px 4px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, color: colors.accentFg, marginBottom: '3px' }}>Mayday</div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }}>
              {maydayCount}{maydayLimit != null ? <span style={{ color: 'rgba(255,255,255,0.35)' }}>/{maydayLimit}</span> : null}
            </div>
            {maydayLimit != null && (
              <div style={{ marginTop: '6px', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: '2px', background: maydayCount >= maydayLimit ? '#22c55e' : '#5b8fc7', width: `${Math.min(100, maydayLimit > 0 ? (maydayCount / maydayLimit) * 100 : 0)}%`, transition: 'width 0.3s' }} />
              </div>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: '6px', padding: '7px 4px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, color: '#fca5a5', marginBottom: '3px' }}>TMB</div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }}>
              {tmbCount}{tmbLimit != null ? <span style={{ color: 'rgba(255,255,255,0.35)' }}>/{tmbLimit}</span> : null}
            </div>
            {tmbLimit != null && (
              <div style={{ marginTop: '6px', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: '2px', background: tmbCount >= tmbLimit ? '#22c55e' : '#ef4444', width: `${Math.min(100, tmbLimit > 0 ? (tmbCount / tmbLimit) * 100 : 0)}%`, transition: 'width 0.3s' }} />
              </div>
            )}
          </div>
        </div>
        {isAdmin && (
          isEditing ? (
            <div style={{ marginTop: '10px', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="number" value={slotDraft.mayday} onChange={e => setSlotDraft(d => ({ ...d, mayday: e.target.value }))} placeholder="Mayday" min="0" style={{ flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '6px 8px', color: '#fff', fontSize: '12px' }} />
              <input type="number" value={slotDraft.tmb} onChange={e => setSlotDraft(d => ({ ...d, tmb: e.target.value }))} placeholder="TMB" min="0" style={{ flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '6px 8px', color: '#fff', fontSize: '12px' }} />
              <button onClick={() => handleSaveSlotLimits(month)} style={{ background: colors.accent, color: colors.white, border: 'none', borderRadius: '5px', padding: '5px 10px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Save</button>
              <button onClick={() => setEditingSlots(null)} style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', border: 'none', borderRadius: '5px', padding: '5px 8px', fontSize: '12px', cursor: 'pointer' }}>{'✕'}</button>
            </div>
          ) : (
            <button
              onClick={() => { setEditingSlots(month); setSlotDraft({ mayday: maydayLimit != null ? String(maydayLimit) : '', tmb: tmbLimit != null ? String(tmbLimit) : '' }); }}
              style={{ marginTop: '10px', background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: '11px', cursor: 'pointer', padding: '2px 0' }}
            >
              Set Limits
            </button>
          )
        )}
      </div>
    );
  }

  // --- Sorting handler ---
  function handleSort(col) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }

  // --- Computed table data ---
  const tableDeliverables = (() => {
    let list = showDelivered ? [...allDeliverables] : allDeliverables.filter(d => !d.delivered);
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case 'due': cmp = (a.due_date || '').localeCompare(b.due_date || ''); break;
        case 'sponsor': {
          const sA = `${a.sponsor_name || ''} ${a.brand_name || ''}`;
          const sB = `${b.sponsor_name || ''} ${b.brand_name || ''}`;
          cmp = sA.localeCompare(sB); break;
        }
        case 'type': cmp = (a.deliverable_type || '').localeCompare(b.deliverable_type || ''); break;
        case 'channel': cmp = (a.channel || '').localeCompare(b.channel || ''); break;
        case 'schedule': {
          const evA = a.video_event_id ? videoEvents.find(e => e.id === a.video_event_id) : null;
          const evB = b.video_event_id ? videoEvents.find(e => e.id === b.video_event_id) : null;
          const dA = evA?.start_date || '';
          const dB = evB?.start_date || '';
          if (!dA && !dB) cmp = 0;
          else if (!dA) cmp = 1;
          else if (!dB) cmp = -1;
          else cmp = dA.localeCompare(dB);
          break;
        }
        case 'pay': cmp = (parseFloat(a.pay) || 0) - (parseFloat(b.pay) || 0); break;
        default: break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  })();

  // --- Sortable deliverable table ---
  function renderDeliverableTable() {
    const sortArrow = (col) => sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    const thStyle = { ...styles.tableTh, cursor: 'pointer', userSelect: 'none' };
    const totalPay = tableDeliverables.reduce((sum, d) => sum + (parseFloat(d.pay) || 0), 0);
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <h1 style={styles.pageTitle}>Upcoming Deliverables</h1>
            <p style={styles.pageSubtitle}>
              {tableDeliverables.length} deliverable{tableDeliverables.length !== 1 ? 's' : ''}
              {totalPay > 0 ? ` · $${totalPay.toLocaleString()} total` : ''}
            </p>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
            <input
              type="checkbox"
              checked={showDelivered}
              onChange={e => setShowDelivered(e.target.checked)}
              style={{ accentColor: '#5b8fc7' }}
            />
            Show Delivered
          </label>
        </div>

        {/* Read Slots */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
          {[0, 1, 2].map(off => {
            const dt = new Date();
            dt.setDate(1);
            dt.setMonth(dt.getMonth() + off);
            const m = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
            return <div key={m} style={{ display: 'flex' }}>{renderReadSlotCard(m)}</div>;
          })}
        </div>
        <div style={styles.columnDivider} />

        {tableDeliverables.length === 0 ? (
          <div style={styles.emptyCard}>
            <p style={styles.emptyText}>No upcoming deliverables. Add deliverables to brands below.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={thStyle} onClick={() => handleSort('due')}>Due{sortArrow('due')}</th>
                  <th style={thStyle} onClick={() => handleSort('sponsor')}>Sponsor{sortArrow('sponsor')}</th>
                  <th style={styles.tableTh}>Brief</th>
                  <th style={thStyle} onClick={() => handleSort('channel')}>Channel{sortArrow('channel')}</th>
                  <th style={styles.tableTh}>Status</th>
                  <th style={styles.tableTh}>Review Due</th>
                  <th style={thStyle} onClick={() => handleSort('schedule')}>Schedule{sortArrow('schedule')}</th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => handleSort('pay')}>Pay{sortArrow('pay')}</th>
                  <th style={styles.tableTh}>Delivered</th>
                </tr>
              </thead>
              <tbody>
                {tableDeliverables.map(d => {
                  const ev = d.video_event_id ? videoEvents.find(e => e.id === d.video_event_id) : null;
                  return (
                    <tr
                      key={d.id}
                      style={{ ...(d.delivered ? { opacity: 0.5 } : {}) }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setCardContextMenu({ x: e.clientX, y: e.clientY, deliverable: d });
                      }}
                    >
                      {/* Due */}
                      <td style={styles.tableTd}>
                        <span style={{ fontWeight: 600, color: 'rgba(255,255,255,0.7)', fontSize: '13px' }}>
                          {d.due_date ? new Date(d.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}
                        </span>
                      </td>
                      {/* Sponsor */}
                      <td style={styles.tableTd}>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditDeliverable(d);
                          }}
                          style={{
                            fontSize: '12px',
                            color: 'rgba(255,255,255,0.6)',
                            cursor: 'pointer',
                            textDecoration: 'underline dotted rgba(255,255,255,0.2)',
                            textUnderlineOffset: 3,
                          }}
                          title="Edit deliverable"
                        >
                          {d.sponsor_name}{d.brand_name && d.brand_name !== d.sponsor_name ? ` / ${d.brand_name}` : ''}
                        </span>
                      </td>
                      {/* Brief — only processed one-pagers */}
                      <td style={styles.tableTd}>
                        {(() => {
                          const processed = (d.campaign_briefs || []).filter(b => b.onepager_md);
                          if (processed.length === 0) {
                            return <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>—</span>;
                          }
                          return (
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                              {processed.map(brief => (
                                <a
                                  key={brief.id}
                                  href={`/brief/${brief.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  style={{
                                    color: colors.accentFg, textDecoration: 'underline',
                                    fontSize: '12px', maxWidth: 240, display: 'inline-block',
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    verticalAlign: 'middle',
                                  }}
                                  title={brief.label}
                                >
                                  {brief.label || 'Open brief'}
                                </a>
                              ))}
                            </div>
                          );
                        })()}
                      </td>
                      {/* Channel */}
                      <td style={styles.tableTd}>
                        {d.channel && CHANNEL_COLORS[d.channel] && (
                          <span style={{ ...styles.chip, background: CHANNEL_COLORS[d.channel].bg, color: CHANNEL_COLORS[d.channel].color }}>
                            {CHANNEL_COLORS[d.channel].label}
                          </span>
                        )}
                      </td>
                      {/* Status */}
                      <td style={{ ...styles.tableTd, position: 'relative' }}>
                        {(() => {
                          const r = REVIEW_STATUS_BY_VALUE[d.review_status] || REVIEW_STATUS_BY_VALUE.queued;
                          const isOpen = reviewDropdownId === d.id;
                          return (
                            <>
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => { e.stopPropagation(); if (!isOpen) openInlineDropdownAt(e.currentTarget); setReviewDropdownId(isOpen ? null : d.id); }}
                                style={{ ...styles.chip, fontWeight: 600, background: r.bg, color: r.color, cursor: 'pointer' }}
                              >
                                {r.label}
                              </span>
                              {isOpen && (
                                <div data-inline-dropdown style={{ ...styles.inlineDropdown, position: 'fixed', top: inlineDropdownPos.top, left: inlineDropdownPos.left, marginTop: 0 }}>
                                  {REVIEW_STATUS_OPTIONS.map(o => (
                                    <button
                                      key={o.value}
                                      style={{
                                        ...styles.inlineDropdownItem,
                                        color: o.color,
                                        fontWeight: d.review_status === o.value ? 700 : 500,
                                      }}
                                      onClick={(e) => { e.stopPropagation(); handleInlineSetReviewStatus(d.id, o.value); }}
                                    >
                                      {o.label}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </td>
                      {/* Review Due */}
                      <td style={styles.tableTd}>
                        {reviewDueEditId === d.id ? (
                          <input
                            type="date"
                            autoFocus
                            defaultValue={d.review_due || ''}
                            onChange={(e) => handleSaveReviewDue(d.id, e.target.value)}
                            onBlur={() => setReviewDueEditId(null)}
                            onKeyDown={(e) => { if (e.key === 'Escape') setReviewDueEditId(null); }}
                            style={{
                              background: colors.blackA30, border: '1px solid rgba(91, 143, 199,0.5)',
                              borderRadius: '6px', color: '#fff', fontSize: '11px', padding: '2px 6px',
                              fontFamily: 'inherit', outline: 'none', colorScheme: 'dark',
                            }}
                          />
                        ) : (() => {
                          const now = new Date();
                          const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                          const pendingReview = ['queued', 'writing', 'filming'].includes(d.review_status || 'queued');
                          const overdue = d.review_due && pendingReview && d.review_due < todayKey;
                          return (
                            <span
                              style={{
                                ...styles.chip,
                                fontWeight: 600,
                                cursor: 'pointer',
                                background: overdue ? 'rgba(239,68,68,0.12)' : 'rgba(56,189,248,0.1)',
                                color: overdue ? '#fca5a5' : d.review_due ? '#38bdf8' : 'rgba(255,255,255,0.35)',
                                ...(d.review_due ? {} : { background: 'rgba(255,255,255,0.05)' }),
                              }}
                              onClick={(e) => { e.stopPropagation(); setReviewDueEditId(d.id); }}
                              title="Date the ad must be submitted for review by"
                            >
                              {d.review_due
                                ? new Date(d.review_due + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                : 'Set date'}
                            </span>
                          );
                        })()}
                      </td>
                      {/* Schedule */}
                      <td style={styles.tableTd}>
                        {ev ? (
                          <span
                            style={{ ...styles.chip, fontWeight: 600, background: 'rgba(168,85,247,0.12)', color: '#c084fc', cursor: 'pointer' }}
                            onClick={() => { setScheduleModalDeliverable(d); setScheduleModalDate(new Date(ev.start_date)); }}
                          >
                            📹 {new Date(ev.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        ) : (
                          <span
                            style={{ ...styles.chip, fontWeight: 600, background: 'rgba(245,158,11,0.12)', color: '#fbbf24', cursor: 'pointer' }}
                            onClick={() => { setScheduleModalDeliverable(d); setScheduleModalDate(new Date()); }}
                          >
                            Not Scheduled
                          </span>
                        )}
                      </td>
                      {/* Pay */}
                      <td style={{ ...styles.tableTd, textAlign: 'right' }}>
                        {d.pay != null && parseFloat(d.pay) > 0 && (
                          <span style={{ fontWeight: 700, color: '#22c55e', fontSize: '13px' }}>
                            ${parseFloat(d.pay).toLocaleString()}
                          </span>
                        )}
                      </td>
                      {/* Video */}
                      <td style={styles.tableTd}>
                        {d.delivered && d.video_url ? (
                          <a
                            href={d.video_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            style={{ ...styles.delivToggle, ...styles.delivToggleDone, padding: '3px 10px', fontSize: '11px', textDecoration: 'none' }}
                            title={d.video_url}
                          >
                            link
                          </a>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); openVideoLinkModal(d); }}
                            style={{ ...styles.delivToggle, padding: '3px 10px', fontSize: '11px' }}
                          >
                            Video
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // --- Schedule calendar modal ---
  function renderScheduleCalendarModal() {
    if (!scheduleModalDeliverable) return null;
    const d = scheduleModalDeliverable;
    const year = scheduleModalDate.getFullYear();
    const month = scheduleModalDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthLabel = scheduleModalDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    // Filter to video_post events in this month
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    const monthEvents = videoEvents.filter(ev => (ev.event_type === 'video_post' || ev.event_type === 'tmbb_video') && ev.start_date && ptMonthKey(ev.start_date) === monthStr);

    // Which events are linked to other deliverables
    const linkedMap = {};
    allDeliverables.forEach(del => {
      if (del.video_event_id) linkedMap[del.video_event_id] = del;
    });

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(<div key={`blank-${i}`} style={styles.calendarDayBlank} />);
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayEvents = monthEvents.filter(ev => ptDayKey(ev.start_date) === dateStr);
      const isToday = dateStr === todayStr;
      cells.push(
        <div key={day} style={{ ...styles.calendarDay, ...(isToday ? { border: '1px solid rgba(91, 143, 199,0.5)' } : {}) }}>
          <div style={{ fontSize: '11px', fontWeight: isToday ? 700 : 500, color: isToday ? '#8fb4d8' : 'rgba(255,255,255,0.4)', marginBottom: '4px' }}>{day}</div>
          {dayEvents.map(ev => {
            const isLinkedToCurrent = d.video_event_id === ev.id;
            const linkedTo = linkedMap[ev.id];
            const isLinkedToOther = linkedTo && linkedTo.id !== d.id;
            const isHovered = scheduleModalHoveredEvent === ev.id;
            return (
              <div
                key={ev.id}
                style={{
                  fontSize: '11px', fontWeight: 600, padding: '3px 6px', borderRadius: '5px',
                  marginBottom: '3px', cursor: isLinkedToOther ? 'default' : 'pointer',
                  background: isLinkedToCurrent ? 'rgba(34,197,94,0.2)' : isLinkedToOther ? 'rgba(255,255,255,0.04)' : 'rgba(168,85,247,0.15)',
                  color: isLinkedToCurrent ? '#22c55e' : isLinkedToOther ? 'rgba(255,255,255,0.3)' : '#c084fc',
                  border: isLinkedToCurrent ? '1px solid rgba(34,197,94,0.3)' : isLinkedToOther ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(168,85,247,0.25)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  position: 'relative',
                  transition: 'background 0.15s',
                }}
                onClick={() => { if (!isLinkedToOther) handleInlineAssignVideo(d.id, ev.id); }}
                onMouseEnter={() => setScheduleModalHoveredEvent(ev.id)}
                onMouseLeave={() => setScheduleModalHoveredEvent(null)}
                title={ev.title}
              >
                {isLinkedToOther && '🤝 '}{isLinkedToCurrent && '✓ '}{ev.title}
                {isHovered && (
                  <div style={styles.calendarTooltip}>
                    <div style={{ fontWeight: 700, marginBottom: '4px' }}>{ev.title}</div>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>
                      {new Date(ev.start_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </div>
                    {ev.description && <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '4px' }}>{ev.description}</div>}
                    {isLinkedToOther && <div style={{ fontSize: '11px', color: '#f59e0b', marginTop: '6px', fontWeight: 600 }}>Linked to: {linkedTo.title}</div>}
                    {isLinkedToCurrent && <div style={{ fontSize: '11px', color: '#22c55e', marginTop: '6px', fontWeight: 600 }}>Linked to this deliverable</div>}
                    {!isLinkedToOther && !isLinkedToCurrent && <div style={{ fontSize: '11px', color: '#c084fc', marginTop: '6px', fontWeight: 600 }}>Click to link</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    }

    const currentLinkedEvent = d.video_event_id ? videoEvents.find(e => e.id === d.video_event_id) : null;

    // Legend items
    const legend = [
      { color: '#c084fc', bg: 'rgba(168,85,247,0.15)', border: 'rgba(168,85,247,0.25)', label: 'Available' },
      { color: '#22c55e', bg: 'rgba(34,197,94,0.2)', border: 'rgba(34,197,94,0.3)', label: 'Linked to this' },
      { color: 'rgba(255,255,255,0.3)', bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.06)', label: 'Taken' },
    ];

    return (
      <div style={styles.modalOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) setScheduleModalDeliverable(null); }}>
        <div style={{ ...styles.modalBox, maxWidth: 1060, padding: '28px 32px' }}>
          <div style={styles.modalHeader}>
            <div>
              <h3 style={styles.modalTitle}>{d.sponsor_name}{d.brand_name && d.brand_name !== d.sponsor_name ? ` — ${d.brand_name}` : ''}</h3>
              <p style={styles.modalSubtitle}>{DELIVERABLE_TYPES[d.deliverable_type]?.label || d.deliverable_type} — Select a video post to link</p>
            </div>
            <button onClick={() => setScheduleModalDeliverable(null)} style={styles.modalClose} aria-label="Close">✕</button>
          </div>

          {/* Month navigation */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '20px', marginBottom: '16px' }}>
            <button
              onClick={() => setScheduleModalDate(new Date(year, month - 1, 1))}
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: '14px', padding: '4px 10px', lineHeight: 1 }}
            >◀</button>
            <span style={{ fontWeight: 700, color: '#fff', fontSize: '15px', minWidth: '160px', textAlign: 'center' }}>{monthLabel}</span>
            <button
              onClick={() => setScheduleModalDate(new Date(year, month + 1, 1))}
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: '14px', padding: '4px 10px', lineHeight: 1 }}
            >▶</button>
          </div>

          {/* Day-of-week headers */}
          <div style={styles.calendarGrid}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(dayName => (
              <div key={dayName} style={{ textAlign: 'center', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.35)', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>{dayName}</div>
            ))}
            {cells}
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: '16px', marginTop: '14px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            {legend.map(l => (
              <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: l.bg, border: `1px solid ${l.border}` }} />
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>{l.label}</span>
              </div>
            ))}
          </div>

          {/* Unlink button */}
          {currentLinkedEvent && (
            <div style={{ marginTop: '12px', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.15)', borderRadius: '8px', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>
                Currently linked: <span style={{ color: '#22c55e', fontWeight: 600 }}>📹 {new Date(currentLinkedEvent.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — {currentLinkedEvent.title}</span>
              </span>
              <button
                onClick={() => handleInlineAssignVideo(d.id, null)}
                style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '6px', padding: '5px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
              >
                Unlink
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* Page header — Proposals drawer trigger */}
      <div style={styles.pageHeaderBar}>
        <button onClick={() => setProposalsDrawerOpen(true)} style={styles.proposalsBtn}>
          {'▤'} Proposals
          {pendingProposals.length > 0 && <span style={styles.proposalsBtnBadge}>{pendingProposals.length}</span>}
        </button>
      </div>

      {/* ── Proposals drawer (slides in from the right) ── */}
          {proposalsDrawerOpen && (
            <div style={styles.drawerOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) setProposalsDrawerOpen(false); }}>
              <div style={styles.drawerPanel}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>
                  <button onClick={() => setProposalsDrawerOpen(false)} style={styles.drawerClose}>{'✕'}</button>
                </div>
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
              onClick={() => { if (showProposalForm && !editingProposal) { resetProposalForm(); } else { resetProposalForm(); setShowProposalForm(true); } }}
              style={{ background: colors.accent, color: colors.white, border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}
            >
              {showProposalForm && !editingProposal ? 'Cancel' : '+ New Proposal'}
            </button>
          </div>

          {/* Proposal form (create or edit) */}
          {showProposalForm && (
            <Modal title={editingProposal ? 'Edit Proposal' : 'New Proposal'} onClose={cancelProposalForm} maxWidth={620}>
            <form onSubmit={editingProposal ? handleUpdateProposal : handleCreateProposal} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <input
                value={proposalForm.sponsor_name}
                onChange={e => setProposalForm(f => ({ ...f, sponsor_name: e.target.value }))}
                placeholder="Brand name *"
                required
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '13px' }}
              />

              <textarea
                value={proposalForm.description}
                onChange={e => setProposalForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Description / notes (optional)"
                rows={2}
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '13px', resize: 'vertical' }}
              />

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase' }}>Deliverables</div>
                {proposalItems.map((item, idx) => item.accepted ? (
                  // Collapsed summary card
                  <div key={item.id || idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '8px', padding: '8px 10px' }}>
                    <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>#{idx + 1}</span>
                    <span style={{ fontSize: '14px' }}>{DELIVERABLE_TYPES[item.deliverable_type]?.icon || '\u{1F4CB}'}</span>
                    <span style={{ flex: 1, color: '#fff', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                    {item.channel && CHANNEL_COLORS[item.channel] && (
                      <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 5px', borderRadius: '4px', background: CHANNEL_COLORS[item.channel].bg, color: CHANNEL_COLORS[item.channel].color }}>
                        {CHANNEL_COLORS[item.channel].label}
                      </span>
                    )}
                    {item.due_month && (
                      <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap' }}>{formatMonthLabel(item.due_month)}</span>
                    )}
                    {item.pay !== '' && item.pay != null && (
                      <span style={{ fontSize: '12px', color: '#22c55e', fontWeight: 600 }}>${Number(item.pay).toLocaleString()}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => editItem(idx)}
                      style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '12px', padding: '2px 6px' }}
                      title="Edit"
                    >{'✎'}</button>
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '14px', padding: '2px 6px' }}
                      title="Remove"
                    >{'✕'}</button>
                  </div>
                ) : (
                  // Editable card
                  <div key={item.id || idx} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '8px 10px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>#{idx + 1}</span>
                    <input
                      value={item.title}
                      onChange={e => updateItem(idx, { title: e.target.value })}
                      placeholder="Title"
                      style={{ flex: '1 1 120px', minWidth: '100px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '5px', padding: '6px 8px', color: '#fff', fontSize: '12px' }}
                    />
                    <select
                      value={item.deliverable_type}
                      onChange={e => updateItem(idx, { deliverable_type: e.target.value })}
                      style={{ flex: '0 0 auto', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '5px', padding: '6px 8px', color: '#fff', fontSize: '12px' }}
                    >
                      {Object.entries(DELIVERABLE_TYPES).map(([k, v]) => (
                        <option key={k} value={k}>{v.label}</option>
                      ))}
                    </select>
                    <select
                      value={item.channel}
                      onChange={e => updateItem(idx, { channel: e.target.value })}
                      style={{ flex: '0 0 auto', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '5px', padding: '6px 8px', color: '#fff', fontSize: '12px' }}
                    >
                      <option value="">{'— Channel —'}</option>
                      {Object.entries(CHANNEL_COLORS).map(([k, v]) => (
                        <option key={k} value={k}>{v.label}</option>
                      ))}
                    </select>
                    <input
                      type="month"
                      value={item.due_month}
                      onChange={e => updateItem(idx, { due_month: e.target.value })}
                      style={{ flex: '0 0 auto', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '5px', padding: '6px 8px', color: '#fff', fontSize: '12px' }}
                    />
                    <input
                      type="number"
                      value={item.pay}
                      onChange={e => updateItem(idx, { pay: e.target.value })}
                      placeholder="Pay ($)"
                      min="0"
                      step="any"
                      style={{ flex: '0 0 80px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '5px', padding: '6px 8px', color: '#fff', fontSize: '12px' }}
                    />
                    <button
                      type="button"
                      onClick={() => acceptItem(idx)}
                      style={{ flex: '0 0 auto', background: '#22c55e', color: '#fff', border: 'none', borderRadius: '5px', padding: '6px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >{'✓'}</button>
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      style={{ flex: '0 0 auto', background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '14px', padding: '2px 4px' }}
                      title="Remove"
                    >{'✕'}</button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addItem}
                  style={{ alignSelf: 'flex-start', background: colors.accentA15, color: colors.accentFg, border: '1px dashed rgba(91, 143, 199,0.4)', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                >
                  + Deliverable
                </button>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="submit" style={{ background: colors.accent, color: colors.white, border: 'none', borderRadius: '6px', padding: '8px 14px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                  {editingProposal ? 'Save Proposal' : 'Create Proposal'}
                </button>
                <button type="button" onClick={cancelProposalForm} style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', border: 'none', borderRadius: '6px', padding: '8px 14px', fontSize: '13px', cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </form>
            </Modal>
          )}

          {/* Pending proposals */}
          {proposalsLoading && pendingProposals.length === 0 ? (
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px' }}>Loading...</p>
          ) : pendingProposals.length === 0 ? null : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '8px' }}>
              {pendingProposals.map(p => {
                const items = p.items || [];
                const totalPay = items.reduce((sum, it) => sum + (Number(it.pay) || 0), 0);
                const timeframe = formatTimeframeFromItems(items);
                return (
                  <div key={p.id} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '14px', borderLeft: '3px solid #f59e0b' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <div style={{ fontWeight: 600, fontSize: '14px', color: '#fff' }}>{p.sponsor_name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {timeframe && <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', padding: '2px 8px' }}>{timeframe}</span>}
                        <button onClick={() => startEditProposal(p)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: '12px', padding: '2px 4px' }} title="Edit">{'✎'}</button>
                        <button onClick={() => handleDeleteProposal(p.id)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: '12px', padding: '2px 4px' }} title="Delete">{'✕'}</button>
                      </div>
                    </div>
                    {items.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '10px' }}>
                        {items.map((it) => (
                          <div key={it.id || it.position} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', padding: '6px 10px', fontSize: '12px' }}>
                            <span style={{ fontSize: '14px' }}>{DELIVERABLE_TYPES[it.deliverable_type]?.icon || '\u{1F4CB}'}</span>
                            <span style={{ flex: 1, color: 'rgba(255,255,255,0.85)' }}>{it.title}</span>
                            {it.channel && CHANNEL_COLORS[it.channel] && (
                              <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 5px', borderRadius: '4px', background: CHANNEL_COLORS[it.channel].bg, color: CHANNEL_COLORS[it.channel].color }}>
                                {CHANNEL_COLORS[it.channel].label}
                              </span>
                            )}
                            {it.due_month && (
                              <span style={{ color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>{formatMonthLabel(it.due_month)}</span>
                            )}
                            {it.pay != null && it.pay !== '' && (
                              <span style={{ color: '#22c55e', fontWeight: 600 }}>${Number(it.pay).toLocaleString()}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {totalPay > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '8px', marginBottom: '8px' }}>
                        <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>Total</span>
                        <span style={{ fontSize: '14px', color: '#22c55e', fontWeight: 700 }}>${totalPay.toLocaleString()}</span>
                      </div>
                    )}
                    {p.description && <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px', whiteSpace: 'pre-wrap' }}>{p.description}</div>}
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginBottom: '10px' }}>
                      Proposed by {p.creator?.full_name || 'Unknown'} · {new Date(p.created_at).toLocaleDateString()}
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={() => handleConfirmProposal(p)} style={{ background: '#22c55e', color: '#fff', border: 'none', borderRadius: '5px', padding: '5px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Confirm</button>
                      <button onClick={() => handleDeclineProposal(p.id)} style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: '5px', padding: '5px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Decline</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Resolved proposals */}
          {resolvedProposals.length > 0 && (
            <details style={{ marginTop: '4px' }}>
              <summary style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', cursor: 'pointer', userSelect: 'none' }}>
                {resolvedProposals.length} resolved proposal{resolvedProposals.length !== 1 ? 's' : ''}
              </summary>
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {resolvedProposals.map(p => {
                  const rTotal = (p.items || []).reduce((sum, it) => sum + (Number(it.pay) || 0), 0);
                  return (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'rgba(255,255,255,0.5)', padding: '4px 0' }}>
                      <span style={{ background: p.status === 'accepted' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: p.status === 'accepted' ? '#22c55e' : '#ef4444', borderRadius: '4px', padding: '1px 6px', fontSize: '11px', fontWeight: 600 }}>{p.status}</span>
                      <span style={{ color: 'rgba(255,255,255,0.7)' }}>{p.sponsor_name}</span>
                      {rTotal > 0 && <span style={{ color: 'rgba(255,255,255,0.4)' }}>${rTotal.toLocaleString()}</span>}
                      <span style={{ color: 'rgba(255,255,255,0.3)' }}>{new Date(p.created_at).toLocaleDateString()}</span>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
              </div>
            </div>
          )}

      {/* ── Upcoming Deliverables Table ── */}
      {renderDeliverableTable()}

      {/* Bold divider: Upcoming Deliverables ends, Brands begins */}
      <div style={styles.sectionDivider} />

      <div style={styles.topBar}>
        <div>
          <h1 style={styles.pageTitle}>Brands</h1>
          <p style={styles.pageSubtitle}>
            {activeBrandsCount} active · {sortedBrands.length - activeBrandsCount} inactive
          </p>
        </div>
        <button onClick={() => { resetBrandForm(); setShowBrandForm(!showBrandForm); }} style={styles.addBtn}>
          {showBrandForm && !editingBrand ? '\u2715 Cancel' : '+ New Brand'}
        </button>
      </div>

      {/* Brand Form (modal) */}
      {showBrandForm && (
        <Modal title={editingBrand ? 'Edit Brand' : 'New Brand'} onClose={() => { resetBrandForm(); setShowBrandForm(false); }} maxWidth={680}>
        <form onSubmit={handleSaveBrand}>
          <div style={styles.formGrid}>
            <div style={styles.field}>
              <label style={styles.label}>Brand *</label>
              <input
                value={brandForm.brand}
                onChange={e => setBrandForm({ ...brandForm, brand: e.target.value })}
                placeholder="e.g. NordVPN"
                required
                list="brand-suggestions"
                style={styles.input}
              />
              <datalist id="brand-suggestions">
                {sponsors.map(s => <option key={s.id} value={s.name} />)}
              </datalist>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Start Date</label>
              <input type="date" value={brandForm.start_date} onChange={e => setBrandForm({ ...brandForm, start_date: e.target.value })} style={styles.input} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>End Date</label>
              <input type="date" value={brandForm.end_date} onChange={e => setBrandForm({ ...brandForm, end_date: e.target.value })} style={styles.input} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Contact Name</label>
              <input value={brandForm.contact_name} onChange={e => setBrandForm({ ...brandForm, contact_name: e.target.value })} placeholder="e.g. John Smith" style={styles.input} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Contact Email</label>
              <input value={brandForm.contact_email} onChange={e => setBrandForm({ ...brandForm, contact_email: e.target.value })} placeholder="john@sponsor.com" type="email" style={styles.input} />
            </div>
            {isAdmin && (
              <div style={styles.field}>
                <label style={styles.label}>Payment Status</label>
                <select value={brandForm.payment_status} onChange={e => setBrandForm({ ...brandForm, payment_status: e.target.value })} style={styles.select}>
                  <option value="unpaid">Unpaid</option>
                  <option value="partial">Partial</option>
                  <option value="paid">Paid</option>
                </select>
              </div>
            )}
            {editingBrand && (() => {
              const c = sponsors.flatMap(s => s.sponsor_campaigns || []).find(x => x.id === editingBrand);
              const briefs = (c?.campaign_briefs || []).slice().sort((a, b) => a.position - b.position);
              return (
                <div style={styles.field}>
                  <label style={styles.label}>Briefs</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                    {briefs.map(b => {
                      const href = b.onepager_md ? `/brief/${b.id}` : b.url;
                      return (
                        <span key={b.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 10px', borderRadius: '6px', background: b.onepager_md ? 'rgba(16,185,129,0.12)' : 'rgba(91, 143, 199,0.12)', border: `1px solid ${b.onepager_md ? 'rgba(16,185,129,0.3)' : 'rgba(91, 143, 199,0.3)'}`, color: b.onepager_md ? '#6ee7b7' : '#8fb4d8', fontSize: '11px', fontWeight: 600, maxWidth: '260px' }}>
                          <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.label || b.url}>
                            {b.onepager_md ? '✓' : '🔗'} {b.label || 'Brief'}
                          </a>
                          <button type="button" onClick={() => openBriefModalEdit(c, b)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', fontSize: '11px', padding: 0, lineHeight: 1 }} title="Edit">✎</button>
                          <button type="button" onClick={() => handleRemoveBrief(b)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '12px', padding: 0, lineHeight: 1 }} title="Remove">✕</button>
                        </span>
                      );
                    })}
                    {briefs.length === 0 && (
                      <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', alignSelf: 'center' }}>No briefs yet.</span>
                    )}
                  </div>
                  <button type="button" onClick={() => openBriefModal(c)} style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px dashed rgba(91, 143, 199,0.4)', background: colors.accentA06, color: colors.accentFg, fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
                    + Add Brief (upload PDF or paste text)
                  </button>
                </div>
              );
            })()}
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Description</label>
            <textarea value={brandForm.description} onChange={e => setBrandForm({ ...brandForm, description: e.target.value })} placeholder="Brand details..." rows={2} style={{ ...styles.input, resize: 'vertical' }} />
          </div>
          <button type="submit" style={styles.submitBtn}>{editingBrand ? 'Update Brand' : 'Create Brand'}</button>
        </form>
        </Modal>
      )}

      {/* Brand List */}
      {sponsorLoading ? (
        <p style={styles.emptyText}>Loading brands...</p>
      ) : sortedBrands.length === 0 ? (
        <div style={styles.emptyCard}>
          <p style={styles.emptyText}>No brands yet. Add one to get started.</p>
        </div>
      ) : (
        (() => {
          const brandColSpan = isAdmin ? 8 : 6;
          const renderBrandRow = (brand) => {
              const isExpanded = expandedBrandId === brand.id;
              const brandDels = brand.deliverables;
              const campDeliveredCount = brandDels.filter(d => d.delivered).length;
              const campTotalPay = brandDels.reduce((sum, d) => sum + (parseFloat(d.pay) || 0), 0);
              const fmtD = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              return (
                <React.Fragment key={brand.id}>
                  <tr onClick={() => setExpandedBrandId(isExpanded ? null : brand.id)} style={{ cursor: 'pointer' }}>
                    {/* Dates (mirrors Upcoming's leading Due column) */}
                    <td style={{ ...styles.tableTd, whiteSpace: 'nowrap', fontSize: '12px', color: 'rgba(255,255,255,0.45)' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', width: '10px', display: 'inline-block' }}>{isExpanded ? '▾' : '▸'}</span>
                        {brand.start_date && brand.end_date ? `${fmtD(brand.start_date)} – ${fmtD(brand.end_date)}` : '—'}
                      </span>
                    </td>
                    {/* Brand */}
                    <td style={styles.tableTd}>
                      <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{brand.brand}</span>
                    </td>
                    {/* Briefs */}
                    <td style={styles.tableTd}>
                      {(!brand.campaign_briefs || brand.campaign_briefs.length === 0) ? (
                        <span
                          onClick={(e) => { e.stopPropagation(); openBriefModal(brand); }}
                          style={{ ...styles.statusTag, background: 'rgba(245,158,11,0.12)', color: '#f59e0b', fontSize: '10px', fontWeight: 600, cursor: 'pointer' }}
                        >
                          + Add Brief
                        </span>
                      ) : (
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {brand.campaign_briefs.map(brief => (
                            <a
                              key={brief.id}
                              href={brief.onepager_md ? `/brief/${brief.id}` : brief.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                fontSize: '12px', color: brief.onepager_md ? '#6ee7b7' : '#8fb4d8',
                                textDecoration: 'underline dotted', textUnderlineOffset: 3,
                                maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'middle',
                              }}
                              title={brief.label || 'Brief'}
                            >
                              {brief.onepager_md ? '✓' : '🔗'} {brief.label || 'Brief'}
                            </a>
                          ))}
                        </div>
                      )}
                    </td>
                    {/* Deliverables done/total */}
                    <td style={styles.tableTd}>
                      {brandDels.length > 0
                        ? <span style={styles.checklistBadge}>{campDeliveredCount}/{brandDels.length}</span>
                        : <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: '12px' }}>—</span>}
                    </td>
                    {/* Contact */}
                    <td style={{ ...styles.tableTd, fontSize: '12px', color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }} title={brand.contact_email || ''}>
                      {brand.contact_name || brand.contact_email || '—'}
                    </td>
                    {/* Description */}
                    <td style={{ ...styles.tableTd, fontSize: '12px', color: 'rgba(255,255,255,0.45)', maxWidth: 240 }} title={brand.description || ''}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{brand.description || '—'}</div>
                    </td>
                    {/* Total pay (admin) — right-aligned like Upcoming's Pay */}
                    {isAdmin && (
                      <td style={{ ...styles.tableTd, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {campTotalPay > 0 ? `$${campTotalPay.toLocaleString()}` : '—'}
                      </td>
                    )}
                    {/* Payment (admin) — trailing status, like Upcoming's Delivered */}
                    {isAdmin && (
                      <td style={styles.tableTd}>
                        <span style={{ ...styles.statusTag, background: `${PAYMENT_STATUS_COLORS[brand.payment_status]}15`, color: PAYMENT_STATUS_COLORS[brand.payment_status] }}>
                          {brand.payment_status}
                        </span>
                      </td>
                    )}
                  </tr>

                  {isExpanded && (
                    <tr>
                      <td colSpan={brandColSpan} style={{ ...styles.tableTd, padding: 0, background: 'rgba(255,255,255,0.015)' }}>
                    <div style={{ ...styles.projectDetail, borderTop: 'none', padding: '14px 20px 20px' }}>
                      {/* Brand meta info */}
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '8px' }}>
                        {isAdmin && campTotalPay > 0 && (
                          <span style={{ ...styles.paymentBadge, background: `${PAYMENT_STATUS_COLORS[brand.payment_status]}15`, color: PAYMENT_STATUS_COLORS[brand.payment_status] }}>
                            ${campTotalPay.toLocaleString()}
                          </span>
                        )}
                        {(brand.contact_name || brand.contact_email) && (
                          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
                            {brand.contact_name}{brand.contact_email && ` (${brand.contact_email})`}
                          </span>
                        )}
                        {(brand.campaign_briefs || []).map(brief => (
                          <span key={brief.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <a href={brief.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '11px', color: colors.accentFg, textDecoration: 'none' }}>
                              {brief.type === 'doc' ? '\u{1F4C4}' : '\u{1F517}'} {brief.label || 'Brief'}
                            </a>
                            <button onClick={() => handleRemoveBrief(brief)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: '10px', padding: '0 2px' }} title="Remove brief">{'\u2715'}</button>
                          </span>
                        ))}
                      </div>
                      {brand.description && (
                        <p style={{ margin: '0 0 8px', fontSize: '13px', color: 'rgba(255,255,255,0.5)', whiteSpace: 'pre-wrap' }}>{brand.description}</p>
                      )}

                      {/* Deliverables (stacked cards) */}
                      {brandDels.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
                          {brandDels.map(d => renderDeliverableCard(d))}
                        </div>
                      )}

                      {/* Add Deliverable */}
                      <button
                        onClick={(e) => { e.stopPropagation(); resetDeliverableForm(); setDeliverableBrandId(brand.id); setShowDeliverableForm(brand.id); }}
                        style={styles.addDeliverableBtn}
                      >
                        + Add Deliverable
                      </button>

                      {/* Brand Actions */}
                      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                        <button onClick={() => startEditBrand(brand)} style={{ ...styles.filterBtn, fontSize: '12px' }}>Edit</button>
                        <button onClick={() => handleDeleteBrand(brand.id)} style={{ ...styles.filterBtn, fontSize: '12px', color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}>Delete</button>
                      </div>
                    </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            };

            // Rendered outside the tables (a modal can't nest in <tbody>) and
            // outside the row-expansion gate so it can open from the Upcoming
            // Deliverables table without expanding the parent brand row.
            const renderDeliverableFormModal = (brand) => (
                    <Modal title={editingDeliverable ? 'Edit Deliverable' : 'Add Deliverable'} subtitle={brand.brand} onClose={() => { resetDeliverableForm(); setShowDeliverableForm(null); }} maxWidth={680}>
                      <form onSubmit={(e) => handleSaveDeliverable(e, brand.sponsor_id, brand.id)}>
                        <div style={styles.formGrid}>
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
                            <label style={styles.label}>Due Month</label>
                            <input type="month" value={dueDate} onChange={e => setDueDate(e.target.value)} style={styles.input} />
                          </div>
                          <div style={styles.field}>
                            <label style={styles.label}>Review Due</label>
                            <input type="date" value={deliverableReviewDue} onChange={e => setDeliverableReviewDue(e.target.value)} style={styles.input} />
                          </div>
                          <div style={styles.field}>
                            <label style={styles.label}>Platforms</label>
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                              {DELIVERABLE_PLATFORMS.map(p => (
                                <button key={p} type="button" onClick={() => setDeliverablePlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])} style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: deliverablePlatforms.includes(p) ? 'rgba(91, 143, 199,0.2)' : 'transparent', color: deliverablePlatforms.includes(p) ? '#8fb4d8' : 'rgba(255,255,255,0.35)', borderColor: deliverablePlatforms.includes(p) ? 'rgba(91, 143, 199,0.4)' : 'rgba(255,255,255,0.08)' }}>{p}</button>
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
                            <label style={styles.label}>Status</label>
                            <select value={deliverableReviewStatus} onChange={e => setDeliverableReviewStatus(e.target.value)} style={styles.select}>
                              {REVIEW_STATUS_OPTIONS.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                          <div style={styles.field}>
                            <label style={styles.label}>Pay ($)</label>
                            <input type="number" step="0.01" value={deliverablePay} onChange={e => setDeliverablePay(e.target.value)} placeholder="0.00" style={styles.input} />
                          </div>
                          <div style={styles.field}>
                            <label style={styles.label}>Attached Video</label>
                            <select value={deliverableVideoEventId} onChange={e => setDeliverableVideoEventId(e.target.value)} style={styles.select}>
                              <option value="">None</option>
                              {videoEvents.map(ev => (
                                <option key={ev.id} value={ev.id}>
                                  {'📹'} {new Date(ev.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — {ev.title}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div style={styles.field}>
                            <label style={styles.label}>Video Link</label>
                            <input
                              type="url"
                              value={deliverableVideoUrl}
                              onChange={e => setDeliverableVideoUrl(e.target.value)}
                              placeholder="https://youtube.com/..."
                              style={styles.input}
                            />
                          </div>
                        </div>
                        <div style={styles.field}>
                          <label style={styles.label}>Ad Copy</label>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
                            <button
                              type="button"
                              onClick={() => setAdCopyModalOpen(true)}
                              style={{
                                flex: 1,
                                padding: '10px 14px',
                                borderRadius: '8px',
                                border: '1px solid rgba(91, 143, 199,0.3)',
                                background: colors.accentA10,
                                color: colors.accentFg,
                                fontSize: '13px',
                                fontWeight: 600,
                                cursor: 'pointer',
                                fontFamily: 'DM Sans, sans-serif',
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              }}
                            >
                              <span>{deliverableNotes ? 'Edit Ad Copy' : 'Open Ad Copy'}</span>
                              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
                                {deliverableNotes ? `${deliverableNotes.length} chars` : 'Empty'}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setBeatSheetChooserOpen(true)}
                              disabled={!deliverableNotes || pushingAdCopy}
                              title={!deliverableNotes ? 'Write ad copy first' : 'Push this ad copy into a beat sheet'}
                              style={{
                                padding: '10px 14px',
                                borderRadius: '8px',
                                border: '1px solid rgba(91, 143, 199,0.3)',
                                background: !deliverableNotes ? 'rgba(255,255,255,0.05)' : 'rgba(91, 143, 199,0.1)',
                                color: !deliverableNotes ? 'rgba(255,255,255,0.3)' : '#8fb4d8',
                                fontSize: '13px',
                                fontWeight: 600,
                                cursor: !deliverableNotes ? 'not-allowed' : 'pointer',
                                fontFamily: 'DM Sans, sans-serif',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {pushAdCopyDone ? 'Pushed!' : 'Push to Beat Sheet'}
                            </button>
                          </div>
                        </div>
                        <button type="submit" style={styles.submitBtn}>{editingDeliverable ? 'Update Deliverable' : 'Add Deliverable'}</button>
                      </form>
                    </Modal>
            );

            const isAct = (c) => c.deliverables.length === 0 || c.deliverables.some(d => !d.delivered);
            const activeC = sortedBrands.filter(isAct);
            const inactiveC = sortedBrands.filter(c => !isAct(c));
            const section = (title, list, open, setOpen) => (
              <div style={{ marginBottom: '16px' }}>
                <button onClick={() => setOpen(v => !v)} style={styles.brandSectionHeader}>
                  <span style={{ width: '12px', display: 'inline-block' }}>{open ? '▾' : '▸'}</span>
                  {title}
                  <span style={styles.checklistBadge}>{list.length}</span>
                </button>
                {open && (list.length > 0
                  ? (
                    <div style={{ overflowX: 'auto', marginTop: '12px' }}>
                      <table style={styles.table}>
                        <thead>
                          <tr>
                            <th style={styles.tableTh}>Dates</th>
                            <th style={styles.tableTh}>Brand</th>
                            <th style={styles.tableTh}>Briefs</th>
                            <th style={styles.tableTh}>Deliverables</th>
                            <th style={styles.tableTh}>Contact</th>
                            <th style={styles.tableTh}>Description</th>
                            {isAdmin && <th style={{ ...styles.tableTh, textAlign: 'right' }}>Total Pay</th>}
                            {isAdmin && <th style={styles.tableTh}>Payment</th>}
                          </tr>
                        </thead>
                        <tbody>{list.map(renderBrandRow)}</tbody>
                      </table>
                    </div>
                  )
                  : <p style={{ ...styles.emptyText, marginTop: '8px' }}>No {title.toLowerCase()} brands.</p>)}
              </div>
            );
            const formBrand = sortedBrands.find(b => b.id === showDeliverableForm) || null;
            return (
              <>
                {section('Active', activeC, brandActiveOpen, setBrandActiveOpen)}
                {section('Inactive', inactiveC, brandInactiveOpen, setBrandInactiveOpen)}
                {formBrand && renderDeliverableFormModal(formBrand)}
              </>
            );
          })()
      )}

      {/* Unbranded Deliverables (legacy) */}
      {unbrandedDeliverables.length > 0 && (
        <details style={{ marginTop: '12px', padding: '0 4px' }}>
          <summary style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', cursor: 'pointer', userSelect: 'none' }}>
            {unbrandedDeliverables.length} unbranded deliverable{unbrandedDeliverables.length !== 1 ? 's' : ''}
          </summary>
          <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {isAdmin && (
              <button onClick={handleDeleteUnbranded} style={{ alignSelf: 'flex-start', background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', marginBottom: '4px' }}>
                Delete All Unbranded
              </button>
            )}
            {unbrandedDeliverables.map(d => renderDeliverableRow(d, sponsors.find(s => s.id === d.sponsor_id)))}
          </div>
        </details>
      )}

      {/* Schedule Calendar Modal */}
      {renderScheduleCalendarModal()}

      {/* Finished Video Link Modal */}
      {videoLinkModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) { setVideoLinkModal(null); setVideoLinkInput(''); } }}
        >
          <form
            onSubmit={handleSaveVideoLink}
            style={{ background: colors.bgHover, borderRadius: '14px', width: '92vw', maxWidth: '440px', border: '1px solid rgba(255,255,255,0.1)', padding: '22px' }}
          >
            <h3 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 600, color: '#fff' }}>Finished Video</h3>
            <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
              Paste the link to the finished video. Saving marks this deliverable delivered.
            </p>
            <input
              type="url"
              autoFocus
              value={videoLinkInput}
              onChange={e => setVideoLinkInput(e.target.value)}
              placeholder="https://youtube.com/..."
              style={{ ...styles.input, width: '100%', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '18px' }}>
              <button
                type="button"
                onClick={() => { setVideoLinkModal(null); setVideoLinkInput(''); }}
                style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!videoLinkInput.trim()}
                style={{ padding: '8px 14px', borderRadius: '8px', border: 'none', background: videoLinkInput.trim() ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.06)', color: videoLinkInput.trim() ? '#86efac' : 'rgba(255,255,255,0.35)', fontSize: '13px', fontWeight: 600, cursor: videoLinkInput.trim() ? 'pointer' : 'default', fontFamily: 'inherit' }}
              >
                Accept
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ====== ADD BRIEF MODAL ====== */}
      {adCopyModalOpen && editingDeliverable && (() => {
        const editingD = allDeliverables.find(d => d.id === editingDeliverable);
        const briefs = editingD?.campaign_briefs || [];
        const onepagerBriefs = briefs.filter(b => b.onepager_md);
        const linkBriefs = briefs.filter(b => !b.onepager_md && b.url);
        const onepagerHtml = onepagerBriefs.map(b => DOMPurify.sanitize(marked.parse(b.onepager_md))).join('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:24px 0;" />');
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setAdCopyModalOpen(false); }}>
            <div style={{ background: colors.bgHover, borderRadius: '14px', width: '95vw', maxWidth: '1100px', height: '82vh', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '18px 22px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 600, color: '#fff' }}>Ad Copy</h3>
                  <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>{editingD?.sponsor_name}{editingD?.brand_name && editingD.brand_name !== editingD.sponsor_name ? ` · ${editingD.brand_name}` : ''}</p>
                </div>
                <button onClick={() => setAdCopyModalOpen(false)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}>Close</button>
              </div>
              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ padding: '10px 18px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.4)', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>Editor · autosaves</div>
                  <textarea
                    value={deliverableNotes}
                    onChange={e => setDeliverableNotes(e.target.value)}
                    placeholder="Write your ad copy here…"
                    style={{
                      flex: 1, minHeight: 0,
                      background: 'transparent', border: 'none', outline: 'none',
                      color: '#fff', fontSize: '14px', lineHeight: 1.6,
                      padding: '18px 22px', resize: 'none', fontFamily: 'DM Sans, sans-serif',
                    }}
                    autoFocus
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  <div style={{ padding: '10px 18px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.4)', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>Brief · read-only</div>
                  <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '18px 22px' }}>
                    {briefs.length === 0 && (
                      <p style={{ margin: 0, fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>No brief attached to this brand yet.</p>
                    )}
                    {onepagerBriefs.length > 0 && (
                      <div className="brief-md" style={{ fontSize: '13px', lineHeight: 1.6, color: 'rgba(255,255,255,0.85)' }} dangerouslySetInnerHTML={{ __html: onepagerHtml }} />
                    )}
                    {linkBriefs.length > 0 && (
                      <div style={{ marginTop: onepagerBriefs.length > 0 ? '20px' : 0 }}>
                        <p style={{ margin: '0 0 8px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>External briefs</p>
                        {linkBriefs.map(b => (
                          <a key={b.id} href={b.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', padding: '8px 12px', background: colors.accentA08, border: '1px solid rgba(91, 143, 199,0.2)', borderRadius: '8px', color: colors.accentFg, fontSize: '13px', marginBottom: '6px', textDecoration: 'none', wordBreak: 'break-all' }}>{b.label || b.url}</a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div style={{ padding: '14px 22px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  onClick={async () => {
                    await saveAdCopyNow();
                    setAdCopyModalOpen(false);
                  }}
                  style={{
                    background: 'linear-gradient(135deg, #5b8fc7, #8fb4d8)',
                    color: '#fff',
                    border: 'none', borderRadius: '8px', padding: '10px 18px', fontSize: '13px', fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'DM Sans, sans-serif',
                  }}
                >
                  Save &amp; Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {briefModalBrand && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }} onMouseDown={(e) => { if (e.target === e.currentTarget && !briefModalSaving) setBriefModalBrand(null); }}>
          <div style={{ background: colors.bgHover, borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '480px', border: '1px solid rgba(255,255,255,0.1)' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 600, color: '#fff' }}>{briefModalEditingId ? 'Edit Brief' : 'Add Brief'}</h3>
            <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>{briefModalBrand.name}</p>
            {!briefModalEditingId && (
              <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
                {[
                  { key: 'file', label: 'Upload PDF' },
                  { key: 'text', label: 'Paste Text' },
                  { key: 'link', label: 'Link' },
                ].map(t => (
                  <button key={t.key} type="button" onClick={() => { setBriefModalType(t.key); setBriefModalError(''); }}
                    style={{ flex: 1, padding: '6px 8px', borderRadius: '6px', border: '1px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: briefModalType === t.key ? 'rgba(91, 143, 199,0.2)' : 'transparent', color: briefModalType === t.key ? '#8fb4d8' : 'rgba(255,255,255,0.35)', borderColor: briefModalType === t.key ? 'rgba(91, 143, 199,0.4)' : 'rgba(255,255,255,0.08)' }}
                  >{t.label}</button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {briefModalType === 'file' && (
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px', fontWeight: 600 }}>{briefModalEditingId ? 'Replace file (optional)' : 'File (PDF, DOCX)'}</label>
                  <input type="file" accept=".pdf,.docx,.doc" onChange={e => setBriefModalFile(e.target.files[0] || null)}
                    style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '13px', boxSizing: 'border-box' }} />
                  <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>{briefModalEditingId ? 'Leave empty to keep current file. Replacing the file regenerates the one-pager.' : 'Claude reads the file and generates a standardized one-pager.'}</p>
                  {briefModalEditingId && !briefModalFile && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px', fontSize: '11px', color: 'rgba(255,255,255,0.55)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={briefModalRegenerate} onChange={e => setBriefModalRegenerate(e.target.checked)} />
                      Regenerate one-pager from current file
                    </label>
                  )}
                </div>
              )}
              {briefModalType === 'text' && (
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px', fontWeight: 600 }}>Paste brief content</label>
                  <textarea value={briefModalText} onChange={e => setBriefModalText(e.target.value)} placeholder="Paste raw brief text, email body, or notes from sponsor..."
                    rows={10} style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '13px', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} autoFocus />
                </div>
              )}
              {briefModalType === 'link' && (
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px', fontWeight: 600 }}>URL</label>
                  <input value={briefModalUrl} onChange={e => setBriefModalUrl(e.target.value)} placeholder="https://docs.google.com/..."
                    style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '13px', boxSizing: 'border-box' }} autoFocus />
                  <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>Saved as link only. No one-pager generated.</p>
                </div>
              )}
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px', fontWeight: 600 }}>Title</label>
                <input value={briefModalLabel} onChange={e => setBriefModalLabel(e.target.value)} placeholder="e.g. AG1 Brief"
                  style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '13px', boxSizing: 'border-box' }}
                  onKeyDown={e => { if (e.key === 'Enter' && briefModalType === 'link') saveBriefModal(); }} />
              </div>
              {briefModalError && (
                <p style={{ margin: 0, fontSize: '12px', color: '#fca5a5' }}>{briefModalError}</p>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
              <button onClick={() => setBriefModalBrand(null)} disabled={briefModalSaving} style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', border: 'none', borderRadius: '6px', padding: '8px 16px', fontSize: '13px', cursor: briefModalSaving ? 'not-allowed' : 'pointer', opacity: briefModalSaving ? 0.5 : 1 }}>Cancel</button>
              <button onClick={saveBriefModal} disabled={briefModalSaving} style={{ background: colors.accent, color: colors.white, border: 'none', borderRadius: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: briefModalSaving ? 0.5 : 1 }}>
                {briefModalProcessing ? 'Generating one-pager…' : briefModalSaving ? 'Saving…' : (briefModalEditingId ? 'Save Changes' : 'Save Brief')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context menu for upcoming deliverable cards */}
      {cardContextMenu && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
          onMouseDown={() => setCardContextMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setCardContextMenu(null); }}
        >
          <div style={{ ...styles.contextMenu, top: cardContextMenu.y, left: cardContextMenu.x }} onClick={e => e.stopPropagation()}>
            <button
              style={styles.contextMenuItem}
              onClick={() => {
                const d = cardContextMenu.deliverable;
                if (d.campaign_id) setExpandedBrandId(d.campaign_id);
                startEditDeliverable(d);
                setCardContextMenu(null);
              }}
            >
              Edit
            </button>
            <button
              style={styles.contextMenuItem}
              onClick={() => {
                handleDuplicateDeliverable(cardContextMenu.deliverable);
              }}
            >
              Duplicate
            </button>
            <button
              style={{ ...styles.contextMenuItem, color: '#f87171' }}
              onClick={async () => {
                const d = cardContextMenu.deliverable;
                setCardContextMenu(null);
                const ok = await confirm('Delete this deliverable?', 'This cannot be undone.');
                if (ok) handleDeleteDeliverable(d);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Choose-at-push-time beat sheet picker (from the Ad Copy field) */}
      <BeatSheetChooserModal
        open={beatSheetChooserOpen}
        beatSheets={beatSheets}
        pushing={pushingAdCopy}
        onPick={pushAdCopyToSheet}
        onClose={() => setBeatSheetChooserOpen(false)}
      />

      {/* Click-away for inline dropdowns */}
      {reviewDropdownId && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 49 }}
          onMouseDown={() => setReviewDropdownId(null)}
        />
      )}

    </div>
  );
}

function Modal({ title, subtitle, onClose, maxWidth = 640, children }) {
  return (
    <div style={styles.modalOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ ...styles.modalBox, maxWidth }}>
        <div style={styles.modalHeader}>
          <div>
            <h3 style={styles.modalTitle}>{title}</h3>
            {subtitle && <p style={styles.modalSubtitle}>{subtitle}</p>}
          </div>
          <button onClick={onClose} style={styles.modalClose} aria-label="Close">{'✕'}</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const styles = {
  page: { padding: '32px 0', maxWidth: '70%', margin: '0 auto' },
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
    background: 'linear-gradient(135deg, #5b8fc7, #8fb4d8)',
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
    background: colors.accent, border: 'none', borderRadius: '8px',
    color: '#fff', fontSize: '14px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  filterBtn: {
    padding: '6px 14px', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px', background: 'transparent',
    color: 'rgba(255,255,255,0.45)', fontSize: '12px', fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
  },
  projectList: { display: 'flex', flexDirection: 'column', gap: '4px' },
  sponsorCard: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px',
    overflow: 'hidden',
    transition: 'border-color 0.15s',
  },
  sponsorCardHeader: {
    display: 'flex',
    flexDirection: 'column',
    padding: '14px 16px',
    cursor: 'pointer',
    gap: '10px',
  },
  projectRowLeft: { display: 'flex', alignItems: 'center', gap: '14px' },
  projectRowName: { fontSize: '15px', fontWeight: 600, color: '#e2e8f0' },
  projectRowMeta: {
    fontSize: '12px', color: 'rgba(255,255,255,0.35)', marginTop: '2px',
    textTransform: 'capitalize',
  },
  projectRowRight: { display: 'flex', alignItems: 'center', gap: '12px' },
  statusTag: {
    padding: '4px 10px', borderRadius: '6px',
    fontSize: '11px', fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: '0.3px',
  },
  projectDetail: {
    padding: '0 20px 20px',
    borderTop: '1px solid rgba(255,255,255,0.05)',
  },
  checklistBadge: {
    fontSize: '11px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    background: 'rgba(255,255,255,0.06)',
    borderRadius: '6px',
    padding: '2px 8px',
    minWidth: '16px',
    textAlign: 'center',
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
  emptyCard: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px dashed rgba(255,255,255,0.08)',
    borderRadius: '12px',
    padding: '40px 24px',
    textAlign: 'center',
  },
  emptyText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: '14px',
    margin: 0,
  },

  // ── Brand card grid (2 per row) ──
  columnPanel: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: '14px',
    padding: '20px',
  },
  pageHeaderBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
    gap: '10px', marginBottom: '16px',
  },
  proposalsBtn: {
    display: 'flex', alignItems: 'center', gap: '8px',
    background: colors.accentA15, color: colors.accentFgSoft,
    border: '1px solid rgba(91, 143, 199,0.4)', borderRadius: '10px',
    padding: '9px 16px', fontSize: '13px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  proposalsBtnBadge: {
    background: '#ef4444', color: '#fff', borderRadius: '10px',
    padding: '0 7px', fontSize: '12px', fontWeight: 700, lineHeight: '18px',
  },
  drawerOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    display: 'flex', justifyContent: 'flex-end', zIndex: 9998,
  },
  drawerPanel: {
    width: 'min(520px, 92vw)', height: '100%', background: '#13131f',
    borderLeft: '1px solid rgba(255,255,255,0.1)',
    boxShadow: '-12px 0 40px rgba(0,0,0,0.45)',
    padding: '20px 22px', overflowY: 'auto',
    animation: 'none',
  },
  drawerClose: {
    background: 'rgba(255,255,255,0.06)', border: 'none', color: 'rgba(255,255,255,0.6)',
    cursor: 'pointer', fontSize: '15px', lineHeight: 1, borderRadius: '8px',
    width: '30px', height: '30px', flexShrink: 0,
  },
  columnDivider: {
    height: '1px',
    background: 'rgba(255,255,255,0.08)',
    margin: '18px 0',
  },
  // Bold break between the Upcoming Deliverables and Brands sections.
  sectionDivider: {
    height: '2px',
    background: 'linear-gradient(90deg, rgba(91, 143, 199,0.05), rgba(91, 143, 199,0.55), rgba(91, 143, 199,0.05))',
    borderRadius: '2px',
    margin: '40px 0 32px',
  },
  brandSectionHeader: {
    display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '8px', padding: '8px 12px', cursor: 'pointer',
    color: 'rgba(255,255,255,0.85)', fontSize: '14px', fontWeight: 600, fontFamily: 'inherit',
  },

  // ── Deliverable cards (stacked inside a brand / Upcoming grid) ──
  delivCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: '10px',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  delivCardDone: {
    background: 'rgba(34,197,94,0.10)',
    border: '1px solid rgba(34,197,94,0.45)',
  },
  delivCardTop: { display: 'flex', alignItems: 'center', gap: '8px' },
  delivCardTitle: {
    flex: 1, minWidth: 0, fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.9)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  delivCardSub: {
    fontSize: '11px', color: 'rgba(255,255,255,0.4)',
    display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center',
  },
  delivChips: { display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' },
  chip: {
    fontSize: '9px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px',
    whiteSpace: 'nowrap', letterSpacing: '0.2px',
  },
  delivIconBtn: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)',
    cursor: 'pointer', fontSize: '12px', padding: '2px 4px', flexShrink: 0,
  },
  delivToggle: {
    alignSelf: 'flex-start',
    padding: '4px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer',
    fontSize: '11px', fontWeight: 700, fontFamily: 'inherit',
    background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)',
  },
  delivToggleDone: { background: 'rgba(34,197,94,0.2)', color: '#86efac' },
  // Context menu
  contextMenu: {
    position: 'fixed', zIndex: 9999, minWidth: '140px',
    background: colors.bgHover, border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px',
    padding: '4px 0', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  contextMenuItem: {
    display: 'block', width: '100%', background: 'none', border: 'none',
    color: 'rgba(255,255,255,0.8)', fontSize: '13px', fontFamily: 'inherit',
    padding: '8px 14px', textAlign: 'left', cursor: 'pointer',
  },
  // Inline dropdown (video / beat sheet pickers)
  inlineDropdown: {
    position: 'absolute', top: '100%', left: 0, zIndex: 50,
    marginTop: '4px', minWidth: '220px', maxHeight: '200px', overflowY: 'auto',
    background: colors.bgHover, border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px',
    padding: '4px 0', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  inlineDropdownItem: {
    display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.8)',
    fontSize: '12px', fontFamily: 'inherit', padding: '7px 12px',
    textAlign: 'left', cursor: 'pointer',
  },
  addDeliverableBtn: {
    width: '100%', padding: '8px', borderRadius: '8px',
    background: colors.accentA10, color: colors.accentFg,
    border: '1px dashed rgba(91, 143, 199,0.35)', cursor: 'pointer',
    fontSize: '12px', fontWeight: 600, fontFamily: 'inherit',
  },

  // ── Sortable table ──
  table: {
    width: '100%', borderCollapse: 'collapse', fontSize: '13px',
  },
  tableTh: {
    padding: '8px 10px', textAlign: 'left', fontSize: '11px', fontWeight: 700,
    color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.4px',
    borderBottom: '1px solid rgba(255,255,255,0.08)', whiteSpace: 'nowrap',
  },
  tableTd: {
    padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.04)',
    verticalAlign: 'middle', color: 'rgba(255,255,255,0.8)',
  },

  // ── Calendar modal grid ──
  calendarGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px',
    overflow: 'hidden',
  },
  calendarDay: {
    minHeight: '90px', padding: '6px 8px', borderRadius: '6px',
    background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.04)',
    minWidth: 0, overflow: 'hidden',
  },
  calendarDayBlank: {
    minHeight: '90px',
  },
  calendarTooltip: {
    position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
    background: colors.bgHover, border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px',
    padding: '10px 12px', fontSize: '11px', color: '#fff', zIndex: 100,
    minWidth: '180px', maxWidth: '260px', whiteSpace: 'normal',
    boxShadow: '0 8px 24px rgba(0,0,0,0.6)', pointerEvents: 'none',
    marginBottom: '6px',
  },

  // ── Modal ──
  modalOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '24px 16px', overflowY: 'auto', zIndex: 9999,
  },
  modalBox: {
    background: colors.bgHover, borderRadius: '14px', padding: '24px',
    width: '100%', border: '1px solid rgba(255,255,255,0.1)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  },
  modalHeader: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: '12px', marginBottom: '16px',
  },
  modalTitle: { margin: 0, fontSize: '17px', fontWeight: 700, color: '#fff' },
  modalSubtitle: { margin: '2px 0 0', fontSize: '12px', color: 'rgba(255,255,255,0.4)' },
  modalClose: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
    cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '2px 6px',
  },
};
