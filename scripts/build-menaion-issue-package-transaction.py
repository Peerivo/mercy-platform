"""Frozen issue-moderation schema package; no auth/runtime or arbitrary SQL input."""
import hashlib
import json
from pathlib import Path
import re
import sys

VERSION10 = '20261005073345'
VERSION11 = '20261006033844'
VERSION12 = '20261006055900'
SOURCE10_SHA = 'ee2bf27553ca0a71baa275ad607b7ddbf0893e9e64d5687d8029d94bf592b499'
SOURCE11_SHA = '48292e5d1ae87aea8931cdd3cd8d28f1ffbef1795adc0e28c874eb0b6b5b7b34'
SOURCE12_SHA = '57661d31ed4bc5f441b94a1b9f44b704e17ac6b98c390c8a4bddfcdd16a076a3'
MANIFEST_SHA = '613887b5920dcffae6cad1db2b107ba0f8e366ae8c21f809a0b31f7d2fbf91a6'
CONTRACT_SHA = 'd2ff79cf5ecf3818e807b58130e05835b43369b4665fd9fa14c4b9361e67a2ce'
CIPHERTEXT10_SHA = '0462c0804ee37bb73edfbe468c16ccd5cfd5de69a7f1e1e108c4d50625e7fa57'
CIPHERTEXT12_SHA = '1bc348d8c88f45815a34defd25e77b44aa589892a4be150ff3dddeb2ae5ebe68'
CERTIFICATE_SHA = '1c445517d9fe95784a9caced337ce5f34b9132610afd1946f325bd5ad8d385c9'
TABLES10 = ['menaion_feedback_private.' + n for n in
    ('moderation_outbox', 'moderation_decisions', 'pronunciation_cache_invalidations')]
TABLES12 = ['menaion_feedback_private.' + n for n in
    ('issue_ingestions', 'issue_actions', 'issue_action_attempts', 'issue_receipts')]
FUNCTIONS10 = ['living_menaion.' + n for n in (
    'claim_pronunciation_moderation', 'record_pronunciation_notification',
    'defer_pronunciation_moderation', 'hold_pronunciation_moderation',
    'apply_pronunciation_moderation_decision', 'claim_pronunciation_cache_invalidations',
    'renew_pronunciation_cache_invalidation', 'complete_pronunciation_cache_invalidation')]
FUNCTIONS10 += ['menaion_feedback_private.enqueue_pronunciation_moderation',
                'menaion_feedback_private.protect_moderation_binding']
PUBLISH = ['living_menaion.publish_pronunciation_entry']
FUNCTIONS12 = ['living_menaion.' + n for n in (
    'ingest_pronunciation_issue', 'claim_pronunciation_issue_work',
    'reserve_pronunciation_issue_action', 'retry_pronunciation_issue_action',
    'record_pronunciation_issue_dispatch', 'record_pronunciation_issue_delivery',
    'apply_pronunciation_issue_decision', 'finish_pronunciation_issue_work')]
FUNCTIONS12 += ['menaion_feedback_private.' + n for n in (
    'valid_issue_receipt', 'issue_prior_attempts_failed', 'protect_issue_transport_binding')]
POLICY11 = ['living_menaion.assert_liturgical_day_edition_complete',
            'living_menaion.guard_blockwise_edition_readiness']
RATE = ['menaion_feedback_private.rate_buckets']
ENTRIES = ['living_menaion.pronunciation_entries']


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def json_literal(value):
    return literal(json.dumps(value, separators=(',', ':'))) + '::jsonb'


def names_sql(names):
    return ','.join(map(literal, names))


def checked_manifest(raw):
    if sha(raw) != MANIFEST_SHA:
        raise ValueError('Historical manifest mismatch')
    rows = json.loads(raw)
    if not isinstance(rows, list) or len(rows) != 9:
        raise ValueError('Exactly nine historical predecessors required')
    for row in rows:
        if (not isinstance(row, dict) or set(row) != {'version', 'checksum'}
            or not isinstance(row['version'], str) or not re.fullmatch(r'[0-9]{14}', row['version'])
            or not isinstance(row['checksum'], str) or not re.fullmatch(r'[0-9a-f]{64}', row['checksum'])):
            raise ValueError('Invalid predecessor')
    if [r['version'] for r in rows] != sorted(set(r['version'] for r in rows)):
        raise ValueError('Unordered predecessors')
    return rows


def checked_contract(raw):
    if sha(raw) != CONTRACT_SHA:
        raise ValueError('Catalog contract mismatch')
    contract = json.loads(raw)
    if contract['sourceDigests'] != {VERSION10: SOURCE10_SHA, VERSION11: SOURCE11_SHA, VERSION12: SOURCE12_SHA}:
        raise ValueError('Source contract mismatch')
    return contract


def histories(rows, complete=False):
    answer = []
    for ten in (False, True):
        for eleven in (False, True):
            if complete and not ten:
                continue
            result = list(rows)
            if ten: result.append({'version': VERSION10, 'checksum': SOURCE10_SHA})
            if eleven: result.append({'version': VERSION11, 'checksum': SOURCE11_SHA})
            if complete: result.append({'version': VERSION12, 'checksum': SOURCE12_SHA})
            answer.append(result)
    return answer


def history_query():
    return """(select coalesce(jsonb_agg(jsonb_build_object('version',version,'checksum',checksum)
        order by version),'[]'::jsonb) from public.living_menaion_schema_migrations)"""


def has_version(version):
    return f"exists(select from public.living_menaion_schema_migrations where version='{version}')"


def acl_query(acl, owner, kind):
    return f"""(select coalesce(jsonb_agg(jsonb_build_array(
        case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
        pg_get_userbyid(a.grantor), a.privilege_type, a.is_grantable)
        order by a.grantee=0, pg_get_userbyid(a.grantee), pg_get_userbyid(a.grantor),
        a.privilege_type, a.is_grantable),'[]'::jsonb)
        from aclexplode(coalesce({acl},acldefault('{kind}',{owner}))) a)"""


def function_catalog(names, security=True):
    # pg_get_functiondef covers exact body, language, arguments/defaults, volatility,
    # security mode and search_path. Only its digest is included in the public contract.
    metadata = f", 'owner',pg_get_userbyid(p.proowner),'acl',{acl_query('p.proacl','p.proowner','f')}" if security else ''
    return f"""(select coalesce(jsonb_agg(jsonb_build_object(
      'name', n.nspname||'.'||p.proname,
      'signature',p.oid::regprocedure::text,
      'definitionSha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')
      {metadata}) order by n.nspname,p.proname,p.oid::regprocedure::text),'[]'::jsonb)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname||'.'||p.proname in ({names_sql(names)}))"""


def schema_catalog():
    return f"""(select jsonb_agg(jsonb_build_object('name',n.nspname,
      'owner',pg_get_userbyid(n.nspowner),'acl',{acl_query('n.nspacl','n.nspowner','n')})
      order by n.nspname) from pg_namespace n
      where n.nspname in ('living_menaion','menaion_feedback','menaion_feedback_private'))"""


def table_catalog(names):
    return f"""(select coalesce(jsonb_agg(jsonb_build_object(
      'name',n.nspname||'.'||c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
      'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'persistence',c.relpersistence,
      'acl',{acl_query('c.relacl','c.relowner','r')},
      'columns',(select coalesce(jsonb_agg(jsonb_build_array(a.attname,
        format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,
        (select pg_get_expr(d.adbin,d.adrelid) from pg_attrdef d where d.adrelid=c.oid and d.adnum=a.attnum),
        co.collname,{acl_query('a.attacl','c.relowner','c')}) order by a.attnum),'[]'::jsonb)
        from pg_attribute a left join pg_collation co on co.oid=a.attcollation
        where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
      'constraints',(select coalesce(jsonb_agg(jsonb_build_array(co.conname,co.contype,
        pg_get_constraintdef(co.oid),co.convalidated,co.condeferrable,co.condeferred)
        order by co.conname),'[]'::jsonb) from pg_constraint co where co.conrelid=c.oid),
      'indexes',(select coalesce(jsonb_agg(jsonb_build_array(ci.relname,pg_get_indexdef(i.indexrelid),
        i.indisvalid,i.indisready,i.indislive) order by ci.relname),'[]'::jsonb)
        from pg_index i join pg_class ci on ci.oid=i.indexrelid where i.indrelid=c.oid),
      'policies',(select coalesce(jsonb_agg(jsonb_build_array(pol.polname,pol.polcmd,pol.polpermissive,
        (select jsonb_agg(case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end
          order by case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end) from unnest(pol.polroles) r),
        pg_get_expr(pol.polqual,pol.polrelid),pg_get_expr(pol.polwithcheck,pol.polrelid))
        order by pol.polname),'[]'::jsonb) from pg_policy pol where pol.polrelid=c.oid),
      'triggers',(select coalesce(jsonb_agg(jsonb_build_array(t.tgname,pg_get_triggerdef(t.oid),
        t.tgenabled) order by t.tgname),'[]'::jsonb) from pg_trigger t
        where t.tgrelid=c.oid and not t.tgisinternal))
      order by n.nspname,c.relname),'[]'::jsonb)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname||'.'||c.relname in ({names_sql(names)}))"""


def trigger_catalog():
    return """(select coalesce(jsonb_agg(jsonb_build_array(t.tgname,pg_get_triggerdef(t.oid),t.tgenabled)
      order by t.tgname),'[]'::jsonb) from pg_trigger t
      where t.tgrelid=to_regclass('living_menaion.liturgical_day_editions')
        and t.tgname='blockwise_edition_readiness')"""


def content_guard_catalog():
    return f"jsonb_build_array({function_catalog(POLICY11)}, {trigger_catalog()})"


def digest_query(query):
    return f"encode(sha256(convert_to(({query})::text,'UTF8')),'hex')"


def check_digest(query, expected, category):
    if not re.fullmatch(r'[0-9a-f]{64}', expected): raise ValueError('Invalid catalog digest')
    return f"if {digest_query(query)} is distinct from '{expected}' then raise exception '{category}'; end if;"


def target_gate():
    return """do $target$
begin
 if current_database()<>'living_menaion' or current_user<>'supabase_admin'
    or session_user<>'supabase_admin' or not exists(select from pg_roles where rolname=current_user and rolsuper)
 then raise exception 'Wrong fixed target or executor'; end if;
 if current_setting('server_version_num')::integer not between 170000 and 179999
 then raise exception 'Unreviewed PostgreSQL catalog version'; end if;
 if not exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname='living_menaion_schema_migrations'
     and c.relkind='r' and not c.relrowsecurity)
 then raise exception 'Missing or unexpected history relation'; end if;
 if (select count(*) from pg_attribute where attrelid='public.living_menaion_schema_migrations'::regclass
     and attnum>0 and not attisdropped and attname in ('version','checksum')
     and atttypid='text'::regtype and attnotnull)<>2
    or not exists(select from pg_constraint where conrelid='public.living_menaion_schema_migrations'::regclass
      and contype='p' and pg_get_constraintdef(oid)='PRIMARY KEY (version)')
    or exists(select from pg_trigger where tgrelid='public.living_menaion_schema_migrations'::regclass and not tgisinternal)
    or exists(select from pg_rewrite where ev_class='public.living_menaion_schema_migrations'::regclass)
    then raise exception 'History structure or trigger drift'; end if;
end;
$target$;
"""


def collision_gate(contract, version):
    objects = contract['newObjects'][version]
    q = ','.join(map(literal, objects['relations']))
    f = names_sql(objects['functions'])
    result = f"""if exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname||'.'||c.relname in ({q}))
      or exists(select from pg_type t join pg_namespace n on n.oid=t.typnamespace
      where n.nspname||'.'||t.typname in ({q}))
      or exists(select from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname||'.'||p.proname in ({f})) then raise exception 'Package object collision'; end if;
"""
    if version==VERSION10:
        result += """if exists(select from pg_trigger where tgrelid=to_regclass('living_menaion.pronunciation_entries')
          and tgname='pronunciation_moderation_enqueue') then raise exception 'Queue trigger collision'; end if;
"""
    else:
        result += """if exists(select from pg_policy where polrelid=to_regclass('menaion_feedback_private.rate_buckets')
          and polname='issue_rate_buckets_service') then raise exception 'Issue rate policy collision'; end if;
"""
    return result


def prerequisite_gate():
    # No new or active PostgREST authenticator, JWT, login, Notify DB, or RU core is required.
    return """if (select count(*) from pg_roles where rolname in
      ('service_role','menaion_feedback_submit','menaion_feedback_writer','living_menaion_app','anon','authenticated'))<>6
      then raise exception 'Missing schema predecessor role'; end if;
 if exists(select from pg_roles where rolname in ('menaion_feedback_submit','menaion_feedback_writer')
      and (rolcanlogin or rolsuper or rolinherit or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication))
      then raise exception 'Feedback role boundary drift'; end if;
 if to_regnamespace('living_menaion') is null or to_regnamespace('menaion_feedback_private') is null
      or to_regprocedure('living_menaion.publish_pronunciation_entry(uuid,text)') is null
      or to_regprocedure('menaion_feedback.submit_pronunciation_correction(text,text,text)') is null
      then raise exception 'Missing predecessor objects'; end if;
 if not has_schema_privilege('service_role','living_menaion','USAGE')
      then raise exception 'Missing service content schema usage'; end if;
 if not exists(select from pg_class where oid=to_regclass('living_menaion.pronunciation_entries') and relrowsecurity)
      or not exists(select from pg_class where oid=to_regclass('menaion_feedback_private.rate_buckets') and relrowsecurity)
      then raise exception 'Predecessor RLS drift'; end if;
 if has_schema_privilege('menaion_feedback_submit','living_menaion','USAGE')
      or has_table_privilege('menaion_feedback_submit','living_menaion.pronunciation_entries','SELECT,INSERT,UPDATE,DELETE')
      or has_table_privilege('menaion_feedback_writer','living_menaion.pronunciation_entries','UPDATE,DELETE')
      then raise exception 'Feedback content boundary drift'; end if;
 if exists(select from pg_roles where rolname='authenticator') then
   if pg_has_role('authenticator','menaion_feedback_submit','MEMBER')
     then raise exception 'Shared authenticator boundary drift'; end if;
 end if;
"""


def effective_denials(tables, functions):
    return f"""if exists(select from pg_roles r,pg_class c join pg_namespace n on n.oid=c.relnamespace
      where r.rolname in ('anon','authenticated','menaion_feedback_submit','menaion_feedback_writer','living_menaion_app')
        and n.nspname||'.'||c.relname in ({names_sql(tables)})
        and (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
             or has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
      or exists(select from pg_roles r,pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where r.rolname in ('anon','authenticated','menaion_feedback_submit','menaion_feedback_writer','living_menaion_app')
        and n.nspname||'.'||p.proname in ({names_sql(functions)})
        and has_function_privilege(r.oid,p.oid,'EXECUTE'))
      then raise exception 'Effective worker privilege exposed'; end if;
"""


def catalog_gates(contract):
    c = contract['catalogDigests']
    ten = '\n'.join([check_digest(table_catalog(ENTRIES),c['entries10'],'Pronunciation catalog drift'),check_digest(table_catalog(TABLES10),c['tables10'],'Moderation table catalog drift'),
                     check_digest(function_catalog(FUNCTIONS10),c['functions10'],'Moderation RPC catalog drift'),
                     check_digest(function_catalog(PUBLISH,False),c['publish10'],'Publisher catalog drift'),
                     check_digest("""(select jsonb_build_array(pg_get_triggerdef(oid),tgenabled) from pg_trigger
                       where tgrelid=to_regclass('living_menaion.pronunciation_entries')
                         and tgname='pronunciation_moderation_enqueue')""",c['enqueueTrigger'],'Queue trigger drift')])
    twelve = '\n'.join([check_digest(table_catalog(TABLES12),c['tables12'],'Issue table catalog drift'),
                        check_digest(function_catalog(FUNCTIONS12),c['functions12'],'Issue RPC catalog drift')])
    eleven = '\n'.join([check_digest(function_catalog(POLICY11,False),c['policy11Functions'],'Policy11 function drift'),
                        check_digest(trigger_catalog(),c['policy11Trigger'],'Policy11 trigger drift'),
                        """if not exists(select from pg_proc where oid=to_regprocedure('living_menaion.guard_blockwise_edition_readiness()')
                           and proowner=(select oid from pg_roles where rolname='supabase_admin'))
                           then raise exception 'Policy11 helper owner drift'; end if;
                        if exists(select from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
                           where p.oid=to_regprocedure('living_menaion.guard_blockwise_edition_readiness()')
                             and a.grantee not in (p.proowner,(select oid from pg_roles where rolname='service_role'),(select oid from pg_roles where rolname='living_menaion_app')))
                           then raise exception 'Policy11 helper grant drift'; end if;"""])
    return prerequisite_gate()+f"""
 {check_digest(table_catalog(['public.living_menaion_schema_migrations']),c['ledger'],'History catalog drift')}
 if {has_version(VERSION10)} then {ten}
 {check_digest(schema_catalog(),c['schemas10'],'Schema catalog drift')}
 if not has_schema_privilege('service_role','menaion_feedback_private','USAGE')
 then raise exception 'Missing service private schema usage'; end if;
 {effective_denials(TABLES10,FUNCTIONS10)} else {collision_gate(contract,VERSION10)}
 {check_digest(schema_catalog(),c['schemas9'],'Predecessor schema catalog drift')}
 {check_digest(table_catalog(ENTRIES),c['entries9'],'Pronunciation predecessor drift')}
 {check_digest(function_catalog(PUBLISH,False),c['publish9'],'Publisher predecessor drift')} end if;
 if {has_version(VERSION12)} then
   {twelve}
   {effective_denials(TABLES12,FUNCTIONS12)}
   {check_digest(table_catalog(RATE),c['rate12'],'Issue quota catalog drift')}
 else
   {collision_gate(contract,VERSION12)}
   {check_digest(table_catalog(RATE),c['rate9'],'Predecessor quota catalog drift')}
 end if;
 if {has_version(VERSION11)} then {eleven}
 elsif exists(select from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='living_menaion' and p.proname='guard_blockwise_edition_readiness')
   or exists(select from pg_trigger where tgrelid=to_regclass('living_menaion.liturgical_day_editions')
     and tgname='blockwise_edition_readiness') then raise exception 'Unledgered policy11 objects'; end if;
"""


def state_gate(rows, contract, allow_complete=True):
    permitted = histories(rows) + (histories(rows,True) if allow_complete else [])
    return f"""if not ({' or '.join(history_query()+' = '+json_literal(h) for h in permitted)})
      then raise exception 'Exact history required'; end if;
{catalog_gates(contract)}
"""


def legacy_count_sql():
    return f"""do $legacy$ declare remaining bigint:=0; begin
 if {has_version(VERSION10)} then
   if {has_version(VERSION12)} then
     select count(*) into remaining from menaion_feedback_private.moderation_outbox o
      where o.decision is null and (o.attempts>0 or o.notify_action_id is not null)
       and not exists(select from menaion_feedback_private.issue_ingestions i
         where i.entry_id=o.entry_id and i.admission_status='saved');
   else
     select count(*) into remaining from menaion_feedback_private.moderation_outbox
       where decision is null and (attempts>0 or notify_action_id is not null);
   end if;
 end if;
 perform set_config('menaion.issue_legacy_count',remaining::text,true);
end; $legacy$;
"""


def build_inspection(manifest, raw_contract):
    rows, contract = checked_manifest(manifest), checked_contract(raw_contract)
    return """begin read only;
set local search_path=pg_catalog;
set local statement_timeout='10s';
"""+target_gate()+f"""do $inspect$ begin
{state_gate(rows,contract)}
end; $inspect$;
{legacy_count_sql()}
select case when {has_version(VERSION12)} then 'MENAION_ISSUE_PACKAGE_ALREADY_APPLIED'
 else 'MENAION_ISSUE_PACKAGE_READY' end;
select 'MENAION_ISSUE_PACKAGE_LEGACY_UNMAPPED_ATTEMPTED='||current_setting('menaion.issue_legacy_count');
rollback;
"""


ROLE_SNAPSHOT = "select oid,rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil,rolconfig from pg_roles"
MEMBERSHIP_SNAPSHOT = 'select * from pg_auth_members'


def build_transaction(migration10, migration12, manifest, raw_contract):
    if sha(migration10)!=SOURCE10_SHA or sha(migration12)!=SOURCE12_SHA:
        raise ValueError('Canonical source mismatch')
    rows, contract = checked_manifest(manifest), checked_contract(raw_contract)
    # psql branch uses a catalog-derived boolean only. Both histories are checked
    # again under the exclusive ledger lock; completed packages cannot replay.
    before = """begin;
set local search_path=pg_catalog;
set local lock_timeout='5s';
set local statement_timeout='30s';
"""+target_gate()+f"""lock table public.living_menaion_schema_migrations in exclusive mode;
do $gate$ begin
{state_gate(rows,contract,False)}
end; $gate$;
create temporary table _issue_roles_before on commit drop as {ROLE_SNAPSHOT};
create temporary table _issue_memberships_before on commit drop as {MEMBERSHIP_SNAPSHOT};
create temporary table _issue_content_before on commit drop as select {content_guard_catalog()} as value;
create temporary table _issue_publisher_before on commit drop as
 select proowner,proacl from pg_proc where oid='living_menaion.publish_pronunciation_entry(uuid,text)'::regprocedure;
select not {has_version(VERSION10)} as apply10 \\gset
\\if :apply10
"""
    middle=f"""
insert into public.living_menaion_schema_migrations(version,checksum) values ('{VERSION10}','{SOURCE10_SHA}');
\\endif
"""
    after=f"""
insert into public.living_menaion_schema_migrations(version,checksum) values ('{VERSION12}','{SOURCE12_SHA}');
do $verify$ begin
{state_gate(rows,contract)}
 if not ({' or '.join(history_query()+' = '+json_literal(h) for h in histories(rows,True))})
    then raise exception 'Incomplete package history'; end if;
 if exists((select * from pg_temp._issue_roles_before except {ROLE_SNAPSHOT})
   union all ({ROLE_SNAPSHOT} except select * from pg_temp._issue_roles_before))
   then raise exception 'Role attributes changed'; end if;
 if exists((select * from pg_temp._issue_memberships_before except {MEMBERSHIP_SNAPSHOT})
   union all ({MEMBERSHIP_SNAPSHOT} except select * from pg_temp._issue_memberships_before))
   then raise exception 'Role memberships changed'; end if;
 if {content_guard_catalog()} is distinct from (select value from pg_temp._issue_content_before)
   then raise exception 'Content policy changed'; end if;
 if exists((select proowner,proacl from pg_proc where oid='living_menaion.publish_pronunciation_entry(uuid,text)'::regprocedure
   except select * from pg_temp._issue_publisher_before)
   union all (select * from pg_temp._issue_publisher_before except
     select proowner,proacl from pg_proc where oid='living_menaion.publish_pronunciation_entry(uuid,text)'::regprocedure))
   then raise exception 'Publisher owner or ACL changed'; end if;
end; $verify$;
{legacy_count_sql()}
select 'MENAION_ISSUE_PACKAGE_LEGACY_UNMAPPED_ATTEMPTED='||current_setting('menaion.issue_legacy_count');
commit;
select 'MENAION_ISSUE_PACKAGE_VERIFIED';
"""
    return before+migration10.decode('utf-8')+middle+migration12.decode('utf-8')+after


def main():
    mode, directory = sys.argv[1:]
    root = Path(directory)
    manifest, contract = (root/'manifest.json').read_bytes(), (root/'contract.json').read_bytes()
    if mode=='inspect': name, output = 'inspection.sql',build_inspection(manifest,contract)
    elif mode=='apply':
        name, output = 'transaction.sql',build_transaction((root/'migration10.sql').read_bytes(),
          (root/'migration12.sql').read_bytes(),manifest,contract)
    else: raise ValueError('Invalid mode')
    (root/name).write_text(output)


if __name__=='__main__':
    try: main()
    except Exception: raise SystemExit('Issue package transaction construction refused')
