import React, { useState, useEffect, useCallback } from 'react';
import DataSourceConfig from './DataSourceConfig';
import {
  DATA_SOURCE_TYPES,
  OUTPUT_FORMATS,
  SCHEDULE_PRESETS,
  PROMPT_VARIABLES,
  DEFAULT_REPORT_CONFIG,
  DEFAULT_SOURCE_CONFIGS,
  slugify,
} from './reportBuilderConstants';

export default function ReportEditor({ config, feeds, saving, onSave, onCancel }) {
  const isNew = !config?.id;
  const [draft, setDraft] = useState(() => ({ ...DEFAULT_REPORT_CONFIG, ...config }));
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
    if (draft.schedule && !isPreset) {
      setCustomCron(draft.schedule);
    }
  }, []); // eslint-disable-line

  const updateDraft = useCallback((updates) => {
    setDraft(d => ({ ...d, ...updates }));
    // Clear errors for updated fields
    const cleared = {};
    for (const key of Object.keys(updates)) cleared[key] = undefined;
    setErrors(e => ({ ...e, ...cleared }));
  }, []);

  const handleSourceTypeChange = useCallback((type) => {
    updateDraft({
      data_source_type: type,
      data_source_config: DEFAULT_SOURCE_CONFIGS[type] || {},
    });
  }, [updateDraft]);

  const handleSchedulePreset = useCallback((preset) => {
    if (preset.value === '__custom__') {
      updateDraft({ schedule: customCron || '' });
    } else {
      updateDraft({ schedule: preset.value });
    }
  }, [updateDraft, customCron]);

  const insertVariable = useCallback((varKey) => {
    updateDraft({ prompt_template: draft.prompt_template + ' ' + varKey });
  }, [draft.prompt_template, updateDraft]);

  const validate = useCallback(() => {
    const errs = {};
    if (!draft.name.trim()) errs.name = 'Name is required';
    if (!draft.slug.trim()) errs.slug = 'Slug is required';
    else if (!/^[a-z0-9-]+$/.test(draft.slug)) errs.slug = 'Slug must be lowercase letters, numbers, and hyphens';
    if (draft.prompt_template.length < 10) errs.prompt_template = 'Prompt must be at least 10 characters';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [draft]);

  const handleSave = useCallback(() => {
    if (!validate()) return;
    onSave({ ...draft, updated_at: new Date().toISOString() });
  }, [draft, validate, onSave]);

  const activeSchedulePreset = SCHEDULE_PRESETS.find(p => p.value === draft.schedule);
  const isCustomSchedule = draft.schedule && !activeSchedulePreset;

  return (
    <div style={styles.editor}>
      <div style={styles.editorHeader}>
        <h2 style={styles.editorTitle}>{isNew ? 'New Report' : 'Edit Report'}</h2>
      </div>

      <div style={styles.scrollArea}>
        {/* ── Identity ──────────────────────── */}
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
            placeholder="What this report covers and who it's for..."
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
          <div style={styles.hint}>Used in URLs for public subscriber page</div>
        </div>

        {/* ── Data Source ───────────────────── */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Data Source</div>
          <div style={styles.sourceCards}>
            {DATA_SOURCE_TYPES.map(src => (
              <button
                key={src.key}
                onClick={() => handleSourceTypeChange(src.key)}
                style={{
                  ...styles.sourceCard,
                  ...(draft.data_source_type === src.key ? styles.sourceCardActive : {}),
                }}
              >
                <div style={styles.sourceCardLabel}>{src.label}</div>
                <div style={styles.sourceCardDesc}>{src.description}</div>
              </button>
            ))}
          </div>
          <DataSourceConfig
            sourceType={draft.data_source_type}
            config={draft.data_source_config}
            feeds={feeds}
            onChange={dsc => updateDraft({ data_source_config: dsc })}
          />
        </div>

        {/* ── Prompt Template ───────────────── */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Prompt Template</div>
          <div style={styles.variableRow}>
            {PROMPT_VARIABLES.map(v => (
              <button
                key={v.key}
                onClick={() => insertVariable(v.key)}
                style={styles.variableChip}
                title={v.description}
              >
                {v.key}
              </button>
            ))}
          </div>
          <textarea
            style={{ ...styles.promptArea, ...(errors.prompt_template ? styles.inputError : {}) }}
            value={draft.prompt_template}
            onChange={e => updateDraft({ prompt_template: e.target.value })}
            placeholder="You are an analyst. Given the following articles:\n\n{{articles}}\n\nGenerate a report that..."
            rows={10}
          />
          {errors.prompt_template && <div style={styles.errorText}>{errors.prompt_template}</div>}
        </div>

        {/* ── Output & Delivery ─────────────── */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Output & Delivery</div>
          <label style={styles.fieldLabel}>Output format</label>
          <div style={styles.row}>
            {OUTPUT_FORMATS.map(f => (
              <button
                key={f.key}
                onClick={() => updateDraft({ output_format: f.key })}
                style={{
                  ...styles.formatBtn,
                  ...(draft.output_format === f.key ? styles.formatBtnActive : {}),
                }}
              >{f.label}</button>
            ))}
          </div>
          <label style={styles.fieldLabel}>Deliver to</label>
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
        </div>

        {/* ── Schedule ──────────────────────── */}
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
              <label style={styles.fieldLabel}>Cron expression</label>
              <input
                style={styles.input}
                value={isCustomSchedule ? draft.schedule : customCron}
                onChange={e => {
                  setCustomCron(e.target.value);
                  updateDraft({ schedule: e.target.value });
                }}
                placeholder="0 15 * * *"
              />
              <div style={styles.hint}>Format: minute hour day month weekday (UTC)</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Footer ──────────────────────────── */}
      <div style={styles.footer}>
        <button onClick={onCancel} style={styles.cancelBtn}>Cancel</button>
        <button
          disabled
          style={{ ...styles.testBtn }}
          title="Coming in Phase 2"
        >Test Run</button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ ...styles.saveBtn, ...(saving ? { opacity: 0.5 } : {}) }}
        >
          {saving ? 'Saving...' : isNew ? 'Create Report' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

const styles = {
  editor: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
  },
  editorHeader: {
    padding: '16px 24px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  editorTitle: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#ffffff',
    margin: 0,
  },
  scrollArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px 24px 24px',
  },
  section: {
    marginBottom: '28px',
  },
  sectionTitle: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#e2e8f0',
    marginBottom: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  fieldLabel: {
    display: 'block',
    fontSize: '12px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: '6px',
    marginTop: '12px',
  },
  input: {
    width: '100%',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '13px',
    padding: '8px 12px',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  inputError: {
    borderColor: 'rgba(239,68,68,0.5)',
  },
  textarea: {
    width: '100%',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '13px',
    padding: '8px 12px',
    fontFamily: 'inherit',
    resize: 'vertical',
    boxSizing: 'border-box',
  },
  promptArea: {
    width: '100%',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '13px',
    padding: '10px 14px',
    fontFamily: "'DM Sans', monospace",
    resize: 'vertical',
    lineHeight: 1.6,
    boxSizing: 'border-box',
  },
  errorText: {
    fontSize: '11px',
    color: '#ef4444',
    marginTop: '4px',
  },
  hint: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.25)',
    marginTop: '4px',
  },
  sourceCards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '8px',
    marginBottom: '16px',
  },
  sourceCard: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '8px',
    padding: '12px',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
    transition: 'border-color 0.12s, background 0.12s',
  },
  sourceCardActive: {
    background: 'rgba(99,102,241,0.08)',
    borderColor: 'rgba(99,102,241,0.4)',
  },
  sourceCardLabel: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#e2e8f0',
    marginBottom: '4px',
  },
  sourceCardDesc: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.35)',
    lineHeight: 1.3,
  },
  variableRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginBottom: '10px',
  },
  variableChip: {
    background: 'rgba(99,102,241,0.1)',
    border: '1px solid rgba(99,102,241,0.25)',
    borderRadius: '4px',
    color: '#a5b4fc',
    fontSize: '11px',
    fontFamily: "'DM Sans', monospace",
    padding: '3px 8px',
    cursor: 'pointer',
    transition: 'background 0.12s',
  },
  row: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  formatBtn: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '12px',
    fontWeight: 600,
    fontFamily: 'inherit',
    padding: '6px 16px',
    cursor: 'pointer',
    transition: 'background 0.12s, border-color 0.12s, color 0.12s',
  },
  formatBtnActive: {
    background: 'rgba(99,102,241,0.15)',
    borderColor: 'rgba(99,102,241,0.4)',
    color: '#a5b4fc',
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    color: 'rgba(255,255,255,0.7)',
    cursor: 'pointer',
  },
  checkbox: {
    accentColor: '#6366f1',
  },
  scheduleGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  scheduleBtn: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '12px',
    fontWeight: 600,
    fontFamily: 'inherit',
    padding: '6px 14px',
    cursor: 'pointer',
    transition: 'background 0.12s, border-color 0.12s, color 0.12s',
  },
  scheduleBtnActive: {
    background: 'rgba(99,102,241,0.15)',
    borderColor: 'rgba(99,102,241,0.4)',
    color: '#a5b4fc',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '14px 24px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
    justifyContent: 'flex-end',
  },
  cancelBtn: {
    background: 'none',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '13px',
    fontFamily: 'inherit',
    padding: '8px 18px',
    cursor: 'pointer',
  },
  testBtn: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '6px',
    color: 'rgba(255,255,255,0.25)',
    fontSize: '13px',
    fontFamily: 'inherit',
    padding: '8px 18px',
    cursor: 'not-allowed',
    opacity: 0.5,
  },
  saveBtn: {
    background: '#6366f1',
    border: 'none',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: 600,
    fontFamily: 'inherit',
    padding: '8px 22px',
    cursor: 'pointer',
    transition: 'opacity 0.12s',
  },
};
