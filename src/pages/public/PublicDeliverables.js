import React, { useState, useEffect } from 'react';

// Public, login-free "Upcoming Deliverables" page. Reads the trimmed
// public-deliverables edge function (no pay/notes/ad_copy). Standalone: no
// AuthContext, no app chrome — rendered before the auth gate in App.js.
//
// noindex: shareable link, but kept out of search engines (set via a robots
// meta tag on mount).

const FN_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/public-deliverables`;
const ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;
const POLL_MS = 60000;

// Mirrors Deliverables.REVIEW_STATUS_OPTIONS (self-contained so this page has
// no dependency on the auth-walled admin bundle).
const REVIEW_STATUS = {
  queued: { label: 'Queued', bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.55)' },
  writing: { label: 'Writing', bg: 'rgba(99,102,241,0.15)', color: '#a5b4fc' },
  filming: { label: 'Filming', bg: 'rgba(168,85,247,0.15)', color: '#c084fc' },
  ready_for_review: { label: 'Ready for Review', bg: 'rgba(245,158,11,0.15)', color: '#fbbf24' },
  in_review: { label: 'In Review', bg: 'rgba(14,165,233,0.15)', color: '#38bdf8' },
  complete: { label: 'Complete', bg: 'rgba(34,197,94,0.15)', color: '#22c55e' },
};
const DELIVERED_TONE = { label: 'Delivered', bg: 'rgba(34,197,94,0.15)', color: '#22c55e' };

const TYPE_LABELS = {
  long_form_read: 'Long-form Read',
  short_form_read: 'Short-form Read',
  dedicated_video: 'Dedicated Video',
  integration: 'Integration',
  social_post: 'Social Post',
};

function prettyType(t) {
  if (!t) return 'Deliverable';
  return TYPE_LABELS[t] || t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Date-only strings must not go through new Date('YYYY-MM-DD') (parses UTC,
// shifts a day in PT). Split and build a local date instead.
function fmtDate(dateStr) {
  if (!dateStr) return 'No date';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function PublicDeliverables() {
  const [deliverables, setDeliverables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // noindex — shareable but not search-indexed.
  useEffect(() => {
    document.title = 'Upcoming Deliverables — Mayday Studio';
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => { document.head.removeChild(meta); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(FN_URL, {
          headers: ANON_KEY ? { apikey: ANON_KEY } : {},
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
        if (!cancelled) { setDeliverables(json.deliverables || []); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load deliverables');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const t = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <p style={styles.eyebrow}>Mayday Studio</p>
          <h1 style={styles.h1}>Upcoming Deliverables</h1>
          <p style={styles.sub}>Sponsored content in progress and recently delivered.</p>
        </div>

        {loading ? (
          <div style={styles.center}><div style={styles.spinner} /></div>
        ) : error ? (
          <p style={styles.errorText}>{error}</p>
        ) : deliverables.length === 0 ? (
          <p style={styles.empty}>No upcoming deliverables right now.</p>
        ) : (
          <div style={styles.list}>
            {deliverables.map((d) => {
              const tone = d.delivered ? DELIVERED_TONE : (REVIEW_STATUS[d.review_status] || REVIEW_STATUS.queued);
              const brand = d.brand_name || d.sponsor_name;
              return (
                <div key={d.id} style={styles.card}>
                  <div style={styles.cardTop}>
                    <div style={styles.cardMain}>
                      {brand && <span style={styles.brandChip}>{brand}</span>}
                      <span style={styles.title}>{d.title || prettyType(d.deliverable_type)}</span>
                    </div>
                    <span style={{ ...styles.statusChip, background: tone.bg, color: tone.color }}>{tone.label}</span>
                  </div>
                  <div style={styles.cardMeta}>
                    <span style={styles.metaType}>{prettyType(d.deliverable_type)}</span>
                    <span style={styles.metaDot}>·</span>
                    <span style={styles.metaDate}>{fmtDate(d.due_date)}</span>
                  </div>
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
    minHeight: '100vh',
    background: '#0f0f1a',
    color: 'rgba(255,255,255,0.9)',
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    padding: '48px 20px 80px',
  },
  container: { maxWidth: '760px', margin: '0 auto' },
  header: { marginBottom: '32px' },
  eyebrow: { margin: 0, fontSize: '13px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#818cf8' },
  h1: { margin: '6px 0 8px', fontSize: '30px', fontWeight: 700, color: '#fff' },
  sub: { margin: 0, fontSize: '14px', color: 'rgba(255,255,255,0.45)' },
  list: { display: 'flex', flexDirection: 'column', gap: '10px' },
  card: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '12px',
    padding: '16px 18px',
  },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' },
  cardMain: { display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 },
  brandChip: {
    alignSelf: 'flex-start',
    fontSize: '11px', fontWeight: 600,
    background: 'rgba(99,102,241,0.15)', color: '#a5b4fc',
    borderRadius: '5px', padding: '2px 8px',
  },
  title: { fontSize: '15px', fontWeight: 600, color: '#fff', lineHeight: 1.35 },
  statusChip: { flexShrink: 0, fontSize: '11px', fontWeight: 600, borderRadius: '6px', padding: '3px 9px', whiteSpace: 'nowrap' },
  cardMeta: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', fontSize: '12px', color: 'rgba(255,255,255,0.45)' },
  metaType: { color: 'rgba(255,255,255,0.6)' },
  metaDot: { color: 'rgba(255,255,255,0.25)' },
  metaDate: {},
  center: { display: 'flex', justifyContent: 'center', padding: '60px 0' },
  spinner: {
    width: '32px', height: '32px',
    border: '3px solid rgba(99,102,241,0.2)', borderTopColor: '#6366f1',
    borderRadius: '50%', animation: 'spin 0.8s linear infinite',
  },
  empty: { textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: '14px', padding: '40px 0' },
  errorText: { textAlign: 'center', color: '#fca5a5', fontSize: '14px', padding: '40px 0' },
};
