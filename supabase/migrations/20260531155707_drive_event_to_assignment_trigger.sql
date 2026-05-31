-- Bridge from drive_events to freelancer_assignments.
-- When an 'added' event lands for a video file uploaded by someone whose
-- profile.email matches and whose freelancer_profile is project-pay, insert
-- a completed assignment and mark the source event processed.

ALTER TABLE public.freelancer_assignments
  ADD COLUMN IF NOT EXISTS source_drive_event_id uuid REFERENCES public.drive_events(id) ON DELETE SET NULL;

-- Non-partial unique constraint so the trigger's ON CONFLICT clause can use it.
ALTER TABLE public.freelancer_assignments
  ADD CONSTRAINT freelancer_assignments_source_drive_event_id_key
  UNIQUE (source_drive_event_id);

CREATE OR REPLACE FUNCTION public.drive_event_to_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile_id uuid;
  v_rate       numeric;
BEGIN
  IF NEW.event_type <> 'added' THEN
    RETURN NEW;
  END IF;
  IF NEW.mime_type IS NULL OR NEW.mime_type NOT LIKE 'video/%' THEN
    RETURN NEW;
  END IF;
  IF NEW.uploader_email IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.id, fp.rate
    INTO v_profile_id, v_rate
  FROM public.profiles p
  JOIN public.freelancer_profiles fp ON fp.id = p.id
  WHERE p.role = 'freelancer'
    AND lower(p.email) = lower(NEW.uploader_email)
    AND fp.payment_type = 'project'
  LIMIT 1;

  IF v_profile_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.freelancer_assignments
    (freelancer_id, title, assignment_type, status, pay_amount,
     completed_at, asset_url, source_drive_event_id)
  VALUES
    (v_profile_id,
     coalesce(NEW.file_name, 'Drive upload'),
     'edit',
     'completed',
     coalesce(v_rate, 0),
     coalesce(NEW.created_time, NEW.created_at),
     NEW.web_view_link,
     NEW.id)
  ON CONFLICT (source_drive_event_id) DO NOTHING;

  UPDATE public.drive_events SET processed_at = now() WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_drive_event_to_assignment ON public.drive_events;
CREATE TRIGGER trg_drive_event_to_assignment
AFTER INSERT ON public.drive_events
FOR EACH ROW EXECUTE FUNCTION public.drive_event_to_assignment();
