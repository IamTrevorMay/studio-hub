// Curated catalogs for the Workflows builder UI.
// Plain-English labels mapped to the raw values the engine needs.

// ─── Trigger sentence builder ───────────────────────────────

export const TRIGGER_ENTITIES = [
  { value: 'ad_read_proposals', label: 'a new ad read proposal', article: 'proposal' },
  { value: 'sponsor_campaigns', label: 'a sponsor campaign', article: 'campaign' },
  { value: 'sponsor_deliverables', label: 'a deliverable', article: 'deliverable' },
  { value: 'projects', label: 'a project', article: 'project' },
  { value: 'fl_assignments', label: 'a freelancer assignment', article: 'assignment' },
  { value: 'sprints', label: 'a sprint', article: 'sprint' },
];

export const TRIGGER_EVENTS = [
  { value: 'insert', label: 'is created' },
  { value: 'update', label: 'is updated' },
  { value: 'status_change', label: "'s status changes" },
];

export function lookupEntity(value) {
  return TRIGGER_ENTITIES.find((e) => e.value === value);
}

export function lookupEvent(value) {
  return TRIGGER_EVENTS.find((e) => e.value === value);
}

// ─── Action types (friendly labels) ─────────────────────────

export const ACTION_TYPES_FRIENDLY = [
  {
    value: 'complete',
    label: 'Just mark done',
    description: 'A simple button the assignee clicks when finished.',
  },
  {
    value: 'navigate',
    label: 'Open a page',
    description: 'Sends the assignee to a specific page or tab to do the work.',
  },
  {
    value: 'modal',
    label: 'Open a form',
    description: 'Pops up a small form to capture data before completing.',
  },
  {
    value: 'custom',
    label: 'Run custom logic',
    description: 'Runs a server-side handler (e.g. create records, send emails).',
  },
];

export function lookupActionType(value) {
  return ACTION_TYPES_FRIENDLY.find((a) => a.value === value);
}

// ─── Navigate targets (tab dropdown for action_config.tab) ─

export const NAVIGATE_TARGETS = [
  { value: 'deliverables', label: 'Deliverables' },
  { value: 'sponsors', label: 'Sponsors' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'projects', label: 'Projects' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'my_tasks', label: 'My Tasks' },
  { value: 'freelancers', label: 'Freelancers' },
  { value: 'business_dev', label: 'Business Dev' },
];

// ─── Outcome style pills ────────────────────────────────────

export const OUTCOME_STYLES_FRIENDLY = [
  { value: 'default', label: 'Neutral', color: 'rgba(255,255,255,0.6)' },
  { value: 'success', label: 'Positive', color: '#22c55e' },
  { value: 'warning', label: 'Caution', color: '#eab308' },
  { value: 'danger', label: 'Negative', color: '#ef4444' },
];

// ─── Context key catalog ────────────────────────────────────
// Friendly labels for known keys that workflows commonly pass through context.
// Used by the variable picker as a fallback when a key is not yet referenced
// anywhere in the workflow's templates.

export const COMMON_CONTEXT_KEYS = {
  proposal_id: { label: 'Proposal ID', scope: 'root' },
  brand_name: { label: 'Brand name', scope: 'root' },
  campaign_id: { label: 'Campaign ID', scope: 'root' },
  campaign_name: { label: 'Campaign name', scope: 'root' },
  sponsor_id: { label: 'Sponsor ID', scope: 'root' },
  deliverables: { label: 'List of deliverables', scope: 'root', isArray: true },
  title: { label: 'Item title', scope: 'fan-out item' },
  deliverable_id: { label: 'Deliverable ID', scope: 'fan-out item' },
  user_a: { label: 'User A', scope: 'root' },
  user_b: { label: 'User B', scope: 'root' },
  label: { label: 'Label', scope: 'root' },
};

// Pull all {{key}} references from a string.
export function extractTemplateKeys(str) {
  if (!str) return [];
  const out = [];
  const re = /\{\{(\w+)\}\}/g;
  let m;
  while ((m = re.exec(str)) !== null) out.push(m[1]);
  return out;
}

// Gather every context key referenced anywhere in this workflow's
// templates + fan-out configs. Returns Set<string>.
export function collectWorkflowContextKeys(steps) {
  const keys = new Set();
  for (const s of steps || []) {
    extractTemplateKeys(s.title_template).forEach((k) => keys.add(k));
    extractTemplateKeys(s.description_template).forEach((k) => keys.add(k));
    extractTemplateKeys(s.fan_out_title_template).forEach((k) => keys.add(k));
    if (s.assignee_type === 'context' && s.assignee_value) keys.add(s.assignee_value);
    if (s.fan_out_context_key) keys.add(s.fan_out_context_key);
    if (s.related_entity_context_key) keys.add(s.related_entity_context_key);
  }
  return keys;
}

// Build a labeled list of context keys for the variable picker.
// Combines keys already referenced + common known keys.
export function buildContextKeyOptions(steps) {
  const used = collectWorkflowContextKeys(steps);
  const merged = new Map();
  for (const key of used) {
    merged.set(key, COMMON_CONTEXT_KEYS[key] || { label: key, scope: 'workflow' });
  }
  for (const [key, meta] of Object.entries(COMMON_CONTEXT_KEYS)) {
    if (!merged.has(key)) merged.set(key, meta);
  }
  return Array.from(merged.entries()).map(([key, meta]) => ({
    key,
    label: meta.label,
    scope: meta.scope,
    isArray: !!meta.isArray,
  }));
}

// ─── Condition builder ──────────────────────────────────────
// Supported expressions (matching the engine's parser):
//   has:<key>            → context has that key
//   eq:<key>:<value>     → context[key] === value
//   <key>                → context[key] is truthy
//
// Parse a stored expression back into builder fields.
export function parseConditionExpression(expr) {
  if (!expr) return { op: 'always', key: '', value: '' };
  if (expr.startsWith('has:')) return { op: 'has', key: expr.slice(4), value: '' };
  if (expr.startsWith('eq:')) {
    const [, key = '', value = ''] = expr.split(':');
    return { op: 'eq', key, value };
  }
  return { op: 'truthy', key: expr, value: '' };
}

export function buildConditionExpression({ op, key, value }) {
  if (op === 'always' || !key) return null;
  if (op === 'has') return `has:${key}`;
  if (op === 'eq') return `eq:${key}:${value}`;
  if (op === 'truthy') return key;
  return null;
}

export const CONDITION_OPS = [
  { value: 'always', label: 'Always run' },
  { value: 'has', label: 'Only if this exists' },
  { value: 'truthy', label: 'Only if this is true' },
  { value: 'eq', label: 'Only if this equals' },
];
