"""Real PostgreSQL 17 matrix; fixture only, never accepts remote target credentials."""
import argparse
import json
from pathlib import Path
from fixture_menaion_issue_package import Fixture, ROOT, MANIFEST, builder, generate_contract


def run(pg_bin,migrations,policy11):
    raw=(ROOT/'ops/living-menaion/issue-package-contract.json').read_bytes()
    inspected=builder.build_inspection(MANIFEST,raw)
    with Fixture(pg_bin,migrations,policy11) as f:
        assert generate_contract(f)==json.loads(raw), 'Reviewed catalog no longer matches frozen source'
        applied=builder.build_transaction(f.source(builder.VERSION10),f.source(builder.VERSION12),MANIFEST,raw)
        def inspect_ready(count=0):
            assert f.query(inspected)==f'MENAION_ISSUE_PACKAGE_READY\nMENAION_ISSUE_PACKAGE_LEGACY_UNMAPPED_ATTEMPTED={count}'
        def baseline(ten,eleven):
            assert f.query('select count(*) from public.living_menaion_schema_migrations')==str(9+ten+eleven)
            for name in builder.TABLES12+(builder.TABLES10 if not ten else []):
                assert f.query(f"select to_regclass('{name}') is null")=='t'
        for ten,eleven in [(False,False),(False,True),(True,False),(True,True)]:
            f.reset(ten,eleven)
            inspect_ready()
            before=f.query('select '+builder.content_guard_catalog())
            # Inject immediately after the last DDL statement and before the final ledger insert.
            fault=applied.replace(f"insert into public.living_menaion_schema_migrations(version,checksum) values ('{builder.VERSION12}'",
                                  f"select 1/0;\ninsert into public.living_menaion_schema_migrations(version,checksum) values ('{builder.VERSION12}'")
            f.query(fault,False)
            baseline(ten,eleven)
            assert f.query('select '+builder.content_guard_catalog())==before
            inspect_ready()
            assert f.query(applied)=='MENAION_ISSUE_PACKAGE_LEGACY_UNMAPPED_ATTEMPTED=0\nMENAION_ISSUE_PACKAGE_VERIFIED'
            assert f.query('select count(*) from public.living_menaion_schema_migrations')==str(11+eleven)
            assert f.query('select '+builder.content_guard_catalog())==before
            assert f.query(inspected)=='MENAION_ISSUE_PACKAGE_ALREADY_APPLIED\nMENAION_ISSUE_PACKAGE_LEGACY_UNMAPPED_ATTEMPTED=0'
            f.query(applied,False)
            f.query((migrations.parent/'tests/pronunciation_issues.sql').read_text())
            print(f'PASS H9+10={ten}+11={eleven}: atomic failure/rollback, apply, exact catalog/security, policy preservation, no replay, source acceptance')
        f.reset()
        for sql in (inspected,applied):
            f.query(sql,False,db='postgres')
            f.query(sql,False,user='wrong_executor')
        baseline(False,False)
        print('PASS fixed database and executor refuse before schema effects')
        rows=builder.checked_manifest(MANIFEST)
        cases=[
          ('revoke usage on schema living_menaion from service_role','grant usage on schema living_menaion to service_role'),
          ('grant usage on schema menaion_feedback_private to anon','revoke usage on schema menaion_feedback_private from anon'),
          ('alter table public.living_menaion_schema_migrations add column surprise integer not null default 1',
           'alter table public.living_menaion_schema_migrations drop column surprise'),
          ("update public.living_menaion_schema_migrations set checksum=repeat('0',64) where version='20261002184929'",
           f"update public.living_menaion_schema_migrations set checksum='{rows[-1]['checksum']}' where version='20261002184929'"),
          ("delete from public.living_menaion_schema_migrations where version='20261002184929'",
           f"insert into public.living_menaion_schema_migrations(version,checksum) values ('20261002184929','{rows[-1]['checksum']}')"),
          ("insert into public.living_menaion_schema_migrations(version,checksum) values ('20991231235959',repeat('0',64))",
           "delete from public.living_menaion_schema_migrations where version='20991231235959'"),
          (f"insert into public.living_menaion_schema_migrations(version,checksum) values ('{builder.VERSION12}','{builder.SOURCE12_SHA}')",
           f"delete from public.living_menaion_schema_migrations where version='{builder.VERSION12}'"),
          ('create table menaion_feedback_private.issue_receipts(id integer)','drop table menaion_feedback_private.issue_receipts'),
          ('create type menaion_feedback_private.issue_ingestions as (id integer)','drop type menaion_feedback_private.issue_ingestions'),
          ('create table menaion_feedback_private.issue_receipts_callback_once(id integer)','drop table menaion_feedback_private.issue_receipts_callback_once'),
          ("create function living_menaion.ingest_pronunciation_issue() returns void language sql as 'select'",'drop function living_menaion.ingest_pronunciation_issue()'),
          ('create policy issue_rate_buckets_service on menaion_feedback_private.rate_buckets for select using(true)',
           'drop policy issue_rate_buckets_service on menaion_feedback_private.rate_buckets'),
          ('alter table menaion_feedback_private.rate_buckets disable row level security','alter table menaion_feedback_private.rate_buckets enable row level security'),
          ('grant select on menaion_feedback_private.rate_buckets to anon','revoke select on menaion_feedback_private.rate_buckets from anon'),
          ('alter role menaion_feedback_writer login','alter role menaion_feedback_writer nologin'),
          ('grant menaion_feedback_submit to authenticator','revoke menaion_feedback_submit from authenticator'),
        ]
        for change,repair in cases:
            f.query(change)
            f.query(inspected,False)
            f.query(applied,False)
            f.query(repair)
            baseline(False,False)
        print('PASS altered checksum/history/future version, relation/type/index-name/RPC/policy collisions and predecessor ACL/role/RLS drift')
        # Policy11 is optional, but when recorded its canonical code and exact trigger are mandatory.
        f.reset(False,True)
        f.query('alter table living_menaion.liturgical_day_editions disable trigger blockwise_edition_readiness')
        f.query(inspected,False);f.query(applied,False);baseline(False,True)
        f.query('alter table living_menaion.liturgical_day_editions enable trigger blockwise_edition_readiness')
        f.query("create or replace function living_menaion.guard_blockwise_edition_readiness() returns trigger language plpgsql security invoker set search_path='' as $$begin return new; end;$$")
        f.query(inspected,False);f.query(applied,False);baseline(False,True)
        print('PASS policy11 function and trigger drift refuse without replacement')
        f.reset(True,False)
        f.query("insert into living_menaion.pronunciation_entries(locale,canonical_token,spoken_form,scope_type,version,status,source_note) values ('ru','слово','слОво','global',1,'draft','public-audio-feedback')")
        inspect_ready(0)
        f.query("update menaion_feedback_private.moderation_outbox set attempts=1")
        inspect_ready(1)
        assert 'LEGACY_UNMAPPED_ATTEMPTED=1' in f.query(applied)
        assert 'LEGACY_UNMAPPED_ATTEMPTED=1' in f.query(inspected)
        print('PASS outstanding attempted legacy work remains preserved and reported as activation blocker')
        # Completed packages remain verification only, and all material live security drift fails closed.
        security_cases=[
          ('revoke usage on schema living_menaion from service_role','grant usage on schema living_menaion to service_role'),
          ('revoke usage on schema menaion_feedback_private from service_role','grant usage on schema menaion_feedback_private to service_role'),
          ('grant create on schema living_menaion to anon','revoke create on schema living_menaion from anon'),
          ('grant select on menaion_feedback_private.issue_receipts to anon','revoke select on menaion_feedback_private.issue_receipts from anon'),
          ('grant update(payload) on menaion_feedback_private.issue_receipts to service_role','revoke update(payload) on menaion_feedback_private.issue_receipts from service_role'),
          ('grant service_role to anon','revoke service_role from anon'),
          ('alter table menaion_feedback_private.issue_actions disable row level security','alter table menaion_feedback_private.issue_actions enable row level security'),
          ('alter table menaion_feedback_private.issue_actions disable trigger issue_transport_binding_immutable','alter table menaion_feedback_private.issue_actions enable trigger issue_transport_binding_immutable'),
          ('alter table menaion_feedback_private.issue_receipts owner to postgres','alter table menaion_feedback_private.issue_receipts owner to supabase_admin'),
          ('create policy drift on menaion_feedback_private.issue_receipts for select to anon using(true)','drop policy drift on menaion_feedback_private.issue_receipts'),
        ]
        for change,repair in security_cases:
            f.query(change);f.query(inspected,False);f.query(applied,False);f.query(repair)
            assert 'ALREADY_APPLIED' in f.query(inspected)
        f.query('drop index menaion_feedback_private.issue_receipts_callback_once')
        f.query(inspected,False)
        print('PASS completed package rejects grants/column grants/inherited access/owner/RLS/policy/trigger/unique-index drift')
        # The optional dormant authenticator is deliberately not an infrastructure prerequisite.
        f.reset()
        f.query('revoke service_role from menaion_rest_authenticator; revoke connect on database living_menaion from menaion_rest_authenticator; revoke connect on database fixture_h9 from menaion_rest_authenticator')
        f.query('drop role menaion_rest_authenticator',db='postgres')
        inspect_ready()
        assert 'MENAION_ISSUE_PACKAGE_VERIFIED' in f.query(applied)
        print('PASS existing trusted schema path works without a Menaion authenticator role/login/JWT/Notify DB')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin',type=Path,required=True)
    parser.add_argument('--migrations-dir',type=Path,required=True)
    parser.add_argument('--policy11',type=Path,required=True)
    args=parser.parse_args()
    run(args.pg_bin.resolve(),args.migrations_dir.resolve(),args.policy11.resolve())
