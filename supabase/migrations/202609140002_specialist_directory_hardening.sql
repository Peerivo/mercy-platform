-- Keep public specialist reads bounded and require a submitted profile before review.
-- The underlying projection remains private; callers use the bounded search and
-- single-card RPCs instead of an unrestricted PostgREST collection endpoint.
revoke all on public.published_specialists from anon, authenticated;

create function public.get_published_specialist(specialist_id uuid)
returns setof public.published_specialists
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.display_name,
    p.description,
    p.country,
    p.city,
    p.travel_area,
    p.specializations,
    p.services,
    p.languages,
    p.work_formats,
    p.qualification_status,
    case when p.show_contacts then p.contact_details else null end,
    p.published_at
  from public.specialist_profiles as p
  where p.id = specialist_id
    and p.publication_status = 'PUBLISHED'
  limit 1
$$;

revoke all on function public.get_published_specialist(uuid) from public;
grant execute on function public.get_published_specialist(uuid) to anon, authenticated;

create or replace function public.review_specialist(
  specialist uuid,
  new_publication public.specialist_publication_status,
  new_qualification public.qualification_status,
  reason_text text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile public.specialist_profiles%rowtype;
  medical_without_rule boolean;
begin
  if not public.is_admin() then
    raise exception 'admin required';
  end if;
  if new_publication not in ('PUBLISHED', 'REJECTED', 'BLOCKED')
      or length(trim(reason_text)) not between 3 and 500 then
    raise exception 'invalid review';
  end if;

  select * into profile
  from public.specialist_profiles
  where id = specialist
  for update;
  if not found then
    raise exception 'profile not found';
  end if;
  if profile.publication_status <> 'PENDING' then
    raise exception 'profile is not pending review';
  end if;

  select new_qualification = 'VERIFIED'
    and exists (
      select 1 from unnest(profile.services) as service
      where lower(service) like 'medical:%'
    )
    and not exists (
      select 1
      from public.qualification_requirements as requirement
      where requirement.active
        and requirement.country = profile.country
        and requirement.service_category = any(profile.services)
    )
  into medical_without_rule;
  if medical_without_rule then
    raise exception 'medical qualification requirements are not configured';
  end if;

  update public.specialist_profiles
  set publication_status = new_publication,
      qualification_status = new_qualification,
      published_at = case when new_publication = 'PUBLISHED' then now() else null end,
      updated_at = now()
  where id = specialist;

  insert into public.specialist_status_events(
    specialist_id, actor_id, publication_status, qualification_status, reason
  ) values (
    specialist, auth.uid(), new_publication, new_qualification, left(trim(reason_text), 500)
  );
end
$$;

revoke all on function public.review_specialist(
  uuid, public.specialist_publication_status, public.qualification_status, text
) from public;
grant execute on function public.review_specialist(
  uuid, public.specialist_publication_status, public.qualification_status, text
) to authenticated;
