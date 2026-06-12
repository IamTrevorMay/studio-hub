import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import { callWorkflowFn } from '../lib/workflowApi';

const DELIVERABLE_TYPES = {
  long_form_read: { label: 'Long Form Read', icon: '\u{1F4D6}' },
  live_read: { label: 'Live Read', icon: '\u{1F399}\uFE0F' },
  short_form_video: { label: 'Short Form Video', icon: '\u{1F4F1}' },
};
const DELIVERABLE_PLATFORMS = ['YouTube', 'TikTok', 'Instagram', 'X/Twitter', 'Facebook', 'Substack', 'Podcast'];
const SPONSOR_STATUS_COLORS = { active: '#10b981', completed: '#6366f1', cancelled: '#ef4444' };
const PAYMENT_STATUS_COLORS = { unpaid: '#ef4444', partial: '#f59e0b', paid: '#10b981' };
const CHANNEL_COLORS = {
  mayday: { bg: 'rgba(99,102,241,0.12)', color: '#a5b4fc', label: 'Mayday' },
  tmb: { bg: 'rgba(239,68,68,0.12)', color: '#fca5a5', label: 'TM Baseball' },
  socials: { bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)', label: 'Social' },
};

export default function Deliverables({ initialCampaignId, onCampaignOpened }) {
  const { profile, isAdmin, refreshKey } = useAuth();
  const confirm = useConfirm();

  // Sponsors state
  const [sponsors, setSponsors] = useState([]);
  const [sponsorLoading, setSponsorLoading] = useState(false);
  const [expandedCampaignId, setExpandedCampaignId] = useState(null);
  const [campaignActiveOpen, setCampaignActiveOpen] = useState(true);
  const [campaignInactiveOpen, setCampaignInactiveOpen] = useState(false);
  const [showDeliverableForm, setShowDeliverableForm] = useState(null);
  const [editingDeliverable, setEditingDeliverable] = useState(null);
  const [deliverableTitle, setDeliverableTitle] = useState('');
  const [deliverableType, setDeliverableType] = useState('long_form_read');
  const [dueDate, setDueDate] = useState('');
  const [deliverableNotes, setDeliverableNotes] = useState('');
  const [deliverablePlatforms, setDeliverablePlatforms] = useState([]);
  const [deliverableNeedsReview, setDeliverableNeedsReview] = useState(false);
  const [deliverableCampaignId, setDeliverableCampaignId] = useState('');
  const [deliverablePay, setDeliverablePay] = useState('');
  const [deliverableBeatSheetId, setDeliverableBeatSheetId] = useState('');
  const [deliverableVideoEventId, setDeliverableVideoEventId] = useState('');
  const [deliverableChannel, setDeliverableChannel] = useState('');

  // Video events for deliverable linking
  const [videoEvents, setVideoEvents] = useState([]);

  // Campaign state
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState(null);
  const [campaignForm, setCampaignForm] = useState({ name: '', brand: '', description: '', start_date: '', end_date: '', contact_name: '', contact_email: '', payment_status: 'unpaid' });
  const [briefFile, setBriefFile] = useState(null);
  const [briefMode, setBriefMode] = useState('upload');
  const [briefLinkUrl, setBriefLinkUrl] = useState('');
  const [briefLinkLabel, setBriefLinkLabel] = useState('');
  const [briefModalCampaign, setBriefModalCampaign] = useState(null);
  const [briefModalUrl, setBriefModalUrl] = useState('');
  const [briefModalLabel, setBriefModalLabel] = useState('');
  const [briefModalSaving, setBriefModalSaving] = useState(false);

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
  const [beatSheetDropdownId, setBeatSheetDropdownId] = useState(null); // deliverable id showing beat sheet picker

  // Table sorting + delivered toggle
  const [sortCol, setSortCol] = useState('schedule'); // default sort by schedule date
  const [sortDir, setSortDir] = useState('asc');
  const [showDelivered, setShowDelivered] = useState(false);

  // Schedule calendar modal
  const [scheduleModalDeliverable, setScheduleModalDeliverable] = useState(null);
  const [scheduleModalDate, setScheduleModalDate] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [scheduleModalHoveredEvent, setScheduleModalHoveredEvent] = useState(null);

  // Auto-expand a campaign when navigated to from another page
  useEffect(() => {
    if (initialCampaignId) {
      setExpandedCampaignId(initialCampaignId);
      if (onCampaignOpened) onCampaignOpened();
    }
  }, [initialCampaignId, onCampaignOpened]);

  // --- Data fetching ---
  const fetchSponsors = useCallback(async () => {
    setSponsorLoading(true);
    try {
      const { data, error } = await supabase
        .from('sponsors')
        .select('*, sponsor_deliverables(*, deliverable_stage_assignments(*, profile:profiles(id, full_name))), sponsor_campaigns(*)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setSponsors(data || []);
      const flat = [];
      (data || []).forEach(s => {
        (s.sponsor_deliverables || []).forEach(d => {
          const campaign = (s.sponsor_campaigns || []).find(c => c.id === d.campaign_id);
          flat.push({ ...d, sponsor_name: s.name, sponsor_id: s.id, campaign_name: campaign?.name || null, brief_url: campaign?.brief_url || null, brief_name: campaign?.brief_name || null });
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
        .eq('event_type', 'video_post')
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
      if (error) { alert('Error removing deliverable: ' + error.message); return; }
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
      alert('Sponsor name is required before accepting a deliverable.');
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
    if (error) { alert('Error starting draft: ' + error.message); return null; }
    setDraftProposalId(data.id);
    return data.id;
  }

  async function acceptItem(idx) {
    const it = proposalItems[idx];
    if (!it.title.trim()) {
      alert('Title is required.');
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
      if (error) { alert('Error saving deliverable: ' + error.message); return; }
      updateItem(idx, { accepted: true });
    } else {
      const { data, error } = await supabase
        .from('ad_read_proposal_items')
        .insert(row)
        .select()
        .single();
      if (error) { alert('Error saving deliverable: ' + error.message); return; }
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
      alert('Sponsor name is required.');
      return;
    }
    if (proposalItems.length === 0) {
      alert('Add at least one deliverable.');
      return;
    }
    if (!allItemsAccepted()) {
      alert('Accept every deliverable before creating the proposal.');
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
    if (error) { alert('Error creating proposal: ' + error.message); return; }

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
      alert('This proposal has already been accepted.');
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
      const campaignPayload = {
        sponsor_id: sponsorId,
        name: proposal.sponsor_name + ' Campaign',
        description: proposal.description || null,
        payment_status: 'unpaid',
      };
      if (bounds.start) campaignPayload.start_date = bounds.start;
      if (bounds.end) campaignPayload.end_date = bounds.end;
      const { data: campaign, error: cErr } = await supabase
        .from('sponsor_campaigns')
        .insert(campaignPayload)
        .select()
        .single();
      if (cErr) throw cErr;

      if (items.length > 0) {
        const delivRows = items.map((it) => ({
          sponsor_id: sponsorId,
          campaign_id: campaign.id,
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
      alert('Error confirming proposal: ' + err.message);
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
      alert('Sponsor name is required.');
      return;
    }
    if (proposalItems.length === 0) {
      alert('Add at least one deliverable.');
      return;
    }
    if (!allItemsAccepted()) {
      alert('Accept every deliverable before saving.');
      return;
    }
    const { error } = await supabase.from('ad_read_proposals').update({
      sponsor_name: proposalForm.sponsor_name,
      description: proposalForm.description || null,
    }).eq('id', editingProposal);
    if (error) { alert('Error updating proposal: ' + error.message); return; }
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
    setDeliverableTitle(''); setDeliverableType('long_form_read');
    setDueDate(''); setDeliverableNotes('');
    setDeliverablePlatforms([]); setDeliverableNeedsReview(false); setDeliverableCampaignId('');
    setDeliverablePay(''); setDeliverableBeatSheetId(''); setDeliverableVideoEventId('');
    setDeliverableChannel('');
    setEditingDeliverable(null); setShowDeliverableForm(null);
  }

  function startEditDeliverable(d) {
    setDeliverableTitle(d.title);
    setDeliverableType(d.deliverable_type);
    setDueDate(d.due_date ? d.due_date.slice(0, 7) : '');
    setDeliverableNotes(d.notes || '');
    setDeliverablePlatforms(d.platforms || []);
    setDeliverableNeedsReview(d.needs_review || false);
    setDeliverableCampaignId(d.campaign_id || '');
    setDeliverablePay(d.pay != null ? String(d.pay) : '');
    setDeliverableBeatSheetId(d.beat_sheet_id || '');
    setDeliverableVideoEventId(d.video_event_id || '');
    setDeliverableChannel(d.channel || '');
    setEditingDeliverable(d.id);
    setShowDeliverableForm(d.campaign_id);
  }

  async function handleSaveDeliverable(e, sponsorId, campaignId) {
    e.preventDefault();
    const sponsor = sponsors.find(s => s.id === sponsorId);
    if (editingDeliverable) {
      const deliverable = sponsor?.sponsor_deliverables?.find(d => d.id === editingDeliverable);
      const { error } = await supabase.from('sponsor_deliverables').update({
        title: deliverableTitle,
        deliverable_type: deliverableType,
        due_date: dueDate ? dueDate + '-01' : null,
        notes: deliverableNotes || null,
        platforms: deliverablePlatforms,
        needs_review: deliverableNeedsReview,
        campaign_id: campaignId || deliverableCampaignId || null,
        pay: deliverablePay ? parseFloat(deliverablePay) : null,
        beat_sheet_id: deliverableBeatSheetId || null,
        video_event_id: deliverableVideoEventId || null,
        channel: deliverableChannel || null,
        updated_at: new Date().toISOString(),
      }).eq('id', editingDeliverable);
      if (error) { alert('Error updating deliverable: ' + error.message); return; }

      const dueDateFull = dueDate ? dueDate + '-01' : null;
      if (dueDateFull && deliverable?.calendar_event_id) {
        await supabase.from('calendar_events').update({
          title: `\u{1F91D} ${sponsor?.name}: ${deliverableTitle}`,
          start_date: `${dueDateFull}T09:00:00`,
          end_date: `${dueDateFull}T10:00:00`,
        }).eq('id', deliverable.calendar_event_id);
      } else if (dueDateFull && !deliverable?.calendar_event_id) {
        const { data: evData } = await supabase.from('calendar_events').insert({
          title: `\u{1F91D} ${sponsor?.name}: ${deliverableTitle}`,
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
        title: deliverableTitle,
        deliverable_type: deliverableType,
        due_date: dueDate ? dueDate + '-01' : null,
        notes: deliverableNotes || null,
        platforms: deliverablePlatforms,
        needs_review: deliverableNeedsReview,
        campaign_id: campaignId || null,
        pay: deliverablePay ? parseFloat(deliverablePay) : null,
        beat_sheet_id: deliverableBeatSheetId || null,
        video_event_id: deliverableVideoEventId || null,
        channel: deliverableChannel || null,
      }).select().single();
      if (error) { alert('Error creating deliverable: ' + error.message); return; }

      const newDueDateFull = dueDate ? dueDate + '-01' : null;
      if (newDueDateFull && dData) {
        const { data: evData } = await supabase.from('calendar_events').insert({
          title: `\u{1F91D} ${sponsor?.name}: ${deliverableTitle}`,
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

    // Auto-create beat in linked beat sheet
    if (deliverableBeatSheetId && deliverableNotes) {
      try {
        const { data: sheet } = await supabase
          .from('beat_sheets')
          .select('beats')
          .eq('id', deliverableBeatSheetId)
          .single();
        if (sheet) {
          const existingBeats = sheet.beats || [];
          const newBeat = {
            id: crypto.randomUUID(),
            title: 'Ad Read\n\n' + deliverableNotes,
            context: '',
            graphics: [],
            videos: [],
          };
          await supabase.from('beat_sheets').update({
            beats: [...existingBeats, newBeat],
            updated_at: new Date().toISOString(),
          }).eq('id', deliverableBeatSheetId);
        }
      } catch (err) {
        console.error('Error auto-creating beat:', err);
      }
    }

    const syncCampId = campaignId || deliverableCampaignId;
    if (syncCampId) await syncCampaignRevenue(syncCampId);

    resetDeliverableForm();
    fetchSponsors();
  }

  async function handleDeleteUncampaigned() {
    if (!(await confirm(`Delete all ${uncampaignedDeliverables.length} uncampaigned deliverables? This cannot be undone.`))) return;
    for (const d of uncampaignedDeliverables) {
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
    if (deliverable.campaign_id) await syncCampaignRevenue(deliverable.campaign_id);
    fetchSponsors();
  }

  async function handleToggleDelivered(deliverableId, currentValue) {
    const newValue = !currentValue;
    await supabase.from('sponsor_deliverables').update({
      delivered: newValue,
      updated_at: new Date().toISOString(),
    }).eq('id', deliverableId);
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

  // Inline assign beat sheet to deliverable from card dropdown
  async function handleInlineAssignBeatSheet(deliverableId, beatSheetId) {
    setBeatSheetDropdownId(null);
    await supabase.from('sponsor_deliverables').update({
      beat_sheet_id: beatSheetId || null,
      updated_at: new Date().toISOString(),
    }).eq('id', deliverableId);
    fetchSponsors();
  }

  // Push ad copy to linked beat sheet (manual button in form)
  const [pushingAdCopy, setPushingAdCopy] = useState(false);
  const [pushAdCopyDone, setPushAdCopyDone] = useState(false);
  async function handlePushAdCopyToBeatSheet() {
    if (!deliverableBeatSheetId || !deliverableNotes) return;
    setPushingAdCopy(true);
    try {
      const { data: sheet } = await supabase
        .from('beat_sheets')
        .select('beats')
        .eq('id', deliverableBeatSheetId)
        .single();
      if (!sheet) return;
      const newBeat = {
        id: crypto.randomUUID(),
        title: 'Ad Read\n\n' + deliverableNotes,
        context: '',
        graphics: [],
        videos: [],
      };
      await supabase.from('beat_sheets').update({
        beats: [...(sheet.beats || []), newBeat],
        updated_at: new Date().toISOString(),
      }).eq('id', deliverableBeatSheetId);
      setPushAdCopyDone(true);
      setTimeout(() => setPushAdCopyDone(false), 2000);
    } catch (err) {
      console.error('Error pushing ad copy to beat sheet:', err);
    } finally {
      setPushingAdCopy(false);
    }
  }

  // Duplicate a deliverable
  async function handleDuplicateDeliverable(d) {
    setCardContextMenu(null);
    const { error } = await supabase.from('sponsor_deliverables').insert({
      title: d.title + ' (copy)',
      deliverable_type: d.deliverable_type,
      due_date: d.due_date,
      notes: d.notes,
      platforms: d.platforms,
      needs_review: d.needs_review,
      campaign_id: d.campaign_id,
      sponsor_id: d.sponsor_id,
      pay: d.pay,
      channel: d.channel,
      delivered: false,
    });
    if (error) { alert('Error duplicating: ' + error.message); return; }
    fetchSponsors();
  }

  // Get video events not already attached to any deliverable (except current)
  function getAvailableVideoEvents(currentDeliverableId) {
    const usedIds = new Set(allDeliverables.filter(d => d.video_event_id && d.id !== currentDeliverableId).map(d => d.video_event_id));
    const today = new Date().toISOString().slice(0, 10);
    return videoEvents.filter(ev => !usedIds.has(ev.id) && ev.start_date && ev.start_date.slice(0, 10) >= today);
  }

  // Get beat sheets not already linked to any deliverable (except current)
  function getAvailableBeatSheets(currentDeliverableId) {
    const usedIds = new Set(allDeliverables.filter(d => d.beat_sheet_id && d.id !== currentDeliverableId).map(d => d.beat_sheet_id));
    return beatSheets.filter(bs => !usedIds.has(bs.id) && !bs.is_archived && bs.folder !== 'archive');
  }

  // --- Campaign handlers ---
  function resetCampaignForm() {
    setCampaignForm({ name: '', brand: '', description: '', start_date: '', end_date: '', contact_name: '', contact_email: '', payment_status: 'unpaid' });
    setBriefFile(null);
    setBriefMode('upload');
    setBriefLinkUrl('');
    setBriefLinkLabel('');
    setEditingCampaign(null); setShowCampaignForm(false);
  }

  function startEditCampaign(campaign) {
    setCampaignForm({
      name: campaign.name,
      brand: campaign.brand || '',
      description: campaign.description || '',
      start_date: campaign.start_date || '',
      end_date: campaign.end_date || '',
      contact_name: campaign.contact_name || '',
      contact_email: campaign.contact_email || '',
      payment_status: campaign.payment_status || 'unpaid',
    });
    setEditingCampaign(campaign.id);
    setShowCampaignForm(true);
  }

  async function handleSaveCampaign(e) {
    e.preventDefault();
    const brandName = (campaignForm.brand || '').trim();
    if (!brandName) { alert('Brand name is required'); return; }
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
      if (sErr) { alert('Error creating brand: ' + sErr.message); return; }
      sponsorId = newSponsor.id;
    }
    const payload = {
      sponsor_id: sponsorId,
      name: campaignForm.name,
      description: campaignForm.description || null,
      start_date: campaignForm.start_date || null,
      end_date: campaignForm.end_date || null,
      contact_name: campaignForm.contact_name || null,
      contact_email: campaignForm.contact_email || null,
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
    if (campaignId) {
      if (briefMode === 'upload' && briefFile) {
        const filePath = `${campaignId}/${Date.now()}_${briefFile.name}`;
        const { error: uploadError } = await supabase.storage.from('campaign-briefs').upload(filePath, briefFile);
        if (uploadError) { alert('Brief upload failed: ' + uploadError.message); } else {
          const { data: urlData } = supabase.storage.from('campaign-briefs').getPublicUrl(filePath);
          await supabase.from('sponsor_campaigns').update({ brief_url: urlData.publicUrl, brief_name: briefFile.name }).eq('id', campaignId);
        }
      } else if (briefMode === 'link' && briefLinkUrl.trim()) {
        const url = briefLinkUrl.trim();
        let label = briefLinkLabel.trim();
        if (!label) {
          try { label = new URL(url).hostname.replace(/^www\./, ''); } catch { label = 'Brief'; }
        }
        await supabase.from('sponsor_campaigns').update({ brief_url: url, brief_name: label }).eq('id', campaignId);
      }
    }
    await syncCampaignRevenue(campaignId);

    resetCampaignForm();
    fetchSponsors();
  }

  async function syncCampaignRevenue(campaignId) {
    if (!campaignId) return;
    const revenueKey = `sponsor_campaign_${campaignId}`;
    const { data: campaign } = await supabase
      .from('sponsor_campaigns')
      .select('id, sponsor_id, payment_status, end_date')
      .eq('id', campaignId)
      .single();
    if (!campaign) {
      await supabase.from('revenue_events').delete().eq('stripe_event_id', revenueKey);
      return;
    }
    const { data: dels } = await supabase
      .from('sponsor_deliverables')
      .select('pay')
      .eq('campaign_id', campaignId);
    const totalPay = (dels || []).reduce((sum, d) => sum + (parseFloat(d.pay) || 0), 0);
    if (campaign.payment_status === 'paid' && totalPay > 0) {
      const amountCents = Math.round(totalPay * 100);
      await supabase.from('revenue_events').upsert({
        stripe_event_id: revenueKey,
        event_type: 'sponsorship',
        amount_cents: amountCents,
        net_amount_cents: amountCents,
        product_category: 'sponsorship',
        occurred_at: campaign.end_date || new Date().toISOString(),
        platform_account_id: null,
        metadata: { source: 'sponsor_campaign', campaign_id: campaignId, sponsor_id: campaign.sponsor_id },
      }, { onConflict: 'stripe_event_id' });
    } else {
      await supabase.from('revenue_events').delete().eq('stripe_event_id', revenueKey);
    }
  }

  async function handleRemoveBrief(campaignId, briefUrl) {
    if (!(await confirm('Remove this brief file?'))) return;
    const pathMatch = briefUrl.match(/campaign-briefs\/(.+)$/);
    if (pathMatch) {
      await supabase.storage.from('campaign-briefs').remove([decodeURIComponent(pathMatch[1])]);
    }
    await supabase.from('sponsor_campaigns').update({ brief_url: null, brief_name: null }).eq('id', campaignId);
    fetchSponsors();
  }

  function openBriefModal(campaign) {
    setBriefModalCampaign(campaign);
    setBriefModalUrl(campaign.brief_url || '');
    setBriefModalLabel(campaign.brief_name || '');
  }

  async function saveBriefModal() {
    if (!briefModalCampaign) return;
    const url = briefModalUrl.trim();
    if (!url) { alert('Please enter a URL'); return; }
    setBriefModalSaving(true);
    let label = briefModalLabel.trim();
    if (!label) {
      try { label = new URL(url).hostname.replace(/^www\./, ''); } catch { label = 'Brief'; }
    }
    await supabase.from('sponsor_campaigns').update({ brief_url: url, brief_name: label }).eq('id', briefModalCampaign.id);
    fetchSponsors();
    setBriefModalCampaign(null);
    setBriefModalSaving(false);
  }

  async function handleDeleteCampaign(campaignId) {
    if (!(await confirm('Delete this campaign and all its deliverables?'))) return;
    const campaignDeliverables = allDeliverables.filter(d => d.campaign_id === campaignId);
    for (const d of campaignDeliverables) {
      if (d.calendar_event_id) {
        await supabase.from('calendar_events').delete().eq('id', d.calendar_event_id);
      }
    }
    await supabase.from('sponsor_deliverables').delete().eq('campaign_id', campaignId);
    await supabase.from('sponsor_campaigns').delete().eq('id', campaignId);
    fetchSponsors();
  }

  // --- Computed values ---
  const allCampaignsFlat = sponsors.flatMap(s =>
    (s.sponsor_campaigns || []).map(c => ({
      ...c,
      brand: s.name,
      sponsor_id: s.id,
      deliverables: (s.sponsor_deliverables || []).filter(d => d.campaign_id === c.id),
    }))
  );
  const sortedCampaigns = [...allCampaignsFlat].sort((a, b) => {
    const aActive = a.deliverables.length === 0 || a.deliverables.some(d => !d.delivered);
    const bActive = b.deliverables.length === 0 || b.deliverables.some(d => !d.delivered);
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    return new Date(b.created_at) - new Date(a.created_at);
  });
  const activeCampaignsCount = allCampaignsFlat.filter(c =>
    c.deliverables.length === 0 || c.deliverables.some(d => !d.delivered)
  ).length;
  const uncampaignedDeliverables = sponsors.flatMap(s =>
    (s.sponsor_deliverables || []).filter(d => !d.campaign_id).map(d => ({ ...d, sponsor_name: s.name, sponsor_id: s.id }))
  );
  const pendingProposals = proposals.filter(p => p.status === 'pending');
  const resolvedProposals = proposals.filter(p => p.status !== 'pending' && p.status !== 'draft');

  function renderDeliverableRow(d, sponsor) {
    return (
      <div key={d.id} style={styles.deliverableRow}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, flexWrap: 'wrap' }}>
          <button
            onClick={(e) => { e.stopPropagation(); handleToggleDelivered(d.id, d.delivered); }}
            style={{
              padding: '3px 10px', borderRadius: '6px', border: 'none', cursor: 'pointer',
              fontSize: '11px', fontWeight: 600, fontFamily: 'inherit', transition: 'all 0.15s',
              background: d.delivered ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)',
              color: d.delivered ? '#86efac' : 'rgba(255,255,255,0.7)',
            }}
          >
            {d.delivered ? 'Delivered' : 'Open'}
          </button>
          <span style={{ fontSize: '14px', flexShrink: 0 }}>{DELIVERABLE_TYPES[d.deliverable_type]?.icon || '\u{1F4CB}'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', color: d.delivered ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.85)', textDecoration: d.delivered ? 'line-through' : 'none' }}>
              {d.title}
            </div>
          </div>
          {d.channel && CHANNEL_COLORS[d.channel] && (
            <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 5px', borderRadius: '4px', background: CHANNEL_COLORS[d.channel].bg, color: CHANNEL_COLORS[d.channel].color }}>
              {CHANNEL_COLORS[d.channel].label}
            </span>
          )}
          {(d.platforms || []).map(p => (
            <span key={p} style={{ fontSize: '9px', fontWeight: 600, padding: '2px 5px', borderRadius: '4px', background: 'rgba(99,102,241,0.12)', color: '#a5b4fc' }}>{p}</span>
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

  // Deliverable as a card (used in the campaign stack). Turns green when delivered.
  function renderDeliverableCard(d) {
    const delivered = d.delivered;
    const ev = d.video_event_id ? videoEvents.find(e => e.id === d.video_event_id) : null;
    return (
      <div key={d.id} style={{ ...styles.delivCard, ...(delivered ? styles.delivCardDone : {}) }}>
        <div style={styles.delivCardTop}>
          <span style={{ fontSize: '15px', flexShrink: 0 }}>{DELIVERABLE_TYPES[d.deliverable_type]?.icon || '\u{1F4CB}'}</span>
          <span style={{ ...styles.delivCardTitle, ...(delivered ? { textDecoration: 'line-through', color: 'rgba(255,255,255,0.55)' } : {}) }}>{d.title}</span>
          <button onClick={(e) => { e.stopPropagation(); startEditDeliverable(d); }} style={styles.delivIconBtn} title="Edit">{'\u270e'}</button>
          <button onClick={(e) => { e.stopPropagation(); handleDeleteDeliverable(d); }} style={styles.delivIconBtn} title="Delete">{'\u2715'}</button>
        </div>
        <div style={styles.delivChips}>
          {d.channel && CHANNEL_COLORS[d.channel] && (
            <span style={{ ...styles.chip, background: CHANNEL_COLORS[d.channel].bg, color: CHANNEL_COLORS[d.channel].color }}>{CHANNEL_COLORS[d.channel].label}</span>
          )}
          {(d.platforms || []).map(p => (
            <span key={p} style={{ ...styles.chip, fontWeight: 600, background: 'rgba(99,102,241,0.12)', color: '#a5b4fc' }}>{p}</span>
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
        <button
          onClick={(e) => { e.stopPropagation(); handleToggleDelivered(d.id, d.delivered); }}
          style={{ ...styles.delivToggle, ...(delivered ? styles.delivToggleDone : {}) }}
        >
          {delivered ? '\u2713 Delivered' : 'Mark Delivered'}
        </button>
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
            ...(n > 0 ? { background: 'rgba(245,158,11,0.12)', color: '#f59e0b' } : { background: 'rgba(34,197,94,0.12)', color: '#4ade80' }) });
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
          <div style={{ flex: 1, minWidth: 0, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: '6px', padding: '7px 4px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, color: '#a5b4fc', marginBottom: '3px' }}>Mayday</div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }}>
              {maydayCount}{maydayLimit != null ? <span style={{ color: 'rgba(255,255,255,0.35)' }}>/{maydayLimit}</span> : null}
            </div>
            {maydayLimit != null && (
              <div style={{ marginTop: '6px', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: '2px', background: maydayCount >= maydayLimit ? '#22c55e' : '#6366f1', width: `${Math.min(100, maydayLimit > 0 ? (maydayCount / maydayLimit) * 100 : 0)}%`, transition: 'width 0.3s' }} />
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
              <button onClick={() => handleSaveSlotLimits(month)} style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: '5px', padding: '5px 10px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Save</button>
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
        case 'title': cmp = (a.title || '').localeCompare(b.title || ''); break;
        case 'sponsor': {
          const sA = `${a.sponsor_name || ''} ${a.campaign_name || ''}`;
          const sB = `${b.sponsor_name || ''} ${b.campaign_name || ''}`;
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
              style={{ accentColor: '#6366f1' }}
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
            <p style={styles.emptyText}>No upcoming deliverables. Add deliverables to campaigns above.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={thStyle} onClick={() => handleSort('title')}>Title{sortArrow('title')}</th>
                  <th style={thStyle} onClick={() => handleSort('sponsor')}>Sponsor{sortArrow('sponsor')}</th>
                  <th style={thStyle} onClick={() => handleSort('type')}>Type{sortArrow('type')}</th>
                  <th style={thStyle} onClick={() => handleSort('channel')}>Channel{sortArrow('channel')}</th>
                  <th style={thStyle} onClick={() => handleSort('schedule')}>Schedule{sortArrow('schedule')}</th>
                  <th style={styles.tableTh}>Beat Sheet</th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => handleSort('pay')}>Pay{sortArrow('pay')}</th>
                  <th style={styles.tableTh}>Brief</th>
                  <th style={styles.tableTh}>Delivered</th>
                </tr>
              </thead>
              <tbody>
                {tableDeliverables.map(d => {
                  const ev = d.video_event_id ? videoEvents.find(e => e.id === d.video_event_id) : null;
                  const linkedSheet = beatSheets.find(bs => bs.id === d.beat_sheet_id);
                  const isBSOpen = beatSheetDropdownId === d.id;
                  return (
                    <tr
                      key={d.id}
                      style={{ ...(d.delivered ? { opacity: 0.5 } : {}) }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setCardContextMenu({ x: e.clientX, y: e.clientY, deliverable: d });
                      }}
                    >
                      {/* Title */}
                      <td style={styles.tableTd}>
                        <span style={{ fontWeight: 600, color: 'rgba(255,255,255,0.9)', fontSize: '13px' }}>{d.title}</span>
                      </td>
                      {/* Sponsor */}
                      <td style={styles.tableTd}>
                        <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>
                          {d.sponsor_name}{d.campaign_name ? ` / ${d.campaign_name}` : ''}
                        </span>
                      </td>
                      {/* Type */}
                      <td style={styles.tableTd}>
                        <span title={DELIVERABLE_TYPES[d.deliverable_type]?.label || d.deliverable_type} style={{ fontSize: '16px' }}>
                          {DELIVERABLE_TYPES[d.deliverable_type]?.icon || '📋'}
                        </span>
                      </td>
                      {/* Channel */}
                      <td style={styles.tableTd}>
                        {d.channel && CHANNEL_COLORS[d.channel] && (
                          <span style={{ ...styles.chip, background: CHANNEL_COLORS[d.channel].bg, color: CHANNEL_COLORS[d.channel].color }}>
                            {CHANNEL_COLORS[d.channel].label}
                          </span>
                        )}
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
                      {/* Beat Sheet */}
                      <td style={{ ...styles.tableTd, position: 'relative' }}>
                        <span
                          style={{
                            ...styles.chip,
                            fontWeight: 600,
                            background: linkedSheet ? 'rgba(99,102,241,0.1)' : 'rgba(239,68,68,0.1)',
                            color: linkedSheet ? '#a5b4fc' : '#fca5a5',
                            cursor: 'pointer',
                          }}
                          onClick={(e) => { e.stopPropagation(); setBeatSheetDropdownId(isBSOpen ? null : d.id); }}
                        >
                          {linkedSheet ? linkedSheet.title : 'Unassigned'}
                        </span>
                        {isBSOpen && (
                          <div style={styles.inlineDropdown}>
                            {(() => {
                              const available = getAvailableBeatSheets(d.id);
                              if (available.length === 0) return <div style={styles.inlineDropdownEmpty}>No available beat sheets</div>;
                              return available.map(bs => (
                                <button
                                  key={bs.id}
                                  style={styles.inlineDropdownItem}
                                  onClick={(e) => { e.stopPropagation(); handleInlineAssignBeatSheet(d.id, bs.id); }}
                                >
                                  {bs.title}
                                </button>
                              ));
                            })()}
                            {linkedSheet && (
                              <button
                                style={{ ...styles.inlineDropdownItem, color: '#f87171', borderTop: '1px solid rgba(255,255,255,0.06)' }}
                                onClick={(e) => { e.stopPropagation(); handleInlineAssignBeatSheet(d.id, null); }}
                              >
                                Unlink beat sheet
                              </button>
                            )}
                          </div>
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
                      {/* Brief */}
                      <td style={styles.tableTd}>
                        {d.brief_url && (
                          <a href={d.brief_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ color: '#a5b4fc', textDecoration: 'none', fontSize: '14px' }} title={d.brief_name || 'Brief'}>
                            📄
                          </a>
                        )}
                      </td>
                      {/* Delivered */}
                      <td style={styles.tableTd}>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleToggleDelivered(d.id, d.delivered); }}
                          style={{ ...styles.delivToggle, ...(d.delivered ? styles.delivToggleDone : {}), padding: '3px 10px', fontSize: '11px' }}
                        >
                          {d.delivered ? '✓' : '—'}
                        </button>
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
    const monthEvents = videoEvents.filter(ev => ev.event_type === 'video_post' && ev.start_date && ev.start_date.slice(0, 7) === monthStr);

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
      const dayEvents = monthEvents.filter(ev => ev.start_date.slice(0, 10) === dateStr);
      const isToday = dateStr === todayStr;
      cells.push(
        <div key={day} style={{ ...styles.calendarDay, ...(isToday ? { border: '1px solid rgba(99,102,241,0.5)' } : {}) }}>
          <div style={{ fontSize: '11px', fontWeight: isToday ? 700 : 500, color: isToday ? '#818cf8' : 'rgba(255,255,255,0.4)', marginBottom: '4px' }}>{day}</div>
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
                  color: isLinkedToCurrent ? '#4ade80' : isLinkedToOther ? 'rgba(255,255,255,0.3)' : '#c084fc',
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
                    {isLinkedToCurrent && <div style={{ fontSize: '11px', color: '#4ade80', marginTop: '6px', fontWeight: 600 }}>Linked to this deliverable</div>}
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
      { color: '#4ade80', bg: 'rgba(34,197,94,0.2)', border: 'rgba(34,197,94,0.3)', label: 'Linked to this' },
      { color: 'rgba(255,255,255,0.3)', bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.06)', label: 'Taken' },
    ];

    return (
      <div style={styles.modalOverlay} onClick={() => setScheduleModalDeliverable(null)}>
        <div style={{ ...styles.modalBox, maxWidth: 1060, padding: '28px 32px' }} onClick={e => e.stopPropagation()}>
          <div style={styles.modalHeader}>
            <div>
              <h3 style={styles.modalTitle}>{d.title}</h3>
              <p style={styles.modalSubtitle}>{d.sponsor_name}{d.campaign_name ? ` / ${d.campaign_name}` : ''} — Select a video post to link</p>
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
                Currently linked: <span style={{ color: '#4ade80', fontWeight: 600 }}>📹 {new Date(currentLinkedEvent.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — {currentLinkedEvent.title}</span>
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
            <div style={styles.drawerOverlay} onClick={() => setProposalsDrawerOpen(false)}>
              <div style={styles.drawerPanel} onClick={e => e.stopPropagation()}>
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
              style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }}
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
                  style={{ alignSelf: 'flex-start', background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', border: '1px dashed rgba(99,102,241,0.4)', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                >
                  + Deliverable
                </button>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="submit" style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 14px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
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

      <div style={styles.topBar}>
        <div>
          <h1 style={styles.pageTitle}>Campaigns</h1>
          <p style={styles.pageSubtitle}>
            {activeCampaignsCount} active · {sortedCampaigns.length - activeCampaignsCount} inactive
          </p>
        </div>
        <button onClick={() => { resetCampaignForm(); setShowCampaignForm(!showCampaignForm); }} style={styles.addBtn}>
          {showCampaignForm && !editingCampaign ? '\u2715 Cancel' : '+ New Campaign'}
        </button>
      </div>

      {/* Campaign Form (modal) */}
      {showCampaignForm && (
        <Modal title={editingCampaign ? 'Edit Campaign' : 'New Campaign'} onClose={() => { resetCampaignForm(); setShowCampaignForm(false); }} maxWidth={680}>
        <form onSubmit={handleSaveCampaign}>
          <div style={styles.formGrid}>
            <div style={styles.field}>
              <label style={styles.label}>Brand *</label>
              <input
                value={campaignForm.brand}
                onChange={e => setCampaignForm({ ...campaignForm, brand: e.target.value })}
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
                <label style={styles.label}>Payment Status</label>
                <select value={campaignForm.payment_status} onChange={e => setCampaignForm({ ...campaignForm, payment_status: e.target.value })} style={styles.select}>
                  <option value="unpaid">Unpaid</option>
                  <option value="partial">Partial</option>
                  <option value="paid">Paid</option>
                </select>
              </div>
            )}
            <div style={styles.field}>
              <label style={styles.label}>Brief</label>
              <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                {['upload', 'link'].map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setBriefMode(m)}
                    style={{
                      flex: 1, padding: '4px 8px', borderRadius: '6px', border: '1px solid',
                      fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                      background: briefMode === m ? 'rgba(99,102,241,0.2)' : 'transparent',
                      color: briefMode === m ? '#a5b4fc' : 'rgba(255,255,255,0.35)',
                      borderColor: briefMode === m ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.08)',
                      textTransform: 'capitalize',
                    }}
                  >{m}</button>
                ))}
              </div>
              {briefMode === 'upload' ? (
                <input type="file" accept=".pdf,.docx,.doc" onChange={e => setBriefFile(e.target.files[0] || null)} style={{ ...styles.input, padding: '6px 8px' }} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <input type="url" value={briefLinkUrl} onChange={e => setBriefLinkUrl(e.target.value)} placeholder="https://..." style={styles.input} />
                  <input value={briefLinkLabel} onChange={e => setBriefLinkLabel(e.target.value)} placeholder="Label (optional)" style={styles.input} />
                </div>
              )}
            </div>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Description</label>
            <textarea value={campaignForm.description} onChange={e => setCampaignForm({ ...campaignForm, description: e.target.value })} placeholder="Campaign details..." rows={2} style={{ ...styles.input, resize: 'vertical' }} />
          </div>
          <button type="submit" style={styles.submitBtn}>{editingCampaign ? 'Update Campaign' : 'Create Campaign'}</button>
        </form>
        </Modal>
      )}

      {/* Campaign List */}
      {sponsorLoading ? (
        <p style={styles.emptyText}>Loading campaigns...</p>
      ) : sortedCampaigns.length === 0 ? (
        <div style={styles.emptyCard}>
          <p style={styles.emptyText}>No campaigns yet. Add one to get started.</p>
        </div>
      ) : (
        (() => {
          const renderCampaignCard = (campaign) => {
              const isExpanded = expandedCampaignId === campaign.id;
              const campaignDels = campaign.deliverables;
              const campDeliveredCount = campaignDels.filter(d => d.delivered).length;
              const campTotalPay = campaignDels.reduce((sum, d) => sum + (parseFloat(d.pay) || 0), 0);
              return (
                <div key={campaign.id} style={styles.sponsorCard}>
                  <div style={styles.sponsorCardHeader} onClick={() => setExpandedCampaignId(isExpanded ? null : campaign.id)}>
                    {/* Title / subtitle row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={styles.projectRowName}>{campaign.name}</div>
                        <div style={styles.projectRowMeta}>{campaign.brand}</div>
                      </div>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="rgba(255,255,255,0.3)"
                        style={{ flexShrink: 0, marginTop: '3px', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>
                        <path d="M4 6l4 4 4-4" />
                      </svg>
                    </div>
                    {/* Chips row */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                      {campaign.start_date && campaign.end_date && (
                        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>
                          {new Date(campaign.start_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(campaign.end_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                      {isAdmin && (
                        <span style={{ ...styles.statusTag, background: `${PAYMENT_STATUS_COLORS[campaign.payment_status]}15`, color: PAYMENT_STATUS_COLORS[campaign.payment_status] }}>
                          {campaign.payment_status}
                        </span>
                      )}
                      {!campaign.brief_url && (
                        <span
                          onClick={(e) => { e.stopPropagation(); openBriefModal(campaign); }}
                          style={{ ...styles.statusTag, background: 'rgba(245,158,11,0.12)', color: '#f59e0b', fontSize: '10px', fontWeight: 600, cursor: 'pointer' }}
                        >
                          + Add Brief
                        </span>
                      )}
                      {campaignDels.length > 0 && (
                        <span style={styles.checklistBadge}>{campDeliveredCount}/{campaignDels.length}</span>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={styles.projectDetail}>
                      {/* Campaign meta info */}
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '8px' }}>
                        {isAdmin && campTotalPay > 0 && (
                          <span style={{ ...styles.paymentBadge, background: `${PAYMENT_STATUS_COLORS[campaign.payment_status]}15`, color: PAYMENT_STATUS_COLORS[campaign.payment_status] }}>
                            ${campTotalPay.toLocaleString()}
                          </span>
                        )}
                        {(campaign.contact_name || campaign.contact_email) && (
                          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
                            {campaign.contact_name}{campaign.contact_email && ` (${campaign.contact_email})`}
                          </span>
                        )}
                        {campaign.brief_url && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <a href={campaign.brief_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '11px', color: '#a5b4fc', textDecoration: 'none' }}>
                              {'\u{1F4C4}'} {campaign.brief_name || 'Brief'}
                            </a>
                            <button onClick={() => handleRemoveBrief(campaign.id, campaign.brief_url)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: '10px', padding: '0 2px' }} title="Remove brief">{'\u2715'}</button>
                          </span>
                        )}
                      </div>
                      {campaign.description && (
                        <p style={{ margin: '0 0 8px', fontSize: '13px', color: 'rgba(255,255,255,0.5)', whiteSpace: 'pre-wrap' }}>{campaign.description}</p>
                      )}

                      {/* Deliverables (stacked cards) */}
                      {campaignDels.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
                          {campaignDels.map(d => renderDeliverableCard(d))}
                        </div>
                      )}

                      {/* Add Deliverable */}
                      <button
                        onClick={(e) => { e.stopPropagation(); resetDeliverableForm(); setDeliverableCampaignId(campaign.id); setShowDeliverableForm(campaign.id); }}
                        style={styles.addDeliverableBtn}
                      >
                        + Add Deliverable
                      </button>
                      {showDeliverableForm === campaign.id && (
                        <Modal title={editingDeliverable ? 'Edit Deliverable' : 'Add Deliverable'} subtitle={campaign.name} onClose={() => { resetDeliverableForm(); setShowDeliverableForm(null); }} maxWidth={680}>
                        <form onSubmit={(e) => handleSaveDeliverable(e, campaign.sponsor_id, campaign.id)}>
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
                            <div style={styles.field}>
                              <label style={styles.label}>Pay ($)</label>
                              <input type="number" step="0.01" value={deliverablePay} onChange={e => setDeliverablePay(e.target.value)} placeholder="0.00" style={styles.input} />
                            </div>
                            <div style={styles.field}>
                              <label style={styles.label}>Beat Sheet</label>
                              <select value={deliverableBeatSheetId} onChange={e => setDeliverableBeatSheetId(e.target.value)} style={styles.select}>
                                <option value="">None</option>
                                {beatSheets.map(bs => (
                                  <option key={bs.id} value={bs.id}>{bs.title}</option>
                                ))}
                              </select>
                            </div>
                            <div style={styles.field}>
                              <label style={styles.label}>Attached Video</label>
                              <select value={deliverableVideoEventId} onChange={e => setDeliverableVideoEventId(e.target.value)} style={styles.select}>
                                <option value="">None</option>
                                {videoEvents.map(ev => (
                                  <option key={ev.id} value={ev.id}>
                                    {'\uD83D\uDCF9'} {new Date(ev.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — {ev.title}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div style={styles.field}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <label style={styles.label}>Ad Copy</label>
                              <button
                                type="button"
                                disabled={!deliverableBeatSheetId || !deliverableNotes || pushingAdCopy}
                                onClick={handlePushAdCopyToBeatSheet}
                                style={{
                                  padding: '4px 10px',
                                  fontSize: '11px',
                                  borderRadius: '6px',
                                  border: '1px solid',
                                  borderColor: (!deliverableBeatSheetId || !deliverableNotes) ? 'rgba(255,255,255,0.1)' : 'rgba(99,102,241,0.4)',
                                  background: (!deliverableBeatSheetId || !deliverableNotes) ? 'rgba(255,255,255,0.03)' : 'rgba(99,102,241,0.15)',
                                  color: (!deliverableBeatSheetId || !deliverableNotes) ? 'rgba(255,255,255,0.25)' : '#a5b4fc',
                                  cursor: (!deliverableBeatSheetId || !deliverableNotes) ? 'not-allowed' : 'pointer',
                                  fontFamily: 'DM Sans, sans-serif',
                                  fontWeight: 500,
                                  transition: 'all 0.15s ease',
                                }}
                              >
                                {pushAdCopyDone ? 'Pushed!' : pushingAdCopy ? 'Pushing...' : 'Push to Beat Sheet'}
                              </button>
                            </div>
                            <textarea value={deliverableNotes} onChange={e => setDeliverableNotes(e.target.value)} placeholder="Ad copy, talking points, key messaging..." rows={2} style={{ ...styles.input, resize: 'vertical' }} />
                          </div>
                          <button type="submit" style={styles.submitBtn}>{editingDeliverable ? 'Update Deliverable' : 'Add Deliverable'}</button>
                        </form>
                        </Modal>
                      )}

                      {/* Campaign Actions */}
                      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                        <button onClick={() => startEditCampaign(campaign)} style={{ ...styles.filterBtn, fontSize: '12px' }}>Edit</button>
                        <button onClick={() => handleDeleteCampaign(campaign.id)} style={{ ...styles.filterBtn, fontSize: '12px', color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}>Delete</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            };
            const isAct = (c) => c.deliverables.length === 0 || c.deliverables.some(d => !d.delivered);
            const activeC = sortedCampaigns.filter(isAct);
            const inactiveC = sortedCampaigns.filter(c => !isAct(c));
            const section = (title, list, open, setOpen) => (
              <div style={{ marginBottom: '16px' }}>
                <button onClick={() => setOpen(v => !v)} style={styles.campaignSectionHeader}>
                  <span style={{ width: '12px', display: 'inline-block' }}>{open ? '▾' : '▸'}</span>
                  {title}
                  <span style={styles.checklistBadge}>{list.length}</span>
                </button>
                {open && (list.length > 0
                  ? <div style={{ ...styles.campaignGrid, marginTop: '12px' }}>{list.map(renderCampaignCard)}</div>
                  : <p style={{ ...styles.emptyText, marginTop: '8px' }}>No {title.toLowerCase()} campaigns.</p>)}
              </div>
            );
            return (
              <>
                {section('Active', activeC, campaignActiveOpen, setCampaignActiveOpen)}
                {section('Inactive', inactiveC, campaignInactiveOpen, setCampaignInactiveOpen)}
              </>
            );
          })()
      )}

      {/* Uncampaigned Deliverables (legacy) */}
      {uncampaignedDeliverables.length > 0 && (
        <details style={{ marginTop: '12px', padding: '0 4px' }}>
          <summary style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', cursor: 'pointer', userSelect: 'none' }}>
            {uncampaignedDeliverables.length} uncampaigned deliverable{uncampaignedDeliverables.length !== 1 ? 's' : ''}
          </summary>
          <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {isAdmin && (
              <button onClick={handleDeleteUncampaigned} style={{ alignSelf: 'flex-start', background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', marginBottom: '4px' }}>
                Delete All Uncampaigned
              </button>
            )}
            {uncampaignedDeliverables.map(d => renderDeliverableRow(d, sponsors.find(s => s.id === d.sponsor_id)))}
          </div>
        </details>
      )}

      {/* ── Upcoming Deliverables Table ── */}
      {renderDeliverableTable()}

      {/* Schedule Calendar Modal */}
      {renderScheduleCalendarModal()}

      {/* ====== ADD BRIEF MODAL ====== */}
      {briefModalCampaign && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }} onClick={() => setBriefModalCampaign(null)}>
          <div style={{ background: '#1a1a2e', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '440px', border: '1px solid rgba(255,255,255,0.1)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 600, color: '#fff' }}>Add Brief</h3>
            <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>{briefModalCampaign.name}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px', fontWeight: 600 }}>URL</label>
                <input
                  value={briefModalUrl}
                  onChange={e => setBriefModalUrl(e.target.value)}
                  placeholder="https://docs.google.com/..."
                  style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '13px', boxSizing: 'border-box' }}
                  autoFocus
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px', fontWeight: 600 }}>Label (optional)</label>
                <input
                  value={briefModalLabel}
                  onChange={e => setBriefModalLabel(e.target.value)}
                  placeholder="e.g. AG1 Brief"
                  style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '13px', boxSizing: 'border-box' }}
                  onKeyDown={e => { if (e.key === 'Enter') saveBriefModal(); }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
              <button onClick={() => setBriefModalCampaign(null)} style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', border: 'none', borderRadius: '6px', padding: '8px 16px', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveBriefModal} disabled={briefModalSaving} style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: briefModalSaving ? 0.5 : 1 }}>
                {briefModalSaving ? 'Saving...' : 'Save Brief'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context menu for upcoming deliverable cards */}
      {cardContextMenu && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
          onClick={() => setCardContextMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setCardContextMenu(null); }}
        >
          <div style={{ ...styles.contextMenu, top: cardContextMenu.y, left: cardContextMenu.x }} onClick={e => e.stopPropagation()}>
            <button
              style={styles.contextMenuItem}
              onClick={() => {
                const d = cardContextMenu.deliverable;
                if (d.campaign_id) setExpandedCampaignId(d.campaign_id);
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

      {/* Click-away for inline dropdowns */}
      {beatSheetDropdownId && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 49 }}
          onClick={() => setBeatSheetDropdownId(null)}
        />
      )}
    </div>
  );
}

function Modal({ title, subtitle, onClose, maxWidth = 640, children }) {
  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={{ ...styles.modalBox, maxWidth }} onClick={e => e.stopPropagation()}>
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

  // ── Campaign card grid (2 per row) ──
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
    background: 'rgba(99,102,241,0.15)', color: '#c7d2fe',
    border: '1px solid rgba(99,102,241,0.4)', borderRadius: '10px',
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
  campaignGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '14px',
    alignItems: 'start',
  },
  campaignSectionHeader: {
    display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '8px', padding: '8px 12px', cursor: 'pointer',
    color: 'rgba(255,255,255,0.85)', fontSize: '14px', fontWeight: 600, fontFamily: 'inherit',
  },

  // ── Deliverable cards (stacked inside a campaign / Upcoming grid) ──
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
    background: '#1e1e32', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px',
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
    background: '#1e1e32', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px',
    padding: '4px 0', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  inlineDropdownItem: {
    display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.8)',
    fontSize: '12px', fontFamily: 'inherit', padding: '7px 12px',
    textAlign: 'left', cursor: 'pointer',
  },
  inlineDropdownEmpty: {
    padding: '10px 12px', fontSize: '12px', color: 'rgba(255,255,255,0.3)', textAlign: 'center',
  },
  addDeliverableBtn: {
    width: '100%', padding: '8px', borderRadius: '8px',
    background: 'rgba(99,102,241,0.1)', color: '#a5b4fc',
    border: '1px dashed rgba(99,102,241,0.35)', cursor: 'pointer',
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
    background: '#1e1e32', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px',
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
    background: '#1a1a2e', borderRadius: '14px', padding: '24px',
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
