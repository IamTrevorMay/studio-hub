import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';

const DELIVERABLE_TYPES = {
  long_form_read: { label: 'Long Form Read', icon: '\u{1F4D6}' },
  live_read: { label: 'Live Read', icon: '\u{1F399}\uFE0F' },
  short_form_video: { label: 'Short Form Video', icon: '\u{1F4F1}' },
};
const DELIVERABLE_PLATFORMS = ['YouTube', 'TikTok', 'Instagram', 'X/Twitter', 'Facebook', 'Substack', 'Podcast'];
const SPONSOR_STATUS_COLORS = { active: '#10b981', completed: '#6366f1', cancelled: '#ef4444' };
const PAYMENT_STATUS_COLORS = { unpaid: '#ef4444', partial: '#f59e0b', paid: '#10b981' };
const CHANNEL_COLORS = {
  mayday: { bg: 'rgba(99,102,241,0.12)', color: '#a5b4fc', label: 'MD' },
  tmb: { bg: 'rgba(239,68,68,0.12)', color: '#fca5a5', label: 'TMB' },
  socials: { bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)', label: 'SOC' },
};

export default function Deliverables() {
  const { profile, isAdmin, refreshKey } = useAuth();
  const confirm = useConfirm();

  // Sponsors state
  const [sponsors, setSponsors] = useState([]);
  const [sponsorLoading, setSponsorLoading] = useState(false);
  const [expandedCampaignId, setExpandedCampaignId] = useState(null);
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

  const [allDeliverables, setAllDeliverables] = useState([]);
  const [expandedUpcomingId, setExpandedUpcomingId] = useState(null);
  const [editingAdCopy, setEditingAdCopy] = useState({});
  const [editingDueDate, setEditingDueDate] = useState({});

  // Proposals state
  const [proposals, setProposals] = useState([]);
  const [proposalsLoading, setProposalsLoading] = useState(false);
  const [showProposalForm, setShowProposalForm] = useState(false);
  const [proposalForm, setProposalForm] = useState({ sponsor_name: '', timeframe: '', num_videos_mayday: '', num_videos_tmb: '', pay_per_video_mayday: '', pay_per_video_tmb: '', description: '' });
  const [editingProposal, setEditingProposal] = useState(null);

  // Read Slots state
  const [slotLimits, setSlotLimits] = useState([]);
  const [editingSlots, setEditingSlots] = useState(null);
  const [slotDraft, setSlotDraft] = useState({ mayday: '', tmb: '' });
  const [showSlotHistory, setShowSlotHistory] = useState(false);

  // Beat sheets for deliverable linking
  const [beatSheets, setBeatSheets] = useState([]);

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
        .select('*, creator:profiles(id, full_name)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setProposals(data || []);
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
        .select('id, title, folder')
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

  // --- Proposal handlers ---
  function resetProposalForm() {
    setProposalForm({ sponsor_name: '', timeframe: '', num_videos_mayday: '', num_videos_tmb: '', pay_per_video_mayday: '', pay_per_video_tmb: '', description: '' });
    setEditingProposal(null);
    setShowProposalForm(false);
  }

  async function handleCreateProposal(e) {
    e.preventDefault();
    const { error } = await supabase.from('ad_read_proposals').insert({
      sponsor_name: proposalForm.sponsor_name,
      timeframe: proposalForm.timeframe || null,
      num_videos_mayday: proposalForm.num_videos_mayday ? parseInt(proposalForm.num_videos_mayday) : null,
      num_videos_tmb: proposalForm.num_videos_tmb ? parseInt(proposalForm.num_videos_tmb) : null,
      pay_per_video_mayday: proposalForm.pay_per_video_mayday ? parseFloat(proposalForm.pay_per_video_mayday) : null,
      pay_per_video_tmb: proposalForm.pay_per_video_tmb ? parseFloat(proposalForm.pay_per_video_tmb) : null,
      description: proposalForm.description || null,
      created_by: profile.id,
    });
    if (error) { alert('Error creating proposal: ' + error.message); return; }
    resetProposalForm();
    fetchProposals();
  }

  async function handleConfirmProposal(proposal) {
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

      const campaignPayload = {
        sponsor_id: sponsorId,
        name: proposal.sponsor_name + ' Campaign',
        description: proposal.description || null,
        payment_status: 'unpaid',
      };
      if (proposal.timeframe) {
        const match = proposal.timeframe.match(/^(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})$/);
        if (match) {
          campaignPayload.start_date = match[1];
          campaignPayload.end_date = match[2];
        }
      }
      const { error: cErr } = await supabase
        .from('sponsor_campaigns')
        .insert(campaignPayload);
      if (cErr) throw cErr;

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
    setProposalForm({
      sponsor_name: p.sponsor_name,
      timeframe: p.timeframe || '',
      num_videos_mayday: p.num_videos_mayday != null ? String(p.num_videos_mayday) : '',
      num_videos_tmb: p.num_videos_tmb != null ? String(p.num_videos_tmb) : '',
      pay_per_video_mayday: p.pay_per_video_mayday != null ? String(p.pay_per_video_mayday) : '',
      pay_per_video_tmb: p.pay_per_video_tmb != null ? String(p.pay_per_video_tmb) : '',
      description: p.description || '',
    });
    setShowProposalForm(true);
  }

  async function handleUpdateProposal(e) {
    e.preventDefault();
    const { error } = await supabase.from('ad_read_proposals').update({
      sponsor_name: proposalForm.sponsor_name,
      timeframe: proposalForm.timeframe || null,
      num_videos_mayday: proposalForm.num_videos_mayday ? parseInt(proposalForm.num_videos_mayday) : null,
      num_videos_tmb: proposalForm.num_videos_tmb ? parseInt(proposalForm.num_videos_tmb) : null,
      pay_per_video_mayday: proposalForm.pay_per_video_mayday ? parseFloat(proposalForm.pay_per_video_mayday) : null,
      pay_per_video_tmb: proposalForm.pay_per_video_tmb ? parseFloat(proposalForm.pay_per_video_tmb) : null,
      description: proposalForm.description || null,
    }).eq('id', editingProposal);
    if (error) { alert('Error updating proposal: ' + error.message); return; }
    setEditingProposal(null);
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

  async function handleDeleteCampaign(campaignId) {
    if (!(await confirm('Delete this campaign? Deliverables will be uncampaigned.'))) return;
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
  const resolvedProposals = proposals.filter(p => p.status !== 'pending');

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

  return (
    <div style={styles.page}>
      {/* ── Proposals + Read Slots side-by-side ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', padding: '0 24px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: '16px', alignItems: 'flex-start' }}>

        {/* ── Proposals column ── */}
        <div>
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
            <form onSubmit={editingProposal ? handleUpdateProposal : handleCreateProposal} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '16px', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <input value={proposalForm.sponsor_name} onChange={e => setProposalForm(f => ({ ...f, sponsor_name: e.target.value }))} placeholder="Brand Name *" required style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '13px' }} />
                <input value={proposalForm.timeframe} onChange={e => setProposalForm(f => ({ ...f, timeframe: e.target.value }))} placeholder="Time Frame" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '13px' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '10px' }}>
                <input type="number" value={proposalForm.num_videos_mayday} onChange={e => setProposalForm(f => ({ ...f, num_videos_mayday: e.target.value }))} placeholder="# Mayday Vids" min="0" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '13px' }} />
                <input type="number" value={proposalForm.pay_per_video_mayday} onChange={e => setProposalForm(f => ({ ...f, pay_per_video_mayday: e.target.value }))} placeholder="$/Mayday Vid" min="0" step="any" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '13px' }} />
                <input type="number" value={proposalForm.num_videos_tmb} onChange={e => setProposalForm(f => ({ ...f, num_videos_tmb: e.target.value }))} placeholder="# TMB Vids" min="0" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '13px' }} />
                <input type="number" value={proposalForm.pay_per_video_tmb} onChange={e => setProposalForm(f => ({ ...f, pay_per_video_tmb: e.target.value }))} placeholder="$/TMB Vid" min="0" step="any" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '13px' }} />
              </div>
              <textarea value={proposalForm.description} onChange={e => setProposalForm(f => ({ ...f, description: e.target.value }))} placeholder="Description / notes" rows={2} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '8px 10px', color: '#fff', fontSize: '13px', resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="submit" style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 14px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                  {editingProposal ? 'Update Proposal' : 'Submit Proposal'}
                </button>
                {editingProposal && (
                  <button type="button" onClick={resetProposalForm} style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', border: 'none', borderRadius: '6px', padding: '8px 14px', fontSize: '13px', cursor: 'pointer' }}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          )}

          {/* Pending proposals */}
          {proposalsLoading && pendingProposals.length === 0 ? (
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px' }}>Loading...</p>
          ) : pendingProposals.length === 0 ? (
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px', margin: '4px 0' }}>No pending proposals</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '8px' }}>
              {pendingProposals.map(p => {
                const maydayTotal = (p.num_videos_mayday || 0) * (p.pay_per_video_mayday || 0);
                const tmbTotal = (p.num_videos_tmb || 0) * (p.pay_per_video_tmb || 0);
                const totalPay = maydayTotal + tmbTotal;
                return (
                  <div key={p.id} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '14px', borderLeft: '3px solid #f59e0b' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <div style={{ fontWeight: 600, fontSize: '14px', color: '#fff' }}>{p.sponsor_name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {p.timeframe && <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', padding: '2px 8px' }}>{p.timeframe}</span>}
                        <button onClick={() => startEditProposal(p)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: '12px', padding: '2px 4px' }} title="Edit">{'\u270E'}</button>
                        <button onClick={() => handleDeleteProposal(p.id)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: '12px', padding: '2px 4px' }} title="Delete">{'\u2715'}</button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
                      {(p.num_videos_mayday || p.pay_per_video_mayday) ? (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', padding: '8px 10px' }}>
                          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>Mayday</div>
                          <div style={{ display: 'flex', gap: '12px', fontSize: '12px' }}>
                            {p.num_videos_mayday != null && <span style={{ color: 'rgba(255,255,255,0.6)' }}>{p.num_videos_mayday} video{p.num_videos_mayday !== 1 ? 's' : ''}</span>}
                            {p.pay_per_video_mayday != null && <span style={{ color: 'rgba(255,255,255,0.5)' }}>${Number(p.pay_per_video_mayday).toLocaleString()} / vid</span>}
                            {maydayTotal > 0 && <span style={{ color: '#22c55e', fontWeight: 600 }}>${maydayTotal.toLocaleString()}</span>}
                          </div>
                        </div>
                      ) : null}
                      {(p.num_videos_tmb || p.pay_per_video_tmb) ? (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', padding: '8px 10px' }}>
                          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>TM Baseball</div>
                          <div style={{ display: 'flex', gap: '12px', fontSize: '12px' }}>
                            {p.num_videos_tmb != null && <span style={{ color: 'rgba(255,255,255,0.6)' }}>{p.num_videos_tmb} video{p.num_videos_tmb !== 1 ? 's' : ''}</span>}
                            {p.pay_per_video_tmb != null && <span style={{ color: 'rgba(255,255,255,0.5)' }}>${Number(p.pay_per_video_tmb).toLocaleString()} / vid</span>}
                            {tmbTotal > 0 && <span style={{ color: '#22c55e', fontWeight: 600 }}>${tmbTotal.toLocaleString()}</span>}
                          </div>
                        </div>
                      ) : null}
                    </div>
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
                  const rTotal = ((p.num_videos_mayday || 0) * (p.pay_per_video_mayday || 0)) + ((p.num_videos_tmb || 0) * (p.pay_per_video_tmb || 0));
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

        {/* ── Read Slots column ── */}
        <div>
          <h2 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>Read Slots</h2>
          {(() => {
            const now = new Date();
            const buildMonth = (offset) => {
              const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
              return d.toISOString().slice(0, 7);
            };
            const months = [buildMonth(0), buildMonth(1), buildMonth(2)];
            const formatMonth = (m) => {
              const [y, mo] = m.split('-');
              return new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            };
            const getCount = (month, channel) => allDeliverables.filter(d => d.channel === channel && d.due_date && d.due_date.slice(0, 7) === month).length;
            const getLimit = (month, channel) => {
              const row = slotLimits.find(s => s.month === month && s.channel === channel);
              return row ? row.slot_limit : null;
            };

            const renderMonthCard = (month) => {
              const maydayCount = getCount(month, 'mayday');
              const tmbCount = getCount(month, 'tmb');
              const maydayLimit = getLimit(month, 'mayday');
              const tmbLimit = getLimit(month, 'tmb');
              const isEditing = editingSlots === month;

              return (
                <div key={month} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '14px', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <div style={{ fontWeight: 600, fontSize: '13px', color: 'rgba(255,255,255,0.9)' }}>{formatMonth(month)}</div>
                    {isAdmin && !isEditing && (
                      <button
                        onClick={() => { setEditingSlots(month); setSlotDraft({ mayday: maydayLimit != null ? String(maydayLimit) : '', tmb: tmbLimit != null ? String(tmbLimit) : '' }); }}
                        style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: '11px', cursor: 'pointer', padding: '2px 6px' }}
                      >
                        Set Limits
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    {/* Mayday card */}
                    <div style={{ flex: 1, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: '6px', padding: '10px 12px', textAlign: 'center' }}>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: '#a5b4fc', marginBottom: '6px' }}>Mayday</div>
                      <div style={{ fontSize: '20px', fontWeight: 700, color: '#fff' }}>
                        {maydayCount}{maydayLimit != null ? <span style={{ color: 'rgba(255,255,255,0.35)' }}>/{maydayLimit}</span> : null}
                      </div>
                      {maydayLimit != null && (
                        <div style={{ marginTop: '6px', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: '2px', background: maydayCount >= maydayLimit ? '#22c55e' : '#6366f1', width: `${Math.min(100, maydayLimit > 0 ? (maydayCount / maydayLimit) * 100 : 0)}%`, transition: 'width 0.3s' }} />
                        </div>
                      )}
                    </div>

                    {/* TMB card */}
                    <div style={{ flex: 1, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: '6px', padding: '10px 12px', textAlign: 'center' }}>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: '#fca5a5', marginBottom: '6px' }}>TM Baseball</div>
                      <div style={{ fontSize: '20px', fontWeight: 700, color: '#fff' }}>
                        {tmbCount}{tmbLimit != null ? <span style={{ color: 'rgba(255,255,255,0.35)' }}>/{tmbLimit}</span> : null}
                      </div>
                      {tmbLimit != null && (
                        <div style={{ marginTop: '6px', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: '2px', background: tmbCount >= tmbLimit ? '#22c55e' : '#ef4444', width: `${Math.min(100, tmbLimit > 0 ? (tmbCount / tmbLimit) * 100 : 0)}%`, transition: 'width 0.3s' }} />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Inline edit for limits */}
                  {isEditing && (
                    <div style={{ marginTop: '10px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <input type="number" value={slotDraft.mayday} onChange={e => setSlotDraft(d => ({ ...d, mayday: e.target.value }))} placeholder="Mayday limit" min="0" style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '6px 8px', color: '#fff', fontSize: '12px' }} />
                      <input type="number" value={slotDraft.tmb} onChange={e => setSlotDraft(d => ({ ...d, tmb: e.target.value }))} placeholder="TMB limit" min="0" style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '6px 8px', color: '#fff', fontSize: '12px' }} />
                      <button onClick={() => handleSaveSlotLimits(month)} style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: '5px', padding: '5px 10px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Save</button>
                      <button onClick={() => setEditingSlots(null)} style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', border: 'none', borderRadius: '5px', padding: '5px 8px', fontSize: '12px', cursor: 'pointer' }}>{'\u2715'}</button>
                    </div>
                  )}
                </div>
              );
            };

            // Past months for history
            const pastMonths = [];
            for (let i = 1; i <= 12; i++) {
              const pm = buildMonth(-i);
              const hasMayday = getCount(pm, 'mayday') > 0 || getLimit(pm, 'mayday') != null;
              const hasTmb = getCount(pm, 'tmb') > 0 || getLimit(pm, 'tmb') != null;
              if (hasMayday || hasTmb) pastMonths.push(pm);
            }

            return (
              <>
                {months.map(renderMonthCard)}
                {pastMonths.length > 0 && (
                  <div style={{ marginTop: '4px' }}>
                    <button onClick={() => setShowSlotHistory(v => !v)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: '12px', cursor: 'pointer', padding: '4px 0' }}>
                      {showSlotHistory ? 'Hide History' : 'History'}
                    </button>
                    {showSlotHistory && (
                      <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {pastMonths.map(pm => {
                          const mc = getCount(pm, 'mayday');
                          const tc = getCount(pm, 'tmb');
                          const ml = getLimit(pm, 'mayday');
                          const tl = getLimit(pm, 'tmb');
                          return (
                            <div key={pm} style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px', color: 'rgba(255,255,255,0.5)', padding: '6px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px' }}>
                              <span style={{ fontWeight: 500, color: 'rgba(255,255,255,0.7)', minWidth: '120px' }}>{formatMonth(pm)}</span>
                              <span style={{ color: '#a5b4fc' }}>MD: {mc}{ml != null ? `/${ml}` : ''}</span>
                              <span style={{ color: '#fca5a5' }}>TMB: {tc}{tl != null ? `/${tl}` : ''}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
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

      {/* Campaign Form (top-level) */}
      {showCampaignForm && (
        <form onSubmit={handleSaveCampaign} style={styles.formCard}>
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
      )}

      {/* Campaign List */}
      {sponsorLoading ? (
        <p style={styles.emptyText}>Loading campaigns...</p>
      ) : sortedCampaigns.length === 0 ? (
        <div style={styles.emptyCard}>
          <p style={styles.emptyText}>No campaigns yet. Add one to get started.</p>
        </div>
      ) : (
        <div style={styles.projectList}>
          {sortedCampaigns.map(campaign => {
              const isExpanded = expandedCampaignId === campaign.id;
              const campaignDels = campaign.deliverables;
              const allDeliveredCamp = campaignDels.length > 0 && campaignDels.every(d => d.delivered);
              const isActive = campaignDels.length === 0 || campaignDels.some(d => !d.delivered);
              const campDeliveredCount = campaignDels.filter(d => d.delivered).length;
              const campTotalPay = campaignDels.reduce((sum, d) => sum + (parseFloat(d.pay) || 0), 0);
              return (
                <div key={campaign.id} style={styles.sponsorCard}>
                  <div style={styles.sponsorCardHeader} onClick={() => setExpandedCampaignId(isExpanded ? null : campaign.id)}>
                    <div style={styles.projectRowLeft}>
                      <div>
                        <div style={styles.projectRowName}>{campaign.name}</div>
                        <div style={styles.projectRowMeta}>{campaign.brand}</div>
                      </div>
                    </div>
                    <div style={styles.projectRowRight}>
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
                      <span style={{ ...styles.statusTag, background: isActive ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)', color: isActive ? '#10b981' : 'rgba(255,255,255,0.4)' }}>
                        {isActive ? 'Active' : 'Inactive'}
                      </span>
                      {campaignDels.length > 0 && (
                        <span style={styles.checklistBadge}>{campDeliveredCount}/{campaignDels.length}</span>
                      )}
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="rgba(255,255,255,0.3)"
                        style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>
                        <path d="M4 6l4 4 4-4" />
                      </svg>
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

                      {/* Deliverables */}
                      {campaignDels.length > 0 && <div style={{ marginBottom: '8px' }}>{campaignDels.map(d => renderDeliverableRow(d, sponsors.find(s => s.id === campaign.sponsor_id)))}</div>}

                      {/* Add Deliverable */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); resetDeliverableForm(); setDeliverableCampaignId(campaign.id); setShowDeliverableForm(showDeliverableForm === campaign.id ? null : campaign.id); }}
                          style={{ background: 'none', border: 'none', color: '#a5b4fc', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
                        >
                          {showDeliverableForm === campaign.id && !editingDeliverable ? '\u2715 Cancel' : '+ Add Deliverable'}
                        </button>
                      </div>
                      {showDeliverableForm === campaign.id && (
                        <form onSubmit={(e) => handleSaveDeliverable(e, campaign.sponsor_id, campaign.id)} style={{ ...styles.formCard, marginTop: '8px' }}>
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
                            <label style={styles.label}>Ad Copy</label>
                            <textarea value={deliverableNotes} onChange={e => setDeliverableNotes(e.target.value)} placeholder="Ad copy, talking points, key messaging..." rows={2} style={{ ...styles.input, resize: 'vertical' }} />
                          </div>
                          <button type="submit" style={styles.submitBtn}>{editingDeliverable ? 'Update Deliverable' : 'Add Deliverable'}</button>
                        </form>
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
            })}
          </div>
      )}

      {/* Uncampaigned Deliverables (legacy) */}
      {uncampaignedDeliverables.length > 0 && (
        <details style={{ marginTop: '12px', padding: '0 4px' }}>
          <summary style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', cursor: 'pointer', userSelect: 'none' }}>
            {uncampaignedDeliverables.length} uncampaigned deliverable{uncampaignedDeliverables.length !== 1 ? 's' : ''}
          </summary>
          <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {uncampaignedDeliverables.map(d => renderDeliverableRow(d, sponsors.find(s => s.id === d.sponsor_id)))}
          </div>
        </details>
      )}
        </div>

      {/* ====== UPCOMING AD READS SECTION ====== */}
      {(() => {
        const upcomingReads = allDeliverables
          .filter(d => !d.delivered)
          .sort((a, b) => {
            if (!a.due_date && !b.due_date) return 0;
            if (!a.due_date) return 1;
            if (!b.due_date) return -1;
            return a.due_date.localeCompare(b.due_date);
          });
        const totalPay = upcomingReads.reduce((sum, d) => sum + (parseFloat(d.pay) || 0), 0);
        return (
          <div style={{ minWidth: 0 }}>
            <div style={styles.topBar}>
              <div>
                <h1 style={styles.pageTitle}>Upcoming Deliverables</h1>
                <p style={styles.pageSubtitle}>
                  {upcomingReads.length} deliverable{upcomingReads.length !== 1 ? 's' : ''}
                  {totalPay > 0 ? ` · $${totalPay.toLocaleString()} total` : ''}
                </p>
              </div>
            </div>

            {upcomingReads.length === 0 ? (
              <div style={styles.emptyCard}>
                <p style={styles.emptyText}>No upcoming deliverables. Add deliverables to sponsors above.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {upcomingReads.map(d => {
                  const linkedSheet = beatSheets.find(bs => bs.id === d.beat_sheet_id);
                  const isExpanded = expandedUpcomingId === d.id;
                  return (
                    <div key={d.id} style={{ borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', minWidth: 0, overflow: 'hidden' }}>
                      {/* Collapsed header row */}
                      <div
                        onClick={() => {
                          if (isExpanded) {
                            setExpandedUpcomingId(null);
                          } else {
                            setExpandedUpcomingId(d.id);
                            setEditingAdCopy(prev => ({ ...prev, [d.id]: d.notes || '' }));
                            setEditingDueDate(prev => ({ ...prev, [d.id]: d.due_date ? d.due_date.slice(0, 7) : '' }));
                          }
                        }}
                        style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', cursor: 'pointer', minWidth: 0 }}
                      >
                        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0 }}>&#9654;</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff', marginBottom: '2px' }}>{d.title}</div>
                          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                            <span>{d.sponsor_name}</span>
                            {d.campaign_name && <><span style={{ opacity: 0.4 }}>/</span><span>{d.campaign_name}</span></>}
                            {d.due_date && <><span style={{ opacity: 0.4 }}>/</span><span>{new Date(d.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span></>}
                            {d.brief_url && (
                              <a href={d.brief_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: '11px', color: '#a5b4fc', textDecoration: 'none' }}>
                                {'\u{1F4C4}'} {d.brief_name || 'Campaign Brief'}
                              </a>
                            )}
                          </div>
                        </div>
                        {d.pay != null && (
                          <span style={{ fontSize: '13px', fontWeight: 600, color: '#22c55e', whiteSpace: 'nowrap' }}>
                            ${parseFloat(d.pay).toLocaleString()}
                          </span>
                        )}
                        {d.channel && CHANNEL_COLORS[d.channel] && (
                          <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '5px', whiteSpace: 'nowrap', background: CHANNEL_COLORS[d.channel].bg, color: CHANNEL_COLORS[d.channel].color }}>
                            {CHANNEL_COLORS[d.channel].label}
                          </span>
                        )}
                        {(() => {
                          const ev = d.video_event_id ? videoEvents.find(e => e.id === d.video_event_id) : null;
                          if (ev) return (
                            <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '5px', whiteSpace: 'nowrap', background: 'rgba(168,85,247,0.12)', color: '#c084fc' }}>
                              {'\uD83D\uDCF9'} {ev.title?.length > 16 ? ev.title.slice(0, 16) + '\u2026' : ev.title}
                            </span>
                          );
                          return null;
                        })()}
                        <span style={{
                          fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '6px', whiteSpace: 'nowrap',
                          background: linkedSheet ? 'rgba(99,102,241,0.1)' : 'rgba(239,68,68,0.1)',
                          color: linkedSheet ? '#a5b4fc' : '#fca5a5',
                        }}>
                          {linkedSheet ? linkedSheet.title : 'Unassigned'}
                        </span>
                      </div>

                      {/* Expanded detail panel */}
                      {isExpanded && (
                        <div style={{ padding: '0 14px 12px 36px', display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                          <div style={{ paddingTop: '10px' }}>
                            <label style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px', display: 'block' }}>Ad Copy</label>
                            <textarea
                              value={editingAdCopy[d.id] ?? ''}
                              onChange={e => setEditingAdCopy(prev => ({ ...prev, [d.id]: e.target.value }))}
                              onBlur={async () => {
                                const newVal = (editingAdCopy[d.id] ?? '').trim() || null;
                                if (newVal === (d.notes || null)) return;
                                await supabase.from('sponsor_deliverables').update({ notes: newVal, updated_at: new Date().toISOString() }).eq('id', d.id);
                                fetchSponsors();
                              }}
                              placeholder="Ad copy, talking points, key messaging..."
                              rows={3}
                              style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '8px 10px', color: '#fff', fontSize: '13px', fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px', display: 'block' }}>Due Month</label>
                            <input
                              type="month"
                              value={editingDueDate[d.id] ?? ''}
                              onChange={async (e) => {
                                const newDate = e.target.value ? e.target.value + '-01' : null;
                                setEditingDueDate(prev => ({ ...prev, [d.id]: e.target.value }));
                                await supabase.from('sponsor_deliverables').update({ due_date: newDate, updated_at: new Date().toISOString() }).eq('id', d.id);
                                fetchSponsors();
                              }}
                              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '6px 10px', color: '#fff', fontSize: '13px', fontFamily: 'inherit', outline: 'none', colorScheme: 'dark' }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}
      </div>

      {/* ====== MONEY SECTION ====== */}
      {(() => {
        const allCampaigns = sponsors.flatMap(s => s.sponsor_campaigns || []);
        const campaignTotals = new Map(
          allCampaigns.map(c => [
            c.id,
            allDeliverables
              .filter(d => d.campaign_id === c.id)
              .reduce((sum, d) => sum + (parseFloat(d.pay) || 0), 0),
          ])
        );
        const totalDeal = Array.from(campaignTotals.values()).reduce((sum, v) => sum + v, 0);
        const totalPaid = allCampaigns
          .filter(c => c.payment_status === 'paid')
          .reduce((sum, c) => sum + (campaignTotals.get(c.id) || 0), 0);
        const totalOwed = totalDeal - totalPaid;
        const upcomingValue = allDeliverables
          .filter(d => !d.delivered)
          .reduce((sum, d) => sum + (parseFloat(d.pay) || 0), 0);
        const lateCampaigns = allCampaigns.filter(campaign => {
          const campaignDels = allDeliverables.filter(d => d.campaign_id === campaign.id);
          const allDel = campaignDels.length > 0 && campaignDels.every(d => d.delivered);
          return allDel && campaign.payment_status !== 'paid';
        });
        const lateValue = lateCampaigns.reduce((sum, c) => sum + (campaignTotals.get(c.id) || 0), 0);
        if (totalDeal === 0) return null;
        return (
          <div style={{ marginTop: '40px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '24px' }}>
            <div style={{ marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#fff' }}>Money</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px' }}>
              {[
                { label: 'Total Deal Value', value: totalDeal, color: '#6366f1' },
                { label: 'Total Paid', value: totalPaid, color: '#22c55e' },
                { label: 'Total Owed', value: totalOwed, color: totalOwed > 0 ? '#f59e0b' : '#22c55e' },
                { label: 'Upcoming', value: upcomingValue, color: '#6366f1' },
                { label: 'Late', value: lateValue, color: lateValue > 0 ? '#ef4444' : '#22c55e' },
              ].map(card => (
                <div key={card.label} style={{
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '14px', padding: '20px 24px', position: 'relative', overflow: 'hidden',
                }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, width: '3px', height: '100%', background: card.color }} />
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>{card.label}</div>
                  <div style={{ fontSize: '28px', fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
                    ${card.value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

const styles = {
  page: { padding: '32px 40px' },
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
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px',
    cursor: 'pointer',
    gap: '12px',
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
};
