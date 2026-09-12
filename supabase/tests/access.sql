\set ON_ERROR_STOP on
begin;
select plan(5);
select has_table('public','help_requests','schema reproduced');
select row_security_active('public.help_requests'::regclass,'requests RLS active');
select row_security_active('public.messages'::regclass,'messages RLS active');
select has_index('public','service_locations','service_locations_geo_idx','geo index exists');
select function_privs_are('public','bootstrap_first_admin',array['uuid'],null,array[]::text[],'bootstrap unavailable via API');
select * from finish();rollback;
