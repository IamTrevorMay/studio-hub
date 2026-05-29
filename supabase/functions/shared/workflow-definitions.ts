// Workflow definitions — server-side step logic
// Each workflow is a plain object with ordered steps.
// Supports both code-defined workflows (WORKFLOW_REGISTRY) and
// data-driven workflows (built from workflow_steps DB rows or version snapshots).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getActionHandler } from "./action-registry.ts";

export interface TaskAction {
  type: "complete" | "modal" | "navigate" | "custom";
  label: string;
  modalKey?: string;
  tab?: string;
  target?: string; // context key to resolve for navigation target
}

export interface DynamicFanOutConfig {
  contextKey: string; // key in context whose value is an array of objects
  titleTemplate: string; // per-item title, e.g. "Write ad read for {{title}}"
  descriptionTemplate?: string;
  relatedEntityType: string; // e.g. "deliverable"
  relatedEntityIdKey: string; // key within each array element holding its ID
}

export type AssigneeResolver = (context: Record<string, unknown>) => string | null;

export interface NextStepResult {
  next: string | string[] | null; // stepKey(s) or null = workflow complete
  contextUpdates?: Record<string, unknown>;
}

export interface WorkflowStep {
  stepKey: string;
  titleTemplate: string;
  descriptionTemplate?: string;
  assignee: string | AssigneeResolver;
  relatedEntity?: {
    type: string;
    resolver: (context: Record<string, unknown>) => string | null;
  };
  dynamicFanOut?: DynamicFanOutConfig;
  action: TaskAction;
  condition?: (context: Record<string, unknown>) => boolean;
  dependsOnSteps?: string[]; // stepKeys this step waits on (fan-in)
  onComplete: (
    context: Record<string, unknown>,
    payload: Record<string, unknown>,
    admin: SupabaseClient,
  ) => NextStepResult | Promise<NextStepResult>;
}

export interface WorkflowDefinition {
  slug: string;
  name: string;
  description: string;
  steps: Record<string, WorkflowStep>;
  firstStep: string;
}

// ─── DB row types for data-driven steps ─────────────────────

interface DBStepRow {
  id: string;
  workflow_id: string;
  step_key: string;
  title_template: string;
  description_template: string | null;
  assignee_type: "static" | "context";
  assignee_value: string | null;
  related_entity_type: string | null;
  related_entity_context_key: string | null;
  action_type: string;
  action_label: string;
  action_config: Record<string, unknown>;
  fan_out_context_key: string | null;
  fan_out_title_template: string | null;
  fan_out_entity_type: string | null;
  fan_out_entity_id_key: string | null;
  depends_on_step_keys: string[];
  condition_expression: string | null;
  on_complete_handler: string | null;
  position: number;
}

interface DBOutcomeRow {
  id: string;
  step_id: string;
  outcome_key: string;
  label: string;
  next_step_key: string | null;
  style: string;
  position: number;
}

// ─── Build WorkflowStep from DB data ────────────────────────

function buildStepFromDB(
  row: DBStepRow,
  outcomes: DBOutcomeRow[],
): WorkflowStep {
  // Assignee: static UUID or context-key resolver
  const assignee: string | AssigneeResolver =
    row.assignee_type === "static"
      ? (row.assignee_value || "")
      : (ctx: Record<string, unknown>) =>
          (ctx[row.assignee_value || ""] as string) || null;

  // Related entity
  const relatedEntity = row.related_entity_type
    ? {
        type: row.related_entity_type,
        resolver: (ctx: Record<string, unknown>) =>
          (ctx[row.related_entity_context_key || ""] as string) || null,
      }
    : undefined;

  // Dynamic fan-out
  const dynamicFanOut: DynamicFanOutConfig | undefined =
    row.fan_out_context_key
      ? {
          contextKey: row.fan_out_context_key,
          titleTemplate: row.fan_out_title_template || row.title_template,
          relatedEntityType: row.fan_out_entity_type || "",
          relatedEntityIdKey: row.fan_out_entity_id_key || "id",
        }
      : undefined;

  // Action
  const action: TaskAction = {
    type: row.action_type as TaskAction["type"],
    label: row.action_label,
    ...(row.action_config || {}),
  };

  // Condition (simple expression evaluation)
  const condition = row.condition_expression
    ? (ctx: Record<string, unknown>) => {
        try {
          // Simple key-exists or truthy check: "has:key" or "eq:key:value"
          const expr = row.condition_expression!;
          if (expr.startsWith("has:")) {
            const key = expr.slice(4);
            return ctx[key] != null;
          }
          if (expr.startsWith("eq:")) {
            const [, key, val] = expr.split(":");
            return String(ctx[key]) === val;
          }
          // Default: truthy check on key name
          return !!ctx[expr];
        } catch {
          return true;
        }
      }
    : undefined;

  // onComplete: synthesized from handler slug + outcomes
  const handlerSlug = row.on_complete_handler;
  const stepOutcomes = outcomes.sort((a, b) => a.position - b.position);

  const onComplete = async (
    ctx: Record<string, unknown>,
    payload: Record<string, unknown>,
    admin: SupabaseClient,
  ): Promise<NextStepResult> => {
    let contextUpdates: Record<string, unknown> | undefined;

    // Run the action handler if defined
    if (handlerSlug) {
      const handler = getActionHandler(handlerSlug);
      if (handler) {
        const result = await handler(ctx, { ...payload, outcome: payload.outcome || payload.decision }, admin);
        contextUpdates = result.contextUpdates;
      }
    }

    // Determine next step from outcomes
    if (stepOutcomes.length > 0) {
      const outcomeKey = (payload.outcome || payload.decision) as string;
      const matched = outcomeKey
        ? stepOutcomes.find((o) => o.outcome_key === outcomeKey)
        : stepOutcomes[0]; // default to first if no outcome specified
      const nextKey = matched?.next_step_key || null;
      return { next: nextKey, contextUpdates };
    }

    // No outcomes = end of branch
    return { next: null, contextUpdates };
  };

  return {
    stepKey: row.step_key,
    titleTemplate: row.title_template,
    descriptionTemplate: row.description_template || undefined,
    assignee,
    relatedEntity,
    dynamicFanOut,
    action,
    condition,
    dependsOnSteps:
      row.depends_on_step_keys && row.depends_on_step_keys.length > 0
        ? row.depends_on_step_keys
        : undefined,
    onComplete,
  };
}

// ─── Build definition from live DB rows ─────────────────────

export async function buildDefinitionFromDB(
  admin: SupabaseClient,
  workflowId: string,
  slug: string,
  name: string,
  description: string,
  firstStepKey: string,
): Promise<WorkflowDefinition> {
  // Fetch all steps for this workflow
  const { data: stepRows, error: sErr } = await admin
    .from("workflow_steps")
    .select("*")
    .eq("workflow_id", workflowId)
    .order("position");

  if (sErr || !stepRows || stepRows.length === 0) {
    throw new Error(
      `No steps found for workflow ${workflowId}: ${sErr?.message}`,
    );
  }

  // Fetch all outcomes for these steps
  const stepIds = stepRows.map((s: DBStepRow) => s.id);
  const { data: outcomeRows } = await admin
    .from("workflow_step_outcomes")
    .select("*")
    .in("step_id", stepIds)
    .order("position");

  const outcomesByStepId: Record<string, DBOutcomeRow[]> = {};
  for (const o of (outcomeRows || []) as DBOutcomeRow[]) {
    if (!outcomesByStepId[o.step_id]) outcomesByStepId[o.step_id] = [];
    outcomesByStepId[o.step_id].push(o);
  }

  // Build steps
  const steps: Record<string, WorkflowStep> = {};
  for (const row of stepRows as DBStepRow[]) {
    steps[row.step_key] = buildStepFromDB(
      row,
      outcomesByStepId[row.id] || [],
    );
  }

  return { slug, name, description, steps, firstStep: firstStepKey };
}

// ─── Build definition from version snapshot ─────────────────

export function buildDefinitionFromSnapshot(
  snapshot: Record<string, unknown>,
  slug: string,
  name: string,
  description: string,
): WorkflowDefinition {
  const snapshotSteps = snapshot.steps as DBStepRow[];
  const snapshotOutcomes = (snapshot.outcomes || []) as DBOutcomeRow[];
  const firstStep = snapshot.firstStep as string;

  const outcomesByStepId: Record<string, DBOutcomeRow[]> = {};
  for (const o of snapshotOutcomes) {
    if (!outcomesByStepId[o.step_id]) outcomesByStepId[o.step_id] = [];
    outcomesByStepId[o.step_id].push(o);
  }

  const steps: Record<string, WorkflowStep> = {};
  for (const row of snapshotSteps) {
    steps[row.step_key] = buildStepFromDB(
      row,
      outcomesByStepId[row.id] || [],
    );
  }

  return { slug, name, description, steps, firstStep };
}

// ─── Resolve a workflow definition (dual-mode) ──────────────

export async function resolveWorkflowDefinition(
  admin: SupabaseClient,
  workflowRow: {
    id: string;
    slug: string;
    name: string;
    description: string;
    source: string;
    first_step_key: string | null;
    current_version_id: string | null;
  },
  versionId?: string | null,
): Promise<WorkflowDefinition | null> {
  // Code-sourced: use the hard-coded registry
  if (workflowRow.source === "code") {
    return getWorkflowDefinition(workflowRow.slug);
  }

  // Data-sourced: use version snapshot only if explicitly requested.
  // When versionId is explicitly null, skip snapshots and use live DB rows
  // so that builder UI changes take effect immediately.
  const vidToUse = versionId === undefined
    ? workflowRow.current_version_id
    : versionId;
  if (vidToUse) {
    const { data: version } = await admin
      .from("workflow_versions")
      .select("snapshot")
      .eq("id", vidToUse)
      .single();
    if (version?.snapshot) {
      return buildDefinitionFromSnapshot(
        version.snapshot as Record<string, unknown>,
        workflowRow.slug,
        workflowRow.name,
        workflowRow.description,
      );
    }
  }

  // Fall back to live DB rows (draft mode)
  if (!workflowRow.first_step_key) {
    console.error(`Data workflow ${workflowRow.slug} missing first_step_key`);
    return null;
  }
  return buildDefinitionFromDB(
    admin,
    workflowRow.id,
    workflowRow.slug,
    workflowRow.name,
    workflowRow.description,
    workflowRow.first_step_key,
  );
}

// ─── Placeholder workflow for testing ──────────────────────────
// Two-step chain: step_a (assigned to context.user_a) -> step_b (assigned to context.user_b)
const testWorkflow: WorkflowDefinition = {
  slug: "test_workflow",
  name: "Test Workflow",
  description: "Two-step placeholder for engine testing",
  firstStep: "step_a",
  steps: {
    step_a: {
      stepKey: "step_a",
      titleTemplate: "Test step A: {{label}}",
      descriptionTemplate: "First step of the test workflow for {{label}}.",
      assignee: (ctx) => (ctx.user_a as string) || null,
      action: { type: "complete", label: "Complete Step A" },
      onComplete: (_ctx, _payload, _admin) => ({ next: "step_b" }),
    },
    step_b: {
      stepKey: "step_b",
      titleTemplate: "Test step B: {{label}}",
      descriptionTemplate: "Second step of the test workflow for {{label}}.",
      assignee: (ctx) => (ctx.user_b as string) || null,
      action: { type: "complete", label: "Complete Step B" },
      onComplete: (_ctx, _payload, _admin) => ({ next: null }),
    },
  },
};

// ─── Fan-out/fan-in test workflow ──────────────────────────────
// start -> fan_a + fan_b (parallel) -> join_step (waits for both)
const testFanWorkflow: WorkflowDefinition = {
  slug: "test_fan_workflow",
  name: "Test Fan-out Workflow",
  description: "Tests parallel tasks with fan-in join",
  firstStep: "start_step",
  steps: {
    start_step: {
      stepKey: "start_step",
      titleTemplate: "Kick off: {{label}}",
      assignee: (ctx) => (ctx.user_a as string) || null,
      action: { type: "complete", label: "Start" },
      onComplete: (_ctx, _payload, _admin) => ({ next: ["fan_a", "fan_b"] }),
    },
    fan_a: {
      stepKey: "fan_a",
      titleTemplate: "Parallel task A: {{label}}",
      assignee: (ctx) => (ctx.user_a as string) || null,
      action: { type: "complete", label: "Done A" },
      onComplete: (_ctx, _payload, _admin) => ({ next: "join_step" }),
    },
    fan_b: {
      stepKey: "fan_b",
      titleTemplate: "Parallel task B: {{label}}",
      assignee: (ctx) => (ctx.user_b as string) || null,
      action: { type: "complete", label: "Done B" },
      onComplete: (_ctx, _payload, _admin) => ({ next: "join_step" }),
    },
    join_step: {
      stepKey: "join_step",
      titleTemplate: "Final review: {{label}}",
      assignee: (ctx) => (ctx.user_a as string) || null,
      dependsOnSteps: ["fan_a", "fan_b"],
      action: { type: "complete", label: "Finish" },
      onComplete: (_ctx, _payload, _admin) => ({ next: null }),
    },
  },
};

// ─── Registry ──────────────────────────────────────────────────
// Code-sourced workflows only. Data-sourced workflows (Ad Read Pipeline, etc.)
// are resolved from workflow_versions snapshots via resolveWorkflowDefinition.
const WORKFLOW_REGISTRY: Record<string, WorkflowDefinition> = {
  test_workflow: testWorkflow,
  test_fan_workflow: testFanWorkflow,
};

export function getWorkflowDefinition(slug: string): WorkflowDefinition | null {
  return WORKFLOW_REGISTRY[slug] || null;
}

export function resolveTemplate(
  template: string,
  context: Record<string, unknown>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = context[key];
    return val != null ? String(val) : "";
  });
}
