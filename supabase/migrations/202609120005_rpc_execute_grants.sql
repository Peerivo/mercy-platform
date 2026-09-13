-- Migrations in this project run as postgres. PostgreSQL's global default is
-- EXECUTE for PUBLIC, so the schema-scoped default alone is insufficient.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

-- Existing functions predate the default-privilege correction and therefore
-- require explicit least-privilege grants by exact signature.
revoke all on function public.send_message(uuid,text,uuid) from public, anon;
revoke all on function public.set_staff_role(uuid,public.staff_role,boolean,text) from public, anon;
revoke all on function public.create_help_request(jsonb,text) from public, anon;
revoke all on function public.assign_case(uuid,uuid,text) from public, anon;
revoke all on function public.revoke_case_assignment(uuid,text) from public, anon;
revoke all on function public.change_case_status(uuid,public.request_status) from public, anon;
revoke all on function public.assignment_queue(int,int) from public, anon;
revoke all on function public.is_admin(uuid) from public, anon;
revoke all on function public.is_active_coordinator(uuid,uuid) from public, anon;
revoke all on function public.can_access_case(uuid,uuid) from public, anon;

grant execute on function public.send_message(uuid,text,uuid) to authenticated;
grant execute on function public.set_staff_role(uuid,public.staff_role,boolean,text) to authenticated;
grant execute on function public.create_help_request(jsonb,text) to authenticated;
grant execute on function public.assign_case(uuid,uuid,text) to authenticated;
grant execute on function public.revoke_case_assignment(uuid,text) to authenticated;
grant execute on function public.change_case_status(uuid,public.request_status) to authenticated;
grant execute on function public.assignment_queue(int,int) to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.is_active_coordinator(uuid,uuid) to authenticated;
grant execute on function public.can_access_case(uuid,uuid) to authenticated;

-- Bootstrap and trigger functions are never direct API entry points.
revoke all on function public.bootstrap_first_admin(uuid) from public, anon, authenticated;
revoke all on function public.enforce_message() from public, anon, authenticated;
revoke all on function public.enforce_catalog_review() from public, anon, authenticated;

-- This is the intentionally public RPC.
revoke all on function public.nearby_service_locations(float,float,int,int,int) from public;
grant execute on function public.nearby_service_locations(float,float,int,int,int) to anon, authenticated;
