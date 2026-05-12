-- BusinessDev: per-user goals ordering + per-user Notes panel.

ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS position integer;

CREATE INDEX IF NOT EXISTS idx_goals_creator_position
  ON public.goals (created_by, scope, position);

CREATE TABLE IF NOT EXISTS public.bd_user_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  text       text NOT NULL,
  checked    boolean NOT NULL DEFAULT false,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bd_user_notes_user_position
  ON public.bd_user_notes (user_id, position);

ALTER TABLE public.bd_user_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bd_user_notes_select_own"
  ON public.bd_user_notes FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "bd_user_notes_insert_own"
  ON public.bd_user_notes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "bd_user_notes_update_own"
  ON public.bd_user_notes FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "bd_user_notes_delete_own"
  ON public.bd_user_notes FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
