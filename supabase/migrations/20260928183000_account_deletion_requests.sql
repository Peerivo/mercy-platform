-- Account deletion request intake. This records intent only; erasure remains a
-- separate operator action after retention/legal review.
create index if not exists profiles_pending_account_deletion_idx
  on public.profiles(deletion_requested_at, id)
  where deletion_requested_at is not null;

create or replace function public.request_account_deletion()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  requested_at timestamptz := now();
begin
  if caller_id is null then
    raise exception 'authentication required';
  end if;

  insert into public.profiles as p(id, deletion_requested_at, updated_at)
  values(caller_id, requested_at, requested_at)
  on conflict (id) do update
    set deletion_requested_at = coalesce(p.deletion_requested_at, excluded.deletion_requested_at),
        updated_at = case
          when p.deletion_requested_at is null then excluded.updated_at
          else p.updated_at
        end
  returning deletion_requested_at into requested_at;

  return requested_at;
end
$$;

create or replace function public.cancel_account_deletion()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'authentication required';
  end if;

  update public.profiles
  set deletion_requested_at = null,
      updated_at = now()
  where id = caller_id
    and deletion_requested_at is not null;

  return found;
end
$$;

create or replace function public.admin_account_deletion_requests(
  result_limit integer default 50,
  result_offset integer default 0
)
returns table(
  user_id uuid,
  alias text,
  requested_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin(auth.uid()) then
    raise exception 'access denied';
  end if;

  return query
  select
    p.id,
    p.alias::text,
    p.deletion_requested_at
  from public.profiles as p
  where p.deletion_requested_at is not null
  order by p.deletion_requested_at asc, p.id
  limit least(greatest(result_limit, 1), 100)
  offset greatest(result_offset, 0);
end
$$;

revoke update(deletion_requested_at) on public.profiles from authenticated;

revoke all on function public.request_account_deletion() from public;
revoke all on function public.cancel_account_deletion() from public;
revoke all on function public.admin_account_deletion_requests(integer, integer) from public;

grant execute on function public.request_account_deletion() to authenticated;
grant execute on function public.cancel_account_deletion() to authenticated;
grant execute on function public.admin_account_deletion_requests(integer, integer) to authenticated;
