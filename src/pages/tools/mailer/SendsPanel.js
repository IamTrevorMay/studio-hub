import React, { useEffect, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import { listSends } from './api';

const STATUS_COLORS = {
  draft:      { fg: colors.textSubtle, bg: colors.bgInput,   border: colors.border },
  scheduled:  { fg: colors.info.fg,    bg: colors.info.bg,   border: colors.info.border },
  sending:    { fg: colors.warning.fg, bg: colors.warning.bg, border: colors.warning.border },
  sent:       { fg: colors.success.fg, bg: colors.success.bg, border: colors.success.border },
  failed:     { fg: colors.danger.fg,  bg: colors.danger.bg,  border: colors.danger.border },
  cancelled:  { fg: colors.textSubtle, bg: colors.bgInput,   border: colors.border },
};

export default function SendsPanel({ product }) {
  const [sends, setSends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await listSends(product.id);
        if (active) setSends(res.sends || []);
      } catch (e) { if (active) setError(e.message); }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [product.id]);

  return (
    <div style={styles.wrap}>
      <div style={styles.col}>
        <div style={styles.title}>Sends for {product.name}</div>
        {error && <div style={styles.error}>{error}</div>}
        {loading ? (
          <div style={styles.empty}>Loading…</div>
        ) : sends.length === 0 ? (
          <div style={styles.empty}>No sends yet.</div>
        ) : (
          sends.map((s) => {
            const sc = STATUS_COLORS[s.status] || STATUS_COLORS.draft;
            const c = s.counts || {};
            return (
              <div key={s.id} style={styles.row}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.subj}>{s.subject || '(no subject)'}</div>
                  <div style={styles.meta}>
                    {s.scheduled_at ? `Scheduled ${new Date(s.scheduled_at).toLocaleString()}` : ''}
                    {s.sent_at ? ` · Sent ${new Date(s.sent_at).toLocaleString()}` : ''}
                    {' · '}{s.recipient_count} recipients
                  </div>
                  {s.error_message && <div style={styles.errMsg}>{s.error_message}</div>}
                </div>
                <div style={styles.counts}>
                  <Count label="sent" value={c.sent || 0} />
                  <Count label="delivered" value={c.delivered || 0} />
                  <Count label="opened" value={c.opened || 0} />
                  <Count label="clicked" value={c.clicked || 0} />
                  <Count label="bounced" value={c.bounced || 0} />
                </div>
                <span style={{
                  padding: `${spacing.xs}px ${spacing.sm}px`,
                  fontSize: fontSizes.xxs,
                  textTransform: 'uppercase',
                  fontWeight: fontWeights.bold,
                  letterSpacing: '0.06em',
                  color: sc.fg, background: sc.bg,
                  border: `1px solid ${sc.border}`,
                  borderRadius: radii.pill,
                }}>{s.status}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Count({ label, value }) {
  return (
    <div style={countStyles.wrap}>
      <div style={countStyles.value}>{value}</div>
      <div style={countStyles.label}>{label}</div>
    </div>
  );
}

const countStyles = {
  wrap: { textAlign: 'center', minWidth: 48 },
  value: { fontSize: fontSizes.md, fontWeight: fontWeights.semibold, color: colors.text },
  label: { fontSize: fontSizes.xxs, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: '0.06em' },
};

const styles = {
  wrap: { flex: 1, overflow: 'auto', padding: spacing.xxl, display: 'flex', justifyContent: 'center' },
  col: { width: '100%', maxWidth: 980, display: 'flex', flexDirection: 'column', gap: spacing.sm },
  title: { fontSize: fontSizes.xl, fontWeight: fontWeights.semibold, color: colors.text },
  error: {
    padding: spacing.md, background: colors.danger.bg, color: colors.danger.fg,
    border: `1px solid ${colors.danger.border}`, borderRadius: radii.sm, fontSize: fontSizes.sm,
  },
  empty: { padding: spacing.huge, textAlign: 'center', color: colors.textSubtle, fontSize: fontSizes.sm },
  row: {
    padding: spacing.md, background: colors.bgRaised,
    border: `1px solid ${colors.border}`, borderRadius: radii.md,
    display: 'flex', alignItems: 'center', gap: spacing.md,
  },
  subj: { fontSize: fontSizes.md, fontWeight: fontWeights.semibold, color: colors.text },
  meta: { fontSize: fontSizes.xs, color: colors.textSubtle, marginTop: 2 },
  errMsg: { fontSize: fontSizes.xs, color: colors.danger.fg, marginTop: 2 },
  counts: { display: 'flex', gap: spacing.md },
};
