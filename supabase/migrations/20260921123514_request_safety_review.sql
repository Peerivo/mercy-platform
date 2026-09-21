-- Trust & Safety: every new request is reviewed before public publication.
-- Existing published requests remain visible; existing unpublished rows stay closed.
alter table public.help_requests
  add column review_status public.review_status not null default 'PENDING',
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references auth.users,
  add column review_reason varchar(500),
  add column beneficiary_scope varchar(16) not null default 'SELF',
  add column beneficiary_consent_attested boolean not null default false,
  add column beneficiary_consent_verified_at timestamptz,
  add column interaction_mode varchar(24) not null default 'REMOTE_OR_PUBLIC',
  add column requester_identity_verified_at timestamptz;

update public.help_requests
set
  review_status = case
    when published_at is not null then 'VERIFIED'::public.review_status
    else 'REJECTED'::public.review_status
  end,
  reviewed_at = coalesce(published_at, updated_at, created_at),
  review_reason = case
    when published_at is not null then 'Backfill: published before request moderation'
    else 'Backfill: unpublished before request moderation'
  end;

alter table public.help_requests
  alter column published_at drop default,
  add constraint help_request_beneficiary_scope_check
    check (beneficiary_scope in ('SELF','OTHER')),
  add constraint help_request_beneficiary_consent_check
    check (beneficiary_scope = 'SELF' or beneficiary_consent_attested),
  add constraint help_request_interaction_mode_check
    check (interaction_mode in ('REMOTE_OR_PUBLIC','HOME_VISIT')),
  add constraint help_request_review_reason_check
    check (review_reason is null or length(trim(review_reason)) between 3 and 500),
  add constraint help_request_review_publication_check
    check (
      (review_status = 'VERIFIED' and published_at is not null)
      or
      (review_status <> 'VERIFIED' and published_at is null)
    );

create index help_requests_review_queue_idx
  on public.help_requests(review_status, created_at, id)
  where review_status = 'PENDING';

create or replace function public.create_help_request(
  payload jsonb,
  consent_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid uuid;
  request_beneficiary_scope text :=
    upper(coalesce(nullif(trim(payload->>'beneficiary_scope'), ''), 'SELF'));
  request_interaction_mode text :=
    upper(coalesce(nullif(trim(payload->>'interaction_mode'), ''), 'REMOTE_OR_PUBLIC'));
  consent_attested boolean :=
    coalesce((payload->>'beneficiary_consent_attested')::boolean, false);
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if jsonb_typeof(payload) <> 'object' then
    raise exception 'invalid payload';
  end if;

  if coalesce(payload->>'category','') not in (
    'PREGNANCY','FAMILY','HOUSING','FOOD_GOODS',
    'LEGAL_DOCUMENTS','WORK_EDUCATION','OTHER'
  )
  or length(trim(coalesce(payload->>'country',''))) not between 2 and 80
  or length(trim(coalesce(payload->>'city',''))) not between 2 and 120
  or length(trim(coalesce(payload->>'description',''))) not between 20 and 5000
  or coalesce(payload->>'urgency','') not in ('NORMAL','SOON','URGENT')
  or length(trim(coalesce(payload->>'contact_window',''))) > 120
  or length(trim(coalesce(payload->>'external_contact',''))) > 200 then
    raise exception 'invalid request';
  end if;

  if request_beneficiary_scope not in ('SELF','OTHER')
     or request_interaction_mode not in ('REMOTE_OR_PUBLIC','HOME_VISIT') then
    raise exception 'invalid safety scope';
  end if;

  if request_beneficiary_scope = 'OTHER' and not consent_attested then
    raise exception 'beneficiary consent attestation required';
  end if;

  if (
    select count(*)
    from public.help_requests
    where owner_id = auth.uid()
      and created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception 'rate limit';
  end if;

  insert into public.help_requests(
    owner_id, category, country, city, description, urgency,
    can_message, can_call, contact_window, external_contact,
    beneficiary_scope, beneficiary_consent_attested, interaction_mode
  )
  values(
    auth.uid(),
    trim(payload->>'category'),
    trim(payload->>'country'),
    trim(payload->>'city'),
    trim(payload->>'description'),
    trim(payload->>'urgency'),
    coalesce((payload->>'can_message')::boolean, true),
    coalesce((payload->>'can_call')::boolean, false),
    trim(coalesce(payload->>'contact_window','')),
    trim(coalesce(payload->>'external_contact','')),
    request_beneficiary_scope,
    consent_attested,
    request_interaction_mode
  )
  returning id into rid;

  insert into public.consents(user_id, help_request_id, kind, text_version)
  values(auth.uid(), rid, 'REQUEST_PROCESSING', consent_version);

  insert into public.audit_events(actor_id, action, object_type, object_id, reason)
  values(
    auth.uid(),
    'HELP_REQUEST_SUBMITTED_FOR_REVIEW',
    'help_request',
    rid,
    'pending moderation'
  );

  return rid;
end;
$$;

revoke all on function public.create_help_request(jsonb,text)
from public, anon;
grant execute on function public.create_help_request(jsonb,text)
to authenticated;

drop function public.get_public_help_request(uuid);

create function public.get_public_help_request(case_id uuid)
returns table (
  id uuid,
  case_number bigint,
  category text,
  country text,
  city text,
  description text,
  urgency text,
  status public.request_status,
  review_status public.review_status,
  interaction_mode text,
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
    h.review_status,
    h.interaction_mode::text,
    h.created_at
  from public.help_requests h
  where h.id = case_id
    and (
      (
        h.review_status = 'VERIFIED'
        and h.published_at is not null
      )
      or (
        auth.uid() is not null
        and private.can_access_case(h.id, auth.uid())
      )
    )
  limit 1;
$$;

revoke all on function public.get_public_help_request(uuid) from public;
grant execute on function public.get_public_help_request(uuid)
to anon, authenticated;

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
       'PREGNANCY','FAMILY','HOUSING','FOOD_GOODS',
       'LEGAL_DOCUMENTS','WORK_EDUCATION','OTHER'
     ) then
    raise exception 'invalid category';
  end if;

  if normalized_urgency is not null
     and normalized_urgency not in ('NORMAL','SOON','URGENT') then
    raise exception 'invalid urgency';
  end if;

  if normalized_state not in ('ACTIVE','COMPLETED','ALL') then
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
  where h.review_status = 'VERIFIED'
    and h.published_at is not null
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
        and h.status not in ('RESOLVED','CLOSED')
      )
      or (
        normalized_state = 'COMPLETED'
        and h.status in ('RESOLVED','CLOSED')
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

create function public.admin_pending_help_requests(
  request_limit int default 50,
  request_offset int default 0
)
returns table (
  id uuid,
  case_number bigint,
  category text,
  country text,
  city text,
  description text,
  urgency text,
  beneficiary_scope text,
  beneficiary_consent_attested boolean,
  interaction_mode text,
  can_message boolean,
  can_call boolean,
  contact_window text,
  external_contact text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'admin required';
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
    h.beneficiary_scope::text,
    h.beneficiary_consent_attested,
    h.interaction_mode::text,
    h.can_message,
    h.can_call,
    h.contact_window::text,
    h.external_contact::text,
    h.created_at
  from public.help_requests h
  where h.review_status = 'PENDING'
  order by h.created_at, h.id
  limit least(greatest(request_limit, 1), 50)
  offset greatest(request_offset, 0);
end;
$$;

revoke all on function public.admin_pending_help_requests(int,int)
from public, anon;
grant execute on function public.admin_pending_help_requests(int,int)
to authenticated;

create function public.moderate_help_request(
  request_id uuid,
  new_status public.review_status,
  reason_text text,
  beneficiary_consent_confirmed boolean default false,
  requester_identity_confirmed boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status public.review_status;
  current_beneficiary_scope text;
  current_interaction_mode text;
  normalized_reason text := trim(coalesce(reason_text, ''));
begin
  if not private.is_admin() then
    raise exception 'admin required';
  end if;

  if new_status not in ('VERIFIED','REJECTED')
     or length(normalized_reason) not between 3 and 500 then
    raise exception 'invalid review';
  end if;

  select review_status, beneficiary_scope, interaction_mode
  into current_status, current_beneficiary_scope, current_interaction_mode
  from public.help_requests
  where id = request_id
  for update;

  if current_status is null then
    raise exception 'request not found';
  end if;

  if current_status <> 'PENDING' then
    raise exception 'request already reviewed';
  end if;

  if new_status = 'VERIFIED' then
    if current_beneficiary_scope = 'OTHER'
       and not beneficiary_consent_confirmed then
      raise exception 'beneficiary consent confirmation required';
    end if;

    if current_interaction_mode = 'HOME_VISIT'
       and not requester_identity_confirmed then
      raise exception 'requester identity confirmation required';
    end if;

    update public.help_requests
    set
      review_status = 'VERIFIED',
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      review_reason = normalized_reason,
      beneficiary_consent_verified_at =
        case
          when current_beneficiary_scope = 'OTHER' then now()
          else beneficiary_consent_verified_at
        end,
      requester_identity_verified_at =
        case
          when current_interaction_mode = 'HOME_VISIT' then now()
          else requester_identity_verified_at
        end,
      published_at = now(),
      updated_at = now()
    where id = request_id;
  else
    update public.help_requests
    set
      review_status = 'REJECTED',
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      review_reason = normalized_reason,
      published_at = null,
      updated_at = now()
    where id = request_id;
  end if;

  insert into public.audit_events(actor_id, action, object_type, object_id, reason)
  values(
    auth.uid(),
    'HELP_REQUEST_' || new_status::text,
    'help_request',
    request_id,
    left(normalized_reason, 500)
  );
end;
$$;

revoke all on function public.moderate_help_request(
  uuid, public.review_status, text, boolean, boolean
) from public, anon;
grant execute on function public.moderate_help_request(
  uuid, public.review_status, text, boolean, boolean
) to authenticated;

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
  request_interaction_mode text;
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

  select owner_id, status, interaction_mode
  into request_owner, request_state, request_interaction_mode
  from public.help_requests
  where id = case_id
    and review_status = 'VERIFIED'
    and published_at is not null
  for update;

  if request_owner is null then raise exception 'request not found'; end if;
  if request_owner = auth.uid() then raise exception 'owner cannot respond'; end if;
  if request_state in ('RESOLVED','CLOSED') then
    raise exception 'request is completed';
  end if;
  if request_interaction_mode = 'HOME_VISIT' then
    raise exception 'home visit requires coordinator';
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
    help_request_id, responder_id, message, contact_method
  )
  values(case_id, auth.uid(), response_message, response_contact)
  on conflict(help_request_id,responder_id) do update
    set message = excluded.message,
        contact_method = excluded.contact_method,
        status = 'PENDING',
        updated_at = now()
  returning id into response_id;

  insert into public.consents(user_id, help_response_id, kind, text_version)
  values(auth.uid(), response_id, 'HELP_RESPONSE', consent_version);

  return response_id;
end;
$$;

revoke all on function public.respond_to_help_request(uuid,jsonb,text)
from public, anon;
grant execute on function public.respond_to_help_request(uuid,jsonb,text)
to authenticated;
