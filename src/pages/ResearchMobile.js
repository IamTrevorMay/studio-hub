import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import BottomSheet from '../components/mobile/BottomSheet';
import { mobileTokens, mobileTapButton } from '../utils/mobileTokens';
import { colors } from '../lib/styleTokens';

// Mobile Research: today's trend at the top + thumb-scroll article list.
// Feed management, daily graphics, and Triton briefs stay desktop-only.

function fmtRelative(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  if (diffMs < 60000) return 'just now';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ResearchMobile() {
  const { profile } = useAuth();
  const [articles, setArticles] = useState([]);
  const [trend, setTrend] = useState(null);
  const [loading, setLoading] = useState(true);
  const [trendOpen, setTrendOpen] = useState(false);

  const fetchArticles = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/fetch-rss`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
            apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
          },
        },
      );
      const result = await res.json();
      if (res.ok) setArticles(result.articles || []);
    } catch (err) {
      console.error('Articles fetch failed:', err);
    }
  }, []);

  const fetchTrend = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('research_trends')
        .select('*')
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) setTrend(data);
    } catch (err) {
      console.error('Trend fetch failed:', err);
    }
  }, []);

  useEffect(() => {
    if (!profile?.id) return;
    Promise.all([fetchArticles(), fetchTrend()]).finally(() => setLoading(false));
  }, [profile?.id, fetchArticles, fetchTrend]);

  return (
    <div style={styles.root}>
      {trend && <TrendCard trend={trend} onOpen={() => setTrendOpen(true)} />}

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Latest articles</h3>
        {loading ? (
          <p style={styles.empty}>Loading…</p>
        ) : articles.length === 0 ? (
          <p style={styles.empty}>No articles yet.</p>
        ) : (
          <ul style={styles.list}>
            {articles.map((a) => (
              <li key={a.id || a.link}>
                <a href={a.link} target="_blank" rel="noopener noreferrer" style={styles.row}>
                  <div style={styles.body}>
                    <div style={styles.title}>{a.title}</div>
                    <div style={styles.meta}>
                      <span>{a.feed_name || a.source || 'Source'}</span>
                      {a.published_at && <span> · {fmtRelative(a.published_at)}</span>}
                    </div>
                    {a.summary && <div style={styles.summary}>{a.summary}</div>}
                  </div>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" style={styles.chev}>
                    <path d="M5 3l4 4-4 4" />
                  </svg>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <BottomSheet open={trendOpen} onClose={() => setTrendOpen(false)} title={trend ? `Trends · ${formatTrendDate(trend.date)}` : 'Trends'} maxHeight="92vh">
        {trend && <TrendDetail trend={trend} />}
      </BottomSheet>
    </div>
  );
}

function TrendCard({ trend, onOpen }) {
  const summary = pickSummary(trend);
  return (
    <button onClick={onOpen} style={styles.trendCard}>
      <div style={styles.trendBadge}>Today's trend</div>
      <div style={styles.trendDate}>{formatTrendDate(trend.date)}</div>
      {summary && <div style={styles.trendSummary}>{summary}</div>}
      <div style={styles.trendCta}>
        <span>Read full briefing</span>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M5 3l4 4-4 4" /></svg>
      </div>
    </button>
  );
}

function pickSummary(trend) {
  // research_trends shape varies — try a few likely fields
  if (typeof trend.summary === 'string' && trend.summary) return trend.summary;
  if (Array.isArray(trend.current_events) && trend.current_events.length > 0) {
    const first = trend.current_events[0];
    if (typeof first === 'string') return first;
    if (first?.title) return first.title;
  }
  if (typeof trend.content === 'string') {
    const firstLine = trend.content.split('\n').find((l) => l.trim());
    return firstLine ? firstLine.replace(/^#+\s*/, '').slice(0, 200) : null;
  }
  return null;
}

function formatTrendDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function TrendDetail({ trend }) {
  // Render whichever shape of research_trends row we got — be tolerant.
  const sections = [];
  if (Array.isArray(trend.current_events) && trend.current_events.length > 0) {
    sections.push({ title: 'Current events', items: trend.current_events });
  }
  if (Array.isArray(trend.evergreen_topics) && trend.evergreen_topics.length > 0) {
    sections.push({ title: 'Evergreen topics', items: trend.evergreen_topics });
  }
  if (Array.isArray(trend.suggestions) && trend.suggestions.length > 0) {
    sections.push({ title: 'Suggestions', items: trend.suggestions });
  }

  if (sections.length > 0) {
    return (
      <div style={detailStyles.root}>
        {sections.map((s) => (
          <div key={s.title} style={detailStyles.section}>
            <h4 style={detailStyles.sectionTitle}>{s.title}</h4>
            {s.items.map((it, i) => (
              <div key={i} style={detailStyles.item}>
                {typeof it === 'string' ? (
                  <p style={detailStyles.itemText}>{it}</p>
                ) : (
                  <>
                    {it.title && <div style={detailStyles.itemTitle}>{it.title}</div>}
                    {it.summary && <p style={detailStyles.itemText}>{it.summary}</p>}
                    {it.grade && <span style={detailStyles.itemGrade}>Grade: {it.grade}</span>}
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (typeof trend.content === 'string') {
    return <pre style={detailStyles.raw}>{trend.content}</pre>;
  }

  return <p style={styles.empty}>No content for this trend.</p>;
}

const styles = {
  root: {
    minHeight: '100%',
    background: colors.bg,
    color: '#e2e8f0',
    padding: `${mobileTokens.space.md}px 0 ${mobileTokens.space.xxxl}px`,
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.md,
  },
  trendCard: {
    ...mobileTapButton,
    width: 'calc(100% - 32px)',
    marginInline: mobileTokens.space.lg,
    padding: mobileTokens.space.lg,
    background: 'linear-gradient(135deg, rgba(91, 143, 199,0.18), rgba(129,140,248,0.08))',
    border: '1px solid rgba(91, 143, 199,0.3)',
    borderRadius: mobileTokens.radius.lg,
    color: '#e2e8f0',
    textAlign: 'left',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: mobileTokens.space.sm,
  },
  trendBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: colors.accentFg,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  trendDate: {
    fontSize: mobileTokens.font.lg,
    fontWeight: 700,
    color: '#fff',
    letterSpacing: '-0.2px',
  },
  trendSummary: {
    fontSize: mobileTokens.font.sm,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 1.45,
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
  },
  trendCta: {
    marginTop: 4,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: mobileTokens.font.sm,
    fontWeight: 600,
    color: colors.accentFg,
  },
  section: { paddingInline: mobileTokens.space.lg },
  sectionTitle: {
    margin: `0 0 ${mobileTokens.space.sm}px`,
    fontSize: mobileTokens.font.sm,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.55)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  empty: {
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    fontSize: mobileTokens.font.md,
    padding: mobileTokens.space.xl,
    margin: 0,
  },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: mobileTokens.space.sm },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: mobileTokens.space.md,
    padding: mobileTokens.space.md,
    background: 'rgba(255,255,255,0.04)',
    borderRadius: mobileTokens.radius.md,
    color: '#e2e8f0',
    textDecoration: 'none',
    minHeight: mobileTokens.tap + 12,
  },
  body: { flex: 1, minWidth: 0 },
  title: {
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    color: '#fff',
    lineHeight: 1.35,
    wordBreak: 'break-word',
  },
  meta: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 4,
  },
  summary: {
    fontSize: mobileTokens.font.sm,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 4,
    lineHeight: 1.4,
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
  },
  chev: { color: 'rgba(255,255,255,0.3)', flexShrink: 0 },
};

const detailStyles = {
  root: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.lg },
  section: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.sm },
  sectionTitle: {
    margin: 0,
    fontSize: mobileTokens.font.sm,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.6)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  item: {
    padding: mobileTokens.space.md,
    background: 'rgba(255,255,255,0.04)',
    borderRadius: mobileTokens.radius.md,
  },
  itemTitle: {
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    color: '#fff',
    marginBottom: 4,
  },
  itemText: {
    margin: 0,
    fontSize: mobileTokens.font.sm,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
  },
  itemGrade: {
    display: 'inline-block',
    marginTop: 6,
    fontSize: mobileTokens.font.xs,
    fontWeight: 700,
    color: colors.accentFg,
    background: colors.accentA14,
    padding: '2px 8px',
    borderRadius: mobileTokens.radius.pill,
  },
  raw: {
    fontSize: mobileTokens.font.sm,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontFamily: 'inherit',
    margin: 0,
  },
};
