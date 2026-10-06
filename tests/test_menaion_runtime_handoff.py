"""Offline fail-closed tests. No production, Docker daemon, or credentials used."""
import contextlib
import copy
import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "inspect-menaion-runtime-handoff.py"
spec = importlib.util.spec_from_file_location("handoff", SCRIPT)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
SENTINEL = "DO-NOT-PRINT-SYNTHETIC-SECRET"


def fixture():
    env = ["PGRST_DB_URI=postgres://authenticator:synthetic@db:5432/living_menaion",
           "PGRST_DB_SCHEMAS=living_menaion", "PGRST_JWT_SECRET=" + SENTINEL]
    host = {key: copy.deepcopy(values[0]) for key, values in m.HOST_DEFAULTS.items() if values}
    host.update({"NetworkMode": "stack_default", "RestartPolicy": {"Name": "unless-stopped", "MaximumRetryCount": 0},
                 "LogConfig": {"Type": "json-file", "Config": {}}, "MaskedPaths": m.STANDARD_MASKED[:],
                 "ReadonlyPaths": m.STANDARD_READONLY[:]})
    rest = {"Name": "/living-menaion-rest", "Image": "sha256:" + "1" * 64,
            "State": {"Running": True}, "Mounts": [], "HostConfig": host,
            "Config": {"Env": env, "Entrypoint": ["postgrest"], "Cmd": [], "User": "1000",
                       "Tty": False, "OpenStdin": False, "StdinOnce": False,
                       "AttachStdout": False, "AttachStderr": False},
            "NetworkSettings": {"Networks": {"stack_default": {"IPAddress": "172.18.0.10", "Aliases": ["living-menaion-rest"]}}}}
    db = {"Name": "/supabase-db", "State": {"Running": True},
          "Config": {"Labels": {"com.docker.compose.project": "stack"}},
          "NetworkSettings": {"Networks": {"stack_default": {"Aliases": ["db", "supabase-db"]}}}}
    image = {"Id": rest["Image"], "Config": {"Env": [], "Entrypoint": ["postgrest"], "Cmd": [], "User": "1000"}}
    return rest, db, image, m.env_map(env)


def db_fixture(raw=False):
    data = {key: True for key in m.DB_FIELDS}
    data["credential_logging_observations"] = {key: True for key in m.LOG_FIELDS}
    data["preload_inventory"] = {**{key: False for key in m.PRELOAD_MODULES}, "unknown_count": 0}
    if raw:
        del data["migration_history_exact"]
        data["migration_history"] = [{"version": v, "checksum": c} for v, c in m.FEEDBACK_HISTORY]
    return data


class EnvironmentTests(unittest.TestCase):
    def test_environment_preserves_values_without_printing(self):
        self.assertEqual(m.env_map(["A=a=b"]), {"A": "a=b"})

    def test_file_blank_lines_comments_and_crlf_are_accepted_only_for_file(self):
        text = "# comment\n\n   # indented comment\r\nA=synthetic # literal  \r\n \t\n\n"
        self.assertEqual(m.env_file_map(text), {"A": "synthetic # literal  "})
        self.assertEqual(m.env_file_map("A=x\n\n"), {"A": "x"})
        for runtime in (["A=x", ""], ["# comment", "A=x"]):
            with self.assertRaises(m.Refused):
                m.env_map(runtime)

    def test_file_duplicate_keys_and_bare_imports_remain_rejected(self):
        for text in ("A=x\n# ignored\nA=y\n", "A\n", "A=x\x00\n"):
            with self.assertRaises(m.Refused):
                m.env_file_map(text)

    def test_private_file_with_provisioner_trailing_blank_line(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "postgrest.env"
            path.write_text("# comment\nA=synthetic\n\n")
            path.chmod(0o600)
            self.assertEqual(m.read_private_env(path), {"A": "synthetic"})

    def test_environment_rejects_ambiguous_inputs(self):
        for value in (None, {}, ["A=x", "A=y"], ["A"], ["A=one\ntwo"], ["A=bad\x00"], ["A=bad\r"], ["9BAD=x"], [False]):
            with self.subTest(value=value), self.assertRaises(m.Refused):
                m.env_map(value)

    def test_private_environment_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "postgrest.env"
            path.write_text("A=synthetic\n")
            path.chmod(0o600)
            self.assertEqual(m.read_private_env(path), {"A": "synthetic"})
            path.chmod(0o644)
            with self.assertRaises(m.Refused):
                m.read_private_env(path)

    def test_symlinks_and_hardlinks_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "target"
            target.write_text("A=synthetic\n")
            target.chmod(0o600)
            link = Path(directory) / "postgrest.env"
            link.symlink_to(target)
            with self.assertRaises(OSError):
                m.read_private_env(link)
            link.unlink()
            os.link(target, link)
            with self.assertRaises(m.Refused):
                m.read_private_env(link)

    def test_nonprivate_directory_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "postgrest.env"
            path.write_text("A=synthetic\n")
            path.chmod(0o600)
            Path(directory).chmod(0o755)
            with self.assertRaises(m.Refused):
                m.read_private_env(path)


class RuntimeTests(unittest.TestCase):
    def test_actual_db_alias_is_accepted_without_guessing_supabase_hostname(self):
        facts = m.runtime_facts(*fixture())
        self.assertTrue(facts["database_host_matches_db_network_alias"])
        self.assertTrue(facts["compatible_known_host_settings"])
        self.assertTrue(facts["image_default_fields_match"])
        self.assertTrue(facts["env_file_matches_effective_docker_env"])
        self.assertNotIn(SENTINEL, json.dumps(facts))
        self.assertNotIn("postgres://", json.dumps(facts))

    def test_other_host_and_queries_fail_closed(self):
        for uri in ("postgres://authenticator:x@unknown:5432/living_menaion",
                    "postgres://authenticator:x@db:6543/living_menaion",
                    "postgres://authenticator:x@db:5432/living_menaion?options=x",
                    "postgres://authenticator:x@db:5432/living_menaion#x",
                    "postgres://authenticator:x@db:5432/living_menaion\n",
                    "postgres://authenticator:%xx@db:5432/living_menaion",
                    "postgres://authenticator:x@db:wrong/living_menaion"):
            with self.subTest(uri=uri):
                self.assertFalse(m.uri_facts(uri, ["db"])["database_host_matches_db_network_alias"])

    def test_image_defaults_and_env_file_drift_detected(self):
        rest, db, image, env = fixture()
        rest["Config"]["Cmd"] = ["unexpected-config.toml"]
        env["PGRST_JWT_SECRET"] = "drift"
        facts = m.runtime_facts(rest, db, image, env)
        self.assertFalse(facts["image_default_fields_match"])
        self.assertFalse(facts["env_file_matches_effective_docker_env"])
        self.assertEqual(facts["image_default_field_differences"], ["Cmd"])

    def test_host_ambiguity_and_unknown_fields_are_not_silently_accepted(self):
        rest, db, image, env = fixture()
        rest["HostConfig"]["Privileged"] = 0  # False-like wrong type.
        rest["HostConfig"][SENTINEL] = SENTINEL
        del rest["HostConfig"]["LogConfig"]
        facts = m.runtime_facts(rest, db, image, env)
        self.assertFalse(facts["compatible_known_host_settings"])
        self.assertEqual(facts["unreviewed_host_field_count"], 1)
        self.assertNotIn(SENTINEL, json.dumps(facts))

    def test_bad_network_and_mounts_reported(self):
        rest, db, image, env = fixture()
        rest["NetworkSettings"]["Networks"]["unexpected"] = {}
        rest["Mounts"] = [{"Source": SENTINEL}]
        facts = m.runtime_facts(rest, db, image, env)
        self.assertFalse(facts["single_expected_network"])
        self.assertFalse(facts["container_has_no_mounts"])
        self.assertNotIn(SENTINEL, json.dumps(facts))

    def test_ip_rejects_public_local_and_malformed_values(self):
        for ip in ("8.8.8.8", "127.0.0.1", "169.254.1.1", "0.0.0.0", "::1", "172.18.1.2:3000", None):
            self.assertFalse(m.private_ip(ip))


class BoundaryTests(unittest.TestCase):
    def test_exact_history_matches_pinned_transport_contract(self):
        manifest = (SCRIPT.parents[1] / "ops/living-menaion/moderation-predecessors.json").read_bytes()
        self.assertEqual(hashlib.sha256(manifest).hexdigest(), "613887b5920dcffae6cad1db2b107ba0f8e366ae8c21f809a0b31f7d2fbf91a6")
        rows = json.loads(manifest)
        self.assertTrue(m.approved_migration_history(rows))
        ten = rows + [{"version": "20261005073345", "checksum": "ee2bf27553ca0a71baa275ad607b7ddbf0893e9e64d5687d8029d94bf592b499"}]
        self.assertTrue(m.approved_migration_history(ten))
        for history in (rows, ten):
            data = db_fixture(raw=True)
            data["migration_history"] = history
            result = m.validate_db_facts(data)
            self.assertTrue(result["migration_history_exact"])
            self.assertNotIn("migration_history", result)
            self.assertEqual(data["migration_history"], history)

    def test_history_rejects_every_missing_changed_duplicate_or_extra_row(self):
        nine = db_fixture(raw=True)["migration_history"]
        ten = nine + [{"version": "20261005073345", "checksum": "ee2bf27553ca0a71baa275ad607b7ddbf0893e9e64d5687d8029d94bf592b499"}]
        for history in (nine, ten):
            invalid = [None, False, True, {}, tuple(history), [], list(reversed(history)),
                       history + [{"version": "20261006123456", "checksum": "a" * 64}]]
            for index in range(len(history)):
                invalid.extend([history[:index] + history[index+1:], history[:index] + [history[index]] + history[index:]])
                for field in ("version", "checksum"):
                    for value in (None, False, True, 0, 1, "", " " + history[index][field], history[index][field] + " "):
                        changed = copy.deepcopy(history)
                        changed[index][field] = value
                        invalid.append(changed)
                    # Generated adversarial coverage: change every digest character.
                    if field == "checksum":
                        for offset, char in enumerate(history[index][field]):
                            changed = copy.deepcopy(history)
                            changed[index][field] = history[index][field][:offset] + ("1" if char != "1" else "0") + history[index][field][offset+1:]
                            invalid.append(changed)
                changed = copy.deepcopy(history); changed[index]["extra"] = True; invalid.append(changed)
            for value in invalid:
                # Removing the single approved tenth row returns the approved nine.
                if value == nine:
                    continue
                with self.subTest(history_length=len(history), case=str(value)[:100]):
                    self.assertFalse(m.approved_migration_history(value))
                    data = db_fixture(raw=True); data["migration_history"] = value
                    result = m.validate_db_facts(data)
                    self.assertIs(result["migration_history_exact"], False)
                    self.assertNotIn("migration_history", result)

    def test_database_schema_requires_exact_booleans(self):
        self.assertEqual(m.validate_db_facts(db_fixture(raw=True)), db_fixture())
        for bad in (None, 0, 1, "true", [], {}):
            data = db_fixture(raw=True)
            data["roles_safe"] = bad
            with self.assertRaises(m.Refused):
                m.validate_db_facts(data)
        data = db_fixture(raw=True)
        data[SENTINEL] = True
        with self.assertRaises(m.Refused):
            m.validate_db_facts(data)
        data = db_fixture(raw=True)
        data["credential_logging_observations"]["pgaudit_logging_disabled"] = "true"
        with self.assertRaises(m.Refused):
            m.validate_db_facts(data)

    def test_preload_inventory_cannot_export_arbitrary_names_or_accept_ambiguous_counts(self):
        for bad in (True, "0", -1, None, 1001):
            data = db_fixture(raw=True)
            data["preload_inventory"]["unknown_count"] = bad
            with self.assertRaises(m.Refused):
                m.validate_db_facts(data)
        data = db_fixture(raw=True)
        data["preload_inventory"][SENTINEL] = True
        with self.assertRaises(m.Refused):
            m.validate_db_facts(data)

    def test_json_duplicates_and_nonfinite_rejected(self):
        for raw in (b'{"x":true,"x":false}', b'{"x":NaN}', b'{"x":Infinity}', b'{'):
            with self.assertRaises(m.Refused):
                m.decode_json(raw)

    def test_activation_refused_without_reading_stdin_or_running_any_commands(self):
        for argv in (["--activate"], ["--activate", SENTINEL], ["--inspect", SENTINEL], []):
            stdout = io.StringIO()
            with patch.object(m, "run_inspection") as inspect, patch("sys.stdin") as stdin, contextlib.redirect_stdout(stdout):
                self.assertEqual(m.main(argv), 2)
                inspect.assert_not_called()
                stdin.read.assert_not_called()
                self.assertNotIn(SENTINEL, stdout.getvalue())

    def test_failure_never_prints_raw_exception_or_command_output(self):
        stdout = io.StringIO()
        stderr = io.StringIO()
        with patch.object(m, "run_inspection", side_effect=ValueError(SENTINEL)), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            self.assertEqual(m.main(["--inspect"]), 1)
        self.assertNotIn(SENTINEL, stdout.getvalue() + stderr.getvalue())
        self.assertNotIn("Traceback", stderr.getvalue())

    def test_failure_reports_only_fixed_stage_enum(self):
        rest, db, image, env = fixture()
        cases = [
            ("docker_rest", [ValueError(SENTINEL)], None),
            ("docker_db", [rest, ValueError(SENTINEL)], None),
            ("image", [rest, db, ValueError(SENTINEL)], None),
            ("private_env", [rest, db, image], "read_private_env"),
            ("runtime_facts", [rest, db, image], "runtime_facts"),
            ("database_facts", [rest, db, image], "database_facts"),
        ]
        for expected, inspection_results, fail_function in cases:
            stdout = io.StringIO()
            with self.subTest(stage=expected), contextlib.ExitStack() as stack:
                stack.enter_context(patch.object(m, "inspect_one", side_effect=inspection_results))
                stack.enter_context(patch.object(m, "read_private_env", return_value=env))
                stack.enter_context(patch.object(m, "database_facts", return_value=db_fixture()))
                if fail_function:
                    stack.enter_context(patch.object(m, fail_function, side_effect=ValueError(SENTINEL)))
                stack.enter_context(contextlib.redirect_stdout(stdout))
                self.assertEqual(m.main(["--inspect"]), 1)
            report = json.loads(stdout.getvalue())
            self.assertEqual(report["failed_stage"], expected)
            self.assertNotIn(SENTINEL, stdout.getvalue())

    def test_invalid_stage_cannot_leak_exception_content(self):
        stdout = io.StringIO()
        failure = m.StageRefused(SENTINEL)
        failure.stage = SENTINEL
        with patch.object(m, "run_inspection", side_effect=failure), contextlib.redirect_stdout(stdout):
            self.assertEqual(m.main(["--inspect"]), 1)
        self.assertEqual(json.loads(stdout.getvalue())["failed_stage"], "unclassified")
        self.assertNotIn(SENTINEL, stdout.getvalue())

    def test_authored_reason_is_bounded_and_distinguishes_file_failures(self):
        for reason, expected in (("directory mode mismatch", "private_directory_mode_not_0700"),
                                 ("directory owner mismatch", "private_directory_owner_mismatch"),
                                 ("environment mode mismatch", "environment_mode_not_0600"),
                                 ("environment owner mismatch", "environment_owner_mismatch"),
                                 ("environment hardlink", "environment_hardlink_rejected"),
                                 (SENTINEL, "unclassified")):
            failure = m.Refused(reason)
            self.assertEqual(m.safe_reason(failure), expected)
            self.assertNotIn(SENTINEL, str(failure))
        failure = m.StageRefused("private_env", "environment_mode_not_0600")
        stdout = io.StringIO()
        with patch.object(m, "run_inspection", side_effect=failure), contextlib.redirect_stdout(stdout):
            self.assertEqual(m.main(["--inspect"]), 1)
        self.assertEqual(json.loads(stdout.getvalue())["reason_code"], "environment_mode_not_0600")
        failure.reason_code = SENTINEL
        self.assertEqual(m.safe_reason(failure), "unclassified")

    def test_operating_system_error_never_discloses_filename(self):
        error = FileNotFoundError(m.errno.ENOENT, SENTINEL, SENTINEL)
        self.assertEqual(m.safe_reason(error), "required_path_missing")
        self.assertEqual(m.safe_reason(OSError(m.errno.ELOOP, SENTINEL)), "symlink_rejected")

    def test_command_discards_stderr_and_stdin(self):
        completed = subprocess.CompletedProcess(["docker"], 0, b'{}')
        with patch("subprocess.run", return_value=completed) as run, patch.dict(os.environ, {}, clear=True):
            self.assertEqual(m.command(["docker", "inspect", "living-menaion-rest"]), b'{}')
            self.assertEqual(run.call_args.args[0][:3], ["docker", "--host", "unix:///var/run/docker.sock"])
            kwargs = run.call_args.kwargs
            self.assertIs(kwargs["stderr"], subprocess.DEVNULL)
            self.assertIs(kwargs["stdin"], subprocess.DEVNULL)
            self.assertEqual(kwargs["env"], {"PATH": "/usr/bin:/bin", "LC_ALL": "C"})

    def test_remote_docker_override_refused(self):
        with patch.dict(os.environ, {"DOCKER_HOST": "tcp://unapproved"}, clear=True), patch("subprocess.run") as run:
            with self.assertRaises(m.Refused):
                m.command(["docker", "inspect", "living-menaion-rest"])
            run.assert_not_called()

    def test_database_query_is_read_only_and_does_not_extract_passwords(self):
        sql = m.DB_SQL.lower()
        self.assertIn("begin read only;", sql)
        self.assertIn("rollback;", sql)
        self.assertIn("rolpassword is null", sql)
        for forbidden in ("alter role", "create role", "update ", "delete ", "insert ", "select rolpassword", "jwt_secret"):
            self.assertNotIn(forbidden, sql)
        self.assertIn(m.MIGRATION_SHA, sql)

    def test_successful_inspection_never_authorizes_activation(self):
        rest, db, image, env = fixture()
        with patch.object(m, "inspect_one", side_effect=[rest, db, image]), patch.object(m, "read_private_env", return_value=env), patch.object(m, "database_facts", return_value=db_fixture()):
            report = m.run_inspection()
        self.assertFalse(report["activation_ready"])
        self.assertFalse(report["activation_implemented"])
        self.assertFalse(report["credential_logging_safety_proven"])
        self.assertFalse(report["exact_runtime_replacement_proven"])
        self.assertTrue(report["read_only"])
        self.assertIsNone(report["existing_service_role_zero_row_probe_passed"])
        self.assertEqual(report["existing_service_role_probe_status"], "not_performed_no_credential_access")
        self.assertNotIn(SENTINEL, json.dumps(report))


if __name__ == "__main__":
    unittest.main()
