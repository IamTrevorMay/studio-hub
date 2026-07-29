import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import backdropDismiss from '../lib/backdropDismiss';
import { colors } from '../lib/styleTokens';

// Create / edit a contractor_assignments row. The Workflows Progress
// table opens this in edit mode when a contractor row is clicked; the
// `+ Assignment` button on Workflows opens it in create mode.
//
// Create: insert + notify the contractor.
// Edit:   update only (we do NOT re-notify on edits — only on creation).
// Both: contractor list comes from profiles where role='freelancer'.

const EDIT_STATUSES = [
  { value: 'assigned',    label: 'Assigned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed',   label: 'Completed' },
];

// Accept either a full Google Drive folder URL or a bare folder id and
// normalize to the bare id we store in submit_folder_id. Returns '' when the
// input is empty/unparseable so the caller can fall back to null (= default).
function parseDriveFolderId(raw) {
  const v = (raw || '').trim();
  if (!v) return '';
  // .../folders/<id> ... (handles /drive/folders, /drive/u/0/folders, query strings)
  const m = v.match(/\/folders\/([\w-]+)/);
  if (m) return m[1];
  // open?id=<id> style links
  const q = v.match(/[?&]id=([\w-]+)/);
  if (q) return q[1];
  // Already a bare id (no slashes / scheme).
  if (/^[\w-]+$/.test(v)) return v;
  return '';
}

function toDateInput(v) {
  if (!v) return '';
  // contractor_assignments.due_date is a `date` column → 'YYYY-MM-DD'.
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toTimeInput(v) {
  // `time` column comes back as 'HH:MM:SS' — <input type="time"> wants 'HH:MM'.
  return (v || '').slice(0, 5);
}

export default function ContractorAssignmentModal({
  open, onClose, onCreated, onSaved, showToast, currentUserId, existing,
}) {
  const isEdit = !!existing;
  const [freelancers, setContractors] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    contractor_id: '', title: '', description: '', asset_url: '',
    due_date: '', due_time: '', pay_amount: '', status: 'assigned', submit_folder: '',
  });

  const fetchContractors = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email, title')
      .in('role', ['contractor', 'freelancer'])
      .order('full_name');
    setContractors(data || []);
  }, []);

  useEffect(() => {
    if (!open) return;
    fetchContractors();
    if (isEdit) {
      setForm({
        contractor_id: existing.contractor_id || '',
        title: existing.title || '',
        description: existing.description || '',
        asset_url: existing.asset_url || '',
        due_date: toDateInput(existing.due_date),
        due_time: toTimeInput(existing.due_time),
        pay_amount: existing.pay_amount != null ? String(existing.pay_amount) : '',
        status: existing.status || 'assigned',
        submit_folder: existing.submit_folder_id || '',
      });
    } else {
      setForm({
        contractor_id: '', title: '', description: '', asset_url: '',
        due_date: '', due_time: '', pay_amount: '', status: 'assigned', submit_folder: '',
      });
    }
  }, [open, isEdit, existing, fetchContractors]);

  const canSubmit = form.contractor_id && form.title.trim() && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const base = {
        contractor_id: form.contractor_id,
        title: form.title.trim(),
        description: form.description.trim() || null,
        asset_url: form.asset_url.trim() || null,
        due_date: form.due_date || null,
        due_time: form.due_time || null,
        pay_amount: form.pay_amount ? parseFloat(form.pay_amount) : null,
        submit_folder_id: parseDriveFolderId(form.submit_folder) || null,
      };

      if (isEdit) {
        const updates = { ...base, status: form.status };
        // Mark/un-mark completion timestamp on status flips.
        if (form.status === 'completed' && existing.status !== 'completed') {
          updates.completed_at = new Date().toISOString();
        } else if (form.status !== 'completed' && existing.status === 'completed') {
          updates.completed_at = null;
        }
        updates.updated_at = new Date().toISOString();
        const { error } = await supabase
          .from('contractor_assignments')
          .update(updates)
          .eq('id', existing.id);
        if (error) throw error;
        if (showToast) showToast('Assignment updated');
        if (onSaved) onSaved();
      } else {
        const row = { ...base, created_by: currentUserId || null };
        const { error } = await supabase.from('contractor_assignments').insert(row);
        if (error) throw error;
        // Best-effort notification — a failure here must not report the (already
        // created) assignment as failed.
        try {
          await supabase.from('notifications').insert({
            user_id: form.contractor_id,
            type: 'assignment',
            title: 'New Assignment',
            body: `You have been assigned "${form.title.trim()}"`,
            link_tab: 'fl_dashboard',
            link_target: null,
          });
        } catch (_) { /* ignore */ }
        if (showToast) showToast('Assignment created');
        if (onCreated) onCreated();
      }
      if (onClose) onClose();
    } catch (err) {
      console.error(err);
      if (showToast) showToast((isEdit ? 'Save' : 'Create') + ' failed: ' + err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit) return;
    if (!window.confirm(`Delete assignment "${existing.title}"? This cannot be undone.`)) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from('contractor_assignments').delete().eq('id', existing.id);
      if (error) throw error;
      if (showToast) showToast('Assignment deleted');
      if (onSaved) onSaved();
      if (onClose) onClose();
    } catch (err) {
      if (showToast) showToast('Delete failed: ' + err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div style={styles.overlay} {...backdropDismiss(onClose)}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <h2 style={styles.h2}>{isEdit ? 'Edit Contractor Assignment' : 'Assign Contractor Work'}</h2>
            <p style={styles.subtitle}>
              {isEdit
                ? `Created ${existing.created_at ? new Date(existing.created_at).toLocaleString() : 'recently'}`
                : 'Create a paid assignment for a contractor.'}
            </p>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div style={styles.body}>
          <div style={styles.formGrid}>
            <div style={styles.formField}>
              <label style={styles.label}>Contractor *</label>
              <select
                value={form.contractor_id}
                onChange={e => setForm(p => ({ ...p, contractor_id: e.target.value }))}
                style={styles.select}
                disabled={isEdit}
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
            {isEdit && (
              <div style={styles.formField}>
                <label style={styles.label}>Status</label>
                <select
                  value={form.status}
                  onChange={e => setForm(p => ({ ...p, status: e.target.value }))}
                  style={styles.select}
                >
                  {EDIT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            )}
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
            <div style={{ ...styles.formField, gridColumn: '1 / -1' }}>
              <label style={styles.label}>Submission Folder Override</label>
              <input
                value={form.submit_folder}
                onChange={e => setForm(p => ({ ...p, submit_folder: e.target.value }))}
                style={styles.input}
                placeholder="Optional — paste a Drive folder link to override the default submit location"
              />
              {form.submit_folder.trim() && (
                <span style={styles.hint}>
                  {parseDriveFolderId(form.submit_folder)
                    ? `Files for this assignment will upload to folder ${parseDriveFolderId(form.submit_folder)}`
                    : 'Could not read a Drive folder from that link — submissions will use the default location.'}
                </span>
              )}
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
              <label style={styles.label}>Due Time</label>
              <input
                type="time"
                value={form.due_time}
                onChange={e => setForm(p => ({ ...p, due_time: e.target.value }))}
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
          {isEdit && (
            <button style={styles.deleteBtn} onClick={handleDelete} disabled={submitting}>
              Delete
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button
            style={{ ...styles.primaryBtn, opacity: canSubmit ? 1 : 0.45, cursor: canSubmit ? 'pointer' : 'default' }}
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save' : 'Create')}
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
    background: colors.bgHover, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14,
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
    display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center',
    padding: '14px 24px', borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px' },
  formField: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.55)' },
  hint: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
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
    background: colors.accent, color: colors.white, border: 'none', borderRadius: 6,
    padding: '8px 16px', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
  },
  deleteBtn: {
    background: 'transparent', border: '1px solid rgba(239,68,68,0.4)',
    color: '#f87171', borderRadius: 6, padding: '8px 16px',
    fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
};
