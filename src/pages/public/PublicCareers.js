import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';

// Public, login-free careers board. Served by App.js for /careers paths.
// Reads open listings via anon RLS; applications post through the
// jobs-apply edge function.

const TYPE_LABEL = {
  full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract', freelance: 'Freelance',
};
const MODE_LABEL = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site' };
const MAX_RESUME_MB = 5;

function slugFromPath() {
  const m = window.location.pathname.match(/^\/careers\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function PublicCareers() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [dept, setDept] = useState('all');

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('job_listings')
        .select('*')
        .eq('status', 'open')
        .order('position', { ascending: true })
        .order('created_at', { ascending: false });
      const rows = data || [];
      setListings(rows);
      const slug = slugFromPath();
      if (slug) setSelected(rows.find(l => l.slug === slug) || null);
      setLoading(false);
    })();
  }, []);

  const departments = useMemo(
    () => Array.from(new Set(listings.map(l => l.department).filter(Boolean))),
    [listings],
  );
  const filtered = useMemo(
    () => dept === 'all' ? listings : listings.filter(l => l.department === dept),
    [listings, dept],
  );

  const openListing = (l) => {
    setSelected(l);
    window.history.pushState({}, '', `/careers/${l.slug || l.id}`);
    window.scrollTo(0, 0);
  };
  const backToBoard = () => {
    setSelected(null);
    window.history.pushState({}, '', '/careers');
  };

  return (
    <div style={s.page}>
      <div style={s.wrap}>
        <header style={s.header}>
          <div style={s.logo}>Mayday</div>
          <div style={s.headerTag}>Careers</div>
        </header>

        {loading ? (
          <p style={s.muted}>Loading open roles…</p>
        ) : selected ? (
          <ListingDetail listing={selected} onBack={backToBoard} />
        ) : (
          <>
            <h1 style={s.h1}>Open roles</h1>
            <p style={s.lede}>Come build with us. Browse what's open and apply below.</p>

            {departments.length > 1 && (
              <div style={s.filters}>
                <button style={{ ...s.filterPill, ...(dept === 'all' ? s.filterPillOn : {}) }} onClick={() => setDept('all')}>All</button>
                {departments.map(d => (
                  <button key={d} style={{ ...s.filterPill, ...(dept === d ? s.filterPillOn : {}) }} onClick={() => setDept(d)}>{d}</button>
                ))}
              </div>
            )}

            {filtered.length === 0 ? (
              <div style={s.emptyCard}>No open roles right now — check back soon.</div>
            ) : (
              <div style={s.list}>
                {filtered.map(l => (
                  <div key={l.id} style={s.card} onClick={() => openListing(l)}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={s.cardTitle}>{l.title}</div>
                      <div style={s.cardMeta}>
                        {l.department && <span style={s.metaTag}>{l.department}</span>}
                        {l.employment_type && <span style={s.metaTag}>{TYPE_LABEL[l.employment_type]}</span>}
                        {l.work_mode && <span style={s.metaTag}>{MODE_LABEL[l.work_mode]}{l.location ? ` · ${l.location}` : ''}</span>}
                        {l.comp_range && <span style={s.metaComp}>{l.comp_range}</span>}
                      </div>
                    </div>
                    <span style={s.cardArrow}>View &amp; apply →</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <footer style={s.footer}>© {new Date().getFullYear()} Mayday</footer>
      </div>
    </div>
  );
}

function ListingDetail({ listing, onBack }) {
  return (
    <div>
      <button style={s.back} onClick={onBack}>← All roles</button>
      <h1 style={s.h1}>{listing.title}</h1>
      <div style={s.detailMeta}>
        {listing.department && <span style={s.metaTag}>{listing.department}</span>}
        {listing.employment_type && <span style={s.metaTag}>{TYPE_LABEL[listing.employment_type]}</span>}
        {listing.work_mode && <span style={s.metaTag}>{MODE_LABEL[listing.work_mode]}{listing.location ? ` · ${listing.location}` : ''}</span>}
        {listing.comp_range && <span style={s.metaComp}>{listing.comp_range}</span>}
      </div>
      {listing.description && (
        <div style={s.description}>{listing.description}</div>
      )}
      <ApplyForm listing={listing} />
    </div>
  );
}

function ApplyForm({ listing }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [links, setLinks] = useState('');
  const [cover, setCover] = useState('');
  const [resume, setResume] = useState(null);
  const [company, setCompany] = useState(''); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const canSubmit = name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    if (resume && resume.size > MAX_RESUME_MB * 1024 * 1024) {
      setError(`Résumé must be under ${MAX_RESUME_MB}MB`);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      let resume_base64, resume_filename, resume_content_type;
      if (resume) {
        resume_base64 = await fileToBase64(resume);
        resume_filename = resume.name;
        resume_content_type = resume.type;
      }
      const portfolio_links = links.split('\n').map(x => x.trim()).filter(Boolean);
      const { data, error: fnErr } = await supabase.functions.invoke('jobs-apply', {
        body: {
          listing_id: listing.id,
          applicant_name: name.trim(),
          applicant_email: email.trim(),
          phone: phone.trim() || null,
          portfolio_links,
          cover_note: cover.trim() || null,
          company, // honeypot
          resume_base64, resume_filename, resume_content_type,
        },
      });
      if (fnErr || data?.error) throw new Error(data?.error || fnErr?.message || 'Submission failed');
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div style={s.thanks}>
        <div style={s.thanksTitle}>Application received ✓</div>
        <p style={s.thanksBody}>Thanks, {name.split(' ')[0]}! We've emailed you a confirmation and our team will review your application. If it's a fit, we'll be in touch.</p>
      </div>
    );
  }

  return (
    <div style={s.formCard}>
      <h2 style={s.formTitle}>Apply for this role</h2>
      <div style={s.formGrid}>
        <Field label="Full name *"><input style={s.input} value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Email *"><input style={s.input} type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field>
      </div>
      <Field label="Phone"><input style={s.input} value={phone} onChange={e => setPhone(e.target.value)} /></Field>
      <Field label="Résumé / CV (PDF, max 5MB)">
        <input style={s.file} type="file" accept=".pdf,.doc,.docx" onChange={e => setResume(e.target.files[0] || null)} />
      </Field>
      <Field label="Portfolio / work links (one per line)">
        <textarea style={s.textarea} rows={3} value={links} onChange={e => setLinks(e.target.value)} placeholder={"https://yoursite.com\nhttps://youtube.com/@you"} />
      </Field>
      <Field label="Anything else? (cover note)">
        <textarea style={s.textarea} rows={4} value={cover} onChange={e => setCover(e.target.value)} placeholder="Tell us why you'd be a great fit…" />
      </Field>
      {/* Honeypot — hidden from humans */}
      <input style={{ position: 'absolute', left: '-9999px' }} tabIndex={-1} autoComplete="off" value={company} onChange={e => setCompany(e.target.value)} aria-hidden="true" />

      {error && <div style={s.error}>{error}</div>}
      <button style={{ ...s.submit, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'default' }} onClick={submit} disabled={!canSubmit}>
        {submitting ? 'Submitting…' : 'Submit application'}
      </button>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={s.label}>{label}</label>
      {children}
    </div>
  );
}

const s = {
  page: { minHeight: '100vh', background: '#0f0f1a', color: '#fff', fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif" },
  wrap: { maxWidth: 760, margin: '0 auto', padding: '32px 20px 60px' },
  header: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 40 },
  logo: { fontSize: 22, fontWeight: 800, letterSpacing: -0.5 },
  headerTag: { fontSize: 13, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1.5 },
  h1: { fontSize: 32, fontWeight: 800, margin: '0 0 8px', letterSpacing: -0.5 },
  lede: { fontSize: 15, color: 'rgba(255,255,255,0.5)', margin: '0 0 24px' },
  muted: { color: 'rgba(255,255,255,0.4)' },
  filters: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 },
  filterPill: { padding: '6px 14px', borderRadius: 999, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)', fontSize: 13, cursor: 'pointer' },
  filterPillOn: { background: 'rgba(99,102,241,0.25)', border: '1px solid rgba(99,102,241,0.6)', color: '#c7d2fe', fontWeight: 600 },
  list: { display: 'flex', flexDirection: 'column', gap: 12 },
  card: { display: 'flex', alignItems: 'center', gap: 16, padding: '18px 20px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, cursor: 'pointer' },
  cardTitle: { fontSize: 17, fontWeight: 700, marginBottom: 8 },
  cardMeta: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  metaTag: { fontSize: 12, color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.06)', borderRadius: 5, padding: '3px 9px' },
  metaComp: { fontSize: 12, color: '#86efac', fontWeight: 600 },
  cardArrow: { fontSize: 13, color: '#a5b4fc', fontWeight: 600, whiteSpace: 'nowrap' },
  emptyCard: { padding: 30, textAlign: 'center', background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 14, color: 'rgba(255,255,255,0.4)' },
  back: { background: 'none', border: 'none', color: '#a5b4fc', fontSize: 14, cursor: 'pointer', padding: 0, marginBottom: 16, fontFamily: 'inherit' },
  detailMeta: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 22 },
  description: { fontSize: 15, lineHeight: 1.7, color: 'rgba(255,255,255,0.82)', whiteSpace: 'pre-wrap', marginBottom: 32 },
  formCard: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 22 },
  formTitle: { fontSize: 18, fontWeight: 700, margin: '0 0 16px' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.55)', marginBottom: 5 },
  input: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 9, color: '#fff', fontSize: 14, outline: 'none', fontFamily: 'inherit' },
  file: { width: '100%', boxSizing: 'border-box', padding: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 9, color: 'rgba(255,255,255,0.7)', fontSize: 13 },
  textarea: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 9, color: '#fff', fontSize: 14, outline: 'none', resize: 'vertical', fontFamily: 'inherit' },
  error: { color: '#fca5a5', fontSize: 13, margin: '8px 0', background: 'rgba(239,68,68,0.1)', borderRadius: 8, padding: '8px 12px' },
  submit: { marginTop: 8, width: '100%', padding: '13px', borderRadius: 10, background: 'linear-gradient(135deg, #6366f1, #818cf8)', border: 'none', color: '#fff', fontSize: 15, fontWeight: 700, fontFamily: 'inherit' },
  thanks: { background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 16, padding: 28, textAlign: 'center' },
  thanksTitle: { fontSize: 20, fontWeight: 800, color: '#86efac', marginBottom: 8 },
  thanksBody: { fontSize: 15, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6, margin: 0 },
  footer: { marginTop: 48, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 12, color: 'rgba(255,255,255,0.3)', textAlign: 'center' },
};
