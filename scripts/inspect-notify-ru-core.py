#!/usr/bin/env python3
"""Bounded, read-only Notify inspection. Never print environment or provider bodies."""
import hashlib
import json
import re
import shlex
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

RUNTIME = Path("/opt/peerivo-notify/current")
ENV_FILE = Path("/etc/peerivo-notify/notify.env")
LOOPBACK = "http://127.0.0.1:3000"
PUBLIC_HEALTH = "https://notify-api.peerivo.net/health"
RUNTIME_FILES = (
    "package.json", "src/ru-core-server.js", "src/ru-core.js", "src/human-action.js",
    "src/menaion-scope.js", "src/secret-box.js", "src/supabase-rest-store.js", "src/telegram-api.js",
)
ENV_NAMES = frozenset((
    "PORT", "NOTIFY_CORE_TOKEN", "NOTIFY_MENAION_TOKEN", "NOTIFY_MENAION_TENANT_ID",
    "NOTIFY_MENAION_CONNECTION_ID", "NOTIFY_MENAION_ALLOWED_ACTOR",
))
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", re.I)
ACTOR = re.compile(r"telegram:([1-9][0-9]{0,15})")
ECMASCRIPT_TRIM = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
MIGRATION = re.compile(r"[0-9]{4}_[a-z0-9_]{1,110}\.sql")
SYSTEMD_COMMAND = [
    "/usr/bin/systemctl", "show", "peerivo-notify", "--no-pager",
    "--property=ActiveState,SubState,ExecMainStatus,MainPID",
]
DATABASE_COMMAND = [
    "/usr/bin/docker", "--host", "unix:///var/run/docker.sock", "exec", "-i", "supabase-db",
    "/usr/bin/env", "-i", "PATH=/usr/local/bin:/usr/bin:/bin", "PGCONNECT_TIMEOUT=5",
    "psql", "-h", "/var/run/postgresql", "-p", "5432", "-X", "--no-password",
    "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1",
]
MIGRATION_SQL = """BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT version FROM public.notify_schema_migrations ORDER BY version LIMIT 101;
ROLLBACK;
"""


def run_command(command, stdin=None):
    completed = subprocess.run(command, input=stdin, text=True, capture_output=True,
                               timeout=12, check=False, env={"PATH": "/usr/bin:/bin", "LANG": "C"})
    if completed.returncode != 0:
        return None
    if len(completed.stdout) > 16384:
        return None
    return completed.stdout


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def http_json(url, headers=None):
    # Only these fixed read endpoints are reachable from this inspector.
    if url != PUBLIC_HEALTH and url != LOOPBACK + "/health":
        prefix = LOOPBACK + "/v1/telegram/connections/"
        if not url.startswith(prefix) or not UUID.fullmatch(url[len(prefix):]):
            return {"status": "refused"}
    request = urllib.request.Request(url, headers=headers or {}, method="GET")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=5) as response:
            raw = response.read(131073)
            if len(raw) > 131072:
                return {"status": "oversized", "httpStatus": response.status}
            try:
                payload = json.loads(raw)
            except (ValueError, UnicodeError):
                return {"status": "invalid_json", "httpStatus": response.status}
            return {"status": "received", "httpStatus": response.status, "payload": payload}
    except urllib.error.HTTPError as error:
        return {"status": "http_error", "httpStatus": error.code}
    except (TimeoutError, urllib.error.URLError, OSError):
        return {"status": "unreachable"}


def parse_environment(filename):
    result = {}
    # Parse only the required keys. No shell sourcing, expansion or command execution.
    text = filename.read_text(encoding="utf-8")
    if len(text) > 131072:
        raise ValueError("oversized")
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        name, separator, value = stripped.partition("=")
        if name not in ENV_NAMES:
            continue
        if not separator or name in result:
            raise ValueError("invalid_environment")
        tokens = shlex.split(value, comments=False, posix=True)
        if not tokens:
            result[name] = ""
        elif len(tokens) == 1:
            result[name] = tokens[0]
        else:
            raise ValueError("unsupported_environment")
    return result


def health_summary(result):
    summary = {"status": result.get("status", "unverified")}
    code = result.get("httpStatus")
    if isinstance(code, int) and 100 <= code <= 599:
        summary["httpStatus"] = code
    body = result.get("payload")
    if not isinstance(body, dict):
        return summary
    summary["recognizedService"] = body.get("service") == "peerivo-notify-ru-core"
    summary["ok"] = body.get("ok") is True
    summary["configured"] = body.get("configured") is True
    version = body.get("version", "")
    if isinstance(version, str) and re.fullmatch(r"[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}", version):
        summary["version"] = version
    capabilities = body.get("capabilities")
    summary["ownerScopedActions"] = isinstance(capabilities, list) and "owner-scoped-human-actions-v1" in capabilities
    return summary


def collect_report(runtime=RUNTIME, env_file=ENV_FILE, command=run_command, request=http_json):
    report = {"format": "peerivo-notify-readiness-v1", "readOnly": True,
              "productionDeliveryVerified": False, "ownerIdentityIndependentlyVerified": False}
    try:
        values = command(SYSTEMD_COMMAND)
        service = {}
        for line in (values or "").splitlines():
            name, _, value = line.partition("=")
            if name == "ActiveState" and value in ("active", "inactive", "failed", "activating", "deactivating", "reloading", "maintenance"):
                service[name] = value
            elif name == "SubState" and value in ("running", "dead", "failed", "start", "start-pre", "start-post", "auto-restart", "stop", "stop-sigterm", "stop-sigkill", "exited", "condition", "reload", "listening"):
                service[name] = value
            elif name in ("ExecMainStatus", "MainPID") and value.isdigit() and len(value) <= 12:
                service[name] = int(value)
        report["service"] = {"available": values is not None, "state": service}
    except Exception:
        report["service"] = {"available": False, "reason": "inspection_failed"}

    files = []
    for relative in RUNTIME_FILES:
        try:
            filename = runtime / relative
            if filename.is_symlink() or not filename.resolve().is_relative_to(runtime.resolve()):
                raise ValueError("unsafe_file")
            data = filename.read_bytes()
            if len(data) > 1048576:
                raise ValueError("oversized")
            files.append({"path": relative, "present": True, "sha256": hashlib.sha256(data).hexdigest()})
        except Exception:
            files.append({"path": relative, "present": False})
    report["runtimeFiles"] = files
    try:
        manifest_file = runtime / "release-manifest.json"
        if manifest_file.is_symlink() or not manifest_file.resolve().is_relative_to(runtime.resolve()) or manifest_file.stat().st_size > 1048576:
            raise ValueError("unsafe_manifest")
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        revision = manifest.get("sourceSha", "")
        report["declaredRevision"] = revision if isinstance(revision, str) and re.fullmatch(r"[0-9a-f]{40}", revision) else None
    except Exception:
        report["declaredRevision"] = None

    try:
        rows = command(DATABASE_COMMAND, MIGRATION_SQL)
        versions = (rows or "").splitlines()
        valid = rows is not None and len(versions) <= 100 and all(MIGRATION.fullmatch(version) for version in versions)
        report["migrations"] = {"verifiedRead": valid, "versions": versions if valid else [],
                                "ownerMigrationPresent": valid and "0004_owner_scoped_human_actions.sql" in versions}
    except Exception:
        report["migrations"] = {"verifiedRead": False, "versions": [], "ownerMigrationPresent": False}

    try:
        report["loopbackHealth"] = health_summary(request(LOOPBACK + "/health"))
    except Exception:
        report["loopbackHealth"] = {"status": "unverified"}
    try:
        report["publicHealth"] = health_summary(request(PUBLIC_HEALTH))
    except Exception:
        report["publicHealth"] = {"status": "unverified"}

    report["privateOwnerConnection"] = {"checked": False, "ready": False}
    try:
        env = parse_environment(env_file)
        token = env.get("NOTIFY_MENAION_TOKEN", "").strip(ECMASCRIPT_TRIM)
        tenant = env.get("NOTIFY_MENAION_TENANT_ID", "").strip(ECMASCRIPT_TRIM)
        connection_id = env.get("NOTIFY_MENAION_CONNECTION_ID", "").strip(ECMASCRIPT_TRIM)
        actor = ACTOR.fullmatch(env.get("NOTIFY_MENAION_ALLOWED_ACTOR", "").strip(ECMASCRIPT_TRIM))
        valid = re.fullmatch(r"[\x21-\x7e]{32,4096}", token) is not None and token != env.get("NOTIFY_CORE_TOKEN", "").strip(ECMASCRIPT_TRIM) and UUID.fullmatch(tenant) is not None and UUID.fullmatch(connection_id) is not None and actor is not None
        report["scopedProfile"] = {"readable": True, "configured": bool(valid), "canonicalPort": env.get("PORT", "3000") == "3000"}
        health = report["loopbackHealth"]
        if valid and report["scopedProfile"]["canonicalPort"] and health.get("configured") and health.get("recognizedService") and health.get("ok") and health.get("ownerScopedActions") and health.get("httpStatus") == 200:
            result = request(LOOPBACK + "/v1/telegram/connections/" + connection_id,
                             {"Authorization": "Bearer " + token, "Accept": "application/json"})
            body = result.get("payload")
            connection = body.get("connection") if isinstance(body, dict) else None
            if result.get("httpStatus") == 200 and isinstance(body, dict) and body.get("ok") is True and isinstance(connection, dict):
                found = body.get("found") is True
                bound = connection.get("id") == connection_id and connection.get("tenantId") == tenant
                private = connection.get("chatType") == "private"
                matches = str(connection.get("chatId")) == actor.group(1) and str(connection.get("telegramUserId")) == actor.group(1)
                active = connection.get("status") == "active"
                ready = found and bound and private and matches and active and connection.get("ready") is True
                report["privateOwnerConnection"] = {"checked": True, "found": found, "bindingMatches": bound,
                                                     "private": private, "actorMatches": matches, "active": active, "ready": ready}
    except Exception:
        report.setdefault("scopedProfile", {"readable": False, "configured": False})
    return report


if __name__ == "__main__":
    print(json.dumps(collect_report(), sort_keys=True, separators=(",", ":")))
