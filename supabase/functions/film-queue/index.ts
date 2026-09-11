// Film Queue engine.
// Actions:
//   { action: "enqueue_ideas", items: [{ idea_id, queue_type, writer_id, editor_id }] }
//     — staff JWT. Creates a beat sheet + queue item per idea, hands the
//       writer an fq_write task, and removes the idea. No project card.
//   { action: "lock_session", force? }
//     — cron (x-cron-secret) or admin JWT. The 6am job: gates on 6am PT,
//       locks the session dated today, packs approved items, generates the
//       call sheet, compiles the prompter session into Trevor's teleprompter
//       library, and notifies admins. `force: true` (admin only) locks the
//       next unlocked session regardless of date — the manual
//       "Lock & generate now" button on Call Sheets.
// Deploy: supabase functions deploy film-queue --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  getUserFromJwt,
  getAdminClient,
  corsHeaders,
  jsonResp,
} from "../shared/workflow-engine.ts";
import {
  FILM_QUEUE_REVIEWER,
  DEFAULT_MINUTES,
  QUEUE_TYPE_TO_SHEET_TAG,
  defaultMinutesFor,
  packSession,
  ptNow,
  compilePrompterSession,
  createFilmQueueTask,
} from "../shared/film-queue.ts";

const STAFF_ROLES = ["admin", "director", "director_creative", "director_comms", "member"];

// Deep-clone template beats with fresh ids (mirrors cloneBeatsFresh in MyTasks.js).
function cloneBeatsFresh(items: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return (items || []).map((item) => {
    if (item?.type === "segment") {
      return {
        ...item,
        id: crypto.randomUUID(),
        children: ((item.children as Array<Record<string, unknown>>) || []).map((b) => ({
          ...b,
          id: crypto.randomUUID(),
          graphics: [...((b.graphics as unknown[]) || [])],
          videos: [...((b.videos as unknown[]) || [])],
        })),
      };
    }
    return {
      ...item,
      id: crypto.randomUUID(),
      graphics: [...((item.graphics as unknown[]) || [])],
      videos: [...((item.videos as unknown[]) || [])],
    };
  });
}

function newBeatRow() {
  return { id: crypto.randomUUID(), title: "", context: "", graphics: [], videos: [], notes: "" };
}

// deno-lint-ignore no-explicit-any
async function notifyAdmins(admin: any, title: string, body: string, linkTab: string) {
  const { data: admins } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .is("deactivated_at", null);
  for (const a of admins || []) {
    await admin.from("notifications").insert({
      user_id: a.id,
      type: "automation",
      title,
      body,
      link_tab: linkTab,
      is_read: false,
    });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  const admin = getAdminClient();

  // Cron secret or staff JWT.
  const cronSecret = Deno.env.get("CRON_SECRET");
  const providedSecret =
    req.headers.get("x-cron-secret") ?? new URL(req.url).searchParams.get("secret");
  const isCron = !!cronSecret && providedSecret === cronSecret;

  let auth: Awaited<ReturnType<typeof getUserFromJwt>> = null;
  if (!isCron) {
    auth = await getUserFromJwt(req);
    if (!auth || !STAFF_ROLES.includes(auth.role ?? "")) {
      return jsonResp({ error: "Unauthorized" }, 401);
    }
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "Invalid JSON" }, 400);
  }
  const action = String(body.action || "");

  // ─── enqueue_ideas ──────────────────────────────────────────
  if (action === "enqueue_ideas") {
    if (isCron) return jsonResp({ error: "enqueue_ideas needs a user" }, 400);
    const items = Array.isArray(body.items) ? (body.items as Array<Record<string, unknown>>) : [];
    if (items.length === 0) return jsonResp({ error: "items required" }, 400);

    // Beat sheet tag ids by label, one lookup for the batch.
    const { data: sheetTags } = await admin
      .from("beat_sheet_tags")
      .select("id, label");
    const tagIdByLabel: Record<string, string> = {};
    for (const t of sheetTags || []) tagIdByLabel[t.label] = t.id;

    // Mayday sheets clone the Mayday Video template; other types start blank.
    const { data: tpl } = await admin
      .from("beat_sheet_templates")
      .select("beats")
      .eq("name", "Mayday Video")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Append to the end of the Backlog section.
    const { data: lastRow } = await admin
      .from("beat_sheets")
      .select("position")
      .eq("section", "backlog")
      .eq("is_archived", false)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    let nextPosition = (lastRow?.position ?? -1) + 1;

    const created: Array<Record<string, unknown>> = [];
    const errors: Array<Record<string, unknown>> = [];

    for (const entry of items) {
      const ideaId = String(entry.idea_id || "");
      const queueType = String(entry.queue_type || "");
      const writerId = String(entry.writer_id || "");
      const editorId = entry.editor_id ? String(entry.editor_id) : null;
      try {
        if (!(queueType in DEFAULT_MINUTES)) throw new Error(`invalid queue_type ${queueType}`);
        if (!writerId) throw new Error("writer required");

        const { data: idea, error: ideaErr } = await admin
          .from("write_ideas")
          .select("id, text, context, potential_titles")
          .eq("id", ideaId)
          .single();
        if (ideaErr || !idea) throw new Error("idea not found");

        const beats =
          queueType === "mayday" && tpl?.beats?.length
            ? cloneBeatsFresh(tpl.beats)
            : [newBeatRow()];
        const tagLabel = QUEUE_TYPE_TO_SHEET_TAG[queueType];
        const tagIds = tagLabel && tagIdByLabel[tagLabel] ? [tagIdByLabel[tagLabel]] : [];

        const { data: sheet, error: sheetErr } = await admin
          .from("beat_sheets")
          .insert({
            user_id: auth!.userId,
            title: idea.text,
            beats,
            tag_ids: tagIds,
            status: "drafting",
            estimated_minutes: defaultMinutesFor(queueType),
            section: "backlog",
            position: nextPosition,
          })
          .select("id, title")
          .single();
        if (sheetErr || !sheet) throw new Error(`sheet insert failed: ${sheetErr?.message}`);
        nextPosition += 1;

        const { data: qItem, error: qErr } = await admin
          .from("film_queue_items")
          .insert({
            beat_sheet_id: sheet.id,
            queue_type: queueType,
            writer_id: writerId,
            editor_id: editorId,
            source_context: idea.context || null,
            source_titles: Array.isArray(idea.potential_titles) ? idea.potential_titles : [],
            created_by: auth!.userId,
          })
          .select("id")
          .single();
        if (qErr || !qItem) {
          // Don't strand a sheet with no queue item.
          await admin.from("beat_sheets").delete().eq("id", sheet.id);
          throw new Error(`queue item insert failed: ${qErr?.message}`);
        }

        const task = await createFilmQueueTask(admin, {
          stepKey: "fq_write",
          title: `${sheet.title} — Beat Sheet`,
          description:
            "Write the beat sheet (open it from this task), then hit Complete to send it for review.",
          assigneeId: writerId,
          itemId: qItem.id,
          createdBy: auth!.userId,
          notifyTitle: "New beat sheet to write",
          notifyBody: `"${sheet.title}" was added to the film queue and assigned to you.`,
        });

        await admin.from("write_ideas").delete().eq("id", ideaId);
        created.push({ idea_id: ideaId, beat_sheet_id: sheet.id, queue_item_id: qItem.id, task_id: task?.id || null });
      } catch (err) {
        errors.push({ idea_id: ideaId, error: (err as Error).message });
      }
    }

    return jsonResp({ created, errors });
  }

  // ─── lock_session (the 6am job) ─────────────────────────────
  if (action === "lock_session") {
    const force = body.force === true;
    if (force && !isCron && !auth?.isAdmin) {
      return jsonResp({ error: "Forbidden" }, 403);
    }
    if (!isCron && !auth?.isAdmin) return jsonResp({ error: "Forbidden" }, 403);

    const { isoDate, hour } = ptNow();
    // Two UTC cron slots cover PDT and PST; only the one landing on 6am PT runs.
    if (isCron && hour !== 6) {
      return jsonResp({ skipped: `outside 6am PT window (PT hour ${hour})` });
    }

    let sessionQuery = admin
      .from("film_sessions")
      .select("id, session_date")
      .is("locked_at", null)
      .order("session_date", { ascending: true })
      .limit(1);
    if (!force) sessionQuery = sessionQuery.eq("session_date", isoDate);
    const { data: sessions } = await sessionQuery;
    const session = sessions?.[0];
    if (!session) {
      return jsonResp({ skipped: force ? "no unlocked session" : `no session dated ${isoDate}` });
    }

    // Approved, unpacked queue items.
    const { data: candidates, error: candErr } = await admin
      .from("film_queue_items")
      .select("id, queue_type, created_at, sheet:beat_sheets!inner(id, title, beats, status, estimated_minutes, approved_at)")
      .eq("state", "queued")
      .is("session_id", null)
      .eq("sheet.status", "approved");
    if (candErr) return jsonResp({ error: `candidate load failed: ${candErr.message}` }, 500);

    const lineItems = (candidates || []).map((c) => ({
      id: c.id,
      queue_type: c.queue_type,
      estimated_minutes: c.sheet?.estimated_minutes,
      approved_at: c.sheet?.approved_at,
      created_at: c.created_at,
      sheet: c.sheet,
    }));
    const { packed, totalMinutes } = packSession(lineItems);

    const nowIso = new Date().toISOString();

    // Stamp the pack: session membership, slate order, and the sheet's film
    // date (the packer sets film_date, never a human).
    for (let i = 0; i < packed.length; i++) {
      const item = packed[i];
      await admin
        .from("film_queue_items")
        .update({ session_id: session.id, slate_order: i + 1, updated_at: nowIso })
        .eq("id", item.id);
      await admin
        .from("beat_sheets")
        .update({ film_date: session.session_date })
        .eq("id", item.sheet.id);
    }

    await admin
      .from("film_sessions")
      .update({ locked_at: nowIso, packed_minutes: totalMinutes, packed_count: packed.length })
      .eq("id", session.id);

    if (packed.length === 0) {
      await notifyAdmins(
        admin,
        "Film session locked with nothing to pack",
        `No approved beat sheets were in the line for ${session.session_date}. No call sheet was generated.`,
        "projects",
      );
      return jsonResp({ locked: session.id, packed: 0, call_sheet: null });
    }

    // Call sheet snapshot.
    const snapshot = packed.map((item, i) => ({
      slate: i + 1,
      queue_item_id: item.id,
      beat_sheet_id: item.sheet.id,
      title: item.sheet.title,
      queue_type: item.queue_type,
      estimated_minutes: Number(item.estimated_minutes) || defaultMinutesFor(item.queue_type),
      beats: item.sheet.beats || [],
    }));
    const { data: callSheet, error: csErr } = await admin
      .from("call_sheets")
      .insert({
        session_id: session.id,
        session_date: session.session_date,
        slate_count: packed.length,
        items: snapshot,
        created_by: auth?.userId || null,
      })
      .select("id")
      .single();
    if (csErr) {
      await notifyAdmins(
        admin,
        "Call sheet generation failed",
        `Session ${session.session_date} locked, but the call sheet insert failed: ${csErr.message}`,
        "projects",
      );
      return jsonResp({ error: `call sheet insert failed: ${csErr.message}` }, 500);
    }

    // Compile + push the prompter session into the reviewer's library.
    const scriptName = `Film Session — ${session.session_date}`;
    let prompterError: string | null = null;
    try {
      const html = compilePrompterSession(
        snapshot.map((s) => ({ title: s.title, queue_type: s.queue_type, beats: s.beats })),
      );
      await admin
        .from("teleprompter_scripts")
        .delete()
        .eq("user_id", FILM_QUEUE_REVIEWER)
        .eq("name", scriptName);
      const { error: scriptErr } = await admin.from("teleprompter_scripts").insert({
        user_id: FILM_QUEUE_REVIEWER,
        name: scriptName,
        content: html,
      });
      if (scriptErr) prompterError = scriptErr.message;
    } catch (err) {
      prompterError = (err as Error).message;
    }

    if (prompterError) {
      await notifyAdmins(
        admin,
        "Prompter push failed",
        `The call sheet for ${session.session_date} is ready, but pushing "${scriptName}" to the teleprompter failed: ${prompterError}`,
        "call_sheets",
      );
    } else {
      await notifyAdmins(
        admin,
        "Call sheet ready",
        `${packed.length} slate${packed.length === 1 ? "" : "s"}, ${totalMinutes} min packed for ${session.session_date}. Prompter session "${scriptName}" is in the library.`,
        "call_sheets",
      );
    }

    return jsonResp({
      locked: session.id,
      packed: packed.length,
      total_minutes: totalMinutes,
      call_sheet: callSheet.id,
      prompter_error: prompterError,
    });
  }

  return jsonResp({ error: `Unknown action: ${action}` }, 400);
});
