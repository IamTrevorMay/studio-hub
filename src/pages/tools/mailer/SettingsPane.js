import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../supabaseClient';
import { colors } from '../../../lib/styleTokens';

// Settings tab for the Mailer:
//   - Sender domains list + add + verify (calls mailer-domain edge fn,
//     which talks to Resend's /domains API).
//   - Suppression list (read-only for now; remove single-row UI to come).
//
// Verification flow:
//   1. Click "Add domain", enter domain. Edge fn calls Resend addDomain
//      and returns the DKIM/SPF DNS records.
//   2. Display records, user pastes them into their DNS provider.
//   3. Click "Verify" — edge fn re-checks Resend's status.

export default function SettingsPane() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <DomainsSection />
      <SuppressionSection />
    </div>
  );
}

function DomainsSection() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [domain, setDomain] = useState('');
  const [working, setWorking] = useState(false);
  const [records, setRecords] = useState(null); // { domain, dns: [...] }

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error } = await supabase
      .from('mailer_sender_domains')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) setError(error.message); else setRows(data || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function addDomain() {
    const d = domain.trim().toLowerCase();
    if (!d.includes('.')) { setError('Enter a valid domain (e.g. maydaystudio.app)'); return; }
    setWorking(true); setError(null);
    const { data, error } = await supabase.functions.invoke('mailer-domain', {
      body: { op: 'add', domain: d },
    });
    setWorking(false);
    if (error || data?.error) { setError(error?.message || data?.error); return; }
    setRecords({ domain: d, dns: data?.records || [] });
    setDomain('');
    setAdding(false);
    load();
  }

  async function verify(row) {
    setWorking(true); setError(null);
    const { data, error } = await supabase.functions.invoke('mailer-domain', {
      body: { op: 'verify', domain_id: row.id },
    });
    setWorking(false);
    if (error || data?.error) { setError(error?.message || data?.error); return; }
    if (data?.records) setRecords({ domain: row.domain, dns: data.records });
    load();
  }

  async function remove(row) {
    if (!window.confirm(`Remove ${row.domain}?`)) return;
    setWorking(true); setError(null);
    const { error } = await supabase.functions.invoke('mailer-domain', {
      body: { op: 'remove', domain_id: row.id },
    });
    setWorking(false);
    if (error) { setError(error.message); return; }
    load();
  }

  return (
    <div>
      <h3 style={styles.h3}>Sender domains</h3>
      <div style={styles.help}>
        Verify a domain with Resend so emails sent from it pass SPF + DKIM.
        Resend handles the actual DNS check — we just relay add/verify/remove
        through the <code>mailer-domain</code> edge function.
      </div>
      <div style={styles.toolbar}>
        {adding ? (
          <>
            <input
              autoFocus
              placeholder="domain.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              style={styles.input}
            />
            <button style={styles.primaryBtn} onClick={addDomain} disabled={working}>
              {working ? 'Adding…' : 'Add'}
            </button>
            <button style={styles.cancelBtn} onClick={() => { setAdding(false); setDomain(''); }}>Cancel</button>
          </>
        ) : (
          <button style={styles.primaryBtn} onClick={() => setAdding(true)}>+ Add domain</button>
        )}
      </div>
      {error && <div style={styles.error}>{error}</div>}
      {loading ? (
        <div style={styles.empty}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={styles.empty}>No domains yet.</div>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              {['Domain', 'Verified', 'Resend ID', 'Added', ''].map((h) => <th key={h} style={styles.th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td style={styles.td}>{d.domain}</td>
                <td style={styles.td}>
                  {d.verified_at ? (
                    <span style={{ color: '#22c55e', fontWeight: 600 }}>✓ {new Date(d.verified_at).toLocaleDateString()}</span>
                  ) : (
                    <span style={{ color: '#fbbf24' }}>pending</span>
                  )}
                </td>
                <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 11 }}>{d.resend_domain_id || '—'}</td>
                <td style={styles.td}>{new Date(d.created_at).toLocaleDateString()}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>
                  <button style={styles.smallBtn} onClick={() => verify(d)} disabled={working}>Verify</button>
                  <button style={{ ...styles.smallBtn, color: '#f87171' }} onClick={() => remove(d)} disabled={working}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {records && (
        <div style={styles.dnsBox}>
          <div style={styles.h3}>DNS records for {records.domain}</div>
          <div style={styles.help}>Add these records at your DNS provider, then click Verify.</div>
          {records.dns.length === 0 ? (
            <div style={styles.empty}>Resend returned no records.</div>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  {['Type', 'Name', 'Value', 'Priority', 'TTL'].map((h) => <th key={h} style={styles.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {records.dns.map((r, i) => (
                  <tr key={i}>
                    {/* r.type is the real DNS type (TXT/MX); r.record is Resend's
                        semantic label (DKIM/SPF). Showing the label alone made the
                        MX row look like a TXT record and fail verification. */}
                    <td style={styles.td}>
                      {r.type || r.record}
                      {r.record && r.type && r.record !== r.type && (
                        <span style={{ opacity: 0.5, marginLeft: 6, fontSize: 11 }}>{r.record}</span>
                      )}
                    </td>
                    <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 11 }}>{r.name}</td>
                    <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{r.value}</td>
                    <td style={styles.td}>{r.priority ?? '—'}</td>
                    <td style={styles.td}>{r.ttl || 'auto'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button style={styles.cancelBtn} onClick={() => setRecords(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SuppressionSection() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('mailer_suppressions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      setRows(data || []);
      setLoading(false);
    })();
  }, []);

  async function remove(row) {
    if (!window.confirm(`Remove ${row.email} from suppressions? They'll receive sends again.`)) return;
    await supabase.from('mailer_suppressions').delete().eq('email', row.email);
    setRows((r) => r.filter((x) => x.email !== row.email));
  }

  return (
    <div>
      <h3 style={styles.h3}>Suppression list</h3>
      <div style={styles.help}>
        Bounces, complaints, and unsubscribes land here automatically. Suppressed
        addresses are skipped at send time even if they're still in an audience.
      </div>
      {loading ? (
        <div style={styles.empty}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={styles.empty}>No suppressions.</div>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              {['Email', 'Reason', 'Added', ''].map((h) => <th key={h} style={styles.th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.email}>
                <td style={styles.td}>{s.email}</td>
                <td style={styles.td}>{s.reason}</td>
                <td style={styles.td}>{new Date(s.created_at).toLocaleString()}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>
                  <button style={{ ...styles.smallBtn, color: '#f87171' }} onClick={() => remove(s)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const styles = {
  h3: { fontSize: 14, fontWeight: 700, color: '#fff', margin: '0 0 6px' },
  help: { fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 12, lineHeight: 1.5 },
  toolbar: { display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' },
  primaryBtn: { background: colors.accent, color: colors.white, border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  cancelBtn: { background: 'transparent', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  smallBtn: { background: 'transparent', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', marginLeft: 6 },
  input: { background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '8px 10px', color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'inherit', minWidth: 240 },
  error: { padding: 10, background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, fontSize: 12, marginBottom: 8 },
  empty: { padding: 16, textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 12 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '6px 10px', fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.4)', letterSpacing: 0.5, textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  td: { padding: '7px 10px', fontSize: 12, color: 'rgba(255,255,255,0.85)', borderBottom: '1px solid rgba(255,255,255,0.04)' },
  dnsBox: { marginTop: 18, padding: 14, background: colors.accentA06, border: '1px solid rgba(91, 143, 199,0.25)', borderRadius: 8 }, // style-lint-ignore
};
