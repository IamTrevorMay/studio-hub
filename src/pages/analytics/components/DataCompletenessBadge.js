import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../supabaseClient';
import { PLATFORM_META, DAILY_PIPELINE_COVERAGES } from '../constants';

// Live-dashboard trust signal: of the platforms that are SUPPOSED to report a
// daily metrics row, how many actually reported yesterday — plus a count of any
// sources serving stale/cached data. Mirrors the Weekly Report's completeness
// badge so the daily dashboard is held to the same honesty standard. A KPI you
// don't trust is a KPI you ignore, so we surface the trust state up-front.

export default function DataCompletenessBadge() {
  const [health, setHealth] = useState(null);

  const fetchHealth = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_sync_health');
    if (!error && data) setHealth(data);
  }, []);

  useEffect(() => {
    fetchHealth();
    const iv = setInterval(fetchHealth, 60000);
    return () => clearInterval(iv);
  }, [fetchHealth]);

  if (!health) return null;

  // Scope to accounts that should produce a daily metrics row.
  const daily = health.filter((h) => {
    const cov = PLATFORM_META[h.platform]?.coverage;
    return DAILY_PIPELINE_COVERAGES.includes(cov);
  });
  if (daily.length === 0) return null;

  const present = daily.filter((h) => (h.yesterday_row_count || 0) >= (h.expected_row_count || 1)).length;
  const pct = Math.round((present / daily.length) * 100);
  const staleCount = health.filter((h) => h.stale).length;

  const color = pct >= 90 ? '#22c55e' : pct >= 70 ? '#f59e0b' : '#ef4444';
  const bg = pct >= 90 ? 'rgba(34,197,94,0.08)' : pct >= 70 ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)';

  return (
    <div style={{ ...styles.badge, background: bg, borderColor: color + '33' }}>
      <div style={{ ...styles.bar, width: `${Math.min(pct, 100)}%`, background: color }} />
      <span style={styles.text}>
        <span style={{ color, fontWeight: 700 }}>Data completeness {pct}%</span>
        <span style={styles.sub}>· {present} of {daily.length} daily sources reported yesterday</span>
        {staleCount > 0 && (
          <span style={{ ...styles.sub, color: '#f59e0b' }}>· {staleCount} stale</span>
        )}
      </span>
    </div>
  );
}

const styles = {
  badge: {
    position: 'relative', overflow: 'hidden', borderRadius: 10,
    border: '1px solid', padding: '9px 14px', marginBottom: 16,
  },
  bar: { position: 'absolute', top: 0, left: 0, bottom: 0, opacity: 0.1 },
  text: { position: 'relative', fontSize: 12, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  sub: { color: 'rgba(255,255,255,0.45)', fontWeight: 500 },
};
