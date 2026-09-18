-- Payroll page pay periods move from (1–14, 15–EOM) to (1–15, 16–EOM), matching
-- the contractor Hours page, fl_retainer_windows_in_period /
-- compute_freelancer_pay, and the Payroll Reminder automation (days 1 + 16).
--
-- payroll_paid / payroll_one_offs rows are keyed by period_start. The old
-- second-half period started on the 15th; the new one starts on the 16th, so
-- every "paid" mark for a 15th-start period would otherwise vanish from the
-- page. Shift them one day. No 16th-start rows exist, so the
-- (profile_id, period_start) unique key can't collide.
update public.payroll_paid
   set period_start = period_start + interval '1 day'
 where extract(day from period_start) = 15;

update public.payroll_one_offs
   set period_start = period_start + interval '1 day'
 where extract(day from period_start) = 15;
