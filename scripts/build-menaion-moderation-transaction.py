"""Pinned migration10 transport. No credentials, runtime activation, or arbitrary SQL."""
import hashlib
import json
from pathlib import Path
import re
import sys

VERSION = '20261005073345'
MIGRATION_SHA = 'ee2bf27553ca0a71baa275ad607b7ddbf0893e9e64d5687d8029d94bf592b499'
MANIFEST_SHA = '613887b5920dcffae6cad1db2b107ba0f8e366ae8c21f809a0b31f7d2fbf91a6'
CIPHERTEXT_SHA = '0462c0804ee37bb73edfbe468c16ccd5cfd5de69a7f1e1e108c4d50625e7fa57'
CERTIFICATE_SHA = '1c445517d9fe95784a9caced337ce5f34b9132610afd1946f325bd5ad8d385c9'
FUNCTIONS = (
    'claim_pronunciation_moderation(text,integer,integer)',
    'record_pronunciation_notification(uuid,uuid,text,text,text)',
    'defer_pronunciation_moderation(uuid,uuid,text,integer)',
    'hold_pronunciation_moderation(uuid,uuid,text)',
    'apply_pronunciation_moderation_decision(uuid,uuid,text,text,text,text)',
    'claim_pronunciation_cache_invalidations(text,integer,integer)',
    'renew_pronunciation_cache_invalidation(uuid,uuid,integer)',
    'complete_pronunciation_cache_invalidation(uuid,uuid,text,integer)',
)
TABLES = ('moderation_outbox', 'moderation_decisions', 'pronunciation_cache_invalidations')
DENIED_ROLES = ('anon', 'authenticated', 'menaion_feedback_submit',
                'menaion_feedback_writer', 'living_menaion_app')


def checked_manifest(manifest):
    if hashlib.sha256(manifest).hexdigest() != MANIFEST_SHA:
        raise ValueError('Predecessor integrity mismatch')
    rows = json.loads(manifest)
    if not isinstance(rows, list) or len(rows) != 9:
        raise ValueError('Nine immutable predecessors required')
    for row in rows:
        if not isinstance(row, dict) or set(row) != {'version', 'checksum'}:
            raise ValueError('Invalid predecessor shape')
        if not isinstance(row['version'], str) or not re.fullmatch(r'[0-9]{14}', row['version']):
            raise ValueError('Invalid version')
        if not isinstance(row['checksum'], str) or not re.fullmatch(r'[0-9a-f]{64}', row['checksum']):
            raise ValueError('Invalid checksum')
    versions = [row['version'] for row in rows]
    if versions != sorted(set(versions)) or versions[-1] >= VERSION:
        raise ValueError('Invalid predecessor order')
    return rows


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def json_literal(value):
    return literal(json.dumps(value, separators=(',', ':'))) + '::jsonb'


def target_gate():
    return """do $target$
begin
 if current_database() <> 'living_menaion' then raise exception 'Wrong target'; end if;
 if current_user <> 'supabase_admin' or session_user <> 'supabase_admin'
    or not exists(select from pg_roles where rolname=current_user and rolsuper)
    then raise exception 'Wrong executor'; end if;
 if to_regclass('public.living_menaion_schema_migrations') is null
    then raise exception 'Missing migration ledger'; end if;
end;
$target$;
"""


def history_query():
    return """(select coalesce(jsonb_agg(jsonb_build_object('version',version,'checksum',checksum)
       order by version),'[]'::jsonb) from public.living_menaion_schema_migrations)"""


def prerequisite_gate():
    statements = ["""if (select count(*) from pg_roles where rolname in
 ('service_role','menaion_feedback_submit','menaion_feedback_writer','living_menaion_app',
  'menaion_rest_authenticator','authenticator','anon','authenticated')) <> 8
 then raise exception 'Missing predecessor roles'; end if;
 if (select count(*) from pg_roles where rolname in ('menaion_feedback_submit','menaion_feedback_writer')
 and not (rolcanlogin or rolsuper or rolinherit or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication)) <> 2
 then raise exception 'Feedback role boundary drift'; end if;
 if to_regnamespace('menaion_feedback_private') is null
    or to_regprocedure('menaion_feedback.submit_pronunciation_correction(text,text,text)') is null
    or to_regprocedure('living_menaion.publish_pronunciation_entry(uuid,text)') is null
    then raise exception 'Missing predecessor objects'; end if;
 if not exists(select from pg_class where oid=to_regclass('living_menaion.pronunciation_entries')
    and relrowsecurity) then raise exception 'Missing content RLS'; end if;
 if not exists(select from pg_class where oid=to_regclass('menaion_feedback_private.rate_buckets')
    and relrowsecurity) then raise exception 'Missing private RLS'; end if;
"""]
    names = [x.split('(')[0] for x in FUNCTIONS] + ['enqueue_pronunciation_moderation', 'protect_moderation_binding']
    statements += [f"if exists(select from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
                   f"where n.nspname in ('living_menaion','menaion_feedback_private') and p.proname in "
                   f"({','.join(map(literal,names))})) then raise exception 'Function collision'; end if;"]
    for table in TABLES:
        statements += [f"if to_regclass('menaion_feedback_private.{table}') is not null "
                       "then raise exception 'Table collision'; end if;"]
    statements += ["if exists(select from pg_trigger where tgrelid=to_regclass('living_menaion.pronunciation_entries') "
                   "and tgname='pronunciation_moderation_enqueue') then raise exception 'Trigger collision'; end if;"]
    return '\n'.join(statements)


def verification_gate():
    checks = []
    for table in TABLES:
        name = 'menaion_feedback_private.' + table
        checks += [f"if not exists(select from pg_class where oid=to_regclass('{name}') and relrowsecurity) "
                   "then raise exception 'Private RLS missing'; end if;",
                   f"if not has_table_privilege('service_role','{name}','SELECT') "
                   "then raise exception 'Worker grant missing'; end if;",
                   f"if exists(select from pg_class c, lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a "
                   f"where c.oid='{name}'::regclass and a.grantee=0) then raise exception 'Public table grant'; end if;"]
        for role in DENIED_ROLES:
            checks += [f"if has_table_privilege('{role}','{name}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') "
                       f"or has_any_column_privilege('{role}','{name}','SELECT,INSERT,UPDATE,REFERENCES') "
                       "then raise exception 'Private access broadened'; end if;"]
    for function in FUNCTIONS:
        name = 'living_menaion.' + function
        checks += [f"if not exists(select from pg_proc where oid=to_regprocedure('{name}') and not prosecdef "
                   "and proconfig @> array['search_path=\"\"']) then raise exception 'RPC boundary mismatch'; end if;",
                   f"if not has_function_privilege('service_role','{name}','EXECUTE') "
                   "then raise exception 'Worker RPC missing'; end if;",
                   f"if exists(select from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a "
                   f"where p.oid='{name}'::regprocedure and a.grantee=0) then raise exception 'Public RPC grant'; end if;"]
        for role in DENIED_ROLES:
            checks += [f"if has_function_privilege('{role}','{name}','EXECUTE') "
                       "then raise exception 'Worker RPC exposed'; end if;"]
    checks += ["""if not exists(select from pg_trigger where tgrelid='living_menaion.pronunciation_entries'::regclass
 and tgname='pronunciation_moderation_enqueue' and tgenabled='O'
 and tgfoid='menaion_feedback_private.enqueue_pronunciation_moderation()'::regprocedure)
 then raise exception 'Queue trigger missing'; end if;
 if not exists(select from pg_proc where oid='menaion_feedback_private.enqueue_pronunciation_moderation()'::regprocedure
 and prosecdef and proconfig @> array['search_path=""']) then raise exception 'Trigger boundary mismatch'; end if;
 if not exists(select from pg_trigger where tgrelid='menaion_feedback_private.moderation_outbox'::regclass
 and tgname='moderation_binding_immutable' and tgenabled='O'
 and tgfoid='menaion_feedback_private.protect_moderation_binding()'::regprocedure)
 then raise exception 'Immutable binding trigger missing'; end if;
 if exists(select from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 where p.oid in ('menaion_feedback_private.enqueue_pronunciation_moderation()'::regprocedure,
 'menaion_feedback_private.protect_moderation_binding()'::regprocedure) and a.grantee=0)
 then raise exception 'Public trigger execution grant'; end if;
 if pg_has_role('authenticator','menaion_feedback_submit','MEMBER')
    then raise exception 'Shared authenticator broadened'; end if;
 if has_schema_privilege('menaion_feedback_submit','living_menaion','USAGE')
    or has_table_privilege('menaion_feedback_submit','living_menaion.pronunciation_entries','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('menaion_feedback_writer','living_menaion.pronunciation_entries','UPDATE,DELETE')
    then raise exception 'Feedback boundary broadened'; end if;
"""]
    return '\n'.join(checks)


def build_inspection(manifest):
    rows = checked_manifest(manifest)
    applied = rows + [{'version': VERSION, 'checksum': MIGRATION_SHA}]
    return """begin read only;
set local search_path = pg_catalog;
set local statement_timeout = '10s';
""" + target_gate() + f"""do $inspect$
begin
 if {history_query()} = {json_literal(rows)} then
 {prerequisite_gate()}
 elsif {history_query()} = {json_literal(applied)} then
 {verification_gate()}
 else raise exception 'Migration history mismatch'; end if;
end;
$inspect$;
select case when {history_query()} = {json_literal(rows)}
 then 'MENAION_MODERATION_READY' else 'MENAION_MODERATION_ALREADY_APPLIED' end;
rollback;
"""


ROLE_SNAPSHOT = """select oid,rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,
 rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil from pg_roles"""
MEMBERSHIP_SNAPSHOT = 'select roleid,member,grantor,admin_option from pg_auth_members'


def build_transaction(migration, manifest):
    if hashlib.sha256(migration).hexdigest() != MIGRATION_SHA:
        raise ValueError('Migration integrity mismatch')
    rows = checked_manifest(manifest)
    pre = """begin;
set local search_path = pg_catalog;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
""" + target_gate() + f"""lock table public.living_menaion_schema_migrations in exclusive mode;
do $gate$
begin
 if {history_query()} is distinct from {json_literal(rows)}
 then raise exception 'Migration history mismatch'; end if;
 {prerequisite_gate()}
end;
$gate$;
create temporary table _menaion_roles_before on commit drop as {ROLE_SNAPSHOT};
create temporary table _menaion_memberships_before on commit drop as {MEMBERSHIP_SNAPSHOT};
"""
    post = f"""
do $verify$
begin
 {verification_gate()}
 if exists((select * from pg_temp._menaion_roles_before except {ROLE_SNAPSHOT})
 union all ({ROLE_SNAPSHOT} except select * from pg_temp._menaion_roles_before))
 then raise exception 'Role attributes changed'; end if;
 if exists((select * from pg_temp._menaion_memberships_before except {MEMBERSHIP_SNAPSHOT})
 union all ({MEMBERSHIP_SNAPSHOT} except select * from pg_temp._menaion_memberships_before))
 then raise exception 'Role membership changed'; end if;
end;
$verify$;
insert into public.living_menaion_schema_migrations(version,checksum) values ('{VERSION}','{MIGRATION_SHA}');
commit;
select 'MENAION_MODERATION_MIGRATION_VERIFIED';
"""
    return pre + migration.decode('utf-8') + '\n' + post


def main():
    mode, root = sys.argv[1:]
    root = Path(root)
    manifest = (root/'manifest.json').read_bytes()
    if mode == 'inspect':
        output, name = build_inspection(manifest), 'inspection.sql'
    elif mode == 'apply':
        output = build_transaction((root/'migration.sql').read_bytes(), manifest)
        name = 'transaction.sql'
    else:
        raise ValueError('Invalid mode')
    (root/name).write_text(output)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('Moderation transaction construction refused')
