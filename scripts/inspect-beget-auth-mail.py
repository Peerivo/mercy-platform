#!/usr/bin/env python3
"""Bounded, read-only Auth/mail inspection. Never print runtime values or errors."""

import argparse
import hmac
import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urljoin


LEGACY_PROJECT_REF = "kjhrtxrqvlhfjiopchhr"
LEGACY_HOST = LEGACY_PROJECT_REF + ".supabase.co"
EXPECTED = {
    "API_EXTERNAL_URL": "https://api.mercy.peerivo.net/auth/v1",
    "GOTRUE_SITE_URL": "https://mercy.peerivo.net",
    "GOTRUE_URI_ALLOW_LIST": "https://mercy.peerivo.net/auth/callback",
    "GOTRUE_JWT_ISSUER": "https://api.mercy.peerivo.net/auth/v1",
    "GOTRUE_SMTP_HOST": "smtp.resend.com",
    "GOTRUE_SMTP_USER": "resend",
    "GOTRUE_SMTP_ADMIN_EMAIL": "no-reply@mercy.peerivo.net",
    "GOTRUE_SMTP_SENDER_NAME": "Peerivo. Язык Милосердия",
}
TOKEN_PATHS = (
    "GOTRUE_MAILER_URLPATHS_CONFIRMATION",
    "GOTRUE_MAILER_URLPATHS_INVITE",
    "GOTRUE_MAILER_URLPATHS_RECOVERY",
    "GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE",
)
SAFE_NAME = re.compile(r"[a-zA-Z_][a-zA-Z_0-9]{0,127}\Z")


class InspectionError(Exception):
    pass


def run(args, *, data=None, timeout=30):
    try:
        result = subprocess.run(args, input=data, text=True, capture_output=True,
                                timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise InspectionError("command_unavailable_or_timeout") from None
    if result.returncode:
        raise InspectionError("command_failed")
    return result.stdout


def emit(section, result):
    print(json.dumps({"section": section, "result": result}, sort_keys=True), flush=True)


def container(cid):
    data = json.loads(run(["docker", "inspect", cid]))
    if len(data) != 1:
        raise InspectionError("container_not_unique")
    return data[0]


def environment(info):
    pairs = [value.split("=", 1) for value in info["Config"]["Env"]]
    if any(len(pair) != 2 for pair in pairs) or len({p[0] for p in pairs}) != len(pairs):
        raise InspectionError("ambiguous_environment")
    return dict(pairs)


def services(project):
    ids = run(["docker", "ps", "-aq", "--no-trunc", "--filter",
               "label=com.docker.compose.project=" + project]).splitlines()
    result = {}
    for cid in ids:
        info = container(cid)
        name = info["Config"]["Labels"].get("com.docker.compose.service")
        if name in ("auth", "db", "storage", "rest", "realtime", "kong"):
            if name in result:
                raise InspectionError("service_not_unique")
            result[name] = info
    if not {"auth", "db", "storage", "rest", "realtime", "kong"} <= result.keys():
        raise InspectionError("required_service_missing")
    return result


def config_report(env, protected_key):
    states = {key: ("match" if env.get(key) == value else
                    "missing" if not env.get(key) else "different")
              for key, value in EXPECTED.items()}
    states["GOTRUE_SMTP_PORT"] = ("supported" if env.get("GOTRUE_SMTP_PORT")
                                  in ("465", "587", "2465", "2587") else "different_or_missing")
    password = env.get("GOTRUE_SMTP_PASS", "")
    states["smtp_password_present"] = bool(password)
    states["smtp_password_matches_protected_resend_key"] = bool(password and protected_key) and hmac.compare_digest(password, protected_key)
    states["protected_resend_key_present"] = bool(protected_key)
    host = env.get("GOTRUE_SMTP_HOST", "")
    states["smtp_host_class"] = ("resend" if host == "smtp.resend.com" else
                                 "local_mail_sink" if host in ("inbucket", "supabase-inbucket", "localhost", "127.0.0.1") else
                                 "other" if host else "missing")
    for key in ("GOTRUE_EXTERNAL_EMAIL_ENABLED", "GOTRUE_MAILER_AUTOCONFIRM", "GOTRUE_DISABLE_SIGNUP"):
        states[key] = env[key] if env.get(key) in ("true", "false") else "missing_or_unknown"
    # Return field names, never arbitrary values (which may include credentials).
    states["legacy_host_fields"] = sorted(key for key, value in env.items()
                                           if SAFE_NAME.fullmatch(key) and LEGACY_PROJECT_REF in value)
    states["custom_mail_template_fields"] = sorted(key for key, value in env.items()
                                                  if key.startswith("GOTRUE_MAILER_TEMPLATES_")
                                                  and SAFE_NAME.fullmatch(key) and value)
    states["send_email_hook_enabled"] = env.get("GOTRUE_HOOK_SEND_EMAIL_ENABLED", "false")
    if states["send_email_hook_enabled"] not in ("true", "false"):
        states["send_email_hook_enabled"] = "unknown"
    states["token_endpoint_checks"] = {
        key: urljoin(env.get("API_EXTERNAL_URL", ""), env.get(key) or "/verify")
        == "https://api.mercy.peerivo.net/auth/v1/verify"
        for key in TOKEN_PATHS
    }
    states["token_checks_are_config_only"] = True
    return states


def log_categories(raw):
    # No log line, email, token, hostname, key or exception text leaves this function.
    patterns = {
        "smtp_related": r"smtp|mailer|sending (?:confirmation|magic link|recovery) email",
        "authentication_rejected": r"authentication failed|invalid credentials|535 |534 ",
        "connection_refused": r"connection refused",
        "network_timeout": r"timeout|deadline exceeded",
        "dns_failure": r"no such host|name resolution",
        "tls_failure": r"x509|tls handshake|certificate verify",
        "rate_limit": r"rate.limit|too many requests",
        "database_error": r"database error|SQLSTATE|permission denied for",
    }
    return {name: sum(bool(re.search(pattern, line, re.I)) for line in raw.splitlines())
            for name, pattern in patterns.items()}


def smtp_probe(auth, storage, password, port, probe_path):
    if not password:
        return {"status": "skipped_missing_password"}
    if port not in ("465", "587", "2465", "2587"):
        return {"status": "skipped_unsupported_port"}
    image = storage["Image"]
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", image):
        raise InspectionError("invalid_local_image_id")
    # Reuse the installed Storage Node runtime, in Auth's actual network namespace.
    # No image pull, port publication, volume mounts, production restart or email.
    args = ["docker", "run", "--rm", "-i", "--pull", "never", "--read-only",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--user", "65534:65534", "--memory", "128m", "--cpus", "0.25",
            "--pids-limit", "32", "--network", "container:" + auth["Id"],
            "--entrypoint", "node", image, "--input-type=module", "-e", probe_path.read_text()]
    try:
        response = json.loads(run(args, data=json.dumps({"password": password, "port": int(port)}), timeout=45))
    except (InspectionError, ValueError):
        return {"status": "probe_unavailable"}
    allowed = {"authenticated", "authentication_rejected", "tls_failed", "network_failed",
               "timeout", "protocol_error", "invalid_input"}
    if not isinstance(response, dict) or response.get("status") not in allowed:
        return {"status": "invalid_probe_response"}
    return {"status": response["status"]}


def read_sql(db, query):
    sql = "BEGIN READ ONLY; SET LOCAL statement_timeout = '5s'; SET LOCAL lock_timeout = '1s';\n" + query + "\nROLLBACK;\n"
    return run(["docker", "exec", "-i", db["Id"], "psql", "-X", "-qAt",
                "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin", "-d", "postgres"],
               data=sql, timeout=12).strip()


def database_search(db):
    # Pooler DSNs carry the old ref in the username instead of the hostname.
    needle = "'%" + LEGACY_PROJECT_REF + "%'"
    catalog_query = f"""SELECT json_build_object(
      'database_role_settings', (SELECT count(*) FROM pg_db_role_setting, unnest(setconfig) AS value WHERE value LIKE {needle}),
      'session_settings', (SELECT count(*) FROM pg_settings WHERE setting LIKE {needle}),
      'function_definitions', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth') AND p.prosrc LIKE {needle}),
      'column_defaults', (SELECT count(*) FROM pg_attrdef d JOIN pg_class c ON c.oid=d.adrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth') AND pg_get_expr(d.adbin,d.adrelid) LIKE {needle})
    );"""
    emit("legacy_url_catalog_counts", json.loads(read_sql(db, catalog_query)))
    tables = json.loads(read_sql(db, """SELECT coalesce(json_agg(json_build_array(n.nspname,c.relname) ORDER BY n.nspname,c.relname),'[]')
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('auth','public') AND c.relkind IN ('r','p') AND NOT c.relispartition;"""))
    # Any bound/error must remain visible; a partial search is never reported as absent.
    incomplete = len(tables) > 64
    for schema, table in tables[:64]:
        if schema not in ("auth", "public") or not SAFE_NAME.fullmatch(table):
            incomplete = True
            continue
        query = f"""WITH sample AS MATERIALIZED (SELECT * FROM "{schema}"."{table}" LIMIT 10001)
          SELECT json_build_object('rows_examined',count(*),'matching_rows',count(*) FILTER (WHERE to_jsonb(sample)::text LIKE {needle}), 'truncated',count(*)=10001) FROM sample;"""
        try:
            result = json.loads(read_sql(db, query))
            incomplete = incomplete or result["truncated"]
        except (InspectionError, ValueError):
            result = {"status": "unverified_query_failed_or_timed_out"}
            incomplete = True
        emit("legacy_url_table:" + schema + "." + table, result)
    emit("legacy_url_search", {"complete_within_scope": not incomplete,
                             "scope": "auth/public tables; database role settings; session settings; auth/public function bodies and column defaults",
                             "excluded_catalog_definitions": ["views", "materialized_views", "rls_policies", "trigger_expressions"],
                             "historical_matches_are_not_active_configuration": True})


def stable_services(before, after):
    for name, info in before.items():
        current = after.get(name, {})
        if any(current.get(key) != info.get(key) for key in ("Id", "Config", "RestartCount")):
            return False
        if any(current.get("State", {}).get(key) != info.get("State", {}).get(key)
               for key in ("StartedAt", "FinishedAt", "Running", "Restarting")):
            return False
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--search-database", action="store_true")
    args = parser.parse_args()
    payload = json.loads(sys.stdin.read(8192))
    protected_key = payload.get("resend_api_key", "")
    if not isinstance(protected_key, str) or len(protected_key) > 1024:
        raise InspectionError("invalid_protected_key_input")
    db = container("supabase-db")
    project = db["Config"]["Labels"].get("com.docker.compose.project", "")
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", project):
        raise InspectionError("invalid_compose_project")
    before = services(project)
    auth = before["auth"]
    env = environment(auth)
    emit("auth_configuration", config_report(env, protected_key))
    logs = subprocess.run(["docker", "logs", "--since", "48h", "--tail", "200", auth["Id"]], capture_output=True, text=True, timeout=15)
    if logs.returncode:
        emit("auth_logs", {"status": "unavailable"})
    else:
        emit("auth_log_categories_last_200_lines_48h", log_categories(logs.stdout + logs.stderr))
    probe_path = Path(__file__).with_name("probe-resend-smtp.mjs")
    if env.get("GOTRUE_SMTP_HOST") == "smtp.resend.com" and env.get("GOTRUE_SMTP_USER") == "resend":
        result = smtp_probe(auth, before["storage"], env.get("GOTRUE_SMTP_PASS", ""), env.get("GOTRUE_SMTP_PORT", ""), probe_path)
    else:
        result = {"status": "skipped_runtime_is_not_resend"}
    emit("runtime_smtp_authentication", result)
    if protected_key and (not hmac.compare_digest(protected_key, env.get("GOTRUE_SMTP_PASS", "")) or result.get("status") != "authenticated"):
        emit("protected_resend_key_authentication", smtp_probe(auth, before["storage"], protected_key, "465", probe_path))
    if args.search_database:
        database_search(before["db"])
    after = services(project)
    if not stable_services(before, after):
        raise InspectionError("production_container_state_changed_during_inspection")
    emit("inspection", {"completed": True, "configuration_mutated": False, "email_sent": False, "login_verified": False})


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Never stringify exceptions: SMTP/Docker/SQL errors may contain secrets or PII.
        emit("inspection", {"completed": False, "status": "failed_no_raw_error_output"})
        sys.exit(1)
