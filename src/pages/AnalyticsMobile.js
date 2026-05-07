import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { mobileTokens } from '../utils/mobileTokens';

// Mobile-only summary view of Analytics. Shows headline KPIs per platform account
// (latest follower count + last-30-days growth). Charts, content tables, and
// revenue breakdowns stay desktop-only.

const PLATFORM_META = {
  youtube:    { label: 'YouTube',    color: '#FF0000', icon: '▶' },
  facebook:   { label: 'Facebook',   color: '#1877F2', icon: 'f' },
  instagram:  { label: 'Instagram',  color: '#E4405F', icon: '◉' },
  tiktok:     { label: 'TikTok',     color: '#00F2EA', icon: '♪' },
  substack:   { label: 'Substack',   color: '#FF6719', icon: 'S' },
  twitch:     { label: 'Twitch',     color: '#9146FF', icon: 'T' },
  stripe:     { label: 'Stripe',     color: '#635BFF', icon: '$' },
  fourthwall: { label: 'Fourthwall', color: '#E8451C', icon: '4' },
};

function fmtCount(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString();
}

export default function AnalyticsMobile() {
  const { profile, isAdmin } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [snapshots, setSnapshots] = useState({}); // accountId -> { latest, monthAgo }
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!isAdmin) { setLoading(false); return; }
    try {
      const { data: accts } = await supabase
        .from('platform_accounts')
        .select('*')
        .eq('is_active', true)
        .order('platform');
      const list = accts || [];
      setAccounts(list);

      const today = new Date();
      const monthAgo = new Date(today); monthAgo.setDate(monthAgo.getDate() - 30);
      const start = monthAgo.toISOString().slice(0, 10);

      const snaps = {};
      await Promise.all(list.map(async (a) => {
        const { data } = await supabase
          .from('audience_snapshots')
          .select('date, followers_total, followers_gained')
          .eq('platform_account_id', a.id)
          .gte('date', start)
          .order('date', { ascending: true });
        if (data && data.length > 0) {
          snaps[a.id] = {
            latest: data[data.length - 1],
            earliest: data[0],
            sumGained: data.reduce((s, r) => s + (r.followers_gained || 0), 0),
          };
        }
      }));
      setSnapshots(snaps);
    } catch (err) {
      console.error('Analytics fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { if (profile?.id) fetchData(); }, [profile?.id, fetchData]);

  if (!isAdmin) return <p style={styles.empty}>Analytics is admin-only.</p>;
  if (loading) return <p style={styles.empty}>Loading…</p>;

  const totalFollowers = accounts.reduce((s, a) => s + (snapshots[a.id]?.latest?.followers_total || 0), 0);
  const totalGained = accounts.reduce((s, a) => s + (snapshots[a.id]?.sumGained || 0), 0);

  return (
    <div style={styles.root}>
      <div style={styles.totalCard}>
        <div style={styles.totalLabel}>Total followers · last 30 days</div>
        <div style={styles.totalValue}>{fmtCount(totalFollowers)}</div>
        <div style={styles.totalDelta}>
          <span style={{ color: totalGained >= 0 ? '#86efac' : '#fca5a5' }}>
            {totalGained >= 0 ? '+' : ''}{fmtCount(Math.abs(totalGained))}
          </span>
          <span style={{ color: 'rgba(255,255,255,0.45)', marginLeft: 6 }}>past 30 days</span>
        </div>
      </div>

      <div style={styles.accountList}>
        {accounts.map((acct) => {
          const meta = PLATFORM_META[acct.platform] || { label: acct.platform, color: '#94a3b8', icon: '?' };
          const snap = snapshots[acct.id];
          const followers = snap?.latest?.followers_total;
          const gained = snap?.sumGained;
          return (
            <div key={acct.id} style={styles.acctCard}>
              <div style={{ ...styles.acctIcon, background: `${meta.color}22`, color: meta.color }}>{meta.icon}</div>
              <div style={styles.acctBody}>
                <div style={styles.acctHeader}>
                  <span style={styles.acctName}>{acct.account_name || meta.label}</span>
                  <span style={styles.acctPlatform}>{meta.label}</span>
                </div>
                <div style={styles.acctStats}>
                  <span style={styles.acctFollowers}>{fmtCount(followers)}</span>
                  <span style={styles.acctFollowersLabel}>followers</span>
                  {gained != null && (
                    <span style={{ ...styles.acctDelta, color: gained >= 0 ? '#86efac' : '#fca5a5' }}>
                      {gained >= 0 ? '+' : ''}{fmtCount(Math.abs(gained))}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p style={styles.footer}>For charts, content performance, and revenue breakdowns, open Mayday Studio on desktop.</p>
    </div>
  );
}

const styles = {
  root: {
    minHeight: '100%',
    background: '#0f0f1a',
    color: '#e2e8f0',
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px ${mobileTokens.space.xxxl}px`,
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.md,
  },
  empty: {
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    fontSize: mobileTokens.font.md,
    padding: mobileTokens.space.xxl,
    margin: 0,
  },
  totalCard: {
    background: 'linear-gradient(135deg, rgba(99,102,241,0.18), rgba(129,140,248,0.08))',
    border: '1px solid rgba(99,102,241,0.25)',
    borderRadius: mobileTokens.radius.lg,
    padding: mobileTokens.space.lg,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  totalLabel: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.55)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    fontWeight: 600,
  },
  totalValue: {
    fontSize: mobileTokens.font.title,
    fontWeight: 700,
    color: '#fff',
    letterSpacing: '-0.5px',
    lineHeight: 1.1,
  },
  totalDelta: {
    fontSize: mobileTokens.font.sm,
    fontWeight: 600,
  },
  accountList: {
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.sm,
  },
  acctCard: {
    display: 'flex',
    gap: mobileTokens.space.md,
    padding: mobileTokens.space.md,
    background: 'rgba(255,255,255,0.04)',
    borderRadius: mobileTokens.radius.md,
  },
  acctIcon: {
    width: 44,
    height: 44,
    borderRadius: mobileTokens.radius.sm,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: mobileTokens.font.lg,
    fontWeight: 700,
    flexShrink: 0,
  },
  acctBody: { flex: 1, minWidth: 0 },
  acctHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: mobileTokens.space.sm },
  acctName: {
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    color: '#fff',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  acctPlatform: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    fontWeight: 600,
    flexShrink: 0,
  },
  acctStats: {
    marginTop: 4,
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
  },
  acctFollowers: {
    fontSize: mobileTokens.font.lg,
    fontWeight: 700,
    color: '#e2e8f0',
  },
  acctFollowersLabel: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.45)',
  },
  acctDelta: {
    marginLeft: 'auto',
    fontSize: mobileTokens.font.sm,
    fontWeight: 700,
  },
  footer: {
    marginTop: mobileTokens.space.md,
    padding: mobileTokens.space.md,
    background: 'rgba(99,102,241,0.06)',
    border: '1px solid rgba(99,102,241,0.18)',
    borderRadius: mobileTokens.radius.sm,
    color: 'rgba(255,255,255,0.55)',
    fontSize: mobileTokens.font.sm,
    textAlign: 'center',
  },
};
