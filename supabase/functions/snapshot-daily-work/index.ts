import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createHandler } from "../shared/handler.ts";

Deno.serve(
  createHandler({ auth: "cron", methods: ["POST"] }, async ({ admin }) => {
    // Compute today's date in Pacific time
    const now = new Date();
    const pacificDate = now.toLocaleDateString("en-CA", {
      timeZone: "America/Los_Angeles",
    }); // YYYY-MM-DD

    // Find all admin users
    const { data: admins, error: adminsError } = await admin
      .from("profiles")
      .select("id")
      .eq("role", "admin");

    if (adminsError) throw adminsError;
    if (!admins || admins.length === 0) {
      return new Response(
        JSON.stringify({ message: "No admin users found" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const summary: Record<string, { logged: number; archived: number }> = {};

    for (const adminUser of admins) {
      const userId = adminUser.id;

      // Get today's check-in (may not exist)
      const { data: checkin } = await admin
        .from("daily_checkins")
        .select("rating, note")
        .eq("user_id", userId)
        .eq("date", pacificDate)
        .maybeSingle();

      // Get active sprint
      const { data: sprint } = await admin
        .from("sprints")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "active")
        .maybeSingle();

      // Get done tasks in the active sprint
      const query = admin
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
      const { error: upsertError } = await admin
        .from("daily_work_logs")
        .upsert(rows, { onConflict: "user_id,date,task_id" });

      if (upsertError) throw upsertError;

      // Archive done tasks
      const taskIds = doneTasks.map((t) => t.id);
      const { error: archiveError } = await admin
        .from("personal_tasks")
        .update({ status: "archived", updated_at: new Date().toISOString() })
        .in("id", taskIds);

      if (archiveError) throw archiveError;

      summary[userId] = { logged: doneTasks.length, archived: taskIds.length };
    }

    return new Response(JSON.stringify({ date: pacificDate, summary }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  })
);
