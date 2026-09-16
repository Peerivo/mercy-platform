\set ON_ERROR_STOP on
begin;
select plan(58);
select has_table('public','help_requests','schema reproduced');
select has_column('public','help_requests','published_at','help requests have explicit publication state');
select ok((select relrowsecurity from pg_catalog.pg_class where oid='public.help_requests'::regclass),'help_requests: RLS enabled');
select ok((select relrowsecurity from pg_catalog.pg_class where oid='public.messages'::regclass),'messages: RLS enabled');
select has_index('public','service_locations','service_locations_geo_idx','geo index exists');
select ok(not has_function_privilege('anon','public.bootstrap_first_admin(uuid)','EXECUTE') and not has_function_privilege('authenticated','public.bootstrap_first_admin(uuid)','EXECUTE'),'bootstrap unavailable via API');
select ok((select relrowsecurity from pg_catalog.pg_class where oid='public.profiles'::regclass),'profiles: RLS enabled');
select ok((select relrowsecurity from pg_catalog.pg_class where oid='public.case_assignments'::regclass),'case_assignments: RLS enabled');
select ok((select relrowsecurity from pg_catalog.pg_class where oid='public.consents'::regclass),'consents: RLS enabled');
select ok((select relrowsecurity from pg_catalog.pg_class where oid='public.audit_events'::regclass),'audit_events: RLS enabled');
select ok((select relrowsecurity from pg_catalog.pg_class where oid='public.volunteer_offers'::regclass),'volunteer offers use RLS');
select ok(not has_table_privilege('authenticated','public.volunteer_offers','INSERT'),'offer identity and consent cannot bypass the atomic RPC');
select ok(has_function_privilege('authenticated','public.create_volunteer_offer(jsonb,text)','EXECUTE') and not has_function_privilege('anon','public.create_volunteer_offer(jsonb,text)','EXECUTE'),'offer creation requires a user JWT');
select ok(has_function_privilege('authenticated','public.moderate_volunteer_offer(uuid,public.review_status,text)','EXECUTE') and not has_function_privilege('anon','public.moderate_volunteer_offer(uuid,public.review_status,text)','EXECUTE'),'offer moderation requires a user JWT and checks admin internally');
select ok(has_function_privilege('authenticated','public.send_message(uuid,text,uuid)','EXECUTE') and not has_function_privilege('anon','public.send_message(uuid,text,uuid)','EXECUTE'),'message RPC is authenticated only');
select ok(has_function_privilege('authenticated','public.assign_case(uuid,uuid,text)','EXECUTE') and not has_function_privilege('anon','public.assign_case(uuid,uuid,text)','EXECUTE'),'assignment RPC is authenticated only and enforces admin internally');
select ok(not has_function_privilege('anon','public.set_staff_role(uuid,public.staff_role,boolean,text)','EXECUTE') and has_function_privilege('authenticated','public.set_staff_role(uuid,public.staff_role,boolean,text)','EXECUTE'),'staff-role RPC is authenticated only');
select ok(not has_function_privilege('anon','public.create_help_request(jsonb,text)','EXECUTE') and has_function_privilege('authenticated','public.create_help_request(jsonb,text)','EXECUTE'),'request RPC is authenticated only');
select ok(not has_function_privilege('anon','public.assignment_queue(integer,integer)','EXECUTE') and has_function_privilege('authenticated','public.assignment_queue(integer,integer)','EXECUTE'),'queue RPC is authenticated only');
select ok(not has_function_privilege('anon','public.staff_coordinators(integer)','EXECUTE') and has_function_privilege('authenticated','public.staff_coordinators(integer)','EXECUTE'),'coordinator directory is authenticated and checks admin internally');
select ok(not has_function_privilege('anon','public.coordinator_cases(integer,integer)','EXECUTE') and has_function_privilege('authenticated','public.coordinator_cases(integer,integer)','EXECUTE'),'coordinator case list requires a user JWT');
select ok(not has_function_privilege('anon','public.current_staff_role()','EXECUTE') and has_function_privilege('authenticated','public.current_staff_role()','EXECUTE'),'current staff role requires a user JWT');
select ok(not has_function_privilege('anon','public.enforce_message()','EXECUTE') and not has_function_privilege('authenticated','public.enforce_message()','EXECUTE'),'message trigger is not API callable');
select ok(not has_function_privilege('anon','public.enforce_catalog_review()','EXECUTE') and not has_function_privilege('authenticated','public.enforce_catalog_review()','EXECUTE'),'catalog trigger is not API callable');
select ok(has_function_privilege('anon','public.nearby_service_locations(double precision,double precision,integer,integer,integer)','EXECUTE') and has_function_privilege('authenticated','public.nearby_service_locations(double precision,double precision,integer,integer,integer)','EXECUTE'),'public geo RPC remains callable');
select ok(has_function_privilege('anon','public.get_public_help_request(uuid)','EXECUTE') and has_function_privilege('authenticated','public.get_public_help_request(uuid)','EXECUTE'),'public request detail RPC remains callable');
select ok(has_function_privilege('anon','public.list_public_help_requests(text,text,text,text,integer,integer)','EXECUTE') and has_function_privilege('authenticated','public.list_public_help_requests(text,text,text,text,integer,integer)','EXECUTE'),'public request list RPC remains callable');
select ok(lower(pg_get_functiondef('public.get_public_help_request(uuid)'::regprocedure)) like '%published_at is not null%','public request detail excludes unpublished rows');
select ok(lower(pg_get_functiondef('public.list_public_help_requests(text,text,text,text,integer,integer)'::regprocedure)) like '%published_at is not null%','public request list excludes unpublished rows');
select ok(lower(pg_get_functiondef('public.respond_to_help_request(uuid,jsonb,text)'::regprocedure)) like '%published_at is not null%','responses cannot target unpublished requests');
select has_schema('private','private authorization schema exists');
select ok(
  to_regprocedure('public.is_admin(uuid)') is null
  and to_regprocedure('public.is_active_coordinator(uuid,uuid)') is null
  and to_regprocedure('public.can_access_case(uuid,uuid)') is null,
  'authorization helpers are absent from the public RPC namespace'
);
select ok(
  to_regprocedure('private.is_admin(uuid)') is not null
  and to_regprocedure('private.is_active_coordinator(uuid,uuid)') is not null
  and to_regprocedure('private.can_access_case(uuid,uuid)') is not null,
  'authorization helpers live in the private schema'
);
select ok(
  has_schema_privilege('authenticated','private','USAGE')
  and not has_schema_privilege('anon','private','USAGE'),
  'private helper schema is usable only by signed-in/database roles'
);
select ok(
  has_function_privilege('authenticated','private.is_admin(uuid)','EXECUTE')
  and has_function_privilege('authenticated','private.is_active_coordinator(uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','private.can_access_case(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','private.is_admin(uuid)','EXECUTE')
  and not has_function_privilege('anon','private.is_active_coordinator(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','private.can_access_case(uuid,uuid)','EXECUTE'),
  'private helpers have least-privilege execution grants'
);
select ok(
  (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('is_admin','is_active_coordinator','can_access_case') and p.prosecdef) = 3,
  'private authorization helpers remain security definer'
);
select ok(
  lower(pg_get_functiondef('private.is_admin(uuid)'::regprocedure)) like '%uid = auth.uid()%'
  and lower(pg_get_functiondef('private.is_active_coordinator(uuid,uuid)'::regprocedure)) like '%uid = auth.uid()%'
  and lower(pg_get_functiondef('private.can_access_case(uuid,uuid)'::regprocedure)) like '%uid = auth.uid()%'
,'private security-definer helpers bind explicit uid to the caller');
select ok(
  (select count(*) from pg_policies where schemaname='public' and coalesce(qual,'') like '%private.can_access_case%') >= 4
  and exists(select 1 from pg_policies where schemaname='public' and tablename='volunteer_offers' and coalesce(qual,'') like '%private.is_admin%')
  and not exists(select 1 from pg_policies where schemaname='public' and (coalesce(qual,'') || coalesce(with_check,'')) ~ 'public\.(is_admin|is_active_coordinator|can_access_case)'),
  'RLS policies resolve authorization through private helpers'
);
select ok(
  not (select p.prosecdef from pg_catalog.pg_proc p where p.oid='public.nearby_service_locations(double precision,double precision,integer,integer,integer)'::regprocedure),
  'public geo RPC runs as security invoker so source-table RLS applies'
);
select results_eq(
  $$select p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f' and p.prosecdef
      and has_function_privilege('anon',p.oid,'EXECUTE')
    order by 1$$,
  $$select signature from (values
      ('get_public_help_request(uuid)'::text),
      ('list_public_help_requests(text,text,text,text,integer,integer)'::text),
      ('submit_feedback(text,text,text)'::text),
      ('submit_help_request_report(uuid,text,text,uuid)'::text)
    ) as allowed(signature) order by signature$$,
  'anonymous security-definer API surface matches the explicit allowlist'
);
select results_eq(
  $$select p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f' and p.prosecdef
      and has_function_privilege('authenticated',p.oid,'EXECUTE')
    order by 1$$,
  $$select signature from (values
      ('admin_help_request_reports(integer,integer)'::text),
      ('assign_case(uuid,uuid,text)'::text),
      ('assignment_queue(integer,integer)'::text),
      ('change_case_status(uuid,request_status)'::text),
      ('coordinator_cases(integer,integer)'::text),
      ('create_help_request(jsonb,text)'::text),
      ('create_volunteer_offer(jsonb,text)'::text),
      ('current_staff_role()'::text),
      ('get_public_help_request(uuid)'::text),
      ('list_public_help_requests(text,text,text,text,integer,integer)'::text),
      ('moderate_volunteer_offer(uuid,review_status,text)'::text),
      ('respond_to_help_request(uuid,jsonb,text)'::text),
      ('review_help_request_report(uuid,text,text)'::text),
      ('revoke_case_assignment(uuid,text)'::text),
      ('send_message(uuid,text,uuid)'::text),
      ('set_staff_role(uuid,staff_role,boolean,text)'::text),
      ('staff_coordinators(integer)'::text),
      ('submit_feedback(text,text,text)'::text),
      ('submit_help_request_report(uuid,text,text,uuid)'::text)
    ) as allowed(signature) order by signature$$,
  'authenticated security-definer API surface matches the explicit allowlist'
);
create function public.pgtap_default_privilege_probe() returns boolean language sql as $$select true$$;
select ok(
  not has_function_privilege('anon','public.pgtap_default_privilege_probe()','EXECUTE')
  and not has_function_privilege('authenticated','public.pgtap_default_privilege_probe()','EXECUTE')
  and not has_function_privilege('service_role','public.pgtap_default_privilege_probe()','EXECUTE'),
  'new functions do not acquire Data API execution by default'
);
create table public.pgtap_default_table_probe(id bigint);
select ok(
  not has_table_privilege('anon','public.pgtap_default_table_probe','SELECT')
  and not has_table_privilege('authenticated','public.pgtap_default_table_probe','SELECT')
  and not has_table_privilege('service_role','public.pgtap_default_table_probe','SELECT'),
  'new tables do not acquire Data API read access by default'
);
create sequence public.pgtap_default_sequence_probe;
select ok(
  not has_sequence_privilege('anon','public.pgtap_default_sequence_probe','USAGE')
  and not has_sequence_privilege('authenticated','public.pgtap_default_sequence_probe','USAGE')
  and not has_sequence_privilege('service_role','public.pgtap_default_sequence_probe','USAGE'),
  'new sequences do not acquire Data API usage by default'
);
select isnt((select relreplident from pg_class where oid='public.messages'::regclass),'f','messages do not expose FULL old rows on DELETE');
select results_eq($$select count(*)::bigint from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages'$$,array[1::bigint],'messages publication configured exactly once');
select ok(to_regclass('public.specialist_profiles') is null,'specialist profiles are removed from Mercy');
select ok(to_regclass('public.qualification_documents') is null,'qualification documents are removed from Mercy');
select ok(to_regclass('public.published_specialists') is null,'published specialist projection is removed from Mercy');
select ok(to_regprocedure('public.search_specialists(text,text,text,text,boolean,integer,integer)') is null,'specialist search RPC is removed from Mercy');
select ok(to_regprocedure('public.save_specialist_profile(jsonb)') is null,'specialist write RPC is removed from Mercy');
select has_table('public','help_request_responses','direct help responses exist');
select ok((select relrowsecurity from pg_catalog.pg_class where oid='public.help_request_responses'::regclass),'help responses use RLS');
select ok(not has_table_privilege('authenticated','public.help_request_responses','INSERT'),'response identity and consent cannot bypass RPC');
select ok(has_function_privilege('authenticated','public.respond_to_help_request(uuid,jsonb,text)','EXECUTE') and not has_function_privilege('anon','public.respond_to_help_request(uuid,jsonb,text)','EXECUTE'),'request response requires authenticated user');
select has_table('public','feedback_messages','feedback inbox exists');
select ok(not has_table_privilege('anon','public.feedback_messages','SELECT') and not has_table_privilege('authenticated','public.feedback_messages','SELECT'),'feedback inbox is not directly readable');
select ok(has_function_privilege('anon','public.submit_feedback(text,text,text)','EXECUTE') and has_function_privilege('authenticated','public.submit_feedback(text,text,text)','EXECUTE'),'feedback submission is available before and after login');
select * from finish();
rollback;
