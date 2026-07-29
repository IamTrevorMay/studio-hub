import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { RESEARCH_FIELDS, emptyResearchForm, listResearchDocs, createResearchDoc } from '../lib/researchDocs';
import { PeopleChips } from './MemberAssignmentModal';
import backdropDismiss from '../lib/backdropDismiss';
import { colors } from '../lib/styleTokens';

const TEAM_ROLES = ['admin', 'director', 'member', 'director_creative', 'director_comms'];

// Set Research Scope — opened from the "Set Research Scope" task that lands
// in My Tasks when a project card enters the Research column. Mirrors the
// Background Research layout of MemberAssignmentModal (research doc
// existing/create-new + assignee chips). Submitting spawns one 'research'
// task per assignee (via assign-task); when all of those complete, the card
// auto-advances to Write (workflow-complete-task → card-move).
export default function ResearchScopeModal({ open, project, onClose, onSubmitted, showToast }) {
  const [profiles, setProfiles] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [researchMode, setResearchMode] = useState('existing'); // 'existing' | 'new'
  const [researchDocs, setResearchDocs] = useState([]);
  const [researchLoading, setResearchLoading] = useState(false);
  const [selectedDocUrl, setSelectedDocUrl] = useState('');
  const [researchForm, setResearchForm] = useState(emptyResearchForm);

  const fetchData = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email, role')
        .order('full_name', { ascending: true, nullsFirst: false });
      setProfiles((data || []).filter(p => p.role && p.role !== 'deactivated'));
    } catch (err) {
      console.error('ResearchScopeModal fetch error:', err);
    }
  }, []);

  const fetchResearchDocs = useCallback(async () => {
    setResearchLoading(true);
    try {
      const data = await listResearchDocs();
      setResearchDocs(data.items || []);
    } catch (err) {
      console.error('Fetch research docs error:', err);
      if (showToast) showToast('Failed to load research docs', 'error');
    } finally {
      setResearchLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (!open) return;
    fetchData();
    fetchResearchDocs();
    setAssignees([]);
    setNotes('');
    setDueDate(project?.deadline || '');
    setResearchMode('existing');
    setSelectedDocUrl('');
    setResearchForm(emptyResearchForm());
  }, [open, project?.id]); // eslint-disable-line

  const team = useMemo(() => profiles.filter(p => TEAM_ROLES.includes(p.role)), [profiles]);
  const contractors = useMemo(() => profiles.filter(p => p.role === 'contractor' || p.role === 'freelancer'), [profiles]);

  const toggleAssignee = (id) => {
    setAssignees(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const researchReady = researchMode === 'existing'
    ? !!selectedDocUrl
    : !!researchForm.big_question.trim();
  const canSubmit = researchReady && assignees.length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !project) return;
    setSubmitting(true);
    try {
      // Resolve the research doc URL (create one if needed).
      let linkUrl = selectedDocUrl;
      if (researchMode === 'new') {
        const doc = await createResearchDoc({
          name: researchForm.big_question.trim(),
          form: researchForm,
        });
        linkUrl = doc.url;
      }

      // Spawn the researcher tasks — same shape as a directly-assigned
      // research task, but tied to the project so completion advances it.
      const { data, error } = await supabase.functions.invoke('assign-task', {
        body: {
          op: 'create',
          title: `${project.name} — Research`,
          assignee_ids: assignees,
          due_date: dueDate || null,
          notes: notes.trim() || 'Fill out a research brief for an upcoming project.',
          link_url: linkUrl,
          step_key: 'research',
          related_entity_type: 'project',
          related_entity_id: project.id,
        },
      });
      if (error || data?.error) throw new Error(error?.message || data?.error);

      // Record the assignees on the Research stage so they show on the card
      // and can move it manually. Duplicate rows (23505) are fine.
      await Promise.all(assignees.map((userId) =>
        supabase.from('project_stage_assignments').insert({
          project_id: project.id, stage: 'research', user_id: userId,
        }),
      ));

      if (showToast) showToast(`Research assigned to ${assignees.length} ${assignees.length === 1 ? 'person' : 'people'}`);
      if (onSubmitted) await onSubmitted();
      if (onClose) onClose();
    } catch (err) {
      console.error('Set research scope failed:', err);
      if (showToast) showToast('Failed: ' + err.message, 'error');
      else alert('Failed to set research scope: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open || !project) return null;

  return (
    <div style={styles.overlay} {...backdropDismiss(onClose)}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <h2 style={styles.h2}>Set Research Scope</h2>
            <p style={styles.subtitle}>“{project.name}” — assign researchers. The card moves to Write when everyone finishes.</p>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div style={styles.body}>
          <div style={styles.fieldLabel}>
            Research document
            {!researchReady && <span style={{ color: '#f87171', marginLeft: 6 }}>required</span>}
          </div>
          <div style={styles.segmentRow}>
            <button
              type="button"
              style={{ ...styles.segmentBtn, ...(researchMode === 'existing' ? styles.segmentBtnOn : {}) }}
              onClick={() => setResearchMode('existing')}
            >Use existing</button>
            <button
              type="button"
              style={{ ...styles.segmentBtn, ...(researchMode === 'new' ? styles.segmentBtnOn : {}) }}
              onClick={() => setResearchMode('new')}
            >Create new</button>
          </div>

          {researchMode === 'existing' ? (
            <select
              style={{ ...styles.input, marginTop: 8 }}
              value={selectedDocUrl}
              onChange={e => setSelectedDocUrl(e.target.value)}
            >
              <option value="">{researchLoading ? 'Loading…' : 'Select a research doc…'}</option>
              {researchDocs.map(d => <option key={d.id} value={d.url}>{d.name}</option>)}
            </select>
          ) : (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {RESEARCH_FIELDS.map(f => (
                <div key={f.key}>
                  <div style={styles.fieldLabel}>
                    {f.label}
                    {f.required && !researchForm[f.key].trim() && <span style={{ color: '#f87171', marginLeft: 6 }}>required</span>}
                  </div>
                  <p style={styles.researchHelp}>{f.help}</p>
                  {f.multiline ? (
                    <textarea
                      style={styles.textarea}
                      rows={2}
                      value={researchForm[f.key]}
                      onChange={e => setResearchForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    />
                  ) : (
                    <input
                      style={styles.input}
                      value={researchForm[f.key]}
                      onChange={e => setResearchForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          <div style={{ ...styles.fieldLabel, marginTop: 12 }}>
            Assign to {assignees.length > 0 && <span style={styles.countPill}>{assignees.length}</span>}
            {assignees.length === 0 && <span style={{ color: '#f87171', marginLeft: 6 }}>required</span>}
          </div>
          <PeopleChips label="Team" people={team} selected={assignees} onToggle={toggleAssignee} />
          <PeopleChips label="Contractors" people={contractors} selected={assignees} onToggle={toggleAssignee} />

          <div style={styles.formGrid}>
            <div>
              <div style={styles.fieldLabel}>Due date</div>
              <input type="date" style={styles.input} value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
            <div>
              <div style={styles.fieldLabel}>Notes (optional)</div>
              <textarea
                style={styles.textarea}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Any context or instructions…"
                rows={2}
              />
            </div>
          </div>
        </div>

        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            style={{ ...styles.assignBtn, cursor: canSubmit ? 'pointer' : 'default', opacity: canSubmit ? 1 : 0.5 }}
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? 'Assigning…' : 'Assign Research'}
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
    display: 'flex', justifyContent: 'flex-end', gap: 10,
    padding: '14px 24px', borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  fieldLabel: {
    fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', letterSpacing: 0.4,
    textTransform: 'uppercase', margin: '4px 0 6px', display: 'flex', alignItems: 'center', gap: 6,
  },
  countPill: { background: colors.accent, color: colors.white, borderRadius: 999, padding: '1px 7px', fontSize: 10, fontWeight: 800 },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, marginTop: 12 },
  input: {
    width: '100%', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, padding: '8px 10px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box',
    fontFamily: 'inherit',
  },
  textarea: {
    width: '100%', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, padding: '8px 10px', color: '#fff', fontSize: 13, outline: 'none',
    boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit',
  },
  cancelBtn: {
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    color: 'rgba(255,255,255,0.7)', borderRadius: 9, padding: '9px 18px',
    fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  assignBtn: {
    background: colors.accent, border: 'none', color: colors.white, borderRadius: 9, // style-lint-ignore
    padding: '9px 20px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
  },
  segmentRow: { display: 'flex', gap: 6 },
  segmentBtn: {
    flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
    color: 'rgba(255,255,255,0.7)', borderRadius: 8, padding: '7px 10px', fontSize: 12.5,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  segmentBtnOn: { background: colors.accentA25, border: '1px solid rgba(91, 143, 199,0.6)', color: colors.accentFgSoft, fontWeight: 600 },
  researchHelp: { fontSize: 11, fontStyle: 'italic', color: 'rgba(255,255,255,0.4)', margin: '0 0 6px', lineHeight: 1.4 },
};
