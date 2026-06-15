import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

// Edit a `tasks` row. Used by the Workflows Progress section so a
// producer can fix a title, push out the due date, reassign, or mark
// something done without bouncing into the workflow board first.
//
// Workflow-bound tasks (workflow_instance_id != null) keep all fields
// editable but show a yellow banner — title/status changes can knock
// the workflow's sign-off + auto-advance flow off the rails, so the
// editor surfaces the risk rather than silently disabling things.

const STATUS_OPTIONS = [
  { value: 'active',   label: 'Active' },
  { value: 'pending',  label: 'Pending' },
  { value: 'on_hold',  label: 'On hold' },
  { value: 'complete', label: 'Complete' },
];

function toDateInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function TaskEditModal({ open, task, profiles, onClose, onSaved, showToast }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !task) { setForm(null); return; }
    setForm({
      title: task.title || '',
      status: task.status || 'active',
      due_date: toDateInput(task.due_date),
      planned_date: task.planned_date || '',
      assignee_id: task.assignee_id || '',
      description: task.description || '',
      hold_reason: task.hold_reason || '',
    });
    setError(null);
  }, [open, task]);

  if (!open || !task || !form) return null;

  const isWorkflowTask = !!task.workflow_instance_id;
  const isAutomationTask = !!task.automation_id;

  async function save() {
    if (!form.title.trim()) { setError('Title is required.'); return; }
    setSaving(true); setError(null);
    try {
      const patch = {
        title: form.title.trim(),
        status: form.status,
        due_date: form.due_date
          ? new Date(form.due_date + 'T00:00:00').toISOString()
          : null,
        planned_date: form.planned_date || null,
        assignee_id: form.assignee_id || null,
        description: form.description.trim() || null,
        hold_reason: form.status === 'on_hold' ? (form.hold_reason.trim() || null) : null,
      };
      if (form.status === 'complete' && task.status !== 'complete') {
        patch.completed_at = new Date().toISOString();
      } else if (form.status !== 'complete' && task.status === 'complete') {
        // Un-completing a task clears the timestamp so the Done · 7d
        // rollup stops counting it.
        patch.completed_at = null;
      }
      const { error: upErr } = await supabase.from('tasks').update(patch).eq('id', task.id);
      if (upErr) throw upErr;
      if (showToast) showToast('Task updated');
      if (onSaved) onSaved();
      if (onClose) onClose();
    } catch (e) {
      setError(e.message);
      if (showToast) showToast('Save failed: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  function patch(p) { setForm((f) => ({ ...f, ...p })); }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <h2 style={styles.h2}>Edit task</h2>
            <p style={styles.subtitle}>Created {new Date(task.created_at).toLocaleString()}</p>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div style={styles.body}>
          {(isWorkflowTask || isAutomationTask) && (
            <div style={styles.banner}>
              {isWorkflowTask
                ? 'This task is part of a workflow. Title or status changes can affect sign-off and auto-advance.'
                : 'This task was created by an automation. Edits won\'t un-trigger the automation.'}
            </div>
          )}

          <Field label="Title *">
            <input
              autoFocus
              value={form.title}
              onChange={(e) => patch({ title: e.target.value })}
              style={styles.input}
            />
          </Field>

          <Row>
            <Field label="Status">
              <select value={form.status} onChange={(e) => patch({ status: e.target.value })} style={styles.input}>
                {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Assignee">
              <select value={form.assignee_id} onChange={(e) => patch({ assignee_id: e.target.value })} style={styles.input}>
                <option value="">— Unassigned —</option>
                {(profiles || []).map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name || p.email || p.name || 'Unnamed'}</option>
                ))}
              </select>
            </Field>
          </Row>

          {form.status === 'on_hold' && (
            <Field label="Hold reason">
              <input
                value={form.hold_reason}
                onChange={(e) => patch({ hold_reason: e.target.value })}
                style={styles.input}
                placeholder="Why is this on hold?"
              />
            </Field>
          )}

          <Row>
            <Field label="Due date">
              <input type="date" value={form.due_date} onChange={(e) => patch({ due_date: e.target.value })} style={styles.input} />
            </Field>
            <Field label="Planned date">
              <input type="date" value={form.planned_date} onChange={(e) => patch({ planned_date: e.target.value })} style={styles.input} />
            </Field>
          </Row>

          <Field label="Notes">
            <textarea
              value={form.description}
              onChange={(e) => patch({ description: e.target.value })}
              rows={3}
              style={{ ...styles.input, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </Field>

          {error && <div style={styles.error}>{error}</div>}
        </div>

        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button
            style={{ ...styles.primaryBtn, opacity: saving ? 0.6 : 1 }}
            onClick={save}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
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

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, width: 560, maxWidth: '92vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '20px 24px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  h2: { fontSize: 18, fontWeight: 700, color: '#fff', margin: 0 },
  subtitle: { fontSize: 11, color: 'rgba(255,255,255,0.4)', margin: '4px 0 0' },
  closeBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 26, cursor: 'pointer', lineHeight: 1, padding: 0, marginTop: -2 },
  body: { padding: '16px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 },
  banner: { padding: '10px 12px', background: 'rgba(250,204,21,0.08)', border: '1px solid rgba(250,204,21,0.3)', borderRadius: 8, color: '#facc15', fontSize: 12, lineHeight: 1.5 },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 24px', borderTop: '1px solid rgba(255,255,255,0.06)' },
  fieldWrap: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1 },
  fieldLabel: { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', letterSpacing: 0.4, textTransform: 'uppercase' },
  input: { width: '100%', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '8px 12px', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' },
  primaryBtn: { background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  cancelBtn: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  error: { padding: 10, background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, fontSize: 12 },
};
