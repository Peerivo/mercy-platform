"""Offline adversarial tests. All identities and credentials are synthetic."""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('activation', ROOT / 'scripts/activate-menaion-runtime.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'tests/test_menaion_runtime_handoff.py')
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)
PASSWORD = 'Synthetic-only:+%/?@#=never-production-2026!'
OLD_ID, NEW_ID, SHARED_ID, KONG_ID, DB_ID = (x * 64 for x in ('a', 'b', 'c', 'd', 'f'))


def fixture():
    old, db, image, env = f.fixture()
    old['Id'] = OLD_ID
    old['Config']['Env'] = [x + '-long-enough' if x.startswith('PGRST_JWT_SECRET=') else x for x in old['Config']['Env']]
    old['Config'].update({'Image': 'postgrest:synthetic', 'Hostname': 'same-host', 'Labels': {'example': 'preserve'}, 'WorkingDir': '/same-dir'})
    old['HostConfig']['MaskedPaths'] = ['/proc/actual-live-mask']
    old['NetworkSettings']['Networks']['stack_default'].update({'Aliases': ['living-menaion-rest'], 'IPAMConfig': None, 'Links': None, 'DriverOpts': None})
    shared = copy.deepcopy(old)
    shared['Id'], shared['Name'] = SHARED_ID, '/shared-rest'
    kong = {'Id': KONG_ID, 'Config': {'Env': ['SUPABASE_SERVICE_KEY=' + f.SENTINEL]}}
    raw = ('# preserve comment\r\n' + '\r\n'.join(old['Config']['Env']) + '\r\n\r\n').encode()
    return old, shared, kong, raw


class FakeDocker:
    def __init__(self, fail=None):
        old, shared, kong, _ = fixture()
        self.items = {OLD_ID: old, SHARED_ID: shared, KONG_ID: kong, DB_ID: {'Id':DB_ID, 'Name':'/supabase-db'}}
        self.fail, self.events = fail, []
        self.oom_kill_disable_supported = False

    def point(self, name):
        self.events.append(name)
        if self.fail == name:
            self.fail = None
            raise m.Refused('synthetic failure ' + f.SENTINEL)

    def inspect(self, target, missing=False):
        value = self.items.get(target) or next((v for v in self.items.values() if v.get('Name') == '/' + target), None)
        if value is None and not missing:
            raise m.Refused('missing')
        return copy.deepcopy(value)

    def request(self, method, path, body=None, missing=False):
        assert method == 'POST' and path == '/containers/create?name=' + m.CANDIDATE
        self.point('create:before')
        cfg = {k: copy.deepcopy(v) for k, v in body.items() if k not in ('HostConfig', 'NetworkingConfig')}
        network = next(iter(body['NetworkingConfig']['EndpointsConfig']))
        endpoint = copy.deepcopy(body['NetworkingConfig']['EndpointsConfig'][network])
        endpoint['IPAddress'] = '172.18.0.15'
        self.items[NEW_ID] = {'Id': NEW_ID, 'Name': '/' + m.CANDIDATE, 'Config': cfg,
                            'HostConfig': copy.deepcopy(body['HostConfig']), 'Image': cfg['Image'], 'Mounts': [],
                            'State': {'Running': False}, 'NetworkSettings': {'Networks': {network: endpoint}}}
        self.point('create:after')
        return {'Id': NEW_ID}

    def effect(self, target, operation, query=''):
        prefix = ('old' if target == OLD_ID else 'new') + ':' + operation
        if operation == 'rename':
            prefix += ':' + query.split('=')[1]
        self.point(prefix + ':before')
        item = self.items[target]
        if operation == 'start':
            item['State']['Running'] = True
        elif operation == 'stop':
            item['State']['Running'] = False
        elif operation == 'rename':
            item['Name'] = '/' + query.split('=')[1]
        else:
            raise AssertionError(operation)
        self.point(prefix + ':after')

    def remove_candidate(self, target):
        assert target == NEW_ID
        del self.items[target]


class PreparationDocker(FakeDocker):
    def __init__(self):
        super().__init__()
        self.items[DB_ID] = f.fixture()[1]
        self.items[DB_ID]['Id'] = DB_ID

    def request(self, method, path, body=None, missing=False):
        if method == 'GET' and path.startswith('/images/'):
            return copy.deepcopy(f.fixture()[2])
        return super().request(method, path, body, missing)


class FixtureActivation(m.Activation):
    def prepare(self):
        if self.journal_path.exists():
            raise m.Refused('unresolved operation')
        old, shared, kong, raw = fixture()
        m.atomic_write(self.old_env_path, raw)
        self.state = {'version': m.VERSION, 'phase': 'prepared', 'old_id': OLD_ID, 'old': old,
                      'network': 'stack_default', 'role_oid': 42, 'db_id': DB_ID, 'source_sha': '1'*40, 'run_id': '1',
                      'shared': m.shared_fingerprint(shared), 'kong_id': KONG_ID, 'candidate_id': None}
        self.save('prepared')
        return f.SENTINEL, shared


class PureTests(unittest.TestCase):
    def test_password_delimiters_and_ambiguous_types(self):
        self.assertEqual(m.validate_password(PASSWORD.encode()), PASSWORD)
        for bad in (b'', b'x'*31, b'x'*97, b'x'*31+b'\n', b'x'*31+b'\r', b'x'*31+b'\0', b' '*32, '\u0430'*40, True, None):
            with self.subTest(kind=type(bad).__name__), self.assertRaises(m.Refused):
                m.validate_password(bad)

    def test_preserves_every_unrelated_config_and_env_byte(self):
        old, _, _, raw = fixture()
        before = copy.deepcopy(old)
        proposed = m.replacement(old, PASSWORD)
        self.assertEqual(old, before)
        for key, value in old['Config'].items():
            if key not in ('Image', 'Env'):
                self.assertEqual(proposed[key], value)
        self.assertEqual(proposed['HostConfig'], old['HostConfig'])
        self.assertEqual(proposed['Image'], old['Image'])
        new = m.changed_env(raw, proposed)
        old_lines, new_lines = raw.splitlines(keepends=True), new.splitlines(keepends=True)
        for a, b in zip(old_lines, new_lines):
            if not a.startswith((b'PGRST_DB_URI=', b'PGRST_DB_SCHEMAS=')):
                self.assertEqual(a, b)
        self.assertIn(b'%2B%25%2F%3F%40%23%3D', new)
        self.assertIn(b'@db:5432/living_menaion\r\n', new)

    def test_fidelity_refuses_ignored_and_wrong_type_values(self):
        old, *_ = fixture()
        proposed = m.replacement(old, PASSWORD)
        docker = FakeDocker()
        docker.request('POST', '/containers/create?name=' + m.CANDIDATE, proposed)
        actual = docker.inspect(NEW_ID)
        m.fidelity(actual, proposed, old['Image'], 'stack_default')
        for mutate in (lambda a: a['HostConfig'].__setitem__('Privileged', 0),
                       lambda a: a['Config'].__setitem__('WorkingDir', ''),
                       lambda a: a['HostConfig'].__setitem__('MaskedPaths', []),
                       lambda a: a['Config'].__setitem__('Labels', {}),
                       lambda a: a.__setitem__('Image', 'sha256:'+'2'*64),
                       lambda a: a['Config'].__setitem__('UnknownIgnoredField', None)):
            bad = copy.deepcopy(actual)
            mutate(bad)
            with self.assertRaises(m.Refused):
                m.fidelity(bad, proposed, old['Image'], 'stack_default')

    def test_only_created_unsupported_oom_default_is_allowed_then_exact(self):
        old, *_ = fixture()
        old['HostConfig']['OomKillDisable'] = None
        proposed = m.replacement(old, PASSWORD)
        docker = FakeDocker()
        docker.request('POST', '/containers/create?name=' + m.CANDIDATE, proposed)
        actual = docker.inspect(NEW_ID)
        actual['State']['Status'] = 'created'
        actual['HostConfig']['OomKillDisable'] = False
        m.fidelity(actual, proposed, old['Image'], 'stack_default', prestart_oom_default=True)
        with self.assertRaises(m.Refused):
            m.fidelity(actual, proposed, old['Image'], 'stack_default')
        actual['State'] = {'Running': True, 'Status': 'running'}
        with self.assertRaises(m.Refused):
            m.fidelity(actual, proposed, old['Image'], 'stack_default', prestart_oom_default=True)
        actual['HostConfig']['OomKillDisable'] = None
        m.fidelity(actual, proposed, old['Image'], 'stack_default')
        for wrong in (True, 0, '', []):
            actual['State'] = {'Running': False, 'Status': 'created'}
            actual['HostConfig']['OomKillDisable'] = wrong
            with self.assertRaises(m.Refused):
                m.fidelity(actual, proposed, old['Image'], 'stack_default', prestart_oom_default=True)

    def test_password_only_stdin_and_client_encrypted_command(self):
        calls = []
        with patch.object(m.inspection, 'command', side_effect=lambda argv, data=None: calls.append((argv, data)) or b't\n'):
            m.set_password(PASSWORD, 42, DB_ID)
        argv, data = calls[0]
        self.assertNotIn(PASSWORD, repr(argv))
        self.assertEqual(data, (PASSWORD+'\n'+PASSWORD+'\n').encode())
        self.assertIn('\\password menaion_rest_authenticator', argv)
        self.assertIn('-w', argv)
        self.assertIn('-X', argv)
        self.assertNotIn('-t', argv[:argv.index('psql')])
        self.assertIn('/var/run/postgresql', argv)
        self.assertIn('password_encryption=scram-sha-256', repr(argv))
        self.assertNotIn('log_statement', repr(argv))

    def test_denial_is_exact_not_generic_failure(self):
        m.denial(403, {'code': '42501'}, {'42501'})
        m.denial(406, {'code': 'PGRST106'}, {'PGRST106'})
        for status, body in ((200, []), (401, {'code':'PGRST301'}), (503, {'code':'42501'}), (404, {'code':'42501'}), (403, {'code':'other'})):
            with self.assertRaises(m.Refused):
                m.denial(status, body, {'42501', 'PGRST106'})

    def test_invalid_rpc_is_get_read_only(self):
        responses = [(200, 'invalid')] + [(403, {'code':'42501'})]*2 + [(406, {'code':'PGRST106'})]*2
        with patch.object(m, 'http_probe', side_effect=responses) as probe:
            m.isolated_probe({}, {}, 'n', 'synthetic')
        first = probe.call_args_list[0]
        self.assertEqual(len(first.args), 5)
        self.assertIn('corrected_word=&', first.args[4])
        self.assertNotIn('POST', repr(probe.call_args_list))

    def test_no_secret_output_for_bad_cli(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            self.assertEqual(m.main([PASSWORD]), 2)
        self.assertNotIn(PASSWORD, out.getvalue())

    def test_jwt_is_narrow_and_short_lived(self):
        env = {'PGRST_JWT_SECRET': 'SyntheticSigningKeyLongEnoughForTests-Only'}
        with patch.object(m.time, 'time', return_value=1000):
            jwt = m.probe_token(env)
        claims = json.loads(m.base64.urlsafe_b64decode(jwt.split('.')[1]+'=='))
        self.assertEqual(claims, {'role':'menaion_feedback_submit', 'aud':'menaion-feedback', 'iat':1000, 'exp':1120})
        for secret in ('@file', '{"keys":[]}', 'short'):
            with self.assertRaises(m.Refused):
                m.probe_token({'PGRST_JWT_SECRET':secret})


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        (self.home/'.living-menaion').mkdir(mode=0o700)
        self.env_path = self.home/'.living-menaion/postgrest.env'
        self.env_path.write_bytes(fixture()[3]); self.env_path.chmod(0o600)
        self.stack = contextlib.ExitStack()
        self.stack.enter_context(patch.object(m, 'sql', return_value=b't\n'))
        self.password = self.stack.enter_context(patch.object(m, 'set_password'))
        self.disabled = self.stack.enter_context(patch.object(m, 'disable_role'))
        self.stack.enter_context(patch.object(m, 'legacy_probe'))
        self.stack.enter_context(patch.object(m, 'isolated_probe'))
        self.stack.enter_context(patch.object(m.time, 'sleep'))
        self.stack.enter_context(patch.object(m.signal, 'signal'))

    def tearDown(self):
        self.stack.close(); self.tmp.cleanup()

    def assert_restored(self, docker, runner):
        self.assertEqual(runner.state['phase'], 'rolled_back')
        self.assertNotIn(NEW_ID, docker.items)
        self.assertEqual(docker.inspect(OLD_ID), fixture()[0])
        self.assertEqual(self.env_path.read_bytes(), fixture()[3])
        self.disabled.assert_called_with(42, DB_ID)
        self.assertEqual(docker.inspect(SHARED_ID), fixture()[1])

    def test_success_sanitized_journal_and_repeat_rollback(self):
        docker = FakeDocker(); runner = FixtureActivation(docker, self.home)
        runner.activate(PASSWORD)
        self.assertEqual(runner.state['phase'], 'verified')
        self.assertFalse(docker.items[OLD_ID]['State']['Running'])
        self.assertEqual(docker.items[NEW_ID]['Name'], '/'+m.NAME)
        journal = runner.journal_path.read_text()
        self.assertNotIn(PASSWORD, journal); self.assertNotIn(f.SENTINEL, journal)
        self.assertNotIn('postgres://', journal)
        for path in (runner.journal_path, runner.backup_path, runner.old_env_path):
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        recovered = m.Activation(docker, self.home)
        recovered.rollback(); self.assert_restored(docker, recovered)
        recovered.rollback(); self.assert_restored(docker, recovered)
        with self.assertRaises(m.Refused):
            FixtureActivation(docker, self.home).activate(PASSWORD)

    def test_unknown_history_refuses_before_runtime_or_credential_effects(self):
        for result in (False, None, 0, 1, 'true'):
            with self.subTest(value=result):
                docker = PreparationDocker(); before = copy.deepcopy(docker.items)
                runner = m.Activation(docker, self.home)
                facts = f.db_fixture(); facts['migration_history_exact'] = result
                with patch.object(m.inspection, 'database_facts', return_value=facts), patch.object(m, 'service_container') as service:
                    with self.assertRaises(m.Refused):
                        runner.activate(PASSWORD)
                    service.assert_not_called()
                self.assertEqual(docker.items, before)
                self.assertEqual(docker.events, [])
                self.assertIsNone(runner.state)
                self.assertEqual(list(runner.directory.iterdir()), [runner.env_path])
                self.assertEqual(self.env_path.read_bytes(), fixture()[3])
                self.password.assert_not_called(); self.disabled.assert_not_called()

    def test_nine_and_ten_histories_allow_prepare_and_recovery_ignores_future_history(self):
        for history in m.inspection.APPROVED_HISTORIES:
            with self.subTest(rows=len(history)), tempfile.TemporaryDirectory() as directory:
                home = Path(directory); (home/'.living-menaion').mkdir(mode=0o700)
                path = home/'.living-menaion/postgrest.env'; path.write_bytes(fixture()[3]); path.chmod(0o600)
                docker = PreparationDocker(); runner = m.Activation(docker, home)
                raw = f.db_fixture(raw=True)
                raw['migration_history'] = [{'version': v, 'checksum': c} for v,c in history]
                facts = m.inspection.validate_db_facts(raw)
                def service(_docker, _project, name):
                    return docker.inspect(SHARED_ID if name == 'rest' else KONG_ID)
                with patch.object(m.inspection, 'database_facts', return_value=facts), patch.object(m, 'service_container', side_effect=service), patch.object(m, 'sql', side_effect=lambda query, *args: b'42\n' if query.startswith('select oid from') else b't\n'):
                    runner.activate(PASSWORD)
                self.assertEqual(runner.state['phase'], 'verified')
                # Recovery must revoke the role and restore the old runtime even
                # if an unrelated future migration makes activation refuse.
                with patch.object(m.inspection, 'database_facts', side_effect=AssertionError('Recovery must not gate on new activation history')):
                    recovered = m.Activation(docker, home)
                    recovered.rollback(); recovered.rollback()
                self.assertEqual(recovered.state['phase'], 'rolled_back')
                self.assertEqual(docker.inspect(OLD_ID), fixture()[0])
                self.assertEqual(path.read_bytes(), fixture()[3])
                self.assertNotIn(NEW_ID, docker.items)

    def test_failure_before_and_after_each_docker_effect(self):
        points = ['create', 'old:stop', 'old:rename:'+m.BACKUP, 'new:rename:'+m.NAME, 'new:start']
        for step in points:
            for timing in ('before','after'):
                with self.subTest(step=step, timing=timing), tempfile.TemporaryDirectory() as directory:
                    home = Path(directory); (home/'.living-menaion').mkdir(mode=0o700)
                    path = home/'.living-menaion/postgrest.env'; path.write_bytes(fixture()[3]); path.chmod(0o600)
                    docker = FakeDocker(step+':'+timing); runner = FixtureActivation(docker, home)
                    with self.assertRaises(m.Refused):
                        runner.activate(PASSWORD)
                    self.assertEqual(runner.state['phase'], 'rolled_back')
                    self.assertEqual(docker.inspect(OLD_ID), fixture()[0])
                    self.assertNotIn(NEW_ID, docker.items)
                    self.assertEqual(path.read_bytes(), fixture()[3])

    def test_password_failure_rolls_back(self):
        self.password.side_effect = RuntimeError(f.SENTINEL)
        docker = FakeDocker(); runner = FixtureActivation(docker, self.home)
        with self.assertRaises(m.Refused): runner.activate(PASSWORD)
        self.assert_restored(docker, runner)

    def test_probe_failure_rolls_back(self):
        docker = FakeDocker(); runner = FixtureActivation(docker, self.home)
        with patch.object(m, 'isolated_probe', side_effect=m.Refused(f.SENTINEL)), self.assertRaises(m.Refused):
            runner.activate(PASSWORD)
        self.assert_restored(docker, runner)

    def test_env_write_lost_response_rolls_back(self):
        original = m.atomic_write; seen = False
        def write(path, data):
            nonlocal seen
            original(path, data)
            if path == self.env_path and not seen:
                seen = True
                raise m.Refused('lost response')
        docker = FakeDocker(); runner = FixtureActivation(docker, self.home)
        with patch.object(m, 'atomic_write', side_effect=write), self.assertRaises(m.Refused):
            runner.activate(PASSWORD)
        self.assert_restored(docker, runner)

    def test_role_failure_still_attempts_old_service_restore(self):
        docker = FakeDocker(); runner = FixtureActivation(docker, self.home); runner.activate(PASSWORD)
        self.disabled.side_effect = m.Refused('DB unavailable')
        with self.assertRaises(m.Refused): runner.rollback()
        self.assertEqual(runner.state['phase'], 'rolling_back')
        self.assertTrue(docker.items[OLD_ID]['State']['Running'])
        self.assertNotIn(NEW_ID, docker.items)
        self.disabled.side_effect = None
        runner.rollback(); self.assert_restored(docker, runner)

    def test_foreign_name_collision_not_removed(self):
        docker = FakeDocker(); runner = FixtureActivation(docker, self.home); runner.activate(PASSWORD)
        docker.items[NEW_ID]['Id'] = 'e'*64
        with self.assertRaises(m.Refused): runner.rollback()
        self.assertIn(NEW_ID, docker.items)
        self.disabled.assert_called_with(42, DB_ID)

    def test_malformed_journal_refuses_recovery(self):
        docker = FakeDocker(); runner = FixtureActivation(docker, self.home); runner.activate(PASSWORD)
        data = json.loads(runner.journal_path.read_text()); data['version'] = True
        runner.journal_path.write_text(json.dumps(data))
        with self.assertRaises(m.Refused): m.Activation(docker, self.home).rollback()
        self.disabled.assert_not_called()


    def test_persistent_disk_failure_still_revokes_and_starts_old(self):
        docker = FakeDocker(); runner = FixtureActivation(docker, self.home); runner.activate(PASSWORD)
        with patch.object(m, 'atomic_write', side_effect=OSError('disk full')), self.assertRaises(m.Refused):
            runner.rollback()
        self.disabled.assert_called_with(42, DB_ID)
        self.assertTrue(docker.items[OLD_ID]['State']['Running'])
        self.assertNotIn(NEW_ID, docker.items)
        self.assertFalse(runner.rollback_durable)
        self.assertFalse(runner.rollback_verified)  # env restore could not be persisted
        runner.rollback(); self.assert_restored(docker, runner)

    def test_journal_failure_does_not_claim_durable_rollback(self):
        docker = FakeDocker(); runner = FixtureActivation(docker, self.home); runner.activate(PASSWORD)
        original = m.atomic_write
        def write(path, data):
            if path in (runner.journal_path, runner.backup_path):
                raise OSError('disk full')
            original(path, data)
        with patch.object(m, 'atomic_write', side_effect=write), self.assertRaises(m.Refused):
            runner.rollback()
        self.assertTrue(runner.rollback_verified)
        self.assertFalse(runner.rollback_durable)
        self.assertTrue(docker.items[OLD_ID]['State']['Running'])

    def test_signal_during_probe_not_swallowed(self):
        docker = FakeDocker(); runner = FixtureActivation(docker, self.home)
        with patch.object(m, 'isolated_probe', side_effect=m.Interrupted()) as probe, self.assertRaises(m.Refused):
            runner.activate(PASSWORD)
        self.assertEqual(probe.call_count, 1)
        self.assert_restored(docker, runner)

    def test_replaced_database_never_receives_role_mutation(self):
        docker = FakeDocker(); runner = FixtureActivation(docker, self.home); runner.activate(PASSWORD)
        docker.items[DB_ID]['Id'] = '9'*64
        with self.assertRaises(m.Refused): runner.rollback()
        self.disabled.assert_not_called()
        self.assertTrue(docker.items[OLD_ID]['State']['Running'])
        self.assertFalse(runner.rollback_verified)


    def test_failed_rollback_before_loading_state_requires_recovery(self):
        for docker_error in (True, False):
            with self.subTest(docker_unavailable=docker_error):
                out = io.StringIO()
                journal = self.home / '.living-menaion/feedback-activation.json'
                journal.write_text('corrupt'); journal.chmod(0o600)
                with patch.object(m.Path, 'home', return_value=self.home), patch.object(m, 'Docker', side_effect=OSError('unavailable') if docker_error else None, return_value=FakeDocker()), contextlib.redirect_stdout(out):
                    self.assertEqual(m.main(['--rollback','1'*40,'1']), 1)
                report = json.loads(out.getvalue())
                self.assertTrue(report['operator_recovery_required'])
                self.assertFalse(report['rollback_verified'])


if __name__ == '__main__': unittest.main()
