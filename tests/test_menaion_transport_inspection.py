"""Offline inspector safety fixtures. No production credentials or network."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/inspect-menaion-feedback-transport.sh'

class InspectionTests(unittest.TestCase):
    def run_fixture(self, missing=False, duplicate=False, db_fail=False, bad_ledger=False, bad_uri=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.living-menaion').mkdir()
            if not missing:
                (root / '.living-menaion/deploy-cert.pem').write_text('fixture-public-cert')
            (root / '.living-menaion/deploy-private.pem').write_text('PRIVATE_KEY_CANARY')
            binary = root / 'bin'
            binary.mkdir()
            docker = binary / 'docker'
            docker.write_text('''#!/usr/bin/env python3
import json,os,sys
args=sys.argv[1:]
if args[0]=='inspect' and '-f' in args:
 print('true')
elif args[0]=='exec':
 assert 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000' in args
 assert '-X' in args and 'living_menaion' in args and 'ON_ERROR_STOP=1' in args
 sql=sys.stdin.read()
 assert 'select jsonb_build_object' in sql and 'public.living_menaion_schema_migrations' in sql
 assert not any(x in sql.lower() for x in ['insert ', 'update ', 'delete ', 'create ', 'grant '])
 if os.environ.get('DB_FAIL')=='1': sys.exit(1)
 print(json.dumps({'database':'living_menaion','ledger':[{'version':'PRIVATE_LEDGER_CANARY','checksum':'invalid'}] if os.environ.get('BAD_LEDGER')=='1' else []}))
elif args==['inspect','living-menaion-rest']:
 env=['PGRST_DB_URI=postgres://authenticator:PASSWORD_CANARY@supabase-db:5432/living_menaion','PGRST_JWT_SECRET=SIGNING_CANARY','PGRST_DB_SCHEMAS=living_menaion']
 if os.environ.get('BAD_URI')=='1': env[0]='PGRST_DB_URI=postgres://[PRIVATE_URI_CANARY'
 if os.environ.get('DUPLICATE')=='1': env.append('PGRST_DB_SCHEMAS=public')
 print(json.dumps([{'Config':{'Env':env}}]))
else: sys.exit(99)
''')
            docker.chmod(0o755)
            openssl = binary / 'openssl'
            openssl.write_text('''#!/usr/bin/env python3
import sys
args=sys.argv[1:]
assert args[0]=='x509' and 'deploy-private.pem' not in ' '.join(args)
if '-outform' in args: print('PUBLIC_CERT_FIXTURE')
elif '-fingerprint' in args: print('sha256 Fingerprint=PUBLIC_FINGERPRINT')
else: assert '-checkend' in args
''')
            openssl.chmod(0o755)
            env = dict(os.environ, HOME=str(root), PATH=str(binary)+':'+os.environ['PATH'], DUPLICATE=str(int(duplicate)), DB_FAIL=str(int(db_fail)), BAD_LEDGER=str(int(bad_ledger)), BAD_URI=str(int(bad_uri)))
            return subprocess.run(['bash', str(SCRIPT)], env=env, text=True, capture_output=True)

    def test_sanitized_read_only_success(self):
        result = self.run_fixture()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('PUBLIC_CERT_FIXTURE', result.stdout)
        self.assertIn('"database_is_living_menaion": true', result.stdout)
        self.assertIn('"authenticator_is_shared": true', result.stdout)
        for secret in ('PASSWORD_CANARY','SIGNING_CANARY','PRIVATE_KEY_CANARY','postgres://'):
            self.assertNotIn(secret, result.stdout+result.stderr)

    def test_malformed_ledger_never_prints_private_text(self):
        result = self.run_fixture(bad_ledger=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('PRIVATE_LEDGER_CANARY', result.stdout+result.stderr)

    def test_malformed_uri_has_no_traceback_or_secret(self):
        result = self.run_fixture(bad_uri=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('PRIVATE_URI_CANARY', result.stdout+result.stderr)
        self.assertNotIn('Traceback', result.stdout+result.stderr)

    def test_missing_certificate_never_bootstraps(self):
        self.assertNotEqual(self.run_fixture(missing=True).returncode, 0)

    def test_duplicate_environment_fails_closed(self):
        self.assertNotEqual(self.run_fixture(duplicate=True).returncode, 0)

    def test_failed_query_is_not_success(self):
        self.assertNotEqual(self.run_fixture(db_fail=True).returncode, 0)

if __name__ == '__main__': unittest.main()
