"""Opt-in real PostgreSQL test. Creates its own disposable loopback-only cluster.

No existing database URL, password, Docker service, or production binding is accepted.
Supply an installed PostgreSQL bin directory and the reviewed Menaion migrations directory.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import socket
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('moderation_builder', ROOT/'scripts/build-menaion-moderation-transaction.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
spec = importlib.util.spec_from_file_location('runtime_inspector', ROOT/'scripts/inspect-menaion-runtime-handoff.py')
inspector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspector)


def run(pg_bin, migrations):
    manifest = (ROOT/'ops/living-menaion/moderation-predecessors.json').read_bytes()
    rows = builder.checked_manifest(manifest)
    migration = (migrations/'20261005073345_pronunciation_moderation_outbox.sql').read_bytes()
    transaction = builder.build_transaction(migration, manifest)
    inspection = builder.build_inspection(manifest)
    with tempfile.TemporaryDirectory(prefix='menaion-transport-test.') as directory:
        root = Path(directory)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = str(sock.getsockname()[1])

        def process(binary, *args, **kwargs):
            return subprocess.run([str(pg_bin/binary), *map(str,args)], capture_output=True, text=True, **kwargs)

        def query(sql, ok=True, db='living_menaion', user='supabase_admin'):
            result = process('psql','-X','-qAt','-h','127.0.0.1','-p',port,'-U',user,'-d',db,
                             '-v','ON_ERROR_STOP=1',input=sql)
            assert (result.returncode == 0) == ok, 'Disposable SQL expectation failed: ' + result.stderr
            return result.stdout.strip()

        def baseline():
            assert query('select count(*) from public.living_menaion_schema_migrations') == '9'
            assert query("select to_regclass('menaion_feedback_private.moderation_outbox') is null") == 't'

        result = process('initdb','-D',root/'data','-U','supabase_admin','--auth=trust','--no-locale','-E','UTF8')
        assert result.returncode == 0, result.stderr
        started = False
        try:
            result = process('pg_ctl','-D',root/'data','-l',root/'server.log','-o',
                             f"-h 127.0.0.1 -k '' -p {port}",'-w','start')
            assert result.returncode == 0, 'Disposable PostgreSQL failed to start'
            started = True
            query('''create role postgres superuser nologin;
create role service_role nologin bypassrls;
create role anon nologin;
create role authenticated nologin;
create role authenticator nologin noinherit;
create role living_menaion_owner nologin;
create role living_menaion_app nologin;
create role wrong_executor superuser login;
create database living_menaion;''', db='postgres')
            for row in rows:
                paths = list(migrations.glob(row['version']+'_*.sql'))
                assert len(paths) == 1, 'Exactly one local fixture for each predecessor required'
                query(paths[0].read_text())
            # Deployed predecessor checksums are immutable historical evidence, not
            # regenerated from current normalized source fixtures.
            query('create table public.living_menaion_schema_migrations(version text primary key,checksum text not null)')
            for row in rows:
                query(f"insert into public.living_menaion_schema_migrations values ('{row['version']}','{row['checksum']}')")
            assert query(inspection) == 'MENAION_MODERATION_READY'
            facts = inspector.validate_db_facts(json.loads(query(inspector.DB_SQL)))
            assert all(facts[key] is True for key in inspector.DB_FIELDS), 'Exact nine-row runtime preflight refused'
            baseline()
            print('PASS: exact nine-predecessor read-only inspection')
            # Exercise the actual runtime SQL/decoder against every immutable
            # predecessor, including drift that the old latest-only gate missed.
            def runtime_history(expected):
                snapshot = query("select jsonb_agg(t order by version) from public.living_menaion_schema_migrations t")
                facts = inspector.validate_db_facts(json.loads(query(inspector.DB_SQL)))
                assert facts['migration_history_exact'] is expected
                assert 'migration_history' not in facts
                assert query("select jsonb_agg(t order by version) from public.living_menaion_schema_migrations t") == snapshot
            runtime_history(True)
            for row in rows:
                query(f"update public.living_menaion_schema_migrations set checksum='{'0'*64}' where version='{row['version']}'")
                runtime_history(False)
                query(f"update public.living_menaion_schema_migrations set checksum='{row['checksum']}' where version='{row['version']}'")
                query(f"delete from public.living_menaion_schema_migrations where version='{row['version']}'")
                runtime_history(False)
                query(f"insert into public.living_menaion_schema_migrations values ('{row['version']}','{row['checksum']}')")
            runtime_history(True)
            print('PASS: runtime history rejects every predecessor checksum drift and omission without writes')
            # A hostile ledger remains a bounded metadata read: row eleven is
            # a rejection sentinel, and oversized field prefixes cannot become valid.
            query("insert into public.living_menaion_schema_migrations select '9999'||lpad(i::text,10,'0'),repeat('a',8192) from generate_series(1,1000) i")
            raw_facts = json.loads(query(inspector.DB_SQL))
            assert len(raw_facts['migration_history']) == 11
            assert all(len(row['version']) <= 15 and len(row['checksum']) <= 65 for row in raw_facts['migration_history'])
            assert inspector.validate_db_facts(raw_facts)['migration_history_exact'] is False
            query("delete from public.living_menaion_schema_migrations where version like '9999%'")
            query("insert into public.living_menaion_schema_migrations values ('"+rows[-1]['version']+"'||repeat('x',8192),repeat('a',8192))")
            raw_facts = json.loads(query(inspector.DB_SQL))
            assert len(raw_facts['migration_history'][-1]['version']) == 15
            assert len(raw_facts['migration_history'][-1]['checksum']) == 65
            assert inspector.validate_db_facts(raw_facts)['migration_history_exact'] is False
            query("delete from public.living_menaion_schema_migrations where length(version)>14")
            runtime_history(True)
            print('PASS: oversized row counts and metadata stay bounded and fail closed')
            for sql in (inspection, transaction):
                query(sql, False, db='postgres')
                query(sql, False, user='wrong_executor')
            baseline()
            print('PASS: wrong database/executor has no schema or ledger effects')
            cases = [
                ("update public.living_menaion_schema_migrations set checksum='"+'0'*64+"' where version='20261002184929'",
                 f"update public.living_menaion_schema_migrations set checksum='{rows[-1]['checksum']}' where version='20261002184929'"),
                ("delete from public.living_menaion_schema_migrations where version='20261002184929'",
                 f"insert into public.living_menaion_schema_migrations values ('20261002184929','{rows[-1]['checksum']}')"),
                ("insert into public.living_menaion_schema_migrations values ('20991231235959','"+'0'*64+"')",
                 "delete from public.living_menaion_schema_migrations where version='20991231235959'"),
                ('create table menaion_feedback_private.moderation_outbox(id integer)',
                 'drop table menaion_feedback_private.moderation_outbox'),
                ("create function living_menaion.claim_pronunciation_moderation() returns void language sql as 'select'",
                 'drop function living_menaion.claim_pronunciation_moderation()'),
            ]
            for change, repair in cases:
                query(change)
                query(inspection, False)
                query(transaction, False)
                query(repair)
                baseline()
            print('PASS: checksum, missing predecessor, unexpected version, table/function collision gates')
            fault = transaction.replace('insert into public.living_menaion_schema_migrations(version,checksum)',
                'select 1/0;\ninsert into public.living_menaion_schema_migrations(version,checksum)')
            query(fault, False)
            baseline()
            assert query(inspection) == 'MENAION_MODERATION_READY'
            print('PASS: post-SQL failure rolls back schema and ledger')
            assert query(transaction) == 'MENAION_MODERATION_MIGRATION_VERIFIED'
            assert query('select count(*) from public.living_menaion_schema_migrations') == '10'
            assert query(inspection) == 'MENAION_MODERATION_ALREADY_APPLIED'
            query(transaction, False)
            facts = inspector.validate_db_facts(json.loads(query(inspector.DB_SQL)))
            assert all(facts[key] is True for key in inspector.DB_FIELDS), 'Exact ten-row runtime preflight refused'
            runtime_history(True)
            query("insert into public.living_menaion_schema_migrations values ('20261006123456','"+'0'*64+"')")
            runtime_history(False)
            query("delete from public.living_menaion_schema_migrations where version='20261006123456'")
            runtime_history(True)
            print('PASS: atomic canonical apply, exact ten-row runtime acceptance, unknown eleventh-row denial and no replay')
            acceptance = migrations.parent/'tests/pronunciation_moderation.sql'
            query(acceptance.read_text())
            print('PASS: actual moderation owner/denial/rollback acceptance after transport')
            query("update public.living_menaion_schema_migrations set checksum='"+'0'*64+"' where version='20261005073345'")
            query(inspection, False)
            runtime_history(False)
            print('PASS: applied checksum tamper denied')
        finally:
            if started:
                result = process('pg_ctl','-D',root/'data','-m','fast','-w','stop')
                assert result.returncode == 0, 'Disposable PostgreSQL cleanup not confirmed'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin', type=Path, required=True)
    parser.add_argument('--migrations-dir', type=Path, required=True)
    args = parser.parse_args()
    run(args.pg_bin.resolve(), args.migrations_dir.resolve())
