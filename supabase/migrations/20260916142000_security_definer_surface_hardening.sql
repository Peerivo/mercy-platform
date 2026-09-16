-- Keep privileged authorization helpers out of the Data API surface.
-- Supabase recommends SECURITY DEFINER helpers live in a non-exposed schema.
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

-- Preserve OIDs so existing RLS policy dependencies remain intact while the
-- helpers move out of the exposed public schema.
alter function public.is_admin(uuid) set schema private;
alter function public.is_active_coordinator(uuid, uuid) set schema private;
alter function public.can_access_case(uuid, uuid) set schema private;

-- CREATE OR REPLACE definitions store referenced helper names as text. Rewrite
-- every current function that still points at the old public helper names. This
-- includes the moved can_access_case helper itself, staff/admin RPCs and trigger
-- helpers. CREATE OR REPLACE preserves each function's OID, grants and flags.
do $$
declare
  fn record;
  ddl text;
begin
  for fn in
    select p.oid
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where p.prokind = 'f'
      and n.nspname in ('public', 'private')
      and (
        pg_catalog.pg_get_functiondef(p.oid) like '%public.is_admin%'
        or pg_catalog.pg_get_functiondef(p.oid) like '%public.is_active_coordinator%'
        or pg_catalog.pg_get_functiondef(p.oid) like '%public.can_access_case%'
      )
  loop
    ddl := pg_catalog.pg_get_functiondef(fn.oid);
    ddl := pg_catalog.replace(ddl, 'public.is_admin', 'private.is_admin');
    ddl := pg_catalog.replace(ddl, 'public.is_active_coordinator', 'private.is_active_coordinator');
    ddl := pg_catalog.replace(ddl, 'public.can_access_case', 'private.can_access_case');
    execute ddl;
  end loop;
end
$$;

-- The helpers may be evaluated by RLS for signed-in users, but the private
-- schema is not exposed by PostgREST. Revoke inherited/default ACLs first and
-- then grant only what database-side policy evaluation needs.
revoke all on function private.is_admin(uuid) from public, anon, authenticated, service_role;
revoke all on function private.is_active_coordinator(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.can_access_case(uuid, uuid) from public, anon, authenticated, service_role;

grant execute on function private.is_admin(uuid) to authenticated, service_role;
grant execute on function private.is_active_coordinator(uuid, uuid) to authenticated, service_role;
grant execute on function private.can_access_case(uuid, uuid) to authenticated, service_role;

-- This geospatial read does not need elevated privileges: both source tables
-- already expose only verified/published rows through RLS. Let RLS apply rather
-- than bypassing it through SECURITY DEFINER.
alter function public.nearby_service_locations(
  double precision,
  double precision,
  integer,
  integer,
  integer
) security invoker;

-- Opt this existing project into Supabase's current least-privilege defaults.
-- New API objects are private until a migration explicitly grants access.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions from public;

alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated, service_role;
