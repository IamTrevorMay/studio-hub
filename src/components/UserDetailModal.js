import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import backdropDismiss from '../lib/backdropDismiss';
import { colors } from '../lib/styleTokens';
import { isDirectorRole, MEMBER_SUB_ROLES } from '../lib/rolePermissions';

// Admin-only detail drawer for a team member, opened from Admin Panel → Team.
// Everything here is editable by an admin.
//
// Where each field lives depends on the person's role, so the drawer never
// forks the data the Contractors / Clients pages already show:
//   phone + notes → contractor_profiles | client_profiles | profiles/profile_admin_notes
//   pay           → contractor_profiles (contractors) | payroll_salaries (staff)
// profile_admin_notes is a separate table because `profiles` is readable by
// every authenticated user — notes there would not be admin-only.

const CONTRACTOR_SUB_ROLES = [
  'Long Form Editor', 'Short Form Editor', 'Podcast Editor',
  'Graphic Designer', 'Developer', 'Writer', 'Producer', 'Production/Camera',
];
const DIRECTOR_SUB_ROLES = [
  { value: 'communications', label: 'Director of Communications' },
  { value: 'creative', label: 'Director of Creative' },
];
const PAY_METHODS = [
  { value: '', label: 'Not set' },
  { value: 'auto', label: 'Auto (direct deposit)' },
  { value: 'venmo', label: 'Venmo' },
  { value: 'paypal', label: 'PayPal' },
];
const STAFF_ROLES = ['admin', 'director', 'member', 'director_creative', 'director_comms'];

const isContractor = (r) => r === 'contractor' || r === 'freelancer';
const isStaff = (r) => STAFF_ROLES.includes(r);

function subRoleOptions(role) {
  if (isDirectorRole(role)) return DIRECTOR_SUB_ROLES;
  if (isContractor(role)) return CONTRACTOR_SUB_ROLES.map(t => ({ value: t, label: t }));
  if (role === 'member') return MEMBER_SUB_ROLES.map(t => ({ value: t, label: t }));
  return [];
}

export default function UserDetailModal({ open, user, currentUserId, onClose, onSaved, showToast }) {
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const role = form?.role || user?.role;
  const contractor = isContractor(role);
  const staff = isStaff(role);
  const client = role === 'client';

  // Pull the side tables this person's role uses.
  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const [cpRes, clRes, notesRes, salaryRes] = await Promise.all([
        isContractor(user.role)
          ? supabase.from('contractor_profiles')
            .select('id, phone, admin_notes, payment_type, rate, retainer_enabled, retainer_min_hours, overtime_enabled, overtime_max_hours, overtime_multiplier')
            .eq('id', user.id).maybeSingle()
          : Promise.resolve({ data: null }),
        user.role === 'client'
          ? supabase.from('client_profiles').select('id, phone, admin_notes, company_name').eq('id', user.id).maybeSingle()
          : Promise.resolve({ data: null }),
        isStaff(user.role)
          ? supabase.from('profile_admin_notes').select('notes').eq('profile_id', user.id).maybeSingle()
          : Promise.resolve({ data: null }),
        isStaff(user.role)
          ? supabase.from('payroll_salaries').select('id, salary_type, amount_cents')
            .eq('profile_id', user.id).is('ended_at', null)
            .order('effective_date', { ascending: false }).limit(1).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      const cp = cpRes.data;
      const cl = clRes.data;
      const salary = salaryRes.data;

      setForm({
        // identity
        full_name: user.full_name || '',
        nickname: user.nickname || '',
        title: user.title || '',
        role: user.role,
        sub_role: user.sub_role || '',
        avatar_url: user.avatar_url || '',
        // contact
        email: user.email || '',
        phone: (isContractor(user.role) ? cp?.phone : user.role === 'client' ? cl?.phone : user.phone) || '',
        drive_email: user.drive_email || '',
        company_name: cl?.company_name || '',
        // pay — contractor
        payment_type: cp?.payment_type || 'hourly',
        rate: cp?.rate != null ? String(cp.rate) : '',
        retainer_enabled: !!cp?.retainer_enabled,
        retainer_min_hours: cp?.retainer_min_hours != null ? String(cp.retainer_min_hours) : '',
        overtime_enabled: !!cp?.overtime_enabled,
        overtime_max_hours: cp?.overtime_max_hours != null ? String(cp.overtime_max_hours) : '',
        overtime_multiplier: cp?.overtime_multiplier != null ? String(cp.overtime_multiplier) : '1.5',
        // pay — staff
        salary_id: salary?.id || null,
        salary_type: salary?.salary_type || 'yearly',
        salary_amount: salary ? String(salary.amount_cents / 100) : '',
        _originalSalaryType: salary?.salary_type || 'yearly',
        _originalSalaryAmount: salary ? String(salary.amount_cents / 100) : '',
        // pay — everyone
        pay_method: user.pay_method || '',
        pay_method_detail: user.pay_method_detail || '',
        // notes
        notes: (isContractor(user.role) ? cp?.admin_notes
          : user.role === 'client' ? cl?.admin_notes
            : notesRes.data?.notes) || '',
        _originalEmail: user.email || '',
      });
    } catch (err) {
      console.error('Load user detail failed:', err);
      setError('Could not load this user’s details.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { if (open && user) load(); }, [open, user, load]);

  if (!open || !user) return null;

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleAvatar = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Pick an image file.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Images must be under 5 MB.'); return; }
    setUploading(true);
    setError('');
    try {
      // Same <userId>/… layout the user's own uploads use, so both paths and
      // the storage policies line up.
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      set('avatar_url', pub.publicUrl);
    } catch (err) {
      console.error('Avatar upload failed:', err);
      setError(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleSave = async () => {
    if (!form.full_name.trim()) { setError('Name can’t be empty.'); return; }
    setSaving(true);
    setError('');
    try {
      // 1. Login email goes through the edge function (auth.users + profile).
      const nextEmail = form.email.trim().toLowerCase();
      if (nextEmail && nextEmail !== form._originalEmail.toLowerCase()) {
        const { data: { session } } = await supabase.auth.getSession();
        const resp = await fetch(
          `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/admin-update-user`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify({ userId: user.id, email: nextEmail }),
          },
        );
        const body = await resp.json();
        if (!resp.ok || body.error) throw new Error(body.error || 'Email update failed');
      }

      // 2. The profiles row.
      const profilePatch = {
        full_name: form.full_name.trim(),
        nickname: form.nickname.trim() || null,
        title: form.title.trim() || null,
        sub_role: form.sub_role || null,
        avatar_url: form.avatar_url || null,
        drive_email: form.drive_email.trim() || null,
        pay_method: form.pay_method || null,
        pay_method_detail: form.pay_method_detail.trim() || null,
        updated_at: new Date().toISOString(),
      };
      // Phone lives on the side table for contractors/clients.
      if (staff) profilePatch.phone = form.phone.trim() || null;
      const { error: pErr } = await supabase.from('profiles').update(profilePatch).eq('id', user.id);
      if (pErr) throw pErr;

      // 3. Role-specific side tables.
      if (contractor) {
        const { error: cErr } = await supabase.from('contractor_profiles').upsert({
          id: user.id,
          phone: form.phone.trim() || null,
          admin_notes: form.notes.trim() || null,
          payment_type: form.payment_type,
          rate: form.rate === '' ? null : Number(form.rate),
          retainer_enabled: form.payment_type === 'hourly' ? form.retainer_enabled : false,
          retainer_min_hours: form.payment_type === 'hourly' && form.retainer_enabled && form.retainer_min_hours !== ''
            ? Number(form.retainer_min_hours) : null,
          overtime_enabled: form.payment_type === 'hourly' ? form.overtime_enabled : false,
          overtime_max_hours: form.payment_type === 'hourly' && form.overtime_enabled && form.overtime_max_hours !== ''
            ? Number(form.overtime_max_hours) : null,
          overtime_multiplier: form.payment_type === 'hourly' && form.overtime_multiplier !== ''
            ? Number(form.overtime_multiplier) : null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });
        if (cErr) throw cErr;
      } else if (client) {
        const { error: clErr } = await supabase.from('client_profiles').upsert({
          id: user.id,
          phone: form.phone.trim() || null,
          admin_notes: form.notes.trim() || null,
          company_name: form.company_name.trim() || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });
        if (clErr) throw clErr;
      } else {
        const { error: nErr } = await supabase.from('profile_admin_notes').upsert({
          profile_id: user.id,
          notes: form.notes.trim() || null,
          updated_by: currentUserId || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'profile_id' });
        if (nErr) throw nErr;

        // Pay type for staff: end the current row and write a new one, so the
        // salary history in Payroll stays intact rather than being overwritten.
        // Untouched pay leaves the existing row exactly as it was.
        const amountCents = form.salary_amount === '' ? null : Math.round(parseFloat(form.salary_amount) * 100);
        const payChanged = form.salary_type !== form._originalSalaryType
          || form.salary_amount !== form._originalSalaryAmount;
        if (payChanged && amountCents !== null && !isNaN(amountCents) && amountCents > 0) {
          if (form.salary_id) {
            await supabase.from('payroll_salaries')
              .update({ ended_at: new Date().toISOString().split('T')[0], updated_at: new Date().toISOString() })
              .eq('id', form.salary_id);
          }
          const { error: sErr } = await supabase.from('payroll_salaries').insert({
            profile_id: user.id,
            salary_type: form.salary_type,
            amount_cents: amountCents,
            effective_date: new Date().toISOString().split('T')[0],
            created_by: currentUserId || null,
          });
          if (sErr) throw sErr;
        }
      }

      if (showToast) showToast('Saved');
      if (onSaved) onSaved();
      onClose();
    } catch (err) {
      console.error('Save user detail failed:', err);
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const initial = (form?.full_name || user.full_name || '?').charAt(0).toUpperCase();
  const options = subRoleOptions(role);

  return (
    <div style={styles.overlay} {...backdropDismiss(onClose)}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <h2 style={styles.h2}>{user.full_name}</h2>
            <p style={styles.subtitle}>
              {role}{user.id === currentUserId ? ' · this is you' : ''}
            </p>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        {loading || !form ? (
          <div style={styles.body}><p style={styles.loading}>Loading…</p></div>
        ) : (
          <div style={styles.body}>
            {error && <div style={styles.error}>{error}</div>}

            {/* ── Picture ── */}
            <div style={styles.avatarRow}>
              <div style={styles.avatar}>
                {form.avatar_url
                  ? <img src={form.avatar_url} alt="" style={styles.avatarImg} />
                  : initial}
              </div>
              <div style={styles.avatarActions}>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={e => handleAvatar(e.target.files?.[0])}
                />
                <button
                  style={styles.smallBtn}
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? 'Uploading…' : form.avatar_url ? 'Replace photo' : 'Upload photo'}
                </button>
                {form.avatar_url && (
                  <button style={styles.smallBtnGhost} onClick={() => set('avatar_url', '')}>
                    Remove
                  </button>
                )}
              </div>
            </div>

            {/* ── Identity ── */}
            <div style={styles.sectionTitle}>Identity</div>
            <div style={styles.grid2}>
              <Field label="Full name">
                <input style={styles.input} value={form.full_name} onChange={e => set('full_name', e.target.value)} />
              </Field>
              <Field label="Nickname">
                <input style={styles.input} value={form.nickname} onChange={e => set('nickname', e.target.value)} placeholder="Optional" />
              </Field>
              <Field label="Title">
                <input style={styles.input} value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Executive Producer" />
              </Field>
              <Field label="Sub-role">
                {options.length > 0 ? (
                  <select style={styles.input} value={form.sub_role} onChange={e => set('sub_role', e.target.value)}>
                    <option value="">None</option>
                    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <div style={styles.readonlyNote}>No sub-roles for this role</div>
                )}
              </Field>
            </div>

            {/* ── Contact ── */}
            <div style={styles.sectionTitle}>Contact</div>
            <div style={styles.grid2}>
              <Field label="Email (login)">
                <input style={styles.input} type="email" value={form.email} onChange={e => set('email', e.target.value)} />
              </Field>
              <Field label="Phone">
                <input style={styles.input} value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="(555) 555-5555" />
              </Field>
              <Field label="Drive email">
                <input style={styles.input} type="email" value={form.drive_email} onChange={e => set('drive_email', e.target.value)} placeholder="Google account for Drive sharing" />
              </Field>
              {client && (
                <Field label="Company">
                  <input style={styles.input} value={form.company_name} onChange={e => set('company_name', e.target.value)} />
                </Field>
              )}
            </div>
            {form.email.trim().toLowerCase() !== form._originalEmail.toLowerCase() && (
              <p style={styles.warn}>
                Changing this changes the address they sign in with.
              </p>
            )}

            {/* ── Pay ── */}
            {!client && (
              <>
                <div style={styles.sectionTitle}>Pay</div>
                <div style={styles.grid2}>
                  <Field label="Pay method">
                    <select style={styles.input} value={form.pay_method} onChange={e => set('pay_method', e.target.value)}>
                      {PAY_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Pay handle / detail">
                    <input style={styles.input} value={form.pay_method_detail} onChange={e => set('pay_method_detail', e.target.value)} placeholder="@handle or account note" />
                  </Field>

                  {contractor ? (
                    <>
                      <Field label="Payment type">
                        <select style={styles.input} value={form.payment_type} onChange={e => set('payment_type', e.target.value)}>
                          <option value="hourly">Hourly</option>
                          <option value="per_project">Per project</option>
                        </select>
                      </Field>
                      <Field label={form.payment_type === 'hourly' ? 'Rate ($/hr)' : 'Rate ($/project)'}>
                        <input style={styles.input} type="number" step="0.01" value={form.rate} onChange={e => set('rate', e.target.value)} />
                      </Field>
                    </>
                  ) : (
                    <>
                      <Field label="Pay type">
                        <select style={styles.input} value={form.salary_type} onChange={e => set('salary_type', e.target.value)}>
                          <option value="yearly">Yearly</option>
                          <option value="per_period">Per Period</option>
                          <option value="hourly">Hourly</option>
                        </select>
                      </Field>
                      <Field label={
                        form.salary_type === 'yearly' ? 'Annual salary ($)'
                          : form.salary_type === 'hourly' ? 'Rate ($/hr)'
                            : 'Per period amount ($)'
                      }>
                        <input style={styles.input} type="number" step="0.01" value={form.salary_amount} onChange={e => set('salary_amount', e.target.value)} />
                      </Field>
                    </>
                  )}
                </div>

                {contractor && form.payment_type === 'hourly' && (
                  <div style={styles.grid2}>
                    <Field label="Retainer">
                      <label style={styles.checkRow}>
                        <input type="checkbox" checked={form.retainer_enabled} onChange={e => set('retainer_enabled', e.target.checked)} />
                        <span>Guarantee minimum hours</span>
                      </label>
                      {form.retainer_enabled && (
                        <input style={{ ...styles.input, marginTop: 6 }} type="number" step="0.5" placeholder="Minimum hours per period"
                          value={form.retainer_min_hours} onChange={e => set('retainer_min_hours', e.target.value)} />
                      )}
                    </Field>
                    <Field label="Overtime">
                      <label style={styles.checkRow}>
                        <input type="checkbox" checked={form.overtime_enabled} onChange={e => set('overtime_enabled', e.target.checked)} />
                        <span>Pay overtime past a cap</span>
                      </label>
                      {form.overtime_enabled && (
                        <div style={styles.grid2Tight}>
                          <input style={{ ...styles.input, marginTop: 6 }} type="number" step="0.5" placeholder="Hours cap"
                            value={form.overtime_max_hours} onChange={e => set('overtime_max_hours', e.target.value)} />
                          <input style={{ ...styles.input, marginTop: 6 }} type="number" step="0.1" placeholder="Multiplier"
                            value={form.overtime_multiplier} onChange={e => set('overtime_multiplier', e.target.value)} />
                        </div>
                      )}
                    </Field>
                  </div>
                )}
              </>
            )}

            {/* ── Admin notes ── */}
            <div style={styles.sectionTitle}>
              Admin notes
              <span style={styles.privatePill}>admin only</span>
            </div>
            <textarea
              style={styles.textarea}
              rows={4}
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Only admins can see this. Performance notes, agreements, context…"
            />
          </div>
        )}

        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button
            style={{ ...styles.saveBtn, opacity: saving || loading ? 0.5 : 1 }}
            onClick={handleSave}
            disabled={saving || loading}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={styles.field}>
      <div style={styles.fieldLabel}>{label}</div>
      {children}
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    background: colors.bgHover, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14,
    width: 620, maxWidth: '94vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '20px 24px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  h2: { fontSize: 18, fontWeight: 700, color: '#fff', margin: 0 },
  subtitle: { fontSize: 12, color: 'rgba(255,255,255,0.45)', margin: '3px 0 0', textTransform: 'capitalize' },
  closeBtn: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 26,
    cursor: 'pointer', lineHeight: 1, padding: 0, marginTop: -2,
  },
  body: { padding: '20px 24px', overflowY: 'auto', flex: 1 },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: 10,
    padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  loading: { color: 'rgba(255,255,255,0.4)', fontSize: 13, margin: 0 },
  error: {
    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
    color: '#f87171', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, marginBottom: 16,
  },
  warn: { fontSize: 11.5, color: '#fbbf24', margin: '-6px 0 16px' },

  avatarRow: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 },
  avatar: {
    width: 64, height: 64, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
    background: colors.accent, color: '#fff', display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: 24, fontWeight: 700,
  },
  avatarImg: { width: '100%', height: '100%', objectFit: 'cover' },
  avatarActions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  smallBtn: {
    background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
    color: 'rgba(255,255,255,0.8)', borderRadius: 7, padding: '6px 12px',
    fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
  },
  smallBtnGhost: {
    background: 'none', border: '1px solid rgba(255,255,255,0.1)',
    color: 'rgba(255,255,255,0.45)', borderRadius: 7, padding: '6px 12px',
    fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
  },

  sectionTitle: {
    fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: 0.6,
    textTransform: 'uppercase', margin: '4px 0 12px', paddingTop: 12,
    borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 8,
  },
  privatePill: {
    background: 'rgba(245,158,11,0.15)', color: '#f59e0b', borderRadius: 999,
    padding: '2px 8px', fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3,
  },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  grid2Tight: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  field: { marginBottom: 16 },
  fieldLabel: {
    fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', letterSpacing: 0.4,
    textTransform: 'uppercase', margin: '0 0 6px',
  },
  input: {
    width: '100%', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, padding: '8px 10px', color: '#fff', fontSize: 13, outline: 'none',
    boxSizing: 'border-box', fontFamily: 'inherit',
  },
  textarea: {
    width: '100%', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, padding: '9px 11px', color: '#fff', fontSize: 13, outline: 'none',
    boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit',
  },
  readonlyNote: {
    fontSize: 12, color: 'rgba(255,255,255,0.3)', padding: '9px 0',
  },
  checkRow: {
    display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5,
    color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
  },
  cancelBtn: {
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    color: 'rgba(255,255,255,0.7)', borderRadius: 9, padding: '9px 18px',
    fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  saveBtn: {
    background: colors.accent, border: 'none', color: '#fff', borderRadius: 9,
    padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  },
};
