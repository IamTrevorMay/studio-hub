// Client-side step action lookup for the My Tasks UI.
// Maps step_key -> action config so the task card knows how to render
// its primary button. Updated as new workflows are added in Phase 2+.

const STEP_ACTIONS = {
  // ─── Test workflow (placeholder) ───────────────────────────
  step_a: { type: 'complete', label: 'Complete Step A' },
  step_b: { type: 'complete', label: 'Complete Step B' },

  // ─── Fan-out test workflow ─────────────────────────────────
  start_step: { type: 'complete', label: 'Start' },
  fan_a: { type: 'complete', label: 'Done A' },
  fan_b: { type: 'complete', label: 'Done B' },
  join_step: { type: 'complete', label: 'Finish' },

  // ─── Phase 2 workflows will add entries here ───────────────
  // review_proposal: { type: 'navigate', label: 'Review Proposal', tab: 'deliverables', target: 'proposal_id' },
  // assign_editor:   { type: 'modal', label: 'Assign to Editor', modalKey: 'assign_editor' },
  // mark_ad_reads:   { type: 'complete', label: 'Mark Ad Reads Complete' },
};

// Default action if step_key isn't found
const DEFAULT_ACTION = { type: 'complete', label: 'Mark Complete' };

export function getStepAction(stepKey) {
  return STEP_ACTIONS[stepKey] || DEFAULT_ACTION;
}
