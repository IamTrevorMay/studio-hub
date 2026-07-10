// card-move
// Server-side card move for the Unified Content Kanban.
// Forward move: admins + current-stage assignees.
// Backward move: admins only.
// Closes open tasks for the current stage, writes an optional handoff note,
// updates projects.status, fans out one task + one notification per target-stage assignee.
//
// Body: { project_id, target_stage, handoff_note? }
// Deploy: supabase functions deploy card-move --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const STAGES = ["queue", "research", "write", "pre_production", "film", "review", "edit", "post_production", "publish"] as const;
type Stage = typeof STAGES[number];
const BACKLOG_STAGE = "backlog" as const;
const ALL_TARGETS = [...STAGES, BACKLOG_STAGE];

const STAGE_LABELS: Record<string, Record<Stage, string>> = {
  mayday_video: {
    queue: "Queue",
    research: "Research",
    write: "Beat Sheet + Broadcast",
    pre_production: "Filming Prep",
    film: "Film + Assign Editor",
    review: "Review & Add B-Roll",
    edit: "Wait on Edit",
    post_production: "Thumbnail & Schedule",
    publish: "Published",
  },
  tm_baseball_video: {
    queue: "Queue",
    research: "Research",
    write: "Beat Sheet",
    pre_production: "Pre-Production",
    film: "Film",
    review: "Review + Storyboard",
    edit: "Arrange + Edit",
    post_production: "Thumbnail & Schedule",
    publish: "Published",
  },
  podcast: {
    queue: "Queue",
    research: "Research",
    write: "Outline",
    pre_production: "Prep Guest + Rundown",
    film: "Record",
    review: "Review",
    edit: "Edit",
    post_production: "Show Notes + Schedule",
    publish: "Published",
  },
  short_form: {
    queue: "Queue",
    research: "Research",
    write: "Concept",
    pre_production: "Pre-Production",
    film: "Capture",
    review: "Review",
    edit: "Cut + Caption",
    post_production: "Schedule",
    publish: "Published",
  },
};

const STAGE_DESCRIPTIONS: Record<string, Partial<Record<Stage, string>>> = {
  mayday_video: {
    write: "Complete a beat sheet & update Broadcast.",
    pre_production: "Finalize beat sheet & push script to teleprompter.",
    film: "Film the full video & create the assignment for the editor.",
    review: "",
    edit: "Monitor editor progress. *Task auto-completes when the editor marks their contractor assignment complete.*",
    post_production: "Build the thumbnail & schedule the upload.",
  },
  tm_baseball_video: {
    write: "Complete a beat sheet.",
    pre_production: "Lock shot list, gear, location.",
    film: "Run pre shoot tests, then shoot per shot list.",
    review: "1. Review footage from shoot\n2. Storyboard the video structure & build a plan for next steps\n3. Locate & gather any music, assets, or additional b-roll you may need.\n4. Record any VO or corrections & add to assets.",
    edit: "Arrange & Edit the video.",
    post_production: "Build the thumbnail, schedule the upload, close out the workflow.",
  },
  podcast: {
    write: "Draft topic outline + show notes skeleton.",
    pre_production: "Confirm guest if necessary, share rundown, test audio chain.",
    film: "Run the recording session. REMEMBER: Record local redundancies for audio & video",
    edit: "Edit audio + video (if necessary).",
    post_production: "Write show notes, schedule release.",
  },
  short_form: {
    write: "Lock the hook, beats, on-screen text.",
    film: "Capture all footage on shot list.",
    edit: "Cut + add captions/text/thumbnail frame.",
    post_production: "Schedule across platforms.",
  },
};

// Per-assignee description overrides: type → stage → userId → description.
// Falls through to the generic STAGE_DESCRIPTIONS entry when no override exists.
const ASSIGNEE_DESCRIPTION_OVERRIDES: Record<string, Record<string, Record<string, string>>> = {
  mayday_video: {
    pre_production: {
      "7b1e50e0-cede-409d-a160-1aa6d1e232a9": "Map, Find, & Gather B-Roll video. Then, upload to its own folder inside of the Mayday folder in the Drive.", // Henry Neiman
      "ed7541f9-213d-4868-9147-5e638cbb6883": "Map, Find, & Gather B-Roll video. Then, upload to its own folder inside of the Mayday folder in the Drive.", // Caleb Bartholomae
    },
  },
};

function descriptionFor(projectType: string | null, stage: string, userId?: string): string | null {
  if (!projectType) return null;
  if (userId) {
    const override = ASSIGNEE_DESCRIPTION_OVERRIDES[projectType]?.[stage]?.[userId];
    if (override) return override;
  }
  return STAGE_DESCRIPTIONS[projectType]?.[stage as Stage] || null;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function getCaller(req: Request): Promise<{ userId: string; role: string } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  // Service-role bypass for internal calls (e.g., workflow-complete-task auto-advance).
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && authHeader === `Bearer ${serviceKey}`) {
    return { userId: "system", role: "admin" };
  }

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;
  const admin = getAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  return { userId: user.id, role: profile?.role || "" };
}

function labelFor(projectType: string | null, stage: string): string {
  if (stage === BACKLOG_STAGE) return "Backlog";
  if (!projectType) return stage;
  return STAGE_LABELS[projectType]?.[stage as Stage] || stage;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  const caller = await getCaller(req);
  if (!caller) return jsonResp({ error: "Unauthorized" }, 401);
  if (!["admin", "assistant", "member"].includes(caller.role)) {
    return jsonResp({ error: "Forbidden" }, 403);
  }
  // Service-role internal calls (auto-advance) have a synthetic "system" userId
  // that isn't a uuid — fall back to null so created_by/author_id inserts don't
  // blow up on the uuid columns. created_by is nullable.
  const actorId = caller.userId === "system" ? null : caller.userId;

  let body: { project_id?: string; target_stage?: string; handoff_note?: string };
  try { body = await req.json(); } catch { return jsonResp({ error: "Invalid JSON" }, 400); }

  const { project_id, target_stage, handoff_note } = body;
  if (!project_id) return jsonResp({ error: "project_id required" }, 400);
  if (!target_stage || !ALL_TARGETS.includes(target_stage as Stage | typeof BACKLOG_STAGE)) {
    return jsonResp({ error: "target_stage must be one of " + ALL_TARGETS.join(", ") }, 400);
  }
  const targetStage = target_stage as Stage | typeof BACKLOG_STAGE;

  const admin = getAdminClient();

  // Load project.
  const { data: project, error: projErr } = await admin
    .from("projects")
    .select("id, name, type, status, deadline, on_hold, stage_config")
    .eq("id", project_id)
    .single();
  if (projErr || !project) return jsonResp({ error: "Project not found" }, 404);

  if (project.type === null) {
    return jsonResp({ error: "Project has no type yet — tag it before moving" }, 400);
  }
  if (project.on_hold) {
    return jsonResp({ error: "Card is on hold; admin must unhold before moving" }, 403);
  }

  const currentStage = project.status as Stage | typeof BACKLOG_STAGE;
  if (currentStage === targetStage) {
    return jsonResp({ error: "Card already in target stage" }, 400);
  }

  // Backlog handling: parking lot below the board. No skip logic, no task fanout.
  const stageConfig = (project.stage_config || {}) as Record<string, { skip?: boolean }>;
  let resolvedTargetStage: Stage | typeof BACKLOG_STAGE;
  let isBackward = false;

  if (targetStage === BACKLOG_STAGE) {
    resolvedTargetStage = BACKLOG_STAGE;
  } else if (currentStage === BACKLOG_STAGE) {
    // Leaving backlog always re-enters at Queue. Auto-advance past any
    // queue-side skip flags in case the admin pre-skipped it.
    let qIdx = STAGES.indexOf("queue" as Stage);
    while (qIdx < STAGES.length && stageConfig[STAGES[qIdx]]?.skip) {
      qIdx += 1;
    }
    if (qIdx >= STAGES.length) {
      return jsonResp({ error: "All forward stages are skipped — clear a skip before pulling from backlog" }, 400);
    }
    resolvedTargetStage = STAGES[qIdx];
  } else {
    const currentIdx = STAGES.indexOf(currentStage as Stage);
    let targetIdx = STAGES.indexOf(targetStage as Stage);
    if (currentIdx < 0) return jsonResp({ error: `Project status "${currentStage}" not on canonical board` }, 400);
    isBackward = targetIdx < currentIdx;
    if (!isBackward) {
      while (targetIdx < STAGES.length && stageConfig[STAGES[targetIdx]]?.skip) {
        targetIdx += 1;
      }
      if (targetIdx >= STAGES.length) {
        return jsonResp({ error: "All forward stages are skipped — clear a skip before moving" }, 400);
      }
    }
    resolvedTargetStage = STAGES[targetIdx];
  }

  // Permission: forward = admin or assignee of current stage; backward + backlog ops = admin only.
  if (isBackward && caller.role !== "admin") {
    return jsonResp({ error: "Only admins can move a card backward" }, 403);
  }
  if ((targetStage === BACKLOG_STAGE || currentStage === BACKLOG_STAGE) && caller.role !== "admin") {
    return jsonResp({ error: "Only admins can move cards in or out of Backlog" }, 403);
  }
  if (!isBackward && caller.role !== "admin") {
    const { data: assigned } = await admin
      .from("project_stage_assignments")
      .select("user_id")
      .eq("project_id", project.id)
      .eq("stage", currentStage)
      .eq("user_id", caller.userId)
      .limit(1);
    if (!assigned || assigned.length === 0) {
      return jsonResp({ error: "You are not assigned to the current stage" }, 403);
    }
  }

  // Write handoff note (if provided).
  if (handoff_note && handoff_note.trim()) {
    await admin.from("project_card_handoffs").insert({
      project_id: project.id,
      from_stage: currentStage,
      to_stage: resolvedTargetStage,
      body: handoff_note.trim(),
      author_id: actorId,
    });
  }

  // Update project status (card move).
  const { error: updErr } = await admin
    .from("projects")
    .update({ status: resolvedTargetStage, updated_at: new Date().toISOString() })
    .eq("id", project.id);
  if (updErr) return jsonResp({ error: `Failed to update project: ${updErr.message}` }, 500);

  // Close open tasks for the current stage.
  const { data: closedTasks } = await admin
    .from("tasks")
    .update({ status: "complete", completed_at: new Date().toISOString() })
    .eq("related_entity_type", "project")
    .eq("related_entity_id", project.id)
    .in("step_key", currentStage === "research" ? ["research", "research_scope"] : [currentStage])
    .in("status", ["pending", "active", "on_hold"])
    .select("id");

  // Find target-stage assignees.
  const { data: targetAssignees } = await admin
    .from("project_stage_assignments")
    .select("user_id")
    .eq("project_id", project.id)
    .eq("stage", resolvedTargetStage);

  const assigneeIds = [...new Set((targetAssignees || []).map((a) => a.user_id))];
  const newTaskIds: string[] = [];
  const targetLabel = labelFor(project.type, resolvedTargetStage);
  const prevLabel = labelFor(project.type, currentStage);

  const taskTitle = `${project.name} — ${targetLabel}`;

  // Research stage: instead of fanning out to stage assignees, hand the
  // scope owner a "Set Research Scope" task. Its step_key is
  // 'research_scope' (not 'research') so completing it never auto-advances
  // the card — only the researcher tasks it spawns (step_key 'research')
  // trigger the all-done advance to Write in workflow-complete-task.
  const RESEARCH_SCOPE_OWNER = "c3290048-436b-46c6-b3f0-fdf7923d0c3b"; // Trevor May
  if (resolvedTargetStage === "research") {
    const { data: scopeTask, error: scopeErr } = await admin
      .from("tasks")
      .insert({
        step_key: "research_scope",
        title: `${project.name} — Set Research Scope`,
        description: "Define the research scope and assign researchers. The card moves to Write once every researcher marks their task complete.",
        assignee_id: RESEARCH_SCOPE_OWNER,
        status: "pending",
        related_entity_type: "project",
        related_entity_id: project.id,
        due_date: project.deadline,
        created_by: actorId,
      })
      .select("id")
      .single();
    if (scopeErr || !scopeTask) {
      console.error("Failed to insert research scope task:", scopeErr?.message);
    } else {
      newTaskIds.push(scopeTask.id);
      await admin.from("notifications").insert({
        user_id: RESEARCH_SCOPE_OWNER,
        type: "task_assigned",
        title: `Set research scope: ${project.name}`,
        body: "Card entered Research — set the scope and assign researchers.",
        link_tab: "my_tasks",
        link_target: scopeTask.id,
        is_read: false,
      });
    }
    return jsonResp({
      project_id: project.id,
      from_stage: currentStage,
      target_stage: resolvedTargetStage,
      direction: isBackward ? "backward" : "forward",
      closed_tasks: (closedTasks || []).length,
      new_task_ids: newTaskIds,
      assignee_count: 0,
    });
  }

  for (const userId of assigneeIds) {
    const stageDesc = descriptionFor(project.type, resolvedTargetStage, userId);
    const description = handoff_note && handoff_note.trim()
      ? `${stageDesc ? stageDesc + "\n\n" : ""}Handoff from ${prevLabel}:\n${handoff_note.trim()}`
      : (stageDesc || `Moved from ${prevLabel}.`);

    // Check if user routes project tasks directly to Sprint Board.
    const { data: userProfile } = await admin
      .from("profiles")
      .select("route_tasks_to_sprint")
      .eq("id", userId)
      .single();

    if (userProfile?.route_tasks_to_sprint) {
      // Sprint-routed: create a REAL tasks row (same as the default path) so
      // that completing the sprint card advances the project, exactly like a
      // workflow card. The row is then surfaced as a personal_tasks sprint card
      // instead of a My Tasks entry (skip notification). MyTasks dedupes any
      // task that has a sprint card, so the user still sees it in just one place.
      //
      // status 'active' (not 'pending') so the Sprint board Done handler's
      // `linked_task.status === 'active'` gate and workflow-complete-task's
      // active-only guard both pass. assignee_id is the card owner so the
      // function's assignee auth check passes when they complete it.
      const { data: task, error: taskErr } = await admin
        .from("tasks")
        .insert({
          step_key: resolvedTargetStage,
          title: taskTitle,
          description,
          assignee_id: userId,
          status: "active",
          related_entity_type: "project",
          related_entity_id: project.id,
          due_date: project.deadline,
          created_by: actorId,
        })
        .select("id")
        .single();
      if (taskErr || !task) {
        console.error("Failed to insert sprint-routed task:", taskErr?.message);
        continue;
      }
      newTaskIds.push(task.id);

      const { data: sprint } = await admin
        .from("sprints")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "active")
        .maybeSingle();
      const { data: maxPos } = await admin
        .from("personal_tasks")
        .select("position")
        .eq("created_by", userId)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
      await admin.from("personal_tasks").insert({
        created_by: userId,
        content: taskTitle,
        status: "in_progress",
        position: ((maxPos?.position as number) || 0) + 1,
        task_id: task.id,
        project_id: project.id,
        sprint_id: sprint?.id || null,
      });
      continue;
    }

    // Default path: create tasks row + notification.
    const { data: task, error: taskErr } = await admin
      .from("tasks")
      .insert({
        step_key: resolvedTargetStage,
        title: taskTitle,
        description,
        assignee_id: userId,
        status: "pending",
        related_entity_type: "project",
        related_entity_id: project.id,
        due_date: project.deadline,
        created_by: actorId,
      })
      .select("id")
      .single();
    if (taskErr || !task) {
      console.error("Failed to insert task:", taskErr?.message);
      continue;
    }
    newTaskIds.push(task.id);

    await admin.from("notifications").insert({
      user_id: userId,
      type: "task_assigned",
      title: `New task: ${project.name} — ${targetLabel}`,
      body: description,
      link_tab: "my_tasks",
      link_target: task.id,
      is_read: false,
    });
  }

  return jsonResp({
    project_id: project.id,
    from_stage: currentStage,
    target_stage: resolvedTargetStage,
    direction: isBackward ? "backward" : "forward",
    closed_tasks: (closedTasks || []).length,
    new_task_ids: newTaskIds,
    assignee_count: assigneeIds.length,
  });
});
