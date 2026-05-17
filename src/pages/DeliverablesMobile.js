import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import { mobileTokens } from '../utils/mobileTokens';

const DELIVERABLE_TYPES = {
  long_form_read: { label: 'Long Form Read', icon: '\u{1F4D6}' },
  live_read: { label: 'Live Read', icon: '\u{1F399}\uFE0F' },
  short_form_video: { label: 'Short Form Video', icon: '\u{1F4F1}' },
};
const CHANNEL_COLORS = {
  mayday: { bg: 'rgba(99,102,241,0.12)', color: '#a5b4fc', label: 'MD' },
  tmb: { bg: 'rgba(239,68,68,0.12)', color: '#fca5a5', label: 'TMB' },
  socials: { bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)', label: 'SOC' },
};

export default function DeliverablesMobile() {
  const { refreshKey } = useAuth();
  const [sponsors, setSponsors] = useState([]);
  const [allDeliverables, setAllDeliverables] = useState([]);
  const [videoEvents, setVideoEvents] = useState([]);
  const [beatSheets, setBeatSheets] = useState([]);
  const [slotLimits, setSlotLimits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

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
          const campaign = (s.sponsor_campaigns || []).find(c => c.id === d.campaign_id);
          flat.push({ ...d, sponsor_name: s.name, sponsor_id: s.id, campaign_name: campaign?.name || null, brief_url: campaign?.brief_url || null, brief_name: campaign?.brief_name || null });
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
        .eq('event_type', 'video_post')
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

  // Derived data
  const upcomingReads = allDeliverables
    .filter(d => !d.delivered)
    .sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date.localeCompare(b.due_date);
    });

  const allCampaigns = sponsors.flatMap(s => s.sponsor_campaigns || []);
  const campaignTotals = new Map(
    allCampaigns.map(c => [
      c.id,
      allDeliverables.filter(d => d.campaign_id === c.id).reduce((sum, d) => sum + (parseFloat(d.pay) || 0), 0),
    ])
  );
  const totalDeal = Array.from(campaignTotals.values()).reduce((sum, v) => sum + v, 0);
  const totalPaid = allCampaigns.filter(c => c.payment_status === 'paid').reduce((sum, c) => sum + (campaignTotals.get(c.id) || 0), 0);
  const totalOwed = totalDeal - totalPaid;
  const upcomingValue = allDeliverables.filter(d => !d.delivered).reduce((sum, d) => sum + (parseFloat(d.pay) || 0), 0);

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

  return (
    <div style={styles.page}>
      {/* Money Summary */}
      {totalDeal > 0 && (
        <div style={styles.moneyRow}>
          {[
            { label: 'Deal', value: totalDeal, color: '#6366f1' },
            { label: 'Paid', value: totalPaid, color: '#22c55e' },
            { label: 'Owed', value: totalOwed, color: totalOwed > 0 ? '#f59e0b' : '#22c55e' },
            { label: 'Upcoming', value: upcomingValue, color: '#6366f1' },
          ].map(card => (
            <div key={card.label} style={styles.moneyCard}>
              <div style={{ ...styles.moneyBar, background: card.color }} />
              <div style={styles.moneyLabel}>{card.label}</div>
              <div style={styles.moneyValue}>${card.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            </div>
          ))}
        </div>
      )}

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
                  <span style={{ color: '#a5b4fc', fontSize: 13, fontWeight: 600 }}>MD: {mc}{ml != null ? `/${ml}` : ''}</span>
                  <span style={{ color: '#fca5a5', fontSize: 13, fontWeight: 600 }}>TMB: {tc}{tl != null ? `/${tl}` : ''}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Upcoming Deliverables */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>
          Upcoming
          <span style={styles.countBadge}>{upcomingReads.length}</span>
        </h2>

        {upcomingReads.length === 0 ? (
          <p style={styles.emptyText}>No upcoming deliverables</p>
        ) : (
          <div style={styles.list}>
            {upcomingReads.map(d => {
              const linkedSheet = beatSheets.find(bs => bs.id === d.beat_sheet_id);
              const isExpanded = expandedId === d.id;
              const ev = d.video_event_id ? videoEvents.find(e => e.id === d.video_event_id) : null;
              return (
                <div key={d.id} style={styles.card} onClick={() => setExpandedId(isExpanded ? null : d.id)}>
                  <div style={styles.cardHeader}>
                    <div style={styles.cardLeft}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>{DELIVERABLE_TYPES[d.deliverable_type]?.icon || '\u{1F4CB}'}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={styles.cardTitle}>{d.title}</div>
                        <div style={styles.cardMeta}>
                          {d.sponsor_name}
                          {d.due_date && ` \u00B7 ${new Date(d.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`}
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

                  {isExpanded && (
                    <div style={styles.cardDetail}>
                      {d.campaign_name && (
                        <div style={styles.detailRow}>
                          <span style={styles.detailLabel}>Campaign</span>
                          <span style={styles.detailValue}>{d.campaign_name}</span>
                        </div>
                      )}
                      {linkedSheet && (
                        <div style={styles.detailRow}>
                          <span style={styles.detailLabel}>Beat Sheet</span>
                          <span style={{ ...styles.detailValue, color: '#a5b4fc' }}>{linkedSheet.title}</span>
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
                      {d.notes && (
                        <div style={{ marginTop: 8 }}>
                          <span style={styles.detailLabel}>Ad Copy</span>
                          <p style={styles.notesText}>{d.notes}</p>
                        </div>
                      )}
                      {d.brief_url && (
                        <a href={d.brief_url} target="_blank" rel="noopener noreferrer" style={styles.briefLink}>
                          {d.brief_name || 'Campaign Brief'}
                        </a>
                      )}
                      {(d.platforms || []).length > 0 && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                          {d.platforms.map(p => (
                            <span key={p} style={styles.platformPill}>{p}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
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
    background: 'rgba(99,102,241,0.15)',
    color: '#a5b4fc',
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
    color: '#a5b4fc',
    textDecoration: 'none',
  },
  platformPill: {
    fontSize: 10,
    fontWeight: 600,
    padding: '2px 6px',
    borderRadius: 4,
    background: 'rgba(99,102,241,0.12)',
    color: '#a5b4fc',
  },
};
