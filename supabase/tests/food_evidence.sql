\set ON_ERROR_STOP on
begin;
select plan(5);
select has_table('public','food_donation_evidence','evidence ledger exists');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid='public.food_donation_evidence'::regclass),
  'evidence ledger enforces row-level security'
);
select ok(
  not has_table_privilege('anon','public.food_donation_evidence','SELECT')
  and not has_table_privilege('authenticated','public.food_donation_evidence','SELECT')
  and not has_table_privilege('authenticated','public.food_donation_evidence','INSERT')
  and not has_table_privilege('authenticated','public.food_donation_evidence','UPDATE'),
  'clients have no direct evidence table access'
);
select ok(
  (select not public from storage.buckets where id='mercy-food-evidence'),
  'evidence storage bucket is private'
);
select ok(
  (select file_size_limit=5242880 from storage.buckets where id='mercy-food-evidence'),
  'evidence files are limited to 5 MB'
);
select * from finish();
rollback;
