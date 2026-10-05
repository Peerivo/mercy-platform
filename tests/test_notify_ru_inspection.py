import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("notify_inspector", ROOT / "scripts/inspect-notify-ru-core.py")
INSPECTOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INSPECTOR)
TOKEN = "synthetic-scoped-token-" * 3
CORE_TOKEN = "synthetic-global-token-" * 3
TENANT = "11111111-1111-4111-8111-111111111111"
CONNECTION = "22222222-2222-4222-8222-222222222222"
OWNER = "42424242"


class InspectorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.runtime = self.root / "current"
        for name in INSPECTOR.RUNTIME_FILES:
            file = self.runtime / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text("synthetic source bytes, never response content")
        self.env = self.root / "notify.env"
        self.write_env()
        self.commands = []
        self.requests = []
        self.health = {"ok": True, "configured": True, "service": "peerivo-notify-ru-core", "version": "0.6.0", "capabilities": ["owner-scoped-human-actions-v1"]}
        self.connection = {"id": CONNECTION, "tenantId": TENANT, "status": "active", "chatType": "private", "chatId": OWNER, "telegramUserId": OWNER, "ready": True}

    def write_env(self, **changes):
        values = {"NOTIFY_MENAION_TOKEN": TOKEN, "NOTIFY_CORE_TOKEN": CORE_TOKEN,
                  "NOTIFY_MENAION_TENANT_ID": TENANT, "NOTIFY_MENAION_CONNECTION_ID": CONNECTION,
                  "NOTIFY_MENAION_ALLOWED_ACTOR": "telegram:" + OWNER}
        values.update(changes)
        self.env.write_text("\n".join(name + "=" + value for name, value in values.items()) + "\n")

    def command(self, args, stdin=None):
        self.commands.append((args, stdin))
        if args == INSPECTOR.SYSTEMD_COMMAND:
            return "ActiveState=active\nSubState=running\nMainPID=123\nExecMainStatus=0\nUser=peerivo-notify\nGroup=peerivo-notify\nWorkingDirectory=/opt/peerivo-notify/current\nExecStart={ path=/usr/bin/node ; argv[]=/usr/bin/node /opt/peerivo-notify/current/src/ru-core-server.js ; ignore_errors=no ; }\nUnexpected=private-debug\n"
        self.assertEqual(args, INSPECTOR.DATABASE_COMMAND)
        self.assertEqual(stdin, INSPECTOR.MIGRATION_SQL)
        return "0001_notify_core.sql\n0002_human_action_choices.sql\n0003_telegram_relays.sql\n0004_owner_scoped_human_actions.sql\n"

    def request(self, url, headers=None):
        self.requests.append((url, headers))
        if url in (INSPECTOR.LOOPBACK + "/health", INSPECTOR.PUBLIC_HEALTH):
            self.assertIsNone(headers)
            return {"status": "received", "httpStatus": 200, "payload": self.health}
        self.assertEqual(url, INSPECTOR.LOOPBACK + "/v1/telegram/connections/" + CONNECTION)
        self.assertEqual(headers, {"Authorization": "Bearer " + TOKEN, "Accept": "application/json"})
        return {"status": "received", "httpStatus": 200, "payload": {"ok": True, "found": True, "connection": self.connection, "debug": TOKEN}}

    def inspect(self, **kwargs):
        return INSPECTOR.collect_report(self.runtime, self.env, kwargs.get("command", self.command), kwargs.get("request", self.request), kwargs.get("listener", lambda pid: pid == 123))

    def test_ready_profile_is_compared_without_exporting_identity_or_secrets(self):
        report = self.inspect()
        self.assertTrue(report["privateOwnerConnection"]["ready"])
        self.assertTrue(report["migrations"]["ownerMigrationPresent"])
        self.assertFalse(report["productionDeliveryVerified"])
        self.assertFalse(report["ownerIdentityIndependentlyVerified"])
        encoded = json.dumps(report)
        for value in (TOKEN, CORE_TOKEN, TENANT, CONNECTION, OWNER, "private-debug", "synthetic source bytes"):
            self.assertNotIn(value, encoded)
        self.assertEqual(len(self.commands), 2)
        self.assertEqual(len(self.requests), 3)

    def test_database_command_uses_fixed_local_socket_and_read_only_transaction(self):
        self.inspect()
        sql = self.commands[1][1]
        self.assertTrue(sql.startswith("BEGIN TRANSACTION READ ONLY;"))
        self.assertIn("SET LOCAL statement_timeout = '5s';", sql)
        self.assertTrue(sql.endswith("ROLLBACK;\n"))
        self.assertEqual(sql.count("SELECT "), 1)
        self.assertIn("unix:///var/run/docker.sock", self.commands[1][0])
        self.assertIn("/var/run/postgresql", self.commands[1][0])
        self.assertIn("/usr/bin/env", self.commands[1][0])
        self.assertIn("-i", self.commands[1][0])
        self.assertIn("PGCONNECT_TIMEOUT=5", self.commands[1][0])
        self.assertNotIn("-c", self.commands[1][0])

    def test_layout_and_service_paths_are_reported_only_as_safe_categories(self):
        report = self.inspect()
        self.assertEqual(report["runtimeLayout"]["currentKind"], "directory")
        self.assertTrue(report["runtimeLayout"]["sourceDirectoryPresent"])
        self.assertTrue(report["service"]["state"]["ExecStartExpected"])
        self.assertTrue(report["service"]["state"]["WorkingDirectoryExpected"])
        self.assertTrue(report["service"]["state"]["UserExpected"])
        def unexpected(args, stdin=None):
            if stdin:
                return self.command(args, stdin)
            return "User=private-user\nGroup=private-group\nWorkingDirectory=/private-path\nExecStart={ path=/usr/bin/node ; argv[]=/usr/bin/node --import=" + TOKEN + " /opt/peerivo-notify/current/src/ru-core-server.js ; }\n"
        report = self.inspect(command=unexpected)
        self.assertFalse(report["service"]["state"]["ExecStartExpected"])
        self.assertFalse(report["service"]["state"]["WorkingDirectoryExpected"])
        for secret in (TOKEN, "private-user", "private-group", "private-path"):
            self.assertNotIn(secret, json.dumps(report))

    def test_unreadable_environment_never_falls_back_to_global_credential(self):
        self.env.unlink()
        report = self.inspect()
        self.assertFalse(report["scopedProfile"]["configured"])
        self.assertFalse(report["privateOwnerConnection"]["checked"])
        self.assertEqual(len(self.requests), 2)

    def test_missing_or_global_alias_token_never_attempts_authenticated_request(self):
        for token in ("", CORE_TOKEN):
            with self.subTest(token=bool(token)):
                self.requests.clear()
                self.write_env(NOTIFY_MENAION_TOKEN=token)
                report = self.inspect()
                self.assertFalse(report["privateOwnerConnection"]["checked"])
                self.assertEqual(len(self.requests), 2)

    def test_missing_invalid_core_reference_never_sends_the_scoped_token(self):
        for token in ("", "short", "\u1234" * 40):
            with self.subTest(length=len(token)):
                self.requests.clear()
                self.write_env(NOTIFY_CORE_TOKEN=token)
                report = self.inspect()
                self.assertFalse(report["scopedProfile"]["configured"])
                self.assertFalse(report["privateOwnerConnection"]["checked"])
                self.assertEqual(len(self.requests), 2)

    def test_spoofed_health_without_expected_listener_receives_no_token(self):
        report = self.inspect(listener=lambda pid: False)
        self.assertFalse(report["listenerMatchesService"])
        self.assertFalse(report["privateOwnerConnection"]["checked"])
        self.assertEqual(len(self.requests), 2)

    def test_inactive_or_mismatched_service_receives_no_token(self):
        for wrong in ("ActiveState=inactive", "SubState=dead", "User=other", "Group=other", "WorkingDirectory=/wrong", "ExecStart=wrong"):
            with self.subTest(field=wrong.split("=")[0]):
                self.requests.clear()
                def changed(args, stdin=None):
                    data = self.command(args, stdin)
                    return data + wrong + "\n" if not stdin else data
                report = self.inspect(command=changed)
                self.assertFalse(report["listenerMatchesService"])
                self.assertEqual(len(self.requests), 2)

    def test_runtime_reads_are_bounded_before_hashing(self):
        filename = self.runtime / "src/ru-core.js"
        with filename.open("wb") as handle:
            handle.truncate(2 * 1048576)
        report = self.inspect()
        self.assertFalse(next(item for item in report["runtimeFiles"] if item["path"] == "src/ru-core.js")["present"])
        class LimitedFile:
            def open(self, mode):
                self.assert_mode = mode
                return self
            def __enter__(self): return self
            def __exit__(self, *args): return None
            def read(self, size):
                self.size = size
                return b"x" * size
        limited = LimitedFile()
        with self.assertRaises(ValueError):
            INSPECTOR.read_bounded(limited, 256)
        self.assertEqual(limited.size, 257)

    def test_kernel_listener_binding_rejects_wrong_pid_uid_and_changed_start_time(self):
        proc = self.root / "proc"
        process = proc / "123"
        (proc / "net").mkdir(parents=True)
        (process / "fd").mkdir(parents=True)
        (process / "stat").write_text("123 (node) " + " ".join(["S"] + ["0"] * 18 + ["777"]) + "\n")
        (process / "status").write_text("Name:\tnode\nUid:\t1001\t1001\t1001\t1001\n")
        (process / "cmdline").write_bytes(b"/usr/bin/node\0/opt/peerivo-notify/current/src/ru-core-server.js\0")
        (proc / "net/tcp").write_text("header\n0: 0100007F:0BB8 00000000:0000 0A 0 0 0 1001 0 42\n")
        (process / "fd/5").symlink_to("socket:[42]")
        self.assertTrue(INSPECTOR.listener_matches_service(123, proc, 1001))
        self.assertFalse(INSPECTOR.listener_matches_service(999, proc, 1001))
        self.assertFalse(INSPECTOR.listener_matches_service(123, proc, 1002))
        (process / "fd/5").unlink()
        (process / "fd/5").symlink_to("socket:[99]")
        self.assertFalse(INSPECTOR.listener_matches_service(123, proc, 1001))
        (process / "fd/5").unlink()
        (process / "fd/5").symlink_to("socket:[42]")
        original = INSPECTOR.read_bounded
        reads = 0
        def changed_start(filename, limit):
            nonlocal reads
            data = original(filename, limit)
            if filename.name == "stat":
                reads += 1
                if reads > 1: return data.replace(b"777", b"778")
            return data
        INSPECTOR.read_bounded = changed_start
        try:
            self.assertFalse(INSPECTOR.listener_matches_service(123, proc, 1001))
        finally:
            INSPECTOR.read_bounded = original

    def test_wrong_chat_actor_binding_or_status_never_reports_ready(self):
        for patch in ({"chatType": "group"}, {"chatId": "99"}, {"telegramUserId": "99"}, {"tenantId": CONNECTION}, {"id": TENANT}, {"status": "disabled"}, {"ready": False}):
            with self.subTest(field=next(iter(patch))):
                original = dict(self.connection)
                self.connection.update(patch)
                self.assertFalse(self.inspect()["privateOwnerConnection"]["ready"])
                self.connection = original

    def test_whitespace_cannot_disguise_a_global_token_alias(self):
        for whitespace in (" ", "\ufeff", "\u00a0", "\u2003", "\u3000"):
            with self.subTest(codepoint=ord(whitespace)):
                self.requests.clear()
                self.write_env(NOTIFY_MENAION_TOKEN=TOKEN, NOTIFY_CORE_TOKEN='"' + whitespace + TOKEN + whitespace + '"')
                report = self.inspect()
                self.assertFalse(report["scopedProfile"]["configured"])
                self.assertFalse(report["privateOwnerConnection"]["checked"])
                self.assertEqual(len(self.requests), 2)

    def test_unrecognized_or_old_health_receives_no_credentials(self):
        for patch in ({"service": "another-service"}, {"capabilities": []}, {"ok": False}, {"configured": False}):
            with self.subTest(field=next(iter(patch))):
                original = dict(self.health)
                self.health.update(patch)
                self.requests.clear()
                self.assertFalse(self.inspect()["privateOwnerConnection"]["checked"])
                self.assertEqual(len(self.requests), 2)
                self.health = original

    def test_noncanonical_runtime_port_receives_no_credentials(self):
        self.write_env(PORT="4000")
        report = self.inspect()
        self.assertFalse(report["scopedProfile"]["canonicalPort"])
        self.assertFalse(report["privateOwnerConnection"]["checked"])
        self.assertEqual(len(self.requests), 2)

    def test_all_failures_are_sanitized_not_success(self):
        def fail(*args, **kwargs):
            raise RuntimeError("Never export " + TOKEN + " " + OWNER)
        report = self.inspect(command=fail, request=fail)
        self.assertFalse(report["migrations"]["verifiedRead"])
        self.assertFalse(report["service"]["available"])
        self.assertFalse(report["privateOwnerConnection"]["checked"])
        self.assertNotIn(TOKEN, json.dumps(report))
        self.assertNotIn(OWNER, json.dumps(report))

    def test_query_noise_or_excess_rows_are_not_exported_as_migrations(self):
        for rows in ("secret data\n", "0001_notify_core.sql\n" * 101, None):
            with self.subTest(rows=rows is not None):
                report = self.inspect(command=lambda args, stdin=None: rows if stdin else "")
                self.assertFalse(report["migrations"]["verifiedRead"])
                self.assertEqual(report["migrations"]["versions"], [])

    def test_environment_is_parsed_without_shell_evaluation(self):
        marker = self.root / "must-not-exist"
        self.write_env(NOTIFY_MENAION_TOKEN='"$(touch ' + str(marker) + ')"')
        self.inspect()
        self.assertFalse(marker.exists())
        with self.env.open("a") as handle:
            handle.write("NOTIFY_MENAION_TOKEN=duplicate\n")
        self.assertFalse(self.inspect()["scopedProfile"]["readable"])

    def test_arbitrary_hosts_and_redirects_are_refused(self):
        self.assertEqual(INSPECTOR.http_json("https://example.com/steal", {"Authorization": TOKEN}), {"status": "refused"})
        self.assertIsNone(INSPECTOR.NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.com"))

    def test_source_symlinks_are_not_read(self):
        file = self.runtime / "src/menaion-scope.js"
        file.unlink()
        file.symlink_to(self.env)
        report = self.inspect()
        self.assertFalse(next(item for item in report["runtimeFiles"] if item["path"] == "src/menaion-scope.js")["present"])

    def test_workflow_has_separate_unprivileged_pr_tests_and_exact_manual_run(self):
        workflow = (ROOT / ".github/workflows/inspect-notify-ru-core.yml").read_text()
        self.assertNotIn("\n  push:", workflow)
        self.assertNotIn("pull_request_target", workflow)
        self.assertIn("INSPECT_NOTIFY_RU_CORE_READ_ONLY", workflow)
        self.assertIn("test \"$EXPECTED_SHA\" = \"$GITHUB_SHA\"", workflow)
        self.assertIn("refs/heads/main", workflow)
        self.assertIn("StrictHostKeyChecking=yes", workflow)
        self.assertIn("'45.144.176.213'", workflow)
        self.assertIn("'supabase-deploy'", workflow)
        self.assertIn("'sudo -n /usr/bin/python3 -' < scripts/inspect-notify-ru-core.py", workflow)
        validate, inspect = workflow.split("  inspect:\n", 1)
        self.assertNotIn("secrets.", validate)
        self.assertIn("environment: production", inspect)
        self.assertNotIn("REG_RU_SSH_KEY", workflow)


if __name__ == "__main__":
    unittest.main()
