import hashlib
import importlib.util
from pathlib import Path
import unittest
import os
import subprocess
import tempfile
import uuid
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('builder', ROOT/'scripts/build-menaion-feedback-transaction.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

class TransactionTests(unittest.TestCase):
    def test_fixed_manifest_and_ciphertext(self):
        manifest = (ROOT/'ops/living-menaion/feedback-predecessors.json').read_bytes()
        self.assertEqual(hashlib.sha256(manifest).hexdigest(), builder.MANIFEST_SHA)
        ciphertext = (ROOT/'ops/living-menaion/feedback-20261002.cms.b64').read_bytes()
        self.assertEqual(hashlib.sha256(ciphertext).hexdigest(), 'cf1d3ff3a61b4945198ea602f2b9be914cba600600d310c46e330b2271928117')

    def test_wrong_sql_refused(self):
        with self.assertRaises(ValueError):
            builder.build_transaction(b'PRIVATE_SQL_CANARY', b'[]')

    def test_wrong_manifest_refused(self):
        sql = b'-- disposable fixture only'
        with patch.object(builder, 'MIGRATION_SHA', hashlib.sha256(sql).hexdigest()):
            with self.assertRaises(ValueError): builder.build_transaction(sql, b'[]')

    def test_transaction_keeps_gates_inside_commit(self):
        sql = b'-- disposable fixture only'
        manifest = (ROOT/'ops/living-menaion/feedback-predecessors.json').read_bytes()
        with patch.object(builder, 'MIGRATION_SHA', hashlib.sha256(sql).hexdigest()):
            output = builder.build_transaction(sql, manifest)
        self.assertTrue(output.startswith('begin;'))
        self.assertLess(output.index('lock table'), output.index(sql.decode()))
        self.assertLess(output.index('Migration history mismatch'), output.index(sql.decode()))
        self.assertLess(output.index('Publish RPC unexpectedly permitted'), output.index('commit;'))
        self.assertLess(output.index('insert into public.living_menaion_schema_migrations'), output.index('commit;'))
        self.assertNotIn('alter role', output.lower())
        self.assertNotIn('password', output.lower())


    def test_shell_marker_and_uncertain_error(self):
        for fail_db in (False, True):
            with tempfile.TemporaryDirectory() as home:
                home = Path(home)
                keys = home/'.living-menaion'
                keys.mkdir()
                (keys/'deploy-cert.pem').write_text('public fixture')
                (keys/'deploy-private.pem').write_text('PRIVATE_KEY_CANARY')
                binaries = home/'bin'
                binaries.mkdir()
                fixtures = {
                    'sha256sum': "#!/bin/bash\ncase \"${1:-stdin}\" in *payload.b64) echo 'cf1d3ff3a61b4945198ea602f2b9be914cba600600d310c46e330b2271928117  file';; *migration.sql) echo '15265e48dcbf87b24b7aed34c296c2a4a83cbba132a5e33bffc0cfdd9469444c  file';; stdin) cat >/dev/null; echo '1c445517d9fe95784a9caced337ce5f34b9132610afd1946f325bd5ad8d385c9  -';; *) exit 99;; esac\n",
                    'openssl': "#!/bin/bash\nif [ \"$1\" = x509 ]; then echo PUBLIC_CERT; else while [ $# -gt 0 ]; do if [ \"$1\" = -out ]; then shift; echo FIXTURE > \"$1\"; exit; fi; shift; done; exit 99; fi\n",
                    'python3': "#!/bin/bash\necho FIXTURE > \"$2/transaction.sql\"\n",
                    'docker': "#!/bin/bash\nif [ \"$1\" = inspect ]; then echo true; else cat >/dev/null; if [ \"${FAIL_DB:-0}\" = 1 ]; then echo PRIVATE_SQL_CANARY >&2; exit 1; fi; case \" $* \" in *' -qAt '*) echo MENAION_FEEDBACK_MIGRATION_VERIFIED;; *) echo ' MENAION_FEEDBACK_MIGRATION_VERIFIED';; esac; fi\n"
                }
                for name, content in fixtures.items():
                    target = binaries/name
                    target.write_text(content)
                    target.chmod(0o755)
                root = Path('/tmp') / ('menaion-feedback.' + uuid.uuid4().hex)
                root.mkdir(mode=0o700)
                (root/'payload.b64').write_text('RklYVFVSRQ==')
                result = subprocess.run(['bash',str(ROOT/'scripts/apply-menaion-feedback-encrypted.sh'),str(root)],
                    env=dict(os.environ,HOME=str(home),PATH=str(binaries)+':'+os.environ['PATH'],FAIL_DB=str(int(fail_db))),capture_output=True,text=True)
                self.assertEqual(result.returncode == 0, not fail_db, result.stderr)
                self.assertNotIn('PRIVATE_SQL_CANARY', result.stdout+result.stderr)
                self.assertFalse(root.exists())
                if not fail_db: self.assertEqual(result.stdout.strip(),'MENAION_FEEDBACK_MIGRATION_VERIFIED')
                else: self.assertIn('outcome not confirmed',result.stderr)

if __name__ == '__main__': unittest.main()
