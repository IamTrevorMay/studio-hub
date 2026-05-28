// Workflow definitions — server-side step logic
// Each workflow is a plain object with ordered steps.
// Phase 2 will add real workflows (ad reads, video pipeline, etc.)

export interface TaskAction {
  type: "complete" | "modal" | "navigate";
  label: string;
  modalKey?: string;
  tab?: string;
  target?: string; // context key to resolve for navigation target
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
  action: TaskAction;
  condition?: (context: Record<string, unknown>) => boolean;
  dependsOnSteps?: string[]; // stepKeys this step waits on (fan-in)
  onComplete: (
    context: Record<string, unknown>,
    payload: Record<string, unknown>,
  ) => NextStepResult;
}

export interface WorkflowDefinition {
  slug: string;
  name: string;
  description: string;
  steps: Record<string, WorkflowStep>;
  firstStep: string;
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
      onComplete: (_ctx, _payload) => ({ next: "step_b" }),
    },
    step_b: {
      stepKey: "step_b",
      titleTemplate: "Test step B: {{label}}",
      descriptionTemplate: "Second step of the test workflow for {{label}}.",
      assignee: (ctx) => (ctx.user_b as string) || null,
      action: { type: "complete", label: "Complete Step B" },
      onComplete: (_ctx, _payload) => ({ next: null }),
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
      onComplete: (_ctx, _payload) => ({ next: ["fan_a", "fan_b"] }),
    },
    fan_a: {
      stepKey: "fan_a",
      titleTemplate: "Parallel task A: {{label}}",
      assignee: (ctx) => (ctx.user_a as string) || null,
      action: { type: "complete", label: "Done A" },
      onComplete: (_ctx, _payload) => ({ next: "join_step" }),
    },
    fan_b: {
      stepKey: "fan_b",
      titleTemplate: "Parallel task B: {{label}}",
      assignee: (ctx) => (ctx.user_b as string) || null,
      action: { type: "complete", label: "Done B" },
      onComplete: (_ctx, _payload) => ({ next: "join_step" }),
    },
    join_step: {
      stepKey: "join_step",
      titleTemplate: "Final review: {{label}}",
      assignee: (ctx) => (ctx.user_a as string) || null,
      dependsOnSteps: ["fan_a", "fan_b"],
      action: { type: "complete", label: "Finish" },
      onComplete: (_ctx, _payload) => ({ next: null }),
    },
  },
};

// ─── Registry ──────────────────────────────────────────────────
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
