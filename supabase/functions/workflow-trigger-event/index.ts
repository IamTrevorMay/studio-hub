// Event-triggered card creation for workflow boards.
// Called internally from other edge functions or via HTTP POST with service role key.
// Body: { event: string, source?: string, payload: Record<string, unknown> }
// Deploy: supabase functions deploy workflow-trigger-event --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  getAdminClient,
  corsHeaders,
  jsonResp,
  loadColumns,
  enterColumn,
  type Instance,
} from "../shared/workflow-engine.ts";

// Map event types to trigger_config.type values.
const EVENT_TO_TRIGGER: Record<string, string> = {
  new_drive_file: "drive_folder",
  new_video_published: "new_video",
  new_project_created: "new_project",
  new_proposal_created: "new_proposal",
  new_beat_sheet_mayday: "new_beat_sheet_mayday",
  new_beat_sheet_tm_baseball: "new_beat_sheet_tm_baseball",
};

// Extract a card title from the event payload.
function cardTitleFromEvent(event: string, payload: Record<string, unknown>): string {
  switch (event) {
    case "new_drive_file":
      return cleanFilename(String(payload.file_name || "Untitled file"));
    case "new_video_published":
      return String(payload.title || "Untitled video");
    case "new_project_created":
      return String(payload.title || "Untitled project");
    case "new_proposal_created":
      return String(payload.sponsor_name || "Untitled proposal");
    case "new_beat_sheet_mayday":
    case "new_beat_sheet_tm_baseball":
      return String(payload.title || "Untitled beat sheet");
    default:
      return "Untitled";
  }
}

function cleanFilename(name: string): string {
  // Strip extension and clean up.
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || name;
}

// Build a dedup key from event + payload.
function dedupKey(workflowId: string, event: string, payload: Record<string, unknown>): string {
  const pk = event === "new_drive_file" ? payload.file_id
    : event === "new_video_published" ? payload.video_id
    : event === "new_project_created" ? payload.project_id
    : event === "new_proposal_created" ? payload.proposal_id
    : event === "new_beat_sheet_mayday" ? payload.beat_sheet_id
    : event === "new_beat_sheet_tm_baseball" ? payload.beat_sheet_id
    : JSON.stringify(payload);
  return `${workflowId}:${event}:${pk}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  // Auth: require CRON_SECRET OR admin JWT. This endpoint runs under
  // service role and synthesizes workflow cards / tasks from arbitrary
  // event payloads, so it must not be callable by unauthenticated traffic.
  // Internal callers (other edge fns, pg_cron) send x-cron-secret header;
  // browser callers (admin UI on Deliverables / Projects / Production)
  // send an admin Bearer token.
  const url = new URL(req.url);
  const providedSecret =
    req.headers.get("x-cron-secret") || url.searchParams.get("secret");
  const expectedSecret = Deno.env.get("CRON_SECRET");
  const cronOk = !!expectedSecret && providedSecret === expectedSecret;

  let adminOk = false;
  if (!cronOk) {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7)
      : "";
    if (token) {
      const admin = getAdminClient();
      const { data: userRes } = await admin.auth.getUser(token);
      const uid = userRes?.user?.id;
      if (uid) {
        const { data: prof } = await admin
          .from("profiles")
          .select("role")
          .eq("id", uid)
          .maybeSingle();
        adminOk = !!prof && ["admin", "director_creative", "director_comms"].includes(prof.role);
      }
    }
  }

  if (!cronOk && !adminOk) {
    return jsonResp({ error: "Unauthorized" }, 401);
  }

  let body: { event?: string; source?: string; payload?: Record<string, unknown> };
  try { body = await req.json(); } catch { return jsonResp({ error: "Invalid JSON" }, 400); }
  const { event, source, payload } = body;
  if (!event || !payload) return jsonResp({ error: "event + payload required" }, 400);

  const triggerType = EVENT_TO_TRIGGER[event];
  if (!triggerType) return jsonResp({ error: `Unknown event: ${event}` }, 400);

  const admin = getAdminClient();

  // Load all active workflows that accept auto triggers.
  const { data: workflows } = await admin
    .from("workflows")
    .select("id, slug, name, trigger_mode, trigger_config")
    .eq("is_active", true)
    .in("trigger_mode", ["auto", "both"]);

  if (!workflows || workflows.length === 0) {
    return jsonResp({ matched: 0, created: [] });
  }

  const created: { workflow_id: string; instance_id: string; task_ids: string[] }[] = [];

  for (const wf of workflows) {
    const cfg = wf.trigger_config || {};
    if (cfg.type !== triggerType) continue;

    // For drive_folder, match folder_id.
    if (triggerType === "drive_folder" && cfg.folder_id && cfg.folder_id !== payload.folder_id) {
      continue;
    }

    // Dedup: check if we already created a card for this event.
    const dk = dedupKey(wf.id, event, payload);
    const { data: existing } = await admin
      .from("workflow_instances")
      .select("id")
      .eq("workflow_id", wf.id)
      .contains("context", { dedup_key: dk })
      .limit(1);
    if (existing && existing.length > 0) continue;

    // Load columns, find first non-terminal.
    const columns = await loadColumns(admin, wf.id);
    if (columns.length === 0) continue;
    const first = columns.find((c) => !c.is_terminal) || columns[0];

    const title = cardTitleFromEvent(event, payload);

    // Create card.
    const { data: inst, error: instErr } = await admin
      .from("workflow_instances")
      .insert({
        workflow_id: wf.id,
        status: "active",
        title,
        context: { ...payload, event, source, dedup_key: dk },
        assignee_overrides: {},
        started_by: null,
        test_mode: false,
      })
      .select("*")
      .single();

    if (instErr || !inst) {
      console.error(`Failed to create instance for ${wf.slug}:`, instErr?.message);
      continue;
    }

    const instance: Instance = {
      id: inst.id,
      workflow_id: inst.workflow_id,
      title: inst.title,
      status: inst.status,
      context: inst.context || {},
      current_step_key: inst.current_step_key,
      assignee_overrides: inst.assignee_overrides || {},
      test_mode: false,
    };

    // Use a system actor ID (null-safe, the engine handles null actorId via service role).
    const actorId = inst.started_by || "00000000-0000-0000-0000-000000000000";
    const { taskIds } = await enterColumn(admin, instance, first, actorId);

    created.push({ workflow_id: wf.id, instance_id: inst.id, task_ids: taskIds });
  }

  return jsonResp({ matched: created.length, created });
});
