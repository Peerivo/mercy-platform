-- Medical rules gate a new VERIFIED decision and VERIFIED publication, but not
-- administrative blocking or qualification withdrawal of an existing profile.
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
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  if specialist is null or new_publication is null or new_qualification is null
      or reason_text is null or length(trim(reason_text)) not between 3 and 500 then
    raise exception 'invalid review';
  end if;

  select * into profile from public.specialist_profiles where id = specialist for update;
  if not found then raise exception 'profile not found'; end if;

  if profile.publication_status = 'PENDING' then
    if new_publication not in ('PUBLISHED', 'REJECTED', 'BLOCKED') then
      raise exception 'invalid review transition';
    end if;
  elsif profile.publication_status = 'PUBLISHED' then
    if not (
      (new_publication = 'BLOCKED' and new_qualification = profile.qualification_status)
      or
      (new_publication = 'PENDING' and profile.qualification_status = 'VERIFIED'
        and new_qualification in ('UNVERIFIED', 'PENDING', 'REJECTED'))
    ) then
      raise exception 'invalid review transition';
    end if;
  else
    raise exception 'profile is not reviewable';
  end if;

  if new_qualification = 'VERIFIED'
      and (profile.qualification_status <> 'VERIFIED' or new_publication = 'PUBLISHED')
      and exists (
        select 1 from unnest(profile.services) as service(category)
        where lower(trim(service.category)) like 'medical:%'
          and not exists (
            select 1 from public.qualification_requirements as requirement
            where requirement.active
              and lower(trim(requirement.country)) = lower(trim(profile.country))
              and lower(trim(requirement.service_category)) = lower(trim(service.category))
          )
      ) then
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
  ) values (specialist, auth.uid(), new_publication, new_qualification, trim(reason_text));
end
$$;

revoke all on function public.review_specialist(
  uuid, public.specialist_publication_status, public.qualification_status, text
) from public;
grant execute on function public.review_specialist(
  uuid, public.specialist_publication_status, public.qualification_status, text
) to authenticated;
