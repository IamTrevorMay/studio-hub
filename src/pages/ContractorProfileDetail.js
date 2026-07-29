import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { colors } from '../lib/styleTokens';

// Full-page, admin-editable contractor profile. Opened from Contractor Mode →
// Team by clicking a contractor. Self-contained: fetches the profile,
// contractor_profiles row, and the contractor's assignments / hours / documents.
//
// Sections: Contact & identity · Payment & terms (editable) · Work history
// (read-only) · Admin notes & folders. sub_role is the canonical contractor
// specialization; `title` is kept mirrored for back-compat.

const CONTRACTOR_TITLES = [
  'Long Form Editor', 'Short Form Editor', 'Podcast Editor',
  'Graphic Designer', 'Developer', 'Writer', 'Producer', 'Production/Camera',
];

const STATUS_LABELS = {
  assigned: 'Assigned', in_progress: 'In Progress', submitted: 'Submitted',
  revisions: 'Revisions', completed: 'Completed', ready: 'Ready',
};

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ContractorProfileDetail({ contractorId, onBack, onChanged }) {
  const [profile, setProfile] = useState(null);
  const [cp, setCp] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [hours, setHours] = useState([]);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const [notes, setNotes] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);
  const [notesSaving, setNotesSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: p }, { data: cpRow }, { data: asg }, { data: hrs }, { data: dcs }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', contractorId).single(),
      supabase.from('contractor_profiles').select('*').eq('id', contractorId).maybeSingle(),
      supabase.from('contractor_assignments').select('*').eq('contractor_id', contractorId).order('created_at', { ascending: false }),
      supabase.from('contractor_hours').select('*').eq('contractor_id', contractorId).order('period_start', { ascending: false }),
      supabase.from('contractor_documents').select('*').eq('contractor_id', contractorId).order('created_at', { ascending: false }),
    ]);
    setProfile(p || null);
    setCp(cpRow || null);
    setAssignments(asg || []);
    setHours(hrs || []);
    setDocs(dcs || []);
    setNotes(cpRow?.admin_notes || '');
    setNotesDirty(false);
    setLoading(false);
  }, [contractorId]);

  useEffect(() => { load(); }, [load]);

  function startEdit() {
    setForm({
      full_name: profile?.full_name || '',
      sub_role: profile?.sub_role || profile?.title || '',
      payment_type: cp?.payment_type || 'hourly',
      rate: cp?.rate != null ? String(cp.rate) : '',
      retainer_enabled: !!cp?.retainer_enabled,
      retainer_min_hours: cp?.retainer_min_hours != null ? String(cp.retainer_min_hours) : '',
      overtime_enabled: !!cp?.overtime_enabled,
      overtime_max_hours: cp?.overtime_max_hours != null ? String(cp.overtime_max_hours) : '',
      overtime_multiplier: cp?.overtime_multiplier != null ? String(cp.overtime_multiplier) : '1.5',
    });
    setEditing(true);
  }

  async function saveEdit() {
    setSaving(true);
    try {
      // sub_role is canonical; keep `title` mirrored for back-compat.
      await supabase.from('profiles').update({
        full_name: form.full_name.trim(),
        sub_role: form.sub_role || null,
        title: form.sub_role || null,
      }).eq('id', contractorId);
      await supabase.from('contractor_profiles').upsert({
        id: contractorId,
        payment_type: form.payment_type,
        rate: form.rate ? parseFloat(form.rate) : null,
        retainer_enabled: form.retainer_enabled,
        retainer_min_hours: form.retainer_enabled && form.retainer_min_hours ? parseFloat(form.retainer_min_hours) : null,
        overtime_enabled: form.overtime_enabled,
        overtime_max_hours: form.overtime_enabled && form.overtime_max_hours ? parseFloat(form.overtime_max_hours) : null,
        overtime_multiplier: form.overtime_multiplier ? parseFloat(form.overtime_multiplier) : 1.5,
      }, { onConflict: 'id' });
      setEditing(false);
      await load();
      onChanged?.();
    } catch (err) {
      console.error('Failed to save contractor:', err);
    }
    setSaving(false);
  }

  async function saveNotes() {
    setNotesSaving(true);
    try {
      await supabase.from('contractor_profiles').upsert({ id: contractorId, admin_notes: notes || null }, { onConflict: 'id' });
      setNotesDirty(false);
    } catch (err) {
      console.error('Failed to save notes:', err);
    }
    setNotesSaving(false);
  }

  if (loading) return <div style={styles.page}><p style={styles.dim}>Loading profile…</p></div>;
  if (!profile) return <div style={styles.page}><button style={styles.backBtn} onClick={onBack}>← Back</button><p style={styles.dim}>Contractor not found.</p></div>;

  const subRoleLabel = profile.sub_role || profile.title || null;
  const activeCount = assignments.filter(a => a.status !== 'completed' && !a.declined_at).length;

  return (
    <div style={styles.page}>
      <button style={styles.backBtn} onClick={onBack}>← Back to Team</button>

      {/* Identity header */}
      <div style={styles.header}>
        {profile.avatar_url
          ? <img src={profile.avatar_url} alt="" style={styles.avatarImg} />
          : <div style={styles.avatar}>{(profile.full_name || '?').charAt(0).toUpperCase()}</div>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.name}>{profile.full_name || 'Unnamed'}</div>
          <div style={styles.email}>{profile.email}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {subRoleLabel && <span style={styles.badge}>{subRoleLabel}</span>}
            <span style={{ ...styles.badge, background: activeCount > 0 ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.06)', color: activeCount > 0 ? '#fbbf24' : 'rgba(255,255,255,0.4)' }}>{activeCount} active</span>
            {profile.created_at && <span style={{ ...styles.badge }}>Joined {fmtDate(profile.created_at)}</span>}
          </div>
        </div>
      </div>

      {/* Payment & terms (editable) */}
      <div style={styles.card}>
        <div style={styles.cardHead}>
          <h3 style={styles.cardTitle}>Contact & terms</h3>
          {!editing && <button style={styles.secondaryBtn} onClick={startEdit}>Edit</button>}
        </div>
        {editing ? (
          <div>
            <div style={styles.grid}>
              <Field label="Name">
                <input style={styles.input} value={form.full_name} onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))} />
              </Field>
              <Field label="Sub-role">
                <select style={styles.input} value={form.sub_role} onChange={e => setForm(p => ({ ...p, sub_role: e.target.value }))}>
                  <option value="">Select sub-role…</option>
                  {(form.sub_role && !CONTRACTOR_TITLES.includes(form.sub_role)) && <option value={form.sub_role}>{form.sub_role}</option>}
                  {CONTRACTOR_TITLES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Payment type">
                <select style={styles.input} value={form.payment_type} onChange={e => setForm(p => ({ ...p, payment_type: e.target.value }))}>
                  <option value="hourly">Hourly</option>
                  <option value="project">By Project</option>
                </select>
              </Field>
              <Field label="Rate ($)">
                <input style={styles.input} type="number" min="0" step="0.01" value={form.rate} onChange={e => setForm(p => ({ ...p, rate: e.target.value }))} />
              </Field>
            </div>
            {form.payment_type === 'hourly' && (
              <div style={styles.payBox}>
                <div style={styles.payBoxLabel}>Hourly Payroll Settings</div>
                <label style={styles.checkRow}>
                  <input type="checkbox" checked={form.retainer_enabled} onChange={e => setForm(p => ({ ...p, retainer_enabled: e.target.checked }))} />
                  Retainer (guaranteed minimum)
                  {form.retainer_enabled && (
                    <input style={{ ...styles.input, width: 90, marginLeft: 8 }} type="number" min="0" step="0.25" placeholder="hrs/wk"
                      value={form.retainer_min_hours} onChange={e => setForm(p => ({ ...p, retainer_min_hours: e.target.value }))} />
                  )}
                </label>
                <label style={styles.checkRow}>
                  <input type="checkbox" checked={form.overtime_enabled} onChange={e => setForm(p => ({ ...p, overtime_enabled: e.target.checked }))} />
                  Overtime (needs approval)
                  {form.overtime_enabled && (
                    <>
                      <input style={{ ...styles.input, width: 90, marginLeft: 8 }} type="number" min="0" step="0.25" placeholder="after hrs"
                        value={form.overtime_max_hours} onChange={e => setForm(p => ({ ...p, overtime_max_hours: e.target.value }))} />
                      <input style={{ ...styles.input, width: 70, marginLeft: 4 }} type="number" min="1" step="0.1" placeholder="× rate"
                        value={form.overtime_multiplier} onChange={e => setForm(p => ({ ...p, overtime_multiplier: e.target.value }))} />
                    </>
                  )}
                </label>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button style={styles.primaryBtn} onClick={saveEdit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              <button style={styles.secondaryBtn} onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={styles.grid}>
            <ReadField label="Email" value={profile.email} />
            <ReadField label="Sub-role" value={subRoleLabel} />
            <ReadField label="Payment type" value={cp?.payment_type ? (cp.payment_type === 'hourly' ? 'Hourly' : 'By Project') : '--'} />
            <ReadField label="Rate" value={cp?.rate != null ? `$${Number(cp.rate).toFixed(2)}${cp.payment_type === 'hourly' ? '/hr' : '/proj'}` : '--'} />
            {cp?.payment_type === 'hourly' && (cp?.retainer_enabled || cp?.overtime_enabled) && (
              <ReadField label="Payroll rules" wide value={[
                cp.retainer_enabled ? `Retainer floor ${cp.retainer_min_hours ?? '—'}h/wk` : null,
                cp.overtime_enabled ? `OT > ${cp.overtime_max_hours ?? '—'}h/wk @ ${Number(cp.overtime_multiplier || 1.5)}×` : null,
              ].filter(Boolean).join('  ·  ')} />
            )}
          </div>
        )}
      </div>

      {/* Admin notes & folders */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Admin notes & folders</h3>
        <ReadField label="Assigned Drive folder" wide value={profile.assigned_drive_folder_name || '--'} />
        <div style={{ marginTop: 12 }}>
          <div style={styles.fieldLabel}>Admin notes (private)</div>
          <textarea
            style={{ ...styles.input, minHeight: 90, resize: 'vertical', marginTop: 4 }}
            value={notes}
            onChange={e => { setNotes(e.target.value); setNotesDirty(true); }}
            placeholder="Internal notes about this contractor…"
          />
          {notesDirty && (
            <button style={{ ...styles.primaryBtn, marginTop: 8 }} onClick={saveNotes} disabled={notesSaving}>
              {notesSaving ? 'Saving…' : 'Save notes'}
            </button>
          )}
        </div>
      </div>

      {/* Work history */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Assignments ({assignments.length})</h3>
        {assignments.length === 0 ? <p style={styles.dim}>No assignments.</p> : (
          <div style={styles.list}>
            {assignments.map(a => (
              <div key={a.id} style={styles.row}>
                <span style={{ ...styles.statusBadge, ...(a.declined_at ? { background: 'rgba(239,68,68,0.15)', color: '#fca5a5' } : {}) }}>
                  {a.declined_at ? 'Declined' : (STATUS_LABELS[a.status] || a.status)}
                </span>
                <span style={{ color: '#fff', fontSize: 13, flex: 1 }}>{a.title}</span>
                {a.due_date && <span style={styles.dimSm}>Due {fmtDate(a.due_date)}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Hours ({hours.length})</h3>
        {hours.length === 0 ? <p style={styles.dim}>No hours submitted.</p> : (
          <div style={styles.list}>
            {hours.map(h => (
              <div key={h.id} style={styles.row}>
                <span style={{ color: '#fff', fontSize: 13, flex: 1 }}>{fmtDate(h.period_start)} – {fmtDate(h.period_end)}</span>
                <span style={{ color: colors.accentFg, fontWeight: 600, fontSize: 13 }}>{Number(h.total_hours).toFixed(1)}h</span>
                <span style={styles.dimSm}>{h.reviewed_at ? 'Reviewed' : 'Pending'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Documents ({docs.length})</h3>
        {docs.length === 0 ? <p style={styles.dim}>No documents.</p> : (
          <div style={styles.list}>
            {docs.map(d => (
              <div key={d.id} style={styles.row}>
                <span style={{ color: '#fff', fontSize: 13, flex: 1 }}>{d.title}</span>
                <span style={styles.dimSm}>{d.signed_at ? `Signed ${fmtDate(d.signed_at)}` : (d.doc_type || 'doc')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={styles.fieldLabel}>{label}</label>
      {children}
    </div>
  );
}

function ReadField({ label, value, wide }) {
  return (
    <div style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <div style={styles.fieldLabel}>{label}</div>
      <div style={{ color: '#fff', fontSize: 13, marginTop: 2 }}>{value || '--'}</div>
    </div>
  );
}

const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 860 },
  backBtn: { alignSelf: 'flex-start', background: 'none', border: 'none', color: colors.accentFg, fontSize: 14, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', padding: 0 },
  header: { display: 'flex', alignItems: 'center', gap: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20 },
  avatar: { width: 56, height: 56, borderRadius: '50%', background: colors.accentA15, color: colors.accentFg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, flexShrink: 0 },
  avatarImg: { width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 },
  name: { fontSize: 20, fontWeight: 700, color: '#fff' },
  email: { fontSize: 13, color: 'rgba(255,255,255,0.45)', marginTop: 2 },
  badge: { fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)' },
  card: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20 },
  cardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  cardTitle: { fontSize: 15, fontWeight: 700, color: '#fff', margin: '0 0 14px' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' },
  fieldLabel: { fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.4 },
  input: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '8px 10px', color: '#fff', fontSize: 13, fontFamily: 'DM Sans, sans-serif', width: '100%', boxSizing: 'border-box' },
  payBox: { display: 'flex', flexDirection: 'column', gap: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: 14, marginTop: 12 },
  payBoxLabel: { fontSize: 12, fontWeight: 700, color: colors.accentFg, textTransform: 'uppercase', letterSpacing: 0.5 },
  checkRow: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#fff', flexWrap: 'wrap' },
  primaryBtn: { background: colors.accent, border: 'none', borderRadius: 6, padding: '8px 18px', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' },
  secondaryBtn: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '8px 18px', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  row: { display: 'flex', alignItems: 'center', gap: 10 },
  statusBadge: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 5, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)' },
  dim: { color: 'rgba(255,255,255,0.4)', fontSize: 13 },
  dimSm: { color: 'rgba(255,255,255,0.35)', fontSize: 12 },
};
