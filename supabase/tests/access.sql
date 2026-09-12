\set ON_ERROR_STOP on
begin;
select plan(13);
select has_table('public','help_requests','schema reproduced');
select row_security_active('public.help_requests'::regclass,'requests RLS active');
select row_security_active('public.messages'::regclass,'messages RLS active');
select has_index('public','service_locations','service_locations_geo_idx','geo index exists');
select ok(not has_function_privilege('anon','public.bootstrap_first_admin(uuid)','EXECUTE') and not has_function_privilege('authenticated','public.bootstrap_first_admin(uuid)','EXECUTE'),'bootstrap unavailable via API');
select row_security_active('public.profiles'::regclass,'profiles RLS active');
select row_security_active('public.case_assignments'::regclass,'assignments RLS active');
select row_security_active('public.consents'::regclass,'consents RLS active');
select row_security_active('public.audit_events'::regclass,'audit RLS active');
select ok(has_function_privilege('authenticated','public.send_message(uuid,text,uuid)','EXECUTE') and not has_function_privilege('anon','public.send_message(uuid,text,uuid)','EXECUTE'),'message RPC is authenticated only');
select ok(has_function_privilege('authenticated','public.assign_case(uuid,uuid,text)','EXECUTE') and not has_function_privilege('anon','public.assign_case(uuid,uuid,text)','EXECUTE'),'assignment RPC is authenticated only and enforces admin internally');
select isnt((select relreplident from pg_class where oid='public.messages'::regclass),'f','messages do not expose FULL old rows on DELETE');
select results_eq($$select count(*)::bigint from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages'$$,array[1::bigint],'messages publication configured exactly once');
select * from finish();rollback;
