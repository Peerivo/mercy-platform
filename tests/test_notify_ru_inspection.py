import importlib.util
import json
import os
import tempfile
import tracemalloc
import unittest
from unittest.mock import patch
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
            filename = self.runtime / name
            filename.parent.mkdir(parents=True, exist_ok=True)
            filename.write_text("synthetic source bytes, never response content")
        self.env = self.root / "notify.env"
        self.write_env()
        self.commands, self.requests = [], []
        self.health = {"ok": True, "configured": True, "service": "peerivo-notify-ru-core", "version": "0.6.0", "capabilities": ["owner-scoped-human-actions-v1"]}
        self.metadata = {"found": True, "bindingMatches": True, "private": True, "actorMatches": True, "active": True}

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
        self.assertTrue(stdin.startswith("BEGIN TRANSACTION READ ONLY;"))
        self.assertTrue(stdin.endswith("ROLLBACK;\n"))
        if stdin == INSPECTOR.MIGRATION_SQL:
            return "0001_notify_core.sql\n0002_human_action_choices.sql\n0003_telegram_relays.sql\n0004_owner_scoped_human_actions.sql\n"
        self.assertIn("FROM public.notify_telegram_connections c", stdin)
        self.assertIn("WHERE c.id = '" + CONNECTION + "'::uuid AND c.tenant_id = '" + TENANT + "'::uuid;", stdin)
        self.assertNotIn(TOKEN, stdin)
        self.assertNotIn(CORE_TOKEN, stdin)
        return json.dumps(self.metadata)

    def request(self, url, headers=None):
        self.requests.append((url, headers))
        self.assertIn(url, (INSPECTOR.LOOPBACK + "/health", INSPECTOR.PUBLIC_HEALTH))
        self.assertIsNone(headers)
        return {"status": "received", "httpStatus": 200, "payload": self.health}

    def inspect(self, **kwargs):
        return INSPECTOR.collect_report(self.runtime, self.env, kwargs.get("command", self.command), kwargs.get("request", self.request), protected_metadata=True)

    def test_default_public_mode_never_reads_files_environment_or_database(self):
        def command(args, stdin=None):
            self.assertEqual(args, INSPECTOR.SYSTEMD_COMMAND)
            self.assertIsNone(stdin)
            return self.command(args, stdin)
        with patch.object(INSPECTOR, "read_bounded", side_effect=AssertionError("file access forbidden")), \
             patch.object(INSPECTOR, "parse_environment", side_effect=AssertionError("environment forbidden")), \
             patch.object(Path, "is_symlink", side_effect=AssertionError("filesystem forbidden")):
            report = INSPECTOR.collect_report(self.runtime, self.env, command, self.request)
        self.assertEqual(report["inspectionMode"], "public_service_only")
        self.assertEqual(len(self.commands), 1)
        self.assertEqual(len(self.requests), 2)
        self.assertEqual(report["runtimeFiles"], [])
        for item, key in (("migrations", "verifiedRead"), ("scopedProfile", "readable"), ("privateOwnerConnection", "checked")):
            self.assertFalse(report[item][key])

    def test_private_metadata_without_exporting_identity_or_using_tokens(self):
        report = self.inspect()
        self.assertTrue(report["privateOwnerConnection"]["matchesConfiguredPrivateOwner"])
        self.assertEqual(report["privateOwnerConnection"]["source"], "database_metadata")
        for field in ("ready", "apiVerified"):
            self.assertFalse(report["privateOwnerConnection"][field])
        self.assertFalse(report["scopedProfile"]["credentialsChecked"])
        self.assertTrue(report["migrations"]["ownerMigrationPresent"])
        self.assertFalse(report["productionDeliveryVerified"])
        self.assertFalse(report["ownerIdentityIndependentlyVerified"])
        for value in (TOKEN, CORE_TOKEN, TENANT, CONNECTION, OWNER, "private-debug", "synthetic source bytes"):
            self.assertNotIn(value, json.dumps(report))
        self.assertEqual(len(self.commands), 3)
        self.assertEqual(len(self.requests), 2)

    def test_database_reads_are_fixed_target_read_only_transactions(self):
        self.inspect()
        for command, sql in self.commands[1:]:
            self.assertTrue(sql.startswith("BEGIN TRANSACTION READ ONLY;"))
            self.assertIn("SET LOCAL statement_timeout = '5s';", sql)
            self.assertTrue(sql.endswith("ROLLBACK;\n"))
            self.assertEqual(sql.count("SELECT "), 1)
            for item in ("unix:///var/run/docker.sock", "/var/run/postgresql", "/usr/bin/env", "PGCONNECT_TIMEOUT=5"):
                self.assertIn(item, command)
        self.assertIn("LIMIT 101", INSPECTOR.MIGRATION_SQL)
        self.assertIn("octet_length(version) <= 128", INSPECTOR.MIGRATION_SQL)

    def test_unreadable_invalid_scope_never_queries_private_metadata(self):
        for changes in ({"NOTIFY_MENAION_TENANT_ID": "invalid"}, {"NOTIFY_MENAION_CONNECTION_ID": "invalid"}, {"NOTIFY_MENAION_ALLOWED_ACTOR": "telegram:0"}):
            self.commands.clear()
            self.write_env(**changes)
            report = self.inspect()
            self.assertFalse(report["scopedProfile"]["scopeReferenceValid"])
            self.assertFalse(report["privateOwnerConnection"]["checked"])
            self.assertEqual(len(self.commands), 2)
        self.env.unlink()
        self.assertFalse(self.inspect()["scopedProfile"]["readable"])

    def test_missing_aliased_arbitrary_credentials_cannot_be_transmitted(self):
        for token in ("", CORE_TOKEN, '"\ufeff' + CORE_TOKEN + '\ufeff"', "\u1234" * 40):
            self.requests.clear()
            self.write_env(NOTIFY_MENAION_TOKEN=token, NOTIFY_CORE_TOKEN=token)
            report = self.inspect()
            self.assertFalse(report["privateOwnerConnection"]["apiVerified"])
            self.assertEqual(len(self.requests), 2)
            self.assertTrue(all(headers is None for _, headers in self.requests))
            parsed = INSPECTOR.parse_environment(self.env)
            self.assertNotIn("NOTIFY_CORE_TOKEN", parsed)
            self.assertNotIn("NOTIFY_MENAION_TOKEN", parsed)

    def test_spoofed_or_replaced_listener_never_receives_a_bearer(self):
        def replaced(url, headers=None):
            self.requests.append((url, headers))
            self.assertIsNone(headers)
            return {"status": "received", "httpStatus": 200, "payload": self.health}
        report = self.inspect(request=replaced)
        self.assertFalse(report["privateOwnerConnection"]["apiVerified"])
        self.assertEqual(len(self.requests), 2)

    def test_wrong_private_metadata_never_matches_owner(self):
        for name in self.metadata:
            self.metadata[name] = False
            report = self.inspect()
            self.assertFalse(report["privateOwnerConnection"]["matchesConfiguredPrivateOwner"])
            self.assertFalse(report["privateOwnerConnection"]["ready"])
            self.metadata[name] = True

    def test_metadata_noise_and_partial_types_fail_closed(self):
        for value in (None, "invalid-json", json.dumps({**self.metadata, "secret": TOKEN}), json.dumps({**self.metadata, "private": 1})):
            def malformed(args, stdin=None):
                return value if stdin and stdin != INSPECTOR.MIGRATION_SQL else self.command(args, stdin)
            report = self.inspect(command=malformed)
            self.assertFalse(report["privateOwnerConnection"]["checked"])
            self.assertNotIn(TOKEN, json.dumps(report))

    def test_service_paths_emit_only_safe_categories(self):
        report = self.inspect()
        self.assertEqual(report["runtimeLayout"]["currentKind"], "directory")
        self.assertTrue(report["service"]["state"]["ExecStartExpected"])
        def unexpected(args, stdin=None):
            if stdin: return self.command(args, stdin)
            return "User=private-user\nGroup=private-group\nWorkingDirectory=/private-path\nExecStart={ path=/usr/bin/node ; argv[]=/usr/bin/node --import=" + TOKEN + " /opt/peerivo-notify/current/src/ru-core-server.js ; }\n"
        report = self.inspect(command=unexpected)
        self.assertFalse(report["service"]["state"]["ExecStartExpected"])
        for value in (TOKEN, "private-user", "private-group", "private-path"):
            self.assertNotIn(value, json.dumps(report))

    def test_failures_are_sanitized_and_unverified(self):
        def fail(*args, **kwargs): raise RuntimeError("Never export " + TOKEN + " " + OWNER)
        report = self.inspect(command=fail, request=fail)
        self.assertFalse(report["migrations"]["verifiedRead"])
        self.assertFalse(report["service"]["available"])
        self.assertFalse(report["privateOwnerConnection"]["checked"])
        for value in (TOKEN, OWNER): self.assertNotIn(value, json.dumps(report))

    def test_bad_or_excess_migration_rows_are_not_exported(self):
        for rows in ("private data\n", "0001_notify_core.sql\n" * 101, None):
            report = self.inspect(command=lambda args, stdin=None: rows if stdin else "")
            self.assertFalse(report["migrations"]["verifiedRead"])
            self.assertEqual(report["migrations"]["versions"], [])

    def test_environment_is_not_evaluated_and_duplicate_scope_refused(self):
        marker = self.root / "must-not-exist"
        self.write_env(NOTIFY_MENAION_TENANT_ID='"$(touch ' + str(marker) + ')"')
        self.assertFalse(self.inspect()["scopedProfile"]["scopeReferenceValid"])
        self.assertFalse(marker.exists())
        self.write_env()
        with self.env.open("a") as handle: handle.write("NOTIFY_MENAION_TENANT_ID=duplicate\n")
        self.assertFalse(self.inspect()["scopedProfile"]["readable"])

    def test_transport_refuses_credentials_connection_paths_hosts_and_redirects(self):
        for url, headers in ((INSPECTOR.LOOPBACK + "/health", {"Authorization": TOKEN}), (INSPECTOR.LOOPBACK + "/v1/telegram/connections/" + CONNECTION, None), ("https://example.com/steal", None)):
            self.assertEqual(INSPECTOR.http_json(url, headers), {"status": "refused"})
        self.assertIsNone(INSPECTOR.NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.com"))

    def test_runtime_reads_bounded_before_allocation(self):
        filename = self.runtime / "src/ru-core.js"
        with filename.open("wb") as handle: handle.truncate(8 * 1048576)
        tracemalloc.start()
        try:
            with self.assertRaises(ValueError): INSPECTOR.read_bounded(filename, 256)
            _, peak = tracemalloc.get_traced_memory()
        finally: tracemalloc.stop()
        self.assertLess(peak, 65536)
        self.assertFalse(next(item for item in self.inspect()["runtimeFiles"] if item["path"] == "src/ru-core.js")["present"])

    def test_symlinks_and_fifos_are_not_read(self):
        filename = self.runtime / "src/menaion-scope.js"
        filename.unlink()
        filename.symlink_to(self.env)
        self.assertFalse(next(item for item in self.inspect()["runtimeFiles"] if item["path"] == "src/menaion-scope.js")["present"])
        fifo = self.root / "fifo"
        os.mkfifo(fifo)
        with self.assertRaises(ValueError): INSPECTOR.read_bounded(fifo, 256)

    def test_workflow_unprivileged_tests_and_exact_manual_protected_run(self):
        workflow = (ROOT / ".github/workflows/inspect-notify-ru-core.yml").read_text()
        self.assertNotIn("\n  push:", workflow)
        self.assertNotIn("pull_request_target", workflow)
        for marker in ("INSPECT_NOTIFY_RU_CORE_READ_ONLY", 'test "$EXPECTED_SHA" = "$GITHUB_SHA"', "refs/heads/main", "StrictHostKeyChecking=yes", "'45.144.176.213'", "'supabase-deploy'", "'/usr/bin/python3 - --public-only' < scripts/inspect-notify-ru-core.py"):
            self.assertIn(marker, workflow)
        self.assertNotIn("sudo -", workflow)
        self.assertNotIn("--protected-metadata", workflow)
        validate, inspect = workflow.split("  inspect:\n", 1)
        self.assertNotIn("secrets.", validate)
        self.assertIn("environment: production", inspect)
        self.assertNotIn("REG_RU_SSH_KEY", workflow)


if __name__ == "__main__":
    unittest.main()
