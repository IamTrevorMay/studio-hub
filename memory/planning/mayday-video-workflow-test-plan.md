# Mayday Video Workflow — Test Plan (next session, any machine)

Built 2026-05-29 in commit `68a1dfb7`. Must be exercised end-to-end before relying on it. This file lives in `memory/planning/` so it travels across machines via git pull.

## Quick reference

- Slug: `mayday_video_workflow`
- Trigger: any `beat_sheets` row with `folder='mayday'` and `is_archived=false`
- Helper edge fn: `workflow-internal` (secret-authed)
- DB triggers: `mayday_video_start` on `beat_sheets`, `mayday_video_match_film` and `mayday_video_match_wait` on `freelancer_assignments`
- Client step mirror: `src/lib/workflowSteps.js` (entries for `pre_production`, `filming_prep`, `film_send_to_editor`, `wait_on_edit`, `thumbnail_schedule`)
- Reusable pattern memory: `pattern_editor_assignment_handoff.md`

## Pre-flight

1. Confirm migrations are applied on whichever DB you're testing against:
   - `20260530100000_mayday_video_workflow` (workflow row + steps + v1)
   - `20260530200000_mayday_video_triggers` (pg_net triggers)
2. Confirm `workflow-internal` is deployed: `supabase functions list --project-ref ytfjkoxowfskuibdsfea | grep workflow-internal`
3. Confirm `CRON_SECRET` env var on Supabase functions matches the secret embedded in the trigger URLs (`50EBC188-6315-49DF-8319-44736B5B655D` at time of writing).
4. **Important caveat**: All five steps are seeded with `assignee_value=''`. Until you assign them in the Workflows builder UI, the tasks won't show up in any user's My Tasks (the My Tasks query filters by `assignee_id=user.id`). Decide before testing whether to (a) assign Trevor (or a test user) to each step in the builder, or (b) build an unassigned-task admin view first.

## Happy path script

Run as admin in the local app pointed at the prod Supabase project.

1. **Kickoff**: open the Beat Sheets / Production page. Create a new beat sheet titled "Test MV Workflow" and move it into the Mayday folder.
   - Expected: workflow instance created. `select * from workflow_instances where workflow_id=(select id from workflows where slug='mayday_video_workflow') order by started_at desc limit 1;` should show a new row with `context={beat_sheet_id, beat_sheet_title}` and status=`active`.
   - Verify dedupe: edit the same beat sheet (e.g. nudge the title) — must NOT create a second instance.
2. **Step 1 — Pre-Production**:
   - Open My Tasks as the assignee. The task should read `Mayday Video Pre-Production: Test MV Workflow` with description "Complete beat sheet & update Broadcast." and a `Complete` button.
   - Click `Complete`. The confirm modal must appear ("Mark this task done? Test MV Workflow…"). Confirm.
   - Expected: task disappears; step 2 appears.
3. **Step 2 — Filming Prep**: same confirm-on-complete UX. Should advance to step 3.
4. **Step 3 — Film & Send to Editor**:
   - Task title `Film Video & Send to Editor: Test MV Workflow`.
   - Card shows an inline "Assign an editor" dropdown listing every active profile (admin + assistant + member + freelancer). NO primary Complete button.
   - Pick an editor (use Test1 or Test2). Confirm the dropdown value sticks after refresh: `select context from workflow_instances where id=<inst_id>;` should show `editor_id=<picked profile id>`.
   - Now go to **Contractors → Assignments** and create a real assignment for that editor (any title).
   - Expected: within a couple of seconds, step 3 disappears from My Tasks; step 4 appears. Confirm the workflow_instance's context now also has `editor_assignment_id=<new assignment id>`.
5. **Step 4 — Wait on Edit**:
   - Task title `Wait on Edit: Test MV Workflow` with italic "Waiting on editor" status text, no button.
   - As the contractor (Test1/Test2 logged in), open Contractor Dashboard and submit/complete the assignment so its status flips to `completed` in `freelancer_assignments`.
   - Expected: step 4 disappears; step 5 appears.
6. **Step 5 — Create Thumbnail & Schedule**: confirm-on-complete. Confirm. Workflow instance status flips to `complete`.

## Edge cases to poke

- **Move beat sheet OUT of Mayday folder mid-workflow**: nothing should happen to in-flight instance. Move it back in: should NOT start a second instance because dedupe still matches.
- **Archive the beat sheet**: should not start a new instance and should not crash in-flight task UI.
- **Editor assignment created for a DIFFERENT freelancer**: step 3 must stay open.
- **Editor assignment completed for an unrelated assignment**: step 4 must stay open (matches on assignment id, not freelancer id).
- **Pick a different editor on step 3 after the first pick** (without an assignment yet): context updates; old editor_id overwritten.
- **Pick an editor, then create assignment for the OLD editor before switching back**: assignment trigger should not match a different editor_id and should leave the task open.

## Failure modes / where to look if it breaks

- Triggers not firing → check `pg_net.http_request_queue` for queued posts; check function logs via Supabase dashboard for `workflow-internal`.
- Step 3 not auto-completing → verify the assignment row's `freelancer_id` actually equals the value stored in `workflow_instances.context.editor_id` (UUIDs come through as text in the JSON).
- Confirm modal not showing → step's `action_config.confirm` got dropped; check the workflow_steps row.
- Tasks not visible at all → assignee_value still empty on the workflow step. Fix in the Workflows builder.

## Open follow-ups (separate from testing)

- Decide assignee defaults for the five steps and either edit them in the builder or push a follow-up migration.
- Consider an "Unassigned tasks" admin view so empty-assignee workflows aren't silently invisible.
- Test secrets path: leak audit (`audit_phase1_security.md`) flagged `CRON_SECRET` as known-leaked. Rotation will require updating the trigger URLs.
