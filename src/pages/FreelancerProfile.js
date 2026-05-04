import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';

const SPECIALTIES = ['Editor', 'Designer', 'Writer', 'Other'];

export default function FreelancerProfile() {
  const { profile } = useAuth();
  const [form, setForm] = useState({
    full_name: '',
    title: '',
    specialty: '',
    hourly_rate: '',
    phone: '',
    payment_method: '',
    payment_details: '',
    bio: '',
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    const [{ data: prof }, { data: flProf }] = await Promise.all([
      supabase.from('profiles').select('full_name, title, email, avatar_url').eq('id', profile.id).single(),
      supabase.from('freelancer_profiles').select('*').eq('id', profile.id).single(),
    ]);
    setForm({
      full_name: prof?.full_name || '',
      title: prof?.title || '',
      specialty: flProf?.specialty || '',
      hourly_rate: flProf?.hourly_rate != null ? String(flProf.hourly_rate) : '',
      phone: flProf?.phone || '',
      payment_method: flProf?.payment_method || '',
      payment_details: flProf?.payment_details || '',
      bio: flProf?.bio || '',
    });
    setEmail(prof?.email || '');
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  function updateField(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await Promise.all([
        supabase.from('profiles').update({
          full_name: form.full_name,
          title: form.title,
          updated_at: new Date().toISOString(),
        }).eq('id', profile.id),
        supabase.from('freelancer_profiles').update({
          specialty: form.specialty || null,
          hourly_rate: form.hourly_rate ? parseFloat(form.hourly_rate) : null,
          phone: form.phone || null,
          payment_method: form.payment_method || null,
          payment_details: form.payment_details || null,
          bio: form.bio || null,
          updated_at: new Date().toISOString(),
        }).eq('id', profile.id),
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  }

  async function handlePasswordChange() {
    setError(null);
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    const { error: authError } = await supabase.auth.updateUser({ password });
    if (authError) {
      setError(authError.message);
      return;
    }
    setPassword('');
    setConfirmPassword('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) {
    return (
      <div style={styles.container}>
        <h1 style={styles.title}>Profile</h1>
        <p style={styles.loadingText}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Profile</h1>

      {error && <div style={styles.errorBanner}>{error}</div>}
      {saved && <div style={styles.savedBanner}>Saved successfully</div>}

      {/* Profile Info */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Profile Info</h2>

        <div style={styles.fieldGroup}>
          <label style={styles.fieldLabel}>Full Name</label>
          <input
            type="text"
            value={form.full_name}
            onChange={e => updateField('full_name', e.target.value)}
            style={styles.input}
          />
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.fieldLabel}>Title</label>
          <input
            type="text"
            value={form.title}
            onChange={e => updateField('title', e.target.value)}
            placeholder="e.g. Video Editor"
            style={styles.input}
          />
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.fieldLabel}>Email</label>
          <input
            type="text"
            value={email}
            disabled
            style={{ ...styles.input, ...styles.inputDisabled }}
          />
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.fieldLabel}>Specialty</label>
          <select
            value={form.specialty}
            onChange={e => updateField('specialty', e.target.value)}
            style={styles.select}
          >
            <option value="">Select...</option>
            {SPECIALTIES.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.fieldLabel}>Hourly Rate ($)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.hourly_rate}
            onChange={e => updateField('hourly_rate', e.target.value)}
            placeholder="0.00"
            style={styles.input}
          />
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.fieldLabel}>Phone</label>
          <input
            type="text"
            value={form.phone}
            onChange={e => updateField('phone', e.target.value)}
            placeholder="Optional"
            style={styles.input}
          />
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.fieldLabel}>Bio</label>
          <textarea
            value={form.bio}
            onChange={e => updateField('bio', e.target.value)}
            placeholder="A short bio..."
            rows={3}
            style={styles.textarea}
          />
        </div>
      </div>

      {/* Payment Info */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Payment Info</h2>

        <div style={styles.fieldGroup}>
          <label style={styles.fieldLabel}>Payment Method</label>
          <input
            type="text"
            value={form.payment_method}
            onChange={e => updateField('payment_method', e.target.value)}
            placeholder="e.g. Venmo, Zelle, PayPal"
            style={styles.input}
          />
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.fieldLabel}>Payment Details</label>
          <input
            type="text"
            value={form.payment_details}
            onChange={e => updateField('payment_details', e.target.value)}
            placeholder="e.g. @username or email"
            style={styles.input}
          />
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          ...styles.saveBtn,
          ...(saving ? styles.saveBtnDisabled : {}),
        }}
      >
        {saving ? 'Saving...' : 'Save'}
      </button>

      {/* Change Password */}
      <div style={{ ...styles.section, marginTop: 40 }}>
        <h2 style={styles.sectionTitle}>Change Password</h2>

        <div style={styles.fieldGroup}>
          <label style={styles.fieldLabel}>New Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            style={styles.input}
          />
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.fieldLabel}>Confirm Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Re-enter password"
            style={styles.input}
          />
        </div>

        <button
          onClick={handlePasswordChange}
          disabled={!password || !confirmPassword}
          style={{
            ...styles.passwordBtn,
            ...(!password || !confirmPassword ? styles.saveBtnDisabled : {}),
          }}
        >
          Update Password
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: {
    padding: '32px 40px',
    maxWidth: 600,
    margin: '0 auto',
    fontFamily: 'DM Sans, sans-serif',
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.95)',
    margin: '0 0 32px 0',
  },
  loadingText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
  },
  section: {
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    padding: '24px 28px',
    marginBottom: 24,
    border: '1px solid rgba(255,255,255,0.06)',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.85)',
    margin: '0 0 20px 0',
  },
  fieldGroup: {
    marginBottom: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    fontFamily: 'DM Sans, sans-serif',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  inputDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  select: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    fontFamily: 'DM Sans, sans-serif',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    appearance: 'none',
  },
  textarea: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    fontFamily: 'DM Sans, sans-serif',
    outline: 'none',
    resize: 'vertical',
    width: '100%',
    boxSizing: 'border-box',
  },
  saveBtn: {
    background: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '10px 28px',
    fontSize: 14,
    fontWeight: 600,
    fontFamily: 'DM Sans, sans-serif',
    cursor: 'pointer',
    width: '100%',
  },
  saveBtnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  passwordBtn: {
    background: 'rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.85)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 6,
    padding: '8px 20px',
    fontSize: 13,
    fontWeight: 600,
    fontFamily: 'DM Sans, sans-serif',
    cursor: 'pointer',
    marginTop: 4,
  },
  errorBanner: {
    background: 'rgba(239,68,68,0.12)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 8,
    padding: '10px 16px',
    color: '#f87171',
    fontSize: 13,
    marginBottom: 20,
  },
  savedBanner: {
    background: 'rgba(74,222,128,0.12)',
    border: '1px solid rgba(74,222,128,0.3)',
    borderRadius: 8,
    padding: '10px 16px',
    color: '#4ade80',
    fontSize: 13,
    marginBottom: 20,
  },
};
