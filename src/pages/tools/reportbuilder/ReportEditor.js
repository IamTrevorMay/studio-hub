import React, { useState, useEffect, useCallback } from 'react';
import DataSourceConfig from './DataSourceConfig';
import PromptChat from './PromptChat';
import ReportPreview from './ReportPreview';
import {
  SCHEDULE_PRESETS,
  DEFAULT_REPORT_CONFIG,
  slugify,
} from './reportBuilderConstants';

export default function ReportEditor({ config, feeds, saving, onSave, onCancel, onRunNow, running, onPreview }) {
  const isNew = !config?.id;
  const [draft, setDraft] = useState(() => ({ ...DEFAULT_REPORT_CONFIG, ...config }));
  const [errors, setErrors] = useState({});
  const [slugEdited, setSlugEdited] = useState(false);
  const [customCron, setCustomCron] = useState('');

  // Chat state
  const [chatMessages, setChatMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [compiledPrompt, setCompiledPrompt] = useState(config?.prompt_template || '');

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

  // Chat: send instruction to preview-report
  const handleChatSend = useCallback(async (instruction) => {
    const userMsg = { role: 'user', content: instruction };
    setChatMessages(prev => [...prev, userMsg]);
    setChatLoading(true);

    try {
      // Build conversation history for Claude (only text, no html)
      const history = chatMessages
        .filter(m => m.role === 'user' || (m.role === 'assistant' && !m.error))
        .map(m => ({ role: m.role, content: m.content }));

      const result = await onPreview({
        data_sources: draft.data_sources || [],
        instruction,
        conversation_history: history,
      });

      if (result.error) {
        setChatMessages(prev => [...prev, { role: 'assistant', content: '', error: result.error }]);
      } else {
        setPreviewHtml(result.html || '');
        setCompiledPrompt(result.compiled_prompt || '');
        setChatMessages(prev => [...prev, { role: 'assistant', content: result.html ? 'Preview updated.' : 'No content generated.' }]);
      }
    } catch (err) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: '', error: err.message || 'Something went wrong' }]);
    } finally {
      setChatLoading(false);
    }
  }, [chatMessages, draft.data_sources, onPreview]);

  // "Use this version" — save compiled prompt to draft
  const handleUseThis = useCallback(() => {
    if (compiledPrompt) {
      updateDraft({ prompt_template: compiledPrompt });
    }
  }, [compiledPrompt, updateDraft]);

  const validate = useCallback(() => {
    const errs = {};
    if (!draft.name.trim()) errs.name = 'Name is required';
    if (!draft.slug.trim()) errs.slug = 'Slug is required';
    else if (!/^[a-z0-9-]+$/.test(draft.slug)) errs.slug = 'Slug must be lowercase letters, numbers, and hyphens';
    if (!draft.prompt_template || draft.prompt_template.length < 10) errs.prompt_template = 'Generate a preview first to set the prompt template';
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
      {/* Two-column layout */}
      <div style={styles.columns}>
        {/* Left: config + chat */}
        <div style={styles.leftCol}>
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

            {/* ── Data Sources ──────────────────── */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Data Sources</div>
              <DataSourceConfig
                dataSources={draft.data_sources}
                feeds={feeds}
                onChange={ds => updateDraft({ data_sources: ds })}
              />
            </div>

            {/* ── Chat Prompt ───────────────────── */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Report Content</div>
              {errors.prompt_template && <div style={styles.errorText}>{errors.prompt_template}</div>}
              {compiledPrompt && (
                <div style={styles.promptSaved}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Prompt template saved from preview
                </div>
              )}
              <PromptChat
                messages={chatMessages}
                loading={chatLoading}
                onSend={handleChatSend}
              />
            </div>

            {/* ── Delivery ──────────────────────── */}
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
                <div style={styles.hint}>Sends to all team members with email reports enabled + external subscribers.</div>
              )}
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

        {/* Right: preview */}
        <div style={styles.rightCol}>
          <ReportPreview
            html={previewHtml}
            loading={chatLoading}
            compiledPrompt={compiledPrompt}
            onUseThis={handleUseThis}
          />
        </div>
      </div>
    </div>
  );
}

const styles = {
  editor: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    overflow: 'hidden',
  },
  columns: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  leftCol: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    minWidth: 0,
  },
  rightCol: {
    width: '50%',
    maxWidth: '600px',
    minWidth: '360px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  scrollArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px 24px 24px',
  },
  section: {
    marginBottom: '24px',
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
  errorText: {
    fontSize: '11px',
    color: '#ef4444',
    marginTop: '4px',
    marginBottom: '4px',
  },
  hint: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.25)',
    marginTop: '6px',
  },
  promptSaved: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: '#22c55e',
    marginBottom: '10px',
  },
  row: {
    display: 'flex',
    gap: '16px',
    alignItems: 'center',
    flexWrap: 'wrap',
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
  runBtn: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    color: 'rgba(255,255,255,0.7)',
    fontSize: '13px',
    fontFamily: 'inherit',
    padding: '8px 18px',
    cursor: 'pointer',
    transition: 'opacity 0.12s',
  },
  runBtnDisabled: {
    opacity: 0.35,
    cursor: 'not-allowed',
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
