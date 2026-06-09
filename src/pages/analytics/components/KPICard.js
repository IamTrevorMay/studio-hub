import React from 'react';
import { styles } from '../styles';

export default function KPICard({ label, value, change, changeLabel, color }) {
  const isPositive = change >= 0;
  return (
    <div style={styles.kpiCard}>
      <div style={{ ...styles.kpiAccent, background: color }} />
      <div style={styles.kpiLabel}>{label}</div>
      <div style={styles.kpiValue}>{value}</div>
      <div style={{ fontSize: '12px', fontWeight: 500, color: isPositive ? '#4ade80' : '#f87171', marginTop: '4px' }}>
        {changeLabel || `${isPositive ? '+' : ''}${change.toFixed(1)}%`}
      </div>
    </div>
  );
}
