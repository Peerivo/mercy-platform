-- Minimal ADMIN coordinator directory and assignment metadata for the staff workspace.
create function public.staff_coordinators(coordinator_limit int default 100)
returns table(id uuid, display_name text)
language sql stable security definer set search_path=''
as $$
  select r.user_id,
         coalesce(nullif(trim(p.alias), ''), 'Координатор ' || left(r.user_id::text, 8))
  from public.staff_roles r
  left join public.profiles p on p.id = r.user_id
  where public.is_admin() and r.role in ('COORDINATOR', 'ADMIN')
  group by r.user_id, p.alias
  order by coalesce(nullif(trim(p.alias), ''), r.user_id::text)
  limit least(greatest(coordinator_limit, 1), 100);
$$;

revoke all on function public.staff_coordinators(int) from public, anon;
grant execute on function public.staff_coordinators(int) to authenticated;

create function public.coordinator_cases(case_limit int default 20, case_offset int default 0)
returns table(id uuid, case_number bigint, category text, city text, urgency text, status public.request_status, created_at timestamptz)
language sql stable security definer set search_path=''
as $$
  select h.id,h.case_number,h.category::text,h.city::text,h.urgency::text,h.status,h.created_at
  from public.help_requests h join public.case_assignments a on a.help_request_id=h.id and a.revoked_at is null
  join public.staff_roles r on r.user_id=a.coordinator_id and r.role in ('COORDINATOR','ADMIN')
  where a.coordinator_id=auth.uid() order by h.updated_at desc,h.id
  limit least(greatest(case_limit,1),100) offset greatest(case_offset,0);
$$;
revoke all on function public.coordinator_cases(int,int) from public, anon;
grant execute on function public.coordinator_cases(int,int) to authenticated;

create function public.current_staff_role()
returns public.staff_role language sql stable security definer set search_path=''
as $$select case when public.is_admin() then 'ADMIN'::public.staff_role else
  (select 'COORDINATOR'::public.staff_role from public.staff_roles where user_id=auth.uid() and role='COORDINATOR' limit 1) end$$;
revoke all on function public.current_staff_role() from public, anon;
grant execute on function public.current_staff_role() to authenticated;

drop function public.assignment_queue(int,int);
create function public.assignment_queue(queue_limit int default 50, queue_offset int default 0)
returns table(id uuid, case_number bigint, category text, city text, urgency text,
  status public.request_status, created_at timestamptz, coordinator_id uuid, coordinator_name text)
language sql stable security definer set search_path=''
as $$
  select h.id, h.case_number, h.category::text, h.city::text, h.urgency::text,
         h.status, h.created_at, a.coordinator_id,
         coalesce(nullif(trim(p.alias), ''), 'Координатор ' || left(a.coordinator_id::text, 8))
  from public.help_requests h
  left join public.case_assignments a on a.help_request_id = h.id and a.revoked_at is null
  left join public.profiles p on p.id = a.coordinator_id
  where public.is_admin()
  order by case when h.urgency='URGENT' then 0 when h.urgency='SOON' then 1 else 2 end,
           h.created_at, h.id
  limit least(greatest(queue_limit,1),100) offset greatest(queue_offset,0);
$$;
revoke all on function public.assignment_queue(int,int) from public, anon;
grant execute on function public.assignment_queue(int,int) to authenticated;
