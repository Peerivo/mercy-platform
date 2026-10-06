import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('moderation_builder', ROOT/'scripts/build-menaion-issue-package-transaction.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
MANIFEST = (ROOT/'ops/living-menaion/moderation-predecessors.json').read_bytes()
CONTRACT = (ROOT/'ops/living-menaion/issue-package-contract.json').read_bytes()


class IntegrityTests(unittest.TestCase):
    def test_immutable_inputs_and_nine_historical_checksums(self):
        rows = builder.checked_manifest(MANIFEST)
        old = json.loads((ROOT/'ops/living-menaion/feedback-predecessors.json').read_bytes())
        self.assertEqual(rows[:8], old)
        self.assertEqual(rows[-1], {'version': '20261002184929',
            'checksum': '15265e48dcbf87b24b7aed34c296c2a4a83cbba132a5e33bffc0cfdd9469444c'})
        ciphertext = (ROOT/'ops/living-menaion/moderation-20261005.cms.b64').read_bytes()
        self.assertEqual(hashlib.sha256(ciphertext).hexdigest(), builder.CIPHERTEXT10_SHA)
        certificate = subprocess.check_output(['openssl', 'x509', '-in',
            str(ROOT/'ops/living-menaion/deploy-public.pem'), '-outform', 'DER'])
        self.assertEqual(hashlib.sha256(certificate).hexdigest(), builder.CERTIFICATE_SHA)

    def test_frozen_issue_ciphertext_contract_and_exact_histories(self):
        self.assertEqual(hashlib.sha256((ROOT/'ops/living-menaion/issue-ledger-20261006.cms.b64').read_bytes()).hexdigest(), builder.CIPHERTEXT12_SHA)
        contract = builder.checked_contract(CONTRACT)
        self.assertEqual(contract['sourceDigests'][builder.VERSION12], builder.SOURCE12_SHA)
        rows = builder.checked_manifest(MANIFEST)
        histories = builder.histories(rows) + builder.histories(rows, True)
        self.assertEqual(len(histories), 6)
        self.assertEqual([tuple(x['version'] for x in h[9:]) for h in histories], [
            (), (builder.VERSION11,), (builder.VERSION10,), (builder.VERSION10,builder.VERSION11),
            (builder.VERSION10,builder.VERSION12), (builder.VERSION10,builder.VERSION11,builder.VERSION12)])
        for index in range(0,len(CONTRACT),31):
            changed=bytearray(CONTRACT);changed[index]^=1
            with self.assertRaises(ValueError): builder.build_inspection(MANIFEST,bytes(changed))

    def test_changed_bytes_fail_closed(self):
        for index in range(0, len(MANIFEST), 31):
            changed = bytearray(MANIFEST)
            changed[index] ^= 1
            with self.assertRaises(ValueError): builder.build_inspection(bytes(changed), CONTRACT)
        with self.assertRaises(ValueError): builder.build_transaction(b'PRIVATE_SQL_CANARY', b'PRIVATE_SQL_CANARY', MANIFEST, CONTRACT)

    def test_invalid_manifest_shapes_and_coercions(self):
        good = json.loads(MANIFEST)
        candidates = [None, {}, [], good[:-1], good + [good[-1]], list(reversed(good))]
        for value in (None, 20260916193000, True, '1', '20260916193000\n', "x';commit;--"):
            rows = json.loads(MANIFEST)
            rows[0]['version'] = value
            candidates.append(rows)
        for value in (None, True, 1, 'a'*63, 'A'*64):
            rows = json.loads(MANIFEST)
            rows[0]['checksum'] = value
            candidates.append(rows)
        rows = json.loads(MANIFEST)
        rows[0]['extra'] = 'invalid'
        candidates.append(rows)
        for candidate in candidates:
            raw = json.dumps(candidate).encode()
            with self.subTest(candidate=candidate), patch.object(builder, 'MANIFEST_SHA', hashlib.sha256(raw).hexdigest()):
                with self.assertRaises(ValueError): builder.checked_manifest(raw)

    def test_cli_wrong_payload_never_writes_transaction_or_private_error(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'manifest.json').write_bytes(MANIFEST)
            (root/'contract.json').write_bytes(CONTRACT)
            (root/'migration12.sql').write_bytes(b'PRIVATE_SQL_CANARY')
            (root/'migration10.sql').write_bytes(b'PRIVATE_SQL_CANARY')
            result = subprocess.run(['python3', str(ROOT/'scripts/build-menaion-issue-package-transaction.py'), 'apply', str(root)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((root/'transaction.sql').exists())
            self.assertNotIn('PRIVATE_SQL_CANARY', result.stdout+result.stderr)


class RemoteExecutorTests(unittest.TestCase):
    def execute(self, mode='APPLY', **options):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            keys = home/'.living-menaion'
            keys.mkdir()
            (keys/'deploy-cert.pem').write_text('public synthetic certificate')
            (keys/'deploy-private.pem').write_text('PRIVATE_KEY_CANARY')
            binaries = home/'bin'
            binaries.mkdir()
            log = home/'calls'
            fixtures = {
                'sha256sum': f'''#!/bin/bash
case "${{1:-stdin}}" in
  *payload10.b64) echo "${{PAYLOAD_HASH:-{builder.CIPHERTEXT10_SHA}}}  file";;
  *payload12.b64) echo "${{PAYLOAD12_HASH:-{builder.CIPHERTEXT12_SHA}}}  file";;
  *contract.json) echo "${{CONTRACT_HASH:-{builder.CONTRACT_SHA}}}  file";;
  *manifest.json) echo "${{MANIFEST_HASH:-{builder.MANIFEST_SHA}}}  file";;
  *migration12.sql) echo "${{MIGRATION12_HASH:-{builder.SOURCE12_SHA}}}  file";;
  *migration10.sql) echo "${{MIGRATION_HASH:-{builder.SOURCE10_SHA}}}  file";;
  stdin) cat >/dev/null; echo "${{CERT_HASH:-{builder.CERTIFICATE_SHA}}}  -";;
  *) exit 99;;
esac
''',
                'openssl': '''#!/bin/bash
if [ "$1" = x509 ]; then
  case " $* " in *' -checkend '*) exit "${EXPIRED:-0}";; esac
  echo PUBLIC_CERT
else
  echo decrypt >> "$CALL_LOG"
  if [ "${DECRYPT_FAIL:-0}" = 1 ]; then echo PRIVATE_KEY_CANARY >&2; exit 1; fi
  while [ $# -gt 0 ]; do
    if [ "$1" = -out ]; then shift; echo FIXTURE > "$1"; exit; fi
    shift
  done
  exit 99
fi
''',
                'python3': '''#!/bin/bash
echo "build-$2" >> "$CALL_LOG"
if [ "${BUILD_FAIL:-0}" = 1 ]; then echo PRIVATE_SQL_CANARY >&2; exit 1; fi
case "$2" in inspect) echo INSPECT > "$3/inspection.sql";; apply) echo APPLY > "$3/transaction.sql";; *) exit 99;; esac
''',
                'docker': '''#!/bin/bash
[ "$1" = --host ] && [ "$2" = unix:///var/run/docker.sock ] || exit 97
shift 2
if [ "$1" = inspect ]; then echo "${RUNNING:-true}"; exit; fi
input=$(cat)
[[ "$*" = *'supabase-db env -u PGHOST -u PGHOSTADDR -u PGPORT -u PGSERVICE -u PGSERVICEFILE'*'psql -X'* ]] || exit 96
case "$input" in
  INSPECT)
    echo inspect >> "$CALL_LOG"
    case " $* " in *' default_transaction_read_only=on '*) ;; *)
      # PGOPTIONS is one argument containing its settings.
      [[ "$*" = *default_transaction_read_only=on* ]] || exit 98;; esac
    if [ "${INSPECT_FAIL:-0}" = 1 ]; then echo PRIVATE_SQL_CANARY >&2; exit 1; fi
    printf '%s\\n' "${STATE-MENAION_ISSUE_PACKAGE_READY}" "${LEGACY-MENAION_ISSUE_PACKAGE_LEGACY_UNMAPPED_ATTEMPTED=0}";;
  APPLY)
    [[ "$*" = *'-u PGOPTIONS psql -X'* ]] || exit 95
    echo apply >> "$CALL_LOG"
    if [ "${APPLY_FAIL:-0}" = 1 ]; then echo PRIVATE_SQL_CANARY >&2; exit 1; fi
    printf '%s\\n' "${RESULT_LEGACY-MENAION_ISSUE_PACKAGE_LEGACY_UNMAPPED_ATTEMPTED=0}" "${RESULT-MENAION_ISSUE_PACKAGE_VERIFIED}";;
  *) exit 99;;
esac
''',
            }
            for name, content in fixtures.items():
                path = binaries/name
                path.write_text(content)
                path.chmod(0o755)
            root = Path('/tmp')/('menaion-issue-package.'+uuid.uuid4().hex)
            root.mkdir(mode=0o700)
            (root/'payload10.b64').write_text('RklYVFVSRQ==')
            (root/'payload12.b64').write_text('RklYVFVSRQ==')
            (root/'contract.json').write_text('{}')
            (root/'manifest.json').write_text('[]')
            (root/'build-transaction.py').write_text('# synthetic')
            result = subprocess.run(['bash', str(ROOT/'scripts/apply-menaion-issue-package-encrypted.sh'), str(root), mode],
                env=dict(os.environ, HOME=str(home), PATH=str(binaries)+':'+os.environ['PATH'], CALL_LOG=str(log), **options), capture_output=True, text=True)
            calls = log.read_text().splitlines() if log.exists() else []
            self.assertFalse(root.exists())
            self.assertNotIn('PRIVATE_SQL_CANARY', result.stdout+result.stderr)
            self.assertNotIn('PRIVATE_KEY_CANARY', result.stdout+result.stderr)
            return result, calls

    def test_inspection_is_read_only_without_decryption(self):
        result, calls = self.execute('INSPECT')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, ['build-inspect', 'inspect'])
        self.assertEqual(result.stdout.strip(), 'MENAION_ISSUE_PACKAGE_READY\nMENAION_ISSUE_PACKAGE_LEGACY_UNMAPPED_ATTEMPTED=0')

    def test_apply_inspects_before_decrypt_and_commit(self):
        result, calls = self.execute()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, ['build-inspect','inspect','decrypt','decrypt','build-apply','apply'])
        self.assertEqual(result.stdout.strip(), 'MENAION_ISSUE_PACKAGE_VERIFIED\nMENAION_ISSUE_PACKAGE_LEGACY_UNMAPPED_ATTEMPTED=0')

    def test_already_applied_has_no_replay(self):
        result, calls = self.execute(STATE='MENAION_ISSUE_PACKAGE_ALREADY_APPLIED')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, ['build-inspect', 'inspect'])
        self.assertEqual(result.stdout.strip(), 'MENAION_ISSUE_PACKAGE_ALREADY_APPLIED\nMENAION_ISSUE_PACKAGE_LEGACY_UNMAPPED_ATTEMPTED=0')

    def test_legacy_count_is_redacted_without_blocking_schema_apply(self):
        result,calls=self.execute(LEGACY='MENAION_ISSUE_PACKAGE_LEGACY_UNMAPPED_ATTEMPTED=2',
            RESULT_LEGACY='MENAION_ISSUE_PACKAGE_LEGACY_UNMAPPED_ATTEMPTED=2')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('apply',calls)
        self.assertEqual(result.stdout.strip(),'MENAION_ISSUE_PACKAGE_VERIFIED\nMENAION_ISSUE_PACKAGE_LEGACY_UNMAPPED_ATTEMPTED=2')

    def test_all_preflight_failures_have_zero_apply(self):
        cases = [dict(DOCKER_HOST='tcp://wrong-daemon:2375'),dict(DOCKER_CONTEXT='other-daemon'),dict(PAYLOAD12_HASH='0'*64),dict(CONTRACT_HASH='0'*64),dict(MIGRATION12_HASH='0'*64),dict(LEGACY='-1'),dict(LEGACY='MENAION_ISSUE_PACKAGE_LEGACY_UNMAPPED_ATTEMPTED=01'),dict(LEGACY='MENAION_ISSUE_PACKAGE_LEGACY_UNMAPPED_ATTEMPTED=0\nextra'),dict(PAYLOAD_HASH='0'*64), dict(MANIFEST_HASH='0'*64), dict(CERT_HASH='0'*64),
                 dict(RUNNING='false'), dict(EXPIRED='1'), dict(BUILD_FAIL='1'), dict(INSPECT_FAIL='1'),
                 dict(STATE=''), dict(STATE='MENAION_ISSUE_PACKAGE_READY\nPRIVATE_SQL_CANARY'),
                 dict(STATE='t'), dict(STATE='MENAION_ISSUE_PACKAGE_READY '), dict(STATE='UNKNOWN'),
                 dict(DECRYPT_FAIL='1'), dict(MIGRATION_HASH='0'*64)]
        for options in cases:
            with self.subTest(options=options):
                result, calls = self.execute(**options)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('apply', calls)

    def test_uncertain_commit_or_extra_output_never_claims_success(self):
        for options in [dict(RESULT_LEGACY='-1'),dict(RESULT_LEGACY='MENAION_ISSUE_PACKAGE_LEGACY_UNMAPPED_ATTEMPTED=01'),dict(APPLY_FAIL='1'), dict(RESULT=''), dict(RESULT='MENAION_ISSUE_PACKAGE_VERIFIED\nextra')]:
            result, calls = self.execute(**options)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('apply', calls)
            self.assertNotIn('MENAION_ISSUE_PACKAGE_VERIFIED', result.stdout)
            self.assertIn('outcome not confirmed', result.stderr)


class DispatchGateTests(unittest.TestCase):
    def gate(self, **changes):
        workflow = (ROOT/'.github/workflows/apply-menaion-issue-package-encrypted.yml').read_text()
        section = workflow.split('- name: Validate exact approved dispatch and prior inspection\n', 1)[1]
        script = textwrap.dedent(section.split('        run: |\n',1)[1].split('      - name:',1)[0])
        sha = 'a'*40
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run = {'head_sha': sha, 'head_branch':'main', 'event':'workflow_dispatch', 'status':'completed',
                   'conclusion':'success', 'display_title':'Menaion issue package INSPECT',
                   'path':'.github/workflows/apply-menaion-issue-package-encrypted.yml', 'run_attempt':1}
            run.update(changes.pop('RUN', {}))
            (root/'run.json').write_text(json.dumps(run))
            gh = root/'gh'
            gh.write_text('#!/bin/bash\ncase "$2" in */actions/runs/*) cat "$RUNNER_TEMP/run.json";; */git/ref/heads/main) echo "$CURRENT_SHA";; *) exit 99;; esac\n')
            gh.chmod(0o755)
            env=dict(os.environ, PATH=str(root)+':'+os.environ['PATH'], RUNNER_TEMP=str(root),
                     EXPECTED_SHA=sha, GITHUB_SHA=sha, CURRENT_SHA=sha, GITHUB_RUN_ATTEMPT='1',
                     MODE='APPLY', CONFIRMATION='APPLY_MENAION_ISSUE_PACKAGE_SCHEMA_ONLY', INSPECTION_RUN_ID='123')
            env.update(changes)
            return subprocess.run(['bash','-c',script],env=env,capture_output=True,text=True)

    def test_exact_inspect_and_apply_allowed(self):
        self.assertEqual(self.gate().returncode,0)
        self.assertEqual(self.gate(MODE='INSPECT',CONFIRMATION='INSPECT_MENAION_ISSUE_PACKAGE',INSPECTION_RUN_ID='').returncode,0)

    def test_unapproved_stale_rerun_and_inexact_inspection_denied(self):
        cases=[dict(EXPECTED_SHA='b'*40),dict(CURRENT_SHA='b'*40),dict(GITHUB_RUN_ATTEMPT='2'),
               dict(CONFIRMATION='yes'),dict(MODE='APPLY;true'),dict(INSPECTION_RUN_ID=''),
               dict(INSPECTION_RUN_ID='123/../../dispatches')]
        for key, bad in [('head_sha','b'*40),('head_branch','feature'),('event','pull_request'),
                         ('status','in_progress'),('conclusion','failure'),('display_title','Menaion issue package APPLY'),
                         ('path','.github/workflows/living-menaion-db.yml'),('run_attempt',True),('run_attempt',2)]:
            cases.append(dict(RUN={key:bad}))
        for case in cases:
            with self.subTest(case=case): self.assertNotEqual(self.gate(**case).returncode,0)


if __name__ == '__main__':
    unittest.main()
