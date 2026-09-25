import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { toast } from '../contexts/ToastContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import { mobileTokens } from '../utils/mobileTokens';
import { clickableKeyProps } from '../lib/styleRecipes';
import { colors } from '../lib/styleTokens';
import FullScreenSheet from '../components/mobile/FullScreenSheet';
import BottomSheet from '../components/mobile/BottomSheet';

// Mirrors desktop Deliverables.js DELIVERABLE_TYPES (labels only — no glyphs on mobile).
const DELIVERABLE_TYPES = {
  long_form_read: { label: 'Long Form Read' },
  live_read: { label: 'Live Read' },
  short_form_video: { label: 'Short Form Video' },
};
// Mirrors desktop DELIVERABLE_PLATFORMS.
const DELIVERABLE_PLATFORMS = ['YouTube', 'TikTok', 'Instagram', 'X/Twitter', 'Facebook', 'Substack', 'Podcast'];
const CHANNEL_OPTIONS = [
  { value: 'mayday', label: 'Mayday' },
  { value: 'tmb', label: 'Trevor May Baseball' },
  { value: 'socials', label: 'Socials' },
];
const CHANNEL_COLORS = {
  mayday: { bg: 'rgba(91, 143, 199,0.12)', color: '#8fb4d8', label: 'MD' },
  tmb: { bg: 'rgba(239,68,68,0.12)', color: '#fca5a5', label: 'TMB' },
  socials: { bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)', label: 'SOC' },
};
// Mirrors desktop REVIEW_STATUS_OPTIONS.
const REVIEW_STATUS_OPTIONS = [
  { value: 'queued', label: 'Queued', bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.55)' },
  { value: 'writing', label: 'Writing', bg: 'rgba(91, 143, 199,0.15)', color: '#8fb4d8' },
  { value: 'filming', label: 'Filming', bg: 'rgba(168,85,247,0.15)', color: '#c084fc' },
  { value: 'ready_for_review', label: 'Ready for Review', bg: 'rgba(245,158,11,0.15)', color: '#fbbf24' },
  { value: 'in_review', label: 'In Review', bg: 'rgba(14,165,233,0.15)', color: '#38bdf8' },
  { value: 'complete', label: 'Complete', bg: 'rgba(34,197,94,0.15)', color: '#22c55e' },
];
const REVIEW_STATUS_BY_VALUE = REVIEW_STATUS_OPTIONS.reduce((acc, o) => { acc[o.value] = o; return acc; }, {});

const EMPTY_FORM = {
  deliverable_type: 'long_form_read',
  channel: '',
  due_month: '',
  review_due: '',
  platforms: [],
  needs_review: false,
  review_status: 'queued',
  pay: '',
  video_event_id: '',
  video_url: '',
  ad_copy: '',
};

function isHttpUrl(value) {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

export default function DeliverablesMobile() {
  const { profile, refreshKey } = useAuth();
  const [sponsors, setSponsors] = useState([]);
  const [allDeliverables, setAllDeliverables] = useState([]);
  const [videoEvents, setVideoEvents] = useState([]);
  const [beatSheets, setBeatSheets] = useState([]);
  const [slotLimits, setSlotLimits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [showDelivered, setShowDelivered] = useState(false);

  // Edit sheet
  const [editing, setEditing] = useState(null); // deliverable row being edited
  const [form, setForm] = useState(EMPTY_FORM);
  const [adCopyDirty, setAdCopyDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Mark-delivered sheet
  const [deliverTarget, setDeliverTarget] = useState(null);
  const [deliverUrl, setDeliverUrl] = useState('');
  const [deliverError, setDeliverError] = useState('');
  const [delivering, setDelivering] = useState(false);

  const fetchSponsors = useCallback(async () => {
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
          const brand = (s.sponsor_campaigns || []).find(c => c.id === d.campaign_id);
          flat.push({ ...d, sponsor_name: s.name, sponsor_id: s.id, brand_name: brand?.name || null, brief_url: brand?.brief_url || null, brief_name: brand?.brief_name || null });
        });
      });
      setAllDeliverables(flat);
    } catch (err) {
      console.error('Error fetching sponsors:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchVideoEvents = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('calendar_events')
        .select('*')
        .in('event_type', ['video_post', 'tmbb_video'])
        .order('start_date', { ascending: true });
      if (!error) setVideoEvents(data || []);
    } catch (err) { /* ignore */ }
  }, []);

  const fetchSlotLimits = useCallback(async () => {
    const { data } = await supabase
      .from('read_slot_limits')
      .select('*')
      .order('month', { ascending: true });
    setSlotLimits(data || []);
  }, []);

  useEffect(() => {
    fetchSponsors();
    fetchVideoEvents();
    fetchSlotLimits();
    (async () => {
      const { data } = await supabase.from('beat_sheets').select('id, title, folder').order('created_at', { ascending: false });
      setBeatSheets(data || []);
    })();
  }, [fetchSponsors, fetchVideoEvents, fetchSlotLimits]);

  useEffect(() => {
    const channel = supabase
      .channel('sponsors-mobile')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sponsors' }, () => fetchSponsors())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sponsor_deliverables' }, () => fetchSponsors())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sponsor_campaigns' }, () => fetchSponsors())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchSponsors, refreshKey]);

  useVisibilityRefresh(fetchSponsors);

  // Same rollup desktop runs after every deliverable save (Deliverables.js syncBrandRevenue):
  // a paid campaign's total deliverable pay is mirrored into one revenue_events row.
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

  // --- Edit sheet ---
  async function openEdit(d) {
    // Seed ad copy from the DB, not the realtime-refreshed list (same reason as desktop:
    // the list can lag an autosave and a stale seed would overwrite real copy on save).
    let src = d;
    const { data: fresh } = await supabase
      .from('sponsor_deliverables')
      .select('ad_copy, notes')
      .eq('id', d.id)
      .maybeSingle();
    if (fresh) src = { ...d, ...fresh };
    setForm({
      deliverable_type: d.deliverable_type || 'long_form_read',
      channel: d.channel || '',
      due_month: d.due_date ? d.due_date.slice(0, 7) : '',
      review_due: d.review_due || '',
      platforms: d.platforms || [],
      needs_review: !!d.needs_review,
      review_status: d.review_status || 'queued',
      pay: d.pay != null ? String(d.pay) : '',
      video_event_id: d.video_event_id || '',
      video_url: d.video_url || '',
      ad_copy: src.ad_copy || src.notes || '',
    });
    setAdCopyDirty(false);
    setEditing(d);
  }

  function closeEdit() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setAdCopyDirty(false);
  }

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function togglePlatform(p) {
    setForm(prev => ({
      ...prev,
      platforms: prev.platforms.includes(p) ? prev.platforms.filter(x => x !== p) : [...prev.platforms, p],
    }));
  }

  // Mirrors the update branch of desktop handleSaveDeliverable (Deliverables.js:681).
  async function handleSaveEdit(e) {
    if (e) e.preventDefault();
    if (!editing || saving) return;
    const videoUrl = form.video_url.trim();
    if (videoUrl && !isHttpUrl(videoUrl)) {
      toast.error('Video link must start with http:// or https://');
      return;
    }
    setSaving(true);
    try {
      const sponsor = sponsors.find(s => s.id === editing.sponsor_id);
      const typeLabel = DELIVERABLE_TYPES[form.deliverable_type]?.label || form.deliverable_type;
      const autoTitle = `${typeLabel} — ${sponsor?.name || 'Sponsor'}`;
      const dueDateFull = form.due_month ? form.due_month + '-01' : null;
      const campaignId = editing.campaign_id || null;

      const { error } = await supabase.from('sponsor_deliverables').update({
        title: autoTitle,
        deliverable_type: form.deliverable_type,
        due_date: dueDateFull,
        ...(adCopyDirty ? { ad_copy: form.ad_copy || null } : {}),
        platforms: form.platforms,
        needs_review: form.needs_review,
        campaign_id: campaignId,
        pay: form.pay ? parseFloat(form.pay) : null,
        video_event_id: form.video_event_id || null,
        channel: form.channel || null,
        review_status: form.review_status || 'queued',
        video_url: videoUrl || null,
        delivered: !!videoUrl,
        review_due: form.review_due || null,
        updated_at: new Date().toISOString(),
      }).eq('id', editing.id);
      if (error) { toast.error('Error updating deliverable: ' + error.message); return; }

      // Keep the sponsor calendar event in step with the due month (create / move / remove).
      const evTitle = `\u{1F91D} ${sponsor?.name}: ${typeLabel}`;
      if (dueDateFull && editing.calendar_event_id) {
        await supabase.from('calendar_events').update({
          title: evTitle,
          start_date: `${dueDateFull}T09:00:00`,
          end_date: `${dueDateFull}T10:00:00`,
        }).eq('id', editing.calendar_event_id);
      } else if (dueDateFull && !editing.calendar_event_id) {
        const { data: evData } = await supabase.from('calendar_events').insert({
          title: evTitle,
          event_type: 'sponsor',
          start_date: `${dueDateFull}T09:00:00`,
          end_date: `${dueDateFull}T10:00:00`,
          all_day: true,
          created_by: profile?.id,
        }).select().single();
        if (evData) {
          await supabase.from('sponsor_deliverables').update({ calendar_event_id: evData.id }).eq('id', editing.id);
        }
      } else if (!dueDateFull && editing.calendar_event_id) {
        await supabase.from('calendar_events').delete().eq('id', editing.calendar_event_id);
        await supabase.from('sponsor_deliverables').update({ calendar_event_id: null }).eq('id', editing.id);
      }

      if (campaignId) await syncBrandRevenue(campaignId);

      closeEdit();
      fetchSponsors();
    } finally {
      setSaving(false);
    }
  }

  // --- Mark delivered (desktop "Video" button → handleSaveVideoLink, Deliverables.js:818) ---
  function openDeliver(d) {
    setDeliverUrl(d.video_url || '');
    setDeliverError('');
    setDeliverTarget(d);
  }

  function closeDeliver() {
    setDeliverTarget(null);
    setDeliverUrl('');
    setDeliverError('');
  }

  async function handleMarkDelivered(e) {
    if (e) e.preventDefault();
    if (!deliverTarget || delivering) return;
    const url = deliverUrl.trim();
    if (!url) { setDeliverError('Paste the finished video link.'); return; }
    if (!isHttpUrl(url)) { setDeliverError('Link must start with http:// or https://'); return; }
    setDelivering(true);
    try {
      const { error } = await supabase.from('sponsor_deliverables').update({
        video_url: url,
        delivered: true,
        updated_at: new Date().toISOString(),
      }).eq('id', deliverTarget.id);
      if (error) { toast.error('Error saving video link: ' + error.message); return; }
      closeDeliver();
      fetchSponsors();
    } finally {
      setDelivering(false);
    }
  }

  // Derived data
  const upcomingReads = allDeliverables
    .filter(d => showDelivered || !d.delivered)
    .sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date.localeCompare(b.due_date);
    });

  // Money summary migrated to the Accounting page (Revenue → Mayday Media).

  // Read slots helpers
  function buildMonth(offset) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  function formatMonth(m) {
    const [y, mo] = m.split('-');
    return new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
  function getCount(month, channel) {
    return allDeliverables.filter(d => !d.delivered && d.channel === channel && d.due_date && d.due_date.startsWith(month)).length;
  }
  function getLimit(month, channel) {
    const row = slotLimits.find(r => r.month === month && r.channel === channel);
    return row ? row.max_slots : null;
  }

  const slotMonths = [buildMonth(0), buildMonth(1), buildMonth(2)];

  if (loading) {
    return <div style={styles.page}><p style={styles.emptyText}>Loading...</p></div>;
  }

  const editingSubtitle = editing
    ? `${editing.sponsor_name}${editing.brand_name && editing.brand_name !== editing.sponsor_name ? ` / ${editing.brand_name}` : ''}`
    : '';

  return (
    <div style={styles.page}>

      {/* Read Slots */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Read Slots</h2>
        <div style={styles.slotGrid}>
          {slotMonths.map(month => {
            const mc = getCount(month, 'mayday');
            const tc = getCount(month, 'tmb');
            const ml = getLimit(month, 'mayday');
            const tl = getLimit(month, 'tmb');
            return (
              <div key={month} style={styles.slotCard}>
                <div style={styles.slotMonth}>{formatMonth(month)}</div>
                <div style={styles.slotRow}>
                  <span style={{ color: colors.accentFg, fontSize: 13, fontWeight: 600 }}>MD: {mc}{ml != null ? `/${ml}` : ''}</span>
                  <span style={{ color: '#fca5a5', fontSize: 13, fontWeight: 600 }}>TMB: {tc}{tl != null ? `/${tl}` : ''}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Upcoming Deliverables */}
      <div style={styles.section}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ ...styles.sectionTitle, marginBottom: 0 }}>
            Upcoming
            <span style={styles.countBadge}>{upcomingReads.length}</span>
          </h2>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
            <input
              type="checkbox"
              checked={showDelivered}
              onChange={e => setShowDelivered(e.target.checked)}
              style={{ accentColor: '#5b8fc7' }}
            />
            Show Delivered
          </label>
        </div>

        {upcomingReads.length === 0 ? (
          <p style={styles.emptyText}>No upcoming deliverables</p>
        ) : (
          <div style={styles.list}>
            {upcomingReads.map(d => {
              const linkedSheet = beatSheets.find(bs => bs.id === d.beat_sheet_id);
              const isExpanded = expandedId === d.id;
              const ev = d.video_event_id ? videoEvents.find(e => e.id === d.video_event_id) : null;
              return (
                <div key={d.id} {...clickableKeyProps(() => setExpandedId(isExpanded ? null : d.id))} style={styles.card} onClick={() => setExpandedId(isExpanded ? null : d.id)}>
                  <div style={styles.cardHeader}>
                    <div style={styles.cardLeft}>
                      <div style={{ minWidth: 0 }}>
                        <div style={styles.cardTitle}>
                          {d.sponsor_name}{d.brand_name && d.brand_name !== d.sponsor_name ? ` / ${d.brand_name}` : ''}
                        </div>
                        <div style={styles.cardMeta}>
                          {d.title}
                          {d.due_date && ` · ${new Date(d.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`}
                        </div>
                      </div>
                    </div>
                    <div style={styles.cardRight}>
                      {d.pay != null && (
                        <span style={styles.payBadge}>${parseFloat(d.pay).toLocaleString()}</span>
                      )}
                      {d.channel && CHANNEL_COLORS[d.channel] && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 5, background: CHANNEL_COLORS[d.channel].bg, color: CHANNEL_COLORS[d.channel].color }}>
                          {CHANNEL_COLORS[d.channel].label}
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={styles.chipRow}>
                    {d.delivered && (
                      <span style={{ ...styles.chip, background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>Delivered</span>
                    )}
                    {(() => {
                      const r = REVIEW_STATUS_BY_VALUE[d.review_status] || REVIEW_STATUS_BY_VALUE.queued;
                      return <span style={{ ...styles.chip, background: r.bg, color: r.color }}>{r.label}</span>;
                    })()}
                    {ev ? (
                      <span style={{ ...styles.chip, background: 'rgba(168,85,247,0.12)', color: '#c084fc' }}>
                        {new Date(ev.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    ) : (
                      <span style={{ ...styles.chip, background: 'rgba(245,158,11,0.12)', color: '#fbbf24' }}>Not Scheduled</span>
                    )}
                  </div>

                  {isExpanded && (
                    <div style={styles.cardDetail}>
                      {d.brand_name && d.brand_name !== d.sponsor_name && (
                        <div style={styles.detailRow}>
                          <span style={styles.detailLabel}>Brand</span>
                          <span style={styles.detailValue}>{d.brand_name}</span>
                        </div>
                      )}
                      {linkedSheet && (
                        <div style={styles.detailRow}>
                          <span style={styles.detailLabel}>Beat Sheet</span>
                          <span style={{ ...styles.detailValue, color: colors.accentFg }}>{linkedSheet.title}</span>
                        </div>
                      )}
                      {!linkedSheet && (
                        <div style={styles.detailRow}>
                          <span style={styles.detailLabel}>Beat Sheet</span>
                          <span style={{ ...styles.detailValue, color: '#fca5a5' }}>Unassigned</span>
                        </div>
                      )}
                      {ev && (
                        <div style={styles.detailRow}>
                          <span style={styles.detailLabel}>Video</span>
                          <span style={{ ...styles.detailValue, color: '#c084fc' }}>{ev.title}</span>
                        </div>
                      )}
                      {d.review_due && (
                        <div style={styles.detailRow}>
                          <span style={styles.detailLabel}>Review Due</span>
                          <span style={styles.detailValue}>
                            {new Date(d.review_due + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                      )}
                      {d.video_url && (
                        <div style={styles.detailRow}>
                          <span style={styles.detailLabel}>Finished Video</span>
                          <a
                            href={d.video_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            style={{ ...styles.detailValue, color: '#86efac', textDecoration: 'underline' }}
                          >
                            link
                          </a>
                        </div>
                      )}
                      {(d.ad_copy || d.notes) && (
                        <div style={{ marginTop: 8 }}>
                          <span style={styles.detailLabel}>Ad Copy</span>
                          <p style={styles.notesText}>{d.ad_copy || d.notes}</p>
                        </div>
                      )}
                      {d.brief_url && (
                        <a href={d.brief_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={styles.briefLink}>
                          {d.brief_name || 'Brand Brief'}
                        </a>
                      )}
                      {(d.platforms || []).length > 0 && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                          {d.platforms.map(p => (
                            <span key={p} style={styles.platformPill}>{p}</span>
                          ))}
                        </div>
                      )}

                      <div style={styles.actionRow}>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openEdit(d); }}
                          style={styles.actionBtn}
                        >
                          Edit
                        </button>
                        {!d.delivered && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openDeliver(d); }}
                            style={styles.deliverBtn}
                          >
                            Mark Delivered
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit sheet */}
      <FullScreenSheet open={!!editing} onClose={closeEdit} title="Edit Deliverable">
        {editing && (
          <form onSubmit={handleSaveEdit} style={styles.form}>
            <div style={styles.formSubtitle}>{editingSubtitle}</div>

            <div style={styles.field}>
              <label style={styles.fieldLabel}>Type</label>
              <select value={form.deliverable_type} onChange={e => setField('deliverable_type', e.target.value)} style={styles.input}>
                {Object.entries(DELIVERABLE_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>

            <div style={styles.field}>
              <label style={styles.fieldLabel}>Channel</label>
              <select value={form.channel} onChange={e => setField('channel', e.target.value)} style={styles.input}>
                <option value="">— Select channel —</option>
                {CHANNEL_OPTIONS.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <div style={styles.formRow}>
              <div style={{ ...styles.field, flex: 1 }}>
                <label style={styles.fieldLabel}>Due Month</label>
                <input type="month" value={form.due_month} onChange={e => setField('due_month', e.target.value)} style={styles.input} />
              </div>
              <div style={{ ...styles.field, flex: 1 }}>
                <label style={styles.fieldLabel}>Review Due</label>
                <input type="date" value={form.review_due} onChange={e => setField('review_due', e.target.value)} style={styles.input} />
              </div>
            </div>

            <div style={styles.field}>
              <label style={styles.fieldLabel}>Platforms</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {DELIVERABLE_PLATFORMS.map(p => {
                  const on = form.platforms.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => togglePlatform(p)}
                      style={{ ...styles.platformToggle, ...(on ? styles.platformToggleOn : null) }}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={styles.formRow}>
              <div style={{ ...styles.field, flex: 1 }}>
                <label style={styles.fieldLabel}>Needs Review</label>
                <select value={form.needs_review ? 'yes' : 'no'} onChange={e => setField('needs_review', e.target.value === 'yes')} style={styles.input}>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </div>
              <div style={{ ...styles.field, flex: 1 }}>
                <label style={styles.fieldLabel}>Status</label>
                <select value={form.review_status} onChange={e => setField('review_status', e.target.value)} style={styles.input}>
                  {REVIEW_STATUS_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={styles.field}>
              <label style={styles.fieldLabel}>Pay ($)</label>
              <input type="number" step="0.01" inputMode="decimal" value={form.pay} onChange={e => setField('pay', e.target.value)} placeholder="0.00" style={styles.input} />
            </div>

            <div style={styles.field}>
              <label style={styles.fieldLabel}>Attached Video</label>
              <select value={form.video_event_id} onChange={e => setField('video_event_id', e.target.value)} style={styles.input}>
                <option value="">None</option>
                {videoEvents.map(ev => (
                  <option key={ev.id} value={ev.id}>
                    {new Date(ev.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — {ev.title}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.field}>
              <label style={styles.fieldLabel}>Video Link</label>
              <input
                type="url"
                inputMode="url"
                value={form.video_url}
                onChange={e => setField('video_url', e.target.value)}
                placeholder="https://youtube.com/..."
                style={styles.input}
              />
              <span style={styles.fieldHint}>Saving with a link marks this deliverable delivered; clearing it reopens it.</span>
            </div>

            <div style={styles.field}>
              <label style={styles.fieldLabel}>Ad Copy</label>
              <textarea
                value={form.ad_copy}
                onChange={e => { setAdCopyDirty(true); setField('ad_copy', e.target.value); }}
                placeholder="Write your ad copy here…"
                rows={6}
                style={styles.textarea}
              />
            </div>

            <div style={styles.formActions}>
              <button type="submit" disabled={saving} style={{ ...styles.saveBtn, opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving…' : 'Save Deliverable'}
              </button>
              <button type="button" onClick={closeEdit} style={styles.cancelBtn}>Cancel</button>
            </div>
          </form>
        )}
      </FullScreenSheet>

      {/* Mark delivered sheet */}
      <BottomSheet open={!!deliverTarget} onClose={closeDeliver} title="Finished Video">
        {deliverTarget && (
          <form onSubmit={handleMarkDelivered} style={styles.form}>
            <div style={styles.formSubtitle}>
              {deliverTarget.sponsor_name}{deliverTarget.brand_name && deliverTarget.brand_name !== deliverTarget.sponsor_name ? ` / ${deliverTarget.brand_name}` : ''}
              {' · '}{DELIVERABLE_TYPES[deliverTarget.deliverable_type]?.label || deliverTarget.deliverable_type}
            </div>
            <p style={styles.sheetHelp}>Paste the link to the finished video. Saving marks this deliverable delivered.</p>
            <div style={styles.field}>
              <input
                type="url"
                inputMode="url"
                autoFocus
                value={deliverUrl}
                onChange={e => { setDeliverUrl(e.target.value); if (deliverError) setDeliverError(''); }}
                placeholder="https://youtube.com/..."
                style={{ ...styles.input, ...(deliverError ? styles.inputError : null) }}
              />
              {deliverError && <span style={styles.errorText}>{deliverError}</span>}
            </div>
            <div style={styles.formActions}>
              <button
                type="submit"
                disabled={delivering || !deliverUrl.trim()}
                style={{ ...styles.deliverSubmitBtn, opacity: delivering || !deliverUrl.trim() ? 0.5 : 1 }}
              >
                {delivering ? 'Saving…' : 'Mark Delivered'}
              </button>
              <button type="button" onClick={closeDeliver} style={styles.cancelBtn}>Cancel</button>
            </div>
          </form>
        )}
      </BottomSheet>
    </div>
  );
}

const styles = {
  page: {
    padding: `${mobileTokens.space.lg}px ${mobileTokens.space.lg}px calc(${mobileTokens.space.xxl}px + ${mobileTokens.safeBottom})`,
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  section: {
    marginBottom: mobileTokens.space.xxl,
  },
  sectionTitle: {
    fontSize: mobileTokens.font.lg,
    fontWeight: 700,
    color: '#fff',
    margin: `0 0 ${mobileTokens.space.md}px`,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  countBadge: {
    fontSize: 12,
    fontWeight: 600,
    background: colors.accentA15,
    color: colors.accentFg,
    borderRadius: 10,
    padding: '2px 8px',
  },
  emptyText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: mobileTokens.font.md,
  },

  // Money
  moneyRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: mobileTokens.space.sm,
    marginBottom: mobileTokens.space.xxl,
  },
  moneyCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: mobileTokens.radius.md,
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px`,
    position: 'relative',
    overflow: 'hidden',
  },
  moneyBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 3,
    height: '100%',
  },
  moneyLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  moneyValue: {
    fontSize: 20,
    fontWeight: 700,
    color: '#fff',
    fontVariantNumeric: 'tabular-nums',
  },

  // Read Slots
  slotGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: mobileTokens.space.sm,
  },
  slotCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: mobileTokens.radius.sm,
    padding: mobileTokens.space.md,
    textAlign: 'center',
  },
  slotMonth: {
    fontSize: 12,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.6)',
    marginBottom: 6,
  },
  slotRow: {
    display: 'flex',
    justifyContent: 'center',
    gap: 10,
  },

  // Deliverable list
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.sm,
  },
  card: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: mobileTokens.radius.md,
    overflow: 'hidden',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px`,
    gap: mobileTokens.space.sm,
    minHeight: mobileTokens.tap,
  },
  cardLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: mobileTokens.space.sm,
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    color: '#fff',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  cardMeta: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
  },
  cardRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  payBadge: {
    fontSize: 12,
    fontWeight: 700,
    color: '#22c55e',
    whiteSpace: 'nowrap',
  },
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    padding: `0 ${mobileTokens.space.lg}px ${mobileTokens.space.md}px`,
  },
  chip: {
    fontSize: 10,
    fontWeight: 700,
    padding: '3px 8px',
    borderRadius: 5,
    whiteSpace: 'nowrap',
  },

  // Expanded detail
  cardDetail: {
    padding: `0 ${mobileTokens.space.lg}px ${mobileTokens.space.lg}px`,
    borderTop: '1px solid rgba(255,255,255,0.05)',
    paddingTop: mobileTokens.space.md,
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailValue: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
  },
  notesText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    margin: '4px 0 0',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
  },
  briefLink: {
    display: 'inline-block',
    marginTop: 8,
    fontSize: 12,
    color: colors.accentFg,
    textDecoration: 'none',
  },
  platformPill: {
    fontSize: 10,
    fontWeight: 600,
    padding: '2px 6px',
    borderRadius: 4,
    background: colors.accentA12,
    color: colors.accentFg,
  },

  // Card actions
  actionRow: {
    display: 'flex',
    gap: mobileTokens.space.sm,
    marginTop: mobileTokens.space.md,
  },
  actionBtn: {
    flex: 1,
    minHeight: mobileTokens.tap,
    padding: `0 ${mobileTokens.space.md}px`,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.sm,
    color: 'rgba(255,255,255,0.85)',
    fontSize: mobileTokens.font.sm,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    WebkitTapHighlightColor: 'transparent',
  },
  deliverBtn: {
    flex: 1,
    minHeight: mobileTokens.tap,
    padding: `0 ${mobileTokens.space.md}px`,
    background: 'rgba(34,197,94,0.15)',
    border: '1px solid rgba(34,197,94,0.3)',
    borderRadius: mobileTokens.radius.sm,
    color: '#86efac',
    fontSize: mobileTokens.font.sm,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    WebkitTapHighlightColor: 'transparent',
  },

  // Sheets / forms
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.lg,
  },
  formSubtitle: {
    fontSize: mobileTokens.font.sm,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.6)',
  },
  sheetHelp: {
    margin: 0,
    fontSize: mobileTokens.font.sm,
    color: 'rgba(255,255,255,0.5)',
    lineHeight: 1.5,
  },
  formRow: {
    display: 'flex',
    gap: mobileTokens.space.md,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    minWidth: 0,
  },
  fieldLabel: {
    fontSize: mobileTokens.font.xs,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  fieldHint: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.35)',
    lineHeight: 1.4,
  },
  input: {
    height: mobileTokens.tap,
    padding: `0 ${mobileTokens.space.md}px`,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.base,
    outline: 'none',
    fontFamily: 'inherit',
    width: '100%',
    boxSizing: 'border-box',
  },
  inputError: {
    border: '1px solid rgba(239,68,68,0.5)',
  },
  errorText: {
    fontSize: mobileTokens.font.xs,
    color: '#fca5a5',
  },
  textarea: {
    padding: mobileTokens.space.md,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.base,
    lineHeight: 1.5,
    outline: 'none',
    fontFamily: 'inherit',
    resize: 'vertical',
    minHeight: 120,
    width: '100%',
    boxSizing: 'border-box',
  },
  platformToggle: {
    minHeight: 36,
    padding: `0 ${mobileTokens.space.md}px`,
    borderRadius: mobileTokens.radius.sm,
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'transparent',
    color: 'rgba(255,255,255,0.35)',
    fontSize: mobileTokens.font.xs,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    WebkitTapHighlightColor: 'transparent',
  },
  platformToggleOn: {
    background: colors.accentA20,
    color: colors.accentFg,
    borderColor: 'rgba(91, 143, 199,0.4)',
  },
  formActions: {
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.sm,
    paddingTop: mobileTokens.space.sm,
  },
  saveBtn: {
    minHeight: mobileTokens.tap + 4,
    padding: mobileTokens.space.md,
    background: 'linear-gradient(135deg, #5b8fc7, #8fb4d8)',
    border: 'none',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  deliverSubmitBtn: {
    minHeight: mobileTokens.tap + 4,
    padding: mobileTokens.space.md,
    background: 'linear-gradient(135deg, #22c55e, #4ade80)',
    border: 'none',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  cancelBtn: {
    minHeight: mobileTokens.tap,
    padding: mobileTokens.space.md,
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: mobileTokens.radius.md,
    color: 'rgba(255,255,255,0.7)',
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};
