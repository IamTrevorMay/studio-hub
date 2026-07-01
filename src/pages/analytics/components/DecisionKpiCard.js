import React from 'react';
import { styles } from '../styles';
import { Sparkline } from '../viz';

// A headline KPI built for decisions, not vanity: a big value, a one-line
// "so what" driver, and TWO deltas — vs the immediately-preceding period and
// vs the trailing-4-period average. A single "vs previous period" number is
// noisy and seasonal; the second baseline tells you whether a move is real or
// just this period being lumpy. A sparkline rides alongside the value so the
// number answers "how much" and the shape answers "which way".

function Delta({ label, pct }) {
  const na = pct === null || pct === undefined || !isFinite(pct);
  const up = !na && pct >= 0;
  const color = na ? 'rgba(255,255,255,0.42)' : up ? '#22c55e' : '#ef4444';
  const glyph = na ? '' : up ? '▲' : '▼';
  return (
    <span style={{ fontSize: 11, color, whiteSpace: 'nowrap', fontWeight: 600 }}>
      {label} {na ? 'n/a' : `${glyph} ${Math.abs(pct).toFixed(0)}%`}
    </span>
  );
}

export default function DecisionKpiCard({ label, value, soWhat, deltaPrev, deltaBase, color, spark }) {
  return (
    <div style={styles.kpiCard}>
      <div style={{ ...styles.kpiAccent, background: color }} />
      <div style={styles.kpiLabel}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
        <div style={styles.kpiValue}>{value}</div>
        {spark && spark.length >= 2 && (
          <div style={{ flexShrink: 0, opacity: 0.9 }}>
            <Sparkline data={spark} color={color} width={84} height={26} />
          </div>
        )}
      </div>
      {soWhat && (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 3 }}>
          {soWhat}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <Delta label="vs prev" pct={deltaPrev} />
        <span style={{ color: 'rgba(255,255,255,0.14)' }}>·</span>
        <Delta label="4-avg" pct={deltaBase} />
      </div>
    </div>
  );
}
