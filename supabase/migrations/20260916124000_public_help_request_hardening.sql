-- Make public visibility explicit without exposing the base table.
-- Existing requests preserve today's behavior: they are considered published.
alter table public.help_requests
  add column if not exists published_at timestamptz;

update public.help_requests
set published_at = created_at
where published_at is null;

alter table public.help_requests
  alter column published_at set default now();

comment on column public.help_requests.published_at is
  'Non-null means the request may be returned by the public safe RPC projection.';

create index if not exists help_requests_public_list_idx
  on public.help_requests (created_at desc)
  where published_at is not null;

-- These helpers must remain executable by authenticated because RLS policies
-- call them, but callers must never be able to probe another user by passing an
-- arbitrary uid to a SECURITY DEFINER function.
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(uid = auth.uid(), false)
    and exists (
      select 1
      from public.staff_roles
      where user_id = uid
        and role = 'ADMIN'
    );
$$;

create or replace function public.is_active_coordinator(
  case_id uuid,
  uid uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(uid = auth.uid(), false)
    and exists (
      select 1
      from public.case_assignments a
      join public.staff_roles r
        on r.user_id = a.coordinator_id
       and r.role = 'COORDINATOR'
      where a.help_request_id = case_id
        and a.coordinator_id = uid
        and a.revoked_at is null
    );
$$;

create or replace function public.can_access_case(
  case_id uuid,
  uid uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(uid = auth.uid(), false)
    and exists (
      select 1
      from public.help_requests h
      where h.id = case_id
        and (
          h.owner_id = uid
          or public.is_active_coordinator(case_id, uid)
        )
    );
$$;

revoke all on function public.is_admin(uuid) from public, anon;
revoke all on function public.is_active_coordinator(uuid,uuid) from public, anon;
revoke all on function public.can_access_case(uuid,uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated, service_role;
grant execute on function public.is_active_coordinator(uuid,uuid) to authenticated, service_role;
grant execute on function public.can_access_case(uuid,uuid) to authenticated, service_role;

-- Public detail is a narrow projection and now only returns explicitly
-- published requests.
create or replace function public.get_public_help_request(case_id uuid)
returns table (
  id uuid,
  case_number bigint,
  category text,
  country text,
  city text,
  description text,
  urgency text,
  status public.request_status,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    h.id,
    h.case_number,
    h.category::text,
    h.country::text,
    h.city::text,
    h.description::text,
    h.urgency::text,
    h.status,
    h.created_at
  from public.help_requests h
  where h.id = case_id
    and h.published_at is not null
  limit 1;
$$;

revoke all on function public.get_public_help_request(uuid) from public;
grant execute on function public.get_public_help_request(uuid) to anon, authenticated;

-- Public list keeps the existing filters but never returns an unpublished row.
create or replace function public.list_public_help_requests(
  category_filter text default null,
  city_filter text default null,
  urgency_filter text default null,
  state_filter text default 'ACTIVE',
  result_limit int default 20,
  result_offset int default 0
)
returns table (
  id uuid,
  case_number bigint,
  category text,
  country text,
  city text,
  description text,
  urgency text,
  status public.request_status,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_category text := nullif(trim(category_filter), '');
  normalized_city text := nullif(trim(city_filter), '');
  normalized_urgency text := nullif(trim(urgency_filter), '');
  normalized_state text := upper(
    coalesce(nullif(trim(state_filter), ''), 'ACTIVE')
  );
begin
  if normalized_category is not null
     and normalized_category not in (
       'PREGNANCY',
       'FAMILY',
       'HOUSING',
       'FOOD_GOODS',
       'LEGAL_DOCUMENTS',
       'WORK_EDUCATION',
       'OTHER'
     ) then
    raise exception 'invalid category';
  end if;

  if normalized_urgency is not null
     and normalized_urgency not in ('NORMAL', 'SOON', 'URGENT') then
    raise exception 'invalid urgency';
  end if;

  if normalized_state not in ('ACTIVE', 'COMPLETED', 'ALL') then
    raise exception 'invalid state';
  end if;

  return query
  select
    h.id,
    h.case_number,
    h.category::text,
    h.country::text,
    h.city::text,
    h.description::text,
    h.urgency::text,
    h.status,
    h.created_at
  from public.help_requests h
  where h.published_at is not null
    and (
      normalized_category is null
      or h.category = normalized_category
    )
    and (
      normalized_city is null
      or lower(h.city) like '%' || lower(normalized_city) || '%'
    )
    and (
      normalized_urgency is null
      or h.urgency = normalized_urgency
    )
    and (
      normalized_state = 'ALL'
      or (
        normalized_state = 'ACTIVE'
        and h.status not in ('RESOLVED', 'CLOSED')
      )
      or (
        normalized_state = 'COMPLETED'
        and h.status in ('RESOLVED', 'CLOSED')
      )
    )
  order by
    case h.urgency
      when 'URGENT' then 0
      when 'SOON' then 1
      else 2
    end,
    h.created_at desc
  limit least(greatest(result_limit, 1), 50)
  offset greatest(result_offset, 0);
end;
$$;

revoke all on function public.list_public_help_requests(
  text,text,text,text,int,int
) from public;
grant execute on function public.list_public_help_requests(
  text,text,text,text,int,int
) to anon, authenticated;

-- A hidden/unpublished request must not accept new direct responses even when
-- its UUID is known.
create or replace function public.respond_to_help_request(
  case_id uuid,
  payload jsonb,
  consent_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  response_id uuid;
  request_owner uuid;
  request_state public.request_status;
  response_message text := trim(coalesce(payload->>'message',''));
  response_contact text := trim(coalesce(payload->>'contact_method',''));
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if case_id is null or jsonb_typeof(payload) <> 'object'
     or consent_version <> 'help-response-v1' then
    raise exception 'invalid payload';
  end if;
  if length(response_message) not between 10 and 1500
     or length(response_contact) not between 2 and 200 then
    raise exception 'invalid response';
  end if;

  select owner_id, status
  into request_owner, request_state
  from public.help_requests
  where id = case_id
    and published_at is not null
  for update;

  if request_owner is null then raise exception 'request not found'; end if;
  if request_owner = auth.uid() then raise exception 'owner cannot respond'; end if;
  if request_state in ('RESOLVED','CLOSED') then
    raise exception 'request is completed';
  end if;
  if (
    select count(*)
    from public.help_request_responses
    where responder_id = auth.uid()
      and created_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'rate limit';
  end if;

  insert into public.help_request_responses(
    help_request_id,
    responder_id,
    message,
    contact_method
  )
  values(case_id, auth.uid(), response_message, response_contact)
  on conflict(help_request_id,responder_id) do update
    set message = excluded.message,
        contact_method = excluded.contact_method,
        status = 'PENDING',
        updated_at = now()
  returning id into response_id;

  insert into public.consents(
    user_id,
    help_response_id,
    kind,
    text_version
  )
  values(auth.uid(), response_id, 'HELP_RESPONSE', consent_version);

  return response_id;
end;
$$;

revoke all on function public.respond_to_help_request(uuid,jsonb,text)
from public, anon;
grant execute on function public.respond_to_help_request(uuid,jsonb,text)
to authenticated;
