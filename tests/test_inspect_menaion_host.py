import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("probe", Path(__file__).parents[1] / "scripts/inspect-menaion-host.py")
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class InspectionSafety(unittest.TestCase):
    def test_invalid_role_never_executes_commands(self):
        for args in ([], ["beget; reboot"], ["beget", "reg-ru"], [""], ["postgres"]):
            with patch.object(probe, "command") as command, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(probe.main(args), 2)
                command.assert_not_called()

    def test_failed_probe_cannot_claim_complete_or_leak_stderr(self):
        with patch.object(probe, "memory", side_effect=RuntimeError("SECRET_VALUE")), \
             patch.object(probe, "containers", return_value=[]):
            result = probe.inspect("reg-ru")
        self.assertFalse(result["inspection_complete"])
        self.assertFalse(result["deployment_ready"])
        self.assertNotIn("SECRET_VALUE", json.dumps(result))

    def test_successful_inventory_is_never_deployment_approval(self):
        with patch.object(probe, "memory", return_value={"MemAvailable": 123}), \
             patch.object(probe, "containers", return_value=[]):
            result = probe.inspect("reg-ru")
        self.assertTrue(result["inspection_complete"])
        self.assertFalse(result["deployment_ready"])

    def test_docker_output_allowlist_omits_command_labels_and_mounts(self):
        row = {"Names": "supabase-db", "State": "running", "Command": "SECRET", "Labels": "SECRET", "Mounts": "SECRET"}
        with patch.object(probe, "command", return_value=json.dumps(row)):
            self.assertEqual(probe.containers(), [{"name": "supabase-db", "running": True}])

    def test_database_session_is_read_only_and_target_is_fixed(self):
        row = dict(server_version="17.6", database_name="postgres", target_database_exists=False,
                   target_owner_exists=False, mercy_database_bytes=10, connection_limit=100, active_connections=2)
        with patch.object(probe, "command", return_value=json.dumps(row)) as command:
            probe.database()
        argv = command.call_args.args[0]
        self.assertIn("PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000", argv)
        self.assertIn("-X", argv)
        self.assertIn("living_menaion", argv[-1])
        row["target_database_exists"] = "false"
        with patch.object(probe, "command", return_value=json.dumps(row)):
            with self.assertRaises(probe.ProbeFailed):
                probe.database()

    def test_subprocess_cannot_inherit_credentials_or_return_raw_errors(self):
        with patch.dict(probe.os.environ, {"PGPASSWORD": "SECRET", "DATABASE_URL": "SECRET"}), \
             patch.object(probe.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "", "SECRET")) as run:
            with self.assertRaises(probe.ProbeFailed) as error:
                probe.command(["docker", "ps"])
        self.assertNotIn("SECRET", str(error.exception))
        self.assertNotIn("PGPASSWORD", run.call_args.kwargs["env"])
        self.assertNotIn("DATABASE_URL", run.call_args.kwargs["env"])
        self.assertFalse(run.call_args.kwargs.get("shell", False))


if __name__ == "__main__":
    unittest.main()
