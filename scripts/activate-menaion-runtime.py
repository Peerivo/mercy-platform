#!/usr/bin/env python3
"""User-dispatched, single-target activation and compensating rollback.

Never run this program from an assistant tool against production. The owner enters
and submits the credential through GitHub's production Environment and personally
starts the reviewed workflow. No secret is accepted in argv or printed.
"""
from __future__ import annotations
import base64
import copy
import fcntl
import hashlib
import hmac
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import resource
import signal
import socket
import stat
import sys
import time
import tempfile
from urllib.parse import quote

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("inspection", HERE / "inspect-menaion-runtime-handoff.py")
inspection = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspection)
Refused = inspection.Refused
NAME = "living-menaion-rest"
CANDIDATE = NAME + "-feedback-candidate"
BACKUP = NAME + "-before-feedback"
ROLE = "menaion_rest_authenticator"
LIMIT = 2 * 1024 * 1024
CID = re.compile(r"[a-f0-9]{64}\Z")
VERSION = 1


class Interrupted(BaseException):
    """Cancellation bypasses ordinary readiness retries."""

PSQL = ["docker", "exec", "-i", "-e",
        "PGOPTIONS=-c statement_timeout=10000 -c lock_timeout=2000 -c password_encryption=scram-sha-256",
        "supabase-db", "env", "-i", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "PGOPTIONS=-c statement_timeout=10000 -c lock_timeout=2000 -c password_encryption=scram-sha-256",
        "psql", "-h", "/var/run/postgresql", "-p", "5432", "-X", "-q", "-t", "-A", "-w", "-U", "supabase_admin",
        "-d", "living_menaion", "-v", "ON_ERROR_STOP=1", "-v", "ECHO=none", "-v", "ECHO_HIDDEN=off"]


def require(value):
    if value is not True:
        raise Refused("activation invariant")


def strict_equal(a, b):
    # JSON bool/int coercion must not create an allow-equivalent equality.
    return json.dumps(a, sort_keys=True, separators=(",", ":"), allow_nan=False) == json.dumps(b, sort_keys=True, separators=(",", ":"), allow_nan=False)


def private_read(path):
    info = path.parent.lstat()
    require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700 and info.st_uid == os.geteuid())
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600 and info.st_uid == os.geteuid() and info.st_nlink == 1)
        with os.fdopen(fd, "rb", closefd=False) as stream:
            data = stream.read(LIMIT + 1)
        require(len(data) <= LIMIT)
        return data
    finally:
        os.close(fd)


def atomic_write(path, data):
    # Parent is verified private; exclusive, no-follow temporary and durable rename.
    require(len(data) <= LIMIT)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    tmp = Path(temporary)
    try:
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(data)
            stream.flush()
            os.fsync(fd)
        os.replace(tmp, path)
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        os.close(fd)
        if tmp.exists():
            tmp.unlink()


class UnixHTTP(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect("/var/run/docker.sock")


class Docker:
    def __init__(self):
        data = self.request("GET", "/version")
        version = data.get("ApiVersion", "")
        require(bool(re.fullmatch(r"1\.[0-9]{2}", version)))
        # Use the daemon's own schema; ignored/normalized fields are then caught by
        # full post-create equality. We never substitute local guessed defaults.
        self.prefix = "/v" + version
        info = self.request("GET", "/info")
        require(type(info.get("OomKillDisable")) is bool)
        self.oom_kill_disable_supported = info["OomKillDisable"]

    def request(self, method, path, body=None, missing=False):
        connection = UnixHTTP("localhost", timeout=25)
        try:
            raw = None if body is None else json.dumps(body, separators=(",", ":"), allow_nan=False).encode()
            connection.request(method, getattr(self, "prefix", "") + path, body=raw,
                               headers={} if raw is None else {"Content-Type": "application/json"})
            response = connection.getresponse()
            data = response.read(LIMIT + 1)
            require(len(data) <= LIMIT)
            if missing and response.status == 404:
                return None
            require(response.status in (200, 201, 204, 304))
            return inspection.decode_json(data) if data else None
        finally:
            connection.close()

    def inspect(self, target, missing=False):
        require(target in (NAME, CANDIDATE, BACKUP, "supabase-db") or bool(CID.fullmatch(target)))
        return self.request("GET", "/containers/" + target + "/json", missing=missing)

    def effect(self, target, operation, query=""):
        require(bool(CID.fullmatch(target)))
        require(operation in ("start", "stop", "rename"))
        return self.request("POST", "/containers/" + target + "/" + operation + query)

    def remove_candidate(self, target):
        require(bool(CID.fullmatch(target)))
        self.request("DELETE", "/containers/" + target + "?force=true&v=false")


def endpoint_inputs(endpoint):
    # Dynamic addresses/IDs are assigned by Docker; only writable configuration is
    # copied. Explicit address/links are outside this exact observed deployment.
    require(endpoint.get("IPAMConfig") in (None, {}))
    require(endpoint.get("Links") in (None, []))
    return {k: copy.deepcopy(endpoint[k]) for k in ("IPAMConfig", "Links", "Aliases", "DriverOpts", "GwPriority") if k in endpoint}


def replacement(old, password):
    config = copy.deepcopy(old["Config"])
    env = inspection.env_map(config["Env"])
    uri = env["PGRST_DB_URI"]
    scheme, authority = uri.split("://", 1)
    server = authority.rsplit("@", 1)[1]
    env["PGRST_DB_URI"] = scheme + "://" + ROLE + ":" + quote(password, safe="") + "@" + server
    env["PGRST_DB_SCHEMAS"] = "living_menaion,menaion_feedback"
    config["Env"] = [line.split("=", 1)[0] + "=" + env[line.split("=", 1)[0]] for line in config["Env"]]
    config["Image"] = old["Image"]  # immutable ID, not a mutable tag
    networks = old["NetworkSettings"]["Networks"]
    return {**config, "HostConfig": copy.deepcopy(old["HostConfig"]),
            "NetworkingConfig": {"EndpointsConfig": {n: endpoint_inputs(v) for n, v in networks.items()}}}


def fidelity(actual, expected, image, network, *, prestart_oom_default=False):
    config = {k: v for k, v in expected.items() if k not in ("HostConfig", "NetworkingConfig")}
    require(strict_equal(actual["Config"], config))
    host = actual["HostConfig"]
    if (prestart_oom_default is True and actual["State"].get("Status") == "created"
            and actual["State"].get("Running") is False
            and "OomKillDisable" in expected["HostConfig"]
            and expected["HostConfig"]["OomKillDisable"] is None
            and host.get("OomKillDisable") is False):
        # Moby on hosts without OOM-kill-disable support sets null->false during
        # create, then false->null during start. This prestart-only representation
        # allowance requires a daemon capability check; the RUNNING comparison
        # below remains exact. Never accept true, 0, missing fields or other drift.
        host = {**host, "OomKillDisable": None}
    require(strict_equal(host, expected["HostConfig"]))
    require(actual["Image"] == image)
    require(actual.get("Mounts") == [])
    networks = actual["NetworkSettings"]["Networks"]
    require(set(networks) == {network})
    require(strict_equal(endpoint_inputs(networks[network]), expected["NetworkingConfig"]["EndpointsConfig"][network]))


def changed_env(raw, proposed):
    env = inspection.env_map(proposed["Env"])
    result, seen = [], set()
    for line in raw.decode("utf-8").splitlines(keepends=True):
        key = line.split("=", 1)[0]
        if key in ("PGRST_DB_URI", "PGRST_DB_SCHEMAS"):
            require(key not in seen)
            seen.add(key)
            ending = "\r\n" if line.endswith("\r\n") else "\n" if line.endswith("\n") else ""
            result.append(key + "=" + env[key] + ending)
        else:
            result.append(line)
    require(seen == {"PGRST_DB_URI", "PGRST_DB_SCHEMAS"})
    return "".join(result).encode()


def validate_password(data):
    # Deliberately printable ASCII: psql prompt encoding and line delimiters are
    # unambiguous. Owner must use a password manager's random 32-96 character value.
    require(type(data) is bytes and 32 <= len(data) <= 96 and all(33 <= c <= 126 for c in data))
    return data.decode("ascii")


def psql_args(db_id):
    require(db_id == "supabase-db" or bool(CID.fullmatch(db_id)))
    argv = PSQL[:]
    argv[argv.index("supabase-db")] = db_id
    return argv


def sql(text, db_id="supabase-db"):
    return inspection.command(psql_args(db_id), text.encode())


def set_password(password, role_oid, db_id):
    require(bool(CID.fullmatch(db_id)))
    # psql/libpq encrypts before sending SQL. No plaintext ALTER ROLE interpolation,
    # environment binding, argv, disk write or logger suppression is used.
    require(type(role_oid) is int and role_oid > 0)
    guard = "do $$ begin if not exists(select from pg_authid where oid=" + str(role_oid) + " and rolname='menaion_rest_authenticator' and not rolcanlogin and rolpassword is null and not(rolsuper or rolinherit or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication)) or current_database()<>'living_menaion' or current_user<>'supabase_admin' or inet_server_addr() is not null then raise exception 'credential target drift'; end if; end $$;"
    inspection.command(psql_args(db_id) + ["-c", "begin; " + guard, "-c", "\\password " + ROLE, "-c", "commit;"], (password + "\n" + password + "\n").encode())
    require(sql("select (not rolcanlogin and rolpassword like 'SCRAM-SHA-256$%') from pg_authid where rolname='" + ROLE + "';", db_id).strip() == b"t")


def disable_role(role_oid, db_id):
    require(bool(CID.fullmatch(db_id)))
    require(type(role_oid) is int and role_oid > 0)
    require(sql("select oid=" + str(role_oid) + " from pg_roles where rolname='menaion_rest_authenticator';", db_id).strip() == b"t")
    sql("begin; alter role menaion_rest_authenticator nologin password null; commit;"
        "select pg_terminate_backend(pid) from pg_stat_activity where usename='menaion_rest_authenticator' and pid<>pg_backend_pid();", db_id)
    require(sql("select not rolcanlogin and rolpassword is null and not exists(select from pg_stat_activity where usename='menaion_rest_authenticator') from pg_authid where rolname='menaion_rest_authenticator';", db_id).strip() == b"t")


def service_container(docker, project, service):
    filters = quote(json.dumps({"label": ["com.docker.compose.project=" + project, "com.docker.compose.service=" + service]}), safe="")
    containers = docker.request("GET", "/containers/json?all=true&filters=" + filters)
    require(type(containers) is list and len(containers) == 1)
    cid = containers[0]["Id"]
    require(bool(CID.fullmatch(cid)))
    return docker.inspect(cid)


def base64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=")


def probe_token(env):
    secret = env["PGRST_JWT_SECRET"]
    require(not secret.startswith(("@", "{")))
    key = secret.encode()
    if env.get("PGRST_JWT_SECRET_IS_BASE64", "false") == "true":
        key = base64.b64decode(secret, validate=True)
    else:
        require(env.get("PGRST_JWT_SECRET_IS_BASE64", "false") == "false")
    require(len(key) >= 32)
    now = int(time.time())
    claims = {"role": "menaion_feedback_submit", "aud": "menaion-feedback", "iat": now, "exp": now + 120}
    raw = base64url(b'{"alg":"HS256","typ":"JWT"}') + b"." + base64url(json.dumps(claims, separators=(",", ":")).encode())
    return (raw + b"." + base64url(hmac.new(key, raw, hashlib.sha256).digest())).decode()


def http_probe(container, network, token, profile, path, method="GET", body=None):
    require(container["State"].get("Running") is True)
    ip = container["NetworkSettings"]["Networks"][network]["IPAddress"]
    require(inspection.private_ip(ip))
    conn = http.client.HTTPConnection(ip, 3000, timeout=4)
    try:
        headers = {"Authorization": "Bearer " + token, "Accept-Profile": profile,
                   "Content-Profile": profile, "Content-Type": "application/json"}
        conn.request(method, path, body=None if body is None else json.dumps(body), headers=headers)
        response = conn.getresponse()
        raw = response.read(16385)
        require(len(raw) <= 16384)
        return response.status, inspection.decode_json(raw)
    finally:
        conn.close()


def legacy_probe(container, network, token):
    status, result = http_probe(container, network, token, "living_menaion", "/liturgical_day_editions?select=id&limit=0")
    require(status == 200 and result == [])


def denial(status, result, codes):
    require(type(result) is dict and result.get("code") in codes and ((result["code"] == "42501" and status == 403) or (result["code"] == "PGRST106" and status == 406)))


def isolated_probe(container, shared, network, token):
    # Invalid input exits before counters or writes, while proving signature,
    # expiry/audience/role, RPC dispatch, and the dedicated authenticator membership.
    invalid_path = "/rpc/submit_pronunciation_correction?corrected_word=&civil_date=&client_hash=" + "0" * 64
    # PostgREST executes GET RPCs in READ ONLY transactions, including VOLATILE
    # functions. An unexpected write therefore aborts instead of committing.
    status, result = http_probe(container, network, token, "menaion_feedback", invalid_path)
    require(status == 200 and result == "invalid")
    # Only READ ONLY GET probes run against the API. UPDATE/DELETE denial is
    # checked in read-only catalog SQL, avoiding statement-trigger side effects.
    for method, path, body in (
        ("GET", "/pronunciation_entries?select=canonical_token&limit=0", None),
        ("GET", "/liturgical_day_editions?select=id&limit=0", None),
    ):
        status, result = http_probe(container, network, token, "living_menaion", path, method, body)
        denial(status, result, {"42501"})
    status, result = http_probe(container, network, token, "menaion_feedback_private", "/rate_buckets?limit=0")
    denial(status, result, {"PGRST106"})
    status, result = http_probe(shared, network, token, "menaion_feedback", invalid_path)
    denial(status, result, {"42501", "PGRST106"})


def shared_fingerprint(container):
    return {k: container[k] for k in ("Id", "Name", "Image", "Config", "HostConfig")}


class Activation:
    def __init__(self, docker, home, source_sha="unpublished", run_id="local-test"):
        self.source_sha, self.run_id = source_sha, run_id
        self.docker = docker
        self.directory = home / ".living-menaion"
        self.env_path = self.directory / "postgrest.env"
        self.journal_path = self.directory / "feedback-activation.json"
        self.backup_path = self.directory / "feedback-runtime.backup.json"
        self.old_env_path = self.directory / "feedback-runtime.backup.env"
        self.state = None
        self.rollback_verified = False
        self.rollback_durable = False

    def save(self, phase):
        self.state["phase"] = phase
        # Secrets belong only in the private runtime backup, never in the journal.
        snapshot = {k: self.state[k] for k in ("old", "shared", "proposed") if k in self.state}
        atomic_write(self.backup_path, json.dumps(snapshot, separators=(",", ":"), allow_nan=False).encode())
        journal = {k: v for k, v in self.state.items() if k not in ("old", "shared", "proposed")}
        atomic_write(self.journal_path, json.dumps(journal, separators=(",", ":"), allow_nan=False).encode())

    def load(self):
        value = inspection.decode_json(private_read(self.journal_path))
        require(type(value) is dict and type(value.get("version")) is int and value["version"] == VERSION)
        snapshot = inspection.decode_json(private_read(self.backup_path))
        require(type(snapshot) is dict and set(snapshot) in ({"old", "shared"}, {"old", "shared", "proposed"}))
        require(not set(value) & set(snapshot))
        value.update(snapshot)
        require(type(value.get("role_oid")) is int and value["role_oid"] > 0)
        require(bool(CID.fullmatch(value.get("db_id", ""))))
        require(value.get("phase") in {"prepared", "creating", "created", "password", "login", "stopping", "renaming_old", "renaming_new", "starting", "writing_env", "verified", "rolling_back", "rolled_back"})
        require(bool(CID.fullmatch(value.get("old_id", ""))) and value["old"]["Id"] == value["old_id"])
        require(value["old"].get("Name") == "/" + NAME)
        require(value["network"] in value["old"]["NetworkSettings"]["Networks"])
        require(bool(CID.fullmatch(value.get("kong_id", ""))))
        require(value.get("candidate_id") is None or bool(CID.fullmatch(value["candidate_id"])))
        self.state = value
        return value

    def prepare(self):
        require(not any(p.exists() for p in (self.journal_path, self.backup_path, self.old_env_path)))
        require(self.docker.inspect(CANDIDATE, missing=True) is None and self.docker.inspect(BACKUP, missing=True) is None)
        old = self.docker.inspect(NAME)
        require(bool(CID.fullmatch(old["Id"])))
        db = self.docker.inspect("supabase-db")
        image = self.docker.request("GET", "/images/" + quote(old["Image"], safe=":") + "/json")
        raw = private_read(self.env_path)
        facts = inspection.runtime_facts(old, db, image, inspection.env_file_map(raw.decode()))
        required = ("containers_running", "immutable_image_resolved", "runtime_name_exact", "env_file_matches_effective_docker_env", "single_expected_network", "database_on_expected_network", "network_attachment_has_no_custom_ipam", "network_attachment_has_no_links", "container_has_no_mounts", "container_has_no_tty_or_stdin", "container_detached_output", "content_schema_only", "jwt_secret_present", "jwt_audience_unset", "db_pre_config_unset", "log_level_not_debug", "server_port_is_default", "ip_is_private_ipv4", "uri_shape_recognized", "database_is_living_menaion", "authenticator_is_shared", "database_host_matches_db_network_alias")
        for key in required:
            require(facts[key])
        # WorkingDir/Labels/MaskedPaths are preserved verbatim, not guessed from
        # image/daemon defaults. Other executable overrides remain bounded.
        require(set(facts["image_default_field_differences"]) <= {"WorkingDir", "Labels"})
        require(set(facts["incompatible_known_host_fields"]) <= {"MaskedPaths"})
        require(facts["missing_required_host_fields"] == [] and facts["unreviewed_host_field_count"] == 0)
        require(old["HostConfig"]["RestartPolicy"] == {"Name": "unless-stopped", "MaximumRetryCount": 0})
        db_facts = inspection.database_facts()
        for key in inspection.DB_FIELDS:
            require(db_facts[key])
        network = next(iter(old["NetworkSettings"]["Networks"]))
        project = db["Config"]["Labels"]["com.docker.compose.project"]
        shared = service_container(self.docker, project, "rest")
        require(shared["Id"] != old["Id"] and shared["State"].get("Running") is True)
        kong = service_container(self.docker, project, "kong")
        kong_env = inspection.env_map(kong["Config"]["Env"])
        token = kong_env.get("SUPABASE_SERVICE_KEY") or kong_env.get("SERVICE_ROLE_KEY")
        require(type(token) is str and bool(token) and not any(c.isspace() for c in token))
        legacy_probe(old, network, token)
        old_env = inspection.env_map(old["Config"]["Env"])
        require(old_env.get("PGRST_JWT_ROLE_CLAIM_KEY", ".role") == ".role")
        probe_token(old_env)  # Validate supported verifier representation before any effect.
        role_oid_raw = sql("select oid from pg_roles where rolname='menaion_rest_authenticator';").strip()
        require(bool(re.fullmatch(rb"[1-9][0-9]{0,9}", role_oid_raw)))
        # Backup first. A crash before the journal is written fails closed and
        # requires owner inspection of the private backup, without runtime effects.
        atomic_write(self.old_env_path, raw)
        self.state = {"version": VERSION, "phase": "prepared", "old_id": old["Id"], "old": old,
                      "network": network, "role_oid": int(role_oid_raw), "db_id": db["Id"], "source_sha": self.source_sha, "run_id": self.run_id,
                      "shared": shared_fingerprint(shared), "kong_id": kong["Id"], "candidate_id": None}
        self.save("prepared")
        return token, shared

    def candidate(self):
        matches = []
        for name in (CANDIDATE, NAME):
            item = self.docker.inspect(name, missing=True)
            if item and item["Id"] != self.state["old_id"]:
                matches.append(item)
        require(len(matches) <= 1)
        if not matches:
            return None
        item = matches[0]
        if self.state.get("candidate_id"):
            require(item["Id"] == self.state["candidate_id"])
        else:
            # Lost create response: reconcile only the deterministic, fully matching
            # stopped candidate. Never remove a foreign container on a name alone.
            require("proposed" in self.state)
            require(item["State"].get("Running") is False)
            fidelity(item, self.state["proposed"], self.state["old"]["Image"], self.state["network"],
                     prestart_oom_default=self.docker.oom_kill_disable_supported is False)
        return item

    def verify_shared(self):
        actual = self.docker.inspect(self.state["shared"]["Id"])
        require(strict_equal(shared_fingerprint(actual), self.state["shared"]))
        require(actual["State"].get("Running") is True)
        return actual

    def database_target(self):
        require(self.docker.inspect("supabase-db")["Id"] == self.state["db_id"])
        return self.state["db_id"]

    def activate(self, password):
        token, shared = self.prepare()
        try:
            self.state["proposed"] = replacement(self.state["old"], password)
            self.save("creating")
            created = self.docker.request("POST", "/containers/create?name=" + CANDIDATE, self.state["proposed"])
            require(type(created) is dict and bool(CID.fullmatch(created.get("Id", ""))))
            self.state["candidate_id"] = created["Id"]
            self.save("created")
            fidelity(self.docker.inspect(created["Id"]), self.state["proposed"], self.state["old"]["Image"], self.state["network"],
                     prestart_oom_default=self.docker.oom_kill_disable_supported is False)
            self.save("password")
            set_password(password, self.state["role_oid"], self.database_target())
            self.save("login")
            sql("alter role menaion_rest_authenticator login;", self.database_target())
            self.save("stopping")
            self.docker.effect(self.state["old_id"], "stop", "?t=10")
            self.save("renaming_old")
            self.docker.effect(self.state["old_id"], "rename", "?name=" + BACKUP)
            self.save("renaming_new")
            self.docker.effect(created["Id"], "rename", "?name=" + NAME)
            self.save("starting")
            self.docker.effect(created["Id"], "start")
            require(sql("begin read only; select not has_schema_privilege('menaion_feedback_submit','living_menaion','USAGE') and not has_table_privilege('menaion_feedback_submit','living_menaion.pronunciation_entries','UPDATE,DELETE') and not has_any_column_privilege('menaion_feedback_submit','living_menaion.pronunciation_entries','UPDATE'); rollback;", self.database_target()).strip() == b"t")
            narrow = probe_token(inspection.env_map(self.state["proposed"]["Env"]))
            for attempt in range(30):
                try:
                    running = self.docker.inspect(created["Id"])
                    legacy_probe(running, self.state["network"], token)
                    isolated_probe(running, shared, self.state["network"], narrow)
                    break
                except Exception:
                    if attempt == 29:
                        raise Refused("readiness failed") from None
                    time.sleep(1)
            fidelity(running, self.state["proposed"], self.state["old"]["Image"], self.state["network"])
            self.verify_shared()
            require(sql("select rolcanlogin and rolpassword like 'SCRAM-SHA-256$%' and exists(select from pg_stat_activity where usename='menaion_rest_authenticator' and datname='living_menaion') from pg_authid where rolname='menaion_rest_authenticator';", self.database_target()).strip() == b"t")
            self.save("writing_env")
            atomic_write(self.env_path, changed_env(private_read(self.old_env_path), self.state["proposed"]))
            require(inspection.read_private_env(self.env_path) == inspection.env_file_map(changed_env(private_read(self.old_env_path), self.state["proposed"]).decode()))
            self.save("verified")
        except BaseException:
            self.rollback()
            raise Refused("activation failed and rollback verified") from None

    def rollback(self):
        if self.state is None:
            self.load()
        self.rollback_verified = self.rollback_durable = False
        for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            signal.signal(sig, signal.SIG_IGN)
        errors, persistence_errors = [], []
        try:
            self.save("rolling_back")
        except BaseException:
            persistence_errors.append(True)
        # Journal/disk failure must never prevent credential revocation or bringing
        # back the intact old container, which already carries its original env.
        candidate = None
        try:
            candidate = self.candidate()
            if candidate:
                self.docker.effect(candidate["Id"], "stop", "?t=10")
        except BaseException:
            errors.append(True)
        try:
            disable_role(self.state["role_oid"], self.database_target())
        except BaseException:
            errors.append(True)
        old = None
        try:
            old = self.docker.inspect(self.state["old_id"])
            require(old["Name"] in ("/" + NAME, "/" + BACKUP))
            require(strict_equal(shared_fingerprint(old), {**shared_fingerprint(self.state["old"]), "Name": old["Name"]}))
        except BaseException:
            errors.append(True)
            old = None
        try:
            if candidate:
                self.docker.remove_candidate(candidate["Id"])
        except BaseException:
            errors.append(True)
        if old:
            try:
                if old["Name"] != "/" + NAME:
                    self.docker.effect(old["Id"], "rename", "?name=" + NAME)
            except BaseException:
                errors.append(True)
            try:
                atomic_write(self.env_path, private_read(self.old_env_path))
                require(private_read(self.env_path) == private_read(self.old_env_path))
            except BaseException:
                errors.append(True)
            try:
                self.docker.effect(old["Id"], "start")
                kong = self.docker.inspect(self.state["kong_id"])
                env = inspection.env_map(kong["Config"]["Env"])
                token = env.get("SUPABASE_SERVICE_KEY") or env.get("SERVICE_ROLE_KEY")
                require(type(token) is str and bool(token))
                for attempt in range(30):
                    try:
                        restored = self.docker.inspect(old["Id"])
                        legacy_probe(restored, self.state["network"], token)
                        break
                    except Exception:
                        if attempt == 29:
                            raise Refused("rollback readiness") from None
                        time.sleep(1)
                require(strict_equal(shared_fingerprint(restored), shared_fingerprint(self.state["old"])))
                self.verify_shared()
            except BaseException:
                errors.append(True)
        self.rollback_verified = not errors
        if self.rollback_verified:
            try:
                self.save("rolled_back")
                self.rollback_durable = True
            except BaseException:
                persistence_errors.append(True)
        require(not errors and not persistence_errors)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if not (len(argv) == 3 and argv[0] in ("--activate", "--rollback") and re.fullmatch(r"[0-9a-f]{40}", argv[1]) and re.fullmatch(r"[1-9][0-9]{0,19}", argv[2])):
        print('{"ok":false,"error":"explicit_operator_action_required"}')
        return 2
    runner = None
    try:
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        os.umask(0o077)
        for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            signal.signal(sig, lambda *_: (_ for _ in ()).throw(Interrupted()))
        home = Path.home()
        # Validate existing ownership before creating any state/lock file.
        private_read(home / ".living-menaion" / "postgrest.env")
        fd = os.open(home / ".living-menaion" / "feedback-activation.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "w") as lock:
            info = os.fstat(lock.fileno())
            require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600 and info.st_uid == os.geteuid() and info.st_nlink == 1)
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            runner = Activation(Docker(), home, argv[1], argv[2])
            if argv[0] == "--activate":
                password = validate_password(sys.stdin.buffer.read(97))
                runner.activate(password)
            else:
                runner.rollback()
        print(json.dumps({"ok": True, "action": argv[0][2:], "runtime_verified": argv[0] == "--activate", "form_ready": False}))
        return 0
    except BaseException:
        phase = runner.state.get("phase") if runner and runner.state else None
        durable_recovery = bool(runner and runner.rollback_verified and runner.rollback_durable)
        # Failure to load recovery state is uncertainty, never evidence that the
        # prior activation is inactive. Do not mutate unknown state to resolve it.
        try:
            retained = any((Path.home() / ".living-menaion" / name).exists() for name in
                           ("feedback-activation.json", "feedback-runtime.backup.json", "feedback-runtime.backup.env"))
        except BaseException:
            retained = True
        recovery_required = not durable_recovery and (argv[0] == "--rollback" or retained or phase not in (None, "prepared"))
        print(json.dumps({"ok": False, "error": "operation_refused_no_configuration_disclosed", "rollback_verified": bool(runner and runner.rollback_verified), "operator_recovery_required": recovery_required}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
