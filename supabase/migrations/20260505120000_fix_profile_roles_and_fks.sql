-- 1. Expand the role CHECK constraint to include freelancer and partner
ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['admin','member','assistant','partner','freelancer']));

-- 2. Change NO ACTION foreign keys referencing profiles to SET NULL so profile deletion works
-- (only the ones that currently block deletion; CASCADE refs are already fine)

ALTER TABLE public.ad_read_proposals      DROP CONSTRAINT IF EXISTS ad_read_proposals_created_by_fkey,
  ADD CONSTRAINT ad_read_proposals_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.analytics_uploads      DROP CONSTRAINT IF EXISTS analytics_uploads_uploaded_by_fkey,
  ADD CONSTRAINT analytics_uploads_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.analytics_youtube      DROP CONSTRAINT IF EXISTS analytics_youtube_uploaded_by_fkey,
  ADD CONSTRAINT analytics_youtube_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.analytics_youtube_daily DROP CONSTRAINT IF EXISTS analytics_youtube_daily_uploaded_by_fkey,
  ADD CONSTRAINT analytics_youtube_daily_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.bd_initiatives         DROP CONSTRAINT IF EXISTS bd_initiatives_owner_id_fkey,
  ADD CONSTRAINT bd_initiatives_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.bd_initiatives         DROP CONSTRAINT IF EXISTS bd_initiatives_created_by_fkey,
  ADD CONSTRAINT bd_initiatives_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.bd_milestones          DROP CONSTRAINT IF EXISTS bd_milestones_created_by_fkey,
  ADD CONSTRAINT bd_milestones_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.bd_phases              DROP CONSTRAINT IF EXISTS bd_phases_created_by_fkey,
  ADD CONSTRAINT bd_phases_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.bd_settings            DROP CONSTRAINT IF EXISTS bd_settings_updated_by_fkey,
  ADD CONSTRAINT bd_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.bd_tasks               DROP CONSTRAINT IF EXISTS bd_tasks_owner_id_fkey,
  ADD CONSTRAINT bd_tasks_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.bd_tasks               DROP CONSTRAINT IF EXISTS bd_tasks_created_by_fkey,
  ADD CONSTRAINT bd_tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.beat_sheet_versions    DROP CONSTRAINT IF EXISTS beat_sheet_versions_saved_by_fkey,
  ADD CONSTRAINT beat_sheet_versions_saved_by_fkey FOREIGN KEY (saved_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.calendar_events        DROP CONSTRAINT IF EXISTS calendar_events_created_by_fkey,
  ADD CONSTRAINT calendar_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.channels               DROP CONSTRAINT IF EXISTS channels_created_by_fkey,
  ADD CONSTRAINT channels_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.concept_document_versions DROP CONSTRAINT IF EXISTS concept_document_versions_created_by_fkey,
  ADD CONSTRAINT concept_document_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.concepts               DROP CONSTRAINT IF EXISTS concepts_created_by_fkey,
  ADD CONSTRAINT concepts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.conversations          DROP CONSTRAINT IF EXISTS conversations_created_by_fkey,
  ADD CONSTRAINT conversations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.goals                  DROP CONSTRAINT IF EXISTS goals_created_by_fkey,
  ADD CONSTRAINT goals_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.initiatives            DROP CONSTRAINT IF EXISTS initiatives_created_by_fkey,
  ADD CONSTRAINT initiatives_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.invitations            DROP CONSTRAINT IF EXISTS invitations_invited_by_fkey,
  ADD CONSTRAINT invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.monthly_goals          DROP CONSTRAINT IF EXISTS monthly_goals_created_by_fkey,
  ADD CONSTRAINT monthly_goals_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.nav_config             DROP CONSTRAINT IF EXISTS nav_config_updated_by_fkey,
  ADD CONSTRAINT nav_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.project_attachments    DROP CONSTRAINT IF EXISTS project_attachments_uploaded_by_fkey,
  ADD CONSTRAINT project_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.project_checklists     DROP CONSTRAINT IF EXISTS project_checklists_created_by_fkey,
  ADD CONSTRAINT project_checklists_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.project_comments       DROP CONSTRAINT IF EXISTS project_comments_user_id_fkey,
  ADD CONSTRAINT project_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.projects               DROP CONSTRAINT IF EXISTS projects_created_by_fkey,
  ADD CONSTRAINT projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.research_reports       DROP CONSTRAINT IF EXISTS research_reports_created_by_fkey,
  ADD CONSTRAINT research_reports_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.resource_documents     DROP CONSTRAINT IF EXISTS resource_documents_created_by_fkey,
  ADD CONSTRAINT resource_documents_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.resource_folders       DROP CONSTRAINT IF EXISTS resource_folders_created_by_fkey,
  ADD CONSTRAINT resource_folders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.review_comments        DROP CONSTRAINT IF EXISTS review_comments_user_id_fkey,
  ADD CONSTRAINT review_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.review_details_comments DROP CONSTRAINT IF EXISTS review_details_comments_user_id_fkey,
  ADD CONSTRAINT review_details_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.review_replies         DROP CONSTRAINT IF EXISTS review_replies_user_id_fkey,
  ADD CONSTRAINT review_replies_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.review_thumbnails      DROP CONSTRAINT IF EXISTS review_thumbnails_uploaded_by_fkey,
  ADD CONSTRAINT review_thumbnails_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.review_titles          DROP CONSTRAINT IF EXISTS review_titles_created_by_fkey,
  ADD CONSTRAINT review_titles_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.review_versions        DROP CONSTRAINT IF EXISTS review_versions_created_by_fkey,
  ADD CONSTRAINT review_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.reviews                DROP CONSTRAINT IF EXISTS reviews_created_by_fkey,
  ADD CONSTRAINT reviews_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.script_annotation_replies DROP CONSTRAINT IF EXISTS script_annotation_replies_author_id_fkey,
  ADD CONSTRAINT script_annotation_replies_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.script_annotations     DROP CONSTRAINT IF EXISTS script_annotations_annotator_id_fkey,
  ADD CONSTRAINT script_annotations_annotator_id_fkey FOREIGN KEY (annotator_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.script_annotations     DROP CONSTRAINT IF EXISTS script_annotations_resolved_by_fkey,
  ADD CONSTRAINT script_annotations_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.script_review_versions DROP CONSTRAINT IF EXISTS script_review_versions_uploaded_by_fkey,
  ADD CONSTRAINT script_review_versions_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.script_reviews         DROP CONSTRAINT IF EXISTS script_reviews_created_by_fkey,
  ADD CONSTRAINT script_reviews_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.script_reviews         DROP CONSTRAINT IF EXISTS script_reviews_marked_ready_by_fkey,
  ADD CONSTRAINT script_reviews_marked_ready_by_fkey FOREIGN KEY (marked_ready_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.series                 DROP CONSTRAINT IF EXISTS series_created_by_fkey,
  ADD CONSTRAINT series_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.shorts_queue           DROP CONSTRAINT IF EXISTS shorts_queue_assigned_to_fkey,
  ADD CONSTRAINT shorts_queue_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.shorts_queue           DROP CONSTRAINT IF EXISTS shorts_queue_created_by_fkey,
  ADD CONSTRAINT shorts_queue_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.sponsors               DROP CONSTRAINT IF EXISTS sponsors_created_by_fkey,
  ADD CONSTRAINT sponsors_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.storyboard_assets      DROP CONSTRAINT IF EXISTS storyboard_assets_created_by_fkey,
  ADD CONSTRAINT storyboard_assets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
