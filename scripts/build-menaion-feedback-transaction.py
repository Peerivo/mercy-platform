"""Build a local-only atomic transaction after verifying immutable input hashes."""
import hashlib
import json
from pathlib import Path
import sys

MIGRATION_SHA = '15265e48dcbf87b24b7aed34c296c2a4a83cbba132a5e33bffc0cfdd9469444c'
MANIFEST_SHA = '80960fde159142043eb593fbcc0b2d03e354b9a73b65ec2926111a311c093ba4'
VERSION = '20261002184929'

def build_transaction(migration, manifest):
    if hashlib.sha256(migration).hexdigest() != MIGRATION_SHA:
        raise ValueError('Migration integrity mismatch')
    if hashlib.sha256(manifest).hexdigest() != MANIFEST_SHA:
        raise ValueError('Predecessor integrity mismatch')
    expected = json.dumps(json.loads(manifest), separators=(',', ':'))
    pre = """begin;
set local search_path = pg_catalog;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.living_menaion_schema_migrations in exclusive mode;
do $gate$
begin
 if current_database() <> 'living_menaion' then raise exception 'Wrong target'; end if;
 if not exists (select from pg_roles where rolname=current_user and rolsuper) then raise exception 'Wrong executor'; end if;
 if (select coalesce(jsonb_agg(jsonb_build_object('version',version,'checksum',checksum) order by version),'[]'::jsonb) from public.living_menaion_schema_migrations)
    is distinct from '""" + expected + """'::jsonb then raise exception 'Migration history mismatch'; end if;
 if exists(select from pg_roles where rolname in ('menaion_feedback_submit','menaion_feedback_writer','menaion_rest_authenticator'))
    or exists(select from pg_namespace where nspname in ('menaion_feedback','menaion_feedback_private')) then raise exception 'Object collision'; end if;
 if not exists(select from pg_class where oid='living_menaion.pronunciation_entries'::regclass and relrowsecurity) then raise exception 'Missing RLS'; end if;
end;
$gate$;
"""
    post = """
do $verify$
begin
 if (select count(*) from pg_roles where rolname in ('menaion_feedback_submit','menaion_feedback_writer','menaion_rest_authenticator')
     and not (rolcanlogin or rolsuper or rolinherit or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication)) <> 3 then raise exception 'Role boundary mismatch'; end if;
 if pg_has_role('authenticator','menaion_feedback_submit','MEMBER') then raise exception 'Shared authenticator broadened'; end if;
 if not pg_has_role('menaion_rest_authenticator','menaion_feedback_submit','MEMBER')
    or not pg_has_role('menaion_rest_authenticator','service_role','MEMBER') then raise exception 'Dedicated membership missing'; end if;
 if has_schema_privilege('menaion_feedback_submit','living_menaion','USAGE')
    or has_table_privilege('menaion_feedback_submit','living_menaion.pronunciation_entries','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('menaion_feedback_writer','living_menaion.pronunciation_entries','UPDATE,DELETE') then raise exception 'Content grants broadened'; end if;
 if not has_function_privilege('menaion_feedback_submit','menaion_feedback.submit_pronunciation_correction(text,text,text)','EXECUTE') then raise exception 'RPC grant missing'; end if;
 if not exists(select from pg_policy where polrelid='living_menaion.pronunciation_entries'::regclass and polname='feedback_writer_draft' and not polpermissive) then raise exception 'Restrictive policy missing'; end if;
 if not exists(select from pg_class where oid='menaion_feedback_private.rate_buckets'::regclass and relrowsecurity) then raise exception 'Rate RLS missing'; end if;
end;
$verify$;
set local role menaion_feedback_submit;
do $denials$
begin
 begin perform 1 from living_menaion.pronunciation_entries limit 0; raise exception 'Read unexpectedly permitted'; exception when insufficient_privilege then null; end;
 begin update living_menaion.pronunciation_entries set status='published' where false; raise exception 'Publish unexpectedly permitted'; exception when insufficient_privilege then null; end;
 begin delete from living_menaion.pronunciation_entries where false; raise exception 'Delete unexpectedly permitted'; exception when insufficient_privilege then null; end;
 begin perform living_menaion.publish_pronunciation_entry(null,'permission-probe'); raise exception 'Publish RPC unexpectedly permitted'; exception when insufficient_privilege then null; end;
 begin perform 1 from living_menaion.sources limit 0; raise exception 'Other-table read unexpectedly permitted'; exception when insufficient_privilege then null; end;
end;
$denials$;
reset role;
"""
    post += f"insert into public.living_menaion_schema_migrations(version,checksum) values ('{VERSION}','{MIGRATION_SHA}');\ncommit;\nselect 'MENAION_FEEDBACK_MIGRATION_VERIFIED';\n"
    return pre + migration.decode('utf-8') + '\n' + post

if __name__ == '__main__':
    try:
        root = Path(sys.argv[1])
        result = build_transaction((root/'migration.sql').read_bytes(), (root/'manifest.json').read_bytes())
        (root/'transaction.sql').write_text(result)
    except Exception:
        raise SystemExit('Transaction construction refused')
