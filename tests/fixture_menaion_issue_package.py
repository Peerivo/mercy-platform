"""Disposable PostgreSQL 17 only. No production URL/credential/host input."""
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('issue_builder', ROOT/'scripts/build-menaion-issue-package-transaction.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
MANIFEST = (ROOT/'ops/living-menaion/moderation-predecessors.json').read_bytes()


class Fixture:
    def __init__(self, pg_bin, migrations, policy11):
        self.pg_bin, self.migrations, self.policy11 = pg_bin, migrations, policy11
        self.temp = tempfile.TemporaryDirectory(prefix='menaion-issue-package-pg.')
        self.root = Path(self.temp.name)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0))
            self.port = str(sock.getsockname()[1])
        self.env = {k:v for k,v in os.environ.items() if not k.startswith('PG')}
        self.env.update(PGSSLMODE='disable',PGPASSFILE=str(self.root/'empty-pgpass'))
        self.started=False

    def process(self, binary, *args, **kwargs):
        return subprocess.run([str(self.pg_bin/binary),*map(str,args)],env=self.env,
                              capture_output=True,text=True,**kwargs)

    def query(self, sql, ok=True, db='living_menaion', user='supabase_admin'):
        result=self.process('psql','-X','-qAt','-h','127.0.0.1','-p',self.port,'-U',user,'-d',db,
                            '-v','ON_ERROR_STOP=1',input='set search_path=pg_catalog;\n'+sql)
        assert (result.returncode==0)==ok, 'Disposable SQL expectation failed: '+result.stderr
        return result.stdout.strip()

    def source(self, version):
        paths=list(self.migrations.glob(version+'_*.sql'))
        assert len(paths)==1
        return paths[0].read_bytes()

    def __enter__(self):
        version=self.process('postgres','--version')
        assert ' 17.' in version.stdout, 'PostgreSQL 17 required'
        for version,raw,digest in [
            (builder.VERSION10,self.source(builder.VERSION10),builder.SOURCE10_SHA),
            (builder.VERSION11,self.policy11.read_bytes(),builder.SOURCE11_SHA),
            (builder.VERSION12,self.source(builder.VERSION12),builder.SOURCE12_SHA)]:
            assert builder.sha(raw)==digest, 'Canonical fixture source mismatch: '+version
        result=self.process('initdb','-D',self.root/'data','-U','supabase_admin','--auth=trust','--no-locale','-E','UTF8')
        assert result.returncode==0,result.stderr
        result=self.process('pg_ctl','-D',self.root/'data','-l',self.root/'server.log','-o',
                            f"-h 127.0.0.1 -k '' -p {self.port}",'-w','start')
        assert result.returncode==0,result.stderr
        self.started=True
        self.query('''create role postgres superuser nologin;
create role service_role nologin bypassrls;
create role anon nologin;
create role authenticated nologin;
create role authenticator nologin noinherit;
create role living_menaion_owner nologin;
create role living_menaion_app nologin;
create role wrong_executor superuser login;
create database living_menaion;''',db='postgres')
        for row in builder.checked_manifest(MANIFEST): self.query(self.source(row['version']).decode())
        self.query('create table public.living_menaion_schema_migrations(version text primary key,checksum text not null,applied_at timestamptz not null default now()); revoke all on public.living_menaion_schema_migrations from public')
        for row in builder.checked_manifest(MANIFEST):
            self.query(f"insert into public.living_menaion_schema_migrations(version,checksum) values ('{row['version']}','{row['checksum']}')")
        self.query('create database fixture_h9 template living_menaion',db='postgres')
        return self

    def reset(self, ten=False, eleven=False):
        self.query('drop database living_menaion',db='postgres')
        self.query('create database living_menaion template fixture_h9',db='postgres')
        for version,raw,digest in [
            (builder.VERSION10,self.source(builder.VERSION10) if ten else None,builder.SOURCE10_SHA),
            (builder.VERSION11,self.policy11.read_bytes() if eleven else None,builder.SOURCE11_SHA)]:
            if raw:
                self.query(raw.decode())
                self.query(f"insert into public.living_menaion_schema_migrations(version,checksum) values ('{version}','{digest}')")

    def __exit__(self, *args):
        if self.started:
            result=self.process('pg_ctl','-D',self.root/'data','-m','fast','-w','stop')
            assert result.returncode==0,'Fixture cluster cleanup unconfirmed'
        self.temp.cleanup()


def generate_contract(f):
    def digest(query): return f.query('select '+builder.digest_query(query))
    def objects(tables, functions):
        names=','.join(map(builder.literal,tables))
        relations=json.loads(f.query(f"""select jsonb_agg(n.nspname||'.'||c.relname order by n.nspname,c.relname)
          from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where c.oid in (select to_regclass(x) from unnest(array[{names}]) x)
            or c.oid in (select indexrelid from pg_index where indrelid in
              (select to_regclass(x) from unnest(array[{names}]) x))"""))
        return {'relations':relations,'functions':functions}
    f.reset()
    result={'format':1,'postgresMajor':17,'sourceDigests':{
        builder.VERSION10:builder.SOURCE10_SHA,builder.VERSION11:builder.SOURCE11_SHA,builder.VERSION12:builder.SOURCE12_SHA},
        'catalogDigests':{'ledger':digest(builder.table_catalog(['public.living_menaion_schema_migrations'])),
          'schemas9':digest(builder.schema_catalog()),'rate9':digest(builder.table_catalog(builder.RATE)),
          'entries9':digest(builder.table_catalog(builder.ENTRIES)),
          'publish9':digest(builder.function_catalog(builder.PUBLISH,False))},'newObjects':{}}
    f.query(f.source(builder.VERSION10).decode())
    c=result['catalogDigests']
    c['schemas10']=digest(builder.schema_catalog())
    c['entries10']=digest(builder.table_catalog(builder.ENTRIES))
    c['tables10']=digest(builder.table_catalog(builder.TABLES10))
    c['functions10']=digest(builder.function_catalog(builder.FUNCTIONS10))
    c['publish10']=digest(builder.function_catalog(builder.PUBLISH,False))
    c['enqueueTrigger']=digest("""(select jsonb_build_array(pg_get_triggerdef(oid),tgenabled) from pg_trigger
      where tgrelid=to_regclass('living_menaion.pronunciation_entries') and tgname='pronunciation_moderation_enqueue')""")
    result['newObjects'][builder.VERSION10]=objects(builder.TABLES10,builder.FUNCTIONS10)
    f.query(f.policy11.read_text())
    c['policy11Functions']=digest(builder.function_catalog(builder.POLICY11,False))
    c['policy11Trigger']=digest(builder.trigger_catalog())
    f.query(f.source(builder.VERSION12).decode())
    c['tables12']=digest(builder.table_catalog(builder.TABLES12))
    c['functions12']=digest(builder.function_catalog(builder.FUNCTIONS12))
    c['rate12']=digest(builder.table_catalog(builder.RATE))
    result['newObjects'][builder.VERSION12]=objects(builder.TABLES12,builder.FUNCTIONS12)
    return result


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin',type=Path,required=True)
    parser.add_argument('--migrations-dir',type=Path,required=True)
    parser.add_argument('--policy11',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    with Fixture(args.pg_bin.resolve(),args.migrations_dir.resolve(),args.policy11.resolve()) as fixture:
        contract=generate_contract(fixture)
        args.output.write_text(json.dumps(contract,indent=2)+'\n')
    print('Disposable canonical catalog contract generated; review and pin before use.')
