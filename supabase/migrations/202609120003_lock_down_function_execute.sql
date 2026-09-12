-- Supabase database defaults can grant EXECUTE to API roles independently of
-- PUBLIC. Revoking PUBLIC alone therefore does not remove an explicit anon grant.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

revoke execute on function public.is_admin(uuid) from public, anon;
revoke execute on function public.is_active_coordinator(uuid, uuid) from public, anon;
revoke execute on function public.can_access_case(uuid, uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.is_active_coordinator(uuid, uuid) to authenticated;
grant execute on function public.can_access_case(uuid, uuid) to authenticated;

-- These entry points require a user JWT. Their bodies retain the authoritative
-- ownership, active-assignment, and administrator checks.
revoke execute on function public.create_help_request(jsonb, text) from public, anon;
revoke execute on function public.assign_case(uuid, uuid, text) from public, anon;
revoke execute on function public.assignment_queue(integer, integer) from public, anon;
revoke execute on function public.revoke_case_assignment(uuid, text) from public, anon;
revoke execute on function public.change_case_status(uuid, public.request_status) from public, anon;
grant execute on function public.create_help_request(jsonb, text) to authenticated;
grant execute on function public.assign_case(uuid, uuid, text) to authenticated;
grant execute on function public.assignment_queue(integer, integer) to authenticated;
grant execute on function public.revoke_case_assignment(uuid, text) to authenticated;
grant execute on function public.change_case_status(uuid, public.request_status) to authenticated;

-- Trigger implementation and trusted bootstrap are never API entry points.
revoke execute on function public.enforce_message() from public, anon, authenticated;
revoke execute on function public.bootstrap_first_admin(uuid) from public, anon, authenticated;

-- Public discovery intentionally remains callable without a user session.
revoke execute on function public.nearby_service_locations(double precision, double precision, integer, integer, integer)
  from public;
grant execute on function public.nearby_service_locations(double precision, double precision, integer, integer, integer)
  to anon, authenticated;
