import React from 'react';
import { styles } from '../styles';

// A headline KPI built for decisions, not vanity: a big value, a one-line
// "so what" driver, and TWO deltas — vs the immediately-preceding period and
// vs the trailing-4-period average. A single "vs previous period" number is
// noisy and seasonal; the second baseline tells you whether a move is real or
// just this period being lumpy.

function Delta({ label, pct }) {
  const na = pct === null || pct === undefined || !isFinite(pct);
  const up = !na && pct >= 0;
  const color = na ? 'rgba(255,255,255,0.3)' : up ? '#4ade80' : '#f87171';
  return (
    <span style={{ fontSize: 11, color, whiteSpace: 'nowrap', fontWeight: 600 }}>
      {label} {na ? 'n/a' : `${up ? '+' : ''}${pct.toFixed(0)}%`}
    </span>
  );
}

export default function DecisionKpiCard({ label, value, soWhat, deltaPrev, deltaBase, color }) {
  return (
    <div style={styles.kpiCard}>
      <div style={{ ...styles.kpiAccent, background: color }} />
      <div style={styles.kpiLabel}>{label}</div>
      <div style={styles.kpiValue}>{value}</div>
      {soWhat && (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {soWhat}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <Delta label="vs prev" pct={deltaPrev} />
        <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
        <Delta label="4-avg" pct={deltaBase} />
      </div>
    </div>
  );
}
