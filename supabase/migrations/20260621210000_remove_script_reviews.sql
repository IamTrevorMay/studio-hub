-- Remove the Script Review feature entirely.
--
-- The frontend (Reviews page "Scripts" section + reviewer detail view, and the
-- Ideation writer-feedback/send-revision flow) has been removed. These tables
-- were all empty at drop time. CASCADE clears the self-referential FKs
-- (script_annotation_replies -> script_annotations -> script_reviews/versions,
-- concept_document_versions -> script_reviews); no external tables depend on them.

drop table if exists public.script_annotation_replies cascade;
drop table if exists public.script_annotations cascade;
drop table if exists public.script_review_versions cascade;
drop table if exists public.concept_document_versions cascade;
drop table if exists public.script_reviews cascade;

-- Remove the now-unused 'script-reviews' bucket's RLS policies (bucket was empty).
drop policy if exists "Auth read scripts" on storage.objects;
drop policy if exists "Auth upload scripts" on storage.objects;
drop policy if exists "Owner delete scripts" on storage.objects;

-- NOTE: the empty 'script-reviews' storage bucket itself must be deleted via the
-- Supabase dashboard / Storage API — direct DELETE on storage.buckets/objects is
-- blocked by storage.protect_delete().
