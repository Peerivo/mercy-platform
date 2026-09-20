-- Require explicit moderation before a new help request becomes public.
alter table public.help_requests
  add column if not exists review_status public.review_status not null default 'PENDING';

alter table public.help_requests
  add column if not exists reviewed_at timestamptz;

-- Preserve the visibility of requests that were already public before this gate.
update public.help_requests
set
  review_status = 'VERIFIED',
  reviewed_at = coalesce(reviewed_at, published_at)
where published_at is not null
  and review_status = 'PENDING';

-- New requests are unpublished until the moderation decision explicitly sets this.
alter table public.help_requests
  alter column published_at drop default;

comment on column public.help_requests.review_status is
  'Publication moderation state. PENDING requests are not public; VERIFIED requests may be published; REJECTED requests remain private.';
comment on column public.help_requests.reviewed_at is
  'Time of the latest moderation decision for this request.';

create index if not exists help_requests_review_queue_idx
  on public.help_requests (created_at)
  where review_status = 'PENDING';

create schema if not exists private;

create table if not exists private.help_request_moderation_tokens (
  id uuid primary key default gen_random_uuid(),
  help_request_id uuid not null references public.help_requests(id) on delete cascade,
  token_hash text not null unique
    check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists help_request_moderation_tokens_request_idx
  on private.help_request_moderation_tokens (help_request_id, created_at desc);

revoke all on table private.help_request_moderation_tokens
from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update, delete
on table private.help_request_moderation_tokens
to service_role;

create or replace function public.issue_help_request_moderation_token(
  case_id uuid,
  token_hash_text text,
  expires_at_input timestamptz
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if case_id is null
     or token_hash_text !~ '^[0-9a-f]{64}$'
     or expires_at_input <= now()
     or expires_at_input > now() + interval '2 days 5 minutes' then
    raise exception 'invalid moderation token';
  end if;

  if not exists (
    select 1
    from public.help_requests
    where id = case_id
      and review_status = 'PENDING'
  ) then
    raise exception 'request is not pending moderation';
  end if;

  update private.help_request_moderation_tokens
  set consumed_at = coalesce(consumed_at, now())
  where help_request_id = case_id
    and consumed_at is null;

  insert into private.help_request_moderation_tokens(
    help_request_id,
    token_hash,
    expires_at
  )
  values(case_id, token_hash_text, expires_at_input);
end;
$$;

revoke all on function public.issue_help_request_moderation_token(uuid,text,timestamptz)
from public, anon, authenticated;
grant execute on function public.issue_help_request_moderation_token(uuid,text,timestamptz)
to service_role;

create or replace function public.get_help_request_for_moderation(
  token_hash_text text
)
returns table (
  id uuid,
  case_number bigint,
  category text,
  country text,
  city text,
  description text,
  urgency text,
  request_status public.request_status,
  review_status public.review_status,
  created_at timestamptz,
  expires_at timestamptz
)
language sql
stable
security invoker
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
    h.created_at,
    t.expires_at
  from private.help_request_moderation_tokens t
  join public.help_requests h on h.id = t.help_request_id
  where t.token_hash = token_hash_text
    and t.consumed_at is null
    and t.expires_at > now()
    and h.review_status = 'PENDING'
  limit 1;
$$;

revoke all on function public.get_help_request_for_moderation(text)
from public, anon, authenticated;
grant execute on function public.get_help_request_for_moderation(text)
to service_role;

create or replace function public.moderate_help_request_by_token_hash(
  token_hash_text text,
  decision_text text
)
returns table (
  request_id uuid,
  new_review_status public.review_status,
  new_published_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  token_row private.help_request_moderation_tokens%rowtype;
  normalized_decision text := upper(trim(coalesce(decision_text, '')));
begin
  if normalized_decision not in ('APPROVE', 'REJECT') then
    raise exception 'invalid moderation decision';
  end if;

  select *
  into token_row
  from private.help_request_moderation_tokens
  where token_hash = token_hash_text
  for update;

  if not found
     or token_row.consumed_at is not null
     or token_row.expires_at <= now() then
    raise exception 'invalid or expired moderation token';
  end if;

  perform 1
  from public.help_requests
  where id = token_row.help_request_id
    and review_status = 'PENDING'
  for update;

  if not found then
    raise exception 'request is no longer pending moderation';
  end if;

  if normalized_decision = 'APPROVE' then
    update public.help_requests
    set
      review_status = 'VERIFIED',
      reviewed_at = now(),
      published_at = coalesce(published_at, now()),
      updated_at = now()
    where id = token_row.help_request_id;
  else
    update public.help_requests
    set
      review_status = 'REJECTED',
      reviewed_at = now(),
      published_at = null,
      updated_at = now()
    where id = token_row.help_request_id;
  end if;

  update private.help_request_moderation_tokens
  set consumed_at = coalesce(consumed_at, now())
  where help_request_id = token_row.help_request_id
    and consumed_at is null;

  insert into public.audit_events(
    actor_id,
    action,
    object_type,
    object_id,
    reason
  )
  values(
    null,
    case
      when normalized_decision = 'APPROVE' then 'HELP_REQUEST_APPROVED_BY_LINK'
      else 'HELP_REQUEST_REJECTED_BY_LINK'
    end,
    'help_request',
    token_row.help_request_id,
    '48-hour email moderation capability'
  );

  return query
  select
    h.id,
    h.review_status,
    h.published_at
  from public.help_requests h
  where h.id = token_row.help_request_id;
end;
$$;

revoke all on function public.moderate_help_request_by_token_hash(text,text)
from public, anon, authenticated;
grant execute on function public.moderate_help_request_by_token_hash(text,text)
to service_role;
