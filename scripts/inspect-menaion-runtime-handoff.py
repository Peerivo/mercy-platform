#!/usr/bin/env python3
"""Read-only, secret-redacting Menaion runtime handoff preflight.

This revision deliberately has NO activation path. It does not read stdin, accept
passwords, create tokens, write runtime files, or create/stop/rename containers.
Raw subprocess output and exception details must never reach stdout or stderr.
"""
from __future__ import annotations

import errno
import ipaddress
import json
import os
from pathlib import Path
import re
import resource
import stat
import subprocess
import sys
from urllib.parse import unquote, urlsplit

MIGRATION_VERSION = "20261002184929"
MIGRATION_SHA = "15265e48dcbf87b24b7aed34c296c2a4a83cbba132a5e33bffc0cfdd9469444c"
# Immutable historical ledger, copied byte-for-value from PR219's pinned
# moderation-predecessors.json (SHA-256 613887b5920dcffae6cad1db2b107ba0f8e366ae8c21f809a0b31f7d2fbf91a6).
# Keep inline because the read-only workflow streams this inspector over stdin.
# These are deployed checksums, never hashes regenerated from normalized sources.
FEEDBACK_HISTORY = (
    ("20260916193000", "3b34be574e02d0a15ad4c7e2d2b73dcc5b78b55b5bac8d303462eca299f31c9c"),
    ("20260917094000", "c2cabd0b8fed228e9214117a3fbfe768df1d96724dc0614f9dd4da38ba9704cf"),
    ("20260917224000", "0c67674026043a80021df34bbbb824aee842afe37fb8eea88f21ff5d0e7c1e45"),
    ("20260917231000", "0a3be17f25f9e423c773c232eafb8e036c42ff7ce82401dcb771c5a3a3ab5551"),
    ("20260918022500", "aa8be3c8305818638d6a77e5602adaf95ac8ed1ff5af6e1a10fd41ef8ab480e4"),
    ("20260918213000", "c93038b2dddfbf75b38374dca8c850f036874ed67248550a31848b17a2eddaf6"),
    ("20260927140000", "d6ffce4f79c96d24c88759edbff989373a96364871027f87e8c7bafff2905761"),
    ("20260929193000", "6f945a29618a646d1f1e3d8c3be89fbbab1883fec8bc0e911b7494e9df19bddc"),
    ("20261002184929", "15265e48dcbf87b24b7aed34c296c2a4a83cbba132a5e33bffc0cfdd9469444c"),
)
MODERATION_MIGRATION = ("20261005073345", "ee2bf27553ca0a71baa275ad607b7ddbf0893e9e64d5687d8029d94bf592b499")
APPROVED_HISTORIES = (FEEDBACK_HISTORY, FEEDBACK_HISTORY + (MODERATION_MIGRATION,))

REST_NAME = "living-menaion-rest"
DB_NAME = "supabase-db"
MAX_BYTES = 2 * 1024 * 1024
SHA = re.compile(r"sha256:[a-f0-9]{64}\Z")
CID = re.compile(r"[a-f0-9]{64}\Z")
ENV_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")
NETWORK_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\Z")


REASON_MAP = {
    "ambiguous inspect": "ambiguous_inspect",
    "command failed": "command_failed",
    "command output oversized": "command_output_oversized",
    "command unavailable": "command_unavailable",
    "duplicate JSON key": "duplicate_json_key",
    "image ID unavailable": "image_id_unavailable",
    "invalid JSON": "invalid_json",
    "invalid aliases": "invalid_aliases",
    "invalid environment": "invalid_environment",
    "invalid logging observations": "invalid_logging_observations",
    "invalid or duplicate environment entry": "invalid_or_duplicate_environment_entry",
    "invalid preload inventory": "invalid_preload_inventory",
    "invalid project": "invalid_project",
    "missing environment": "missing_environment",
    "nonboolean database response": "nonboolean_database_response",
    "nonfinite": "nonfinite_json",
    "oversized environment": "oversized_environment",
    "directory not regular": "private_directory_not_directory",
    "directory mode mismatch": "private_directory_mode_not_0700",
    "directory owner mismatch": "private_directory_owner_mismatch",
    "environment not regular": "environment_not_regular_file",
    "environment mode mismatch": "environment_mode_not_0600",
    "environment owner mismatch": "environment_owner_mismatch",
    "environment hardlink": "environment_hardlink_rejected",
    "remote Docker context is not supported": "remote_docker_override_rejected",
    "unexpected database response": "unexpected_database_response",
}
OS_REASON_MAP = {errno.ENOENT: "required_path_missing", errno.EACCES: "path_read_denied",
                 errno.EPERM: "path_read_denied", errno.ELOOP: "symlink_rejected"}
REASON_CODES = frozenset(REASON_MAP.values()) | frozenset(OS_REASON_MAP.values()) | {"unclassified"}
INSPECTION_STAGES = frozenset(("docker_rest", "docker_db", "image", "private_env", "runtime_facts", "database_facts"))


class Refused(Exception):
    """Stores a static enum only. Raw authored/runtime text is never rendered."""

    def __init__(self, reason=None):
        super().__init__()
        self.reason_code = REASON_MAP.get(reason, "unclassified") if type(reason) is str else "unclassified"


def safe_reason(error) -> str:
    if type(error) in (Refused, StageRefused):
        code = error.reason_code
        return code if type(code) is str and code in REASON_CODES else "unclassified"
    if isinstance(error, OSError):
        return OS_REASON_MAP.get(error.errno, "unclassified")
    return "unclassified"


class StageRefused(Refused):
    """Carries only fixed diagnostic enums, never an exception description."""

    def __init__(self, stage, reason_code="unclassified"):
        super().__init__()
        self.stage = stage if type(stage) is str and stage in INSPECTION_STAGES else "unclassified"
        self.reason_code = reason_code if type(reason_code) is str and reason_code in REASON_CODES else "unclassified"


def command(argv: list[str], data: bytes | None = None) -> bytes:
    # No shell, no inherited stdin, no raw errors, no command tracing.
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "LC_ALL": "C"}
    for key in ("HOME", "DOCKER_HOST", "DOCKER_CONTEXT"):
        if key in os.environ:
            env[key] = os.environ[key]
    if env.get("DOCKER_HOST") or env.get("DOCKER_CONTEXT"):
        raise Refused("remote Docker context is not supported")
    if argv and argv[0] == "docker":
        argv = ["docker", "--host", "unix:///var/run/docker.sock", *argv[1:]]
    try:
        result = subprocess.run(argv, input=data, stdin=subprocess.DEVNULL if data is None else None,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                check=False, timeout=25, env=env)
        if result.returncode != 0:
            raise Refused("command failed")
        if len(result.stdout) > MAX_BYTES:
            raise Refused("command output oversized")
        return result.stdout
    except Refused:
        raise
    except Exception:
        raise Refused("command unavailable") from None


def decode_json(raw: bytes):
    def unique(pairs):
        out = {}
        for key, value in pairs:
            if key in out:
                raise Refused("duplicate JSON key")
            out[key] = value
        return out
    try:
        return json.loads(raw, object_pairs_hook=unique,
                          parse_constant=lambda _: (_ for _ in ()).throw(Refused("nonfinite")))
    except Exception as error:
        raise Refused("invalid JSON") from error


def inspect_one(kind: str, identity: str) -> dict:
    prefix = ["docker", "image", "inspect"] if kind == "image" else ["docker", "inspect"]
    value = decode_json(command(prefix + [identity]))
    if type(value) is not list or len(value) != 1 or type(value[0]) is not dict:
        raise Refused("ambiguous inspect")
    return value[0]


def env_map(items) -> dict[str, str]:
    if type(items) is not list:
        raise Refused("missing environment")
    result = {}
    for item in items:
        if type(item) is not str or any(c in item for c in ("\x00", "\n", "\r")):
            raise Refused("invalid environment")
        key, equals, value = item.partition("=")
        if not equals or not ENV_NAME.fullmatch(key) or key in result:
            raise Refused("invalid or duplicate environment entry")
        result[key] = value
    return result


def env_file_map(text: str) -> dict[str, str]:
    """Docker env-file blank/comment semantics, without shell interpolation.

    Leading whitespace and CRLF are accepted; whitespace and # in a value are
    preserved. Bare names that depend on a caller environment remain forbidden.
    Runtime Config.Env parsing uses env_map directly and stays strict.
    """
    lines = []
    for line in text.split("\n"):
        if line.endswith("\r"):
            line = line[:-1]
        line = line.lstrip()
        if not line or line.startswith("#"):
            continue
        lines.append(line)
    return env_map(lines)


def read_private_env(path: Path) -> dict[str, str]:
    # Never follow a symlink or accept a hard-linked/group-readable secret file.
    parent = path.parent
    info = parent.lstat()
    if not stat.S_ISDIR(info.st_mode):
        raise Refused("directory not regular")
    if stat.S_IMODE(info.st_mode) != 0o700:
        raise Refused("directory mode mismatch")
    if info.st_uid != os.geteuid():
        raise Refused("directory owner mismatch")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise Refused("environment not regular")
        if stat.S_IMODE(info.st_mode) != 0o600:
            raise Refused("environment mode mismatch")
        if info.st_uid != os.geteuid():
            raise Refused("environment owner mismatch")
        if info.st_nlink != 1:
            raise Refused("environment hardlink")
        with os.fdopen(fd, "rb", closefd=False) as stream:
            raw = stream.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise Refused("oversized environment")
        return env_file_map(raw.decode("utf-8"))
    finally:
        os.close(fd)


def uri_facts(value: str, db_aliases: list[str]) -> dict[str, bool]:
    try:
        uri = urlsplit(value)
        # Only the exact, simple URI shape emitted by the original provisioner.
        valid = (uri.scheme in ("postgres", "postgresql") and not uri.query and not uri.fragment
                 and bool(uri.hostname) and uri.port in (None, 5432)
                 and uri.username is not None and uri.password is not None
                 and not re.search(r"%(?![0-9A-Fa-f]{2})", value)
                 and not any(c.isspace() or ord(c) < 32 for c in value))
        return {
            "uri_shape_recognized": valid,
            "database_is_living_menaion": unquote(uri.path) == "/living_menaion",
            "authenticator_is_shared": unquote(uri.username or "") == "authenticator",
            "authenticator_is_dedicated": unquote(uri.username or "") == "menaion_rest_authenticator",
            "database_host_matches_db_network_alias": valid and uri.hostname in db_aliases,
        }
    except Exception:
        return {key: False for key in ("uri_shape_recognized", "database_is_living_menaion",
                "authenticator_is_shared", "authenticator_is_dedicated", "database_host_matches_db_network_alias")}


# This is an observation allowlist, not an activation authorization. Unknown or
# changed settings are counted and block a future exact-runtime reproduction.
HOST_DEFAULTS = {
    "Binds": (None, []), "ContainerIDFile": ("",), "LogConfig": (),
    "NetworkMode": (), "PortBindings": (None, {}), "RestartPolicy": (),
    "AutoRemove": (False,), "VolumeDriver": ("",), "VolumesFrom": (None, []),
    "ConsoleSize": ([0, 0],), "CapAdd": (None, []), "CapDrop": (None, []),
    "CgroupnsMode": ("private", "host", ""), "Dns": (None, []), "DnsOptions": (None, []),
    "DnsSearch": (None, []), "ExtraHosts": (None, []), "GroupAdd": (None, []),
    "IpcMode": ("private",), "Cgroup": ("",), "Links": (None, []), "OomScoreAdj": (0,),
    "PidMode": ("",), "Privileged": (False,), "PublishAllPorts": (False,),
    "ReadonlyRootfs": (False,), "SecurityOpt": (None, []), "UTSMode": ("",),
    "UsernsMode": ("",), "ShmSize": (67108864,), "Runtime": ("runc",),
    "Isolation": ("",), "CpuShares": (0,), "Memory": (0,), "NanoCpus": (0,),
    "CgroupParent": ("",), "BlkioWeight": (0,), "BlkioWeightDevice": (None, []),
    "BlkioDeviceReadBps": (None, []), "BlkioDeviceWriteBps": (None, []),
    "BlkioDeviceReadIOps": (None, []), "BlkioDeviceWriteIOps": (None, []),
    "CpuPeriod": (0,), "CpuQuota": (0,), "CpuRealtimePeriod": (0,),
    "CpuRealtimeRuntime": (0,), "CpusetCpus": ("",), "CpusetMems": ("",),
    "Devices": (None, []), "DeviceCgroupRules": (None, []), "DeviceRequests": (None, []),
    "MemoryReservation": (0,), "MemorySwap": (0,), "MemorySwappiness": (None,),
    "OomKillDisable": (None, False), "PidsLimit": (None, 0), "Ulimits": (None, []),
    "CpuCount": (0,), "CpuPercent": (0,), "IOMaximumIOps": (0,), "IOMaximumBandwidth": (0,),
    "MaskedPaths": (), "ReadonlyPaths": (), "Init": (None, False),
    "Mounts": (None, []), "Tmpfs": (None, {}), "Sysctls": (None, {}),
    "StorageOpt": (None, {}), "Annotations": (None, {}),
}
STANDARD_MASKED = ["/proc/asound", "/proc/acpi", "/proc/interrupts", "/proc/kcore", "/proc/keys",
                   "/proc/latency_stats", "/proc/timer_list", "/proc/timer_stats", "/proc/sched_debug",
                   "/proc/scsi", "/sys/firmware", "/sys/devices/virtual/powercap"]
STANDARD_READONLY = ["/proc/bus", "/proc/fs", "/proc/irq", "/proc/sys", "/proc/sysrq-trigger"]
IMAGE_FIELDS = ("User", "Entrypoint", "Cmd", "WorkingDir", "StopSignal", "Healthcheck",
                "ExposedPorts", "Volumes", "Labels", "Shell", "OnBuild")


def exact_member(value, allowed) -> bool:
    return any(type(value) is type(expected) and value == expected for expected in allowed)


def runtime_facts(rest: dict, db: dict, image: dict, file_env: dict) -> dict:
    config, host = rest["Config"], rest["HostConfig"]
    image_config = image["Config"]
    env = env_map(config["Env"])
    project = db["Config"]["Labels"]["com.docker.compose.project"]
    if type(project) is not str or not NETWORK_NAME.fullmatch(project):
        raise Refused("invalid project")
    network = project + "_default"
    networks = rest["NetworkSettings"]["Networks"]
    db_networks = db["NetworkSettings"]["Networks"]
    aliases = db_networks.get(network, {}).get("Aliases") or []
    if type(aliases) is not list or not all(type(x) is str for x in aliases):
        raise Refused("invalid aliases")
    # Docker always resolves the container name in addition to explicit aliases.
    aliases = aliases + [db.get("Name", "").removeprefix("/")]
    special = {
        "NetworkMode": host.get("NetworkMode") == network,
        "RestartPolicy": host.get("RestartPolicy") == {"Name": "unless-stopped", "MaximumRetryCount": 0},
        "LogConfig": host.get("LogConfig") in ({"Type": "json-file", "Config": {}}, {"Type": "local", "Config": {}}),
        "MaskedPaths": host.get("MaskedPaths") == STANDARD_MASKED,
        "ReadonlyPaths": host.get("ReadonlyPaths") == STANDARD_READONLY,
    }
    incompatible = [key for key, allowed in HOST_DEFAULTS.items()
                    if key in host and not (special[key] if key in special else exact_member(host[key], allowed))]
    missing = sorted({"NetworkMode", "RestartPolicy", "Privileged", "AutoRemove", "PortBindings",
                      "ReadonlyRootfs", "LogConfig", "Runtime", "MaskedPaths", "ReadonlyPaths"} - set(host))
    unknown_count = len(set(host) - set(HOST_DEFAULTS))
    image_diff = [key for key in IMAGE_FIELDS if config.get(key) != image_config.get(key)]
    expected_env = env_map(image_config.get("Env") or [])
    expected_env.update(file_env)
    schemas = [value.strip() for value in env.get("PGRST_DB_SCHEMAS", "").split(",")]
    ip = networks.get(network, {}).get("IPAddress", "")
    endpoint = networks.get(network, {})
    facts = {
        "containers_running": rest["State"].get("Running") is True and db["State"].get("Running") is True,
        "immutable_image_resolved": bool(SHA.fullmatch(rest.get("Image", ""))) and image.get("Id") == rest.get("Image"),
        "runtime_name_exact": rest.get("Name") == "/" + REST_NAME,
        "image_default_fields_match": not image_diff,
        "image_default_field_differences": image_diff,
        "env_file_matches_effective_docker_env": env == expected_env,
        "single_expected_network": set(networks) == {network},
        "database_on_expected_network": network in db_networks,
        "network_attachment_has_no_custom_ipam": endpoint.get("IPAMConfig") in (None, {}),
        "network_attachment_has_no_links": endpoint.get("Links") in (None, []),
        "container_has_no_mounts": rest.get("Mounts") == [],
        "container_has_no_tty_or_stdin": all(config.get(x) is False for x in ("Tty", "OpenStdin", "StdinOnce")),
        "container_detached_output": config.get("AttachStdout") is False and config.get("AttachStderr") is False,
        "compatible_known_host_settings": not incompatible and not missing,
        "incompatible_known_host_fields": incompatible,
        "missing_required_host_fields": missing,
        "unreviewed_host_field_count": unknown_count,
        "content_schema_only": schemas == ["living_menaion"],
        "feedback_schema_exposed": "menaion_feedback" in schemas,
        "private_schema_exposed": "menaion_feedback_private" in schemas,
        "jwt_secret_present": bool(env.get("PGRST_JWT_SECRET")),
        "jwt_audience_unset": "PGRST_JWT_AUD" not in env,
        "db_pre_config_unset": not env.get("PGRST_DB_PRE_CONFIG"),
        "db_config_disabled": env.get("PGRST_DB_CONFIG") == "false",
        "log_level_not_debug": env.get("PGRST_LOG_LEVEL", "error") in ("crit", "error", "warn", "info"),
        "server_port_is_default": env.get("PGRST_SERVER_PORT", "3000") == "3000",
        "ip_is_private_ipv4": private_ip(ip),
    }
    facts.update(uri_facts(env.get("PGRST_DB_URI", ""), aliases))
    return facts


def private_ip(value) -> bool:
    try:
        ip = ipaddress.ip_address(value)
        return ip.version == 4 and ip.is_private and not ip.is_loopback and not ip.is_unspecified and not ip.is_link_local
    except (ValueError, TypeError):
        return False


DB_SQL = r"""
begin read only;
set local search_path = pg_catalog;
select jsonb_build_object(
 'database_exact', current_database()='living_menaion',
 'superuser_executor', (select rolsuper from pg_roles where rolname=current_user),
 'migration_exact', (select count(*)=1 from public.living_menaion_schema_migrations where version='20261002184929' and checksum='15265e48dcbf87b24b7aed34c296c2a4a83cbba132a5e33bffc0cfdd9469444c'),
 -- Eleven rows prove an oversized history without collecting the full ledger.
 -- One character beyond each exact field length preserves fail-closed rejection.
 'migration_history', (select coalesce(jsonb_agg(jsonb_build_object('version',version,'checksum',checksum) order by version),'[]'::jsonb)
   from (select left(version,15) as version,left(checksum,65) as checksum
         from public.living_menaion_schema_migrations order by version limit 11) bounded_history),
 'roles_safe', (select count(*)=3 from pg_authid where rolname in ('menaion_feedback_submit','menaion_feedback_writer','menaion_rest_authenticator') and not (rolcanlogin or rolsuper or rolinherit or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication) and rolpassword is null),
 'dedicated_authenticator_unused', not exists (select from pg_stat_activity where usename='menaion_rest_authenticator'),
 'dedicated_memberships_exact', (select array_agg(r.rolname::text order by r.rolname::text)=array['menaion_feedback_submit','service_role'] from pg_auth_members m join pg_roles r on r.oid=m.roleid where m.member=(select oid from pg_roles where rolname='menaion_rest_authenticator')),
 'dedicated_has_no_members', not exists(select from pg_auth_members where roleid=(select oid from pg_roles where rolname='menaion_rest_authenticator')),
 'shared_authenticator_not_member', not pg_has_role('authenticator','menaion_feedback_submit','MEMBER'),
 'no_effective_postgrest_overrides', not exists (select from pg_db_role_setting s, unnest(s.setconfig) c where (s.setdatabase=0 or s.setdatabase=(select oid from pg_database where datname='living_menaion')) and (s.setrole=0 or s.setrole in (select oid from pg_roles where rolname in ('authenticator','menaion_rest_authenticator'))) and c like 'pgrst.%'),
 'no_role_config_overrides', not exists (select from pg_roles r, unnest(r.rolconfig) c where r.rolname in ('authenticator','menaion_rest_authenticator') and c like 'pgrst.%'),
 'feedback_schemas_present', (select count(*)=2 from pg_namespace where nspname in ('menaion_feedback','menaion_feedback_private')),
 'feedback_rpc_present', to_regprocedure('menaion_feedback.submit_pronunciation_correction(text,text,text)') is not null,
 'preload_inventory', (select jsonb_build_object(
    'pgaudit', coalesce(bool_or(name='pgaudit'),false),
    'pg_stat_statements', coalesce(bool_or(name='pg_stat_statements'),false),
    'pg_net', coalesce(bool_or(name='pg_net'),false),
    'pg_cron', coalesce(bool_or(name='pg_cron'),false),
    'pgsodium', coalesce(bool_or(name='pgsodium'),false),
    'unknown_count', count(*) filter(where name<>'' and name not in ('pgaudit','pg_stat_statements','pg_net','pg_cron','pgsodium'))
  ) from (select btrim(raw, ' "') as name from unnest(string_to_array(concat_ws(',',current_setting('shared_preload_libraries'),current_setting('session_preload_libraries'),current_setting('local_preload_libraries')),',')) raw) libraries),
 'credential_logging_observations', jsonb_build_object(
   'log_statement_none', current_setting('log_statement')='none',
   'log_duration_off', current_setting('log_duration')='off',
   'duration_logging_disabled', current_setting('log_min_duration_statement')='-1',
   'sample_duration_logging_disabled', coalesce(current_setting('log_min_duration_sample',true)='-1',false),
   'transaction_sampling_disabled', coalesce(current_setting('log_transaction_sample_rate',true)='0',false),
   'error_statement_logging_disabled', current_setting('log_min_error_statement')='panic',
   'bind_parameter_logging_disabled', coalesce(current_setting('log_parameter_max_length',true)='0',false),
   'error_parameter_logging_disabled', coalesce(current_setting('log_parameter_max_length_on_error',true)='0',false),
   'parse_logging_off', current_setting('debug_print_parse')='off',
   'rewritten_logging_off', current_setting('debug_print_rewritten')='off',
   'plan_logging_off', current_setting('debug_print_plan')='off',
   'statement_stats_off', current_setting('log_statement_stats')='off',
   'parser_stats_off', current_setting('log_parser_stats')='off',
   'planner_stats_off', current_setting('log_planner_stats')='off',
   'executor_stats_off', current_setting('log_executor_stats')='off',
   'pgaudit_logging_disabled', coalesce(current_setting('pgaudit.log',true) in ('none',''),true),
   'pgaudit_parameters_disabled', coalesce(current_setting('pgaudit.log_parameter',true)='off',true),
   'auto_explain_disabled', coalesce(current_setting('auto_explain.log_min_duration',true)='-1',true),
   'pg_stat_statements_utility_disabled', coalesce(current_setting('pg_stat_statements.track_utility',true)='off',true),
   'session_preload_empty', current_setting('session_preload_libraries')='',
   'local_preload_empty', current_setting('local_preload_libraries')='',
   'shared_preload_empty', current_setting('shared_preload_libraries')=''
 )
);
rollback;
"""
DB_FIELDS = {"database_exact", "superuser_executor", "migration_exact", "migration_history_exact", "roles_safe",
             "dedicated_authenticator_unused", "dedicated_memberships_exact", "dedicated_has_no_members",
             "shared_authenticator_not_member", "no_effective_postgrest_overrides", "no_role_config_overrides",
             "feedback_schemas_present", "feedback_rpc_present"}
LOG_FIELDS = {"log_statement_none", "log_duration_off", "duration_logging_disabled", "sample_duration_logging_disabled",
              "transaction_sampling_disabled", "error_statement_logging_disabled", "bind_parameter_logging_disabled",
              "error_parameter_logging_disabled", "parse_logging_off", "rewritten_logging_off", "plan_logging_off",
              "statement_stats_off", "parser_stats_off", "planner_stats_off", "executor_stats_off",
              "pgaudit_logging_disabled", "pgaudit_parameters_disabled", "auto_explain_disabled",
              "pg_stat_statements_utility_disabled", "session_preload_empty", "local_preload_empty", "shared_preload_empty"}


PRELOAD_MODULES = {"pgaudit", "pg_stat_statements", "pg_net", "pg_cron", "pgsodium"}


def approved_migration_history(value) -> bool:
    # Exact JSON types and shapes prevent coercion, hidden fields, ordering drift,
    # missing predecessors, duplicates and any unreviewed future migration.
    if type(value) is not list or len(value) not in (9, 10):
        return False
    history = []
    for row in value:
        if (type(row) is not dict or set(row) != {"version", "checksum"}
                or type(row["version"]) is not str or type(row["checksum"]) is not str):
            return False
        history.append((row["version"], row["checksum"]))
    return tuple(history) in APPROVED_HISTORIES


def validate_db_facts(value) -> dict:
    raw_fields = (DB_FIELDS - {"migration_history_exact"}) | {"migration_history", "credential_logging_observations", "preload_inventory"}
    if type(value) is not dict or set(value) != raw_fields:
        raise Refused("unexpected database response")
    value = dict(value)
    value["migration_history_exact"] = approved_migration_history(value.pop("migration_history"))
    if not all(type(value[key]) is bool for key in DB_FIELDS):
        raise Refused("nonboolean database response")
    inventory = value["preload_inventory"]
    if (type(inventory) is not dict or set(inventory) != PRELOAD_MODULES | {"unknown_count"}
            or not all(type(inventory[key]) is bool for key in PRELOAD_MODULES)
            or type(inventory["unknown_count"]) is not int or not 0 <= inventory["unknown_count"] <= 1000):
        raise Refused("invalid preload inventory")
    logging = value["credential_logging_observations"]
    if type(logging) is not dict or set(logging) != LOG_FIELDS or not all(type(x) is bool for x in logging.values()):
        raise Refused("invalid logging observations")
    return value


def database_facts() -> dict:
    raw = command(["docker", "exec", "-i", "-e",
                   "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=2000",
                   DB_NAME, "psql", "-X", "-q", "-t", "-A", "-w", "-U", "supabase_admin", "-d", "living_menaion",
                   "-v", "ON_ERROR_STOP=1"], DB_SQL.encode())
    return validate_db_facts(decode_json(raw))


def run_inspection() -> dict:
    stage = "docker_rest"
    try:
        rest = inspect_one("container", REST_NAME)
        stage = "docker_db"
        db = inspect_one("container", DB_NAME)
        stage = "image"
        image_id = rest.get("Image", "")
        if type(image_id) is not str or not SHA.fullmatch(image_id):
            raise Refused("image ID unavailable")
        image = inspect_one("image", image_id)
        stage = "private_env"
        private_env = read_private_env(Path.home() / ".living-menaion" / "postgrest.env")
        stage = "runtime_facts"
        runtime = runtime_facts(rest, db, image, private_env)
        stage = "database_facts"
        database = database_facts()
    except BaseException as error:
        raise StageRefused(stage, safe_reason(error)) from None
    return {
        "inspection_completed": True,
        "read_only": True,
        "activation_implemented": False,
        "activation_ready": False,
        "password_required": False,
        "runtime": runtime,
        "database": database,
        "existing_service_role_zero_row_probe_passed": None,
        "existing_service_role_probe_status": "not_performed_no_credential_access",
        "credential_logging_safety_proven": False,
        "exact_runtime_replacement_proven": False,
        "blockers": ["activation_and_compensating_rollback_not_implemented",
                     "database_logging_hooks_and_preload_modules_require_review",
                     "docker_daemon_defaults_and_full_runtime_reproduction_require_review"],
    }


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    # No argparse error strings: they echo arbitrary input, potentially a secret.
    if argv != ["--inspect"]:
        print('{"inspection_completed":false,"activation_ready":false,"error":"inspection_only_revision"}')
        return 2
    try:
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        result = run_inspection()
        print(json.dumps(result, sort_keys=True, separators=(",", ":")))
        return 0
    except BaseException as error:
        stage = error.stage if type(error) is StageRefused else "unclassified"
        if type(stage) is not str or stage not in INSPECTION_STAGES:
            stage = "unclassified"
        print(json.dumps({"inspection_completed": False, "activation_ready": False,
                          "error": "inspection_refused_no_configuration_disclosed", "failed_stage": stage,
                          "reason_code": safe_reason(error)},
                         sort_keys=True, separators=(",", ":")))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
