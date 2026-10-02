import hashlib
import importlib.util
from pathlib import Path
import unittest
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

if __name__ == '__main__': unittest.main()
