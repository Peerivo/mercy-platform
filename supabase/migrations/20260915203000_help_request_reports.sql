create table public.help_request_reports (
  id uuid primary key default gen_random_uuid(),

  help_request_id uuid not null
    references public.help_requests(id)
    on delete cascade,

  reporter_id uuid
    references auth.users(id)
    on delete set null,

  -- Псевдонимный идентификатор браузера.
  -- Не является user id и не публикуется.
  reporter_token uuid not null,

  reason varchar(40) not null check (
    reason in (
      'FRAUD',
      'DANGEROUS',
      'PERSONAL_DATA',
      'OUTDATED',
      'OTHER'
    )
  ),

  details varchar(1000) not null default '',

  status varchar(20) not null default 'PENDING' check (
    status in (
      'PENDING',
      'RESOLVED',
      'DISMISSED'
    )
  ),

  created_at timestamptz not null default now(),

  reviewed_at timestamptz,

  reviewed_by uuid
    references auth.users(id)
    on delete set null,

  review_note varchar(500)
);

create index help_request_reports_pending_idx
on public.help_request_reports(status, created_at);

create index help_request_reports_request_idx
on public.help_request_reports(help_request_id, created_at);

-- Один браузер не может бесконечно жаловаться
-- на одну и ту же просьбу.
create unique index help_request_reports_browser_unique
on public.help_request_reports(
  help_request_id,
  reporter_token
);

-- Авторизованный пользователь также может
-- пожаловаться на одну просьбу только один раз.
create unique index help_request_reports_user_unique
on public.help_request_reports(
  help_request_id,
  reporter_id
)
where reporter_id is not null;


alter table public.help_request_reports
enable row level security;

revoke all
on table public.help_request_reports
from public, anon, authenticated;


-- Публичная отправка жалобы.
-- Работает и без регистрации.
create or replace function public.submit_help_request_report(
  case_id uuid,
  reason_code text,
  details_text text,
  reporter_token uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  existing_id uuid;
  report_id uuid;
  normalized_details text := trim(coalesce(details_text, ''));
begin
  if case_id is null then
    raise exception 'invalid request';
  end if;

  if reporter_token is null then
    raise exception 'invalid reporter token';
  end if;

  if not exists (
    select 1
    from public.help_requests h
    where h.id = case_id
  ) then
    raise exception 'request not found';
  end if;

  if reason_code not in (
    'FRAUD',
    'DANGEROUS',
    'PERSONAL_DATA',
    'OUTDATED',
    'OTHER'
  ) then
    raise exception 'invalid reason';
  end if;

  if length(normalized_details) > 1000 then
    raise exception 'details too long';
  end if;

  if reason_code = 'OTHER'
     and length(normalized_details) < 3 then
    raise exception 'details required';
  end if;

  -- Идемпотентность для одного браузера.
  select r.id
  into existing_id
  from public.help_request_reports r
  where r.help_request_id = case_id
    and r.reporter_token = submit_help_request_report.reporter_token
  limit 1;

  if existing_id is not null then
    return existing_id;
  end if;

  -- Идемпотентность для вошедшего пользователя,
  -- даже если он сменил browser token.
  if caller_id is not null then
    select r.id
    into existing_id
    from public.help_request_reports r
    where r.help_request_id = case_id
      and r.reporter_id = caller_id
    limit 1;

    if existing_id is not null then
      return existing_id;
    end if;
  end if;

  -- Простая защита от спама.
  if caller_id is null then
    if (
      select count(*)
      from public.help_request_reports r
      where r.reporter_token =
        submit_help_request_report.reporter_token
        and r.created_at > now() - interval '1 hour'
    ) >= 5 then
      raise exception 'rate limit';
    end if;
  else
    if (
      select count(*)
      from public.help_request_reports r
      where r.reporter_id = caller_id
        and r.created_at > now() - interval '1 hour'
    ) >= 10 then
      raise exception 'rate limit';
    end if;
  end if;

  insert into public.help_request_reports (
    help_request_id,
    reporter_id,
    reporter_token,
    reason,
    details
  )
  values (
    case_id,
    caller_id,
    reporter_token,
    reason_code,
    normalized_details
  )
  returning id into report_id;

  return report_id;
end;
$$;

revoke all
on function public.submit_help_request_report(
  uuid,
  text,
  text,
  uuid
)
from public;

grant execute
on function public.submit_help_request_report(
  uuid,
  text,
  text,
  uuid
)
to anon, authenticated;


-- Безопасная очередь жалоб для администратора.
-- Не возвращаем reporter_id и reporter_token.
create or replace function public.admin_help_request_reports(
  report_limit int default 50,
  report_offset int default 0
)
returns table (
  report_id uuid,
  help_request_id uuid,
  case_number bigint,
  category text,
  city text,
  description text,
  request_status public.request_status,
  reason text,
  details text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin required';
  end if;

  return query
  select
    r.id,
    h.id,
    h.case_number,
    h.category::text,
    h.city::text,
    h.description::text,
    h.status,
    r.reason::text,
    r.details::text,
    r.created_at
  from public.help_request_reports r
  join public.help_requests h
    on h.id = r.help_request_id
  where r.status = 'PENDING'
  order by r.created_at
  limit least(greatest(report_limit, 1), 100)
  offset greatest(report_offset, 0);
end;
$$;

revoke all
on function public.admin_help_request_reports(int, int)
from public, anon;

grant execute
on function public.admin_help_request_reports(int, int)
to authenticated;


create or replace function public.review_help_request_report(
  report_id uuid,
  new_status text,
  note_text text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_note text := trim(coalesce(note_text, ''));
begin
  if not public.is_admin() then
    raise exception 'admin required';
  end if;

  if new_status not in ('RESOLVED', 'DISMISSED') then
    raise exception 'invalid status';
  end if;

  if length(normalized_note) < 3
     or length(normalized_note) > 500 then
    raise exception 'invalid note';
  end if;

  update public.help_request_reports
  set
    status = new_status,
    reviewed_at = now(),
    reviewed_by = auth.uid(),
    review_note = normalized_note
  where id = report_id
    and status = 'PENDING';

  if not found then
    raise exception 'report not found or already reviewed';
  end if;

  insert into public.audit_events (
    actor_id,
    action,
    object_type,
    object_id,
    reason
  )
  values (
    auth.uid(),
    'HELP_REQUEST_REPORT_REVIEWED',
    'help_request_report',
    report_id,
    left(new_status || ': ' || normalized_note, 500)
  );
end;
$$;

revoke all
on function public.review_help_request_report(
  uuid,
  text,
  text
)
from public, anon;

grant execute
on function public.review_help_request_report(
  uuid,
  text,
  text
)
to authenticated;