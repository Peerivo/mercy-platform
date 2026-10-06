#!/usr/bin/env python3
"""Bounded, read-only Notify inspection. Never print environment or provider bodies."""
import hashlib
import json
import os
import re
import shlex
import stat
import subprocess
import sys
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
    "PORT", "NOTIFY_MENAION_TENANT_ID",
    "NOTIFY_MENAION_CONNECTION_ID", "NOTIFY_MENAION_ALLOWED_ACTOR",
))
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", re.I)
ACTOR = re.compile(r"telegram:([1-9][0-9]{0,15})")
ECMASCRIPT_TRIM = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
MIGRATION = re.compile(r"[0-9]{4}_[a-z0-9_]{1,110}\.sql")
SYSTEMD_COMMAND = [
    "/usr/bin/systemctl", "show", "peerivo-notify", "--no-pager",
    "--property=ActiveState,SubState,ExecMainStatus,MainPID,User,Group,WorkingDirectory,ExecStart",
]
DATABASE_COMMAND = [
    "/usr/bin/docker", "--host", "unix:///var/run/docker.sock", "exec", "-i", "supabase-db",
    "/usr/bin/env", "-i", "PATH=/usr/local/bin:/usr/bin:/bin", "PGCONNECT_TIMEOUT=5",
    "psql", "-h", "/var/run/postgresql", "-p", "5432", "-X", "--no-password",
    "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1",
]
MIGRATION_SQL = """BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT CASE WHEN octet_length(version) <= 128 THEN version ELSE '_invalid_migration_version_' END
FROM public.notify_schema_migrations ORDER BY version LIMIT 101;
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


def read_bounded(filename, limit):
    fd = os.open(filename, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError("not_regular")
        with os.fdopen(fd, "rb", closefd=False) as handle:
            data = handle.read(limit + 1)
    finally:
        os.close(fd)
    if len(data) > limit:
        raise ValueError("oversized")
    return data



class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def http_json(url, headers=None):
    # This diagnostic never sends credentials, including to a local listener.
    if headers or url not in (PUBLIC_HEALTH, LOOPBACK + "/health"):
        return {"status": "refused"}
    request = urllib.request.Request(url, method="GET")
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
    text = read_bounded(filename, 131072).decode("utf-8")
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


def collect_report(runtime=RUNTIME, env_file=ENV_FILE, command=run_command, request=http_json, *, protected_metadata=False):
    report = {"format": "peerivo-notify-readiness-v1", "readOnly": True,
              "productionDeliveryVerified": False, "ownerIdentityIndependentlyVerified": False,
              "inspectionMode": "protected_metadata" if protected_metadata else "public_service_only"}
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
            elif name in ("User", "Group"):
                service[name + "Expected"] = value == "peerivo-notify"
            elif name == "WorkingDirectory":
                service["WorkingDirectoryExpected"] = value == str(RUNTIME)
            elif name == "ExecStart":
                executable = re.search(r"(?:^|[{;])\s*path=([^;]+?)\s*;", value)
                argv = re.search(r"(?:^|[{;])\s*argv\[\]=([^;]+?)\s*;", value)
                service["ExecStartExpected"] = bool(executable and argv and executable.group(1) == "/usr/bin/node" and argv.group(1) == "/usr/bin/node /opt/peerivo-notify/current/src/ru-core-server.js")
        report["service"] = {"available": values is not None, "state": service}
    except Exception:
        report["service"] = {"available": False, "reason": "inspection_failed"}

    for name, url in (("loopbackHealth", LOOPBACK + "/health"), ("publicHealth", PUBLIC_HEALTH)):
        try:
            report[name] = health_summary(request(url))
        except Exception:
            report[name] = {"status": "unverified"}

    if not protected_metadata:
        # This mode never touches runtime files, EnvironmentFile or Docker.
        # It is safe to run with only the SSH account's existing read access.
        report.update({
            "runtimeLayout": {"currentKind": "not_checked"},
            "runtimeFiles": [], "declaredRevision": None,
            "migrations": {"verifiedRead": False, "versions": [], "ownerMigrationPresent": False},
            "scopedProfile": {"readable": False, "scopeReferenceValid": False, "credentialsChecked": False},
            "privateOwnerConnection": {"checked": False, "ready": False, "apiVerified": False},
        })
        return report

    try:
        report["runtimeLayout"] = {
            "currentKind": "symlink" if runtime.is_symlink() else "directory" if runtime.is_dir() else "missing",
            "resolvesInsideNotify": runtime.resolve().is_relative_to(RUNTIME.parent),
            "sourceDirectoryPresent": (runtime / "src").is_dir(),
        }
    except Exception:
        report["runtimeLayout"] = {"currentKind": "unverified"}

    files = []
    for relative in RUNTIME_FILES:
        try:
            filename = runtime / relative
            if filename.is_symlink() or not filename.resolve().is_relative_to(runtime.resolve()):
                raise ValueError("unsafe_file")
            data = read_bounded(filename, 1048576)
            files.append({"path": relative, "present": True, "sha256": hashlib.sha256(data).hexdigest()})
        except Exception:
            files.append({"path": relative, "present": False})
    report["runtimeFiles"] = files
    try:
        manifest_file = runtime / "release-manifest.json"
        if manifest_file.is_symlink() or not manifest_file.resolve().is_relative_to(runtime.resolve()) or manifest_file.stat().st_size > 1048576:
            raise ValueError("unsafe_manifest")
        manifest = json.loads(read_bounded(manifest_file, 1048576))
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

    report["privateOwnerConnection"] = {"checked": False, "ready": False, "apiVerified": False}
    try:
        env = parse_environment(env_file)
        tenant = env.get("NOTIFY_MENAION_TENANT_ID", "").strip(ECMASCRIPT_TRIM).lower()
        connection_id = env.get("NOTIFY_MENAION_CONNECTION_ID", "").strip(ECMASCRIPT_TRIM).lower()
        actor = ACTOR.fullmatch(env.get("NOTIFY_MENAION_ALLOWED_ACTOR", "").strip(ECMASCRIPT_TRIM))
        valid = UUID.fullmatch(tenant) is not None and UUID.fullmatch(connection_id) is not None and actor is not None
        report["scopedProfile"] = {"readable": True, "scopeReferenceValid": bool(valid), "credentialsChecked": False,
                                   "canonicalPort": env.get("PORT", "3000") == "3000"}
        if valid:
            # Identifiers are accepted only after UUID/digits validation. No secret
            # is read into this query, and only five booleans can leave PostgreSQL.
            sql = f"""BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT json_build_object(
 'found', count(*) = 1,
 'bindingMatches', coalesce(bool_and(c.id = '{connection_id}'::uuid AND c.tenant_id = '{tenant}'::uuid), false),
 'private', coalesce(bool_and(coalesce(to_jsonb(c)->>'connected_chat_type',
   CASE WHEN c.connected_chat_id > 0 AND c.connected_chat_id = c.connected_user_id THEN 'private' ELSE 'unknown' END) = 'private'), false),
 'actorMatches', coalesce(bool_and(c.connected_chat_id = {actor.group(1)}::bigint AND c.connected_user_id = {actor.group(1)}::bigint), false),
 'active', coalesce(bool_and(c.status = 'active'), false)
)
FROM public.notify_telegram_connections c
WHERE c.id = '{connection_id}'::uuid AND c.tenant_id = '{tenant}'::uuid;
ROLLBACK;
"""
            result = command(DATABASE_COMMAND, sql)
            metadata = json.loads(result) if result is not None else None
            names = ("found", "bindingMatches", "private", "actorMatches", "active")
            if isinstance(metadata, dict) and set(metadata) == set(names) and all(type(metadata[name]) is bool for name in names):
                report["privateOwnerConnection"] = {"checked": True, "source": "database_metadata", **metadata,
                    "matchesConfiguredPrivateOwner": all(metadata.values()), "ready": False, "apiVerified": False}
    except Exception:
        report.setdefault("scopedProfile", {"readable": False, "scopeReferenceValid": False, "credentialsChecked": False})
    return report


if __name__ == "__main__":
    if sys.argv[1:] not in ([], ["--public-only"], ["--protected-metadata"]):
        raise SystemExit("Unsupported inspection mode")
    print(json.dumps(collect_report(protected_metadata=sys.argv[1:] == ["--protected-metadata"]),
                     sort_keys=True, separators=(",", ":")))
