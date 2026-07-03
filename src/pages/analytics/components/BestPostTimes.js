import React, { useState, useEffect } from 'react';
import { supabase } from '../../../supabaseClient';
import { styles, L } from '../styles';
import { formatCompact } from '../utils';

// Best post times per weekday for each YouTube channel, derived from our own
// publish history: trailing 180 days of content_items, bucketed by weekday ×
// 4-hour daypart (PT), scored by MEDIAN views per video so a single viral
// upload can't crown its timeslot forever. Cells with fewer than MIN_N videos
// are ignored — better to show "—" than fake confidence. Deliberately NOT tied
// to the page's date-range filter: recommendations need a stable long window.
//
// Cells shade on a green ramp normalized per channel — the darker, the better
// that day's best window performs relative to the channel's strongest day.

const WINDOW_DAYS = 180;
const MIN_N = 3;

const DAYPARTS = [
  { label: '12–4a', start: 0 },
  { label: '4–8a', start: 4 },
  { label: '8a–12p', start: 8 },
  { label: '12–4p', start: 12 },
  { label: '4–8p', start: 16 },
  { label: '8p–12a', start: 20 },
];
const partIndex = (hour) => Math.min(5, Math.floor(hour / 4));

// Monday-first for planning; DAY_MAP maps Intl short weekday → row index.
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_MAP = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

function median(nums) {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Cumulative view snapshots — the max across metric rows is the latest count.
function itemViews(item) {
  const rows = item.latest_metrics || [];
  return rows.reduce((m, r) => Math.max(m, Number(r?.views || 0)), 0);
}

// { 'day-part': number[] } → per weekday, the winning daypart.
function bestByDay(cells) {
  return DAY_LABELS.map((_, day) => {
    let best = null;
    for (let part = 0; part < DAYPARTS.length; part++) {
      const views = cells[`${day}-${part}`] || [];
      if (views.length < MIN_N) continue;
      const med = median(views);
      if (!best || med > best.median) best = { part, median: med, n: views.length };
    }
    return best;
  });
}

// Green ramp, darker = better. t in [0,1] relative to the channel's top day.
function cellGreen(t) {
  // Faint tint → deep green. Interpolate lightness 30% → 12%, alpha 0.25 → 1.
  const light = 30 - 18 * t;
  const alpha = 0.25 + 0.75 * t;
  return `hsla(145, 55%, ${light}%, ${alpha})`;
}

export default function BestPostTimes() {
  const [channels, setChannels] = useState(null); // [{ name, days: [{part, median, n}|null] }]

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: accounts } = await supabase
          .from('platform_accounts')
          .select('id, account_name')
          .eq('platform', 'youtube')
          .eq('is_active', true)
          .order('account_name');
        if (!accounts?.length) { if (!cancelled) setChannels([]); return; }

        const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
        const { data: items } = await supabase
          .from('content_items')
          .select('platform_account_id, published_at, latest_metrics:content_metrics(views)')
          .in('platform_account_id', accounts.map((a) => a.id))
          .gte('published_at', since);

        const cellsByAccount = {};
        for (const item of (items || [])) {
          if (!item.published_at) continue;
          const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', hour12: false,
          }).formatToParts(new Date(item.published_at));
          const day = DAY_MAP[parts.find((p) => p.type === 'weekday')?.value];
          const hour = parseInt(parts.find((p) => p.type === 'hour')?.value, 10) || 0;
          if (day === undefined) continue;
          const key = `${day}-${partIndex(hour)}`;
          (cellsByAccount[item.platform_account_id] ??= {})[key] ??= [];
          cellsByAccount[item.platform_account_id][key].push(itemViews(item));
        }

        const result = accounts.map((a) => ({
          name: a.account_name,
          days: bestByDay(cellsByAccount[a.id] || {}),
        }));
        if (!cancelled) setChannels(result);
      } catch (err) {
        console.error('Error computing best post times:', err);
        if (!cancelled) setChannels([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!channels || channels.length === 0) return null;

  // Per-channel max median — the ramp is relative to each channel's own best.
  const maxMedian = channels.map((ch) =>
    ch.days.reduce((m, d) => Math.max(m, d?.median || 0), 0));

  return (
    <div style={{ ...styles.chartSection, borderTop: '3px solid #2f8f5b' }}>
      <span style={{ ...styles.chartTitle, color: '#3fae72' }}>Best Post Times — YouTube</span>
      <div style={{ fontSize: '10px', color: L.inkSubtle, marginTop: '3px' }}>
        median views by publish window · {WINDOW_DAYS}d · PT · darker = better
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `34px repeat(${channels.length}, 1fr)`, gap: '4px', marginTop: '12px' }}>
        <span />
        {channels.map((ch) => (
          <span
            key={ch.name}
            style={{
              fontSize: '11px', fontWeight: 700, color: L.ink, textAlign: 'center',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {ch.name}
          </span>
        ))}
        {DAY_LABELS.map((label, day) => (
          <React.Fragment key={label}>
            <span style={{ fontSize: '11px', color: L.inkMuted, fontWeight: 600, alignSelf: 'center' }}>{label}</span>
            {channels.map((ch, ci) => {
              const d = ch.days[day];
              const t = d && maxMedian[ci] > 0 ? d.median / maxMedian[ci] : 0;
              return (
                <div
                  key={ch.name}
                  title={d ? `${DAYPARTS[d.part].label} PT · median ${formatCompact(d.median)} views` : 'Not enough data'}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: '6px', padding: '4px 8px', borderRadius: '6px',
                    background: d ? cellGreen(t) : L.cardAlt,
                    border: `1px solid ${d ? 'rgba(74,222,128,0.18)' : L.border}`,
                  }}
                >
                  {d ? (
                    <>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: '#e7f5ec' }}>
                        {DAYPARTS[d.part].label}
                      </span>
                      <span style={{ fontSize: '10px', color: 'rgba(231,245,236,0.65)', whiteSpace: 'nowrap' }}>
                        {formatCompact(d.median)}
                      </span>
                    </>
                  ) : (
                    <span style={{ fontSize: '10px', color: L.inkFaint }}>—</span>
                  )}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
