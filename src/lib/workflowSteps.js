// Client-side step action lookup for the My Tasks UI.
// Maps step_key -> action config so the task card knows how to render
// its primary button. Supports both hard-coded and data-driven workflows.

import { supabase } from '../supabaseClient';

const STEP_ACTIONS = {
  // ─── Test workflow (placeholder) ───────────────────────────
  step_a: { type: 'complete', label: 'Complete Step A' },
  step_b: { type: 'complete', label: 'Complete Step B' },

  // ─── Fan-out test workflow ─────────────────────────────────
  start_step: { type: 'complete', label: 'Start' },
  fan_a: { type: 'complete', label: 'Done A' },
  fan_b: { type: 'complete', label: 'Done B' },
  join_step: { type: 'complete', label: 'Finish' },

  // ─── Ad Read Pipeline ────────────────────────────────────────
  review_proposal:  { type: 'custom', label: 'Review Proposal' },
  collect_brief:    { type: 'navigate', label: 'Go to Deliverables', tab: 'deliverables' },
  write_ad_reads:   { type: 'complete', label: 'Mark Complete' },
  connect_to_video: { type: 'custom', label: 'Connect Video' },
};

// Default action if step_key isn't found
const DEFAULT_ACTION = { type: 'complete', label: 'Mark Complete' };

// Cache for DB-fetched step actions to avoid repeated queries
const dbActionCache = {};

export function getStepAction(stepKey) {
  // Check hard-coded first (backward compatibility)
  if (STEP_ACTIONS[stepKey]) return STEP_ACTIONS[stepKey];

  // Check DB cache
  if (dbActionCache[stepKey]) return dbActionCache[stepKey];

  return DEFAULT_ACTION;
}

// Fetch step actions from DB for data-driven workflows.
// Call this once when loading tasks to populate the cache.
export async function loadDataDrivenStepActions(stepKeys) {
  const uncached = stepKeys.filter(k => !STEP_ACTIONS[k] && !dbActionCache[k]);
  if (uncached.length === 0) return;

  const { data, error } = await supabase
    .from('workflow_steps')
    .select('step_key, action_type, action_label, action_config')
    .in('step_key', uncached);

  if (error || !data) return;

  for (const row of data) {
    dbActionCache[row.step_key] = {
      type: row.action_type,
      label: row.action_label,
      ...(row.action_config || {}),
    };
  }
}
