import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import usePersistedTab from '../../hooks/usePersistedTab';
import BlockEditor from './mailer/BlockEditor';
import CampaignPreview from './mailer/CampaignPreview';
import CsvImportModal from './mailer/CsvImportModal';
import CampaignStats from './mailer/CampaignStats';
import SettingsPane from './mailer/SettingsPane';
import SendDialog from './mailer/SendDialog';

// Mailer — admin-only newsletter tool.
//
// Schema: mailer_audiences, mailer_subscribers, mailer_audience_subscribers,
//   mailer_campaigns (with `blocks` jsonb), mailer_sends, mailer_events,
//   mailer_suppressions, mailer_sender_domains.
// Edge fns: mailer-send-now, mailer-webhook, mailer-track-open,
//   mailer-track-click, mailer-unsubscribe, mailer-cron-tick, mailer-domain.
// Renderer: supabase/functions/shared/mailer-render.ts + client mirror
//   src/pages/tools/mailer/blockRenderer.js — block schema is the contract.

const TABS = ['Campaigns', 'Audiences', 'Subscribers', 'Sends', 'Settings'];

export default function Mailer({ onBack }) {
  const { isAdmin } = useAuth();
  const [tab, setTab] = usePersistedTab('mailer-tab', 'Campaigns', TABS);

  if (!isAdmin) {
    return (
      <div style={styles.page}>
        <p style={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginTop: 80 }}>
          Admin access required.
        </p>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button onClick={onBack} style={styles.backBtn} title="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 style={styles.title}>Mailer</h1>
        <span style={styles.phaseBadge}>Phase 4 · foundation</span>
      </div>

      <div style={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{ ...styles.tab, ...(t === tab ? styles.tabActive : {}) }}
          >
            {t}
          </button>
        ))}
      </div>

      <div style={styles.body}>
        {tab === 'Campaigns' && <CampaignsPane />}
        {tab === 'Audiences' && <AudiencesPane />}
        {tab === 'Subscribers' && <SubscribersPane />}
        {tab === 'Sends' && <SendsPane />}
        {tab === 'Settings' && <SettingsPane />}
      </div>
    </div>
  );
}

// ─── Campaigns ─────────────────────────────────────────────────

function CampaignsPane() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // campaign object or { __new: true }
  const [audiences, setAudiences] = useState([]);
  const [sending, setSending] = useState(null); // campaign object

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [{ data: c, error: cErr }, { data: a }] = await Promise.all([
      supabase.from('mailer_campaigns').select('*').order('created_at', { ascending: false }),
      supabase.from('mailer_audiences').select('id, name').order('name'),
    ]);
    if (cErr) setError(cErr.message); else setRows(c || []);
    setAudiences(a || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function createDraft() {
    const { data, error } = await supabase
      .from('mailer_campaigns')
      .insert({ name: 'Untitled campaign', subject: '' })
      .select()
      .single();
    if (error) { setError(error.message); return; }
    setEditing(data);
    load();
  }

  async function remove(c) {
    if (!window.confirm(`Delete campaign "${c.name}"?`)) return;
    const { error } = await supabase.from('mailer_campaigns').delete().eq('id', c.id);
    if (error) { setError(error.message); return; }
    load();
  }

  function openSendDialog(c) {
    setSending(c);
  }

  return (
    <div>
      <div style={styles.toolbar}>
        <button style={styles.primaryBtn} onClick={createDraft}>+ New campaign</button>
      </div>
      {error && <div style={styles.error}>{error}</div>}
      {loading ? (
        <div style={styles.empty}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={styles.empty}>No campaigns yet.</div>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              {['Name', 'Subject', 'Status', 'Audience', 'Recipients', 'Sent', ''].map((h) => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const aud = audiences.find((a) => a.id === c.audience_id);
              return (
                <tr key={c.id} style={styles.tr}>
                  <td style={styles.td}>
                    <button onClick={() => setEditing(c)} style={styles.linkBtn}>{c.name}</button>
                    {c.is_template && (
                      <span style={{
                        marginLeft: 8, fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                        letterSpacing: '0.04em', color: '#a5b4fc', background: 'rgba(99,102,241,0.15)',
                        padding: '2px 6px', borderRadius: 5,
                      }}>Recurring</span>
                    )}
                  </td>
                  <td style={styles.td}>{c.subject || <span style={styles.muted}>—</span>}</td>
                  <td style={styles.td}><StatusPill status={c.status} /></td>
                  <td style={styles.td}>{aud?.name || <span style={styles.muted}>—</span>}</td>
                  <td style={styles.td}>{c.stats?.recipients ?? 0}</td>
                  <td style={styles.td}>{c.sent_at ? new Date(c.sent_at).toLocaleString() : <span style={styles.muted}>—</span>}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    {/* Templates are armed daily by mailer-arm-daily — sending one
                        directly would double up outside the daily cadence. */}
                    {c.is_template
                      ? <span style={{ ...styles.muted, fontSize: 12, marginRight: 8 }}>sent daily</span>
                      : <button style={styles.smallBtn} onClick={() => openSendDialog(c)}>Send</button>}
                    <button style={{ ...styles.smallBtn, color: '#f87171' }} onClick={() => remove(c)}>Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {editing && (
        <CampaignEditor
          campaign={editing}
          audiences={audiences}
          onClose={() => setEditing(null)}
          onSaved={() => { load(); setEditing(null); }}
        />
      )}
      {sending && (
        <SendDialog
          campaign={sending}
          audience={audiences.find((a) => a.id === sending.audience_id)}
          onClose={() => setSending(null)}
          onSent={() => { load(); setSending(null); }}
        />
      )}
    </div>
  );
}

function CampaignEditor({ campaign, audiences, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: campaign.name || '',
    subject: campaign.subject || '',
    preheader: campaign.preheader || '',
    from_name: campaign.from_name || '',
    from_email: campaign.from_email || '',
    reply_to: campaign.reply_to || '',
    audience_id: campaign.audience_id || '',
    blocks: Array.isArray(campaign.blocks) ? campaign.blocks : [],
    scheduled_at: campaign.scheduled_at ? toLocalInput(campaign.scheduled_at) : '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [pane, setPane] = useState('content'); // 'content' | 'settings' | 'stats'

  function patch(p) { setForm((f) => ({ ...f, ...p })); }

  async function save(extra = {}) {
    setSaving(true); setError(null);
    const { error } = await supabase.from('mailer_campaigns').update({
      name: form.name.trim() || 'Untitled',
      subject: form.subject,
      preheader: form.preheader || null,
      from_name: form.from_name || null,
      from_email: form.from_email || null,
      reply_to: form.reply_to || null,
      audience_id: form.audience_id || null,
      blocks: Array.isArray(form.blocks) ? form.blocks : [],
      ...extra,
    }).eq('id', campaign.id);
    setSaving(false);
    if (error) { setError(error.message); return false; }
    onSaved();
    return true;
  }

  async function schedule() {
    if (!form.scheduled_at) { setError('Pick a date/time first.'); return; }
    const iso = new Date(form.scheduled_at).toISOString();
    if (Date.now() >= new Date(iso).getTime()) {
      setError('Scheduled time must be in the future.');
      return;
    }
    const ok = await save({ scheduled_at: iso, status: 'scheduled' });
    if (ok) onClose();
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={{ ...styles.modal, width: 'min(1100px, 96vw)', height: 'min(820px, 92vh)' }} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>
            {campaign.status === 'sent' ? 'Sent campaign' : 'Edit campaign'} · {form.name || 'Untitled'}
          </h2>
          <div style={{ display: 'flex', gap: 4 }}>
            {['content', 'settings', 'stats'].map((p) => (
              <button
                key={p}
                onClick={() => setPane(p)}
                style={{ ...styles.modalTab, ...(pane === p ? styles.modalTabActive : {}) }}
              >
                {p}
              </button>
            ))}
          </div>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div style={{ ...styles.modalBody, display: 'flex', gap: 16, minHeight: 0, padding: 0 }}>
          {pane === 'content' && (
            <>
              <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '16px 24px' }}>
                <BlockEditor
                  blocks={form.blocks}
                  onChange={(blocks) => patch({ blocks })}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0, padding: '16px 24px 16px 0', display: 'flex', flexDirection: 'column' }}>
                <CampaignPreview
                  subject={form.subject}
                  preheader={form.preheader}
                  blocks={form.blocks}
                />
              </div>
            </>
          )}

          {pane === 'settings' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
              <Field label="Name"><Text value={form.name} onChange={(v) => patch({ name: v })} /></Field>
              <Field label="Subject *"><Text value={form.subject} onChange={(v) => patch({ subject: v })} /></Field>
              <Field label="Preheader"><Text value={form.preheader} onChange={(v) => patch({ preheader: v })} /></Field>
              <Row>
                <Field label="From name"><Text value={form.from_name} onChange={(v) => patch({ from_name: v })} /></Field>
                <Field label="From email"><Text value={form.from_email} onChange={(v) => patch({ from_email: v })} placeholder="noreply@maydaystudio.net" /></Field>
              </Row>
              <Field label="Reply-to"><Text value={form.reply_to} onChange={(v) => patch({ reply_to: v })} /></Field>
              <Field label="Audience">
                <select value={form.audience_id} onChange={(e) => patch({ audience_id: e.target.value })} style={styles.input}>
                  <option value="">— None —</option>
                  {audiences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
              <Field label="Schedule send (optional)">
                <input
                  type="datetime-local"
                  value={form.scheduled_at}
                  onChange={(e) => patch({ scheduled_at: e.target.value })}
                  style={styles.input}
                />
                <div style={styles.helpText}>
                  Setting this and clicking "Schedule" flips the campaign to scheduled. The mailer-cron-tick job will dispatch it once the time hits.
                </div>
              </Field>
            </div>
          )}

          {pane === 'stats' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
              <CampaignStats campaignId={campaign.id} />
            </div>
          )}
        </div>

        {error && <div style={{ ...styles.error, margin: '0 24px 8px' }}>{error}</div>}

        <div style={styles.modalFooter}>
          {pane === 'settings' && (
            <button style={styles.secondaryBtn} onClick={schedule} disabled={saving || !form.scheduled_at}>
              Schedule
            </button>
          )}
          <button style={styles.cancelBtn} onClick={onClose}>Close</button>
          <button style={styles.primaryBtn} onClick={() => save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// `datetime-local` wants `YYYY-MM-DDTHH:mm` in local time; convert from ISO.
function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Audiences ─────────────────────────────────────────────────

function AudiencesPane() {
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', description: '' });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error } = await supabase
      .from('mailer_audiences')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) setError(error.message); else setRows(data || []);
    // Count subscribers per audience separately to avoid loading the join table.
    if (data && data.length > 0) {
      const { data: join } = await supabase
        .from('mailer_audience_subscribers')
        .select('audience_id');
      const tally = {};
      for (const r of (join || [])) tally[r.audience_id] = (tally[r.audience_id] || 0) + 1;
      setCounts(tally);
    } else {
      setCounts({});
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!draft.name.trim()) return;
    const { error } = await supabase.from('mailer_audiences').insert({
      name: draft.name.trim(),
      description: draft.description.trim() || null,
    });
    if (error) { setError(error.message); return; }
    setDraft({ name: '', description: '' });
    setCreating(false);
    load();
  }

  async function remove(a) {
    if (!window.confirm(`Delete audience "${a.name}"? Subscribers are kept.`)) return;
    const { error } = await supabase.from('mailer_audiences').delete().eq('id', a.id);
    if (error) { setError(error.message); return; }
    load();
  }

  return (
    <div>
      <div style={styles.toolbar}>
        {creating ? (
          <div style={{ display: 'flex', gap: 8, flex: 1 }}>
            <input
              placeholder="Audience name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              style={styles.input}
              autoFocus
            />
            <input
              placeholder="Description (optional)"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              style={styles.input}
            />
            <button style={styles.primaryBtn} onClick={create}>Save</button>
            <button style={styles.cancelBtn} onClick={() => { setCreating(false); setDraft({ name: '', description: '' }); }}>Cancel</button>
          </div>
        ) : (
          <button style={styles.primaryBtn} onClick={() => setCreating(true)}>+ New audience</button>
        )}
      </div>
      {error && <div style={styles.error}>{error}</div>}
      {loading ? (
        <div style={styles.empty}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={styles.empty}>No audiences yet.</div>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              {['Name', 'Description', 'Subscribers', 'Created', ''].map((h) => <th key={h} style={styles.th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} style={styles.tr}>
                <td style={styles.td}>{a.name}</td>
                <td style={styles.td}>{a.description || <span style={styles.muted}>—</span>}</td>
                <td style={styles.td}>{counts[a.id] || 0}</td>
                <td style={styles.td}>{new Date(a.created_at).toLocaleDateString()}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>
                  <button style={{ ...styles.smallBtn, color: '#f87171' }} onClick={() => remove(a)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Subscribers ───────────────────────────────────────────────

function SubscribersPane() {
  const [rows, setRows] = useState([]);
  const [audiences, setAudiences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [draft, setDraft] = useState({ email: '', name: '', audience_id: '' });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [{ data, error }, { data: a }] = await Promise.all([
      supabase.from('mailer_subscribers').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('mailer_audiences').select('id, name').order('name'),
    ]);
    if (error) setError(error.message); else setRows(data || []);
    setAudiences(a || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    const email = draft.email.trim().toLowerCase();
    if (!email || !email.includes('@')) { setError('Valid email required'); return; }
    const { data: sub, error } = await supabase
      .from('mailer_subscribers')
      .upsert({ email, name: draft.name.trim() || null }, { onConflict: 'email' })
      .select()
      .single();
    if (error) { setError(error.message); return; }
    if (draft.audience_id) {
      await supabase.from('mailer_audience_subscribers').upsert({
        audience_id: draft.audience_id,
        subscriber_id: sub.id,
      }, { onConflict: 'audience_id,subscriber_id' });
    }
    setDraft({ email: '', name: '', audience_id: '' });
    setAdding(false);
    load();
  }

  return (
    <div>
      <div style={styles.toolbar}>
        {adding ? (
          <div style={{ display: 'flex', gap: 8, flex: 1, flexWrap: 'wrap' }}>
            <input placeholder="email@example.com" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} style={{ ...styles.input, flex: 1 }} autoFocus />
            <input placeholder="Name (optional)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={{ ...styles.input, flex: 1 }} />
            <select value={draft.audience_id} onChange={(e) => setDraft({ ...draft, audience_id: e.target.value })} style={styles.input}>
              <option value="">No audience</option>
              {audiences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button style={styles.primaryBtn} onClick={add}>Add</button>
            <button style={styles.cancelBtn} onClick={() => { setAdding(false); setDraft({ email: '', name: '', audience_id: '' }); }}>Cancel</button>
          </div>
        ) : (
          <>
            <button style={styles.primaryBtn} onClick={() => setAdding(true)}>+ Add subscriber</button>
            <button style={styles.secondaryBtn} onClick={() => setImporting(true)}>Import CSV</button>
          </>
        )}
      </div>
      {error && <div style={styles.error}>{error}</div>}
      {loading ? (
        <div style={styles.empty}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={styles.empty}>No subscribers yet.</div>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              {['Email', 'Name', 'Status', 'Added'].map((h) => <th key={h} style={styles.th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} style={styles.tr}>
                <td style={styles.td}>{s.email}</td>
                <td style={styles.td}>{s.name || <span style={styles.muted}>—</span>}</td>
                <td style={styles.td}><StatusPill status={s.status} /></td>
                <td style={styles.td}>{new Date(s.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <CsvImportModal
        open={importing}
        onClose={() => setImporting(false)}
        audiences={audiences}
        onImported={load}
      />
    </div>
  );
}

// ─── Sends (audit log) ─────────────────────────────────────────

function SendsPane() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('mailer_sends')
        .select('id, email, status, sent_at, opened_at, clicked_at, error_message, campaign:mailer_campaigns(name)')
        .order('created_at', { ascending: false })
        .limit(200);
      setRows(data || []);
      setLoading(false);
    })();
  }, []);
  return loading ? (
    <div style={styles.empty}>Loading…</div>
  ) : rows.length === 0 ? (
    <div style={styles.empty}>No sends yet.</div>
  ) : (
    <table style={styles.table}>
      <thead>
        <tr>
          {['Campaign', 'Recipient', 'Status', 'Sent', 'Opened', 'Clicked', 'Error'].map((h) => <th key={h} style={styles.th}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.id} style={styles.tr}>
            <td style={styles.td}>{s.campaign?.name || <span style={styles.muted}>—</span>}</td>
            <td style={styles.td}>{s.email}</td>
            <td style={styles.td}><StatusPill status={s.status} /></td>
            <td style={styles.td}>{s.sent_at ? new Date(s.sent_at).toLocaleString() : <span style={styles.muted}>—</span>}</td>
            <td style={styles.td}>{s.opened_at ? new Date(s.opened_at).toLocaleString() : <span style={styles.muted}>—</span>}</td>
            <td style={styles.td}>{s.clicked_at ? new Date(s.clicked_at).toLocaleString() : <span style={styles.muted}>—</span>}</td>
            <td style={{ ...styles.td, color: '#f87171', fontSize: 11 }}>{s.error_message || ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Bits ──────────────────────────────────────────────────────

function StatusPill({ status }) {
  const colorMap = {
    draft:        { bg: 'rgba(148,163,184,0.15)', fg: '#94a3b8' },
    scheduled:    { bg: 'rgba(96,165,250,0.15)',  fg: '#60a5fa' },
    sending:      { bg: 'rgba(251,191,36,0.15)',  fg: '#fbbf24' },
    sent:         { bg: 'rgba(34,197,94,0.15)',   fg: '#22c55e' },
    failed:       { bg: 'rgba(239,68,68,0.15)',   fg: '#f87171' },
    paused:       { bg: 'rgba(168,85,247,0.15)',  fg: '#a855f7' },
    queued:       { bg: 'rgba(148,163,184,0.15)', fg: '#94a3b8' },
    delivered:    { bg: 'rgba(34,197,94,0.15)',   fg: '#22c55e' },
    opened:       { bg: 'rgba(59,130,246,0.15)',  fg: '#60a5fa' },
    clicked:      { bg: 'rgba(99,102,241,0.15)',  fg: '#818cf8' },
    bounced:      { bg: 'rgba(239,68,68,0.15)',   fg: '#f87171' },
    complained:   { bg: 'rgba(244,114,182,0.15)', fg: '#f472b6' },
    active:       { bg: 'rgba(34,197,94,0.15)',   fg: '#22c55e' },
    unsubscribed: { bg: 'rgba(148,163,184,0.15)', fg: '#94a3b8' },
  };
  const c = colorMap[status] || colorMap.draft;
  return <span style={{ ...styles.pill, background: c.bg, color: c.fg }}>{status}</span>;
}

function Field({ label, children }) {
  return (
    <label style={styles.fieldWrap}>
      <span style={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}
function Row({ children }) { return <div style={{ display: 'flex', gap: 12 }}>{children}</div>; }
function Text({ value, onChange, placeholder }) {
  return <input value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={styles.input} />;
}

// ─── Styles ────────────────────────────────────────────────────

const styles = {
  page: { padding: '24px 32px', minHeight: '100vh', color: '#fff', fontFamily: 'inherit' },
  header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },
  backBtn: { width: 32, height: 32, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: 800, color: '#fff', margin: 0 },
  phaseBadge: { fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', padding: '3px 8px', borderRadius: 999, background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.3)' },
  tabs: { display: 'flex', gap: 4, borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 20 },
  tab: { background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.5)', padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', borderBottom: '2px solid transparent', fontFamily: 'inherit' },
  tabActive: { color: '#fff', borderBottomColor: '#6366f1' },
  body: {},
  toolbar: { display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' },
  primaryBtn: { background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  secondaryBtn: { background: 'rgba(99,102,241,0.15)', color: '#c7d2fe', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  cancelBtn: { background: 'transparent', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  modalTab: { background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, color: 'rgba(255,255,255,0.5)', padding: '4px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, cursor: 'pointer', fontFamily: 'inherit' },
  modalTabActive: { background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.4)', color: '#c7d2fe' },
  smallBtn: { background: 'transparent', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', marginLeft: 6 },
  linkBtn: { background: 'transparent', color: '#a5b4fc', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 },
  empty: { padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 13 },
  error: { padding: 12, marginBottom: 12, background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, fontSize: 13 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.4)', letterSpacing: 0.5, textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  td: { padding: '10px 12px', fontSize: 13, color: 'rgba(255,255,255,0.85)', borderBottom: '1px solid rgba(255,255,255,0.04)' },
  tr: {},
  muted: { color: 'rgba(255,255,255,0.3)' },
  pill: { display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' },
  input: { background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '8px 10px', color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', width: '100%' },
  fieldWrap: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, marginBottom: 12 },
  fieldLabel: { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', letterSpacing: 0.4, textTransform: 'uppercase' },
  helpText: { fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 4 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, width: 600, maxWidth: '92vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  modalTitle: { fontSize: 18, fontWeight: 700, color: '#fff', margin: 0 },
  closeBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 26, cursor: 'pointer', padding: 0 },
  modalBody: { padding: '16px 24px', overflowY: 'auto', flex: 1 },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 24px', borderTop: '1px solid rgba(255,255,255,0.06)' },
};
