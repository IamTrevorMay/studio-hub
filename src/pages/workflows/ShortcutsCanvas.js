import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ACTION_TYPES_FRIENDLY,
  NAVIGATE_TARGETS,
  TRIGGER_ENTITIES,
  TRIGGER_EVENTS,
  OUTCOME_STYLES_FRIENDLY,
  CONDITION_OPS,
  parseConditionExpression,
  buildConditionExpression,
  lookupActionType,
  lookupEntity,
  lookupEvent,
} from '../../lib/workflowCatalog';
import { listWorkflowModals } from '../../lib/workflowModals';
import backdropDismiss from '../../lib/backdropDismiss';
import { clickableKeyProps } from '../../lib/styleRecipes';
import { colors } from '../../lib/styleTokens';

// ─── Visual tokens ──────────────────────────────────────────

const CATEGORY = {
  task:    { fill: 'linear-gradient(180deg, rgba(91, 143, 199,0.18), rgba(91, 143, 199,0.10))', border: 'rgba(91, 143, 199,0.35)', icon: '👤', label: 'Person task' },
  page:    { fill: 'linear-gradient(180deg, rgba(34,197,94,0.18), rgba(34,197,94,0.10))', border: 'rgba(34,197,94,0.35)', icon: '🌐', label: 'Open page' },
  form:    { fill: 'linear-gradient(180deg, rgba(56,189,248,0.18), rgba(56,189,248,0.10))', border: 'rgba(56,189,248,0.35)', icon: '📋', label: 'Open form' },
  custom:  { fill: 'linear-gradient(180deg, rgba(168,85,247,0.18), rgba(168,85,247,0.10))', border: 'rgba(168,85,247,0.35)', icon: '⚙️', label: 'Custom logic' },
  repeat:  { fill: 'linear-gradient(180deg, rgba(20,184,166,0.18), rgba(20,184,166,0.10))', border: 'rgba(20,184,166,0.35)', icon: '🔁', label: 'Repeat' },
  branch:  { fill: 'linear-gradient(180deg, rgba(234,179,8,0.18), rgba(234,179,8,0.10))', border: 'rgba(234,179,8,0.35)', icon: '🌳', label: 'Branch' },
  trigger: { fill: 'linear-gradient(180deg, rgba(239,68,68,0.14), rgba(239,68,68,0.08))', border: 'rgba(239,68,68,0.3)', icon: '⚡', label: 'Trigger' },
};

const PILL_COLORS = {
  person:   { bg: 'rgba(91, 143, 199,0.22)',  fg: '#8fb4d8', border: 'rgba(91, 143, 199,0.5)' },
  action:   { bg: 'rgba(168,85,247,0.22)',  fg: '#d8b4fe', border: 'rgba(168,85,247,0.5)' },
  variable: { bg: 'rgba(234,179,8,0.22)',   fg: '#fde68a', border: 'rgba(234,179,8,0.5)' },
  page:     { bg: 'rgba(34,197,94,0.22)',   fg: '#86efac', border: 'rgba(34,197,94,0.5)' },
  form:     { bg: 'rgba(56,189,248,0.22)',  fg: '#7dd3fc', border: 'rgba(56,189,248,0.5)' },
  repeat:   { bg: 'rgba(20,184,166,0.22)',  fg: '#5eead4', border: 'rgba(20,184,166,0.5)' },
  outcome:  { bg: 'rgba(255,255,255,0.06)', fg: 'rgba(255,255,255,0.85)', border: 'rgba(255,255,255,0.15)' },
  value:    { bg: 'rgba(255,255,255,0.08)', fg: '#fff', border: 'rgba(255,255,255,0.2)' },
};

function categoryForStep(step) {
  if (step.fan_out_context_key !== null && step.fan_out_context_key !== undefined) return 'repeat';
  switch (step.action_type) {
    case 'navigate': return 'page';
    case 'modal': return 'form';
    case 'custom': return 'custom';
    default: return 'task';
  }
}

// ─── Plain-language block summary ("When/if … then …") ──────
// Read-only sentence derived from the block's own config: who it's for, any
// condition gating it, what they do, and where the flow goes next.

function humanizeKey(key) {
  return (key || '').replace(/_id$/, '').replace(/_/g, ' ').trim();
}

function assigneePhrase(step, profiles) {
  if (step.assignee_type === 'context') {
    const k = humanizeKey(step.assignee_value) || 'someone';
    return `the ${k}`;
  }
  const p = (profiles || []).find((x) => x.id === step.assignee_value);
  return p ? (p.full_name || 'the assignee') : 'the assignee';
}

function actionPhrase(step) {
  const cfg = step.action_config || {};
  switch (step.action_type) {
    case 'navigate': {
      const t = NAVIGATE_TARGETS.find((x) => x.value === cfg.tab);
      return `does the work on ${t ? t.label : 'a page'}`;
    }
    case 'modal':
      return 'fills out a form';
    case 'custom':
      if (cfg.inline_editor_picker) return 'picks an editor (auto-completes once their assignment is created)';
      if (cfg.auto_complete_on_assignment_done) return 'waits — auto-completes when the editor finishes their assignment';
      return step.action_label ? `runs “${step.action_label}”` : 'runs custom logic';
    case 'complete':
    default:
      return 'completes it';
  }
}

function conditionText(step) {
  const c = parseConditionExpression(step.condition_expression);
  if (!c || c.op === 'always') return '';
  const key = humanizeKey(c.key);
  if (!key) return '';
  if (c.op === 'has') return `${key} exists`;
  if (c.op === 'eq') return `${key} is “${c.value}”`;
  return `${key} is set`;
}

function stepTitleLabel(stepKey, allSteps) {
  const s = (allSteps || []).find((x) => x.step_key === stepKey);
  if (!s) return `the ${stepKey} step`;
  if (s.name && s.name.trim()) return `“${s.name.trim()}”`;
  const t = (s.title_template || '').replace(/\{\{(\w+)\}\}/g, '…').trim();
  return t ? `“${t}”` : `the ${stepKey} step`;
}

function nextPhrase(outcomes, allSteps) {
  const outs = (outcomes || []).filter(Boolean);
  const linked = outs.filter((o) => o.next_step_key);
  if (linked.length === 0) return 'the workflow ends';
  if (outs.length <= 1) return `go to ${stepTitleLabel(linked[0].next_step_key, allSteps)}`;
  const parts = outs.map((o) => {
    const dest = o.next_step_key ? stepTitleLabel(o.next_step_key, allSteps) : 'end';
    return `${o.label || o.outcome_key} → ${dest}`;
  });
  return `branch — ${parts.join('; ')}`;
}

function describeStep(step, outcomes, allSteps, profiles, isFirst) {
  const who = assigneePhrase(step, profiles);
  const act = actionPhrase(step);
  const next = nextPhrase(outcomes, allSteps);
  const cond = conditionText(step);
  if (cond) {
    return `If ${cond}, ${who} ${act}, then ${next}.`;
  }
  if (isFirst) {
    return `When this workflow is triggered, ${who} ${act}, then ${next}.`;
  }
  return `When ${who} ${act}, then ${next}.`;
}

// ─── Tree builder ───────────────────────────────────────────

function buildTree(steps, outcomesByStepId, firstStepKey) {
  const stepByKey = new Map();
  const idByKey = new Map();
  for (const s of steps) {
    if (!s.step_key) continue;
    stepByKey.set(s.step_key, s);
    idByKey.set(s.step_key, s.id);
  }
  const visited = new Set();

  function nodeFor(stepKey) {
    if (!stepKey || !stepByKey.has(stepKey) || visited.has(stepKey)) return null;
    visited.add(stepKey);
    const step = stepByKey.get(stepKey);
    const outs = (outcomesByStepId[step.id] || []).slice().sort((a, b) => a.position - b.position);
    const isBranching = outs.length > 1;
    let children = [];
    if (!isBranching) {
      const onlyOut = outs[0];
      if (onlyOut?.next_step_key) {
        const child = nodeFor(onlyOut.next_step_key);
        if (child) children.push(child);
      }
    }
    return {
      step,
      outcomes: outs,
      isBranching,
      branches: isBranching
        ? outs.map((o) => ({ outcome: o, child: o.next_step_key ? nodeFor(o.next_step_key) : null }))
        : [],
      children,
    };
  }

  const rootKey = firstStepKey || (steps[0]?.step_key);
  const root = rootKey ? nodeFor(rootKey) : null;
  // Orphan steps not reached from root
  const orphans = [];
  for (const s of steps) {
    if (!s.step_key) continue;
    if (!visited.has(s.step_key)) {
      const orphan = nodeFor(s.step_key);
      if (orphan) orphans.push(orphan);
    }
  }
  return { root, orphans };
}

// ─── Generic popover wrapper ────────────────────────────────

function useOutsideClose(open, setOpen, ref) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open, setOpen, ref]);
}

function Pill({ kind = 'value', label, placeholder, onClick, disabled, icon, title }) {
  const c = PILL_COLORS[kind] || PILL_COLORS.value;
  const isEmpty = !label;
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 10px',
        borderRadius: 999,
        background: isEmpty ? 'rgba(255,255,255,0.03)' : c.bg,
        border: `1px solid ${isEmpty ? 'rgba(255,255,255,0.18)' : c.border}`,
        color: isEmpty ? 'rgba(255,255,255,0.5)' : c.fg,
        fontSize: 13,
        fontWeight: 500,
        cursor: disabled ? 'default' : 'pointer',
        margin: '0 3px',
        whiteSpace: 'nowrap',
        lineHeight: 1.4,
        verticalAlign: 'middle',
      }}
    >
      {icon && <span style={{ fontSize: 12 }}>{icon}</span>}
      <span>{label || placeholder}</span>
      {!disabled && <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>}
    </button>
  );
}

function Popover({ open, setOpen, anchor, children, width = 280 }) {
  const ref = useRef(null);
  useOutsideClose(open, setOpen, ref);
  if (!open) return null;
  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        marginTop: 6,
        background: colors.bgHover,
        border: '1px solid rgba(255,255,255,0.14)',
        borderRadius: 10,
        boxShadow: '0 10px 32px rgba(0,0,0,0.55)',
        padding: 8,
        zIndex: 200,
        minWidth: width,
      }}
    >
      {children}
    </div>
  );
}

// ─── Editor popovers ────────────────────────────────────────

function PersonEditor({ step, profiles, contextKeys, onUpdate, disabled }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const current = step.assignee_type === 'static'
    ? profiles.find((p) => p.id === step.assignee_value)
    : null;
  const label = current
    ? current.name
    : step.assignee_type === 'context' && step.assignee_value
      ? `from {{${step.assignee_value}}}`
      : null;

  return (
    <span ref={wrap} style={{ position: 'relative', display: 'inline-block' }}>
      <Pill
        kind="person"
        icon="👤"
        label={label}
        placeholder="Pick a person"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
      />
      <Popover open={open} setOpen={setOpen} anchor={wrap}>
        <div style={popStyles.tabRow}>
          <button
            type="button"
            onClick={() => onUpdate({ assignee_type: 'static', assignee_value: '' })}
            style={{ ...popStyles.tabBtn, ...(step.assignee_type === 'static' ? popStyles.tabBtnActive : {}) }}
          >
            A specific person
          </button>
          <button
            type="button"
            onClick={() => onUpdate({ assignee_type: 'context', assignee_value: '' })}
            style={{ ...popStyles.tabBtn, ...(step.assignee_type === 'context' ? popStyles.tabBtnActive : {}) }}
          >
            From data
          </button>
        </div>
        {step.assignee_type === 'static' ? (
          <PersonSearch
            profiles={profiles}
            value={step.assignee_value}
            onChange={(id) => { onUpdate({ assignee_value: id }); setOpen(false); }}
          />
        ) : (
          <VarList
            contextKeys={contextKeys}
            value={step.assignee_value}
            onChange={(k) => { onUpdate({ assignee_value: k }); setOpen(false); }}
          />
        )}
      </Popover>
    </span>
  );
}

function PersonSearch({ profiles, value, onChange }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return profiles;
    return profiles.filter((p) => p.name.toLowerCase().includes(s) || (p.role || '').toLowerCase().includes(s));
  }, [profiles, q]);
  return (
    <div>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search…"
        style={popStyles.search}
      />
      <div style={popStyles.list}>
        {filtered.length === 0 ? (
          <div style={popStyles.empty}>No matches</div>
        ) : filtered.map((p) => (
          <div
            key={p.id}
            onClick={() => onChange(p.id)}
            style={{ ...popStyles.row, ...(p.id === value ? popStyles.rowActive : {}) }}
          >
            <span style={{ flex: 1, color: '#fff' }}>{p.name}</span>
            <span style={popStyles.roleBadge}>{p.role}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function VarList({ contextKeys, value, onChange, filter }) {
  const list = filter ? contextKeys.filter(filter) : contextKeys;
  return (
    <div style={popStyles.list}>
      {list.length === 0 ? (
        <div style={popStyles.empty}>No variables available</div>
      ) : list.map((k) => (
        <div
          key={k.key}
          onClick={() => onChange(k.key)}
          style={{ ...popStyles.row, ...(k.key === value ? popStyles.rowActive : {}) }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ color: '#fff', fontSize: 13 }}>{k.label}</div>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontFamily: 'monospace' }}>
              {`{{${k.key}}}`}{k.scope ? ` • ${k.scope}` : ''}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ActionEditorPill({ step, actionHandlers, onUpdate, disabled }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const friendly = lookupActionType(step.action_type) || ACTION_TYPES_FRIENDLY[0];
  const config = step.action_config || {};

  let detail = friendly.label;
  if (step.action_type === 'navigate' && config.tab) {
    const t = NAVIGATE_TARGETS.find((n) => n.value === config.tab);
    detail = `Open ${t?.label || config.tab}`;
  } else if (step.action_type === 'modal' && config.modalKey) {
    detail = `Open form: ${config.modalKey}`;
  } else if (step.action_type === 'custom' && step.on_complete_handler) {
    detail = `Run ${step.on_complete_handler}`;
  }

  return (
    <span ref={wrap} style={{ position: 'relative', display: 'inline-block' }}>
      <Pill
        kind="action"
        icon={friendly.value === 'navigate' ? '🌐' : friendly.value === 'modal' ? '📋' : friendly.value === 'custom' ? '⚙️' : '✓'}
        label={detail}
        placeholder="Pick an action"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
      />
      <Popover open={open} setOpen={setOpen} anchor={wrap} width={320}>
        <div style={popStyles.header}>How does the assignee finish?</div>
        <div style={popStyles.actionTypeCol}>
          {ACTION_TYPES_FRIENDLY.map((t) => (
            <div
              key={t.value}
              onClick={() => onUpdate({ action_type: t.value, action_config: {} })}
              style={{ ...popStyles.actionTypeRow, ...(step.action_type === t.value ? popStyles.rowActive : {}) }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{t.label}</div>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>{t.description}</div>
              </div>
              {step.action_type === t.value && <span style={{ color: colors.accentFg }}>✓</span>}
            </div>
          ))}
        </div>
        <div style={popStyles.divider} />
        <div style={popStyles.subRow}>
          <label style={popStyles.subLabel}>Button label</label>
          <input
            value={step.action_label || ''}
            onChange={(e) => onUpdate({ action_label: e.target.value })}
            placeholder="e.g. Mark Complete"
            style={popStyles.subInput}
          />
        </div>
        {step.action_type === 'navigate' && (
          <div style={popStyles.subRow}>
            <label style={popStyles.subLabel}>Open page</label>
            <select
              value={config.tab || ''}
              onChange={(e) => onUpdate({ action_config: { ...config, tab: e.target.value } })}
              style={popStyles.subInput}
            >
              <option value="">— pick a page —</option>
              {NAVIGATE_TARGETS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        )}
        {step.action_type === 'modal' && (() => {
          const modals = listWorkflowModals();
          const current = modals.find((m) => m.key === config.modalKey);
          return (
            <>
              <div style={popStyles.subRow}>
                <label style={popStyles.subLabel}>Form</label>
                <select
                  value={config.modalKey || ''}
                  onChange={(e) => onUpdate({ action_config: { ...config, modalKey: e.target.value } })}
                  style={popStyles.subInput}
                >
                  <option value="">— pick a form —</option>
                  {modals.map((m) => (
                    <option key={m.key} value={m.key}>{m.key}</option>
                  ))}
                </select>
              </div>
              {current && (
                <div style={popStyles.hint}>{current.description}</div>
              )}
            </>
          );
        })()}
        {step.action_type === 'custom' && (
          <>
            <div style={popStyles.subRow}>
              <label style={popStyles.subLabel}>Logic</label>
              <select
                value={step.on_complete_handler || ''}
                onChange={(e) => onUpdate({ on_complete_handler: e.target.value || null })}
                style={popStyles.subInput}
              >
                <option value="">— pick a handler —</option>
                {actionHandlers.map((h) => (
                  <option key={h.slug} value={h.slug}>{h.slug}</option>
                ))}
              </select>
            </div>
            {step.on_complete_handler && (
              <div style={popStyles.hint}>
                {actionHandlers.find((h) => h.slug === step.on_complete_handler)?.description || ''}
              </div>
            )}
          </>
        )}
      </Popover>
    </span>
  );
}

function TemplateSentence({ template, contextKeys, onChange, disabled }) {
  // Renders a string with {{x}} as variable pills; non-variable spans are inline-editable text.
  // For simplicity, we offer one combined editable area + "+ variable" pill.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(template || '');
  useEffect(() => { if (!editing) setDraft(template || ''); }, [template, editing]);

  if (editing) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { onChange(draft); setEditing(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { onChange(draft); setEditing(false); } if (e.key === 'Escape') { setEditing(false); } }}
          placeholder="What does the assignee see?"
          style={popStyles.inlineEditInput}
        />
      </span>
    );
  }

  if (!template) {
    return (
      <Pill
        kind="value"
        icon="✏️"
        label={null}
        placeholder="Add a title"
        onClick={() => setEditing(true)}
        disabled={disabled}
      />
    );
  }

  // Render template with {{x}} as variable pills inline.
  const parts = [];
  const re = /\{\{(\w+)\}\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(template)) !== null) {
    if (m.index > last) parts.push({ type: 'text', text: template.slice(last, m.index) });
    parts.push({ type: 'var', key: m[1] });
    last = re.lastIndex;
  }
  if (last < template.length) parts.push({ type: 'text', text: template.slice(last) });

  return (
    <span
      onClick={() => !disabled && setEditing(true)}
      style={{ cursor: disabled ? 'default' : 'text', display: 'inline' }}
    >
      {parts.map((p, i) => p.type === 'text' ? (
        <span key={i} style={{ color: '#fff', fontSize: 14 }}>{p.text}</span>
      ) : (
        <span key={i} style={{
          display: 'inline-block',
          padding: '1px 8px',
          margin: '0 2px',
          borderRadius: 6,
          background: PILL_COLORS.variable.bg,
          color: PILL_COLORS.variable.fg,
          border: `1px solid ${PILL_COLORS.variable.border}`,
          fontSize: 12,
          fontWeight: 500,
          fontFamily: 'system-ui',
        }}>
          {contextKeys.find((k) => k.key === p.key)?.label || p.key}
        </span>
      ))}
    </span>
  );
}

function VariableInsertChip({ contextKeys, onInsert }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  return (
    <span ref={wrap} style={{ position: 'relative', display: 'inline-block' }}>
      <Pill
        kind="variable"
        icon="{ }"
        label={null}
        placeholder="Insert variable"
        onClick={() => setOpen((v) => !v)}
      />
      <Popover open={open} setOpen={setOpen} anchor={wrap}>
        <div style={popStyles.header}>Insert a variable</div>
        <VarList
          contextKeys={contextKeys}
          value=""
          onChange={(k) => { onInsert(`{{${k}}}`); setOpen(false); }}
        />
      </Popover>
    </span>
  );
}

// ─── Condition pill ─────────────────────────────────────────

function ConditionPill({ step, contextKeys, onUpdate, disabled }) {
  const parsed = parseConditionExpression(step.condition_expression);
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  if (parsed.op === 'always') return null;
  const opLabel = CONDITION_OPS.find((o) => o.value === parsed.op)?.label || parsed.op;
  const keyLabel = contextKeys.find((k) => k.key === parsed.key)?.label || parsed.key;
  const summary = `${opLabel}: ${keyLabel || '?'}${parsed.op === 'eq' ? ` = "${parsed.value}"` : ''}`;
  return (
    <span ref={wrap} style={{ position: 'relative', display: 'inline-block', marginLeft: 6 }}>
      <Pill
        kind="outcome"
        icon="❓"
        label={summary}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
      />
      <Popover open={open} setOpen={setOpen} anchor={wrap}>
        <div style={popStyles.header}>When should this step run?</div>
        <div style={popStyles.subRow}>
          <select
            value={parsed.op}
            onChange={(e) => {
              const merged = { ...parsed, op: e.target.value };
              onUpdate({ condition_expression: buildConditionExpression(merged) });
            }}
            style={popStyles.subInput}
          >
            {CONDITION_OPS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        {parsed.op !== 'always' && (
          <div style={popStyles.subRow}>
            <select
              value={parsed.key}
              onChange={(e) => {
                const merged = { ...parsed, key: e.target.value };
                onUpdate({ condition_expression: buildConditionExpression(merged) });
              }}
              style={popStyles.subInput}
            >
              <option value="">— pick a variable —</option>
              {contextKeys.map((k) => (
                <option key={k.key} value={k.key}>{k.label}</option>
              ))}
            </select>
          </div>
        )}
        {parsed.op === 'eq' && (
          <div style={popStyles.subRow}>
            <input
              value={parsed.value}
              onChange={(e) => {
                const merged = { ...parsed, value: e.target.value };
                onUpdate({ condition_expression: buildConditionExpression(merged) });
              }}
              placeholder="value"
              style={popStyles.subInput}
            />
          </div>
        )}
      </Popover>
    </span>
  );
}

// ─── Fan-out target editor (used inside Repeat wrapper) ─────

function RepeatTargetPill({ step, contextKeys, onUpdate, disabled }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const arrayKeys = contextKeys.filter((k) => k.isArray || k.scope === 'root');
  const currentMeta = contextKeys.find((k) => k.key === step.fan_out_context_key);
  return (
    <span ref={wrap} style={{ position: 'relative', display: 'inline-block' }}>
      <Pill
        kind="repeat"
        icon="🔁"
        label={currentMeta?.label || null}
        placeholder="Pick a list"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
      />
      <Popover open={open} setOpen={setOpen} anchor={wrap}>
        <div style={popStyles.header}>Repeat for each…</div>
        <VarList
          contextKeys={arrayKeys}
          value={step.fan_out_context_key}
          onChange={(k) => { onUpdate({ fan_out_context_key: k }); setOpen(false); }}
        />
        <div style={popStyles.divider} />
        <div style={popStyles.subRow}>
          <label style={popStyles.subLabel}>Call each one</label>
          <input
            value={step.fan_out_entity_type || ''}
            onChange={(e) => onUpdate({ fan_out_entity_type: e.target.value })}
            placeholder="e.g. deliverable"
            style={popStyles.subInput}
          />
        </div>
        <div style={popStyles.subRow}>
          <label style={popStyles.subLabel}>Per-item title</label>
          <input
            value={step.fan_out_title_template || ''}
            onChange={(e) => onUpdate({ fan_out_title_template: e.target.value })}
            placeholder="e.g. Write ad read: {{title}}"
            style={popStyles.subInput}
          />
        </div>
        <div style={popStyles.subRow}>
          <label style={popStyles.subLabel}>ID field</label>
          <input
            value={step.fan_out_entity_id_key || 'id'}
            onChange={(e) => onUpdate({ fan_out_entity_id_key: e.target.value })}
            placeholder="id"
            style={popStyles.subInput}
          />
        </div>
      </Popover>
    </span>
  );
}

// ─── Dependencies pill ──────────────────────────────────────

function DepsPill({ step, allSteps, onUpdate, disabled }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const others = allSteps.filter((s) => s.step_key && s.step_key !== step.step_key && s.position < step.position);
  const selected = new Set(step.depends_on_step_keys || []);
  if (others.length === 0 && selected.size === 0) return null;
  const label = selected.size > 0
    ? `Wait for ${selected.size} step${selected.size === 1 ? '' : 's'}`
    : 'Wait for…';
  return (
    <span ref={wrap} style={{ position: 'relative', display: 'inline-block', marginLeft: 6 }}>
      <Pill
        kind="outcome"
        icon="⏳"
        label={label}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
      />
      <Popover open={open} setOpen={setOpen} anchor={wrap}>
        <div style={popStyles.header}>Wait for these to finish first</div>
        <div style={popStyles.list}>
          {others.map((s) => {
            const checked = selected.has(s.step_key);
            return (
              <label key={s.id} style={popStyles.checkRow}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(s.step_key); else next.delete(s.step_key);
                    onUpdate({ depends_on_step_keys: Array.from(next) });
                  }}
                />
                <span style={{ color: '#fff', fontSize: 13 }}>{s.title_template || s.step_key}</span>
              </label>
            );
          })}
        </div>
      </Popover>
    </span>
  );
}

// ─── Single step card ───────────────────────────────────────

function StepCard({
  step,
  index,
  profiles,
  contextKeys,
  actionHandlers,
  allSteps,
  stepOutcomes,
  disabled,
  onUpdate,
  onDelete,
  onSetAsFirst,
  isFirst,
}) {
  const category = categoryForStep(step);
  const summary = describeStep(step, stepOutcomes, allSteps, profiles, isFirst);
  const visual = CATEGORY[category];
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  useOutsideClose(menuOpen, setMenuOpen, menuRef);

  // Insert {{x}} into title_template at end
  const insertIntoTitle = (text) => {
    onUpdate({ title_template: (step.title_template || '') + ' ' + text });
  };

  return (
    <div style={{
      background: visual.fill,
      border: `1px solid ${visual.border}`,
      borderRadius: 14,
      padding: '14px 16px',
      boxShadow: '0 1px 0 rgba(255,255,255,0.04) inset, 0 4px 14px rgba(0,0,0,0.25)',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
        <span style={{ fontSize: 16 }}>{visual.icon}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
          {index !== undefined ? `${index}. ` : ''}{visual.label}
        </span>
        {isFirst && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: 'rgba(34,197,94,0.18)', color: '#86efac', letterSpacing: 0.5 }}>START</span>
        )}
        <span style={{ flex: 1 }} />
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setMenuOpen((v) => !v)}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 18, cursor: 'pointer', padding: 0, lineHeight: 1 }}
          >⋯</button>
          {menuOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 4,
              background: colors.bgHover, border: '1px solid rgba(255,255,255,0.14)',
              borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 200, minWidth: 180,
            }}>
              {!isFirst && (
                <div {...clickableKeyProps(() => { onSetAsFirst(); setMenuOpen(false); })} style={popStyles.menuItem} onClick={() => { onSetAsFirst(); setMenuOpen(false); }}>Set as starting step</div>
              )}
              <div {...clickableKeyProps(() => { onDelete(); setMenuOpen(false); })} style={popStyles.menuItem} onClick={() => { onDelete(); setMenuOpen(false); }}>
                <span style={{ color: '#fca5a5' }}>Delete step</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Editable step name */}
      <input
        type="text"
        value={step.name || ''}
        disabled={disabled}
        onChange={(e) => onUpdate({ name: e.target.value })}
        placeholder="Name this step…"
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          color: '#fff',
          fontSize: 16,
          fontWeight: 700,
          padding: '2px 0 6px',
          outline: 'none',
        }}
      />

      {/* Plain-language summary */}
      <div style={{
        fontSize: 12.5,
        lineHeight: 1.5,
        color: 'rgba(255,255,255,0.62)',
        fontStyle: 'italic',
        background: 'rgba(0,0,0,0.14)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: 8,
        padding: '7px 10px',
      }}>
        {summary}
      </div>

      {/* Sentence */}
      <div style={{ lineHeight: 1.8, fontSize: 14, color: 'rgba(255,255,255,0.85)' }}>
        <span>Ask </span>
        <PersonEditor
          step={step}
          profiles={profiles}
          contextKeys={contextKeys}
          onUpdate={onUpdate}
          disabled={disabled}
        />
        <span> to </span>
        <ActionEditorPill
          step={step}
          actionHandlers={actionHandlers}
          onUpdate={onUpdate}
          disabled={disabled}
        />
        <span>.</span>
        <ConditionPill step={step} contextKeys={contextKeys} onUpdate={onUpdate} disabled={disabled} />
        <DepsPill step={step} allSteps={allSteps} onUpdate={onUpdate} disabled={disabled} />
      </div>

      {/* Title sentence */}
      <div style={{
        background: 'rgba(0,0,0,0.18)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 10,
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
      }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginRight: 6, fontWeight: 600, letterSpacing: 0.4 }}>SHOWS UP AS</span>
        <TemplateSentence
          template={step.title_template}
          contextKeys={contextKeys}
          onChange={(v) => onUpdate({ title_template: v })}
          disabled={disabled}
        />
        {!disabled && (
          <VariableInsertChip contextKeys={contextKeys} onInsert={insertIntoTitle} />
        )}
      </div>
    </div>
  );
}

// ─── Repeat wrapper ─────────────────────────────────────────

function RepeatBlock({ step, contextKeys, onUpdate, disabled, children }) {
  const category = CATEGORY.repeat;
  return (
    <div style={{
      background: category.fill,
      border: `1px dashed ${category.border}`,
      borderRadius: 14,
      padding: '10px 12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>{category.icon}</span>
        <span style={{ fontSize: 13, color: '#5eead4', fontWeight: 600 }}>Repeat for each</span>
        <RepeatTargetPill step={step} contextKeys={contextKeys} onUpdate={onUpdate} disabled={disabled} />
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>:</span>
      </div>
      <div style={{ paddingLeft: 14, borderLeft: `2px dashed ${category.border}` }}>
        {children}
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: 600, letterSpacing: 0.4 }}>END REPEAT</div>
    </div>
  );
}

// ─── Branch block ───────────────────────────────────────────

function BranchBlock({ outcome, children, parentStep, allSteps, onUpdateOutcome, onDeleteOutcome, disabled }) {
  const style = OUTCOME_STYLES_FRIENDLY.find((s) => s.value === (outcome.style || 'default'));
  const color = style?.color || 'rgba(255,255,255,0.5)';
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 14, color }}>┝</span>
        <span style={{
          fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
          background: `${color}22`, color, border: `1px solid ${color}`,
        }}>
          If {outcome.label || outcome.outcome_key}
        </span>
        {!disabled && (
          <BranchEditor
            outcome={outcome}
            allSteps={allSteps}
            parentStepKey={parentStep.step_key}
            onUpdate={onUpdateOutcome}
            onDelete={onDeleteOutcome}
          />
        )}
      </div>
      <div style={{ paddingLeft: 18, borderLeft: `2px solid ${color}33` }}>
        {children || (
          <div style={{
            padding: '10px 14px',
            color: 'rgba(255,255,255,0.4)',
            fontSize: 13,
            fontStyle: 'italic',
            background: 'rgba(255,255,255,0.02)',
            border: '1px dashed rgba(255,255,255,0.1)',
            borderRadius: 10,
          }}>
            Ends the workflow.
          </div>
        )}
      </div>
    </div>
  );
}

function BranchEditor({ outcome, allSteps, parentStepKey, onUpdate, onDelete }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  return (
    <span ref={wrap} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 14 }}
      >⋯</button>
      <Popover open={open} setOpen={setOpen} anchor={wrap}>
        <div style={popStyles.subRow}>
          <label style={popStyles.subLabel}>Label</label>
          <input
            value={outcome.label || ''}
            onChange={(e) => onUpdate({ label: e.target.value })}
            placeholder="e.g. Accept"
            style={popStyles.subInput}
          />
        </div>
        <div style={popStyles.subRow}>
          <label style={popStyles.subLabel}>Tone</label>
          <div style={{ display: 'flex', gap: 4 }}>
            {OUTCOME_STYLES_FRIENDLY.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => onUpdate({ style: s.value })}
                style={{
                  padding: '4px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                  border: `1px solid ${outcome.style === s.value ? s.color : 'rgba(255,255,255,0.15)'}`,
                  background: outcome.style === s.value ? `${s.color}22` : 'transparent',
                  color: s.color,
                  cursor: 'pointer',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div style={popStyles.subRow}>
          <label style={popStyles.subLabel}>Then go to</label>
          <select
            value={outcome.next_step_key || ''}
            onChange={(e) => onUpdate({ next_step_key: e.target.value || null })}
            style={popStyles.subInput}
          >
            <option value="">End the workflow</option>
            {allSteps.filter((s) => s.step_key && s.step_key !== parentStepKey).map((s) => (
              <option key={s.id} value={s.step_key}>{s.title_template || s.step_key}</option>
            ))}
          </select>
        </div>
        <div style={popStyles.divider} />
        <div {...clickableKeyProps(() => { onDelete(); setOpen(false); })} style={{ ...popStyles.menuItem, color: colors.danger.fgSoft }} onClick={() => { onDelete(); setOpen(false); }}>Delete branch</div>
      </Popover>
    </span>
  );
}

// ─── Add-between button + Action Library ────────────────────

function AddBetween({ onPick, disabled }) {
  const [open, setOpen] = useState(false);
  if (disabled) {
    return <div style={{ height: 10 }} />;
  }
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0', position: 'relative' }}>
        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.04)' }} />
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            position: 'relative',
            width: 32, height: 32, borderRadius: '50%',
            background: colors.accentSoft,
            border: '1px solid rgba(91, 143, 199,0.4)',
            color: colors.accentFg,
            fontSize: 18,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="Insert a step"
        >+</button>
      </div>
      {open && <ActionLibraryModal onPick={(preset) => { setOpen(false); onPick(preset); }} onClose={() => setOpen(false)} />}
    </>
  );
}

const LIBRARY = [
  { id: 'task',    label: 'Ask someone to mark complete', icon: '👤', description: 'Assignee clicks a button when done.',          preset: { action_type: 'complete', action_label: 'Mark Complete' } },
  { id: 'page',    label: 'Send them to a page',          icon: '🌐', description: 'Opens a tab in the app to do the work.',       preset: { action_type: 'navigate', action_label: 'Open page', action_config: {} } },
  { id: 'form',    label: 'Pop up a small form',          icon: '📋', description: 'Collects data via a quick form.',              preset: { action_type: 'modal', action_label: 'Open form', action_config: {} } },
  { id: 'custom',  label: 'Run custom logic',             icon: '⚙️', description: 'Runs a server handler (create records, etc.).', preset: { action_type: 'custom', action_label: 'Run', action_config: {} } },
  { id: 'repeat',  label: 'Repeat for each item',         icon: '🔁', description: 'Creates one task per list item.',              preset: { action_type: 'complete', action_label: 'Mark Complete', fan_out_context_key: '', fan_out_title_template: '', fan_out_entity_type: '', fan_out_entity_id_key: 'id' } },
];

function ActionLibraryModal({ onPick, onClose }) {
  return (
    <div {...backdropDismiss(onClose)} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: colors.bgRaised,
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 18,
        padding: 20,
        minWidth: 420,
        maxWidth: 480,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Action Library</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 14 }}>Pick what this step should do.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {LIBRARY.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onPick(item.preset)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12,
                color: '#fff',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 22 }}>{item.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{item.label}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{item.description}</div>
              </div>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <button type="button" onClick={onClose} style={{
            padding: '6px 14px', borderRadius: 6, background: 'transparent',
            border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 13,
          }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Trigger card ───────────────────────────────────────────

function TriggerCard({ workflowForm, onChangeMode, onChangeConfig, disabled }) {
  const visual = CATEGORY.trigger;
  const mode = workflowForm.trigger_mode;
  const cfg = workflowForm.trigger_config || {};
  const entityMeta = lookupEntity(cfg.entity);
  const eventMeta = lookupEvent(cfg.event);
  return (
    <div style={{
      background: visual.fill,
      border: `1px solid ${visual.border}`,
      borderRadius: 14,
      padding: '14px 16px',
      boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>{visual.icon}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
          When this runs
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: mode === 'auto' || mode === 'both' ? 10 : 0 }}>
        {[
          { value: 'manual', label: 'Manual only' },
          { value: 'auto', label: 'Auto on event' },
          { value: 'both', label: 'Either' },
        ].map((m) => (
          <button
            key={m.value}
            type="button"
            disabled={disabled}
            onClick={() => onChangeMode(m.value)}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              background: mode === m.value ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${mode === m.value ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.12)'}`,
              color: mode === m.value ? '#fca5a5' : 'rgba(255,255,255,0.7)',
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
      {(mode === 'auto' || mode === 'both') && (
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.85)', lineHeight: 1.8 }}>
          <span>Run when </span>
          <InlineSelectPill
            value={cfg.entity || ''}
            options={TRIGGER_ENTITIES.map((t) => ({ value: t.value, label: t.label }))}
            placeholder="a record"
            kind="action"
            icon="📦"
            onChange={(v) => onChangeConfig({ ...cfg, entity: v })}
            disabled={disabled}
          />
          <InlineSelectPill
            value={cfg.event || ''}
            options={TRIGGER_EVENTS.map((t) => ({ value: t.value, label: t.label }))}
            placeholder="something happens"
            kind="repeat"
            icon="✨"
            onChange={(v) => onChangeConfig({ ...cfg, event: v })}
            disabled={disabled}
          />
          <span>.</span>
        </div>
      )}
    </div>
  );
}

function InlineSelectPill({ value, options, placeholder, kind, icon, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const current = options.find((o) => o.value === value);
  return (
    <span ref={wrap} style={{ position: 'relative', display: 'inline-block' }}>
      <Pill
        kind={kind}
        icon={icon}
        label={current?.label}
        placeholder={placeholder}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
      />
      <Popover open={open} setOpen={setOpen} anchor={wrap}>
        <div style={popStyles.list}>
          {options.map((o) => (
            <div
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              style={{ ...popStyles.row, ...(o.value === value ? popStyles.rowActive : {}) }}
            >
              <span style={{ color: '#fff' }}>{o.label}</span>
            </div>
          ))}
        </div>
      </Popover>
    </span>
  );
}

// ─── Main canvas ────────────────────────────────────────────

export default function ShortcutsCanvas({
  workflowForm,
  setWorkflowForm,
  steps,
  outcomes,
  profiles,
  actionHandlers,
  contextKeys,
  isEditable,
  onUpdateStep,
  onAddStep,
  onDeleteStep,
  onAddOutcome,
  onUpdateOutcome,
  onDeleteOutcome,
}) {
  const tree = useMemo(() => buildTree(steps, outcomes, workflowForm.first_step_key), [steps, outcomes, workflowForm.first_step_key]);
  // Index assignment for display
  const displayIndexByKey = useMemo(() => {
    const map = new Map();
    let i = 1;
    function walk(node) {
      if (!node) return;
      map.set(node.step.step_key, i++);
      if (node.isBranching) node.branches.forEach((b) => walk(b.child));
      else node.children.forEach(walk);
    }
    walk(tree.root);
    tree.orphans.forEach(walk);
    return map;
  }, [tree]);

  const setAsFirst = (stepKey) => setWorkflowForm((prev) => ({ ...prev, first_step_key: stepKey }));

  const insertStep = async (afterStepKey, branchOutcomeId, preset) => {
    // Create the new step.
    const newStep = await onAddStep(preset || {});
    if (!newStep) return;
    // Wire it into the flow.
    if (branchOutcomeId) {
      await onUpdateOutcome(branchOutcomeId, { next_step_key: newStep.step_key });
    } else if (afterStepKey) {
      // Find the step preceding the insertion point and update its single outcome (or create one).
      const prevStep = steps.find((s) => s.step_key === afterStepKey);
      if (prevStep) {
        const outs = outcomes[prevStep.id] || [];
        if (outs.length === 1) {
          const nextKey = outs[0].next_step_key;
          // Insert: prev.next = new, new.next = oldNext
          await onUpdateOutcome(outs[0].id, { next_step_key: newStep.step_key });
          // Create complete outcome on newStep pointing to oldNext.
          await onAddOutcome(newStep.id, { outcome_key: 'complete', label: 'Complete', next_step_key: nextKey, style: 'default', position: 0 });
        } else if (outs.length === 0) {
          // Prev has no outcomes — just create one pointing to new.
          await onAddOutcome(prevStep.id, { outcome_key: 'complete', label: 'Complete', next_step_key: newStep.step_key, style: 'default', position: 0 });
        }
      }
    } else {
      // No predecessor — must be the start, or just append.
      if (!workflowForm.first_step_key) {
        setWorkflowForm((prev) => ({ ...prev, first_step_key: newStep.step_key }));
      }
    }
  };

  function renderNode(node, indexLabel) {
    if (!node) return null;
    const isRepeat = node.step.fan_out_context_key !== null && node.step.fan_out_context_key !== undefined;
    const updateStep = (updates) => onUpdateStep(node.step.id, updates);
    const card = (
      <StepCard
        step={node.step}
        index={indexLabel}
        profiles={profiles}
        contextKeys={contextKeys}
        actionHandlers={actionHandlers}
        allSteps={steps}
        stepOutcomes={node.outcomes}
        disabled={!isEditable}
        onUpdate={updateStep}
        onDelete={() => onDeleteStep(node.step.id)}
        onSetAsFirst={() => setAsFirst(node.step.step_key)}
        isFirst={node.step.step_key === workflowForm.first_step_key}
      />
    );
    const wrapped = isRepeat ? (
      <RepeatBlock step={node.step} contextKeys={contextKeys} onUpdate={updateStep} disabled={!isEditable}>
        {card}
      </RepeatBlock>
    ) : card;

    return (
      <React.Fragment key={node.step.id}>
        {wrapped}
        {/* Add between step and its single child */}
        {!node.isBranching && (
          <AddBetween
            disabled={!isEditable}
            onPick={(preset) => insertStep(node.step.step_key, null, preset)}
          />
        )}
        {/* Branches */}
        {node.isBranching && (
          <div style={{ marginTop: 4 }}>
            {node.branches.map((b) => (
              <BranchBlock
                key={b.outcome.id}
                outcome={b.outcome}
                parentStep={node.step}
                allSteps={steps}
                onUpdateOutcome={(updates) => onUpdateOutcome(b.outcome.id, updates)}
                onDeleteOutcome={() => onDeleteOutcome(b.outcome.id, node.step.id)}
                disabled={!isEditable}
              >
                {b.child ? renderNode(b.child, displayIndexByKey.get(b.child.step.step_key)) : null}
              </BranchBlock>
            ))}
            {isEditable && (
              <div style={{ marginTop: 8, paddingLeft: 6 }}>
                <button
                  type="button"
                  onClick={() => onAddOutcome(node.step.id)}
                  style={{
                    padding: '4px 10px', borderRadius: 999,
                    background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(255,255,255,0.2)',
                    color: 'rgba(255,255,255,0.6)', fontSize: 12, cursor: 'pointer',
                  }}
                >+ Add branch</button>
              </div>
            )}
          </div>
        )}
        {/* Linear children */}
        {!node.isBranching && node.children.map((c) => renderNode(c, displayIndexByKey.get(c.step.step_key)))}
      </React.Fragment>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'system-ui, -apple-system, "SF Pro Text", sans-serif' }}>
      <TriggerCard
        workflowForm={workflowForm}
        disabled={!isEditable}
        onChangeMode={(mode) => setWorkflowForm((prev) => ({ ...prev, trigger_mode: mode }))}
        onChangeConfig={(cfg) => setWorkflowForm((prev) => ({ ...prev, trigger_config: cfg }))}
      />

      <AddBetween
        disabled={!isEditable}
        onPick={(preset) => insertStep(null, null, preset)}
      />

      {tree.root
        ? renderNode(tree.root, displayIndexByKey.get(tree.root.step.step_key))
        : (
          <div style={{
            padding: 30, textAlign: 'center',
            background: 'rgba(255,255,255,0.02)', borderRadius: 14,
            border: '1px dashed rgba(255,255,255,0.15)',
            color: 'rgba(255,255,255,0.4)', fontSize: 14,
          }}>
            No steps yet. Tap the + above to add one.
          </div>
        )}

      {tree.orphans.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: 0.5, marginBottom: 8, textTransform: 'uppercase' }}>
            Unreachable steps ({tree.orphans.length})
          </div>
          {tree.orphans.map((o) => renderNode(o, displayIndexByKey.get(o.step.step_key)))}
        </div>
      )}
    </div>
  );
}

// ─── Shared popover styles ──────────────────────────────────

const popStyles = {
  tabRow: { display: 'flex', gap: 4, marginBottom: 6 },
  tabBtn: {
    flex: 1, padding: '5px 8px', borderRadius: 6,
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
  },
  tabBtnActive: { background: colors.accentA20, color: colors.accentFg, borderColor: colors.borderFocus },
  search: {
    width: '100%', boxSizing: 'border-box', padding: '6px 8px',
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6, color: '#fff', fontSize: 12, marginBottom: 6, outline: 'none',
  },
  list: { maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 },
  row: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  rowActive: { background: colors.accentA15 },
  empty: { padding: 12, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  roleBadge: { fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', padding: '2px 6px', borderRadius: 3, background: colors.accentSoft, color: colors.accentFg }, // style-lint-ignore
  header: { padding: '4px 8px 8px', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: 0.5, textTransform: 'uppercase' },
  actionTypeCol: { display: 'flex', flexDirection: 'column', gap: 4 },
  actionTypeRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, cursor: 'pointer' },
  divider: { height: 1, background: 'rgba(255,255,255,0.06)', margin: '8px 0' },
  subRow: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 },
  subLabel: { fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.45)', letterSpacing: 0.5, textTransform: 'uppercase' },
  subInput: {
    padding: '6px 8px', background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6,
    color: '#fff', fontSize: 12, outline: 'none',
  },
  hint: { padding: '6px 8px', fontSize: 11, color: 'rgba(255,255,255,0.6)', fontStyle: 'italic' },
  checkRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', cursor: 'pointer', borderRadius: 6 },
  menuItem: { padding: '8px 12px', cursor: 'pointer', fontSize: 13, color: '#fff' },
  inlineEditInput: {
    padding: '4px 8px', background: 'rgba(0,0,0,0.3)',
    border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6,
    color: '#fff', fontSize: 14, outline: 'none', minWidth: 220,
  },
};
