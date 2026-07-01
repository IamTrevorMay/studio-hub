import React, { useState, useEffect } from 'react';
import { supabase } from '../../../supabaseClient';
import { L } from '../styles';

// Brings the Weekly Report's AI narrative onto the daily dashboard so this is a
// single decision destination: headline + wins / watch-outs / recommendations
// from the most recent weekly_reports snapshot. Collapsible; hidden entirely if
// no report or narrative exists yet.

function Block({ title, items, color }) {
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <div style={{ flex: 1, minWidth: 200 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color, marginBottom: 6 }}>{title}</div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {items.slice(0, 3).map((x, i) => (
          <li key={i} style={{ color: L.inkMuted, fontSize: 12.5, lineHeight: 1.5, marginBottom: 5, display: 'flex' }}>
            <span style={{ color, marginRight: 6 }}>●</span>{String(x)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ThisWeekBanner({ onOpenFullReport }) {
  const [report, setReport] = useState(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from('weekly_reports')
        .select('week_start, week_end, narrative')
        .order('week_start', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (alive) setReport(data || null);
    })();
    return () => { alive = false; };
  }, []);

  const n = report?.narrative;
  if (!n || (!n.headline && !n.wins && !n.watch_outs && !n.recommendations)) return null;

  return (
    <div style={styles.wrap}>
      <div style={styles.head}>
        <button onClick={() => setOpen((o) => !o)} style={styles.toggle}>
          <span style={{ marginRight: 8 }}>{open ? '▾' : '▸'}</span>
          This Week
          <span style={styles.dates}>{report.week_start} → {report.week_end}</span>
        </button>
        {onOpenFullReport && (
          <button onClick={onOpenFullReport} style={styles.link}>Full report →</button>
        )}
      </div>
      {open && (
        <>
          {n.headline && <div style={styles.headline}>{String(n.headline)}</div>}
          <div style={styles.row}>
            <Block title="Wins" items={n.wins} color="#22c55e" />
            <Block title="Watch-outs" items={n.watch_outs} color="#f59e0b" />
            <Block title="Recommendations" items={n.recommendations} color={L.accent} />
          </div>
        </>
      )}
    </div>
  );
}

const styles = {
  wrap: {
    background: L.card,
    border: `1px solid ${L.border}`, borderRadius: 12, padding: '16px 18px', boxShadow: L.shadowSm,
  },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  toggle: {
    background: 'none', border: 'none', color: L.ink, fontSize: 14, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', padding: 0,
  },
  dates: { fontSize: 11, color: L.inkSubtle, marginLeft: 10, fontWeight: 500 },
  link: {
    background: 'none', border: 'none', color: L.accent, fontSize: 12, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  headline: { color: L.ink, fontSize: 14.5, fontWeight: 600, lineHeight: 1.45, margin: '12px 0 14px' },
  row: { display: 'flex', gap: 24, flexWrap: 'wrap' },
};
