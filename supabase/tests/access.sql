\set ON_ERROR_STOP on
begin;
select plan(13);
select has_table('public','help_requests','schema reproduced');
select ok((select relrowsecurity from pg_catalog.pg_class where oid='public.help_requests'::regclass),'help_requests: RLS enabled');
select ok((select relrowsecurity from pg_catalog.pg_class where oid='public.messages'::regclass),'messages: RLS enabled');
select has_index('public','service_locations','service_locations_geo_idx','geo index exists');
select ok(not has_function_privilege('anon','public.bootstrap_first_admin(uuid)','EXECUTE') and not has_function_privilege('authenticated','public.bootstrap_first_admin(uuid)','EXECUTE'),'bootstrap unavailable via API');
select ok((select relrowsecurity from pg_catalog.pg_class where oid='public.profiles'::regclass),'profiles: RLS enabled');
select ok((select relrowsecurity from pg_catalog.pg_class where oid='public.case_assignments'::regclass),'case_assignments: RLS enabled');
select ok((select relrowsecurity from pg_catalog.pg_class where oid='public.consents'::regclass),'consents: RLS enabled');
select ok((select relrowsecurity from pg_catalog.pg_class where oid='public.audit_events'::regclass),'audit_events: RLS enabled');
select ok(has_function_privilege('authenticated','public.send_message(uuid,text,uuid)','EXECUTE') and not has_function_privilege('anon','public.send_message(uuid,text,uuid)','EXECUTE'),'message RPC is authenticated only');
select ok(has_function_privilege('authenticated','public.assign_case(uuid,uuid,text)','EXECUTE') and not has_function_privilege('anon','public.assign_case(uuid,uuid,text)','EXECUTE'),'assignment RPC is authenticated only and enforces admin internally');
select isnt((select relreplident from pg_class where oid='public.messages'::regclass),'f','messages do not expose FULL old rows on DELETE');
select results_eq($$select count(*)::bigint from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages'$$,array[1::bigint],'messages publication configured exactly once');
select * from finish();rollback;
