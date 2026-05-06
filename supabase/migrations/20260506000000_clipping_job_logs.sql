CREATE TABLE public.clipping_job_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES profiles(id),
  source_filename TEXT NOT NULL DEFAULT '',
  video_title TEXT NOT NULL DEFAULT '',
  total_clips INT NOT NULL DEFAULT 0,
  successful_clips INT NOT NULL DEFAULT 0,
  failed_clips INT NOT NULL DEFAULT 0,
  recipients TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed','partial','failed')),
  error_output TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: admin read, any authenticated insert (own rows only)
ALTER TABLE public.clipping_job_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read clipping job logs"
  ON public.clipping_job_logs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Authenticated users can insert own logs"
  ON public.clipping_job_logs FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE INDEX clipping_job_logs_created_at_idx
  ON public.clipping_job_logs(created_at DESC);
