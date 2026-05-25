-- Fix: allow profile deletion by setting created_by to NULL instead of blocking
ALTER TABLE public.payroll_salaries
  DROP CONSTRAINT payroll_salaries_created_by_fkey,
  ADD CONSTRAINT payroll_salaries_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
