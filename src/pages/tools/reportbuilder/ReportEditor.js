import React, { useState, useEffect, useCallback, useMemo } from 'react';
import SectionComposer from './SectionComposer';
import SectionsLibrary from './SectionsLibrary';
import SubscribeConfig from './SubscribeConfig';
import {
  SCHEDULE_PRESETS,
  DEFAULT_REPORT_CONFIG,
  slugify,
} from './reportBuilderConstants';

export default function ReportEditor({
  config,
  sections,
  saving,
  onSave,
  onCancel,
  onRunNow,
  running,
  onSectionCreated,
  onSectionDeleted,
}) {
  const isNew = !config?.id;
  const [draft, setDraft] = useState(() => ({ ...DEFAULT_REPORT_CONFIG, ...config, section_ids: config?.section_ids || [] }));
  const [errors, setErrors] = useState({});
  const [slugEdited, setSlugEdited] = useState(false);
  const [customCron, setCustomCron] = useState('');

  // Auto-generate slug from name
  useEffect(() => {
    if (!slugEdited && draft.name) {
      setDraft(d => ({ ...d, slug: slugify(d.name) }));
    }
  }, [draft.name, slugEdited]);

  // Init custom cron if schedule doesn't match a preset
  useEffect(() => {
    const isPreset = SCHEDULE_PRESETS.some(p => p.value === draft.schedule);
    if (draft.schedule && !isPreset) setCustomCron(draft.schedule);
  }, []); // eslint-disable-line

  const updateDraft = useCallback((updates) => {
    setDraft(d => ({ ...d, ...updates }));
    const cleared = {};
    for (const key of Object.keys(updates)) cleared[key] = undefined;
    setErrors(e => ({ ...e, ...cleared }));
  }, []);

  const handleSchedulePreset = useCallback((preset) => {
    if (preset.value === '__custom__') {
      updateDraft({ schedule: customCron || '' });
    } else {
      updateDraft({ schedule: preset.value });
    }
  }, [updateDraft, customCron]);

  const sectionsById = useMemo(() => {
    const map = new Map();
    for (const s of sections) map.set(s.id, s);
    return map;
  }, [sections]);

  const handleSectionIdsChange = useCallback((ids) => {
    updateDraft({ section_ids: ids });
  }, [updateDraft]);

  const handleAddSection = useCallback((id) => {
    if (draft.section_ids.includes(id)) return;
    updateDraft({ section_ids: [...draft.section_ids, id] });
  }, [draft.section_ids, updateDraft]);

  const handleSectionCreated = useCallback((newSection) => {
    onSectionCreated?.(newSection);
    // Auto-add newly created section to this report
    if (!draft.section_ids.includes(newSection.id)) {
      setDraft(d => ({ ...d, section_ids: [...(d.section_ids || []), newSection.id] }));
    }
  }, [onSectionCreated, draft.section_ids]);

  const validate = useCallback(() => {
    const errs = {};
    if (!draft.name.trim()) errs.name = 'Name is required';
    if (!draft.slug.trim()) errs.slug = 'Slug is required';
    else if (!/^[a-z0-9-]+$/.test(draft.slug)) errs.slug = 'Slug must be lowercase letters, numbers, and hyphens';
    if (!draft.section_ids || draft.section_ids.length === 0) errs.section_ids = 'Add at least one section to the report';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [draft]);

  const handleSave = useCallback(() => {
    if (!validate()) return;
    onSave({ ...draft, output_format: 'html', updated_at: new Date().toISOString() });
  }, [draft, validate, onSave]);

  const activeSchedulePreset = SCHEDULE_PRESETS.find(p => p.value === draft.schedule);
  const isCustomSchedule = draft.schedule && !activeSchedulePreset;

  return (
    <div style={styles.editor}>
      <div style={styles.columns}>
        {/* Left: config + composer */}
        <div style={styles.leftCol}>
          <div style={styles.scrollArea}>
            {/* Identity */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Identity</div>
              <label style={styles.fieldLabel}>Name</label>
              <input
                style={{ ...styles.input, ...(errors.name ? styles.inputError : {}) }}
                value={draft.name}
                onChange={e => updateDraft({ name: e.target.value })}
                placeholder="Daily Pitching Report"
              />
              {errors.name && <div style={styles.errorText}>{errors.name}</div>}

              <label style={styles.fieldLabel}>Description</label>
              <textarea
                style={styles.textarea}
                value={draft.description || ''}
                onChange={e => updateDraft({ description: e.target.value })}
                placeholder="What this report covers..."
                rows={2}
              />

              <label style={styles.fieldLabel}>Slug</label>
              <input
                style={{ ...styles.input, ...(errors.slug ? styles.inputError : {}) }}
                value={draft.slug}
                onChange={e => { setSlugEdited(true); updateDraft({ slug: e.target.value }); }}
                placeholder="daily-pitching-report"
              />
              {errors.slug && <div style={styles.errorText}>{errors.slug}</div>}
            </div>

            {/* Sections composer */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Sections</div>
              {errors.section_ids && <div style={styles.errorText}>{errors.section_ids}</div>}
              <SectionComposer
                sectionIds={draft.section_ids}
                sectionsById={sectionsById}
                onChange={handleSectionIdsChange}
              />
            </div>

            {/* Delivery */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Delivery</div>
              <div style={styles.row}>
                <label style={styles.toggleRow}>
                  <input
                    type="checkbox"
                    checked={draft.delivery?.inbox !== false}
                    onChange={e => updateDraft({ delivery: { ...draft.delivery, inbox: e.target.checked } })}
                    style={styles.checkbox}
                  />
                  <span>Research Inbox</span>
                </label>
                <label style={styles.toggleRow}>
                  <input
                    type="checkbox"
                    checked={draft.delivery?.email === true}
                    onChange={e => updateDraft({ delivery: { ...draft.delivery, email: e.target.checked } })}
                    style={styles.checkbox}
                  />
                  <span>Email</span>
                </label>
              </div>
              {draft.delivery?.email && (
                <>
                  <div style={styles.hint}>Sends to all team members with email reports enabled + external subscribers.</div>
                  <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginBottom: '4px' }}>Subscribe Page Branding</div>
                    <SubscribeConfig draft={draft} onUpdate={updateDraft} />
                  </div>
                </>
              )}
            </div>

            {/* Schedule */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Schedule</div>
              <div style={styles.scheduleGrid}>
                {SCHEDULE_PRESETS.map(p => (
                  <button
                    key={p.label}
                    onClick={() => handleSchedulePreset(p)}
                    style={{
                      ...styles.scheduleBtn,
                      ...((p.value === draft.schedule || (p.value === '__custom__' && isCustomSchedule)) ? styles.scheduleBtnActive : {}),
                    }}
                  >{p.label}</button>
                ))}
              </div>
              {(isCustomSchedule || activeSchedulePreset?.value === '__custom__') && (
                <div style={{ marginTop: '8px' }}>
                  <input
                    style={styles.input}
                    value={isCustomSchedule ? draft.schedule : customCron}
                    onChange={e => {
                      setCustomCron(e.target.value);
                      updateDraft({ schedule: e.target.value });
                    }}
                    placeholder="0 15 * * *"
                  />
                  <div style={styles.hint}>Cron: minute hour day month weekday (UTC)</div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div style={styles.footer}>
            <button onClick={onCancel} style={styles.cancelBtn}>Cancel</button>
            <button
              onClick={onRunNow}
              disabled={!config?.id || running}
              style={{ ...styles.runBtn, ...(!config?.id || running ? styles.runBtnDisabled : {}) }}
              title={!config?.id ? 'Save first' : 'Run now'}
            >{running ? 'Running...' : 'Run Now'}</button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ ...styles.saveBtn, ...(saving ? { opacity: 0.5 } : {}) }}
            >
              {saving ? 'Saving...' : isNew ? 'Create Report' : 'Save Changes'}
            </button>
          </div>
        </div>

        {/* Right: sections library + generator */}
        <div style={styles.rightCol}>
          <SectionsLibrary
            sections={sections}
            selectedIds={draft.section_ids}
            onAdd={handleAddSection}
            onGenerated={handleSectionCreated}
            onDelete={onSectionDeleted}
          />
        </div>
      </div>
    </div>
  );
}

const styles = {
  editor: { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' },
  columns: { display: 'flex', flex: 1, overflow: 'hidden' },
  leftCol: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 },
  rightCol: { width: '42%', maxWidth: '520px', minWidth: '340px', flexShrink: 0, display: 'flex', flexDirection: 'column' },
  scrollArea: { flex: 1, overflowY: 'auto', padding: '16px 24px 24px' },
  section: { marginBottom: '24px' },
  sectionTitle: { fontSize: '13px', fontWeight: 700, color: '#e2e8f0', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' },
  fieldLabel: { display: 'block', fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: '6px', marginTop: '12px' },
  input: { width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#ffffff', fontSize: '13px', padding: '8px 12px', fontFamily: 'inherit', boxSizing: 'border-box' },
  inputError: { borderColor: 'rgba(239,68,68,0.5)' },
  textarea: { width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#ffffff', fontSize: '13px', padding: '8px 12px', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' },
  errorText: { fontSize: '11px', color: '#ef4444', marginTop: '4px', marginBottom: '4px' },
  hint: { fontSize: '11px', color: 'rgba(255,255,255,0.25)', marginTop: '6px' },
  row: { display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' },
  toggleRow: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'rgba(255,255,255,0.7)', cursor: 'pointer' },
  checkbox: { accentColor: '#6366f1' },
  scheduleGrid: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  scheduleBtn: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontWeight: 600, fontFamily: 'inherit', padding: '6px 14px', cursor: 'pointer', transition: 'background 0.12s, border-color 0.12s, color 0.12s' },
  scheduleBtnActive: { background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.4)', color: '#a5b4fc' },
  footer: { display: 'flex', alignItems: 'center', gap: '8px', padding: '14px 24px', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0, justifyContent: 'flex-end' },
  cancelBtn: { background: 'none', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: 'rgba(255,255,255,0.5)', fontSize: '13px', fontFamily: 'inherit', padding: '8px 18px', cursor: 'pointer' },
  runBtn: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: 'rgba(255,255,255,0.7)', fontSize: '13px', fontFamily: 'inherit', padding: '8px 18px', cursor: 'pointer', transition: 'opacity 0.12s' },
  runBtnDisabled: { opacity: 0.35, cursor: 'not-allowed' },
  saveBtn: { background: '#6366f1', border: 'none', borderRadius: '6px', color: '#ffffff', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit', padding: '8px 22px', cursor: 'pointer', transition: 'opacity 0.12s' },
};
