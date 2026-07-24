import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { RESEARCH_FIELDS, emptyResearchForm, listResearchDocs, createResearchDoc } from '../lib/researchDocs';
import { fetchAllRows } from '../pages/analytics/utils';
import backdropDismiss from '../lib/backdropDismiss';
import { clickableKeyProps } from '../lib/styleRecipes';
import { colors } from '../lib/styleTokens';

const TEAM_ROLES = ['admin', 'assistant', 'member', 'partner'];

const RESEARCH_NOTE = 'Fill out a research brief for an upcoming project.';

const PAGES = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'projects', label: 'Projects' },
  { key: 'write', label: 'Write' },
  { key: 'production', label: 'Beat Sheet' },
  { key: 'screenwriter', label: 'Screenwriter' },
  { key: 'teleprompter', label: 'Teleprompter' },
  { key: 'telestration', label: 'Telestrator' },
  { key: 'post_show', label: 'Video Tools' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'organize', label: 'Organize' },
  { key: 'deliverables', label: 'Deliverables' },
  { key: 'resources', label: 'Resources' },
  { key: 'research', label: 'Research' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'business_dev', label: 'Roadmap' },
  { key: 'invoicing', label: 'Invoicing' },
  { key: 'channels', label: 'Channels' },
  { key: 'messages', label: 'Messages' },
];

const TASK_TEMPLATES = [
  { key: 'write_ad_reads', label: 'Write Ad Read', entity: 'deliverable', titlePrefix: 'Write ad read' },
  { key: 'collect_brief', label: 'Add Brief', entity: 'campaign', titlePrefix: 'Add brief' },
  { key: 'connect_to_video', label: 'Connect to Video', entity: 'deliverable', titlePrefix: 'Connect to video' },
  { key: 'background_research', label: 'Background Research', research: true, titlePrefix: 'Background Research' },
];

// Modal version of the old Assignments page form. Hands out one-off tasks
// to members/assistants/partners — lands in each assignee's My Tasks.
export default function MemberAssignmentModal({ open, onClose, onCreated, showToast }) {
  const [profiles, setProfiles] = useState([]);

  const [title, setTitle] = useState('');
  const [assignees, setAssignees] = useState([]);
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [link, setLink] = useState('');
  const [navTarget, setNavTarget] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [template, setTemplate] = useState('');
  const [recordId, setRecordId] = useState('');
  const [recordSearch, setRecordSearch] = useState('');
  const [deliverables, setDeliverables] = useState([]);
  const [campaigns, setCampaigns] = useState([]);

  // Background Research template: link an existing research doc or create one.
  const [researchMode, setResearchMode] = useState('existing'); // 'existing' | 'new'
  const [researchDocs, setResearchDocs] = useState([]);
  const [researchLoading, setResearchLoading] = useState(false);
  const [selectedDocUrl, setSelectedDocUrl] = useState('');
  const [researchForm, setResearchForm] = useState(emptyResearchForm);

  const fetchData = useCallback(async () => {
    try {
      const [profRes, delivRows, campRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, email, role')
          .order('full_name', { ascending: true, nullsFirst: false }),
        fetchAllRows(
          supabase
            .from('sponsor_deliverables')
            .select('id, title, due_date, channel, delivered, status, notes, campaign:sponsor_campaigns(name, brief_url, campaign_briefs(id))')
            .order('due_date', { ascending: true })
        ),
        supabase
          .from('sponsor_campaigns')
          .select('id, name, end_date')
          .order('name', { ascending: true }),
      ]);
      setProfiles((profRes.data || []).filter(p => p.role && p.role !== 'deactivated'));

      const today = new Date().toISOString().slice(0, 10);
      const monthOf = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' }) : '';
      setDeliverables(
        (delivRows || [])
          // A campaign's brief can be the legacy single brief_url or any row in
          // campaign_briefs (official/company brief, internal processed brief, …).
          // Either counts — the writer just needs something to write from.
          .filter(d =>
            d.delivered !== true
            && (d.status || '').toLowerCase() !== 'archived'
            && !!(d.campaign && (d.campaign.brief_url || (d.campaign.campaign_briefs || []).length > 0))
          )
          .map(d => ({
            id: d.id,
            label: `${d.campaign?.name ? `${d.campaign.name}: ` : ''}${d.title || 'Untitled'}${d.channel ? ` · ${d.channel}` : ''}${d.due_date ? ` (${monthOf(d.due_date)})` : ''}`,
          })),
      );
      setCampaigns(
        (campRes.data || [])
          .filter(c => !c.end_date || c.end_date >= today)
          .map(c => ({ id: c.id, label: c.name || 'Untitled campaign' })),
      );
    } catch (err) {
      console.error('MemberAssignmentModal fetch error:', err);
      if (showToast) showToast('Failed to load data', 'error');
    }
  }, [showToast]);

  useEffect(() => {
    if (open) fetchData();
  }, [open, fetchData]);

  const team = useMemo(() => profiles.filter(p => TEAM_ROLES.includes(p.role)), [profiles]);
  const contractors = useMemo(() => profiles.filter(p => p.role === 'freelancer'), [profiles]);

  const toggleAssignee = (id) => {
    setAssignees(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const activeTemplate = TASK_TEMPLATES.find(t => t.key === template) || null;
  const recordOptions = useMemo(() => {
    if (!activeTemplate) return [];
    const list = activeTemplate.entity === 'campaign' ? campaigns : deliverables;
    const q = recordSearch.trim().toLowerCase();
    return q ? list.filter(r => r.label.toLowerCase().includes(q)) : list;
  }, [activeTemplate, campaigns, deliverables, recordSearch]);

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

  const onPickTemplate = (key) => {
    setTemplate(key);
    setRecordId('');
    setRecordSearch('');
    const tpl = TASK_TEMPLATES.find(t => t.key === key);
    if (tpl?.research) {
      setNotes(RESEARCH_NOTE);
      setTitle(prev => prev.trim() ? prev : 'Background Research');
      setResearchMode('existing');
      setSelectedDocUrl('');
      setResearchForm(emptyResearchForm());
      fetchResearchDocs();
    }
  };
  const onPickRecord = (rec) => {
    setRecordId(rec.id);
    setRecordSearch(rec.label);
    if (activeTemplate) setTitle(`${activeTemplate.titlePrefix}: ${rec.label}`);
  };

  const isResearch = !!activeTemplate?.research;
  const researchReady = !isResearch || (researchMode === 'existing'
    ? !!selectedDocUrl
    : !!researchForm.big_question.trim());

  const resetForm = () => {
    setTitle(''); setAssignees([]); setDueDate(''); setNotes(''); setLink(''); setNavTarget('');
    setTemplate(''); setRecordId(''); setRecordSearch('');
    setResearchMode('existing'); setSelectedDocUrl(''); setResearchForm(emptyResearchForm());
  };

  const handleAssign = async () => {
    if (!title.trim() || assignees.length === 0) return;
    if (activeTemplate && !isResearch && !recordId) return;
    if (isResearch && !researchReady) return;
    setSubmitting(true);
    try {
      let linkUrl = link.trim() || null;

      // Background Research: resolve the doc URL (create one if needed).
      if (isResearch) {
        if (researchMode === 'new') {
          const doc = await createResearchDoc({
            name: researchForm.big_question.trim(),
            form: researchForm,
          });
          linkUrl = doc.url;
        } else {
          linkUrl = selectedDocUrl;
        }
      }

      const { data, error } = await supabase.functions.invoke('assign-task', {
        body: {
          op: 'create',
          title: title.trim(),
          assignee_ids: assignees,
          due_date: dueDate || null,
          notes: notes.trim() || null,
          link_url: linkUrl,
          nav_target: navTarget || null,
          ...(activeTemplate ? (isResearch ? {
            step_key: activeTemplate.key,
          } : {
            step_key: activeTemplate.key,
            related_entity_type: activeTemplate.entity,
            related_entity_id: recordId,
          }) : {}),
        },
      });
      if (error || data?.error) throw new Error(error?.message || data?.error);
      const n = (data?.created_task_ids || []).length;
      if (showToast) showToast(`Assigned to ${n} ${n === 1 ? 'person' : 'people'}`);
      resetForm();
      if (onCreated) onCreated();
      if (onClose) onClose();
    } catch (err) {
      if (showToast) showToast('Assign failed: ' + err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const canAssign = title.trim() && assignees.length > 0
    && (!activeTemplate || isResearch || recordId)
    && researchReady && !submitting;

  if (!open) return null;

  return (
    <div style={styles.overlay} {...backdropDismiss(onClose)}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <h2 style={styles.h2}>Assign Member Task</h2>
            <p style={styles.subtitle}>Hand out a one-off task to a team member or contractor.</p>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div style={styles.body}>
          <input
            style={styles.titleInput}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="What needs doing? (e.g. Send me your June availability)"
            autoFocus
          />

          <div style={styles.fieldLabel}>Template (optional)</div>
          <select style={styles.input} value={template} onChange={e => onPickTemplate(e.target.value)}>
            <option value="">— Plain task —</option>
            {TASK_TEMPLATES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>

          {activeTemplate && !isResearch && (
            <div style={{ marginTop: 10 }}>
              <div style={styles.fieldLabel}>
                {activeTemplate.entity === 'campaign' ? 'Campaign' : 'Deliverable'}
                {!recordId && <span style={{ color: '#f87171', marginLeft: 6 }}>required</span>}
              </div>
              <input
                style={styles.input}
                value={recordSearch}
                onChange={e => { setRecordSearch(e.target.value); setRecordId(''); }}
                placeholder={`Search ${activeTemplate.entity}s…`}
              />
              {!recordId && (
                <div style={styles.recordList}>
                  {recordOptions.length === 0 ? (
                    <div style={styles.recordEmpty}>No active {activeTemplate.entity}s found</div>
                  ) : recordOptions.slice(0, 50).map(rec => (
                    <div key={rec.id} {...clickableKeyProps(() => onPickRecord(rec))} style={styles.recordRow} onClick={() => onPickRecord(rec)}>
                      {rec.label}
                    </div>
                  ))}
                </div>
              )}
              {recordId && (
                <div style={styles.recordPicked}>
                  ✓ {recordSearch}
                  <button style={styles.recordClear} onClick={() => { setRecordId(''); setRecordSearch(''); }}>change</button>
                </div>
              )}
            </div>
          )}

          {isResearch && (
            <div style={{ marginTop: 10 }}>
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
            </div>
          )}

          <div style={{ ...styles.fieldLabel, marginTop: 12 }}>
            Assign to {assignees.length > 0 && <span style={styles.countPill}>{assignees.length}</span>}
          </div>
          <PeopleChips label="Team" people={team} selected={assignees} onToggle={toggleAssignee} />
          <PeopleChips label="Contractors" people={contractors} selected={assignees} onToggle={toggleAssignee} />

          <div style={styles.formGrid}>
            <div>
              <div style={styles.fieldLabel}>Due date</div>
              <input type="date" style={styles.input} value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
            <div>
              <div style={styles.fieldLabel}>Link (optional)</div>
              <input type="url" style={styles.input} value={link} onChange={e => setLink(e.target.value)} placeholder="https://…" />
            </div>
          </div>

          <div style={styles.fieldLabel}>"Do it" button → page (optional)</div>
          <select style={styles.input} value={navTarget} onChange={e => setNavTarget(e.target.value)}>
            <option value="">— No button —</option>
            {PAGES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>

          <div style={{ ...styles.fieldLabel, marginTop: 12 }}>Notes (optional)</div>
          <textarea
            style={styles.textarea}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Any context or instructions…"
            rows={2}
          />
        </div>

        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button
            style={{ ...styles.assignBtn, opacity: canAssign ? 1 : 0.45, cursor: canAssign ? 'pointer' : 'default' }}
            onClick={handleAssign}
            disabled={!canAssign}
          >
            {submitting ? 'Assigning…' : `Assign${assignees.length ? ` to ${assignees.length}` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PeopleChips({ label, people, selected, onToggle }) {
  if (people.length === 0) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={styles.chipGroupLabel}>{label}</div>
      <div style={styles.chipWrap}>
        {people.map(p => {
          const on = selected.includes(p.id);
          return (
            <button key={p.id} onClick={() => onToggle(p.id)}
              style={{ ...styles.personChip, ...(on ? styles.personChipOn : {}) }}>
              {on ? '✓ ' : ''}{p.full_name || p.email}
            </button>
          );
        })}
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
  titleInput: {
    width: '100%', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10, padding: '11px 13px', color: '#fff', fontSize: 15, fontWeight: 600,
    outline: 'none', boxSizing: 'border-box', marginBottom: 14, fontFamily: 'inherit',
  },
  fieldLabel: {
    fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', letterSpacing: 0.4,
    textTransform: 'uppercase', margin: '4px 0 6px', display: 'flex', alignItems: 'center', gap: 6,
  },
  countPill: { background: colors.accent, color: colors.white, borderRadius: 999, padding: '1px 7px', fontSize: 10, fontWeight: 800 },
  chipGroupLabel: { fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', margin: '2px 0 4px', letterSpacing: 0.4 },
  chipWrap: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  personChip: {
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
    color: 'rgba(255,255,255,0.7)', borderRadius: 999, padding: '5px 12px', fontSize: 12.5, cursor: 'pointer',
    fontFamily: 'inherit',
  },
  personChipOn: { background: colors.accentA25, border: '1px solid rgba(91, 143, 199,0.6)', color: colors.accentFgSoft, fontWeight: 600 },
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
  recordList: {
    marginTop: 6, maxHeight: 180, overflowY: 'auto',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
    background: 'rgba(0,0,0,0.25)',
  },
  recordRow: {
    padding: '8px 10px', fontSize: 13, color: 'rgba(255,255,255,0.8)',
    cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  recordEmpty: { padding: '10px', fontSize: 12, color: 'rgba(255,255,255,0.35)', fontStyle: 'italic' },
  recordPicked: {
    marginTop: 6, padding: '7px 10px', borderRadius: 8, fontSize: 13,
    background: colors.accentA15, border: '1px solid rgba(91, 143, 199,0.4)',
    color: '#c7d2fe', display: 'flex', alignItems: 'center', gap: 8,
  },
  recordClear: {
    marginLeft: 'auto', background: 'none', border: 'none', color: colors.accentFg,
    fontSize: 11, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit',
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
