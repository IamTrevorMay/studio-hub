-- Fix all NO ACTION foreign keys referencing profiles(id) that block user deletion.
-- Change them to either CASCADE (for child data that should be removed with the user)
-- or SET NULL (for audit/attribution columns that should be preserved).

-- beat_sheet_templates.created_by → SET NULL
ALTER TABLE public.beat_sheet_templates
  DROP CONSTRAINT beat_sheet_templates_created_by_fkey,
  ADD CONSTRAINT beat_sheet_templates_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- clipping_job_logs.created_by → SET NULL
ALTER TABLE public.clipping_job_logs
  DROP CONSTRAINT clipping_job_logs_created_by_fkey,
  ADD CONSTRAINT clipping_job_logs_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- concepts.created_by (duplicate constraint concepts_profile_fk) → drop the NO ACTION one
ALTER TABLE public.concepts DROP CONSTRAINT IF EXISTS concepts_profile_fk;

-- freelancer_assignment_comments.author_id → CASCADE (delete comments if user is removed)
ALTER TABLE public.freelancer_assignment_comments
  DROP CONSTRAINT freelancer_assignment_comments_author_id_fkey,
  ADD CONSTRAINT freelancer_assignment_comments_author_id_fkey
    FOREIGN KEY (author_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- freelancer_assignments.created_by → SET NULL
ALTER TABLE public.freelancer_assignments
  DROP CONSTRAINT freelancer_assignments_created_by_fkey,
  ADD CONSTRAINT freelancer_assignments_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- freelancer_assignments.freelancer_id → CASCADE (remove assignments if freelancer removed)
ALTER TABLE public.freelancer_assignments
  DROP CONSTRAINT freelancer_assignments_freelancer_id_fkey,
  ADD CONSTRAINT freelancer_assignments_freelancer_id_fkey
    FOREIGN KEY (freelancer_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- freelancer_documents.uploaded_by → SET NULL
ALTER TABLE public.freelancer_documents
  DROP CONSTRAINT freelancer_documents_uploaded_by_fkey,
  ADD CONSTRAINT freelancer_documents_uploaded_by_fkey
    FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- freelancer_hours.reviewed_by → SET NULL
ALTER TABLE public.freelancer_hours
  DROP CONSTRAINT freelancer_hours_reviewed_by_fkey,
  ADD CONSTRAINT freelancer_hours_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- freelancer_hours.freelancer_id → CASCADE
ALTER TABLE public.freelancer_hours
  DROP CONSTRAINT freelancer_hours_freelancer_id_fkey,
  ADD CONSTRAINT freelancer_hours_freelancer_id_fkey
    FOREIGN KEY (freelancer_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- invoice_contacts.created_by → SET NULL
ALTER TABLE public.invoice_contacts
  DROP CONSTRAINT invoice_contacts_created_by_fkey,
  ADD CONSTRAINT invoice_contacts_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- invoice_templates.created_by → SET NULL
ALTER TABLE public.invoice_templates
  DROP CONSTRAINT invoice_templates_created_by_fkey,
  ADD CONSTRAINT invoice_templates_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- invoices.created_by → SET NULL
ALTER TABLE public.invoices
  DROP CONSTRAINT invoices_created_by_fkey,
  ADD CONSTRAINT invoices_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- project_comments.user_id (duplicate constraint project_comments_profile_fk) → drop
ALTER TABLE public.project_comments DROP CONSTRAINT IF EXISTS project_comments_profile_fk;

-- read_slot_limits.created_by → SET NULL
ALTER TABLE public.read_slot_limits
  DROP CONSTRAINT read_slot_limits_created_by_fkey,
  ADD CONSTRAINT read_slot_limits_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- review_comments.user_id (duplicate constraint review_comments_profile_fk) → drop
ALTER TABLE public.review_comments DROP CONSTRAINT IF EXISTS review_comments_profile_fk;

-- review_replies.user_id (duplicate constraint review_replies_profile_fk) → drop
ALTER TABLE public.review_replies DROP CONSTRAINT IF EXISTS review_replies_profile_fk;

-- review_versions.created_by (duplicate constraint review_versions_profile_fk) → drop
ALTER TABLE public.review_versions DROP CONSTRAINT IF EXISTS review_versions_profile_fk;

-- reviews.created_by (duplicate constraint reviews_profile_fk) → drop
ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_profile_fk;
