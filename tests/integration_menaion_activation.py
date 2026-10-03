#!/usr/bin/env python3
"""Secretless, destructive-to-own-fixtures-only Docker integration tests.

Run on a fresh Linux GitHub-hosted runner with Docker and Python 3.11+:
  RUN_MENAION_DOCKER_INTEGRATION=1 python3 tests/integration_menaion_activation.py

Never run on a production host. The opt-in is mandatory; every fixed container
name and the test network must be absent before setup. Cleanup removes only
objects bearing this invocation's random ownership label. No host ports, host
mounts, real credentials, real data, external services, or production endpoints
are used. Image pulls are the only external traffic requested by this harness.

postgres:15.19-bookworm and postgrest/postgrest:v12.2.3 are pinned compatibility
fixtures, not recommendations for production deployment versions.
The actual password setter, catalog preflight, Docker socket client, HTTP probes,
activation and rollback run unmocked. Only journal checkpoints are intercepted
to inject exceptions or hard process exits. The SQL fixture is synthetic, not a
replacement for full nine-migration acceptance tests.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import hmac
import importlib.util
import json
import multiprocessing
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch
from urllib.parse import quote, unquote, urlencode, urlsplit
import uuid


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("activation_integration_target", ROOT / "scripts/activate-menaion-runtime.py")
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)
# Official tag verified against docker-library/docs postgres supported tags.
POSTGRES_IMAGE = "postgres:15.19-bookworm"
POSTGREST_IMAGE = "postgrest/postgrest:v12.2.3"
PROJECT = "menaion_ci"
NETWORK = PROJECT + "_default"
OWNER_LABEL = "io.peerivo.menaion-activation-test"
NAMES = ("supabase-db", "menaion-ci-rest", "menaion-ci-kong", m.NAME, m.CANDIDATE, m.BACKUP)
# Exactly all 94 printable, non-space ASCII characters, including quotes,
# backslash, URI delimiters and shell metacharacters. These are PUBLIC test data.
PASSWORD = "".join(chr(value) for value in range(33, 127))
JWT_KEY = "menaion-ci-public-hmac-fixture-key-never-use-in-production"
CID = re.compile(r"[a-f0-9]{64}\Z")


def local_docker(*args, data=None, check=True, timeout=90):
    """Pin the local socket and a clean environment; never render raw failures."""
    result = subprocess.run(
        ["docker", "--host", "unix:///var/run/docker.sock", *args],
        input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=timeout, check=False,
        env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"),
             "HOME": os.environ["HOME"], "LC_ALL": "C"},
    )
    if check and result.returncode:
        raise AssertionError("Disposable Docker command failed; raw container output withheld")
    return result


def inspect_any(name):
    result = local_docker("inspect", name, check=False)
    if result.returncode:
        return None
    items = json.loads(result.stdout)
    if len(items) != 1:
        raise AssertionError("Ambiguous fixture object")
    return items[0]


def service_token():
    def encode(raw):
        return base64.urlsafe_b64encode(raw).rstrip(b"=")
    now = int(time.time())
    body = encode(b'{"alg":"HS256","typ":"JWT"}') + b"." + encode(json.dumps(
        {"role": "service_role", "iat": now, "exp": now + 7200}, separators=(",", ":")
    ).encode())
    return (body + b"." + encode(hmac.new(JWT_KEY.encode(), body, hashlib.sha256).digest())).decode()


def fixture_sql(text):
    return local_docker(
        "exec", "-i", "supabase-db", "psql", "-X", "-q", "-t", "-A", "-w",
        "-h", "/var/run/postgresql", "-U", "supabase_admin", "-d", "living_menaion",
        "-v", "ON_ERROR_STOP=1", data=text.encode(),
    ).stdout.strip()


def wait_until(callback, description, seconds=40):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if callback():
                return
        except (m.Refused, AssertionError, OSError, ValueError):
            pass
        time.sleep(0.5)
    raise AssertionError("Disposable fixture readiness failed: " + description)


def crash_at_checkpoint(home, phase):
    """Child dies without finally/rollback, as with an interrupted executor."""
    runner = m.Activation(m.Docker(), Path(home))
    original = runner.save
    def save(current):
        original(current)
        if current == phase:
            os._exit(73)
    with patch.object(runner, "save", side_effect=save):
        runner.activate(PASSWORD)
    os._exit(74)  # Reaching this means the requested crash point was not tested.


@unittest.skipUnless(os.environ.get("RUN_MENAION_DOCKER_INTEGRATION") == "1",
                     "requires explicit opt-in on a fresh disposable Docker runner")
class MenaionActivationIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if os.name != "posix" or not shutil.which("docker") or not Path("/var/run/docker.sock").exists():
            raise AssertionError("Opted-in integration requires Linux and the local Docker socket; not skipped")
        if os.environ.get("DOCKER_HOST") or os.environ.get("DOCKER_CONTEXT"):
            raise AssertionError("Remote/custom Docker contexts are forbidden for this fixture")
        # Diagnostics are fixture-only and emit field names/network shape, never
        # environment values, labels, password data or raw Docker error bodies.
        original_fidelity = m.fidelity
        def checked_fidelity(actual, expected, image, network, **kwargs):
            try:
                return original_fidelity(actual, expected, image, network, **kwargs)
            except m.Refused:
                config = {key: value for key, value in expected.items()
                          if key not in ("HostConfig", "NetworkingConfig")}
                fields = []
                for group, left, right in (("Config", actual["Config"], config),
                                           ("HostConfig", actual["HostConfig"], expected["HostConfig"])):
                    fields.extend(group + "." + key for key in sorted(set(left) | set(right))
                                  if not m.strict_equal(left.get(key), right.get(key)) or (key in left) != (key in right))
                actual_network = actual["NetworkSettings"]["Networks"].get(network, {})
                print(json.dumps({"fixture_fidelity_differences": fields,
                    "network_actual": m.endpoint_inputs(actual_network),
                    "network_expected": expected["NetworkingConfig"]["EndpointsConfig"][network]}), flush=True)
                raise
        cls.fidelity_patch = patch.object(m, "fidelity", side_effect=checked_fidelity)
        cls.fidelity_patch.start()
        cls.addClassCleanup(cls.fidelity_patch.stop)
        cls.owner = uuid.uuid4().hex
        cls.temp = tempfile.TemporaryDirectory(prefix="menaion-disposable-ci-")
        cls.addClassCleanup(cls.temp.cleanup)
        cls.home = Path(cls.temp.name)
        cls.home.chmod(0o700)
        cls.home_patch = patch.dict(os.environ, {"HOME": str(cls.home)})
        cls.home_patch.start()
        cls.addClassCleanup(cls.home_patch.stop)
        local_docker("info", "--format", "{{.ServerVersion}}")
        # No adoption of existing objects and no rm-by-name on startup.
        if any(inspect_any(name) is not None for name in NAMES):
            raise AssertionError("Reserved fixture container name already exists; refusing all fixture writes")
        if local_docker("network", "inspect", NETWORK, check=False).returncode == 0:
            raise AssertionError("Reserved fixture network already exists; refusing all fixture writes")
        cls.network_id = None
        cls.addClassCleanup(cls.cleanup_owned)
        for image in (POSTGRES_IMAGE, POSTGREST_IMAGE):
            local_docker("pull", image, timeout=240)
        cls.network_id = local_docker("network", "create", "--internal", "--label",
                                      OWNER_LABEL + "=" + cls.owner, NETWORK).stdout.decode().strip()
        cls.start_container(
            "supabase-db", POSTGRES_IMAGE, service="db", extra=[
                "--network-alias", "db", "-e", "POSTGRES_USER=supabase_admin",
                "-e", "POSTGRES_DB=living_menaion",
                "-e", "POSTGRES_PASSWORD=menaion-ci-bootstrap-public-fixture",
                "-e", "POSTGRES_INITDB_ARGS=--auth-local=trust --auth-host=scram-sha-256",
            ], command=["postgres", "-c", "password_encryption=scram-sha-256",
                        "-c", "log_min_error_statement=panic", "-c", "log_parameter_max_length=0"],
        )
        wait_until(lambda: fixture_sql("select 1;") == b"1", "PostgreSQL")
        fixture_sql((ROOT / "tests/fixtures/menaion_activation.sql").read_text())
        cls.token = service_token()
        cls.authored_env = {
            "PGRST_DB_URI": "postgres://authenticator:menaion-ci-old-password-only@db:5432/living_menaion",
            "PGRST_DB_SCHEMAS": "living_menaion",
            "PGRST_JWT_SECRET": JWT_KEY,
            "PGRST_DB_CONFIG": "false", "PGRST_LOG_LEVEL": "error",
        }
        cls.start_container("menaion-ci-rest", POSTGREST_IMAGE, service="rest", env=cls.authored_env)
        # Kong is only a credential-source/container-identity stand-in. No Kong
        # HTTP/auth behavior is claimed. Reuse the pinned postgres image for sleep.
        cls.start_container("menaion-ci-kong", POSTGRES_IMAGE, service="kong",
                            env={"SUPABASE_SERVICE_KEY": cls.token}, command=["sleep", "infinity"])
        cls.docker = m.Docker()
        cls.shared = m.service_container(cls.docker, PROJECT, "rest")
        wait_until(lambda: cls.legacy_ok("menaion-ci-rest"), "shared PostgREST")
        cls.shared_before = copy.deepcopy(cls.shared)
        cls.db_id = inspect_any("supabase-db")["Id"]
        cls.kong_id = inspect_any("menaion-ci-kong")["Id"]

    @classmethod
    def start_container(cls, name, image, service=None, env=None, extra=None, command=None):
        args = ["run", "-d", "--pull", "never", "--name", name, "--network", NETWORK,
                "--label", OWNER_LABEL + "=" + cls.owner,
                "--restart", "unless-stopped", "--log-driver", "json-file"]
        if service:
            args += ["--label", "com.docker.compose.project=" + PROJECT,
                     "--label", "com.docker.compose.service=" + service]
        for key, value in (env or {}).items():
            args += ["-e", key + "=" + value]
        local_docker(*args, *(extra or []), image, *(command or []))

    @classmethod
    def cleanup_owned(cls):
        # Also finds candidate/backup renamed by the actual implementation.
        ids = local_docker("ps", "-aq", "--no-trunc", "--filter",
                           "label=" + OWNER_LABEL + "=" + cls.owner).stdout.decode().split()
        for cid in ids:
            if not CID.fullmatch(cid):
                raise AssertionError("Unexpected cleanup identity")
            item = inspect_any(cid)
            if item and item["Config"]["Labels"].get(OWNER_LABEL) == cls.owner:
                local_docker("rm", "-f", "-v", cid)
        if cls.network_id:
            result = local_docker("network", "inspect", cls.network_id, check=False)
            if result.returncode == 0:
                item = json.loads(result.stdout)[0]
                if item.get("Labels", {}).get(OWNER_LABEL) != cls.owner:
                    raise AssertionError("Fixture network ownership changed; refusing cleanup")
                local_docker("network", "rm", cls.network_id)

    @classmethod
    def legacy_ok(cls, name):
        item = inspect_any(name)
        if item is None:
            return False
        m.legacy_probe(item, NETWORK, cls.token)
        return True

    def setUp(self):
        self.signal_handlers = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
        self.addCleanup(self.restore_signal_handlers)
        self.addCleanup(self.cleanup_runtime)
        self.reset_runtime()

    def restore_signal_handlers(self):
        for sig, handler in self.signal_handlers.items():
            signal.signal(sig, handler)

    def cleanup_runtime(self):
        for name in (m.NAME, m.CANDIDATE, m.BACKUP):
            item = inspect_any(name)
            if item is not None:
                if item["Config"]["Labels"].get(OWNER_LABEL) != self.owner:
                    raise AssertionError("Foreign runtime fixture; refusing deletion")
                local_docker("rm", "-f", "-v", item["Id"])
        fixture_sql("alter role menaion_rest_authenticator nologin password null; "
                    "select pg_terminate_backend(pid) from pg_stat_activity "
                    "where usename='menaion_rest_authenticator';")
        directory = self.home / ".living-menaion"
        if directory.exists():
            shutil.rmtree(directory)

    def reset_runtime(self):
        self.cleanup_runtime()
        directory = self.home / ".living-menaion"
        directory.mkdir(mode=0o700)
        self.env_path = directory / "postgrest.env"
        self.original_env = ("# public CI fixture, preserve comments and CRLF\r\n\r\n" + "".join(
            key + "=" + value + "\r\n" for key, value in self.authored_env.items()
        ) + "\r\n").encode()
        self.env_path.write_bytes(self.original_env)
        self.env_path.chmod(0o600)
        self.start_container(m.NAME, POSTGREST_IMAGE, env=self.authored_env)
        wait_until(lambda: self.legacy_ok(m.NAME), "isolated legacy PostgREST")
        self.old = self.docker.inspect(m.NAME)
        self.before_data = self.data_snapshot()
        facts = m.inspection.database_facts()  # The real catalog query, no mocks.
        self.assertTrue(all(facts[key] is True for key in m.inspection.DB_FIELDS))

    def data_snapshot(self):
        return fixture_sql("select jsonb_build_object("
            "'editions', (select jsonb_agg(t order by id) from living_menaion.liturgical_day_editions t), "
            "'entries', (select jsonb_agg(t order by id) from living_menaion.pronunciation_entries t), "
            "'rate_buckets', (select jsonb_agg(t order by bucket) from menaion_feedback_private.rate_buckets t));")

    def assert_unrelated_unchanged(self):
        shared = m.service_container(self.docker, PROJECT, "rest")
        self.assertEqual(m.shared_fingerprint(shared), m.shared_fingerprint(self.shared_before))
        self.assertTrue(shared["State"]["Running"])
        self.assertEqual(inspect_any("supabase-db")["Id"], self.db_id)
        self.assertEqual(inspect_any("menaion-ci-kong")["Id"], self.kong_id)
        self.assertEqual(self.data_snapshot(), self.before_data)

    def assert_dns(self, expected):
        def resolves():
            result = local_docker("exec", "supabase-db", "getent", "ahostsv4", m.NAME, check=False)
            actual = {line.split()[0] for line in result.stdout.decode().splitlines() if line.split()}
            return result.returncode == 0 and actual == {expected}
        wait_until(resolves, "Docker DNS follows the final runtime name", seconds=15)

    def assert_restored(self):
        old = self.docker.inspect(m.NAME)
        self.assertEqual(m.shared_fingerprint(old), m.shared_fingerprint(self.old))
        self.assertTrue(old["State"]["Running"])
        self.assertIsNone(self.docker.inspect(m.CANDIDATE, missing=True))
        self.assertIsNone(self.docker.inspect(m.BACKUP, missing=True))
        self.assertEqual(self.env_path.read_bytes(), self.original_env)
        self.assertEqual(self.env_path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(fixture_sql("select not rolcanlogin and rolpassword is null "
                         "and not exists(select from pg_stat_activity where usename='menaion_rest_authenticator') "
                         "from pg_authid where rolname='menaion_rest_authenticator';"), b"t")
        self.assertTrue(self.legacy_ok(m.NAME))
        self.assert_dns(old["NetworkSettings"]["Networks"][NETWORK]["IPAddress"])
        self.assert_unrelated_unchanged()

    def test_special_ascii_scram_immutable_clone_dns_and_access_boundaries(self):
        runner = m.Activation(self.docker, self.home)
        runner.activate(m.validate_password(PASSWORD.encode()))
        self.assertEqual(runner.state["phase"], "verified")
        current = self.docker.inspect(m.NAME)
        self.assertNotEqual(current["Id"], self.old["Id"])
        self.assertEqual(current["Image"], self.old["Image"])
        self.assertEqual(current["HostConfig"], self.old["HostConfig"])
        expected_config = copy.deepcopy(self.old["Config"])
        expected_config["Image"] = self.old["Image"]
        expected_env = dict(self.authored_env)
        expected_env["PGRST_DB_URI"] = "postgres://menaion_rest_authenticator:" + quote(PASSWORD, safe="") + "@db:5432/living_menaion"
        expected_env["PGRST_DB_SCHEMAS"] = "living_menaion,menaion_feedback"
        expected_config["Env"] = [key + "=" + expected_env.get(key, value)
                                  for key, value in (line.split("=", 1) for line in expected_config["Env"])]
        self.assertEqual(current["Config"], expected_config)
        endpoint_keys = ("IPAMConfig", "Links", "Aliases", "DriverOpts", "GwPriority")
        for key in endpoint_keys:
            self.assertEqual(current["NetworkSettings"]["Networks"][NETWORK].get(key),
                             self.old["NetworkSettings"]["Networks"][NETWORK].get(key), key)
        self.assertEqual(unquote(urlsplit(expected_env["PGRST_DB_URI"]).password), PASSWORD)
        self.assertEqual(m.inspection.read_private_env(self.env_path), expected_env)
        self.assertEqual(fixture_sql("select rolcanlogin and rolpassword like 'SCRAM-SHA-256$%' "
                         "and exists(select from pg_stat_activity where usename='menaion_rest_authenticator' "
                         "and datname='living_menaion') from pg_authid where rolname='menaion_rest_authenticator';"), b"t")
        self.assertFalse(self.docker.inspect(m.BACKUP)["State"]["Running"])
        self.assert_dns(current["NetworkSettings"]["Networks"][NETWORK]["IPAddress"])
        # Repeat the real HTTP boundary probe; wrong grants must not pass silently.
        narrow = m.probe_token(expected_env)
        m.isolated_probe(current, self.shared, NETWORK, narrow)
        invalid = urlencode({"corrected_word": "", "civil_date": "", "client_hash": "0" * 64})
        self.assertEqual(m.http_probe(current, NETWORK, narrow, "menaion_feedback",
                         "/rpc/submit_pronunciation_correction?" + invalid), (200, "invalid"))
        self.assert_unrelated_unchanged()
        journal = runner.journal_path.read_bytes()
        for forbidden in (PASSWORD, quote(PASSWORD, safe=""), JWT_KEY, self.token, "postgres://"):
            self.assertNotIn(forbidden.encode(), journal)
        for name in ("supabase-db", m.NAME):
            output = local_docker("logs", name)
            logs = output.stdout + output.stderr
            self.assertNotIn(PASSWORD.encode(), logs)
            self.assertNotIn(quote(PASSWORD, safe="").encode(), logs)
        for name in ("feedback-activation.json", "feedback-runtime.backup.json", "feedback-runtime.backup.env"):
            self.assertEqual((self.home / ".living-menaion" / name).stat().st_mode & 0o777, 0o600)
        # Explicit rollback of successful activation, then fresh-process-style
        # repeat recovery must restore exactly the retained old container.
        runner.rollback()
        self.assert_restored()
        m.Activation(self.docker, self.home).rollback()
        self.assert_restored()

    def test_failure_at_each_durable_checkpoint_automatically_restores(self):
        phases = ("creating", "created", "password", "login", "stopping", "renaming_old",
                  "renaming_new", "starting", "writing_env", "verified")
        for index, phase in enumerate(phases):
            with self.subTest(checkpoint=phase):
                if index:
                    self.reset_runtime()
                runner = m.Activation(self.docker, self.home)
                original = runner.save
                fired = []
                def save(current):
                    original(current)
                    if current == phase and not fired:
                        fired.append(True)
                        raise RuntimeError("intentional disposable checkpoint failure")
                with patch.object(runner, "save", side_effect=save):
                    with self.assertRaises(m.Refused):
                        runner.activate(PASSWORD)
                self.assertEqual(fired, [True], "requested failure checkpoint was not exercised")
                self.assertEqual(runner.state["phase"], "rolled_back")
                self.assert_restored()
                m.Activation(self.docker, self.home).rollback()
                self.assert_restored()

    def test_hard_process_exit_recovers_from_disk_and_can_repeat(self):
        # After password install, after name swap, and after full activation.
        for index, phase in enumerate(("login", "starting", "verified")):
            with self.subTest(crash_checkpoint=phase):
                if index:
                    self.reset_runtime()
                child = multiprocessing.get_context("fork").Process(
                    target=crash_at_checkpoint, args=(str(self.home), phase))
                child.start()
                child.join(120)
                if child.is_alive():
                    child.kill()
                    child.join(10)
                    self.fail("Disposable activation did not reach the crash checkpoint")
                self.assertEqual(child.exitcode, 73, "hard-exit checkpoint was not exercised")
                journal = json.loads((self.home / ".living-menaion/feedback-activation.json").read_text())
                self.assertEqual(journal["phase"], phase)
                m.Activation(self.docker, self.home).rollback()
                self.assert_restored()
                m.Activation(self.docker, self.home).rollback()
                self.assert_restored()


if __name__ == "__main__":
    unittest.main(verbosity=2)
