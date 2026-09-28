#!/usr/bin/env python3
"""Read-only capacity and isolation inventory. Never reads secrets or user rows."""
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

TARGET_DATABASE = "living_menaion"
DB_QUERY = """SELECT json_build_object(
 'server_version', current_setting('server_version'),
 'database_name', current_database(),
 'target_database_exists', EXISTS(SELECT 1 FROM pg_database WHERE datname='living_menaion'),
 'target_owner_exists', EXISTS(SELECT 1 FROM pg_roles WHERE rolname='living_menaion_owner'),
 'mercy_database_bytes', pg_database_size(current_database()),
 'connection_limit', current_setting('max_connections')::int,
 'active_connections', (SELECT count(*) FROM pg_stat_activity))::text"""


class ProbeFailed(Exception):
    pass


def command(args):
    # No shell, no caller-supplied commands, no inherited database credentials.
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "LC_ALL": "C"}
    try:
        result = subprocess.run(args, env=env, capture_output=True, text=True,
                                timeout=12, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise ProbeFailed("command_unavailable_or_timed_out") from None
    if result.returncode or len(result.stdout) > 131072:
        raise ProbeFailed("command_failed_or_output_too_large")
    return result.stdout


def memory():
    entries = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        key, value = line.split(":", 1)
        if key in {"MemTotal", "MemAvailable", "SwapTotal", "SwapFree"}:
            entries[key] = int(value.strip().split()[0]) * 1024
    if not {"MemTotal", "MemAvailable"} <= entries.keys():
        raise ProbeFailed("memory_unknown")
    return entries


def containers():
    value = command(["docker", "ps", "-a", "--format", "{{json .}}"])
    rows = []
    for line in value.splitlines():
        item = json.loads(line)
        name = item["Names"]
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}", name):
            raise ProbeFailed("invalid_container_metadata")
        # Explicit allowlist; never emit Mounts, Labels, Command or environment.
        rows.append({"name": name, "running": item.get("State") == "running"})
    if len(rows) > 100:
        raise ProbeFailed("inventory_too_large")
    return rows


def database():
    raw = command(["docker", "exec", "-e",
                   "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000",
                   "supabase-db", "psql", "-X", "-U", "supabase_admin", "-d", "postgres",
                   "-v", "ON_ERROR_STOP=1", "-At", "-c", DB_QUERY])
    value = json.loads(raw)
    keys = {"server_version", "database_name", "target_database_exists", "target_owner_exists",
            "mercy_database_bytes", "connection_limit", "active_connections"}
    if not isinstance(value, dict) or set(value) != keys:
        raise ProbeFailed("invalid_database_metadata")
    if value["database_name"] != "postgres" or not re.fullmatch(r"[0-9.]+", value["server_version"]):
        raise ProbeFailed("unexpected_database_identity")
    for name in ("target_database_exists", "target_owner_exists"):
        if type(value[name]) is not bool:
            raise ProbeFailed("invalid_database_flags")
    for name in ("mercy_database_bytes", "connection_limit", "active_connections"):
        if type(value[name]) is not int or value[name] < 0:
            raise ProbeFailed("invalid_database_counts")
    return value


def backup_metadata():
    directory = Path.home() / "beget-pre-migration-backups"
    if not directory.is_dir():
        return {"status": "unknown", "restore_verified": False}
    files = []
    for path in directory.glob("before-*-postgres.dump"):
        if path.is_symlink() or not path.is_file():
            continue
        if not re.fullmatch(r"before-[0-9]+-postgres\.dump", path.name):
            continue
        info = path.stat()
        if info.st_size > 0:
            files.append(info)
    return {"status": "metadata_only", "count": len(files),
            "newest_mtime_utc": datetime.fromtimestamp(max(x.st_mtime for x in files), timezone.utc).isoformat() if files else None,
            "restore_verified": False,
            "note": "Historical archive presence is not a current backup or restore test."}


def inspect(role):
    if role not in {"beget", "reg-ru"}:
        raise ProbeFailed("invalid_host_role")
    result = {"host_role": role, "observed_at": datetime.now(timezone.utc).isoformat(),
              "read_only": True, "target_database": TARGET_DATABASE,
              "deployment_ready": False,
              "note": "Inventory only; no approval to deploy or change existing services."}
    probes = {"memory": memory, "containers": containers,
              "disk": lambda: dict(zip(("total", "used", "free"), shutil.disk_usage("/"))),
              "cpu": lambda: {"count": os.cpu_count(), "load": os.getloadavg()}}
    if role == "beget":
        probes.update(database=database, historical_backup_metadata=backup_metadata)
    errors = []
    for name, probe in probes.items():
        try:
            result[name] = probe()
        except Exception:
            # Exception messages and command stderr can contain sensitive data.
            errors.append(name)
            result[name] = {"status": "unknown"}
    result["failed_probes"] = errors
    result["inspection_complete"] = not errors
    return result


def main(argv):
    if len(argv) != 1 or argv[0] not in {"beget", "reg-ru"}:
        print('{"error":"invalid_host_role","deployment_ready":false}')
        return 2
    result = inspect(argv[0])
    print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    return 0 if result["inspection_complete"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
