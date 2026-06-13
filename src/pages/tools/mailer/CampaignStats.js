import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../supabaseClient';

// Per-campaign stats panel. Pulls the rolled-up counters from
// mailer_campaigns.stats (live, updated by the webhook RPC), the per-
// recipient sends rows for the cohort table, and the raw click events
// to compute the top-URL leaderboard.

export default function CampaignStats({ campaignId }) {
  const [campaign, setCampaign] = useState(null);
  const [sends, setSends] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: c }, { data: s }, { data: e }] = await Promise.all([
        supabase.from('mailer_campaigns').select('id, name, status, sent_at, stats').eq('id', campaignId).maybeSingle(),
        supabase.from('mailer_sends').select('id, email, status, sent_at, delivered_at, opened_at, clicked_at, bounced_at, complained_at').eq('campaign_id', campaignId).order('created_at', { ascending: false }).limit(500),
        supabase.from('mailer_events').select('event_type, url, created_at').eq('campaign_id', campaignId).order('created_at', { ascending: false }).limit(500),
      ]);
      if (cancelled) return;
      setCampaign(c || null);
      setSends(s || []);
      setEvents(e || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [campaignId]);

  const stats = campaign?.stats || {};
  const topUrls = useMemo(() => {
    const tally = new Map();
    for (const ev of events) {
      if ((ev.event_type === 'pixel.click' || ev.event_type === 'email.clicked') && ev.url) {
        tally.set(ev.url, (tally.get(ev.url) || 0) + 1);
      }
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [events]);

  if (loading) return <div style={styles.empty}>Loading…</div>;
  if (!campaign) return <div style={styles.empty}>Campaign not found.</div>;

  const recipients = stats.recipients || 0;
  const pct = (n) => recipients > 0 ? `${((n / recipients) * 100).toFixed(1)}%` : '—';

  return (
    <div style={styles.wrap}>
      <div style={styles.tiles}>
        <Tile label="Recipients"  value={recipients} />
        <Tile label="Delivered"   value={stats.delivered || 0} sub={pct(stats.delivered || 0)} />
        <Tile label="Opened"      value={stats.opened || 0}    sub={pct(stats.opened || 0)} />
        <Tile label="Clicked"     value={stats.clicked || 0}   sub={pct(stats.clicked || 0)} />
        <Tile label="Bounced"     value={stats.bounced || 0}   sub={pct(stats.bounced || 0)} tone="warn" />
        <Tile label="Complained"  value={stats.complained || 0} sub={pct(stats.complained || 0)} tone="warn" />
      </div>

      <div style={styles.section}>
        <div style={styles.h3}>Top clicked URLs</div>
        {topUrls.length === 0 ? (
          <div style={styles.empty}>No clicks yet.</div>
        ) : (
          <table style={styles.table}>
            <thead><tr><th style={styles.th}>URL</th><th style={{ ...styles.th, width: 60, textAlign: 'right' }}>Clicks</th></tr></thead>
            <tbody>
              {topUrls.map(([url, count]) => (
                <tr key={url}>
                  <td style={styles.td}><a href={url} target="_blank" rel="noopener noreferrer" style={styles.link}>{url}</a></td>
                  <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700 }}>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={styles.section}>
        <div style={styles.h3}>Recent events</div>
        {events.length === 0 ? (
          <div style={styles.empty}>No events yet.</div>
        ) : (
          <table style={styles.table}>
            <thead><tr><th style={styles.th}>When</th><th style={styles.th}>Type</th><th style={styles.th}>URL</th></tr></thead>
            <tbody>
              {events.slice(0, 25).map((ev, i) => (
                <tr key={i}>
                  <td style={styles.td}>{new Date(ev.created_at).toLocaleString()}</td>
                  <td style={styles.td}>{ev.event_type}</td>
                  <td style={{ ...styles.td, color: 'rgba(255,255,255,0.6)' }}>{ev.url || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={styles.section}>
        <div style={styles.h3}>Recipients ({sends.length})</div>
        {sends.length === 0 ? (
          <div style={styles.empty}>No sends yet.</div>
        ) : (
          <table style={styles.table}>
            <thead><tr><th style={styles.th}>Email</th><th style={styles.th}>Status</th><th style={styles.th}>Sent</th><th style={styles.th}>Opened</th><th style={styles.th}>Clicked</th></tr></thead>
            <tbody>
              {sends.slice(0, 50).map((s) => (
                <tr key={s.id}>
                  <td style={styles.td}>{s.email}</td>
                  <td style={styles.td}>{s.status}</td>
                  <td style={styles.td}>{s.sent_at ? new Date(s.sent_at).toLocaleString() : '—'}</td>
                  <td style={styles.td}>{s.opened_at ? new Date(s.opened_at).toLocaleString() : '—'}</td>
                  <td style={styles.td}>{s.clicked_at ? new Date(s.clicked_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, sub, tone }) {
  const fg = tone === 'warn' ? '#fbbf24' : '#a5b4fc';
  return (
    <div style={styles.tile}>
      <div style={styles.tileLabel}>{label}</div>
      <div style={{ ...styles.tileValue, color: fg }}>{value}</div>
      {sub && <div style={styles.tileSub}>{sub}</div>}
    </div>
  );
}

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 24 },
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 },
  tile: { padding: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10 },
  tileLabel: { fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.45)', letterSpacing: 0.5, textTransform: 'uppercase' },
  tileValue: { fontSize: 24, fontWeight: 800, marginTop: 4 },
  tileSub: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  h3: { fontSize: 12, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)' },
  empty: { padding: 16, textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 12 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '6px 10px', fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.4)', letterSpacing: 0.5, textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  td: { padding: '7px 10px', fontSize: 12, color: 'rgba(255,255,255,0.85)', borderBottom: '1px solid rgba(255,255,255,0.04)' },
  link: { color: '#a5b4fc', textDecoration: 'none' },
};
