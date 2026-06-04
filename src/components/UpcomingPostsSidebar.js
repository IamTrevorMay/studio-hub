// Right-rail of the Tracking page. Lists posts that Metricool has
// scheduled (status != PUBLISHED) for the next 3 days, grouped by day in
// a Fantastical-style layout: bold day header, colored dot, time, title,
// and a small chip for the network.

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';

const NETWORK_META = {
  YOUTUBE:   { label: 'YouTube',   color: '#FF0000' },
  INSTAGRAM: { label: 'Instagram', color: '#E4405F' },
  FACEBOOK:  { label: 'Facebook',  color: '#1877F2' },
  TIKTOK:    { label: 'TikTok',    color: '#00F2EA' },
  TWITTER:   { label: 'Twitter',   color: '#1DA1F2' },
  THREADS:   { label: 'Threads',   color: '#cbd5e1' },
  LINKEDIN:  { label: 'LinkedIn',  color: '#0A66C2' },
  BLUESKY:   { label: 'Bluesky',   color: '#0085ff' },
};

function networkMeta(net) {
  return NETWORK_META[net] || { label: net, color: '#94a3b8' };
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function formatDayHeader(date, idx) {
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const yy = String(date.getFullYear()).slice(-2);
  const sub = `${m}/${d}/${yy}`;
  let label = weekday;
  if (idx === 0) label = `TODAY ${weekday}`;
  else if (idx === 1) label = `TOMORROW ${weekday}`;
  return { label, sub };
}

function formatTime(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function postTitle(p) {
  return p.youtubeTitle || p.text || '(untitled)';
}

export default function UpcomingPostsSidebar({ embedded = false }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const today = startOfDay(new Date());
      const endDay = new Date(today);
      endDay.setDate(endDay.getDate() + 2);
      const startStr = dayKey(today);
      const endStr = dayKey(endDay);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const res = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/metricool-posts?start=${startStr}&end=${endStr}`,
        { headers: { Authorization: `Bearer ${session.access_token}`, apikey: process.env.REACT_APP_SUPABASE_ANON_KEY } },
      );
      if (!res.ok) throw new Error(`metricool-posts ${res.status}`);
      const { posts: all } = await res.json();

      // Keep only future, non-published posts that fall in the 3-day window.
      const now = new Date();
      const windowEnd = new Date(today);
      windowEnd.setDate(windowEnd.getDate() + 3);
      const future = (all || [])
        .filter(p => p.status !== 'PUBLISHED')
        .filter(p => {
          if (!p.publicationDate) return false;
          const d = new Date(p.publicationDate);
          return d >= now && d < windowEnd;
        })
        .sort((a, b) => new Date(a.publicationDate) - new Date(b.publicationDate));
      setPosts(future);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  const days = [];
  {
    const today = startOfDay(new Date());
    for (let i = 0; i < 3; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
  }

  const groupedByDay = {};
  for (const p of posts) {
    const k = dayKey(new Date(p.publicationDate));
    (groupedByDay[k] ||= []).push(p);
  }

  return (
    <aside style={embedded ? styles.wrapEmbedded : styles.wrap}>
      <div style={embedded ? styles.innerEmbedded : styles.inner}>
        <div style={styles.header}>
          <h3 style={styles.headerTitle}>Upcoming</h3>
          <span style={styles.headerSub}>Next 3 days · scheduled in Metricool</span>
        </div>

        {loading ? (
          <p style={styles.empty}>Loading…</p>
        ) : err ? (
          <p style={{ ...styles.empty, color: '#fca5a5' }}>{err}</p>
        ) : (
          <div style={styles.dayList}>
            {days.map((date, idx) => {
              const k = dayKey(date);
              const dayPosts = groupedByDay[k] || [];
              const { label, sub } = formatDayHeader(date, idx);
              const isToday = idx === 0;
              return (
                <div key={k} style={styles.daySection}>
                  <div style={styles.dayHeader}>
                    <span style={{ ...styles.dayLabel, color: isToday ? '#60a5fa' : '#fff' }}>{label}</span>
                    <span style={{ ...styles.daySub, color: isToday ? 'rgba(96,165,250,0.7)' : 'rgba(255,255,255,0.4)' }}>{sub}</span>
                  </div>
                  {dayPosts.length === 0 ? (
                    <div style={styles.noEvents}>No Events</div>
                  ) : (
                    <div style={styles.eventList}>
                      {dayPosts.map(p => {
                        const meta = networkMeta(p.network);
                        return (
                          <div key={p.id} style={styles.eventRow}>
                            <div style={{ ...styles.dot, background: meta.color }} />
                            <div style={styles.eventBody}>
                              <div style={styles.eventTime}>{formatTime(p.publicationDate)}</div>
                              <div style={styles.eventTitle} title={postTitle(p)}>{postTitle(p)}</div>
                              <span style={{
                                ...styles.chip,
                                background: meta.color + '22',
                                borderColor: meta.color + '55',
                                color: meta.color,
                              }}>{meta.label}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

const styles = {
  wrap: {
    flex: '0 0 22%',
    minWidth: 260,
    maxWidth: 360,
    alignSelf: 'flex-start',
    position: 'sticky',
    top: 16,
  },
  wrapEmbedded: {
    width: '100%',
  },
  inner: {
    background: 'rgba(20,20,30,0.6)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 16,
    maxHeight: 'calc(100vh - 60px)',
    overflowY: 'auto',
  },
  innerEmbedded: {
    padding: 0,
    maxHeight: 'calc(100vh - 60px)',
    overflowY: 'auto',
  },
  header: { marginBottom: 14 },
  headerTitle: { fontSize: 14, fontWeight: 700, color: '#fff', margin: 0, letterSpacing: 0.5 },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.4)' },

  empty: { color: 'rgba(255,255,255,0.4)', fontSize: 12, margin: 0 },

  dayList: { display: 'flex', flexDirection: 'column', gap: 14 },
  daySection: { paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.06)' },

  dayHeader: { display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 },
  dayLabel: { fontSize: 13, fontWeight: 700, letterSpacing: 0.5 },
  daySub: { fontSize: 12, fontWeight: 500 },

  noEvents: { fontSize: 13, color: '#60a5fa', marginTop: 2 },

  eventList: { display: 'flex', flexDirection: 'column', gap: 10 },
  eventRow: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  dot: {
    width: 10, height: 10, borderRadius: '50%', flexShrink: 0, marginTop: 6,
  },
  eventBody: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  eventTime: { fontSize: 12, color: 'rgba(255,255,255,0.6)', fontWeight: 500 },
  eventTitle: {
    fontSize: 13, fontWeight: 600, color: '#fff', lineHeight: 1.3,
    overflow: 'hidden', textOverflow: 'ellipsis',
    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
  },
  chip: {
    alignSelf: 'flex-start',
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
    padding: '2px 8px', borderRadius: 4,
    border: '1px solid', marginTop: 2,
  },
};
