-- Seed the two existing automations (Payroll + Clip Video) and clean up
-- the old single-step workflow infrastructure they replace.

-- ─── Seed: Payroll automation ────────────────────────────────────
insert into public.automations (name, description, is_enabled, trigger_type, trigger_config, actions, dedup_key)
values (
  'Payroll Reminder',
  'Creates a "Run Payroll" task for all admins on the 1st and 15th of each month.',
  true,
  'schedule',
  '{"type": "days_of_month", "days": [1, 15], "time_utc": "15:00"}'::jsonb,
  '[{"type": "create_task", "config": {"title": "Run Payroll", "description": "Process payroll for this pay period.", "assignee_type": "all_admins", "step_key": "automation"}}]'::jsonb,
  'payroll_{{today}}'
);

-- ─── Seed: Clip Video automation ─────────────────────────────────
insert into public.automations (name, description, is_enabled, trigger_type, trigger_config, actions, dedup_key)
values (
  'Clip Video',
  'Creates a clip task for David Korn when a new non-short video is posted on More Mayday.',
  true,
  'event',
  '{"event": "new_video", "source": "More Mayday"}'::jsonb,
  '[{"type": "create_task", "config": {"title": "Video is ready to be clipped", "description": "{{video_title}}", "assignee_type": "specific", "assignee_id": "aff29906-eda8-4c3f-8a1e-a550b5bbe45d", "step_key": "automation", "link_url": "{{video_url}}"}}]'::jsonb,
  'clip_{{video_id}}'
);

-- ─── Remove old payroll cron job ─────────────────────────────────
select cron.unschedule('payroll-run-task');

-- Drop the old payroll SQL function
drop function if exists public.create_payroll_run_task();

-- ─── Deactivate old payroll and clip_video workflow rows ─────────
update public.workflows set is_active = false where slug in ('payroll', 'clip_video');
