import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("inspector", Path(__file__).parents[1] / "scripts/inspect-beget-auth-mail.py")
inspector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(inspector)


class InspectionTests(unittest.TestCase):
    def test_runtime_config_reports_mismatch_without_exposing_values(self):
        env = dict(inspector.EXPECTED, GOTRUE_SMTP_PASS="dummy-secret", GOTRUE_SMTP_PORT="465")
        env["GOTRUE_MAILER_TEMPLATES_MAGIC_LINK"] = "https://" + inspector.LEGACY_HOST + "/private?token=dummy-token"
        result = inspector.config_report(env, "different-secret")
        self.assertFalse(result["smtp_password_matches_protected_resend_key"])
        self.assertEqual(result["legacy_host_fields"], ["GOTRUE_MAILER_TEMPLATES_MAGIC_LINK"])
        serialized = json.dumps(result)
        for forbidden in ("dummy-secret", "different-secret", "dummy-token", "/private?"):
            self.assertNotIn(forbidden, serialized)

    def test_checks_verify_path_as_well_as_base_url(self):
        env = dict(inspector.EXPECTED)
        self.assertFalse(all(inspector.config_report(env, "")["token_endpoint_checks"].values()))
        env.update({key: "/auth/v1/verify" for key in inspector.TOKEN_PATHS})
        self.assertTrue(all(inspector.config_report(env, "")["token_endpoint_checks"].values()))
        env[inspector.TOKEN_PATHS[0]] = "https://" + inspector.LEGACY_HOST + "/auth/v1/verify"
        self.assertFalse(inspector.config_report(env, "")["token_endpoint_checks"][inspector.TOKEN_PATHS[0]])

    def test_old_pooler_reference_is_found_without_returning_dsn(self):
        dsn = "postgresql://postgres." + inspector.LEGACY_PROJECT_REF + ":dummy-password@pooler.supabase.com/postgres"
        result = inspector.config_report({"GOTRUE_DB_DATABASE_URL": dsn}, "")
        self.assertEqual(result["legacy_host_fields"], ["GOTRUE_DB_DATABASE_URL"])
        self.assertNotIn(dsn, json.dumps(result))
        self.assertNotIn("dummy-password", json.dumps(result))

    def test_unknown_hook_value_is_not_printed(self):
        self.assertEqual(inspector.config_report({"GOTRUE_HOOK_SEND_EMAIL_ENABLED": "dummy-secret"}, "")["send_email_hook_enabled"], "unknown")

    def test_ambiguous_runtime_environment_fails_closed(self):
        for values in (["SMTP_PASS=a", "SMTP_PASS=b"], ["INVALID"]):
            with self.assertRaises(inspector.InspectionError):
                inspector.environment({"Config": {"Env": values}})

    def test_log_report_is_only_fixed_counts(self):
        log = 'smtp authentication failed: 535 dummy-secret user@example.com token=dummy-token\ndial tcp timeout\nSQLSTATE 42501'
        result = inspector.log_categories(log)
        self.assertEqual(result["authentication_rejected"], 1)
        self.assertEqual(result["network_timeout"], 1)
        self.assertEqual(result["database_error"], 1)
        for value in ("dummy-secret", "user@example.com", "dummy-token"):
            self.assertNotIn(value, json.dumps(result))

    def test_sql_uses_read_only_transaction_and_bounded_timeouts(self):
        with patch.object(inspector, "run", return_value="0") as run:
            inspector.read_sql({"Id": "db-test"}, "SELECT count(*) FROM auth.users;")
        args, kwargs = run.call_args
        self.assertIn("-X", args[0])
        self.assertIn("ON_ERROR_STOP=1", args[0])
        self.assertTrue(kwargs["data"].startswith("BEGIN READ ONLY;"))
        self.assertIn("statement_timeout = '5s'", kwargs["data"])
        self.assertTrue(kwargs["data"].endswith("ROLLBACK;\n"))

    def test_partial_database_scan_is_not_reported_as_absent(self):
        values = ['{}', '[["auth","users"],["public","help_requests"]]',
                  '{"rows_examined":10001,"matching_rows":0,"truncated":true}',
                  inspector.InspectionError("secret-internal-diagnostic")]
        with patch.object(inspector, "read_sql", side_effect=values), contextlib.redirect_stdout(io.StringIO()) as output:
            inspector.database_search({"Id": "test"})
        reports = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertFalse(reports[-1]["result"]["complete_within_scope"])
        self.assertNotIn("secret-internal-diagnostic", output.getvalue())

    def test_probe_uses_auth_network_namespace_and_no_secret_argument(self):
        with patch.object(inspector, "run", return_value='{"status":"authenticated","extra":"sensitive"}') as run:
            result = inspector.smtp_probe({"Id": "auth-test"}, {"Image": "sha256:" + "a" * 64},
                                          "dummy-secret", "465", Path(__file__).parents[1] / "scripts/probe-resend-smtp.mjs")
        args, kwargs = run.call_args
        self.assertIn("container:auth-test", args[0])
        self.assertIn("--read-only", args[0])
        self.assertIn("never", args[0])
        self.assertNotIn("dummy-secret", " ".join(args[0]))
        self.assertEqual(json.loads(kwargs["data"])["password"], "dummy-secret")
        self.assertEqual(result, {"status": "authenticated"})

    def test_arbitrary_probe_error_is_not_logged(self):
        with patch.object(inspector, "run", return_value='{"status":"dummy-secret"}'):
            result = inspector.smtp_probe({"Id": "auth-test"}, {"Image": "sha256:" + "a" * 64},
                                          "dummy-secret", "465", Path(__file__).parents[1] / "scripts/probe-resend-smtp.mjs")
        self.assertEqual(result, {"status": "invalid_probe_response"})


if __name__ == "__main__":
    unittest.main()
