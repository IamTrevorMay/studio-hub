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

export default function Jobs({ initialApplicationId, onApplicationOpened }) {
  const [tab, setTab] = useState('listings');
  const [listings, setListings] = useState([]);
  const [applications, setApplications] = useState([]);
  const [onboarding, setOnboarding] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (initialApplicationId) setTab('applications');
  }, [initialApplicationId]);

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
          {tab === 'listings' && <ListingsTab listings={listings} applications={applications} onChange={fetchAll} showToast={showToast} />}
          {tab === 'applications' && <ApplicationsTab applications={applications} listings={listings} onChange={fetchAll} showToast={showToast} initialApplicationId={initialApplicationId} onApplicationOpened={onApplicationOpened} />}
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
const LISTING_STATUSES = ['all', 'draft', 'open', 'closed'];
function ListingsTab({ listings, applications, onChange, showToast }) {
  const [editing, setEditing] = useState(null); // listing obj or {} for new
  const [fStatus, setFStatus] = useState('open');
  const filtered = fStatus === 'all' ? listings : listings.filter(l => l.status === fStatus);
  const counts = LISTING_STATUSES.reduce((acc, s) => {
    acc[s] = s === 'all' ? listings.length : listings.filter(l => l.status === s).length;
    return acc;
  }, {});
  const appCountByListing = useMemo(() => {
    const m = {};
    for (const a of (applications || [])) {
      if (!a.listing_id) continue;
      m[a.listing_id] = (m[a.listing_id] || 0) + 1;
    }
    return m;
  }, [applications]);

  const move = async (idx, dir) => {
    if (!filtered[idx + dir]) return;
    const reordered = filtered.slice();
    [reordered[idx], reordered[idx + dir]] = [reordered[idx + dir], reordered[idx]];
    const results = await Promise.all(
      reordered.map((l, i) => supabase.from('job_listings').update({ position: i }).eq('id', l.id))
    );
    const firstErr = results.find(r => r.error);
    if (firstErr?.error) showToast(firstErr.error.message, 'error'); else onChange();
  };

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
      <div style={{ ...st.toolbar, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {LISTING_STATUSES.map(s => (
            <button key={s} style={{ ...st.statusFilterPill, ...(fStatus === s ? st.statusFilterPillOn : {}) }} onClick={() => setFStatus(s)}>
              {s} {counts[s] ? <span style={st.statusFilterCount}>{counts[s]}</span> : null}
            </button>
          ))}
        </div>
        <button style={st.primaryBtn} onClick={() => setEditing({})}>+ New listing</button>
      </div>
      {listings.length === 0 ? <div style={st.empty}>No listings yet. Create one to post a role.</div> : filtered.length === 0 ? (
        <div style={st.empty}>No {fStatus === 'all' ? '' : fStatus} listings.</div>
      ) : (
        <div style={st.cards}>
          {filtered.map((l, idx) => {
            const appCount = appCountByListing[l.id] || 0;
            return (
              <div key={l.id} style={st.listingCard}>
                <div style={st.reorderCol}>
                  <button style={{ ...st.reorderBtn, opacity: idx === 0 ? 0.25 : 1, cursor: idx === 0 ? 'default' : 'pointer' }} onClick={() => move(idx, -1)} disabled={idx === 0} title="Move up">▲</button>
                  <button style={{ ...st.reorderBtn, opacity: idx === filtered.length - 1 ? 0.25 : 1, cursor: idx === filtered.length - 1 ? 'default' : 'pointer' }} onClick={() => move(idx, 1)} disabled={idx === filtered.length - 1} title="Move down">▼</button>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={st.listingTitle}>
                    {l.title}
                    <span style={{ ...st.statusPill, ...statusPillStyle(l.status) }}>{l.status}</span>
                    {appCount > 0 && <span style={st.appCountPill}>{appCount} app{appCount === 1 ? '' : 's'}</span>}
                  </div>
                  <div style={st.listingMeta}>
                    {(() => { const p = parseStructured(l.description); return p?.subtitle || [l.department, l.employment_type && TYPE_OPTS.find(t => t.v === l.employment_type)?.l, l.work_mode && MODE_OPTS.find(m => m.v === l.work_mode)?.l, l.comp_range].filter(Boolean).join('  ·  '); })()}
                  </div>
                  {(() => { const p = parseStructured(l.description); if (!p?.intro) return null; const t = p.intro.length > 120 ? p.intro.slice(0, 120) + '…' : p.intro; return <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.4)', marginTop: 4, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{t}</div>; })()}
                </div>
                <div style={st.listingActions}>
                  <button style={st.smallBtn} onClick={() => setEditing(l)}>Edit</button>
                  {l.status !== 'open' && <button style={st.smallBtn} onClick={() => setStatus(l, 'open')}>Publish</button>}
                  {l.status === 'open' && <button style={st.smallBtn} onClick={() => setStatus(l, 'closed')}>Close</button>}
                  {l.status === 'open' && <button style={st.smallBtn} onClick={() => copyLink(l)}>Copy link</button>}
                  <button style={{ ...st.smallBtn, color: '#fca5a5' }} onClick={() => remove(l)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {editing && <ListingModal listing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChange(); }} showToast={showToast} />}
    </div>
  );
}

function parseStructured(raw) {
  if (!raw) return null;
  try { const p = JSON.parse(raw); return p && p.structured ? p : null; } catch { return null; }
}

function ListingModal({ listing, onClose, onSaved, showToast }) {
  const parsed = parseStructured(listing.description);
  const initialChecklist = Array.isArray(listing.onboarding_checklist) && listing.onboarding_checklist.length
    ? listing.onboarding_checklist.map(c => ({ label: String(c.label || '') }))
    : [];
  const [f, setF] = useState({
    title: listing.title || '',
    subtitle: parsed?.subtitle || '',
    intro: parsed ? (parsed.intro || '') : (listing.description || ''),
    responsibilities: parsed?.responsibilities || '',
    requirements: parsed?.requirements || '',
    reporting: parsed?.reporting || '',
    compensation: parsed?.compensation || '',
    how_to_apply: parsed?.how_to_apply || '',
    apply_email: parsed?.apply_email || '',
    warning: parsed?.warning || '',
    subject_line: parsed?.subject_line || '',
    employment_type: listing.employment_type || '', work_mode: listing.work_mode || '',
    location: listing.location || '', comp_range: listing.comp_range || '',
    department: listing.department || '', status: listing.status || 'draft',
    expires_at: listing.expires_at ? listing.expires_at.slice(0, 10) : '',
  });
  const [checklist, setChecklist] = useState(initialChecklist);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  const save = async (forceStatus) => {
    if (!f.title.trim()) { showToast('Title is required', 'error'); return; }
    setSaving(true);
    const status = forceStatus || f.status;
    const structured = {
      structured: true, subtitle: f.subtitle, intro: f.intro,
      responsibilities: f.responsibilities, requirements: f.requirements,
      reporting: f.reporting, compensation: f.compensation,
      how_to_apply: f.how_to_apply, apply_email: f.apply_email,
      warning: f.warning, subject_line: f.subject_line,
    };
    const cleanChecklist = checklist.map(c => ({ label: c.label.trim() })).filter(c => c.label);
    const payload = {
      title: f.title.trim(), description: JSON.stringify(structured),
      employment_type: f.employment_type || null, work_mode: f.work_mode || null,
      location: f.location.trim() || null, comp_range: f.comp_range.trim() || null,
      department: f.department.trim() || null, status,
      expires_at: f.expires_at ? new Date(f.expires_at + 'T23:59:59Z').toISOString() : null,
      onboarding_checklist: cleanChecklist,
      updated_at: new Date().toISOString(),
    };
    let error;
    if (listing.id) {
      if (status === 'open' && !listing.published_at) payload.published_at = new Date().toISOString();
      ({ error } = await supabase.from('job_listings').update(payload).eq('id', listing.id));
    } else {
      const base = slugify(f.title) || 'role';
      payload.slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
      if (status === 'open') payload.published_at = new Date().toISOString();
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
        <L label="Subtitle"><input style={st.input} value={f.subtitle} onChange={e => set('subtitle', e.target.value)} placeholder="Fall 2026 | Paid Internship | Kirkland, WA" /></L>
        <L label="Introduction"><textarea style={st.textarea} rows={4} value={f.intro} onChange={e => set('intro', e.target.value)} placeholder="Company intro and role overview…" /></L>
        <L label="What You'll Do"><textarea style={st.textarea} rows={5} value={f.responsibilities} onChange={e => set('responsibilities', e.target.value)} placeholder="One responsibility per line" /></L>
        <L label="Requirements"><textarea style={st.textarea} rows={4} value={f.requirements} onChange={e => set('requirements', e.target.value)} placeholder="One requirement per line" /></L>
        <L label="Reporting Structure"><input style={st.input} value={f.reporting} onChange={e => set('reporting', e.target.value)} placeholder="Reports directly to…" /></L>
        <div style={st.modalGrid}>
          <L label="Compensation (structured)"><input style={st.input} value={f.compensation} onChange={e => set('compensation', e.target.value)} placeholder="Paid internship (rate TBD)" /></L>
          <L label="Apply Email"><input style={st.input} value={f.apply_email} onChange={e => set('apply_email', e.target.value)} placeholder="email@example.com" /></L>
        </div>
        <L label="How to Apply"><textarea style={st.textarea} rows={4} value={f.how_to_apply} onChange={e => set('how_to_apply', e.target.value)} placeholder="Application instructions, one item per line. Indent with two spaces for sub-bullets." /></L>
        <L label="Warning"><input style={st.input} value={f.warning} onChange={e => set('warning', e.target.value)} placeholder="Applications submitted without a resume will not be considered." /></L>
        <L label="Subject Line"><input style={st.input} value={f.subject_line} onChange={e => set('subject_line', e.target.value)} placeholder="Fall 2026 Internship Application" /></L>
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '16px 0 12px', paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Metadata</div>
        </div>
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
          <L label="Comp range (card display)"><input style={st.input} value={f.comp_range} onChange={e => set('comp_range', e.target.value)} placeholder="$60–80k / $40/hr" /></L>
        </div>
        <div style={st.modalGrid}>
          <L label="Department"><input style={st.input} value={f.department} onChange={e => set('department', e.target.value)} placeholder="Video, Social…" /></L>
          <L label="Status">
            <select style={st.input} value={f.status} onChange={e => set('status', e.target.value)}>
              <option value="draft">Draft (hidden)</option><option value="open">Open (public)</option><option value="closed">Closed</option>
            </select>
          </L>
        </div>
        <div style={st.modalGrid}>
          <L label="Expires (optional)"><input type="date" style={st.input} value={f.expires_at} onChange={e => set('expires_at', e.target.value)} /></L>
          <div />
        </div>
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '16px 0 12px', paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Onboarding checklist template</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>Used to seed the onboarding checklist when an applicant is accepted. Leave empty to use the default template.</div>
          {checklist.map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input style={{ ...st.input, flex: 1 }} value={c.label} onChange={e => setChecklist(prev => prev.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="Checklist item" />
              <button style={st.smallBtn} onClick={() => setChecklist(prev => prev.filter((_, j) => j !== i))} title="Remove">✕</button>
            </div>
          ))}
          <button style={{ ...st.smallBtn, marginTop: 4 }} onClick={() => setChecklist(prev => [...prev, { label: '' }])}>+ Add item</button>
        </div>
        <div style={st.modalActions}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={st.primaryBtn} onClick={() => save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          {f.status !== 'open' && (
            <button style={{ ...st.primaryBtn, background: '#16a34a' }} onClick={() => save('open')} disabled={saving} title="Save and set status to Open">{saving ? 'Saving…' : 'Save & Publish'}</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Applications ───────────────────────────────────────────
const APP_PAGE_SIZE = 25;
function ApplicationsTab({ applications, listings, onChange, showToast, initialApplicationId, onApplicationOpened }) {
  const [fStatus, setFStatus] = useState('all');
  const [fListing, setFListing] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!initialApplicationId) return;
    const app = applications.find(a => a.id === initialApplicationId);
    if (app) {
      setSelected(app);
      onApplicationOpened?.();
    }
  }, [initialApplicationId, applications, onApplicationOpened]);

  useEffect(() => { setPage(1); }, [fStatus, fListing, search]);

  const q = search.trim().toLowerCase();
  const filtered = applications.filter(a =>
    (fStatus === 'all' || a.status === fStatus) &&
    (fListing === 'all' || a.listing_id === fListing) &&
    (!q || (a.applicant_name || '').toLowerCase().includes(q) || (a.applicant_email || '').toLowerCase().includes(q)));
  const visible = filtered.slice(0, page * APP_PAGE_SIZE);
  const hasMore = visible.length < filtered.length;

  const review = async (app, action, extra = {}) => {
    const { data, error } = await supabase.functions.invoke('jobs-review', { body: { action, application_id: app.id, ...extra } });
    if (error || data?.error) { showToast(data?.error || error?.message || 'Failed', 'error'); return; }
    if (data?.invite_warning) showToast('Accepted — invite note: ' + data.invite_warning, 'error');
    else if (action === 'delete_data') showToast('Applicant data deleted');
    else showToast(`Application ${action === 'set_status' ? extra.status : action}`);
    setSelected(null);
    onChange();
  };

  return (
    <div>
      <div style={st.filters}>
        <input style={{ ...st.filterSel, flex: 1, minWidth: 200 }} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or email…" />
        <select style={st.filterSel} value={fStatus} onChange={e => setFStatus(e.target.value)}>
          <option value="all">All statuses</option>{APP_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select style={st.filterSel} value={fListing} onChange={e => setFListing(e.target.value)}>
          <option value="all">All roles</option>{listings.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
        </select>
      </div>
      {filtered.length === 0 ? <div style={st.empty}>No applications.</div> : (
        <>
          <table style={st.table}>
            <thead><tr>
              <th style={st.th}>Applicant</th><th style={st.th}>Role</th><th style={st.th}>Applied</th><th style={st.th}>Status</th>
            </tr></thead>
            <tbody>
              {visible.map(a => (
                <tr key={a.id} style={st.tr} onClick={() => setSelected(a)}>
                  <td style={st.td}><strong>{a.applicant_name}</strong><div style={st.subEmail}>{a.applicant_email}</div></td>
                  <td style={st.td}>{a.listing?.title || '—'}</td>
                  <td style={st.td}>{fmtDate(a.created_at)}</td>
                  <td style={st.td}><span style={{ ...st.statusPill, ...statusPillStyle(a.status) }}>{a.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 14, fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
            <span>Showing {visible.length} of {filtered.length}</span>
            {hasMore && <button style={st.smallBtn} onClick={() => setPage(p => p + 1)}>Load more</button>}
          </div>
        </>
      )}
      {selected && <ApplicationDrawer app={selected} onClose={() => setSelected(null)} onReview={review} showToast={showToast} onChange={onChange} />}
    </div>
  );
}

function ApplicationDrawer({ app, onClose, onReview, showToast, onChange }) {
  const links = Array.isArray(app.portfolio_links) ? app.portfolio_links : [];
  const [notes, setNotes] = useState(app.reviewer_notes || '');
  const [savingNotes, setSavingNotes] = useState(false);
  useEffect(() => { setNotes(app.reviewer_notes || ''); }, [app.id, app.reviewer_notes]);
  const openResume = async () => {
    if (!app.resume_path) return;
    const { data, error } = await supabase.storage.from('job-resumes').createSignedUrl(app.resume_path, 3600);
    if (error || !data?.signedUrl) { showToast('Could not open résumé', 'error'); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };
  const saveNotes = async () => {
    setSavingNotes(true);
    const { data, error } = await supabase.functions.invoke('jobs-review', {
      body: { action: 'save_notes', application_id: app.id, reviewer_notes: notes },
    });
    setSavingNotes(false);
    if (error || data?.error) { showToast(data?.error || error?.message || 'Failed', 'error'); return; }
    showToast('Notes saved');
    onChange?.();
  };
  const notesDirty = (notes || '') !== (app.reviewer_notes || '');
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

        <div style={st.section}>
          <div style={st.sectionLabel}>Reviewer notes (internal)</div>
          <textarea style={st.textarea} rows={4} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Private notes — not visible to applicant" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
            <button style={{ ...st.smallBtn, opacity: notesDirty && !savingNotes ? 1 : 0.5, cursor: notesDirty && !savingNotes ? 'pointer' : 'default' }} onClick={saveNotes} disabled={!notesDirty || savingNotes}>
              {savingNotes ? 'Saving…' : 'Save notes'}
            </button>
          </div>
        </div>

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

        <div style={{ marginTop: 18, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button
            style={{ background: 'none', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5', fontSize: 12, fontWeight: 600, padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}
            onClick={() => {
              if (window.confirm(`Permanently delete ${app.applicant_name}'s application and résumé? This erases their data and cannot be undone.`)) onReview(app, 'delete_data');
            }}
          >Delete applicant data</button>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 6 }}>Erases résumé + record (GDPR/CCPA). Use for data-removal requests.</div>
        </div>
      </div>
    </div>
  );
}

// ─── Onboarding ─────────────────────────────────────────────
function OnboardingTab({ onboarding, onChange, showToast }) {
  const [showComplete, setShowComplete] = useState(false);
  const saveChecklist = useCallback(async (row, checklist) => {
    const { data, error } = await supabase.functions.invoke('jobs-review', {
      body: { action: 'onboarding_update', onboarding_id: row.id, checklist },
    });
    if (error || data?.error) showToast(data?.error || error?.message || 'Failed', 'error'); else onChange();
  }, [onChange, showToast]);

  if (onboarding.length === 0) return <div style={st.empty}>No one in onboarding yet. Accept an application to start.</div>;

  const inProgress = onboarding.filter(r => r.status !== 'complete');
  const complete = onboarding.filter(r => r.status === 'complete');

  return (
    <div>
      {inProgress.length === 0 ? (
        <div style={st.empty}>Nothing in progress.</div>
      ) : (
        <div style={st.cards}>
          {inProgress.map(row => <OnboardingCard key={row.id} row={row} onSave={saveChecklist} />)}
        </div>
      )}
      {complete.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <button style={st.expander} onClick={() => setShowComplete(s => !s)}>
            {showComplete ? '▼' : '▶'} Completed ({complete.length})
          </button>
          {showComplete && (
            <div style={{ ...st.cards, marginTop: 10 }}>
              {complete.map(row => <OnboardingCard key={row.id} row={row} onSave={saveChecklist} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OnboardingCard({ row, onSave }) {
  const [local, setLocal] = useState(row.checklist || []);
  useEffect(() => { setLocal(row.checklist || []); }, [row.id, row.checklist, row.updated_at]);

  const done = local.filter(c => c.done).length;
  const total = local.length;

  const toggle = (idx) => {
    const next = local.map((c, i) => i === idx ? { ...c, done: !c.done } : c);
    setLocal(next);
    onSave(row, next);
  };
  const rename = (idx, label) => setLocal(prev => prev.map((c, i) => i === idx ? { ...c, label } : c));
  const commitRename = (idx) => {
    if ((local[idx]?.label || '') === (row.checklist?.[idx]?.label || '')) return;
    onSave(row, local);
  };
  const remove = (idx) => {
    const next = local.filter((_, i) => i !== idx);
    setLocal(next);
    onSave(row, next);
  };
  const add = () => {
    const next = [...local, { label: 'New item', done: false }];
    setLocal(next);
    onSave(row, next);
  };

  return (
    <div style={st.onbCard}>
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
        {local.map((c, i) => (
          <div key={i} style={st.checkItemEdit}>
            <input type="checkbox" checked={!!c.done} onChange={() => toggle(i)} />
            <input
              style={{ ...st.checkLabelInput, textDecoration: c.done ? 'line-through' : 'none', color: c.done ? 'rgba(255,255,255,0.4)' : '#fff' }}
              value={c.label}
              onChange={e => rename(i, e.target.value)}
              onBlur={() => commitRename(i)}
            />
            <button style={st.checkRemoveBtn} onClick={() => remove(i)} title="Remove">✕</button>
          </div>
        ))}
        <button style={{ ...st.smallBtn, alignSelf: 'flex-start', marginTop: 4 }} onClick={add}>+ Add item</button>
      </div>
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
  statusFilterPill: { padding: '5px 11px', borderRadius: 999, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize', display: 'inline-flex', alignItems: 'center', gap: 6 },
  statusFilterPillOn: { background: 'rgba(99,102,241,0.22)', border: '1px solid rgba(99,102,241,0.5)', color: '#c7d2fe' },
  statusFilterCount: { fontSize: 10, fontWeight: 700, background: 'rgba(0,0,0,0.3)', borderRadius: 999, padding: '1px 7px' },
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
  checkItemEdit: { display: 'flex', alignItems: 'center', gap: 8 },
  checkLabelInput: { flex: 1, background: 'transparent', border: '1px solid transparent', borderRadius: 6, padding: '4px 8px', fontSize: 14, outline: 'none', fontFamily: 'inherit' },
  checkRemoveBtn: { background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: 14, cursor: 'pointer', padding: '2px 8px', fontFamily: 'inherit' },
  expander: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  reorderCol: { display: 'flex', flexDirection: 'column', gap: 2 },
  reorderBtn: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', borderRadius: 4, padding: '2px 6px', fontSize: 10, fontFamily: 'inherit' },
  appCountPill: { fontSize: 10, fontWeight: 700, background: 'rgba(99,102,241,0.18)', color: '#c7d2fe', borderRadius: 999, padding: '2px 8px', letterSpacing: 0.3 },
};
