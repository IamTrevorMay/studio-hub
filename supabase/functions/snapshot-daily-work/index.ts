import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth: cron secret only
    const url = new URL(req.url);
    const cronSecret =
      url.searchParams.get("secret") || req.headers.get("x-cron-secret");
    const expectedSecret = Deno.env.get("CRON_SECRET");

    if (!expectedSecret || cronSecret !== expectedSecret) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Compute today's date in Pacific time
    const now = new Date();
    const pacificDate = now.toLocaleDateString("en-CA", {
      timeZone: "America/Los_Angeles",
    }); // YYYY-MM-DD

    // Find all admin users
    const { data: admins, error: adminsError } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "admin");

    if (adminsError) throw adminsError;
    if (!admins || admins.length === 0) {
      return new Response(
        JSON.stringify({ message: "No admin users found" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const summary: Record<string, { logged: number; archived: number }> = {};

    for (const admin of admins) {
      const userId = admin.id;

      // Get today's check-in (may not exist)
      const { data: checkin } = await supabase
        .from("daily_checkins")
        .select("rating, note")
        .eq("user_id", userId)
        .eq("date", pacificDate)
        .maybeSingle();

      // Get active sprint
      const { data: sprint } = await supabase
        .from("sprints")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "active")
        .maybeSingle();

      // Get done tasks in the active sprint
      const query = supabase
        .from("personal_tasks")
        .select("id, content, priority")
        .eq("created_by", userId)
        .eq("status", "done");

      if (sprint) {
        query.eq("sprint_id", sprint.id);
      }

      const { data: doneTasks, error: tasksError } = await query;
      if (tasksError) throw tasksError;

      if (!doneTasks || doneTasks.length === 0) {
        summary[userId] = { logged: 0, archived: 0 };
        continue;
      }

      // Calculate total points
      const dailyTotalPoints = doneTasks.reduce(
        (sum, t) => sum + (parseInt(t.priority) || 0),
        0
      );

      // Build rows for upsert
      const rows = doneTasks.map((task) => ({
        user_id: userId,
        date: pacificDate,
        check_in_score: checkin?.rating ?? null,
        check_in_note: checkin?.note ?? null,
        task_id: task.id,
        task_content: task.content || "",
        task_points: parseInt(task.priority) || 0,
        daily_total_points: dailyTotalPoints,
        sprint_id: sprint?.id ?? null,
      }));

      // Upsert into daily_work_logs
      const { error: upsertError } = await supabase
        .from("daily_work_logs")
        .upsert(rows, { onConflict: "user_id,date,task_id" });

      if (upsertError) throw upsertError;

      // Archive done tasks
      const taskIds = doneTasks.map((t) => t.id);
      const { error: archiveError } = await supabase
        .from("personal_tasks")
        .update({ status: "archived", updated_at: new Date().toISOString() })
        .in("id", taskIds);

      if (archiveError) throw archiveError;

      summary[userId] = { logged: doneTasks.length, archived: taskIds.length };
    }

    return new Response(
      JSON.stringify({ date: pacificDate, summary }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("snapshot-daily-work error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
