import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { callWorkflowFn } from '../lib/workflowApi';
import {
  TRIGGER_ENTITIES,
  TRIGGER_EVENTS,
  ACTION_TYPES_FRIENDLY,
  NAVIGATE_TARGETS,
  OUTCOME_STYLES_FRIENDLY,
  COMMON_CONTEXT_KEYS,
  buildContextKeyOptions,
  parseConditionExpression,
  buildConditionExpression,
  CONDITION_OPS,
  lookupActionType,
  lookupEntity,
  lookupEvent,
} from '../lib/workflowCatalog';
import ShortcutsCanvas from './workflows/ShortcutsCanvas';

// ─── Constants ───────────────────────────────────────────────

const SOURCE_COLORS = {
  code: { bg: 'rgba(255,255,255,0.06)', text: 'rgba(255,255,255,0.5)' },
  data: { bg: 'rgba(99,102,241,0.15)', text: '#818cf8' },
};

const OUTCOME_STYLE_COLORS = {
  default: { bg: 'rgba(255,255,255,0.06)', text: 'rgba(255,255,255,0.6)', border: 'rgba(255,255,255,0.1)' },
  success: { bg: 'rgba(34,197,94,0.1)', text: '#22c55e', border: 'rgba(34,197,94,0.3)' },
  danger: { bg: 'rgba(239,68,68,0.1)', text: '#ef4444', border: 'rgba(239,68,68,0.3)' },
  warning: { bg: 'rgba(234,179,8,0.1)', text: '#eab308', border: 'rgba(234,179,8,0.3)' },
};

const SIM_STATUS_COLORS = {
  active: '#6366f1',
  complete: '#22c55e',
  pending: 'rgba(255,255,255,0.3)',
  on_hold: '#eab308',
  skipped: 'rgba(255,255,255,0.2)',
};

const ACTION_TYPES = ['complete', 'navigate', 'modal', 'custom'];
const ASSIGNEE_TYPES = ['static', 'context'];
const TRIGGER_MODES = ['manual', 'auto', 'both'];
const OUTCOME_STYLES = ['default', 'success', 'danger', 'warning'];

// ─── Helpers ─────────────────────────────────────────────────

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 60);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ─── Helper sub-components ───────────────────────────────────

function ProfilePicker({ value, profiles, placeholder = 'Select a person…', onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);
  const current = profiles.find((p) => p.id === value);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return profiles;
    return profiles.filter((p) =>
      p.name.toLowerCase().includes(s) || (p.role || '').toLowerCase().includes(s)
    );
  }, [profiles, search]);

  return (
    <div ref={ref} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        style={pickerStyles.trigger}
      >
        {current ? (
          <>
            <span style={pickerStyles.name}>{current.name}</span>
            <span style={pickerStyles.roleBadge}>{current.role}</span>
          </>
        ) : (
          <span style={pickerStyles.placeholder}>{placeholder}</span>
        )}
        <span style={pickerStyles.chevron}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={pickerStyles.menu}>
          <input
            autoFocus
            placeholder="Search by name or role…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={pickerStyles.searchInput}
          />
          <div style={pickerStyles.optionList}>
            {filtered.length === 0 ? (
              <div style={pickerStyles.emptyOption}>No matches</div>
            ) : filtered.map((p) => (
              <div
                key={p.id}
                onClick={() => { onChange(p.id); setOpen(false); setSearch(''); }}
                style={{
                  ...pickerStyles.option,
                  ...(p.id === value ? pickerStyles.optionActive : {}),
                }}
              >
                <span style={pickerStyles.name}>{p.name}</span>
                <span style={pickerStyles.roleBadge}>{p.role}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ContextKeyPicker({ value, contextKeys, onChange, disabled, placeholder = 'Pick a variable…' }) {
  return (
    <select
      disabled={disabled}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      style={pickerStyles.contextSelect}
    >
      <option value="">{placeholder}</option>
      {contextKeys.map((k) => (
        <option key={k.key} value={k.key}>{k.label} ({`{{${k.key}}}`})</option>
      ))}
    </select>
  );
}

function VariableChip({ contextKeys, onInsert }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        style={pickerStyles.varChip}
        onClick={() => setOpen((v) => !v)}
        title="Insert a variable"
      >
        {'{ }'} Insert
      </button>
      {open && (
        <div style={{ ...pickerStyles.menu, right: 0, left: 'auto', minWidth: 260 }}>
          <div style={pickerStyles.varHeader}>Available variables</div>
          <div style={pickerStyles.optionList}>
            {contextKeys.length === 0 ? (
              <div style={pickerStyles.emptyOption}>No known variables yet</div>
            ) : contextKeys.map((k) => (
              <div
                key={k.key}
                onClick={() => { onInsert(`{{${k.key}}}`); setOpen(false); }}
                style={pickerStyles.option}
              >
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={pickerStyles.varLabel}>{k.label}</span>
                  <span style={pickerStyles.varScope}>
                    {`{{${k.key}}}`}{k.scope ? ` • ${k.scope}` : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TriggerBuilder({ mode, config, onChange, disabled }) {
  const showSentence = mode === 'auto' || mode === 'both';
  const entity = config?.entity || '';
  const event = config?.event || '';

  if (!showSentence) {
    return (
      <div style={pickerStyles.triggerSentence}>
        <span style={pickerStyles.triggerWord}>Started manually by an admin.</span>
      </div>
    );
  }

  const entityLabel = lookupEntity(entity)?.label;
  const eventLabel = lookupEvent(event)?.label;

  return (
    <div>
      <div style={pickerStyles.triggerSentence}>
        <span style={pickerStyles.triggerWord}>Run when</span>
        <select
          disabled={disabled}
          value={entity}
          onChange={(e) => onChange({ ...config, entity: e.target.value })}
          style={pickerStyles.inlineSelect}
        >
          <option value="">— pick a record —</option>
          {TRIGGER_ENTITIES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <select
          disabled={disabled}
          value={event}
          onChange={(e) => onChange({ ...config, event: e.target.value })}
          style={pickerStyles.inlineSelect}
        >
          <option value="">— pick an event —</option>
          {TRIGGER_EVENTS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>
      {entityLabel && eventLabel && (
        <div style={pickerStyles.triggerPreview}>
          Reads as: <em>"Run when {entityLabel} {eventLabel}."</em>
        </div>
      )}
    </div>
  );
}

function ActionEditor({ step, onUpdate, actionHandlers, disabled }) {
  const friendly = lookupActionType(step.action_type) || ACTION_TYPES_FRIENDLY[0];
  const config = step.action_config || {};

  return (
    <div>
      <div style={pickerStyles.actionTypeRow}>
        {ACTION_TYPES_FRIENDLY.map((t) => (
          <button
            key={t.value}
            type="button"
            disabled={disabled}
            onClick={() => onUpdate({ action_type: t.value, action_config: {} })}
            style={{
              ...pickerStyles.actionTypeBtn,
              ...(step.action_type === t.value ? pickerStyles.actionTypeBtnActive : {}),
            }}
            title={t.description}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div style={pickerStyles.actionTypeDesc}>{friendly.description}</div>

      <div style={pickerStyles.actionSubRow}>
        <label style={pickerStyles.actionSubLabel}>Button label</label>
        <input
          disabled={disabled}
          style={pickerStyles.actionInput}
          value={step.action_label || ''}
          onChange={(e) => onUpdate({ action_label: e.target.value })}
          placeholder="e.g. Mark Complete"
        />
      </div>

      {step.action_type === 'navigate' && (
        <div style={pickerStyles.actionSubRow}>
          <label style={pickerStyles.actionSubLabel}>Go to</label>
          <select
            disabled={disabled}
            style={pickerStyles.actionInput}
            value={config.tab || ''}
            onChange={(e) => onUpdate({ action_config: { ...config, tab: e.target.value } })}
          >
            <option value="">— pick a page —</option>
            {NAVIGATE_TARGETS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      )}

      {step.action_type === 'modal' && (
        <div style={pickerStyles.actionSubRow}>
          <label style={pickerStyles.actionSubLabel}>Form name</label>
          <input
            disabled={disabled}
            style={pickerStyles.actionInput}
            value={config.modalKey || ''}
            onChange={(e) => onUpdate({ action_config: { ...config, modalKey: e.target.value } })}
            placeholder="e.g. assign_editor"
          />
        </div>
      )}

      {step.action_type === 'custom' && (
        <div style={pickerStyles.actionSubRow}>
          <label style={pickerStyles.actionSubLabel}>Custom logic</label>
          <select
            disabled={disabled}
            style={pickerStyles.actionInput}
            value={step.on_complete_handler || ''}
            onChange={(e) => onUpdate({ on_complete_handler: e.target.value || null })}
          >
            <option value="">— pick a handler —</option>
            {actionHandlers.map((h) => (
              <option key={h.slug} value={h.slug}>{h.slug}</option>
            ))}
          </select>
        </div>
      )}
      {step.action_type === 'custom' && step.on_complete_handler && (
        <div style={pickerStyles.handlerHint}>
          {actionHandlers.find((h) => h.slug === step.on_complete_handler)?.description || 'No description available.'}
        </div>
      )}
    </div>
  );
}

function FanOutEditor({ step, onUpdate, contextKeys, disabled }) {
  const hasFanOut = step.fan_out_context_key !== null && step.fan_out_context_key !== undefined;
  const arrayKeys = contextKeys.filter((k) => k.isArray || k.scope === 'root');
  const previewLabel = (() => {
    const meta = contextKeys.find((k) => k.key === step.fan_out_context_key);
    if (!meta) return null;
    return meta.label.toLowerCase();
  })();

  return (
    <div>
      <label style={pickerStyles.checkboxRow}>
        <input
          type="checkbox"
          checked={hasFanOut}
          disabled={disabled}
          onChange={(e) => {
            if (e.target.checked) {
              onUpdate({
                fan_out_context_key: '',
                fan_out_title_template: step.title_template || '',
                fan_out_entity_type: '',
                fan_out_entity_id_key: 'id',
              });
            } else {
              onUpdate({
                fan_out_context_key: null,
                fan_out_title_template: null,
                fan_out_entity_type: null,
                fan_out_entity_id_key: null,
              });
            }
          }}
        />
        <span style={pickerStyles.checkboxLabel}>Repeat this step for each item in a list</span>
      </label>

      {hasFanOut && (
        <div style={pickerStyles.fanOutInner}>
          <div style={pickerStyles.actionSubRow}>
            <label style={pickerStyles.actionSubLabel}>Pick the list</label>
            <select
              disabled={disabled}
              style={pickerStyles.actionInput}
              value={step.fan_out_context_key || ''}
              onChange={(e) => onUpdate({ fan_out_context_key: e.target.value })}
            >
              <option value="">— pick a list variable —</option>
              {arrayKeys.map((k) => (
                <option key={k.key} value={k.key}>{k.label} ({`{{${k.key}}}`})</option>
              ))}
            </select>
          </div>
          <div style={pickerStyles.actionSubRow}>
            <label style={pickerStyles.actionSubLabel}>What to call each one</label>
            <input
              disabled={disabled}
              style={pickerStyles.actionInput}
              value={step.fan_out_entity_type || ''}
              onChange={(e) => onUpdate({ fan_out_entity_type: e.target.value })}
              placeholder="e.g. deliverable"
            />
          </div>
          <div style={pickerStyles.actionSubRow}>
            <label style={pickerStyles.actionSubLabel}>Per-item title</label>
            <input
              disabled={disabled}
              style={pickerStyles.actionInput}
              value={step.fan_out_title_template || ''}
              onChange={(e) => onUpdate({ fan_out_title_template: e.target.value })}
              placeholder="e.g. Write ad read: {{title}}"
            />
          </div>
          <div style={pickerStyles.actionSubRow}>
            <label style={pickerStyles.actionSubLabel}>ID field on each item</label>
            <input
              disabled={disabled}
              style={pickerStyles.actionInput}
              value={step.fan_out_entity_id_key || 'id'}
              onChange={(e) => onUpdate({ fan_out_entity_id_key: e.target.value })}
              placeholder="id"
            />
          </div>
          {previewLabel && (
            <div style={pickerStyles.fanOutPreview}>
              Creates one task per <strong>{step.fan_out_entity_type || 'item'}</strong> in <strong>{previewLabel}</strong>.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DependsOnEditor({ step, allSteps, onUpdate, disabled }) {
  const others = allSteps.filter((s) => s.step_key !== step.step_key && s.position < step.position);
  const selected = new Set(step.depends_on_step_keys || []);

  if (others.length === 0) {
    return <div style={pickerStyles.depsEmpty}>No earlier steps to wait on.</div>;
  }

  return (
    <div style={pickerStyles.depsList}>
      {others.map((s) => {
        const checked = selected.has(s.step_key);
        return (
          <label key={s.id} style={pickerStyles.depsRow}>
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) next.add(s.step_key);
                else next.delete(s.step_key);
                onUpdate({ depends_on_step_keys: Array.from(next) });
              }}
            />
            <span style={pickerStyles.depsKey}>{s.step_key}</span>
            <span style={pickerStyles.depsTitle}>{s.title_template || '(no title)'}</span>
          </label>
        );
      })}
    </div>
  );
}

function ConditionBuilder({ step, contextKeys, onUpdate, disabled }) {
  const parsed = parseConditionExpression(step.condition_expression);
  const update = (next) => {
    const merged = { ...parsed, ...next };
    onUpdate({ condition_expression: buildConditionExpression(merged) });
  };

  return (
    <div style={pickerStyles.conditionRow}>
      <select
        disabled={disabled}
        style={pickerStyles.conditionSelect}
        value={parsed.op}
        onChange={(e) => update({ op: e.target.value })}
      >
        {CONDITION_OPS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {parsed.op !== 'always' && (
        <select
          disabled={disabled}
          style={pickerStyles.conditionSelect}
          value={parsed.key}
          onChange={(e) => update({ key: e.target.value })}
        >
          <option value="">— pick a variable —</option>
          {contextKeys.map((k) => (
            <option key={k.key} value={k.key}>{k.label}</option>
          ))}
        </select>
      )}
      {parsed.op === 'eq' && (
        <input
          disabled={disabled}
          style={pickerStyles.conditionInput}
          value={parsed.value}
          onChange={(e) => update({ value: e.target.value })}
          placeholder="value"
        />
      )}
    </div>
  );
}

const TemplateInput = React.forwardRef(function TemplateInput(
  { value, onChange, placeholder, contextKeys, disabled, multiline = false },
  forwardedRef,
) {
  const localRef = useRef(null);
  const setRef = (el) => {
    localRef.current = el;
    if (typeof forwardedRef === 'function') forwardedRef(el);
    else if (forwardedRef) forwardedRef.current = el;
  };
  const insert = (text) => {
    const el = localRef.current;
    if (!el) {
      onChange((value || '') + text);
      return;
    }
    const start = el.selectionStart ?? (value || '').length;
    const end = el.selectionEnd ?? (value || '').length;
    const next = (value || '').slice(0, start) + text + (value || '').slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + text.length;
      el.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <div style={pickerStyles.templateWrap}>
      {multiline ? (
        <textarea
          ref={setRef}
          disabled={disabled}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          style={pickerStyles.templateTextarea}
        />
      ) : (
        <input
          ref={setRef}
          disabled={disabled}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={pickerStyles.templateInput}
        />
      )}
      {!disabled && (
        <VariableChip contextKeys={contextKeys} onInsert={insert} />
      )}
    </div>
  );
});

// ─── Component ───────────────────────────────────────────────

export default function Workflows() {
  const { isAdmin, profile } = useAuth();

  // ── Workflow list state ──
  const [workflows, setWorkflows] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [listLoading, setListLoading] = useState(true);

  // ── Builder state ──
  const [steps, setSteps] = useState([]);
  const [outcomes, setOutcomes] = useState({}); // { stepId: [outcome, ...] }
  const [workflowForm, setWorkflowForm] = useState(null);
  const [builderLoading, setBuilderLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState(null);
  const [deleteConfirmStepId, setDeleteConfirmStepId] = useState(null);

  // ── Version state ──
  const [versions, setVersions] = useState([]);
  const [showVersions, setShowVersions] = useState(false);
  const autoPublishTimerRef = useRef(null);
  const autoPublishInFlightRef = useRef(false);

  // ── Simulator state ──
  const [showSimulator, setShowSimulator] = useState(false);
  const [simContext, setSimContext] = useState('{}');
  const [simInstanceId, setSimInstanceId] = useState(null);
  const [simTasks, setSimTasks] = useState([]);
  const [simStatus, setSimStatus] = useState(null); // 'active', 'complete'
  const [simRunning, setSimRunning] = useState(false);
  const [simPayloads, setSimPayloads] = useState({}); // { taskId: jsonString }
  const [simOutcomeSelections, setSimOutcomeSelections] = useState({}); // { taskId: outcomeKey }
  const [simCompletingId, setSimCompletingId] = useState(null);
  const [simCleaning, setSimCleaning] = useState(false);
  const [simInstanceContext, setSimInstanceContext] = useState(null);

  // ── New workflow state ──
  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');

  // ── Profile + action-handler catalogs (for friendly pickers) ──
  const [profiles, setProfiles] = useState([]);
  const [actionHandlers, setActionHandlers] = useState([]);

  const toastTimerRef = useRef(null);

  // ─── Toast helper ──────────────────────────────────────────

  const showToast = useCallback((message, type = 'success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // ─── Fetch workflows ──────────────────────────────────────

  const fetchWorkflows = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('workflows')
        .select('id, slug, name, description, source, is_active, first_step_key, trigger_mode, trigger_config, current_version_id')
        .order('created_at', { ascending: true });
      if (error) throw error;
      setWorkflows(data || []);
    } catch (err) {
      console.error('Error fetching workflows:', err);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) fetchWorkflows();
  }, [isAdmin, fetchWorkflows]);

  // ─── Fetch profiles for assignee picker ────────────────────

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, status')
        .order('full_name', { ascending: true, nullsFirst: false });
      if (cancelled) return;
      if (error) {
        console.error('Failed to load profiles:', error);
        return;
      }
      setProfiles((data || [])
        .filter((p) => p.status !== 'archived')
        .map((p) => ({
          id: p.id,
          name: p.full_name || p.email || 'Unknown',
          role: p.role || 'member',
        })));
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  // ─── Fetch action handler registry ─────────────────────────

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await callWorkflowFn('workflow-list-actions', {});
        if (cancelled) return;
        setActionHandlers(res.actions || []);
      } catch (err) {
        console.error('Failed to load action handlers:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  // ─── Select workflow and load builder ─────────────────────

  const selectedWorkflow = workflows.find(w => w.id === selectedId);

  const loadBuilder = useCallback(async (wf) => {
    if (!wf) return;
    setBuilderLoading(true);
    setSteps([]);
    setOutcomes({});
    setVersions([]);
    setShowVersions(false);
    resetSimulator();

    setWorkflowForm({
      name: wf.name,
      slug: wf.slug,
      description: wf.description || '',
      trigger_mode: wf.trigger_mode || 'manual',
      trigger_config: wf.trigger_config || {},
      first_step_key: wf.first_step_key || '',
      source: wf.source,
    });

    try {
      // Load steps
      const { data: stepRows, error: sErr } = await supabase
        .from('workflow_steps')
        .select('*')
        .eq('workflow_id', wf.id)
        .order('position');

      if (sErr) throw sErr;
      const loadedSteps = stepRows || [];
      setSteps(loadedSteps);

      // Load outcomes for all steps
      if (loadedSteps.length > 0) {
        const stepIds = loadedSteps.map(s => s.id);
        const { data: outcomeRows, error: oErr } = await supabase
          .from('workflow_step_outcomes')
          .select('*')
          .in('step_id', stepIds)
          .order('position');

        if (oErr) throw oErr;
        const grouped = {};
        for (const o of (outcomeRows || [])) {
          if (!grouped[o.step_id]) grouped[o.step_id] = [];
          grouped[o.step_id].push(o);
        }
        setOutcomes(grouped);
      }

      // Load versions
      const { data: vRows } = await supabase
        .from('workflow_versions')
        .select('id, version_number, published_at, published_by')
        .eq('workflow_id', wf.id)
        .order('version_number', { ascending: false });
      setVersions(vRows || []);
    } catch (err) {
      console.error('Error loading builder:', err);
      showToast('Failed to load workflow steps', 'error');
    } finally {
      setBuilderLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (selectedId) {
      const wf = workflows.find(w => w.id === selectedId);
      if (wf) loadBuilder(wf);
    }
  }, [selectedId, workflows, loadBuilder]);

  // ─── Toggle active ────────────────────────────────────────

  const toggleActive = async (wf) => {
    const newVal = !wf.is_active;
    const { error } = await supabase
      .from('workflows')
      .update({ is_active: newVal })
      .eq('id', wf.id);
    if (error) {
      showToast('Failed to toggle active state', 'error');
      return;
    }
    setWorkflows(prev => prev.map(w => w.id === wf.id ? { ...w, is_active: newVal } : w));
    showToast(newVal ? 'Activated' : 'Deactivated');
  };

  // ─── Create new workflow ──────────────────────────────────

  const handleCreateWorkflow = async () => {
    if (!newName.trim() || !newSlug.trim()) return;
    const { data, error } = await supabase
      .from('workflows')
      .insert({
        name: newName.trim(),
        slug: newSlug.trim(),
        description: '',
        source: 'data',
        is_active: false,
        trigger_mode: 'manual',
        trigger_config: {},
      })
      .select()
      .single();

    if (error) {
      showToast(error.message.includes('duplicate') ? 'Slug already exists' : error.message, 'error');
      return;
    }

    setShowNewModal(false);
    setNewName('');
    setNewSlug('');
    await fetchWorkflows();
    setSelectedId(data.id);
    showToast('Workflow created');
  };

  // ─── Save workflow header ─────────────────────────────────

  const saveWorkflowHeader = async () => {
    if (!selectedId || !workflowForm) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('workflows')
        .update({
          name: workflowForm.name,
          description: workflowForm.description,
          trigger_mode: workflowForm.trigger_mode,
          trigger_config: workflowForm.trigger_config,
          first_step_key: workflowForm.first_step_key || null,
        })
        .eq('id', selectedId);

      if (error) throw error;
      await fetchWorkflows();
      showToast('Saved');
      schedulePublish();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ─── Step CRUD ────────────────────────────────────────────

  const addStep = async (preset = {}) => {
    if (!selectedId) return null;
    const newPosition = steps.length;
    const stepKey = `step_${Date.now()}`;
    const insertRow = {
      workflow_id: selectedId,
      step_key: stepKey,
      title_template: '',
      assignee_type: 'static',
      assignee_value: '',
      action_type: 'complete',
      action_label: 'Mark Complete',
      action_config: {},
      depends_on_step_keys: [],
      position: newPosition,
      ...preset,
    };
    const { data, error } = await supabase
      .from('workflow_steps')
      .insert(insertRow)
      .select()
      .single();

    if (error) {
      showToast('Failed to add step: ' + error.message, 'error');
      return null;
    }
    setSteps(prev => [...prev, data]);
    schedulePublish();
    return data;
  };

  const updateStep = async (stepId, updates) => {
    const { error } = await supabase
      .from('workflow_steps')
      .update(updates)
      .eq('id', stepId);

    if (error) {
      showToast('Failed to update step: ' + error.message, 'error');
      return;
    }
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, ...updates } : s));
    schedulePublish();
  };

  const deleteStep = async (stepId) => {
    const { error } = await supabase
      .from('workflow_steps')
      .delete()
      .eq('id', stepId);

    if (error) {
      showToast('Failed to delete step: ' + error.message, 'error');
      return;
    }
    setSteps(prev => prev.filter(s => s.id !== stepId));
    setOutcomes(prev => {
      const next = { ...prev };
      delete next[stepId];
      return next;
    });
    setDeleteConfirmStepId(null);
    showToast('Step deleted');
    schedulePublish();
  };

  // ─── Outcome CRUD ────────────────────────────────────────

  const addOutcome = async (stepId, overrides = {}) => {
    const existing = outcomes[stepId] || [];
    const pos = existing.length;
    const row = {
      step_id: stepId,
      outcome_key: `outcome_${Date.now()}`,
      label: '',
      next_step_key: null,
      style: 'default',
      position: pos,
      ...overrides,
    };
    const { data, error } = await supabase
      .from('workflow_step_outcomes')
      .insert(row)
      .select()
      .single();

    if (error) {
      showToast('Failed to add outcome: ' + error.message, 'error');
      return null;
    }
    setOutcomes(prev => ({
      ...prev,
      [stepId]: [...(prev[stepId] || []), data],
    }));
    schedulePublish();
    return data;
  };

  const updateOutcome = async (outcomeId, stepIdOrUpdates, maybeUpdates) => {
    // Backward-compat: (id, stepId, updates) OR (id, updates).
    const updates = maybeUpdates !== undefined ? maybeUpdates : stepIdOrUpdates;
    const { error } = await supabase
      .from('workflow_step_outcomes')
      .update(updates)
      .eq('id', outcomeId);

    if (error) {
      showToast('Failed to update outcome: ' + error.message, 'error');
      return;
    }
    setOutcomes(prev => {
      const next = { ...prev };
      for (const sid of Object.keys(next)) {
        next[sid] = next[sid].map((o) => (o.id === outcomeId ? { ...o, ...updates } : o));
      }
      return next;
    });
    schedulePublish();
  };

  const deleteOutcome = async (outcomeId, stepId) => {
    const { error } = await supabase
      .from('workflow_step_outcomes')
      .delete()
      .eq('id', outcomeId);

    if (error) {
      showToast('Failed to delete outcome: ' + error.message, 'error');
      return;
    }
    setOutcomes(prev => ({
      ...prev,
      [stepId]: (prev[stepId] || []).filter(o => o.id !== outcomeId),
    }));
    schedulePublish();
  };

  // ─── Version Publishing ───────────────────────────────────

  const publishVersion = async (opts = {}) => {
    const silent = !!opts.silent;
    if (!selectedId || !workflowForm) return;
    if (silent && autoPublishInFlightRef.current) return;
    // Manual publish supersedes any pending auto-publish — cancel the timer
    // so we don't end up with a duplicate version right after.
    if (!silent && autoPublishTimerRef.current) {
      clearTimeout(autoPublishTimerRef.current);
      autoPublishTimerRef.current = null;
    }
    if (silent) autoPublishInFlightRef.current = true;
    else setPublishing(true);
    try {
      // First save the header (skip toast when auto-publishing — the header
      // save would fire its own "Saved" toast otherwise)
      if (!silent) await saveWorkflowHeader();

      // Fetch latest steps + outcomes for snapshot
      const { data: snapSteps } = await supabase
        .from('workflow_steps')
        .select('*')
        .eq('workflow_id', selectedId)
        .order('position');

      const stepIds = (snapSteps || []).map(s => s.id);
      let snapOutcomes = [];
      if (stepIds.length > 0) {
        const { data: oRows } = await supabase
          .from('workflow_step_outcomes')
          .select('*')
          .in('step_id', stepIds)
          .order('position');
        snapOutcomes = oRows || [];
      }

      // Determine version number from DB (avoid stale local state)
      const { data: latestVer } = await supabase
        .from('workflow_versions')
        .select('version_number')
        .eq('workflow_id', selectedId)
        .order('version_number', { ascending: false })
        .limit(1)
        .single();
      const newVersionNum = (latestVer?.version_number || 0) + 1;

      // Create snapshot
      const snapshot = {
        steps: snapSteps || [],
        outcomes: snapOutcomes,
        firstStep: workflowForm.first_step_key,
      };

      // Insert version
      const { data: versionRow, error: vErr } = await supabase
        .from('workflow_versions')
        .insert({
          workflow_id: selectedId,
          version_number: newVersionNum,
          snapshot,
          published_by: profile.id,
        })
        .select()
        .single();

      if (vErr) throw vErr;

      // Update workflows.current_version_id
      const { error: wErr } = await supabase
        .from('workflows')
        .update({ current_version_id: versionRow.id })
        .eq('id', selectedId);

      if (wErr) throw wErr;

      await fetchWorkflows();
      setVersions(prev => [versionRow, ...prev]);
      if (!silent) showToast(`Published v${newVersionNum}`);
    } catch (err) {
      // Auto-publish errors surface as toasts too — silent failures would be worse
      showToast((silent ? 'Auto-publish failed: ' : 'Publish failed: ') + err.message, 'error');
    } finally {
      if (silent) autoPublishInFlightRef.current = false;
      else setPublishing(false);
    }
  };

  // Debounced auto-publish: any builder change schedules a publish 800ms later.
  // Subsequent changes reset the timer so we only publish once per burst of edits.
  const schedulePublish = useCallback(() => {
    if (autoPublishTimerRef.current) clearTimeout(autoPublishTimerRef.current);
    autoPublishTimerRef.current = setTimeout(() => {
      autoPublishTimerRef.current = null;
      publishVersion({ silent: true });
    }, 800);
  }, [selectedId, workflowForm]); // eslint-disable-line

  // Cancel any pending auto-publish when the selected workflow changes or unmount.
  useEffect(() => {
    return () => {
      if (autoPublishTimerRef.current) {
        clearTimeout(autoPublishTimerRef.current);
        autoPublishTimerRef.current = null;
      }
    };
  }, [selectedId]);

  const rollbackToVersion = async (version) => {
    try {
      const { error } = await supabase
        .from('workflows')
        .update({ current_version_id: version.id })
        .eq('id', selectedId);

      if (error) throw error;
      await fetchWorkflows();
      showToast(`Rolled back to v${version.version_number}`);
    } catch (err) {
      showToast('Rollback failed: ' + err.message, 'error');
    }
  };

  // ─── Simulator ────────────────────────────────────────────

  const resetSimulator = () => {
    setSimInstanceId(null);
    setSimTasks([]);
    setSimStatus(null);
    setSimRunning(false);
    setSimPayloads({});
    setSimOutcomeSelections({});
    setSimCompletingId(null);
    setSimInstanceContext(null);
  };

  const startSimulation = async () => {
    if (!selectedWorkflow) return;
    setSimRunning(true);
    try {
      let parsedCtx = {};
      try {
        parsedCtx = JSON.parse(simContext);
      } catch {
        showToast('Invalid JSON context', 'error');
        setSimRunning(false);
        return;
      }

      const result = await callWorkflowFn('workflow-start', {
        slug: selectedWorkflow.slug,
        context: parsedCtx,
        test_mode: true,
      });

      setSimInstanceId(result.instance_id);
      setSimStatus('active');
      await refreshSimTasks(result.instance_id);
    } catch (err) {
      showToast('Start failed: ' + err.message, 'error');
    } finally {
      setSimRunning(false);
    }
  };

  const refreshSimTasks = async (instId) => {
    const id = instId || simInstanceId;
    if (!id) return;

    const { data: tasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('workflow_instance_id', id)
      .order('position', { ascending: true });
    setSimTasks(tasks || []);

    const { data: inst } = await supabase
      .from('workflow_instances')
      .select('status, context')
      .eq('id', id)
      .single();
    if (inst) {
      setSimStatus(inst.status);
      setSimInstanceContext(inst.context);
    }
  };

  const completeSimTask = async (taskId) => {
    setSimCompletingId(taskId);
    try {
      let payload = {};
      try {
        payload = JSON.parse(simPayloads[taskId] || '{}');
      } catch {
        showToast('Invalid JSON payload', 'error');
        setSimCompletingId(null);
        return;
      }

      // Include outcome if selected
      const outcomeKey = simOutcomeSelections[taskId];
      if (outcomeKey) {
        payload.outcome = outcomeKey;
      }

      await callWorkflowFn('workflow-complete-task', {
        task_id: taskId,
        payload,
      });

      await refreshSimTasks();
    } catch (err) {
      showToast('Complete failed: ' + err.message, 'error');
    } finally {
      setSimCompletingId(null);
    }
  };

  const cleanupSimulation = async () => {
    if (!simInstanceId) return;
    setSimCleaning(true);
    try {
      await callWorkflowFn('workflow-cleanup-test', {
        instance_id: simInstanceId,
      });
      resetSimulator();
      showToast('Simulation cleaned up');
    } catch (err) {
      showToast('Cleanup failed: ' + err.message, 'error');
    } finally {
      setSimCleaning(false);
    }
  };

  // Find outcomes for a step_key from the loaded outcomes map
  const getOutcomesForStepKey = (stepKey) => {
    const step = steps.find(s => s.step_key === stepKey);
    if (!step) return [];
    return outcomes[step.id] || [];
  };

  // ─── Guard: admin only ─────────────────────────────────────

  if (!isAdmin) {
    return (
      <div style={styles.page}>
        <p style={{ color: 'rgba(255,255,255,0.5)' }}>Admin access required.</p>
      </div>
    );
  }

  // ─── Determine if builder is editable ──────────────────────
  const isEditable = workflowForm?.source === 'data';
  const contextKeyOptions = useMemo(() => buildContextKeyOptions(steps), [steps]);

  // ─── Render ─────────────────────────────────────────────────

  return (
    <div style={styles.page}>
      {/* Toast */}
      {toast && (
        <div style={{
          ...styles.toast,
          background: toast.type === 'error' ? 'rgba(239,68,68,0.9)' : 'rgba(34,197,94,0.9)',
        }}>
          {toast.message}
        </div>
      )}

      <div style={styles.layout}>
        {/* ── Left Panel: Workflow List ── */}
        <div style={styles.leftPanel}>
          <div style={styles.listHeader}>
            <h2 style={styles.listTitle}>Workflows</h2>
            <button style={styles.newBtn} onClick={() => {
              setShowNewModal(true);
              setNewName('');
              setNewSlug('');
            }}>
              + New
            </button>
          </div>

          {listLoading ? (
            <div style={styles.listLoading}>
              <div style={styles.spinner} />
            </div>
          ) : workflows.length === 0 ? (
            <p style={styles.listEmpty}>No workflows yet</p>
          ) : (
            <div style={styles.listItems}>
              {workflows.map(wf => (
                <div
                  key={wf.id}
                  style={{
                    ...styles.listItem,
                    ...(selectedId === wf.id ? styles.listItemSelected : {}),
                  }}
                  onClick={() => setSelectedId(wf.id)}
                >
                  <div style={styles.listItemTop}>
                    <span style={styles.listItemName}>{wf.name}</span>
                    <button
                      style={{
                        ...styles.activeDot,
                        background: wf.is_active ? '#22c55e' : 'rgba(255,255,255,0.2)',
                      }}
                      onClick={(e) => { e.stopPropagation(); toggleActive(wf); }}
                      title={wf.is_active ? 'Active - click to deactivate' : 'Inactive - click to activate'}
                    />
                  </div>
                  <div style={styles.listItemBottom}>
                    <span style={{
                      ...styles.sourceBadge,
                      background: SOURCE_COLORS[wf.source]?.bg,
                      color: SOURCE_COLORS[wf.source]?.text,
                    }}>
                      {wf.source}
                    </span>
                    <span style={styles.slugText}>{wf.slug}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Right Panel: Builder Canvas ── */}
        <div style={styles.rightPanel}>
          {!selectedId ? (
            <div style={styles.emptyCanvas}>
              <p style={styles.emptyCanvasText}>Select a workflow to view or edit</p>
            </div>
          ) : builderLoading ? (
            <div style={styles.canvasLoading}>
              <div style={styles.spinner} />
            </div>
          ) : workflowForm ? (
            <div style={styles.canvas}>
              {/* ── Header Bar ── */}
              <div style={styles.canvasHeader}>
                <div style={styles.headerFields}>
                  <div style={styles.fieldGroup}>
                    <label style={styles.fieldLabel}>Name</label>
                    {isEditable ? (
                      <input
                        style={styles.headerInput}
                        value={workflowForm.name}
                        onChange={e => setWorkflowForm(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Workflow name"
                      />
                    ) : (
                      <span style={styles.readonlyValue}>{workflowForm.name}</span>
                    )}
                  </div>

                  <div style={styles.fieldGroup}>
                    <label style={styles.fieldLabel}>Slug</label>
                    <span style={styles.readonlyValue}>{workflowForm.slug}</span>
                  </div>

                </div>

                <div style={styles.headerActions}>
                  {isEditable && (
                    <>
                      <button
                        style={styles.saveDraftBtn}
                        onClick={saveWorkflowHeader}
                        disabled={saving}
                      >
                        {saving ? 'Saving...' : 'Save Draft'}
                      </button>
                      <button
                        style={styles.publishBtn}
                        onClick={publishVersion}
                        disabled={publishing || steps.length === 0}
                      >
                        {publishing ? 'Publishing...' : 'Publish'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {!isEditable && (
                <div style={styles.readonlyBanner}>
                  This is a code-sourced workflow. Steps are defined in server code and shown here for reference only.
                </div>
              )}

              {/* ── Shortcuts-style canvas ── */}
              <ShortcutsCanvas
                workflowForm={workflowForm}
                setWorkflowForm={setWorkflowForm}
                steps={steps}
                outcomes={outcomes}
                profiles={profiles}
                actionHandlers={actionHandlers}
                contextKeys={contextKeyOptions}
                isEditable={isEditable}
                onUpdateStep={updateStep}
                onAddStep={addStep}
                onDeleteStep={deleteStep}
                onAddOutcome={addOutcome}
                onUpdateOutcome={updateOutcome}
                onDeleteOutcome={deleteOutcome}
              />

              {/* ── Version History ── */}
              <div style={styles.sectionContainer}>
                <button
                  style={styles.sectionToggle}
                  onClick={() => setShowVersions(!showVersions)}
                >
                  <span>Version History ({versions.length})</span>
                  <span style={styles.chevron}>{showVersions ? '\u25B2' : '\u25BC'}</span>
                </button>

                {showVersions && (
                  <div style={styles.versionList}>
                    {versions.length === 0 ? (
                      <p style={styles.noVersions}>No published versions yet</p>
                    ) : versions.map(v => {
                      const isCurrent = selectedWorkflow?.current_version_id === v.id;
                      return (
                        <div key={v.id} style={{
                          ...styles.versionRow,
                          ...(isCurrent ? styles.versionRowCurrent : {}),
                        }}>
                          <div style={styles.versionInfo}>
                            <span style={styles.versionNum}>v{v.version_number}</span>
                            {isCurrent && <span style={styles.currentBadge}>CURRENT</span>}
                            <span style={styles.versionDate}>{formatDate(v.published_at)}</span>
                          </div>
                          {!isCurrent && (
                            <button
                              style={styles.rollbackBtn}
                              onClick={() => rollbackToVersion(v)}
                            >
                              Rollback
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── Simulator ── */}
              <div style={styles.sectionContainer}>
                <button
                  style={styles.sectionToggle}
                  onClick={() => setShowSimulator(!showSimulator)}
                >
                  <span>Simulator</span>
                  <span style={styles.chevron}>{showSimulator ? '\u25B2' : '\u25BC'}</span>
                </button>

                {showSimulator && (
                  <div style={styles.simPanel}>
                    {!simInstanceId ? (
                      /* Pre-start config */
                      <div style={styles.simConfig}>
                        <label style={styles.fieldLabel}>Initial context (JSON)</label>
                        <textarea
                          style={styles.simContextInput}
                          value={simContext}
                          onChange={e => setSimContext(e.target.value)}
                          rows={5}
                          placeholder="{}"
                        />
                        <button
                          style={styles.simStartBtn}
                          onClick={startSimulation}
                          disabled={simRunning}
                        >
                          {simRunning ? 'Starting...' : 'Start Simulation'}
                        </button>
                      </div>
                    ) : (
                      /* Running simulation */
                      <div style={styles.simRunning}>
                        <div style={styles.simStatusBar}>
                          <span style={styles.simStatusLabel}>
                            Status: <span style={{ color: SIM_STATUS_COLORS[simStatus] || '#fff', fontWeight: 700 }}>
                              {simStatus}
                            </span>
                          </span>
                          <span style={styles.simStatusLabel}>
                            Steps: {simTasks.length}
                          </span>
                          <button
                            style={styles.simRefreshBtn}
                            onClick={() => refreshSimTasks()}
                          >
                            Refresh
                          </button>
                        </div>

                        {/* Task timeline */}
                        <div style={styles.simTimeline}>
                          {simTasks.map((task, ti) => {
                            const taskOutcomes = getOutcomesForStepKey(task.step_key);
                            const isActive = task.status === 'active';
                            const isComplete = task.status === 'complete';
                            const isCompleting = simCompletingId === task.id;

                            return (
                              <div key={task.id} style={styles.simTaskCard}>
                                <div style={styles.simTaskHeader}>
                                  <span style={{
                                    ...styles.simTaskDot,
                                    background: SIM_STATUS_COLORS[task.status] || 'rgba(255,255,255,0.3)',
                                  }} />
                                  <span style={styles.simTaskKey}>{task.step_key}</span>
                                  <span style={{
                                    ...styles.simTaskStatus,
                                    color: SIM_STATUS_COLORS[task.status],
                                  }}>
                                    {task.status}
                                  </span>
                                </div>

                                <div style={styles.simTaskTitle}>{task.title}</div>

                                {task.assignee_id && (
                                  <div style={styles.simTaskAssignee}>
                                    Assignee: {task.assignee_id.substring(0, 8)}...
                                  </div>
                                )}

                                {isComplete && task.completion_payload && Object.keys(task.completion_payload).length > 0 && (
                                  <pre style={styles.simPayloadPreview}>
                                    {JSON.stringify(task.completion_payload, null, 2)}
                                  </pre>
                                )}

                                {isActive && (
                                  <div style={styles.simTaskActions}>
                                    {/* Outcome selector */}
                                    {taskOutcomes.length > 0 && (
                                      <div style={styles.simOutcomeSelector}>
                                        <label style={styles.simSmallLabel}>Outcome:</label>
                                        <select
                                          style={styles.simOutcomeSelect}
                                          value={simOutcomeSelections[task.id] || ''}
                                          onChange={e => setSimOutcomeSelections(prev => ({
                                            ...prev,
                                            [task.id]: e.target.value,
                                          }))}
                                        >
                                          <option value="">-- select outcome --</option>
                                          {taskOutcomes.map(o => (
                                            <option key={o.id} value={o.outcome_key}>
                                              {o.label || o.outcome_key}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                    )}

                                    {/* Payload editor */}
                                    <div style={styles.simPayloadEditor}>
                                      <label style={styles.simSmallLabel}>Payload (JSON):</label>
                                      <textarea
                                        style={styles.simPayloadInput}
                                        value={simPayloads[task.id] || '{}'}
                                        onChange={e => setSimPayloads(prev => ({
                                          ...prev,
                                          [task.id]: e.target.value,
                                        }))}
                                        rows={2}
                                      />
                                    </div>

                                    <button
                                      style={styles.simCompleteBtn}
                                      onClick={() => completeSimTask(task.id)}
                                      disabled={isCompleting}
                                    >
                                      {isCompleting ? 'Completing...' : 'Complete'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Context after steps */}
                        {simInstanceContext && (
                          <div style={styles.simContextSection}>
                            <label style={styles.simSmallLabel}>Instance context:</label>
                            <pre style={styles.simContextPreview}>
                              {JSON.stringify(simInstanceContext, null, 2)}
                            </pre>
                          </div>
                        )}

                        {/* Result summary */}
                        {simStatus === 'complete' && (
                          <div style={styles.simResultSummary}>
                            <span style={styles.simResultIcon}>Done</span>
                            <span style={styles.simResultText}>
                              Workflow complete. {simTasks.length} step{simTasks.length !== 1 ? 's' : ''} executed.
                            </span>
                          </div>
                        )}

                        {/* Cleanup button */}
                        <button
                          style={styles.simCleanupBtn}
                          onClick={cleanupSimulation}
                          disabled={simCleaning}
                        >
                          {simCleaning ? 'Cleaning up...' : 'Cancel & Cleanup'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* ── New Workflow Modal ── */}
      {showNewModal && (
        <div style={styles.modalOverlay} onClick={() => setShowNewModal(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>New Workflow</h3>
            <div style={styles.modalField}>
              <label style={styles.fieldLabel}>Name</label>
              <input
                style={styles.modalInput}
                value={newName}
                onChange={e => {
                  setNewName(e.target.value);
                  setNewSlug(slugify(e.target.value));
                }}
                placeholder="My Workflow"
                autoFocus
              />
            </div>
            <div style={styles.modalField}>
              <label style={styles.fieldLabel}>Slug</label>
              <input
                style={styles.modalInput}
                value={newSlug}
                onChange={e => setNewSlug(e.target.value)}
                placeholder="my_workflow"
              />
              <p style={styles.modalHint}>Unique identifier. Cannot be changed after creation.</p>
            </div>
            <div style={styles.modalActions}>
              <button style={styles.cancelBtn} onClick={() => setShowNewModal(false)}>
                Cancel
              </button>
              <button
                style={styles.createBtn}
                onClick={handleCreateWorkflow}
                disabled={!newName.trim() || !newSlug.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const styles = {
  page: {
    padding: '24px 32px',
    minHeight: '100vh',
    position: 'relative',
  },

  // Toast
  toast: {
    position: 'fixed',
    top: 20,
    right: 20,
    padding: '10px 20px',
    borderRadius: 8,
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    zIndex: 9999,
    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
  },

  // Layout
  layout: {
    display: 'flex',
    gap: 24,
    minHeight: 'calc(100vh - 100px)',
  },

  // Left panel
  leftPanel: {
    width: 300,
    minWidth: 300,
    borderRight: '1px solid rgba(255,255,255,0.06)',
    paddingRight: 24,
    display: 'flex',
    flexDirection: 'column',
  },
  listHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  listTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: '#fff',
    margin: 0,
  },
  newBtn: {
    background: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  listLoading: {
    display: 'flex',
    justifyContent: 'center',
    padding: 40,
  },
  spinner: {
    width: 22,
    height: 22,
    border: '2px solid rgba(255,255,255,0.1)',
    borderTopColor: '#6366f1',
    borderRadius: '50%',
    animation: 'spin 0.6s linear infinite',
  },
  listEmpty: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 13,
    textAlign: 'center',
    padding: 20,
  },
  listItems: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  listItem: {
    padding: '10px 12px',
    borderRadius: 8,
    cursor: 'pointer',
    border: '1px solid transparent',
    transition: 'background 0.15s',
  },
  listItemSelected: {
    background: 'rgba(99,102,241,0.1)',
    border: '1px solid rgba(99,102,241,0.3)',
  },
  listItemTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  listItemName: {
    fontSize: 14,
    fontWeight: 600,
    color: '#fff',
  },
  activeDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    flexShrink: 0,
  },
  listItemBottom: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  sourceBadge: {
    fontSize: 10,
    fontWeight: 700,
    padding: '1px 6px',
    borderRadius: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  slugText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
    fontFamily: 'monospace',
  },

  // Right panel
  rightPanel: {
    flex: 1,
    minWidth: 0,
  },
  emptyCanvas: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: 400,
  },
  emptyCanvasText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 14,
  },
  canvasLoading: {
    display: 'flex',
    justifyContent: 'center',
    padding: 60,
  },

  // Canvas
  canvas: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },

  // Canvas header
  canvasHeader: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: '16px 20px',
  },
  headerFields: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 12,
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 140,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerInput: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 5,
    padding: '6px 10px',
    color: '#fff',
    fontSize: 13,
    outline: 'none',
    minWidth: 140,
  },
  headerSelect: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 5,
    padding: '6px 10px',
    color: '#fff',
    fontSize: 13,
    outline: 'none',
    minWidth: 100,
  },
  readonlyValue: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    padding: '6px 0',
  },
  headerActions: {
    display: 'flex',
    gap: 8,
    justifyContent: 'flex-end',
  },
  saveDraftBtn: {
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.7)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    padding: '7px 16px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  publishBtn: {
    background: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '7px 16px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },

  readonlyBanner: {
    background: 'rgba(234,179,8,0.08)',
    border: '1px solid rgba(234,179,8,0.2)',
    borderRadius: 8,
    padding: '10px 16px',
    fontSize: 12,
    color: '#eab308',
    fontWeight: 500,
  },

  // Step list
  stepList: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
  },

  // Connector
  connectorContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '4px 0',
    position: 'relative',
  },
  connectorLine: {
    width: 2,
    height: 24,
    background: 'rgba(99,102,241,0.3)',
  },
  connectorLabel: {
    fontSize: 10,
    fontWeight: 600,
    padding: '1px 6px',
    borderRadius: 3,
    marginTop: 2,
  },

  // Step card
  stepCard: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: '16px 20px',
  },
  stepCardFirst: {
    borderLeft: '3px solid #6366f1',
  },
  stepCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  stepIndex: {
    fontSize: 12,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.3)',
  },
  firstBadge: {
    fontSize: 9,
    fontWeight: 800,
    color: '#6366f1',
    background: 'rgba(99,102,241,0.15)',
    padding: '2px 6px',
    borderRadius: 3,
    letterSpacing: 0.5,
  },
  fanOutBadge: {
    fontSize: 9,
    fontWeight: 800,
    color: '#f59e0b',
    background: 'rgba(245,158,11,0.1)',
    padding: '2px 6px',
    borderRadius: 3,
    letterSpacing: 0.5,
  },
  fanInBadge: {
    fontSize: 9,
    fontWeight: 800,
    color: '#8b5cf6',
    background: 'rgba(139,92,246,0.1)',
    padding: '2px 6px',
    borderRadius: 3,
    letterSpacing: 0.5,
  },

  // Step fields
  stepFieldRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 8,
  },
  stepFieldLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.4)',
    minWidth: 110,
    paddingTop: 7,
    flexShrink: 0,
  },
  stepInput: {
    flex: 1,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 5,
    padding: '6px 10px',
    color: '#fff',
    fontSize: 12,
    outline: 'none',
    fontFamily: 'inherit',
  },
  stepInputFlex: {
    flex: 1,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 5,
    padding: '6px 10px',
    color: '#fff',
    fontSize: 12,
    outline: 'none',
    fontFamily: 'inherit',
  },
  stepSelectSmall: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 5,
    padding: '6px 8px',
    color: '#fff',
    fontSize: 12,
    outline: 'none',
    minWidth: 100,
  },
  stepReadonly: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    padding: '6px 0',
    fontFamily: 'monospace',
    flex: 1,
  },
  stepTextarea: {
    flex: 1,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 5,
    padding: '6px 10px',
    color: '#fff',
    fontSize: 12,
    outline: 'none',
    fontFamily: 'monospace',
    resize: 'vertical',
  },
  stepPre: {
    flex: 1,
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: 'monospace',
    margin: 0,
    padding: '6px 0',
    whiteSpace: 'pre-wrap',
  },

  // Assignee and action inline rows
  assigneeRow: {
    flex: 1,
    display: 'flex',
    gap: 8,
  },
  actionRow: {
    flex: 1,
    display: 'flex',
    gap: 8,
  },

  // Checkbox
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    paddingTop: 5,
  },
  checkboxLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },

  // Fan-out fields
  fanOutFields: {
    marginLeft: 122,
    marginBottom: 8,
    paddingLeft: 12,
    borderLeft: '2px solid rgba(245,158,11,0.2)',
  },

  // Outcomes
  outcomesSection: {
    marginTop: 8,
    padding: '10px 0 4px',
    borderTop: '1px solid rgba(255,255,255,0.04)',
  },
  outcomesSectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  addOutcomeBtn: {
    background: 'rgba(99,102,241,0.1)',
    color: '#818cf8',
    border: '1px solid rgba(99,102,241,0.2)',
    borderRadius: 4,
    padding: '3px 10px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  },
  noOutcomes: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.25)',
    fontStyle: 'italic',
    margin: '0 0 4px',
  },
  outcomeRow: {
    marginBottom: 6,
  },
  outcomeFields: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  outcomeInput: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 4,
    padding: '5px 8px',
    color: '#fff',
    fontSize: 11,
    outline: 'none',
    minWidth: 80,
    flex: 1,
  },
  outcomeSelect: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 4,
    padding: '5px 6px',
    color: '#fff',
    fontSize: 11,
    outline: 'none',
    minWidth: 70,
  },
  outcomeDeleteBtn: {
    background: 'rgba(239,68,68,0.1)',
    color: '#ef4444',
    border: '1px solid rgba(239,68,68,0.2)',
    borderRadius: 4,
    padding: '4px 8px',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    flexShrink: 0,
  },
  outcomeReadonly: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  outcomeKeyBadge: {
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: 3,
  },
  outcomeLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },
  outcomeArrow: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
    fontFamily: 'monospace',
  },

  // Delete step
  stepDeleteRow: {
    marginTop: 10,
    paddingTop: 8,
    borderTop: '1px solid rgba(255,255,255,0.04)',
    display: 'flex',
    justifyContent: 'flex-end',
  },
  deleteStepBtn: {
    background: 'none',
    color: 'rgba(239,68,68,0.6)',
    border: 'none',
    fontSize: 11,
    cursor: 'pointer',
    padding: '4px 8px',
  },
  deleteConfirm: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  deleteConfirmText: {
    fontSize: 12,
    color: '#ef4444',
    fontWeight: 600,
  },
  deleteConfirmYes: {
    background: 'rgba(239,68,68,0.15)',
    color: '#ef4444',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 4,
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  },
  deleteConfirmNo: {
    background: 'rgba(255,255,255,0.05)',
    color: 'rgba(255,255,255,0.5)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 4,
    padding: '4px 10px',
    fontSize: 11,
    cursor: 'pointer',
  },

  // Add step button
  addStepBtn: {
    marginTop: 12,
    background: 'rgba(99,102,241,0.08)',
    color: '#818cf8',
    border: '1px dashed rgba(99,102,241,0.3)',
    borderRadius: 8,
    padding: '12px 20px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'center',
  },

  // Section containers
  sectionContainer: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10,
    overflow: 'hidden',
  },
  sectionToggle: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'none',
    border: 'none',
    padding: '12px 20px',
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'left',
  },
  chevron: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.3)',
  },

  // Version list
  versionList: {
    padding: '0 20px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  noVersions: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.25)',
    fontStyle: 'italic',
    margin: 0,
  },
  versionRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    borderRadius: 6,
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.04)',
  },
  versionRowCurrent: {
    border: '1px solid rgba(99,102,241,0.3)',
    background: 'rgba(99,102,241,0.05)',
  },
  versionInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  versionNum: {
    fontSize: 13,
    fontWeight: 700,
    color: '#fff',
    fontFamily: 'monospace',
  },
  currentBadge: {
    fontSize: 9,
    fontWeight: 800,
    color: '#6366f1',
    background: 'rgba(99,102,241,0.15)',
    padding: '2px 6px',
    borderRadius: 3,
    letterSpacing: 0.5,
  },
  versionDate: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
  },
  rollbackBtn: {
    background: 'rgba(255,255,255,0.05)',
    color: 'rgba(255,255,255,0.5)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 5,
    padding: '4px 10px',
    fontSize: 11,
    cursor: 'pointer',
  },

  // Simulator
  simPanel: {
    padding: '0 20px 20px',
  },
  simConfig: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  simContextInput: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 6,
    padding: '10px 12px',
    color: '#fff',
    fontSize: 12,
    fontFamily: 'monospace',
    outline: 'none',
    resize: 'vertical',
  },
  simStartBtn: {
    background: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '10px 20px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },

  // Sim running
  simRunning: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  simStatusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '8px 12px',
    background: 'rgba(255,255,255,0.02)',
    borderRadius: 6,
  },
  simStatusLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },
  simRefreshBtn: {
    marginLeft: 'auto',
    background: 'rgba(255,255,255,0.05)',
    color: 'rgba(255,255,255,0.5)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 4,
    padding: '4px 10px',
    fontSize: 11,
    cursor: 'pointer',
  },

  // Sim timeline
  simTimeline: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  simTaskCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 8,
    padding: '12px 16px',
  },
  simTaskHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  simTaskDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  simTaskKey: {
    fontSize: 12,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.7)',
    fontFamily: 'monospace',
  },
  simTaskStatus: {
    fontSize: 10,
    fontWeight: 700,
    marginLeft: 'auto',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  simTaskTitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 4,
  },
  simTaskAssignee: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.25)',
    fontFamily: 'monospace',
  },
  simPayloadPreview: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.3)',
    fontFamily: 'monospace',
    background: 'rgba(0,0,0,0.2)',
    borderRadius: 4,
    padding: '4px 8px',
    margin: '4px 0 0',
    whiteSpace: 'pre-wrap',
    maxHeight: 80,
    overflow: 'auto',
  },

  // Sim task actions
  simTaskActions: {
    marginTop: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  simOutcomeSelector: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  simSmallLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.35)',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  simOutcomeSelect: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 4,
    padding: '4px 8px',
    color: '#fff',
    fontSize: 11,
    outline: 'none',
    flex: 1,
  },
  simPayloadEditor: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  simPayloadInput: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 4,
    padding: '6px 8px',
    color: '#fff',
    fontSize: 11,
    fontFamily: 'monospace',
    outline: 'none',
    resize: 'vertical',
  },
  simCompleteBtn: {
    background: '#22c55e',
    color: '#fff',
    border: 'none',
    borderRadius: 5,
    padding: '7px 16px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },

  // Sim context section
  simContextSection: {
    marginTop: 4,
  },
  simContextPreview: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.3)',
    fontFamily: 'monospace',
    background: 'rgba(0,0,0,0.2)',
    borderRadius: 4,
    padding: '8px 10px',
    margin: '4px 0 0',
    whiteSpace: 'pre-wrap',
    maxHeight: 150,
    overflow: 'auto',
  },

  // Sim result
  simResultSummary: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    background: 'rgba(34,197,94,0.08)',
    border: '1px solid rgba(34,197,94,0.2)',
    borderRadius: 6,
  },
  simResultIcon: {
    fontSize: 12,
    fontWeight: 800,
    color: '#22c55e',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  simResultText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },

  // Sim cleanup
  simCleanupBtn: {
    background: 'rgba(239,68,68,0.1)',
    color: '#ef4444',
    border: '1px solid rgba(239,68,68,0.2)',
    borderRadius: 6,
    padding: '8px 16px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },

  // Modal
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#1a1a2e',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: '24px 28px',
    width: 420,
    maxWidth: '90vw',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: '#fff',
    margin: '0 0 16px',
  },
  modalField: {
    marginBottom: 14,
  },
  modalInput: {
    width: '100%',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    padding: '8px 12px',
    color: '#fff',
    fontSize: 14,
    outline: 'none',
    marginTop: 4,
    boxSizing: 'border-box',
  },
  modalHint: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
    margin: '4px 0 0',
    fontStyle: 'italic',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 20,
  },
  cancelBtn: {
    background: 'rgba(255,255,255,0.05)',
    color: 'rgba(255,255,255,0.6)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    padding: '8px 16px',
    fontSize: 13,
    cursor: 'pointer',
  },
  createBtn: {
    background: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
};

// ─── Picker / friendly-UX styles ─────────────────────────────

const pickerStyles = {
  // Profile picker dropdown
  trigger: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 10px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: '#fff',
    fontSize: 13,
    cursor: 'pointer',
    textAlign: 'left',
  },
  name: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 500,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  roleBadge: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    padding: '2px 6px',
    borderRadius: 3,
    background: 'rgba(99,102,241,0.18)',
    color: '#a5b4fc',
  },
  placeholder: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
    flex: 1,
  },
  chevron: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 9,
  },
  menu: {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    left: 0,
    right: 0,
    background: '#1a1a2a',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    zIndex: 100,
    overflow: 'hidden',
    minWidth: 240,
  },
  searchInput: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '8px 10px',
    background: 'rgba(255,255,255,0.04)',
    border: 'none',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    color: '#fff',
    fontSize: 13,
    outline: 'none',
  },
  optionList: {
    maxHeight: 260,
    overflowY: 'auto',
  },
  option: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 10px',
    cursor: 'pointer',
    fontSize: 13,
    color: '#fff',
  },
  optionActive: {
    background: 'rgba(99,102,241,0.15)',
  },
  emptyOption: {
    padding: '12px 10px',
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    textAlign: 'center',
  },

  // Context key dropdown
  contextSelect: {
    flex: 1,
    padding: '8px 10px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: '#fff',
    fontSize: 13,
  },

  // Variable insert chip
  varChip: {
    padding: '4px 8px',
    background: 'rgba(99,102,241,0.12)',
    border: '1px solid rgba(99,102,241,0.3)',
    borderRadius: 4,
    color: '#a5b4fc',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'monospace',
    whiteSpace: 'nowrap',
  },
  varHeader: {
    padding: '8px 10px',
    fontSize: 10,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  varLabel: {
    fontSize: 13,
    color: '#fff',
  },
  varScope: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: 'monospace',
  },

  // Trigger mode + sentence
  triggerModeRow: {
    display: 'flex',
    gap: 6,
    marginBottom: 10,
  },
  triggerModeBtn: {
    padding: '6px 12px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
  },
  triggerModeBtnActive: {
    background: 'rgba(99,102,241,0.18)',
    borderColor: 'rgba(99,102,241,0.5)',
    color: '#a5b4fc',
  },
  triggerSentence: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 6,
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
  },
  triggerWord: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
  },
  inlineSelect: {
    padding: '4px 8px',
    background: 'rgba(99,102,241,0.1)',
    border: '1px solid rgba(99,102,241,0.3)',
    borderRadius: 5,
    color: '#fff',
    fontSize: 13,
  },
  triggerPreview: {
    marginTop: 6,
    padding: '6px 10px',
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    fontStyle: 'italic',
  },

  // Action editor
  actionTypeRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  actionTypeBtn: {
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
  },
  actionTypeBtnActive: {
    background: 'rgba(99,102,241,0.18)',
    borderColor: 'rgba(99,102,241,0.5)',
    color: '#a5b4fc',
  },
  actionTypeDesc: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 10,
    fontStyle: 'italic',
  },
  actionSubRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  actionSubLabel: {
    minWidth: 100,
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
  },
  actionInput: {
    flex: 1,
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 5,
    color: '#fff',
    fontSize: 12,
  },
  handlerHint: {
    marginTop: 6,
    padding: '6px 10px',
    background: 'rgba(34,197,94,0.06)',
    border: '1px solid rgba(34,197,94,0.15)',
    borderRadius: 5,
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
    fontStyle: 'italic',
  },

  // Fan-out
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    cursor: 'pointer',
  },
  checkboxLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
  },
  fanOutInner: {
    marginTop: 10,
    paddingLeft: 24,
    borderLeft: '2px solid rgba(99,102,241,0.3)',
  },
  fanOutPreview: {
    marginTop: 8,
    padding: '8px 10px',
    background: 'rgba(99,102,241,0.08)',
    borderRadius: 6,
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
  },

  // Deps
  depsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  depsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 8px',
    background: 'rgba(255,255,255,0.02)',
    borderRadius: 5,
    cursor: 'pointer',
    fontSize: 12,
  },
  depsKey: {
    color: 'rgba(255,255,255,0.5)',
    fontFamily: 'monospace',
    fontSize: 11,
  },
  depsTitle: {
    color: '#fff',
    flex: 1,
  },
  depsEmpty: {
    padding: '8px 10px',
    fontSize: 12,
    color: 'rgba(255,255,255,0.35)',
    fontStyle: 'italic',
  },

  // Condition
  conditionRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  conditionSelect: {
    flex: 1,
    minWidth: 140,
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 5,
    color: '#fff',
    fontSize: 12,
  },
  conditionInput: {
    flex: 1,
    minWidth: 100,
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 5,
    color: '#fff',
    fontSize: 12,
  },

  // Template input + chip wrapper
  templateWrap: {
    display: 'flex',
    gap: 6,
    alignItems: 'stretch',
    width: '100%',
  },
  templateInput: {
    flex: 1,
    padding: '8px 10px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: '#fff',
    fontSize: 13,
    minWidth: 0,
  },
  templateTextarea: {
    flex: 1,
    padding: '8px 10px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: '#fff',
    fontSize: 13,
    fontFamily: 'inherit',
    resize: 'vertical',
    minWidth: 0,
  },

  // Advanced collapsible
  advancedBlock: {
    marginTop: 8,
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.02)',
    borderRadius: 5,
  },
  advancedSummary: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    cursor: 'pointer',
    userSelect: 'none',
  },

  // Outcome card
  outcomeCard: {
    padding: 10,
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 8,
    marginBottom: 8,
  },
  outcomeTopRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    marginBottom: 8,
  },
  outcomeLabelInput: {
    flex: 1,
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 5,
    color: '#fff',
    fontSize: 13,
    fontWeight: 500,
  },
  outcomeStylePills: {
    display: 'flex',
    gap: 6,
    marginBottom: 8,
  },
  stylePill: {
    padding: '4px 10px',
    border: '1px solid',
    borderRadius: 12,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  },
  outcomeNextRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  outcomeNextLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
  },
  outcomeNextSelect: {
    flex: 1,
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 5,
    color: '#fff',
    fontSize: 12,
  },
};
