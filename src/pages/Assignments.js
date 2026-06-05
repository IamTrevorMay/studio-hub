import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';

// Admin-only Assignments page.
// Assign one-off (direct) tasks to one or more people — they land in each
// assignee's My Tasks alongside workflow tasks.

const TEAM_ROLES = ['admin', 'assistant', 'member', 'partner'];

// Pages a "Do it" button can jump to (tab key -> label, matching the sidebar).
const PAGES = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'projects', label: 'Projects' },
  { key: 'write', label: 'Write' },
  { key: 'production', label: 'Beat Sheet' },
  { key: 'screenwriter', label: 'Screenwriter' },
  { key: 'teleprompter', label: 'Teleprompter' },
  { key: 'telestration', label: 'Telestrator' },
  { key: 'post_show', label: 'Clipping Tool' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'organize', label: 'Organize' },
  { key: 'deliverables', label: 'Deliverables' },
  { key: 'resources', label: 'Resources' },
  { key: 'research', label: 'Research' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'business_dev', label: 'Business Dev' },
  { key: 'invoicing', label: 'Invoicing' },
  { key: 'channels', label: 'Channels' },
  { key: 'messages', label: 'Messages' },
];

// One-off templates that reuse a workflow block's action/modal. Each acts on a
// specific record the assigner picks.
const TASK_TEMPLATES = [
  { key: 'write_ad_reads', label: 'Write Ad Read', entity: 'deliverable', titlePrefix: 'Write ad read' },
  { key: 'collect_brief', label: 'Add Brief', entity: 'campaign', titlePrefix: 'Add brief' },
  { key: 'connect_to_video', label: 'Connect to Video', entity: 'deliverable', titlePrefix: 'Connect to video' },
];


export default function Assignments() {
  const [profiles, setProfiles] = useState([]);
  const [toast, setToast] = useState(null);

  // Assign form
  const [title, setTitle] = useState('');
  const [assignees, setAssignees] = useState([]); // array of profile ids
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [link, setLink] = useState('');
  const [navTarget, setNavTarget] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Template + the record it acts on
  const [template, setTemplate] = useState('');
  const [recordId, setRecordId] = useState('');
  const [recordSearch, setRecordSearch] = useState('');
  const [deliverables, setDeliverables] = useState([]);
  const [campaigns, setCampaigns] = useState([]);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const [profRes, delivRes, campRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, email, role')
          .order('full_name', { ascending: true, nullsFirst: false }),
        supabase
          .from('sponsor_deliverables')
          .select('id, title, due_date, channel, delivered, status, notes, campaign:sponsor_campaigns(name, brief_url)')
          .order('due_date', { ascending: true }),
        supabase
          .from('sponsor_campaigns')
          .select('id, name, end_date')
          .order('name', { ascending: true }),
      ]);
      setProfiles((profRes.data || []).filter(p => p.role && p.role !== 'deactivated'));

      // Active records for the template pickers
      const today = new Date().toISOString().slice(0, 10);
      const monthOf = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' }) : '';
      // Write Ad Read picker: only deliverables that are ready to write — a
      // brief is connected on the campaign and the Ad Copy (notes) is empty.
      setDeliverables(
        (delivRes.data || [])
          .filter(d =>
            d.delivered !== true
            && (d.status || '').toLowerCase() !== 'archived'
            && !(d.notes && d.notes.trim())     // Ad Copy empty → ready to write
            && !!(d.campaign && d.campaign.brief_url) // brief connected on the campaign
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
      console.error('Assignments fetch error:', err);
      showToast('Failed to load assignments', 'error');
    }
  }, [showToast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useVisibilityRefresh(() => { fetchData(); });

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

  const onPickTemplate = (key) => {
    setTemplate(key);
    setRecordId('');
    setRecordSearch('');
  };
  const onPickRecord = (rec) => {
    setRecordId(rec.id);
    setRecordSearch(rec.label);
    if (activeTemplate) setTitle(`${activeTemplate.titlePrefix}: ${rec.label}`);
  };

  const handleAssign = async () => {
    if (!title.trim() || assignees.length === 0) return;
    if (activeTemplate && !recordId) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('assign-task', {
        body: {
          op: 'create',
          title: title.trim(),
          assignee_ids: assignees,
          due_date: dueDate || null,
          notes: notes.trim() || null,
          link_url: link.trim() || null,
          nav_target: navTarget || null,
          ...(activeTemplate ? {
            step_key: activeTemplate.key,
            related_entity_type: activeTemplate.entity,
            related_entity_id: recordId,
          } : {}),
        },
      });
      if (error || data?.error) throw new Error(error?.message || data?.error);
      const n = (data?.created_task_ids || []).length;
      showToast(`Assigned to ${n} ${n === 1 ? 'person' : 'people'}`);
      setTitle(''); setAssignees([]); setDueDate(''); setNotes(''); setLink(''); setNavTarget('');
      setTemplate(''); setRecordId(''); setRecordSearch('');
      await fetchData();
    } catch (err) {
      showToast('Assign failed: ' + err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const canAssign = title.trim() && assignees.length > 0 && (!activeTemplate || recordId) && !submitting;

  return (
    <div style={styles.page}>
      {toast && (
        <div style={{ ...styles.toast, background: toast.type === 'error' ? '#dc2626' : '#16a34a' }}>
          {toast.message}
        </div>
      )}

      <div style={styles.headerRow}>
        <div>
          <h1 style={styles.h1}>Assignments</h1>
          <p style={styles.subtitle}>Hand out one-off tasks and see who's working on what.</p>
        </div>
        <button style={styles.refreshBtn} onClick={fetchData}>↻ Refresh</button>
      </div>

      {/* ── Assign a task ── */}
      <div style={styles.assignCard}>
        <h2 style={styles.sectionTitle}>Assign a task</h2>
        <input
          style={styles.titleInput}
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="What needs doing? (e.g. Send me your June availability)"
        />

        <div style={styles.fieldLabel}>Template (optional)</div>
        <select style={styles.input} value={template} onChange={e => onPickTemplate(e.target.value)}>
          <option value="">— Plain task —</option>
          {TASK_TEMPLATES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>

        {activeTemplate && (
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
                  <div key={rec.id} style={styles.recordRow} onClick={() => onPickRecord(rec)}>
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

        <div style={{ ...styles.fieldLabel, marginTop: 12 }}>Assign to {assignees.length > 0 && <span style={styles.countPill}>{assignees.length}</span>}</div>
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

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={{ ...styles.assignBtn, opacity: canAssign ? 1 : 0.45, cursor: canAssign ? 'pointer' : 'default' }}
            onClick={handleAssign} disabled={!canAssign}>
            {submitting ? 'Assigning…' : `Assign${assignees.length ? ` to ${assignees.length}` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Assignee picker chips ──────────────────────────────────
function PeopleChips({ label, people, selected, onToggle }) {
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
  page: { padding: '24px 32px', minHeight: '100vh', position: 'relative' },
  toast: {
    position: 'fixed', top: 20, right: 20, padding: '10px 20px', borderRadius: 8,
    color: '#fff', fontSize: 13, fontWeight: 600, zIndex: 9999,
    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
  },
  headerRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 },
  h1: { fontSize: 24, fontWeight: 800, color: '#fff', margin: 0 },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.45)', margin: '4px 0 0' },
  refreshBtn: {
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    color: 'rgba(255,255,255,0.7)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
  },

  assignCard: {
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 14, padding: 18, marginBottom: 8,
  },
  sectionTitle: { fontSize: 15, fontWeight: 700, color: '#fff', margin: '0 0 12px' },
  titleInput: {
    width: '100%', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10, padding: '11px 13px', color: '#fff', fontSize: 15, fontWeight: 600,
    outline: 'none', boxSizing: 'border-box', marginBottom: 14,
  },
  fieldLabel: { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', letterSpacing: 0.4, textTransform: 'uppercase', margin: '4px 0 6px', display: 'flex', alignItems: 'center', gap: 6 },
  countPill: { background: '#6366f1', color: '#fff', borderRadius: 999, padding: '1px 7px', fontSize: 10, fontWeight: 800 },
  chipGroupLabel: { fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', margin: '2px 0 4px', letterSpacing: 0.4 },
  chipWrap: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  personChip: {
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
    color: 'rgba(255,255,255,0.7)', borderRadius: 999, padding: '5px 12px', fontSize: 12.5, cursor: 'pointer',
  },
  personChipOn: { background: 'rgba(99,102,241,0.25)', border: '1px solid rgba(99,102,241,0.6)', color: '#c7d2fe', fontWeight: 600 },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, marginTop: 12 },
  input: {
    width: '100%', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, padding: '8px 10px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box',
  },
  textarea: {
    width: '100%', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, padding: '8px 10px', color: '#fff', fontSize: 13, outline: 'none',
    boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit',
  },
  assignBtn: {
    background: '#6366f1', border: 'none', color: '#fff', borderRadius: 9,
    padding: '9px 20px', fontSize: 13, fontWeight: 700,
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
    background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.4)',
    color: '#c7d2fe', display: 'flex', alignItems: 'center', gap: 8,
  },
  recordClear: {
    marginLeft: 'auto', background: 'none', border: 'none', color: '#a5b4fc',
    fontSize: 11, cursor: 'pointer', textDecoration: 'underline',
  },
};
