import React, { useEffect, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights, shadows, zIndex } from '../../../lib/styleTokens';
import { listAudiences, sendTemplate } from './api';

// Modal: pick destination + schedule then POST /api/emails/send.
// Two destination modes:
//   - audience: choose one of the product's audiences
//   - test:     comma-separated test emails
// Scheduling: empty = send now; ISO date-time picker = schedule.

export default function SendDialog({ product, template, onClose, onSent }) {
  const [destMode, setDestMode] = useState('test');
  const [audiences, setAudiences] = useState([]);
  const [audienceId, setAudienceId] = useState('');
  const [testEmails, setTestEmails] = useState('');
  const [subjectOverride, setSubjectOverride] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await listAudiences(product.id);
        if (active) {
          setAudiences(res.audiences || []);
          if (res.audiences && res.audiences[0]) setAudienceId(res.audiences[0].id);
        }
      } catch (e) { if (active) setError(e.message); }
    })();
    return () => { active = false; };
  }, [product.id]);

  async function handleSend() {
    setError(null);
    const payload = { template_id: template.id };
    if (subjectOverride.trim()) payload.subject_override = subjectOverride.trim();
    if (scheduledAt) payload.scheduled_at = new Date(scheduledAt).toISOString();
    if (destMode === 'audience') {
      if (!audienceId) { setError('Pick an audience'); return; }
      payload.audience_id = audienceId;
    } else {
      const list = testEmails.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
      if (list.length === 0) { setError('Enter at least one test email'); return; }
      payload.test_emails = list;
    }
    setBusy(true);
    try {
      const res = await sendTemplate(payload);
      setBusy(false);
      onSent(res);
    } catch (e) {
      setBusy(false);
      setError(e.message);
    }
  }

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>Send “{template.name || 'Untitled'}”</div>

        <div style={styles.tabs}>
          {['test', 'audience'].map((m) => (
            <button key={m} onClick={() => setDestMode(m)}
              style={{ ...styles.tab, ...(destMode === m ? styles.tabActive : {}) }}>
              {m === 'test' ? 'Test emails' : 'Audience'}
            </button>
          ))}
        </div>

        {destMode === 'test' ? (
          <Field label="Recipients (comma-separated)">
            <textarea value={testEmails} onChange={(e) => setTestEmails(e.target.value)}
              rows={3} style={styles.input} placeholder="you@example.com, other@example.com" />
          </Field>
        ) : (
          <Field label="Audience">
            <select value={audienceId} onChange={(e) => setAudienceId(e.target.value)} style={styles.input}>
              {audiences.length === 0 && <option value="">No audiences — create one first</option>}
              {audiences.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.member_count || 0})</option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Subject override (optional)">
          <input value={subjectOverride} onChange={(e) => setSubjectOverride(e.target.value)}
            placeholder={template.subject || '(use template subject)'} style={styles.input} />
        </Field>

        <Field label="Schedule (leave blank to send now)">
          <input type="datetime-local" value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)} style={styles.input} />
        </Field>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.actions}>
          <button onClick={onClose} style={styles.cancel}>Cancel</button>
          <button onClick={handleSend} disabled={busy} style={styles.send}>
            {busy ? 'Sending…' : scheduledAt ? 'Schedule' : 'Send now'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
      <div style={{ fontSize: fontSizes.xs, color: colors.textMuted, fontWeight: fontWeights.medium }}>{label}</div>
      {children}
    </div>
  );
}

const styles = {
  backdrop: {
    position: 'fixed', inset: 0,
    background: colors.bgOverlay, zIndex: zIndex.modal,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    width: '90%', maxWidth: 480,
    background: colors.bgModal, border: `1px solid ${colors.border}`,
    borderRadius: radii.lg, boxShadow: shadows.modal,
    padding: spacing.xxl, display: 'flex', flexDirection: 'column', gap: spacing.md,
  },
  title: { fontSize: fontSizes.lg, fontWeight: fontWeights.semibold, color: colors.text },
  tabs: { display: 'flex', gap: spacing.xs, borderBottom: `1px solid ${colors.border}`, paddingBottom: spacing.sm },
  tab: {
    padding: `${spacing.xs}px ${spacing.md}px`, background: 'transparent',
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.textMuted, fontSize: fontSizes.xs, cursor: 'pointer', fontFamily: 'inherit',
  },
  tabActive: { color: colors.accentFg, background: colors.accentSoft, border: `1px solid ${colors.accentBorder}` },
  input: {
    padding: `${spacing.sm}px ${spacing.md}px`, background: colors.bgInput,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.text, fontSize: fontSizes.sm, fontFamily: 'inherit', outline: 'none', width: '100%',
  },
  error: {
    padding: spacing.sm, background: colors.danger.bg, color: colors.danger.fg,
    border: `1px solid ${colors.danger.border}`, borderRadius: radii.sm, fontSize: fontSizes.xs,
  },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  cancel: {
    padding: `${spacing.sm}px ${spacing.lg}px`, background: 'transparent',
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.textMuted, cursor: 'pointer', fontSize: fontSizes.sm, fontFamily: 'inherit',
  },
  send: {
    padding: `${spacing.sm}px ${spacing.lg}px`, background: colors.accent,
    border: 'none', borderRadius: radii.sm,
    color: '#fff', cursor: 'pointer', fontSize: fontSizes.sm, fontWeight: fontWeights.medium, fontFamily: 'inherit',
  },
};
