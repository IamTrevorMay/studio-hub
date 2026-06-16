import React, { useState } from 'react';
import { supabase } from '../../../supabaseClient';
import { Send, Beaker, X } from 'lucide-react';

// Send dialog. Two modes:
//   - Test send → calls mailer-send-now w/ { test_recipients }.
//   - Audience send → calls mailer-send-now w/ { campaign_id } only.
// Both call the same edge fn; the test branch is short-circuited inside.

export default function SendDialog({ campaign, audience, onClose, onSent }) {
  const [mode, setMode] = useState('test'); // 'test' | 'audience'
  const [emails, setEmails] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const audienceCount = audience?._count ?? null;
  const canAudience = !!campaign.audience_id;

  async function send() {
    setSending(true); setError(null); setResult(null);
    try {
      const payload = mode === 'test'
        ? { campaign_id: campaign.id, test_recipients: emails.split(/[,\s]+/).filter(Boolean) }
        : { campaign_id: campaign.id };
      if (mode === 'test' && payload.test_recipients.length === 0) {
        setError('Enter at least one email address.');
        setSending(false);
        return;
      }
      const { data, error: fnErr } = await supabase.functions.invoke('mailer-send-now', { body: payload });
      if (fnErr || data?.error) throw new Error(fnErr?.message || data?.error);
      setResult({ ok: true, count: data?.sent ?? 0, test: mode === 'test' });
      if (mode === 'audience' && onSent) onSent();
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>Send "{campaign.name}"</span>
          <button onClick={onClose} style={styles.closeBtn}><X size={16} /></button>
        </div>

        <div style={styles.tabs}>
          <button
            onClick={() => setMode('test')}
            style={{ ...styles.tab, ...(mode === 'test' ? styles.tabActive : {}) }}
          >
            <Beaker size={13} style={{ marginRight: 4 }} />Test send
          </button>
          <button
            onClick={() => setMode('audience')}
            disabled={!canAudience}
            style={{
              ...styles.tab,
              ...(mode === 'audience' ? styles.tabActive : {}),
              ...(canAudience ? {} : styles.tabDisabled),
            }}
            title={canAudience ? '' : 'Pick an audience in Settings first'}
          >
            <Send size={13} style={{ marginRight: 4 }} />To audience
          </button>
        </div>

        <div style={styles.body}>
          {mode === 'test' ? (
            <>
              <div style={styles.help}>
                Render the campaign and send to up to 5 explicit recipients.
                Skips tracking and the audience queue — purely for inbox QA.
              </div>
              <label style={styles.fieldLabel}>Recipient emails</label>
              <textarea
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                placeholder="alice@example.com, bob@example.com"
                style={{ ...styles.input, minHeight: 80 }}
                autoFocus
              />
              <div style={styles.helpSmall}>Comma- or newline-separated. Max 5.</div>
            </>
          ) : (
            <>
              <div style={styles.help}>
                Send the campaign to its full audience right now.
                Suppressions are skipped. Status flips to <code>sent</code>.
              </div>
              <div style={styles.summary}>
                <div><strong>Audience:</strong> {audience?.name || '—'}</div>
                {audienceCount != null && (
                  <div><strong>Subscribers:</strong> {audienceCount}</div>
                )}
                <div><strong>Subject:</strong> {campaign.subject || <span style={{ color: '#f87171' }}>missing</span>}</div>
                <div><strong>From:</strong> {campaign.from_email || '(default)'}</div>
              </div>
              {!campaign.subject?.trim() && (
                <div style={styles.warn}>Subject is empty — go back and set one before sending.</div>
              )}
            </>
          )}

          {error && <div style={styles.error}>{error}</div>}
          {result && (
            <div style={styles.success}>
              ✓ Sent to {result.count} recipient{result.count === 1 ? '' : 's'}
              {result.test ? ' (test)' : ''}.
            </div>
          )}
        </div>

        <div style={styles.footer}>
          <button onClick={onClose} style={styles.cancelBtn}>Close</button>
          <button
            onClick={send}
            disabled={sending || (mode === 'audience' && (!canAudience || !campaign.subject?.trim()))}
            style={mode === 'test' ? styles.primaryBtn : styles.dangerBtn}
          >
            {sending ? 'Sending…' : mode === 'test' ? 'Send test' : 'Send to audience'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 24,
  },
  modal: {
    background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 12, width: 'min(520px, 96vw)', maxHeight: '90vh',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  title: { fontSize: 14, fontWeight: 700, color: '#fff' },
  closeBtn: {
    background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
    color: 'rgba(255,255,255,0.6)', borderRadius: 6,
    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  tabs: { display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  tab: {
    flex: 1, padding: '12px 14px', background: 'transparent', border: 'none',
    color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderBottom: '2px solid transparent',
  },
  tabActive: { color: '#fff', borderBottom: '2px solid #818cf8' },
  tabDisabled: { opacity: 0.4, cursor: 'not-allowed' },
  body: { padding: 18, display: 'flex', flexDirection: 'column', gap: 10 },
  help: { fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 },
  helpSmall: { fontSize: 11, color: 'rgba(255,255,255,0.4)' },
  fieldLabel: { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.55)', letterSpacing: 0.4, textTransform: 'uppercase' },
  input: {
    background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6, padding: '8px 10px', color: '#fff', fontSize: 13,
    outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', width: '100%',
    resize: 'vertical',
  },
  summary: {
    padding: 12, background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8,
    fontSize: 12, color: 'rgba(255,255,255,0.8)',
    display: 'flex', flexDirection: 'column', gap: 4,
  },
  warn: {
    padding: 10, background: 'rgba(245,158,11,0.1)', color: '#fbbf24',
    border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, fontSize: 12,
  },
  error: {
    padding: 10, background: 'rgba(239,68,68,0.1)', color: '#f87171',
    border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, fontSize: 12,
  },
  success: {
    padding: 10, background: 'rgba(34,197,94,0.1)', color: '#4ade80',
    border: '1px solid rgba(34,197,94,0.3)', borderRadius: 6, fontSize: 12,
  },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: 8,
    padding: '12px 18px', borderTop: '1px solid rgba(255,255,255,0.08)',
  },
  primaryBtn: {
    background: '#6366f1', color: '#fff', border: 'none',
    borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  dangerBtn: {
    background: '#dc2626', color: '#fff', border: 'none',
    borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  cancelBtn: {
    background: 'transparent', color: 'rgba(255,255,255,0.6)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
};
