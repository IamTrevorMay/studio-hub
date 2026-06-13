import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';

// Modal for creating a freelancer_assignments row. Mirrors the
// "Create Assignment" form on the Contractors page.
export default function ContractorAssignmentModal({ open, onClose, onCreated, showToast, currentUserId }) {
  const [freelancers, setFreelancers] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    freelancer_id: '', title: '', description: '', asset_url: '',
    due_date: '', pay_amount: '',
  });

  const fetchFreelancers = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email, title')
      .eq('role', 'freelancer')
      .order('full_name');
    setFreelancers(data || []);
  }, []);

  useEffect(() => {
    if (open) fetchFreelancers();
  }, [open, fetchFreelancers]);

  const resetForm = () => setForm({
    freelancer_id: '', title: '', description: '', asset_url: '',
    due_date: '', pay_amount: '',
  });

  const canCreate = form.freelancer_id && form.title.trim() && !submitting;

  const handleCreate = async () => {
    if (!canCreate) return;
    setSubmitting(true);
    try {
      const row = {
        freelancer_id: form.freelancer_id,
        title: form.title.trim(),
        description: form.description.trim() || null,
        asset_url: form.asset_url.trim() || null,
        due_date: form.due_date || null,
        pay_amount: form.pay_amount ? parseFloat(form.pay_amount) : null,
        created_by: currentUserId || null,
      };
      const { error } = await supabase.from('freelancer_assignments').insert(row);
      if (error) throw error;

      await supabase.from('notifications').insert({
        user_id: form.freelancer_id,
        type: 'assignment',
        title: 'New Assignment',
        body: `You have been assigned "${form.title.trim()}"`,
        link_tab: 'fl_dashboard',
        link_target: null,
      });

      if (showToast) showToast('Assignment created');
      resetForm();
      if (onCreated) onCreated();
      if (onClose) onClose();
    } catch (err) {
      console.error(err);
      if (showToast) showToast('Create failed: ' + err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <h2 style={styles.h2}>Assign Contractor Work</h2>
            <p style={styles.subtitle}>Create a paid assignment for a freelancer.</p>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div style={styles.body}>
          <div style={styles.formGrid}>
            <div style={styles.formField}>
              <label style={styles.label}>Contractor *</label>
              <select
                value={form.freelancer_id}
                onChange={e => setForm(p => ({ ...p, freelancer_id: e.target.value }))}
                style={styles.select}
              >
                <option value="">Select...</option>
                {freelancers.map(fl => (
                  <option key={fl.id} value={fl.id}>
                    {fl.full_name || fl.email}{fl.title ? ` — ${fl.title}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div style={styles.formField}>
              <label style={styles.label}>Title *</label>
              <input
                value={form.title}
                onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                style={styles.input}
                placeholder="Assignment title"
              />
            </div>
            <div style={{ ...styles.formField, gridColumn: '1 / -1' }}>
              <label style={styles.label}>Description</label>
              <textarea
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                style={{ ...styles.input, minHeight: 70, resize: 'vertical', fontFamily: 'inherit' }}
                placeholder="Optional description"
              />
            </div>
            <div style={{ ...styles.formField, gridColumn: '1 / -1' }}>
              <label style={styles.label}>Asset Link</label>
              <input
                value={form.asset_url}
                onChange={e => setForm(p => ({ ...p, asset_url: e.target.value }))}
                style={styles.input}
                placeholder="Paste an Assets Library, Drive, or other URL"
              />
            </div>
            <div style={styles.formField}>
              <label style={styles.label}>Due Date</label>
              <input
                type="date"
                value={form.due_date}
                onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))}
                style={styles.input}
              />
            </div>
            <div style={styles.formField}>
              <label style={styles.label}>Pay Amount ($)</label>
              <input
                type="number"
                value={form.pay_amount}
                onChange={e => setForm(p => ({ ...p, pay_amount: e.target.value }))}
                style={styles.input}
                placeholder="0.00"
                min="0"
                step="0.01"
              />
            </div>
          </div>
        </div>

        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button
            style={{ ...styles.primaryBtn, opacity: canCreate ? 1 : 0.45, cursor: canCreate ? 'pointer' : 'default' }}
            onClick={handleCreate}
            disabled={!canCreate}
          >
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14,
    width: 560, maxWidth: '92vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '20px 24px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  h2: { fontSize: 18, fontWeight: 700, color: '#fff', margin: 0 },
  subtitle: { fontSize: 12, color: 'rgba(255,255,255,0.45)', margin: '3px 0 0' },
  closeBtn: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 26,
    cursor: 'pointer', lineHeight: 1, padding: 0, marginTop: -2,
  },
  body: { padding: '16px 24px', overflowY: 'auto', flex: 1 },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: 10,
    padding: '14px 24px', borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px' },
  formField: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.55)' },
  input: {
    width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6, padding: '8px 12px', color: '#fff', fontSize: 14, outline: 'none',
    boxSizing: 'border-box', fontFamily: 'inherit',
  },
  select: {
    width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6, padding: '8px 12px', color: '#fff', fontSize: 14, outline: 'none',
    boxSizing: 'border-box', fontFamily: 'inherit',
  },
  cancelBtn: {
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    color: 'rgba(255,255,255,0.7)', borderRadius: 6, padding: '8px 16px',
    fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  primaryBtn: {
    background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6,
    padding: '8px 16px', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
  },
};
