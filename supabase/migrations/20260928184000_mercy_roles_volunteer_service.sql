-- Mercy roles, ESIA-gated volunteer service and curator controls.
-- Base USER is implied by an authenticated account. VISITOR is derived from
-- an active ESIA identity link. Effectful roles live in audited grants.

create type public.mercy_role as enum ('VOLUNTEER','CURATOR','PATRON','ADMIN');
create type public.patron_kind as enum ('PERSON','SOLE_PROPRIETOR','LEGAL_ENTITY','GOVERNMENT');
create type public.volunteer_service_status as enum ('ONBOARDING','ACTIVE','PAUSED','SUSPENDED');
create type public.home_visit_clearance as enum ('NOT_CLEARED','CLEARED','SUSPENDED');
create type public.volunteer_assignment_mode as enum ('REMOTE','PUBLIC_PLACE','HOME_PAIRED');
create type public.beneficiary_consent_status as enum ('NOT_REQUIRED','PENDING','CONFIRMED','DECLINED');
create type public.volunteer_incident_status as enum ('OPEN','REVIEWING','RESOLVED');

create table public.mercy_role_grants(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  role public.mercy_role not null,
  granted_by uuid references auth.users on delete set null,
  reason varchar(500) not null check(length(trim(reason)) between 3 and 500),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users on delete set null,
  revoke_reason varchar(500),
  check(revoke_reason is null or length(trim(revoke_reason)) between 3 and 500)
);
create unique index mercy_role_grants_active_uq
  on public.mercy_role_grants(user_id,role) where revoked_at is null;
create index mercy_role_grants_role_idx
  on public.mercy_role_grants(role,user_id) where revoked_at is null;

create table public.volunteer_profiles(
  user_id uuid primary key references auth.users on delete cascade,
  service_status public.volunteer_service_status not null default 'ONBOARDING',
  service_categories text[] not null default '{}',
  available_online boolean not null default false,
  home_visit_clearance public.home_visit_clearance not null default 'NOT_CLEARED',
  home_visit_cleared_by uuid references auth.users on delete set null,
  home_visit_cleared_at timestamptz,
  supervision_required boolean not null default true,
  updated_by uuid references auth.users on delete set null,
  updated_at timestamptz not null default now(),
  check(cardinality(service_categories) <= 12)
);

create table public.patron_profiles(
  user_id uuid primary key references auth.users on delete cascade,
  kind public.patron_kind not null,
  display_name varchar(200),
  updated_by uuid references auth.users on delete set null,
  updated_at timestamptz not null default now(),
  check(display_name is null or length(trim(display_name)) between 2 and 200)
);

create table public.volunteer_contact_persons(
  id uuid primary key default gen_random_uuid(),
  volunteer_id uuid not null references auth.users on delete cascade,
  display_name varchar(160) not null check(length(trim(display_name)) between 2 and 160),
  relationship varchar(120) not null check(length(trim(relationship)) between 2 and 120),
  contact_method varchar(240) not null check(length(trim(contact_method)) between 2 and 240),
  linked_user_id uuid references auth.users on delete set null,
  consent_confirmed_at timestamptz not null,
  created_by uuid not null references auth.users on delete restrict,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users on delete set null,
  revoke_reason varchar(500)
);
create index volunteer_contact_persons_active_idx
  on public.volunteer_contact_persons(volunteer_id,created_at)
  where revoked_at is null;

create table public.help_request_safety(
  help_request_id uuid primary key references public.help_requests on delete cascade,
  beneficiary_is_requester boolean not null default true,
  beneficiary_consent_status public.beneficiary_consent_status not null default 'PENDING',
  home_visit_approved boolean not null default false,
  recorded_by uuid not null references auth.users on delete restrict,
  recorded_at timestamptz not null default now(),
  note varchar(500),
  check(note is null or length(trim(note)) between 3 and 500),
  check(
    not home_visit_approved
    or beneficiary_consent_status in ('NOT_REQUIRED','CONFIRMED')
  )
);

create table public.volunteer_case_assignments(
  id uuid primary key default gen_random_uuid(),
  help_request_id uuid not null references public.help_requests on delete cascade,
  volunteer_id uuid not null references auth.users on delete cascade,
  assigned_by uuid not null references auth.users on delete restrict,
  assignment_mode public.volunteer_assignment_mode not null,
  task_summary varchar(500) not null check(length(trim(task_summary)) between 3 and 500),
  companion_user_id uuid references auth.users on delete set null,
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references auth.users on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users on delete set null,
  close_reason varchar(500),
  check(volunteer_id is distinct from companion_user_id),
  check(close_reason is null or length(trim(close_reason)) between 3 and 500)
);
create unique index volunteer_case_assignments_active_uq
  on public.volunteer_case_assignments(help_request_id,volunteer_id)
  where completed_at is null and revoked_at is null;
create index volunteer_case_assignments_volunteer_idx
  on public.volunteer_case_assignments(volunteer_id,assigned_at desc)
  where completed_at is null and revoked_at is null;
create index volunteer_case_assignments_case_idx
  on public.volunteer_case_assignments(help_request_id,assigned_at desc)
  where completed_at is null and revoked_at is null;

create table public.volunteer_incidents(
  id uuid primary key default gen_random_uuid(),
  volunteer_id uuid not null references auth.users on delete cascade,
  help_request_id uuid references public.help_requests on delete set null,
  opened_by uuid not null references auth.users on delete restrict,
  category varchar(80) not null check(length(trim(category)) between 3 and 80),
  summary varchar(1000) not null check(length(trim(summary)) between 10 and 1000),
  status public.volunteer_incident_status not null default 'OPEN',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users on delete set null,
  resolution_note varchar(1000),
  check(resolution_note is null or length(trim(resolution_note)) between 3 and 1000)
);
create index volunteer_incidents_open_idx
  on public.volunteer_incidents(volunteer_id,created_at desc)
  where status <> 'RESOLVED';

alter table public.mercy_role_grants enable row level security;
alter table public.volunteer_profiles enable row level security;
alter table public.patron_profiles enable row level security;
alter table public.volunteer_contact_persons enable row level security;
alter table public.help_request_safety enable row level security;
alter table public.volunteer_case_assignments enable row level security;
alter table public.volunteer_incidents enable row level security;

revoke all on public.mercy_role_grants from public,anon,authenticated,service_role;
revoke all on public.volunteer_profiles from public,anon,authenticated,service_role;
revoke all on public.patron_profiles from public,anon,authenticated,service_role;
revoke all on public.volunteer_contact_persons from public,anon,authenticated,service_role;
revoke all on public.help_request_safety from public,anon,authenticated,service_role;
revoke all on public.volunteer_case_assignments from public,anon,authenticated,service_role;
revoke all on public.volunteer_incidents from public,anon,authenticated,service_role;

insert into public.mercy_role_grants(user_id,role,granted_by,reason,granted_at)
select
  r.user_id,
  case r.role when 'COORDINATOR' then 'CURATOR'::public.mercy_role else 'ADMIN'::public.mercy_role end,
  r.granted_by,
  'legacy staff role migration',
  r.granted_at
from public.staff_roles r
where not exists(
  select 1 from public.mercy_role_grants g
  where g.user_id=r.user_id
    and g.role=case r.role when 'COORDINATOR' then 'CURATOR'::public.mercy_role else 'ADMIN'::public.mercy_role end
    and g.revoked_at is null
);

create or replace function private.has_active_esia(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select uid is not null and exists(
    select 1
    from public.identity_links i
    where i.local_user_id=uid
      and lower(i.provider)='esia'
      and i.revoked_at is null
  );
$$;

create or replace function private.has_mercy_role(
  target_role public.mercy_role,
  uid uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select uid is not null and (
    exists(
      select 1 from public.mercy_role_grants g
      where g.user_id=uid and g.role=target_role and g.revoked_at is null
    )
    or (
      target_role='ADMIN'::public.mercy_role
      and exists(select 1 from public.staff_roles r where r.user_id=uid and r.role='ADMIN')
    )
    or (
      target_role='CURATOR'::public.mercy_role
      and exists(select 1 from public.staff_roles r where r.user_id=uid and r.role='COORDINATOR')
    )
  );
$$;

create or replace function private.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(uid=auth.uid(),false)
    and private.has_mercy_role('ADMIN'::public.mercy_role,uid);
$$;

create or replace function private.is_active_coordinator(
  case_id uuid,
  uid uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select
    coalesce(uid=auth.uid(),false)
    and exists(
      select 1
      from public.case_assignments a
      join public.staff_roles r on r.user_id=a.coordinator_id
      where a.help_request_id=case_id
        and a.coordinator_id=uid
        and a.revoked_at is null
        and (
          (r.role='ADMIN' and private.has_mercy_role('ADMIN'::public.mercy_role,uid))
          or (
            r.role='COORDINATOR'
            and private.has_active_esia(uid)
            and private.has_mercy_role('CURATOR'::public.mercy_role,uid)
          )
        )
    );
$$;

create or replace function private.can_access_case(
  case_id uuid,
  uid uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select
    coalesce(uid=auth.uid(),false)
    and exists(
      select 1
      from public.help_requests h
      where h.id=case_id
        and (
          h.owner_id=uid
          or private.is_active_coordinator(case_id,uid)
          or exists(
            select 1
            from public.volunteer_case_assignments a
            join public.volunteer_profiles vp on vp.user_id=a.volunteer_id
            where a.help_request_id=case_id
              and a.volunteer_id=uid
              and a.completed_at is null
              and a.revoked_at is null
              and vp.service_status='ACTIVE'
              and private.has_active_esia(uid)
              and private.has_mercy_role('VOLUNTEER'::public.mercy_role,uid)
          )
        )
    );
$$;

revoke all on function private.has_active_esia(uuid) from public,anon,authenticated,service_role;
revoke all on function private.has_mercy_role(public.mercy_role,uuid) from public,anon,authenticated,service_role;
revoke all on function private.is_admin(uuid) from public,anon,authenticated,service_role;
revoke all on function private.is_active_coordinator(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.can_access_case(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.is_admin(uuid) to authenticated,service_role;
grant execute on function private.is_active_coordinator(uuid,uuid) to authenticated,service_role;
grant execute on function private.can_access_case(uuid,uuid) to authenticated,service_role;

create or replace function public.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path=''
as $
  select case
    when private.is_admin() then 'ADMIN'::public.staff_role
    when private.has_active_esia(auth.uid())
         and private.has_mercy_role('CURATOR'::public.mercy_role,auth.uid())
      then 'COORDINATOR'::public.staff_role
    else null
  end;
$;

create or replace function public.staff_coordinators(coordinator_limit int default 100)
returns table(id uuid, display_name text)
language sql
stable
security definer
set search_path=''
as $
  select
    r.user_id,
    coalesce(nullif(trim(p.alias), ''), 'Куратор ' || left(r.user_id::text, 8))
  from public.staff_roles r
  left join public.profiles p on p.id=r.user_id
  where private.is_admin()
    and (
      (r.role='ADMIN' and private.has_mercy_role('ADMIN'::public.mercy_role,r.user_id))
      or (
        r.role='COORDINATOR'
        and private.has_active_esia(r.user_id)
        and private.has_mercy_role('CURATOR'::public.mercy_role,r.user_id)
      )
    )
  group by r.user_id,p.alias
  order by coalesce(nullif(trim(p.alias),''),r.user_id::text)
  limit least(greatest(coordinator_limit,1),100);
$;

create or replace function public.coordinator_cases(
  case_limit int default 20,
  case_offset int default 0
)
returns table(
  id uuid,
  case_number bigint,
  category text,
  city text,
  urgency text,
  status public.request_status,
  created_at timestamptz
)
language sql
stable
security definer
set search_path=''
as $
  select h.id,h.case_number,h.category::text,h.city::text,h.urgency::text,h.status,h.created_at
  from public.help_requests h
  join public.case_assignments a
    on a.help_request_id=h.id and a.revoked_at is null
  where a.coordinator_id=auth.uid()
    and private.is_active_coordinator(h.id,auth.uid())
  order by h.updated_at desc,h.id
  limit least(greatest(case_limit,1),100)
  offset greatest(case_offset,0);
$;

create or replace function public.assign_case(
  case_id uuid,
  new_coordinator uuid,
  reason_text text
)
returns void
language plpgsql
security definer
set search_path=''
as $
declare
  clean_reason text := trim(coalesce(reason_text,''));
begin
  if not private.is_admin() then raise exception 'admin required'; end if;
  if case_id is null or new_coordinator is null then raise exception 'invalid assignment'; end if;
  if length(clean_reason) not between 3 and 500 then raise exception 'reason required'; end if;
  if not exists(select 1 from public.help_requests where id=case_id) then
    raise exception 'request not found';
  end if;
  if not (
    private.has_mercy_role('ADMIN'::public.mercy_role,new_coordinator)
    or (
      private.has_active_esia(new_coordinator)
      and private.has_mercy_role('CURATOR'::public.mercy_role,new_coordinator)
    )
  ) then
    raise exception 'verified curator role required';
  end if;

  update public.case_assignments
  set revoked_at=now(),
      revoked_by=auth.uid(),
      revoke_reason='reassigned: ' || left(clean_reason,450)
  where help_request_id=case_id and revoked_at is null;

  insert into public.case_assignments(help_request_id,coordinator_id,assigned_by,reason)
  values(case_id,new_coordinator,auth.uid(),clean_reason);

  update public.help_requests
  set status=case when status='NEW' then 'ASSIGNED' else status end,
      updated_at=now()
  where id=case_id;

  insert into public.audit_events(actor_id,action,object_type,object_id,reason)
  values(auth.uid(),'CASE_ASSIGNED','help_request',case_id,left(clean_reason,500));
end;
$;

revoke all on function public.current_staff_role() from public,anon;
revoke all on function public.staff_coordinators(int) from public,anon;
revoke all on function public.coordinator_cases(int,int) from public,anon;
revoke all on function public.assign_case(uuid,uuid,text) from public,anon;
grant execute on function public.current_staff_role() to authenticated;
grant execute on function public.staff_coordinators(int) to authenticated;
grant execute on function public.coordinator_cases(int,int) to authenticated;
grant execute on function public.assign_case(uuid,uuid,text) to authenticated;

create function public.current_mercy_access()
returns table(
  base_role text,
  identity_role text,
  is_esia_verified boolean,
  is_volunteer boolean,
  is_curator boolean,
  is_patron boolean,
  is_admin boolean,
  volunteer_status text,
  patron_kind text
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then raise exception 'authentication required'; end if;

  return query
  select
    'USER'::text,
    case when private.has_active_esia(caller) then 'VISITOR'::text else 'USER'::text end,
    private.has_active_esia(caller),
    private.has_mercy_role('VOLUNTEER'::public.mercy_role,caller),
    (
      private.has_active_esia(caller)
      and private.has_mercy_role('CURATOR'::public.mercy_role,caller)
    ),
    private.has_mercy_role('PATRON'::public.mercy_role,caller),
    private.has_mercy_role('ADMIN'::public.mercy_role,caller),
    (select vp.service_status::text from public.volunteer_profiles vp where vp.user_id=caller),
    (select pp.kind::text from public.patron_profiles pp where pp.user_id=caller);
end;
$$;

create function public.staff_find_user_by_email(exact_email text)
returns table(
  id uuid,
  email text,
  display_name text,
  city text,
  is_esia_verified boolean,
  roles text[],
  patron_kind text
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  caller uuid := auth.uid();
  normalized_email text := lower(trim(coalesce(exact_email,'')));
  authorized boolean;
begin
  authorized :=
    private.is_admin(caller)
    or (
      private.has_active_esia(caller)
      and private.has_mercy_role('CURATOR'::public.mercy_role,caller)
    );

  if caller is null or not authorized then raise exception 'curator required'; end if;
  if length(normalized_email) not between 3 and 320
     or position('@' in normalized_email) < 2 then
    raise exception 'exact email required';
  end if;

  return query
  select
    u.id,
    u.email::text,
    coalesce(nullif(trim(p.alias),''),split_part(u.email,'@',1))::text,
    p.city::text,
    private.has_active_esia(u.id),
    array_remove(array[
      'USER'::text,
      case when private.has_active_esia(u.id) then 'VISITOR'::text end,
      case when private.has_mercy_role('VOLUNTEER'::public.mercy_role,u.id) then 'VOLUNTEER'::text end,
      case when private.has_mercy_role('CURATOR'::public.mercy_role,u.id) then 'CURATOR'::text end,
      case when private.has_mercy_role('PATRON'::public.mercy_role,u.id) then 'PATRON'::text end,
      case when private.has_mercy_role('ADMIN'::public.mercy_role,u.id) then 'ADMIN'::text end
    ],null),
    pp.kind::text
  from auth.users u
  left join public.profiles p on p.id=u.id
  left join public.patron_profiles pp on pp.user_id=u.id
  where lower(u.email)=normalized_email
  limit 1;
end;
$$;

create function public.manage_mercy_role(
  target_user uuid,
  target_role public.mercy_role,
  enabled boolean,
  reason_text text,
  patron_type public.patron_kind default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  caller uuid := auth.uid();
  clean_reason text := trim(coalesce(reason_text,''));
  caller_admin boolean;
  caller_curator boolean;
  admin_count integer;
begin
  if caller is null then raise exception 'authentication required'; end if;
  if target_user is null or target_role is null or enabled is null then raise exception 'invalid role change'; end if;
  if length(clean_reason) not between 3 and 500 then raise exception 'reason required'; end if;
  if not exists(select 1 from auth.users where id=target_user) then raise exception 'user not found'; end if;

  caller_admin := private.is_admin(caller);
  caller_curator :=
    private.has_active_esia(caller)
    and private.has_mercy_role('CURATOR'::public.mercy_role,caller);

  if not caller_admin
     and not (caller_curator and target_role in ('VOLUNTEER','PATRON')) then
    raise exception 'role management denied';
  end if;

  if target_role in ('CURATOR','ADMIN') and not caller_admin then
    raise exception 'admin required';
  end if;

  if enabled
     and target_role in ('VOLUNTEER','CURATOR','ADMIN')
     and not private.has_active_esia(target_user) then
    raise exception 'esia verification required';
  end if;

  if target_role='PATRON' and enabled and patron_type is null then
    raise exception 'patron type required';
  end if;

  if not enabled and target_role='ADMIN' then
    if target_user=caller then raise exception 'cannot revoke own admin role'; end if;
    select count(distinct x.user_id) into admin_count
    from (
      select g.user_id
      from public.mercy_role_grants g
      where g.role='ADMIN' and g.revoked_at is null
      union
      select r.user_id from public.staff_roles r where r.role='ADMIN'
    ) x;
    if admin_count <= 1 then raise exception 'last admin cannot be revoked'; end if;
  end if;

  if enabled then
    if not exists(
      select 1 from public.mercy_role_grants
      where user_id=target_user and role=target_role and revoked_at is null
    ) then
      insert into public.mercy_role_grants(user_id,role,granted_by,reason)
      values(target_user,target_role,caller,clean_reason);
    end if;

    if target_role='VOLUNTEER' then
      insert into public.volunteer_profiles(user_id,updated_by)
      values(target_user,caller)
      on conflict(user_id) do update
        set updated_by=excluded.updated_by,updated_at=now();
    elsif target_role='PATRON' then
      insert into public.patron_profiles(user_id,kind,updated_by)
      values(target_user,patron_type,caller)
      on conflict(user_id) do update
        set kind=excluded.kind,updated_by=excluded.updated_by,updated_at=now();
    elsif target_role='CURATOR' then
      insert into public.staff_roles(user_id,role,granted_by)
      values(target_user,'COORDINATOR',caller)
      on conflict(user_id,role) do nothing;
    elsif target_role='ADMIN' then
      insert into public.staff_roles(user_id,role,granted_by)
      values(target_user,'ADMIN',caller)
      on conflict(user_id,role) do nothing;
    end if;
  else
    update public.mercy_role_grants
    set revoked_at=now(),revoked_by=caller,revoke_reason=clean_reason
    where user_id=target_user and role=target_role and revoked_at is null;

    if target_role='VOLUNTEER' then
      update public.volunteer_profiles
      set service_status='PAUSED',updated_by=caller,updated_at=now()
      where user_id=target_user;
      update public.volunteer_case_assignments
      set revoked_at=now(),revoked_by=caller,close_reason='role revoked'
      where volunteer_id=target_user and completed_at is null and revoked_at is null;
    elsif target_role='CURATOR' then
      delete from public.staff_roles where user_id=target_user and role='COORDINATOR';
    elsif target_role='ADMIN' then
      delete from public.staff_roles where user_id=target_user and role='ADMIN';
    end if;
  end if;

  insert into public.audit_events(actor_id,action,object_type,object_id,reason)
  values(
    caller,
    case when enabled then 'MERCY_ROLE_GRANTED' else 'MERCY_ROLE_REVOKED' end,
    'user',
    target_user,
    left(target_role::text || ': ' || clean_reason,500)
  );
end;
$$;

create or replace function public.set_staff_role(
  target_user uuid,
  target_role public.staff_role,
  enabled boolean,
  reason_text text
)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  perform public.manage_mercy_role(
    target_user,
    case target_role
      when 'COORDINATOR' then 'CURATOR'::public.mercy_role
      else 'ADMIN'::public.mercy_role
    end,
    enabled,
    reason_text,
    null
  );
end;
$$;

create function public.staff_volunteers(
  city_filter text default null,
  status_filter public.volunteer_service_status default null,
  category_filter text default null,
  home_filter public.home_visit_clearance default null,
  result_limit int default 50,
  result_offset int default 0
)
returns table(
  user_id uuid,
  display_name text,
  email text,
  city text,
  service_status public.volunteer_service_status,
  service_categories text[],
  available_online boolean,
  home_visit_clearance public.home_visit_clearance,
  supervision_required boolean,
  active_assignments bigint
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  caller uuid := auth.uid();
  clean_city text := nullif(trim(coalesce(city_filter,'')),'');
  clean_category text := nullif(trim(coalesce(category_filter,'')),'');
begin
  if caller is null
     or not (
       private.is_admin(caller)
       or (
         private.has_active_esia(caller)
         and private.has_mercy_role('CURATOR'::public.mercy_role,caller)
       )
     ) then
    raise exception 'curator required';
  end if;
  if clean_city is not null and length(clean_city)>120 then raise exception 'invalid city'; end if;
  if clean_category is not null
     and clean_category not in ('THINGS','TRANSPORT','FOOD','CHILDCARE','EDUCATION_WORK','OTHER') then
    raise exception 'invalid category';
  end if;

  return query
  select
    u.id,
    coalesce(nullif(trim(p.alias),''),split_part(u.email,'@',1))::text,
    u.email::text,
    p.city::text,
    vp.service_status,
    vp.service_categories,
    vp.available_online,
    vp.home_visit_clearance,
    vp.supervision_required,
    (
      select count(*)
      from public.volunteer_case_assignments a
      where a.volunteer_id=u.id and a.completed_at is null and a.revoked_at is null
    )::bigint
  from auth.users u
  join public.volunteer_profiles vp on vp.user_id=u.id
  left join public.profiles p on p.id=u.id
  where private.has_mercy_role('VOLUNTEER'::public.mercy_role,u.id)
    and private.has_active_esia(u.id)
    and (clean_city is null or lower(coalesce(p.city,'')) like '%' || lower(clean_city) || '%')
    and (status_filter is null or vp.service_status=status_filter)
    and (clean_category is null or clean_category=any(vp.service_categories))
    and (home_filter is null or vp.home_visit_clearance=home_filter)
  order by coalesce(nullif(trim(p.city),''),'~'),coalesce(nullif(trim(p.alias),''),u.email),u.id
  limit least(greatest(result_limit,1),100)
  offset greatest(result_offset,0);
end;
$$;

create function public.volunteer_service_stats()
returns table(
  total_volunteers bigint,
  active_volunteers bigint,
  onboarding_volunteers bigint,
  paused_volunteers bigint,
  suspended_volunteers bigint,
  cities bigint,
  active_assignments bigint,
  completed_assignments_30d bigint,
  open_incidents bigint
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null
     or not (
       private.is_admin(caller)
       or (
         private.has_active_esia(caller)
         and private.has_mercy_role('CURATOR'::public.mercy_role,caller)
       )
     ) then raise exception 'curator required'; end if;

  return query
  select
    count(*)::bigint,
    count(*) filter(where vp.service_status='ACTIVE')::bigint,
    count(*) filter(where vp.service_status='ONBOARDING')::bigint,
    count(*) filter(where vp.service_status='PAUSED')::bigint,
    count(*) filter(where vp.service_status='SUSPENDED')::bigint,
    count(distinct nullif(trim(p.city),''))::bigint,
    (select count(*) from public.volunteer_case_assignments a where a.completed_at is null and a.revoked_at is null)::bigint,
    (select count(*) from public.volunteer_case_assignments a where a.completed_at>=now()-interval '30 days')::bigint,
    (select count(*) from public.volunteer_incidents i where i.status<>'RESOLVED')::bigint
  from public.volunteer_profiles vp
  join auth.users u on u.id=vp.user_id
  left join public.profiles p on p.id=vp.user_id
  where private.has_mercy_role('VOLUNTEER'::public.mercy_role,vp.user_id)
    and private.has_active_esia(vp.user_id);
end;
$$;

create function public.staff_volunteer_detail(target_user uuid)
returns table(
  user_id uuid,
  display_name text,
  email text,
  city text,
  service_status public.volunteer_service_status,
  service_categories text[],
  available_online boolean,
  home_visit_clearance public.home_visit_clearance,
  supervision_required boolean,
  active_assignments bigint,
  completed_assignments bigint,
  open_incidents bigint
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null
     or not (
       private.is_admin(caller)
       or (
         private.has_active_esia(caller)
         and private.has_mercy_role('CURATOR'::public.mercy_role,caller)
       )
     ) then raise exception 'curator required'; end if;

  return query
  select
    u.id,
    coalesce(nullif(trim(p.alias),''),split_part(u.email,'@',1))::text,
    u.email::text,
    p.city::text,
    vp.service_status,
    vp.service_categories,
    vp.available_online,
    vp.home_visit_clearance,
    vp.supervision_required,
    (select count(*) from public.volunteer_case_assignments a where a.volunteer_id=u.id and a.completed_at is null and a.revoked_at is null)::bigint,
    (select count(*) from public.volunteer_case_assignments a where a.volunteer_id=u.id and a.completed_at is not null)::bigint,
    (select count(*) from public.volunteer_incidents i where i.volunteer_id=u.id and i.status<>'RESOLVED')::bigint
  from auth.users u
  join public.volunteer_profiles vp on vp.user_id=u.id
  left join public.profiles p on p.id=u.id
  where u.id=target_user
    and private.has_mercy_role('VOLUNTEER'::public.mercy_role,u.id)
    and private.has_active_esia(u.id)
  limit 1;
end;
$$;

create function public.staff_volunteer_contacts(target_user uuid)
returns table(
  id uuid,
  display_name text,
  relationship text,
  contact_method text,
  linked_user_id uuid,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null
     or not (
       private.is_admin(caller)
       or (
         private.has_active_esia(caller)
         and private.has_mercy_role('CURATOR'::public.mercy_role,caller)
       )
     ) then raise exception 'curator required'; end if;
  return query
  select c.id,c.display_name::text,c.relationship::text,c.contact_method::text,c.linked_user_id,c.created_at
  from public.volunteer_contact_persons c
  where c.volunteer_id=target_user and c.revoked_at is null
  order by c.created_at desc,c.id;
end;
$$;

create function public.staff_volunteer_assignments(target_user uuid)
returns table(
  id uuid,
  help_request_id uuid,
  case_number bigint,
  category text,
  city text,
  request_status public.request_status,
  assignment_mode public.volunteer_assignment_mode,
  task_summary text,
  companion_user_id uuid,
  assigned_at timestamptz,
  completed_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null
     or not (
       private.is_admin(caller)
       or (
         private.has_active_esia(caller)
         and private.has_mercy_role('CURATOR'::public.mercy_role,caller)
       )
     ) then raise exception 'curator required'; end if;
  return query
  select a.id,a.help_request_id,h.case_number,h.category::text,h.city::text,h.status,
         a.assignment_mode,a.task_summary::text,a.companion_user_id,a.assigned_at,a.completed_at
  from public.volunteer_case_assignments a
  join public.help_requests h on h.id=a.help_request_id
  where a.volunteer_id=target_user and a.revoked_at is null
  order by (a.completed_at is null) desc,a.assigned_at desc,a.id;
end;
$$;

create function public.staff_volunteer_incidents(target_user uuid)
returns table(
  id uuid,
  help_request_id uuid,
  category text,
  summary text,
  status public.volunteer_incident_status,
  created_at timestamptz,
  resolution_note text
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null
     or not (
       private.is_admin(caller)
       or (
         private.has_active_esia(caller)
         and private.has_mercy_role('CURATOR'::public.mercy_role,caller)
       )
     ) then raise exception 'curator required'; end if;
  return query
  select i.id,i.help_request_id,i.category::text,i.summary::text,i.status,i.created_at,i.resolution_note::text
  from public.volunteer_incidents i
  where i.volunteer_id=target_user
  order by (i.status<>'RESOLVED') desc,i.created_at desc,i.id;
end;
$$;

create function public.staff_assignable_cases(result_limit int default 100)
returns table(
  id uuid,
  case_number bigint,
  category text,
  city text,
  urgency text,
  status public.request_status,
  beneficiary_is_requester boolean,
  beneficiary_consent_status public.beneficiary_consent_status,
  home_visit_approved boolean
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare caller uuid := auth.uid();
declare caller_admin boolean := private.is_admin(caller);
declare caller_curator boolean :=
  private.has_active_esia(caller)
  and private.has_mercy_role('CURATOR'::public.mercy_role,caller);
begin
  if caller is null or not (caller_admin or caller_curator) then raise exception 'curator required'; end if;

  return query
  select
    h.id,h.case_number,h.category::text,h.city::text,h.urgency::text,h.status,
    s.beneficiary_is_requester,
    coalesce(s.beneficiary_consent_status,'PENDING'::public.beneficiary_consent_status),
    coalesce(s.home_visit_approved,false)
  from public.help_requests h
  left join public.help_request_safety s on s.help_request_id=h.id
  where h.status not in ('RESOLVED','CLOSED')
    and (caller_admin or private.is_active_coordinator(h.id,caller))
  order by h.created_at desc,h.id
  limit least(greatest(result_limit,1),100);
end;
$$;

create function public.update_volunteer_profile(
  target_user uuid,
  new_status public.volunteer_service_status,
  categories text[],
  online_available boolean,
  home_clearance public.home_visit_clearance,
  require_supervision boolean,
  reason_text text
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  caller uuid := auth.uid();
  clean_reason text := trim(coalesce(reason_text,''));
  invalid_category text;
begin
  if caller is null
     or not (
       private.is_admin(caller)
       or (
         private.has_active_esia(caller)
         and private.has_mercy_role('CURATOR'::public.mercy_role,caller)
       )
     ) then raise exception 'curator required'; end if;
  if length(clean_reason) not between 3 and 500 then raise exception 'reason required'; end if;
  if not private.has_mercy_role('VOLUNTEER'::public.mercy_role,target_user)
     or not private.has_active_esia(target_user) then raise exception 'verified volunteer required'; end if;
  if categories is null or cardinality(categories)>12 then raise exception 'invalid categories'; end if;
  select c into invalid_category
  from unnest(categories) c
  where c not in ('THINGS','TRANSPORT','FOOD','CHILDCARE','EDUCATION_WORK','OTHER')
  limit 1;
  if invalid_category is not null then raise exception 'invalid category'; end if;
  if new_status='ACTIVE' and exists(
    select 1 from public.volunteer_incidents
    where volunteer_id=target_user and status<>'RESOLVED'
  ) then raise exception 'open incident must be resolved first'; end if;

  update public.volunteer_profiles
  set service_status=new_status,
      service_categories=categories,
      available_online=online_available,
      home_visit_clearance=home_clearance,
      home_visit_cleared_by=case when home_clearance='CLEARED' then caller else null end,
      home_visit_cleared_at=case when home_clearance='CLEARED' then now() else null end,
      supervision_required=require_supervision,
      updated_by=caller,
      updated_at=now()
  where user_id=target_user;
  if not found then raise exception 'volunteer profile not found'; end if;

  insert into public.audit_events(actor_id,action,object_type,object_id,reason)
  values(caller,'VOLUNTEER_PROFILE_UPDATED','user',target_user,left(clean_reason,500));
end;
$$;

create function public.add_volunteer_contact_person(
  target_user uuid,
  contact_name text,
  relationship_text text,
  contact_value text,
  linked_user uuid default null,
  consent_confirmed boolean default false
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  caller uuid := auth.uid();
  result_id uuid;
begin
  if caller is null
     or not (
       private.is_admin(caller)
       or (
         private.has_active_esia(caller)
         and private.has_mercy_role('CURATOR'::public.mercy_role,caller)
       )
     ) then raise exception 'curator required'; end if;
  if not private.has_mercy_role('VOLUNTEER'::public.mercy_role,target_user) then raise exception 'volunteer required'; end if;
  if consent_confirmed is not true then raise exception 'contact consent required'; end if;
  if length(trim(coalesce(contact_name,''))) not between 2 and 160
     or length(trim(coalesce(relationship_text,''))) not between 2 and 120
     or length(trim(coalesce(contact_value,''))) not between 2 and 240 then
    raise exception 'invalid contact';
  end if;
  if linked_user is not null and not exists(select 1 from auth.users where id=linked_user) then
    raise exception 'linked user not found';
  end if;

  insert into public.volunteer_contact_persons(
    volunteer_id,display_name,relationship,contact_method,linked_user_id,
    consent_confirmed_at,created_by
  ) values(
    target_user,trim(contact_name),trim(relationship_text),trim(contact_value),linked_user,
    now(),caller
  ) returning id into result_id;

  insert into public.audit_events(actor_id,action,object_type,object_id,reason)
  values(caller,'VOLUNTEER_CONTACT_ADDED','user',target_user,'contact person linked with confirmed consent');
  return result_id;
end;
$$;

create function public.revoke_volunteer_contact_person(contact_id uuid, reason_text text)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  caller uuid := auth.uid();
  clean_reason text := trim(coalesce(reason_text,''));
  target_user uuid;
begin
  if caller is null
     or not (
       private.is_admin(caller)
       or (
         private.has_active_esia(caller)
         and private.has_mercy_role('CURATOR'::public.mercy_role,caller)
       )
     ) then raise exception 'curator required'; end if;
  if length(clean_reason) not between 3 and 500 then raise exception 'reason required'; end if;

  update public.volunteer_contact_persons
  set revoked_at=now(),revoked_by=caller,revoke_reason=clean_reason
  where id=contact_id and revoked_at is null
  returning volunteer_id into target_user;
  if target_user is null then raise exception 'contact not found'; end if;

  insert into public.audit_events(actor_id,action,object_type,object_id,reason)
  values(caller,'VOLUNTEER_CONTACT_REVOKED','user',target_user,left(clean_reason,500));
end;
$$;

create function public.set_help_request_safety(
  case_id uuid,
  requester_is_beneficiary boolean,
  consent_status public.beneficiary_consent_status,
  allow_home_visit boolean,
  reason_text text
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  caller uuid := auth.uid();
  clean_reason text := trim(coalesce(reason_text,''));
  caller_admin boolean := private.is_admin(caller);
  caller_curator boolean :=
    private.has_active_esia(caller)
    and private.has_mercy_role('CURATOR'::public.mercy_role,caller);
  normalized_consent public.beneficiary_consent_status;
begin
  if caller is null or not (caller_admin or (caller_curator and private.is_active_coordinator(case_id,caller))) then
    raise exception 'case curator required';
  end if;
  if length(clean_reason) not between 3 and 500 then raise exception 'reason required'; end if;
  if not exists(select 1 from public.help_requests where id=case_id) then raise exception 'request not found'; end if;

  normalized_consent := case
    when requester_is_beneficiary then 'NOT_REQUIRED'::public.beneficiary_consent_status
    else consent_status
  end;
  if not requester_is_beneficiary and normalized_consent='NOT_REQUIRED' then
    raise exception 'beneficiary consent required';
  end if;
  if allow_home_visit and normalized_consent not in ('NOT_REQUIRED','CONFIRMED') then
    raise exception 'home visit requires beneficiary consent';
  end if;

  insert into public.help_request_safety(
    help_request_id,beneficiary_is_requester,beneficiary_consent_status,
    home_visit_approved,recorded_by,recorded_at,note
  ) values(
    case_id,requester_is_beneficiary,normalized_consent,
    allow_home_visit,caller,now(),clean_reason
  )
  on conflict(help_request_id) do update
    set beneficiary_is_requester=excluded.beneficiary_is_requester,
        beneficiary_consent_status=excluded.beneficiary_consent_status,
        home_visit_approved=excluded.home_visit_approved,
        recorded_by=excluded.recorded_by,
        recorded_at=excluded.recorded_at,
        note=excluded.note;

  insert into public.audit_events(actor_id,action,object_type,object_id,reason)
  values(caller,'CASE_SAFETY_RECORDED','help_request',case_id,'beneficiary consent/home-visit safety updated');
end;
$$;

create function public.assign_volunteer_to_case(
  case_id uuid,
  target_volunteer uuid,
  assignment_mode public.volunteer_assignment_mode,
  task_text text,
  companion_user uuid default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  caller uuid := auth.uid();
  clean_task text := trim(coalesce(task_text,''));
  caller_admin boolean := private.is_admin(caller);
  caller_curator boolean :=
    private.has_active_esia(caller)
    and private.has_mercy_role('CURATOR'::public.mercy_role,caller);
  companion uuid := companion_user;
  safety public.help_request_safety%rowtype;
  result_id uuid;
begin
  if caller is null or not (caller_admin or (caller_curator and private.is_active_coordinator(case_id,caller))) then
    raise exception 'case curator required';
  end if;
  if length(clean_task) not between 3 and 500 then raise exception 'task required'; end if;
  if not exists(select 1 from public.help_requests where id=case_id and status not in ('RESOLVED','CLOSED')) then
    raise exception 'active request required';
  end if;
  if not private.has_active_esia(target_volunteer)
     or not private.has_mercy_role('VOLUNTEER'::public.mercy_role,target_volunteer)
     or not exists(
       select 1 from public.volunteer_profiles
       where user_id=target_volunteer and service_status='ACTIVE'
     ) then
    raise exception 'active verified volunteer required';
  end if;
  if exists(
    select 1 from public.volunteer_incidents
    where volunteer_id=target_volunteer and status<>'RESOLVED'
  ) then raise exception 'volunteer has open incident'; end if;

  if assignment_mode='HOME_PAIRED' then
    select * into safety from public.help_request_safety where help_request_id=case_id;
    if safety.help_request_id is null
       or not safety.home_visit_approved
       or safety.beneficiary_consent_status not in ('NOT_REQUIRED','CONFIRMED') then
      raise exception 'home visit safety gate is not satisfied';
    end if;
    if not exists(
      select 1 from public.volunteer_profiles
      where user_id=target_volunteer and home_visit_clearance='CLEARED'
    ) then raise exception 'home visit clearance required'; end if;

    companion := coalesce(companion,caller);
    if companion=target_volunteer or not private.has_active_esia(companion) then
      raise exception 'verified companion required';
    end if;
    if companion<>caller
       and not (
         private.has_mercy_role('VOLUNTEER'::public.mercy_role,companion)
         and exists(
           select 1 from public.volunteer_profiles
           where user_id=companion and service_status='ACTIVE'
         )
       ) then
      raise exception 'active companion required';
    end if;
  elsif companion is not null then
    raise exception 'companion is only valid for paired home visits';
  end if;

  if exists(
    select 1 from public.volunteer_case_assignments
    where help_request_id=case_id and volunteer_id=target_volunteer
      and completed_at is null and revoked_at is null
  ) then raise exception 'volunteer already assigned'; end if;

  insert into public.volunteer_case_assignments(
    help_request_id,volunteer_id,assigned_by,assignment_mode,task_summary,companion_user_id
  ) values(case_id,target_volunteer,caller,assignment_mode,clean_task,companion)
  returning id into result_id;

  insert into public.audit_events(actor_id,action,object_type,object_id,reason)
  values(caller,'VOLUNTEER_ASSIGNED','help_request',case_id,'verified volunteer assigned');
  return result_id;
end;
$$;

create function public.finish_volunteer_assignment(
  assignment_id uuid,
  outcome text,
  reason_text text
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  caller uuid := auth.uid();
  normalized_outcome text := upper(trim(coalesce(outcome,'')));
  clean_reason text := trim(coalesce(reason_text,''));
  case_id uuid;
begin
  if caller is null then raise exception 'authentication required'; end if;
  if normalized_outcome not in ('COMPLETED','REVOKED') then raise exception 'invalid outcome'; end if;
  if length(clean_reason) not between 3 and 500 then raise exception 'reason required'; end if;

  select a.help_request_id into case_id
  from public.volunteer_case_assignments a
  where a.id=assignment_id and a.completed_at is null and a.revoked_at is null
  for update;
  if case_id is null then raise exception 'active assignment not found'; end if;
  if not (
    private.is_admin(caller)
    or (
      private.has_active_esia(caller)
      and private.has_mercy_role('CURATOR'::public.mercy_role,caller)
      and private.is_active_coordinator(case_id,caller)
    )
  ) then raise exception 'case curator required'; end if;

  if normalized_outcome='COMPLETED' then
    update public.volunteer_case_assignments
    set completed_at=now(),completed_by=caller,close_reason=clean_reason
    where id=assignment_id;
  else
    update public.volunteer_case_assignments
    set revoked_at=now(),revoked_by=caller,close_reason=clean_reason
    where id=assignment_id;
  end if;

  insert into public.audit_events(actor_id,action,object_type,object_id,reason)
  values(caller,'VOLUNTEER_ASSIGNMENT_' || normalized_outcome,'help_request',case_id,left(clean_reason,500));
end;
$$;

create function public.open_volunteer_incident(
  target_volunteer uuid,
  case_id uuid,
  incident_category text,
  incident_summary text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  caller uuid := auth.uid();
  clean_category text := trim(coalesce(incident_category,''));
  clean_summary text := trim(coalesce(incident_summary,''));
  caller_admin boolean := private.is_admin(caller);
  caller_curator boolean :=
    private.has_active_esia(caller)
    and private.has_mercy_role('CURATOR'::public.mercy_role,caller);
  result_id uuid;
begin
  if caller is null or not (
    caller_admin
    or (
      caller_curator
      and (case_id is null or private.is_active_coordinator(case_id,caller))
    )
  ) then raise exception 'curator required'; end if;
  if not private.has_mercy_role('VOLUNTEER'::public.mercy_role,target_volunteer) then raise exception 'volunteer required'; end if;
  if length(clean_category) not between 3 and 80 or length(clean_summary) not between 10 and 1000 then
    raise exception 'invalid incident';
  end if;
  if case_id is not null and not exists(
    select 1 from public.volunteer_case_assignments
    where help_request_id=case_id and volunteer_id=target_volunteer
  ) then raise exception 'volunteer was not assigned to request'; end if;

  insert into public.volunteer_incidents(volunteer_id,help_request_id,opened_by,category,summary)
  values(target_volunteer,case_id,caller,clean_category,clean_summary)
  returning id into result_id;

  update public.volunteer_profiles
  set service_status='SUSPENDED',updated_by=caller,updated_at=now()
  where user_id=target_volunteer;

  insert into public.audit_events(actor_id,action,object_type,object_id,reason)
  values(caller,'VOLUNTEER_INCIDENT_OPENED','user',target_volunteer,'volunteer access suspended pending incident review');
  return result_id;
end;
$$;

create function public.resolve_volunteer_incident(incident_id uuid, resolution_text text)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  caller uuid := auth.uid();
  clean_resolution text := trim(coalesce(resolution_text,''));
  target_volunteer uuid;
begin
  if caller is null
     or not (
       private.is_admin(caller)
       or (
         private.has_active_esia(caller)
         and private.has_mercy_role('CURATOR'::public.mercy_role,caller)
       )
     ) then raise exception 'curator required'; end if;
  if length(clean_resolution) not between 3 and 1000 then raise exception 'resolution required'; end if;

  update public.volunteer_incidents
  set status='RESOLVED',resolved_at=now(),resolved_by=caller,resolution_note=clean_resolution
  where id=incident_id and status<>'RESOLVED'
  returning volunteer_id into target_volunteer;
  if target_volunteer is null then raise exception 'open incident not found'; end if;

  insert into public.audit_events(actor_id,action,object_type,object_id,reason)
  values(caller,'VOLUNTEER_INCIDENT_RESOLVED','user',target_volunteer,'incident resolved; volunteer remains suspended until explicit review');
end;
$$;

create function public.my_volunteer_assignments(result_limit int default 20)
returns table(
  id uuid,
  help_request_id uuid,
  case_number bigint,
  category text,
  city text,
  assignment_mode public.volunteer_assignment_mode,
  task_summary text,
  assigned_at timestamptz,
  access_active boolean
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'authentication required'; end if;
  if not private.has_mercy_role('VOLUNTEER'::public.mercy_role,caller) then return; end if;

  return query
  select
    a.id,a.help_request_id,h.case_number,h.category::text,h.city::text,
    a.assignment_mode,a.task_summary::text,a.assigned_at,
    private.can_access_case(a.help_request_id,caller)
  from public.volunteer_case_assignments a
  join public.help_requests h on h.id=a.help_request_id
  where a.volunteer_id=caller and a.completed_at is null and a.revoked_at is null
  order by a.assigned_at desc,a.id
  limit least(greatest(result_limit,1),50);
end;
$$;

create function public.current_case_access(case_id uuid)
returns text
language plpgsql
stable
security definer
set search_path=''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then return null; end if;
  if exists(select 1 from public.help_requests where id=case_id and owner_id=caller) then return 'OWNER'; end if;
  if private.is_active_coordinator(case_id,caller) then return 'CURATOR'; end if;
  if private.can_access_case(case_id,caller) then return 'VOLUNTEER'; end if;
  return null;
end;
$$;

drop policy if exists help_response_read on public.help_request_responses;
create policy help_response_read on public.help_request_responses
for select to authenticated
using(
  responder_id=auth.uid()
  or exists(
    select 1 from public.help_requests h
    where h.id=help_request_id and h.owner_id=auth.uid()
  )
  or private.is_active_coordinator(help_request_id,auth.uid())
);

create or replace function public.change_case_status(
  case_id uuid,
  new_status public.request_status
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  old_status public.request_status;
  caller uuid := auth.uid();
  owner_id uuid;
begin
  if caller is null then raise exception 'authentication required'; end if;
  select h.status,h.owner_id into old_status,owner_id
  from public.help_requests h
  where h.id=case_id
    and (h.owner_id=caller or private.is_active_coordinator(h.id,caller))
  for update;
  if old_status is null then raise exception 'access denied'; end if;
  if caller=owner_id and new_status<>'CLOSED' then raise exception 'owner may only close'; end if;
  if not (
    (old_status='NEW' and new_status in('ASSIGNED','CLOSED'))
    or (old_status='ASSIGNED' and new_status in('IN_PROGRESS','WAITING','CLOSED'))
    or (old_status='IN_PROGRESS' and new_status in('WAITING','RESOLVED','CLOSED'))
    or (old_status='WAITING' and new_status in('IN_PROGRESS','RESOLVED','CLOSED'))
    or (old_status='RESOLVED' and new_status in('IN_PROGRESS','CLOSED'))
  ) then raise exception 'invalid transition'; end if;
  update public.help_requests
  set status=new_status,
      closed_at=case when new_status='CLOSED' then now() else closed_at end,
      updated_at=now()
  where id=case_id;
end;
$$;

create function private.ensure_mercy_admin_by_email(target_email text)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  normalized_email text := lower(trim(coalesce(target_email,'')));
  target_user uuid;
begin
  if length(normalized_email) not between 3 and 320 or position('@' in normalized_email)<2 then
    raise exception 'invalid admin email';
  end if;
  select id into target_user from auth.users where lower(email)=normalized_email limit 1;
  if target_user is null then raise exception 'required admin account is not registered'; end if;

  if not exists(
    select 1 from public.mercy_role_grants
    where user_id=target_user and role='ADMIN' and revoked_at is null
  ) then
    insert into public.mercy_role_grants(user_id,role,granted_by,reason)
    values(target_user,'ADMIN',target_user,'trusted production admin bootstrap');
  end if;
  insert into public.staff_roles(user_id,role,granted_by)
  values(target_user,'ADMIN',target_user)
  on conflict(user_id,role) do nothing;

  insert into public.audit_events(actor_id,action,object_type,object_id,reason)
  values(target_user,'MERCY_ADMIN_BOOTSTRAPPED','user',target_user,'trusted production workflow by registered email');
  return target_user;
end;
$$;

revoke all on function public.current_mercy_access() from public,anon;
revoke all on function public.staff_find_user_by_email(text) from public,anon;
revoke all on function public.manage_mercy_role(uuid,public.mercy_role,boolean,text,public.patron_kind) from public,anon;
revoke all on function public.set_staff_role(uuid,public.staff_role,boolean,text) from public,anon;
revoke all on function public.staff_volunteers(text,public.volunteer_service_status,text,public.home_visit_clearance,int,int) from public,anon;
revoke all on function public.volunteer_service_stats() from public,anon;
revoke all on function public.staff_volunteer_detail(uuid) from public,anon;
revoke all on function public.staff_volunteer_contacts(uuid) from public,anon;
revoke all on function public.staff_volunteer_assignments(uuid) from public,anon;
revoke all on function public.staff_volunteer_incidents(uuid) from public,anon;
revoke all on function public.staff_assignable_cases(int) from public,anon;
revoke all on function public.update_volunteer_profile(uuid,public.volunteer_service_status,text[],boolean,public.home_visit_clearance,boolean,text) from public,anon;
revoke all on function public.add_volunteer_contact_person(uuid,text,text,text,uuid,boolean) from public,anon;
revoke all on function public.revoke_volunteer_contact_person(uuid,text) from public,anon;
revoke all on function public.set_help_request_safety(uuid,boolean,public.beneficiary_consent_status,boolean,text) from public,anon;
revoke all on function public.assign_volunteer_to_case(uuid,uuid,public.volunteer_assignment_mode,text,uuid) from public,anon;
revoke all on function public.finish_volunteer_assignment(uuid,text,text) from public,anon;
revoke all on function public.open_volunteer_incident(uuid,uuid,text,text) from public,anon;
revoke all on function public.resolve_volunteer_incident(uuid,text) from public,anon;
revoke all on function public.my_volunteer_assignments(int) from public,anon;
revoke all on function public.current_case_access(uuid) from public,anon;
revoke all on function private.ensure_mercy_admin_by_email(text) from public,anon,authenticated,service_role;

grant execute on function public.current_mercy_access() to authenticated;
grant execute on function public.staff_find_user_by_email(text) to authenticated;
grant execute on function public.manage_mercy_role(uuid,public.mercy_role,boolean,text,public.patron_kind) to authenticated;
grant execute on function public.set_staff_role(uuid,public.staff_role,boolean,text) to authenticated;
grant execute on function public.staff_volunteers(text,public.volunteer_service_status,text,public.home_visit_clearance,int,int) to authenticated;
grant execute on function public.volunteer_service_stats() to authenticated;
grant execute on function public.staff_volunteer_detail(uuid) to authenticated;
grant execute on function public.staff_volunteer_contacts(uuid) to authenticated;
grant execute on function public.staff_volunteer_assignments(uuid) to authenticated;
grant execute on function public.staff_volunteer_incidents(uuid) to authenticated;
grant execute on function public.staff_assignable_cases(int) to authenticated;
grant execute on function public.update_volunteer_profile(uuid,public.volunteer_service_status,text[],boolean,public.home_visit_clearance,boolean,text) to authenticated;
grant execute on function public.add_volunteer_contact_person(uuid,text,text,text,uuid,boolean) to authenticated;
grant execute on function public.revoke_volunteer_contact_person(uuid,text) to authenticated;
grant execute on function public.set_help_request_safety(uuid,boolean,public.beneficiary_consent_status,boolean,text) to authenticated;
grant execute on function public.assign_volunteer_to_case(uuid,uuid,public.volunteer_assignment_mode,text,uuid) to authenticated;
grant execute on function public.finish_volunteer_assignment(uuid,text,text) to authenticated;
grant execute on function public.open_volunteer_incident(uuid,uuid,text,text) to authenticated;
grant execute on function public.resolve_volunteer_incident(uuid,text) to authenticated;
grant execute on function public.my_volunteer_assignments(int) to authenticated;
grant execute on function public.current_case_access(uuid) to authenticated;
