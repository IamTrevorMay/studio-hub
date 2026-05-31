import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';

// Admin-only Jobs page: manage public listings, review applications, and run
// onboarding for accepted hires. Public board + edge functions live elsewhere.

const TYPE_OPTS = [
  { v: 'full_time', l: 'Full-time' }, { v: 'part_time', l: 'Part-time' },
  { v: 'contract', l: 'Contract' }, { v: 'freelance', l: 'Freelance' },
];
const MODE_OPTS = [{ v: 'remote', l: 'Remote' }, { v: 'hybrid', l: 'Hybrid' }, { v: 'onsite', l: 'On-site' }];
const APP_STATUSES = ['new', 'reviewing', 'interview', 'accepted', 'declined'];
const STATUS_COLOR = {
  new: { bg: 'rgba(255,255,255,0.08)', fg: 'rgba(255,255,255,0.7)' },
  reviewing: { bg: 'rgba(56,189,248,0.15)', fg: '#7dd3fc' },
  interview: { bg: 'rgba(234,179,8,0.15)', fg: '#fde68a' },
  accepted: { bg: 'rgba(34,197,94,0.15)', fg: '#86efac' },
  declined: { bg: 'rgba(239,68,68,0.12)', fg: '#fca5a5' },
};

function slugify(str) {
  return (str || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

export default function Jobs() {
  const [tab, setTab] = useState('listings');
  const [listings, setListings] = useState([]);
  const [applications, setApplications] = useState([]);
  const [onboarding, setOnboarding] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchAll = useCallback(async () => {
    const [lRes, aRes, oRes] = await Promise.all([
      supabase.from('job_listings').select('*').order('position').order('created_at', { ascending: false }),
      supabase.from('job_applications').select('*, listing:job_listings(title)').order('created_at', { ascending: false }),
      supabase.from('job_onboarding').select('*, application:job_applications(applicant_name, applicant_email, listing:job_listings(title))').order('created_at', { ascending: false }),
    ]);
    setListings(lRes.data || []);
    setApplications(aRes.data || []);
    setOnboarding(oRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const counts = useMemo(() => ({
    open: listings.filter(l => l.status === 'open').length,
    newApps: applications.filter(a => a.status === 'new').length,
    onboarding: onboarding.filter(o => o.status === 'in_progress').length,
  }), [listings, applications, onboarding]);

  return (
    <div style={st.page}>
      {toast && <div style={{ ...st.toast, background: toast.type === 'error' ? '#dc2626' : '#16a34a' }}>{toast.message}</div>}

      <h1 style={st.h1}>Jobs</h1>
      <div style={st.tabs}>
        <Tab on={tab === 'listings'} onClick={() => setTab('listings')}>Listings {counts.open ? <Badge>{counts.open} open</Badge> : null}</Tab>
        <Tab on={tab === 'applications'} onClick={() => setTab('applications')}>Applications {counts.newApps ? <Badge>{counts.newApps} new</Badge> : null}</Tab>
        <Tab on={tab === 'onboarding'} onClick={() => setTab('onboarding')}>Onboarding {counts.onboarding ? <Badge>{counts.onboarding}</Badge> : null}</Tab>
      </div>

      {loading ? <p style={st.muted}>Loading…</p> : (
        <>
          {tab === 'listings' && <ListingsTab listings={listings} onChange={fetchAll} showToast={showToast} />}
          {tab === 'applications' && <ApplicationsTab applications={applications} listings={listings} onChange={fetchAll} showToast={showToast} />}
          {tab === 'onboarding' && <OnboardingTab onboarding={onboarding} onChange={fetchAll} showToast={showToast} />}
        </>
      )}
    </div>
  );
}

function Tab({ on, onClick, children }) {
  return <button style={{ ...st.tab, ...(on ? st.tabOn : {}) }} onClick={onClick}>{children}</button>;
}
function Badge({ children }) {
  return <span style={st.badge}>{children}</span>;
}

// ─── Listings ───────────────────────────────────────────────
function ListingsTab({ listings, onChange, showToast }) {
  const [editing, setEditing] = useState(null); // listing obj or {} for new

  const copyLink = (l) => {
    const url = `${window.location.origin}/careers/${l.slug || l.id}`;
    navigator.clipboard?.writeText(url);
    showToast('Public link copied');
  };
  const setStatus = async (l, status) => {
    const patch = { status, updated_at: new Date().toISOString() };
    if (status === 'open' && !l.published_at) patch.published_at = new Date().toISOString();
    const { error } = await supabase.from('job_listings').update(patch).eq('id', l.id);
    if (error) showToast(error.message, 'error'); else { showToast(`Listing ${status}`); onChange(); }
  };
  const remove = async (l) => {
    const { error } = await supabase.from('job_listings').delete().eq('id', l.id);
    if (error) showToast(error.message, 'error'); else { showToast('Listing deleted'); onChange(); }
  };

  return (
    <div>
      <div style={st.toolbar}>
        <button style={st.primaryBtn} onClick={() => setEditing({})}>+ New listing</button>
      </div>
      {listings.length === 0 ? <div style={st.empty}>No listings yet. Create one to post a role.</div> : (
        <div style={st.cards}>
          {listings.map(l => (
            <div key={l.id} style={st.listingCard}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={st.listingTitle}>
                  {l.title}
                  <span style={{ ...st.statusPill, ...statusPillStyle(l.status) }}>{l.status}</span>
                </div>
                <div style={st.listingMeta}>
                  {[l.department, l.employment_type && TYPE_OPTS.find(t => t.v === l.employment_type)?.l, l.work_mode && MODE_OPTS.find(m => m.v === l.work_mode)?.l, l.comp_range].filter(Boolean).join('  ·  ')}
                </div>
              </div>
              <div style={st.listingActions}>
                <button style={st.smallBtn} onClick={() => setEditing(l)}>Edit</button>
                {l.status !== 'open' && <button style={st.smallBtn} onClick={() => setStatus(l, 'open')}>Publish</button>}
                {l.status === 'open' && <button style={st.smallBtn} onClick={() => setStatus(l, 'closed')}>Close</button>}
                {l.status === 'open' && <button style={st.smallBtn} onClick={() => copyLink(l)}>Copy link</button>}
                <button style={{ ...st.smallBtn, color: '#fca5a5' }} onClick={() => remove(l)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <ListingModal listing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChange(); }} showToast={showToast} />}
    </div>
  );
}

function ListingModal({ listing, onClose, onSaved, showToast }) {
  const [f, setF] = useState({
    title: listing.title || '', description: listing.description || '',
    employment_type: listing.employment_type || '', work_mode: listing.work_mode || '',
    location: listing.location || '', comp_range: listing.comp_range || '',
    department: listing.department || '', status: listing.status || 'draft',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  const save = async () => {
    if (!f.title.trim()) { showToast('Title is required', 'error'); return; }
    setSaving(true);
    const payload = {
      title: f.title.trim(), description: f.description || null,
      employment_type: f.employment_type || null, work_mode: f.work_mode || null,
      location: f.location.trim() || null, comp_range: f.comp_range.trim() || null,
      department: f.department.trim() || null, status: f.status,
      updated_at: new Date().toISOString(),
    };
    let error;
    if (listing.id) {
      ({ error } = await supabase.from('job_listings').update(payload).eq('id', listing.id));
    } else {
      const base = slugify(f.title) || 'role';
      payload.slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
      if (f.status === 'open') payload.published_at = new Date().toISOString();
      ({ error } = await supabase.from('job_listings').insert(payload));
    }
    setSaving(false);
    if (error) showToast(error.message, 'error'); else { showToast(listing.id ? 'Saved' : 'Listing created'); onSaved(); }
  };

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={e => e.stopPropagation()}>
        <h3 style={st.modalTitle}>{listing.id ? 'Edit listing' : 'New listing'}</h3>
        <L label="Title"><input style={st.input} value={f.title} onChange={e => set('title', e.target.value)} /></L>
        <L label="Description"><textarea style={st.textarea} rows={6} value={f.description} onChange={e => set('description', e.target.value)} placeholder="Role overview, responsibilities, requirements…" /></L>
        <div style={st.modalGrid}>
          <L label="Employment type">
            <select style={st.input} value={f.employment_type} onChange={e => set('employment_type', e.target.value)}>
              <option value="">—</option>{TYPE_OPTS.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
          </L>
          <L label="Work mode">
            <select style={st.input} value={f.work_mode} onChange={e => set('work_mode', e.target.value)}>
              <option value="">—</option>{MODE_OPTS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
          </L>
        </div>
        <div style={st.modalGrid}>
          <L label="Location"><input style={st.input} value={f.location} onChange={e => set('location', e.target.value)} placeholder="Remote (US)" /></L>
          <L label="Compensation"><input style={st.input} value={f.comp_range} onChange={e => set('comp_range', e.target.value)} placeholder="$60–80k / $40/hr" /></L>
        </div>
        <div style={st.modalGrid}>
          <L label="Department"><input style={st.input} value={f.department} onChange={e => set('department', e.target.value)} placeholder="Video, Social…" /></L>
          <L label="Status">
            <select style={st.input} value={f.status} onChange={e => set('status', e.target.value)}>
              <option value="draft">Draft (hidden)</option><option value="open">Open (public)</option><option value="closed">Closed</option>
            </select>
          </L>
        </div>
        <div style={st.modalActions}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={st.primaryBtn} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Applications ───────────────────────────────────────────
function ApplicationsTab({ applications, listings, onChange, showToast }) {
  const [fStatus, setFStatus] = useState('all');
  const [fListing, setFListing] = useState('all');
  const [selected, setSelected] = useState(null);

  const filtered = applications.filter(a =>
    (fStatus === 'all' || a.status === fStatus) &&
    (fListing === 'all' || a.listing_id === fListing));

  const review = async (app, action, extra = {}) => {
    const { data, error } = await supabase.functions.invoke('jobs-review', { body: { action, application_id: app.id, ...extra } });
    if (error || data?.error) { showToast(data?.error || error?.message || 'Failed', 'error'); return; }
    if (data?.invite_warning) showToast('Accepted — invite note: ' + data.invite_warning, 'error');
    else showToast(`Application ${action === 'set_status' ? extra.status : action}`);
    setSelected(null);
    onChange();
  };

  return (
    <div>
      <div style={st.filters}>
        <select style={st.filterSel} value={fStatus} onChange={e => setFStatus(e.target.value)}>
          <option value="all">All statuses</option>{APP_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select style={st.filterSel} value={fListing} onChange={e => setFListing(e.target.value)}>
          <option value="all">All roles</option>{listings.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
        </select>
      </div>
      {filtered.length === 0 ? <div style={st.empty}>No applications.</div> : (
        <table style={st.table}>
          <thead><tr>
            <th style={st.th}>Applicant</th><th style={st.th}>Role</th><th style={st.th}>Applied</th><th style={st.th}>Status</th>
          </tr></thead>
          <tbody>
            {filtered.map(a => (
              <tr key={a.id} style={st.tr} onClick={() => setSelected(a)}>
                <td style={st.td}><strong>{a.applicant_name}</strong><div style={st.subEmail}>{a.applicant_email}</div></td>
                <td style={st.td}>{a.listing?.title || '—'}</td>
                <td style={st.td}>{fmtDate(a.created_at)}</td>
                <td style={st.td}><span style={{ ...st.statusPill, ...statusPillStyle(a.status) }}>{a.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {selected && <ApplicationDrawer app={selected} onClose={() => setSelected(null)} onReview={review} showToast={showToast} />}
    </div>
  );
}

function ApplicationDrawer({ app, onClose, onReview, showToast }) {
  const links = Array.isArray(app.portfolio_links) ? app.portfolio_links : [];
  const openResume = async () => {
    if (!app.resume_path) return;
    const { data, error } = await supabase.storage.from('job-resumes').createSignedUrl(app.resume_path, 3600);
    if (error || !data?.signedUrl) { showToast('Could not open résumé', 'error'); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };
  const terminal = app.status === 'accepted' || app.status === 'declined';

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.drawer} onClick={e => e.stopPropagation()}>
        <div style={st.drawerHead}>
          <div>
            <div style={st.drawerName}>{app.applicant_name}</div>
            <div style={st.subEmail}>{app.applicant_email}{app.phone ? `  ·  ${app.phone}` : ''}</div>
          </div>
          <span style={{ ...st.statusPill, ...statusPillStyle(app.status) }}>{app.status}</span>
        </div>
        <div style={st.drawerMeta}>Applied for <strong>{app.listing?.title || '—'}</strong> · {fmtDate(app.created_at)}</div>

        {app.resume_path && <button style={st.linkBtn} onClick={openResume}>📄 Open résumé</button>}
        {links.length > 0 && (
          <div style={st.section}>
            <div style={st.sectionLabel}>Portfolio</div>
            {links.map((u, i) => <a key={i} href={u} target="_blank" rel="noopener noreferrer" style={st.portLink}>{u}</a>)}
          </div>
        )}
        {app.cover_note && (
          <div style={st.section}>
            <div style={st.sectionLabel}>Cover note</div>
            <div style={st.coverNote}>{app.cover_note}</div>
          </div>
        )}

        {!terminal && (
          <div style={st.drawerActions}>
            <div style={st.stageRow}>
              {['new', 'reviewing', 'interview'].map(s => (
                <button key={s} style={{ ...st.stageBtn, ...(app.status === s ? st.stageBtnOn : {}) }}
                  onClick={() => onReview(app, 'set_status', { status: s })}>{s}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button style={st.acceptBtn} onClick={() => onReview(app, 'accept')}>✓ Accept &amp; onboard</button>
              <button style={st.declineBtn} onClick={() => onReview(app, 'decline')}>✕ Decline</button>
            </div>
          </div>
        )}
        {app.status === 'accepted' && <div style={st.acceptedNote}>Accepted — contractor invite sent. Track setup in the Onboarding tab.</div>}
        {app.status === 'declined' && <div style={st.declinedNote}>Declined — applicant has been emailed.</div>}
      </div>
    </div>
  );
}

// ─── Onboarding ─────────────────────────────────────────────
function OnboardingTab({ onboarding, onChange, showToast }) {
  const toggle = async (row, idx) => {
    const checklist = row.checklist.map((c, i) => i === idx ? { ...c, done: !c.done } : c);
    const { data, error } = await supabase.functions.invoke('jobs-review', {
      body: { action: 'onboarding_update', onboarding_id: row.id, checklist },
    });
    if (error || data?.error) showToast(data?.error || error?.message || 'Failed', 'error'); else onChange();
  };

  if (onboarding.length === 0) return <div style={st.empty}>No one in onboarding yet. Accept an application to start.</div>;
  return (
    <div style={st.cards}>
      {onboarding.map(row => {
        const done = (row.checklist || []).filter(c => c.done).length;
        const total = (row.checklist || []).length;
        return (
          <div key={row.id} style={st.onbCard}>
            <div style={st.onbHead}>
              <div>
                <div style={st.listingTitle}>{row.application?.applicant_name || 'Hire'}</div>
                <div style={st.subEmail}>{row.application?.listing?.title || ''} · {row.application?.applicant_email}</div>
              </div>
              <span style={{ ...st.statusPill, ...statusPillStyle(row.status === 'complete' ? 'accepted' : 'interview') }}>
                {done}/{total} {row.status === 'complete' ? '· done' : ''}
              </span>
            </div>
            <div style={st.checklist}>
              {(row.checklist || []).map((c, i) => (
                <label key={i} style={st.checkItem}>
                  <input type="checkbox" checked={!!c.done} onChange={() => toggle(row, i)} />
                  <span style={{ textDecoration: c.done ? 'line-through' : 'none', color: c.done ? 'rgba(255,255,255,0.4)' : '#fff' }}>{c.label}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function statusPillStyle(status) {
  const c = STATUS_COLOR[status] || STATUS_COLOR.new;
  return { background: c.bg, color: c.fg };
}
function L({ label, children }) {
  return <div style={{ marginBottom: 12 }}><label style={st.label}>{label}</label>{children}</div>;
}

const st = {
  page: { padding: '24px 32px', minHeight: '100vh', position: 'relative' },
  toast: { position: 'fixed', top: 20, right: 20, padding: '10px 20px', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' },
  h1: { fontSize: 24, fontWeight: 800, color: '#fff', margin: '0 0 16px' },
  tabs: { display: 'flex', gap: 6, marginBottom: 20, borderBottom: '1px solid rgba(255,255,255,0.08)' },
  tab: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: 600, padding: '8px 14px', cursor: 'pointer', borderBottom: '2px solid transparent', fontFamily: 'inherit' },
  tabOn: { color: '#fff', borderBottom: '2px solid #6366f1' },
  badge: { marginLeft: 6, fontSize: 10, fontWeight: 700, background: '#6366f1', color: '#fff', borderRadius: 999, padding: '1px 7px' },
  muted: { color: 'rgba(255,255,255,0.4)' },
  empty: { padding: 30, textAlign: 'center', background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 12, color: 'rgba(255,255,255,0.4)' },
  toolbar: { marginBottom: 14 },
  primaryBtn: { background: '#6366f1', border: 'none', color: '#fff', borderRadius: 9, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  cancelBtn: { background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)', borderRadius: 9, padding: '9px 16px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
  cards: { display: 'flex', flexDirection: 'column', gap: 10 },
  listingCard: { display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12 },
  listingTitle: { fontSize: 15, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 10 },
  listingMeta: { fontSize: 12.5, color: 'rgba(255,255,255,0.5)', marginTop: 4 },
  listingActions: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  smallBtn: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.75)', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' },
  statusPill: { fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: 0.4 },
  filters: { display: 'flex', gap: 8, marginBottom: 14 },
  filterSel: { background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 8, padding: '7px 10px', fontSize: 13, fontFamily: 'inherit' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  tr: { cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)' },
  td: { padding: '12px', fontSize: 13.5, color: 'rgba(255,255,255,0.85)', verticalAlign: 'top' },
  subEmail: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 },
  modal: { background: '#15151f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: 22, width: 560, maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' },
  modalTitle: { fontSize: 18, fontWeight: 700, color: '#fff', margin: '0 0 16px' },
  modalGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.55)', marginBottom: 5 },
  input: { width: '100%', boxSizing: 'border-box', padding: '9px 11px', background: 'rgba(0,0,0,0.28)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#fff', fontSize: 13.5, outline: 'none', fontFamily: 'inherit' },
  textarea: { width: '100%', boxSizing: 'border-box', padding: '9px 11px', background: 'rgba(0,0,0,0.28)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#fff', fontSize: 13.5, outline: 'none', resize: 'vertical', fontFamily: 'inherit' },
  drawer: { background: '#15151f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: 22, width: 520, maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' },
  drawerHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  drawerName: { fontSize: 19, fontWeight: 700, color: '#fff' },
  drawerMeta: { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 16 },
  linkBtn: { display: 'inline-block', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)', color: '#a5b4fc', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 14 },
  section: { marginBottom: 16 },
  sectionLabel: { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  portLink: { display: 'block', color: '#7dd3fc', fontSize: 13, marginBottom: 4, wordBreak: 'break-all' },
  coverNote: { fontSize: 13.5, color: 'rgba(255,255,255,0.8)', lineHeight: 1.6, whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: '10px 12px' },
  drawerActions: { marginTop: 18, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.08)' },
  stageRow: { display: 'flex', gap: 6 },
  stageBtn: { flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)', borderRadius: 7, padding: '7px', fontSize: 12, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize', fontFamily: 'inherit' },
  stageBtnOn: { background: 'rgba(99,102,241,0.22)', border: '1px solid rgba(99,102,241,0.5)', color: '#c7d2fe' },
  acceptBtn: { flex: 1, background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', color: '#86efac', borderRadius: 8, padding: '10px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  declineBtn: { flex: 1, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5', borderRadius: 8, padding: '10px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  acceptedNote: { marginTop: 16, padding: '10px 12px', background: 'rgba(34,197,94,0.1)', borderRadius: 8, fontSize: 13, color: '#86efac' },
  declinedNote: { marginTop: 16, padding: '10px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 8, fontSize: 13, color: '#fca5a5' },
  onbCard: { padding: '16px 18px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12 },
  onbHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  checklist: { display: 'flex', flexDirection: 'column', gap: 8 },
  checkItem: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' },
};
