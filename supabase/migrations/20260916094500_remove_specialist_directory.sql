-- Mercy no longer owns professional/medical provider workflows.
-- Historical specialist migrations remain so clean database replay is deterministic;
-- this migration removes their resulting Postgres runtime objects.
-- The private Storage bucket is removed separately via the Storage API in GitHub Actions,
-- because hosted Supabase forbids direct writes to storage.objects/storage.buckets.

-- Remove obsolete Storage policies owned by the specialist contour.
drop policy if exists qualification_storage_owner_insert on storage.objects;
drop policy if exists qualification_storage_authorized_read on storage.objects;

-- Functions must be dropped before the view/types they depend on.
drop function if exists public.get_published_specialist(uuid);
drop function if exists public.search_specialists(text, text, text, text, boolean, integer, integer);
drop function if exists public.submit_specialist_profile();
drop function if exists public.save_specialist_profile(jsonb);
drop function if exists public.review_specialist(
  uuid,
  public.specialist_publication_status,
  public.qualification_status,
  text
);

drop view if exists public.published_specialists;

drop table if exists public.qualification_documents cascade;
drop table if exists public.specialist_status_events cascade;
drop table if exists public.qualification_requirements cascade;
drop table if exists public.specialist_profiles cascade;

drop type if exists public.qualification_status;
drop type if exists public.specialist_publication_status;
