import { createPortal } from 'react-dom';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { RESEARCH_FIELDS, emptyResearchForm, listResearchDocs, createResearchDoc } from '../lib/researchDocs';
import { fetchAllRows } from '../pages/analytics/utils';
import backdropDismiss from '../lib/backdropDismiss';
import SlateItemPicker from './SlateItemPicker';
import { clickableKeyProps } from '../lib/styleRecipes';
import { colors, fontFamily } from '../lib/styleTokens';

// The one "+ Assignment" modal. Replaces the old Member / Contractor pair:
// a single Assign-to list holds members and contractors together, and the
// task type decides which extra fields show. Where a row lands is decided by
// WHO is picked, not by the type —
//
//   member     → `tasks` row via the assign-task edge function (My Tasks)
//   contractor → `contractor_assignments` row (contractor portal, paid)
//
// — because the contractor portal never shows `tasks` rows, so a contractor
// handed a member-style task would never see it. Mixed picks create both.
//
// "Edit a Video" carries the contractor-assignment field set (asset link,
// slate item, submission folder, due time, pay). Members get everything but
// pay: the asset link becomes the task link, the due time folds into the
// task's timestamp, and the submission folder is noted in the description
// (tasks has no column for it).
//
// A slate item marks the item filmed on link and done on completion (DB
// triggers on both tables). One assignment per item, so it pins the pick to
// a single person.

const RESEARCH_NOTE = 'Fill out a research brief for an upcoming project.';

const TASK_TYPES = [
  { key: '', label: 'Plain task' },
  { key: 'edit_video', label: 'Edit a Video', editVideo: true, titlePrefix: 'Edit', assignmentType: 'edit' },
  { key: 'write_ad_reads', label: 'Write Ad Read', entity: 'deliverable', titlePrefix: 'Write ad read', assignmentType: 'write' },
  { key: 'collect_brief', label: 'Add Brief', entity: 'campaign', titlePrefix: 'Add brief', assignmentType: 'other' },
  { key: 'connect_to_video', label: 'Connect to Video', entity: 'deliverable', titlePrefix: 'Connect to video', assignmentType: 'edit' },
  { key: 'background_research', label: 'Background Research', research: true, titlePrefix: 'Background Research', assignmentType: 'write' },
];

const CONTRACTOR_ROLES = ['contractor', 'freelancer'];

// Accept either a full Google Drive folder URL or a bare folder id and
// normalize to the bare id stored in submit_folder_id. '' when unparseable.
export function parseDriveFolderId(raw) {
  const v = (raw || '').trim();
  if (!v) return '';
  const m = v.match(/\/folders\/([\w-]+)/);
  if (m) return m[1];
  const q = v.match(/[?&]id=([\w-]+)/);
  if (q) return q[1];
  if (/^[\w-]+$/.test(v)) return v;
  return '';
}

export default function AssignmentModal({ open, onClose, onCreated, showToast, currentUserId }) {
  const [profiles, setProfiles] = useState([]);

  const [title, setTitle] = useState('');
  const [taskType, setTaskType] = useState('');
  const [assignees, setAssignees] = useState([]);
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [notes, setNotes] = useState('');
  const [link, setLink] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [submitFolder, setSubmitFolder] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [requiresHours, setRequiresHours] = useState(false);
  const [slateItemId, setSlateItemId] = useState('');
  const [assigneeMenuOpen, setAssigneeMenuOpen] = useState(false);
  const [recordId, setRecordId] = useState('');
  const [recordSearch, setRecordSearch] = useState('');
  const [deliverables, setDeliverables] = useState([]);
  const [campaigns, setCampaigns] = useState([]);

  // Background Research: link an existing research doc or create one.
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
          .select('id, full_name, email, role, title, sub_role')
          .is('deactivated_at', null)
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
          // campaign_briefs — either counts, the writer just needs something.
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
      console.error('AssignmentModal fetch error:', err);
      if (showToast) showToast('Failed to load data', 'error');
    }
  }, [showToast]);

  useEffect(() => {
    if (open) fetchData();
  }, [open, fetchData]);

  // Assignable people: members and contractors, one alphabetical list.
  // Admins/directors hand out this work rather than receive it.
  const people = useMemo(
    () => profiles.filter(p => p.role === 'member' || CONTRACTOR_ROLES.includes(p.role)),
    [profiles],
  );
  const isContractor = useCallback(
    (id) => CONTRACTOR_ROLES.includes(profiles.find(p => p.id === id)?.role),
    [profiles],
  );
  const memberIds = useMemo(() => assignees.filter(id => !isContractor(id)), [assignees, isContractor]);
  const contractorIds = useMemo(() => assignees.filter(id => isContractor(id)), [assignees, isContractor]);

  const toggleAssignee = (id) => {
    setAssignees(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const personName = useCallback(
    (id) => {
      const p = profiles.find(x => x.id === id);
      return p ? (p.full_name || p.email) : 'Unknown';
    },
    [profiles],
  );

  // Label on the closed dropdown: names while short, a count once it isn't.
  const assigneeLabel = assignees.length === 0
    ? 'Select who this goes to…'
    : assignees.length <= 2
      ? assignees.map(personName).join(', ')
      : `${assignees.length} people selected`;

  const activeType = TASK_TYPES.find(t => t.key === taskType) || TASK_TYPES[0];
  const isEditVideo = !!activeType.editVideo;
  const isResearch = !!activeType.research;
  const isEntity = !!activeType.entity;

  const recordOptions = useMemo(() => {
    if (!isEntity) return [];
    const list = activeType.entity === 'campaign' ? campaigns : deliverables;
    const q = recordSearch.trim().toLowerCase();
    return q ? list.filter(r => r.label.toLowerCase().includes(q)) : list;
  }, [isEntity, activeType, campaigns, deliverables, recordSearch]);

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

  const onPickType = (key) => {
    setTaskType(key);
    setRecordId('');
    setRecordSearch('');
    const tpl = TASK_TYPES.find(t => t.key === key);
    if (tpl?.research) {
      setNotes(RESEARCH_NOTE);
      setTitle(prev => prev.trim() ? prev : 'Background Research');
      setResearchMode('existing');
      setSelectedDocUrl('');
      setResearchForm(emptyResearchForm());
      fetchResearchDocs();
    }
    if (!tpl?.editVideo) {
      setSlateItemId(''); setSubmitFolder(''); setDueTime(''); setPayAmount('');
    }
  };
  const onPickRecord = (rec) => {
    setRecordId(rec.id);
    setRecordSearch(rec.label);
    setTitle(`${activeType.titlePrefix}: ${rec.label}`);
  };

  const researchReady = !isResearch || (researchMode === 'existing'
    ? !!selectedDocUrl
    : !!researchForm.big_question.trim());

  const resetForm = () => {
    setTitle(''); setTaskType(''); setAssignees([]); setDueDate(''); setDueTime('');
    setNotes(''); setLink(''); setPayAmount(''); setSubmitFolder('');
    setRequiresHours(false); setAssigneeMenuOpen(false); setSlateItemId('');
    setRecordId(''); setRecordSearch('');
    setResearchMode('existing'); setSelectedDocUrl(''); setResearchForm(emptyResearchForm());
  };

  // A slate item carries exactly one assignment, so it can't fan out.
  const slateFanOut = !!slateItemId && assignees.length > 1;
  const canAssign = title.trim() && assignees.length > 0
    && (!isEntity || recordId)
    && researchReady && !slateFanOut && !submitting;

  const handleAssign = async () => {
    if (!canAssign) return;
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

      const cleanTitle = title.trim();
      const cleanNotes = notes.trim() || null;
      const folderId = isEditVideo ? (parseDriveFolderId(submitFolder) || null) : null;
      let created = 0;

      // ── Members → tasks rows (assign-task edge function) ──
      if (memberIds.length > 0) {
        // tasks.due_date is a timestamptz, so the due time folds straight in.
        let taskDue = dueDate || null;
        if (dueDate && dueTime) {
          const d = new Date(`${dueDate}T${dueTime}:00`);
          if (!Number.isNaN(d.getTime())) taskDue = d.toISOString();
        }
        // tasks has no submission-folder column — note it for the assignee.
        const memberNotes = folderId && submitFolder.trim()
          ? `${cleanNotes ? `${cleanNotes}\n\n` : ''}Submit to: ${submitFolder.trim()}`
          : cleanNotes;

        const { data, error } = await supabase.functions.invoke('assign-task', {
          body: {
            op: 'create',
            title: cleanTitle,
            assignee_ids: memberIds,
            due_date: taskDue,
            notes: memberNotes,
            link_url: linkUrl,
            requires_hours: requiresHours,
            film_queue_item_id: slateItemId || null,
            ...(isEntity ? {
              step_key: activeType.key,
              related_entity_type: activeType.entity,
              related_entity_id: recordId,
            } : isResearch ? { step_key: activeType.key } : {}),
          },
        });
        if (error || data?.error) throw new Error(error?.message || data?.error);
        created += (data?.created_task_ids || []).length;
      }

      // ── Contractors → contractor_assignments rows, one per person ──
      if (contractorIds.length > 0) {
        const pay = payAmount !== '' && !Number.isNaN(parseFloat(payAmount)) ? parseFloat(payAmount) : null;
        const rows = contractorIds.map(cid => ({
          contractor_id: cid,
          title: cleanTitle,
          description: cleanNotes,
          asset_url: linkUrl,
          due_date: dueDate || null,
          due_time: (isEditVideo && dueTime) ? dueTime : null,
          pay_amount: pay,
          submit_folder_id: folderId,
          film_queue_item_id: slateItemId || null,
          assignment_type: activeType.assignmentType || 'other',
          deliverable_id: (isEntity && activeType.entity === 'deliverable') ? recordId : null,
          created_by: currentUserId || null,
        }));
        const { error } = await supabase.from('contractor_assignments').insert(rows);
        if (error) throw error;
        created += rows.length;

        // Best-effort notification — a failure here must not report the
        // (already created) assignments as failed.
        try {
          await supabase.from('notifications').insert(contractorIds.map(cid => ({
            user_id: cid,
            type: 'assignment',
            title: 'New Assignment',
            body: `You have been assigned "${cleanTitle}"`,
            link_tab: 'fl_dashboard',
            link_target: null,
          })));
        } catch (_) { /* ignore */ }
      }

      if (showToast) showToast(`Assigned to ${created} ${created === 1 ? 'person' : 'people'}`);
      resetForm();
      if (onCreated) onCreated();
      if (onClose) onClose();
    } catch (err) {
      if (showToast) showToast('Assign failed: ' + err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  // Portal to <body>: rendered inline, the fixed overlay gets trapped in the
  // stacking context of whatever mounted it and later siblings paint over it.
  // The overlay sets the app font explicitly because <body> never gets it —
  // DM Sans is applied on the app root, which a portal escapes.
  return createPortal(
    <div style={styles.overlay} {...backdropDismiss(onClose)}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <h2 style={styles.h2}>New Assignment</h2>
            <p style={styles.subtitle}>Hand out work to team members or contractors.</p>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div style={styles.body}>
          <input
            style={styles.titleInput}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={isEditVideo ? 'What are they editing? (e.g. Maysplaining — Ep 12)' : 'What needs doing? (e.g. Send me your June availability)'}
            autoFocus
          />

          <div style={styles.field}>
            <div style={styles.fieldLabel}>Task type</div>
            <select style={styles.input} value={taskType} onChange={e => onPickType(e.target.value)}>
              {TASK_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>

          <div style={styles.field}>
            <div style={styles.fieldLabel}>Description (optional)</div>
            <textarea
              style={styles.textarea}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any context or instructions…"
              rows={3}
            />
          </div>

          {isEntity && (
            <div style={styles.field}>
              <div style={styles.fieldLabel}>
                {activeType.entity === 'campaign' ? 'Campaign' : 'Deliverable'}
                {!recordId && <span style={styles.required}>required</span>}
              </div>
              <input
                style={styles.input}
                value={recordSearch}
                onChange={e => { setRecordSearch(e.target.value); setRecordId(''); }}
                placeholder={`Search ${activeType.entity}s…`}
              />
              {!recordId && (
                <div style={styles.recordList}>
                  {recordOptions.length === 0 ? (
                    <div style={styles.recordEmpty}>No active {activeType.entity}s found</div>
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
            <div style={styles.field}>
              <div style={styles.fieldLabel}>
                Research document
                {!researchReady && <span style={styles.required}>required</span>}
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
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {RESEARCH_FIELDS.map(f => (
                    <div key={f.key}>
                      <div style={styles.fieldLabel}>
                        {f.label}
                        {f.required && !researchForm[f.key].trim() && <span style={styles.required}>required</span>}
                      </div>
                      <p style={styles.help}>{f.help}</p>
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

          {isEditVideo && (
            <>
              <div style={styles.field}>
                <div style={styles.fieldLabel}>Asset Link</div>
                <input
                  type="url"
                  style={styles.input}
                  value={link}
                  onChange={e => setLink(e.target.value)}
                  placeholder="Paste an Assets Library, Drive, or other URL"
                />
              </div>
              <div style={styles.field}>
                <SlateItemPicker
                  value={slateItemId}
                  onChange={setSlateItemId}
                  styles={{ label: styles.fieldLabel, select: styles.input, hint: styles.help }}
                />
                {slateFanOut && (
                  <div style={{ ...styles.help, color: '#f87171', marginTop: 6 }}>
                    A slate item takes one assignment — pick a single person, or clear the slate item.
                  </div>
                )}
              </div>
              <div style={styles.field}>
                <div style={styles.fieldLabel}>Submission Folder</div>
                <input
                  style={styles.input}
                  value={submitFolder}
                  onChange={e => setSubmitFolder(e.target.value)}
                  placeholder="Paste the Drive folder link where the finished work should be submitted"
                />
                {submitFolder.trim() && (
                  <div style={{ ...styles.help, marginTop: 6 }}>
                    {parseDriveFolderId(submitFolder)
                      ? `Uploads for this assignment go to folder ${parseDriveFolderId(submitFolder)}${memberIds.length ? ' (noted in the task for team members)' : ''}`
                      : 'Could not read a Drive folder from that link.'}
                  </div>
                )}
              </div>
            </>
          )}

          <div style={styles.field}>
            <div style={styles.fieldLabel}>
              Assign to {assignees.length > 0 && <span style={styles.countPill}>{assignees.length}</span>}
            </div>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                style={styles.selectTrigger}
                onClick={() => setAssigneeMenuOpen(v => !v)}
              >
                <span style={assignees.length ? styles.selectValue : styles.selectPlaceholder}>
                  {assigneeLabel}
                </span>
                <span style={styles.selectCaret}>▾</span>
              </button>

              {assigneeMenuOpen && (
                <>
                  <div style={styles.menuBackdrop} onClick={() => setAssigneeMenuOpen(false)} />
                  {/* Stays open on pick — one assignment is created per person checked. */}
                  <div style={styles.assigneeMenu}>
                    {people.length === 0 && (
                      <div style={styles.menuEmpty}>No assignable people found</div>
                    )}
                    {people.map(p => {
                      const on = assignees.includes(p.id);
                      const contractor = CONTRACTOR_ROLES.includes(p.role);
                      const tag = contractor ? (p.sub_role || p.title || 'Contractor') : (p.title || 'Member');
                      return (
                        <button
                          key={p.id}
                          type="button"
                          style={{ ...styles.assigneeRow, ...(on ? styles.assigneeRowOn : null) }}
                          onClick={() => toggleAssignee(p.id)}
                          aria-pressed={on}
                        >
                          <span style={{ ...styles.checkbox, ...(on ? styles.checkboxOn : null) }}>
                            {on ? '✓' : ''}
                          </span>
                          <span style={styles.assigneeName}>{p.full_name || p.email}</span>
                          <span style={{ ...styles.assigneeTag, ...(contractor ? styles.assigneeTagContractor : null) }}>{tag}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            {contractorIds.length > 0 && memberIds.length > 0 && (
              <div style={{ ...styles.help, marginTop: 6 }}>
                Team members get a task in My Tasks; contractors get a paid assignment in their portal.
              </div>
            )}
          </div>

          <div style={{
            ...styles.formGrid,
            gridTemplateColumns: contractorIds.length > 0 ? '1fr 1fr 1fr' : (isEditVideo ? '1fr 1fr' : '1fr 2fr'),
          }}>
            <div>
              <div style={styles.fieldLabel}>Due date</div>
              <input type="date" style={styles.input} value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
            {isEditVideo ? (
              <div>
                <div style={styles.fieldLabel}>Due time</div>
                <input type="time" style={styles.input} value={dueTime} onChange={e => setDueTime(e.target.value)} />
              </div>
            ) : (
              <div>
                <div style={styles.fieldLabel}>Link (optional)</div>
                <input type="url" style={styles.input} value={link} onChange={e => setLink(e.target.value)} placeholder="https://…" />
              </div>
            )}
            {contractorIds.length > 0 && (
              <div>
                <div style={styles.fieldLabel}>Pay amount ($)</div>
                <input
                  type="number"
                  style={styles.input}
                  value={payAmount}
                  onChange={e => setPayAmount(e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                />
                <div style={{ ...styles.help, marginTop: 4 }}>
                  {contractorIds.length > 1 ? 'Per contractor.' : 'Contractors only.'}
                </div>
              </div>
            )}
          </div>

          {/* Report Hours to Complete — the member is prompted for hours before
              they can close the task; those hours land in Payroll. Contractors
              log hours on the assignment itself, so this is members-only. */}
          {memberIds.length > 0 && (
            <button
              type="button"
              style={{ ...styles.toggleRow, ...(requiresHours ? styles.toggleRowOn : null) }}
              onClick={() => setRequiresHours(v => !v)}
              aria-pressed={requiresHours}
            >
              <span style={{ ...styles.toggleTrack, ...(requiresHours ? styles.toggleTrackOn : null) }}>
                <span style={{ ...styles.toggleKnob, ...(requiresHours ? styles.toggleKnobOn : null) }} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={styles.toggleLabel}>Report Hours to Complete</span>
                <span style={styles.toggleDesc}>
                  {requiresHours
                    ? 'Team members must report hours to mark this done — logged to their payroll for the period.'
                    : 'Off — the task can be completed without reporting hours. (Team members only.)'}
                </span>
              </span>
            </button>
          )}
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
  , document.body);
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    fontFamily,
  },
  modal: {
    background: colors.bgHover, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14,
    width: 560, maxWidth: '92vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '20px 24px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  h2: { fontSize: 18, fontWeight: 700, color: '#fff', margin: 0 },
  subtitle: { fontSize: 12, color: 'rgba(255,255,255,0.45)', margin: '3px 0 0' },
  closeBtn: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 26,
    cursor: 'pointer', lineHeight: 1, padding: 0, marginTop: -2, fontFamily: 'inherit',
  },
  body: { padding: '20px 24px', overflowY: 'auto', flex: 1 },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: 10,
    padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  titleInput: {
    width: '100%', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10, padding: '11px 13px', color: '#fff', fontSize: 15, fontWeight: 600,
    outline: 'none', boxSizing: 'border-box', marginBottom: 16, fontFamily: 'inherit',
  },
  // Every label + control pair sits in a `field` block, so vertical rhythm is
  // set in one place instead of per-field marginTop overrides.
  field: { marginBottom: 16 },
  fieldLabel: {
    fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)', letterSpacing: 0.4,
    textTransform: 'uppercase', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 6,
  },
  required: { color: '#f87171', marginLeft: 6 },
  countPill: { background: colors.accent, color: colors.white, borderRadius: 999, padding: '1px 7px', fontSize: 10, fontWeight: 800 },
  help: { fontSize: 11, fontStyle: 'italic', color: 'rgba(255,255,255,0.4)', margin: '0 0 6px', lineHeight: 1.4 },

  // Assign to — multi-select dropdown
  selectTrigger: {
    width: '100%', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 13.5, cursor: 'pointer',
    fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
    boxSizing: 'border-box',
  },
  selectValue: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  selectPlaceholder: { flex: 1, color: 'rgba(255,255,255,0.35)' },
  selectCaret: { fontSize: 10, color: 'rgba(255,255,255,0.4)' },
  menuBackdrop: { position: 'fixed', inset: 0, zIndex: 1001 },
  assigneeMenu: {
    position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 1002,
    background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10,
    padding: 6, maxHeight: 260, overflowY: 'auto', boxShadow: '0 10px 28px rgba(0,0,0,0.55)',
  },
  menuEmpty: { fontSize: 12, color: 'rgba(255,255,255,0.35)', padding: '10px 8px' },
  assigneeRow: {
    display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
    background: 'none', border: 'none', borderRadius: 6, padding: '7px 8px',
    color: 'rgba(255,255,255,0.8)', cursor: 'pointer', fontFamily: 'inherit',
  },
  assigneeRowOn: { background: 'rgba(99,102,241,0.14)', color: '#fff' },
  checkbox: {
    width: 15, height: 15, borderRadius: 4, flexShrink: 0,
    border: '1px solid rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: 10, color: '#fff', lineHeight: 1,
  },
  checkboxOn: { background: colors.accent, borderColor: colors.accent },
  assigneeName: { fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  assigneeTag: {
    fontSize: 10, fontWeight: 600, flexShrink: 0, padding: '1px 7px', borderRadius: 999,
    background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)',
  },
  assigneeTagContractor: { background: 'rgba(251,191,36,0.12)', color: '#fbbf24' },

  // Report Hours toggle
  toggleRow: {
    display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', textAlign: 'left',
    padding: '11px 12px', borderRadius: 10, cursor: 'pointer',
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
    fontFamily: 'inherit',
  },
  toggleRowOn: { background: 'rgba(99,102,241,0.1)', borderColor: 'rgba(99,102,241,0.35)' },
  toggleTrack: {
    width: 34, height: 19, borderRadius: 999, background: 'rgba(255,255,255,0.12)',
    flexShrink: 0, position: 'relative', transition: 'background 0.15s', marginTop: 1,
  },
  toggleTrackOn: { background: colors.accent },
  toggleKnob: {
    position: 'absolute', top: 2, left: 2, width: 15, height: 15, borderRadius: '50%',
    background: '#fff', transition: 'left 0.15s',
  },
  toggleKnobOn: { left: 17 },
  toggleLabel: { display: 'block', fontSize: 13, fontWeight: 700, color: '#fff' },
  toggleDesc: { display: 'block', fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 3, lineHeight: 1.4 },

  formGrid: { display: 'grid', gap: 12, marginBottom: 16 },
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
};
