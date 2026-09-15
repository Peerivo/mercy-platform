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
  limit 1;
$$;

revoke all on function public.get_public_help_request(uuid) from public;

grant execute
on function public.get_public_help_request(uuid)
to anon, authenticated;