import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';

export default function FreelancerProfile() {
  const { profile } = useAuth();
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    payment_method: '',
    payment_details: '',
    bio: '',
  });
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const [paymentType, setPaymentType] = useState('');
  const [rate, setRate] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
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
      supabase.from('profiles').select('full_name, email, avatar_url, title').eq('id', profile.id).single(),
      supabase.from('freelancer_profiles').select('*').eq('id', profile.id).single(),
    ]);
    setForm({
      full_name: prof?.full_name || '',
      phone: flProf?.phone || '',
      payment_method: flProf?.payment_method || '',
      payment_details: flProf?.payment_details || '',
      bio: flProf?.bio || '',
    });
    setEmail(prof?.email || '');
    setTitle(prof?.title || '');
    setAvatarUrl(prof?.avatar_url || '');
    setPaymentType(flProf?.payment_type || '');
    setRate(flProf?.rate != null ? String(flProf.rate) : '');
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
          updated_at: new Date().toISOString(),
        }).eq('id', profile.id),
        supabase.from('freelancer_profiles').update({
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

  async function handleAvatarUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    setError(null);
    try {
      const ext = file.name.split('.').pop();
      const path = `${profile.id}/avatar.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
      // Bust cache with timestamp
      const url = `${publicUrl}?t=${Date.now()}`;
      await supabase.from('profiles').update({ avatar_url: url }).eq('id', profile.id);
      setAvatarUrl(url);
    } catch (err) {
      setError(err.message);
    }
    setAvatarUploading(false);
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

        {/* Avatar upload */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <label style={{ cursor: 'pointer', position: 'relative' }}>
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover' }}
              />
            ) : (
              <div style={{
                width: 80, height: 80, borderRadius: '50%', background: '#6366f1',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 28, fontWeight: 700,
              }}>
                {(form.full_name || '?')[0].toUpperCase()}
              </div>
            )}
            {avatarUploading && (
              <div style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                background: 'rgba(0,0,0,0.5)', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 11,
              }}>
                ...
              </div>
            )}
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleAvatarUpload}
            />
          </label>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
            Click to upload photo
          </div>
        </div>

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
          <label style={styles.fieldLabel}>Email</label>
          <input
            type="text"
            value={email}
            disabled
            style={{ ...styles.input, ...styles.inputDisabled }}
          />
        </div>

        {title && (
          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>Title</label>
            <input
              type="text"
              value={title}
              disabled
              style={{ ...styles.input, ...styles.inputDisabled }}
            />
          </div>
        )}

        {paymentType && (
          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>Payment Type</label>
            <input
              type="text"
              value={paymentType === 'hourly' ? 'Hourly' : 'By Project'}
              disabled
              style={{ ...styles.input, ...styles.inputDisabled }}
            />
          </div>
        )}

        {rate && (
          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>{paymentType === 'hourly' ? 'Hourly Rate' : 'Project Rate'}</label>
            <input
              type="text"
              value={`$${Number(rate).toFixed(2)}`}
              disabled
              style={{ ...styles.input, ...styles.inputDisabled }}
            />
          </div>
        )}

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
