import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";

const scriptPath = path.join(process.cwd(), "scripts", "cutover-beget.sh");
const workflowPath = path.join(process.cwd(), ".github", "workflows", "cutover-to-beget.yml");
const preflightWorkflowPath = path.join(process.cwd(), ".github", "workflows", "migrate-to-beget.yml");
const script = fs.readFileSync(scriptPath, "utf8");
const workflow = fs.readFileSync(workflowPath, "utf8");
const preflightWorkflow = fs.readFileSync(preflightWorkflowPath, "utf8");

describe("Beget cutover freeze transport", () => {
  test("has valid Bash syntax", () => {
    expect(() => execFileSync("bash", ["-n", scriptPath])).not.toThrow();
  });
  test("streams freeze SQL through an attached Docker stdin", () => {
    expect(script).toMatch(/source_psql_stdin\(\)\s*\{[\s\S]*docker run --rm -i[\s\S]*psql -v ON_ERROR_STOP=1 -f \/dev\/stdin/);
    expect(script).toContain('source_psql_stdin < "${LOCAL_WORK}/freeze.sql"');
    expect(script).toContain('source_psql_stdin < "${LOCAL_WORK}/unfreeze.sql"');
  });

  test("arms cleanup before the source freeze can take effect", () => {
    const arm = script.indexOf("frozen=1");
    const execute = script.indexOf('source_psql_stdin < "${LOCAL_WORK}/freeze.sql"');
    expect(arm).toBeGreaterThan(-1);
    expect(execute).toBeGreaterThan(-1);
    expect(arm).toBeLessThan(execute);
  });

  test("wraps freeze and unfreeze SQL in transactions", () => {
    const freezeBlock = script.match(/cat > "\$\{LOCAL_WORK\}\/freeze\.sql" <<'SQL'([\s\S]*?)\nSQL/);
    const unfreezeBlock = script.match(/cat > "\$\{LOCAL_WORK\}\/unfreeze\.sql" <<'SQL'([\s\S]*?)\nSQL/);
    expect(freezeBlock?.[1]).toMatch(/^\nBEGIN;/);
    expect(freezeBlock?.[1]).toMatch(/COMMIT;\s*$/);
    expect(unfreezeBlock?.[1]).toMatch(/^\nBEGIN;/);
    expect(unfreezeBlock?.[1]).toContain("DO $");
    expect(unfreezeBlock?.[1]).toMatch(/COMMIT;\s*$/);
  });
});


describe("Beget cutover remote execution", () => {
  test("runs remote shell loops on Beget instead of interpolating runner variables", () => {
    expect(script).toContain('ssh "${REMOTE}" bash -s -- "${REMOTE_WORK}" <<\'REMOTE\'');
    expect(script).toContain('restart_target_services() {');
    expect(script).toContain('ssh "${REMOTE}" bash -s <<\'REMOTE\'');
    expect(script).not.toContain('ssh "${REMOTE}" "set -euo pipefail');
  });

  test("applies schema, auth data, public data, and migration history in one target transaction", () => {
    expect(script).toContain('echo "== Apply canonical Mercy schema and data on Beget =="');
    expect(script).toContain("printf 'BEGIN;\\n'");
    expect(script).toContain('cat auth-users.sql');
    expect(script).toContain('cat auth-identities.sql');
    expect(script).toContain('cat public-data.sql');
    expect(script).toContain('docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1');
    expect(script).toContain("printf 'COMMIT;\\n'");
  });

  test("restarts Supabase by compose service label instead of a guessed container name", () => {
    expect(script).toContain('services=(auth rest realtime storage kong)');
    expect(script).toContain('com.docker.compose.project');
    expect(script).toContain('com.docker.compose.service=$service');
    expect(script).toContain('docker restart "$cid"');
    expect(script).not.toContain('realtime-dev.supabase-realtime');
  });
});


test("normalizes historical specialist Storage state to the verified empty source profile", () => {
  const applyBlock = script.match(/echo "== Apply canonical Mercy schema and data on Beget =="([\s\S]*?)echo "== Restart and verify Supabase services =="/)?.[1] ?? "";
  const deleteIndex = applyBlock.indexOf("DELETE FROM storage.buckets WHERE id = 'qualification-documents';");
  const replicaBefore = applyBlock.lastIndexOf("SET session_replication_role = replica;", deleteIndex);
  const originAfter = applyBlock.indexOf("SET session_replication_role = origin;", deleteIndex);

  expect(deleteIndex).toBeGreaterThan(-1);
  expect(replicaBefore).toBeGreaterThan(-1);
  expect(replicaBefore).toBeLessThan(deleteIndex);
  expect(originAfter).toBeGreaterThan(deleteIndex);
  expect(script).toContain('target_storage_profile=');
  expect(script).toContain('if [[ "${target_storage_profile}" != "0|0" ]]');
});

test("rejects any pre-existing target Storage bucket before mutation", () => {
  const targetProfile = script.match(/target_profile\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  const freshnessGuard = script.match(/assert_target_fresh\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  const freshnessInvocation = script.indexOf("\nassert_target_fresh\n");

  expect(targetProfile).toContain("count(*) from storage.buckets");
  expect(freshnessGuard).toContain("target_storage_buckets target_storage_objects");
  expect(freshnessGuard).toContain('"${target_storage_buckets}" != "0"');
  expect(freshnessInvocation).toBeGreaterThan(-1);
  expect(freshnessInvocation).toBeLessThan(script.indexOf('echo "== Target safety backup =="'));
  expect(freshnessInvocation).toBeLessThan(script.indexOf('echo "== Apply canonical Mercy schema and data on Beget =="'));
});

test("read-only Beget preflight queries and rejects non-empty Storage", () => {
  expect(preflightWorkflow).toContain("(select count(*) from storage.buckets)");
  expect(preflightWorkflow).toContain("(select count(*) from storage.objects)");
  expect(preflightWorkflow).toContain("read -r pg users help_relation tables policies buckets objects");
  expect(preflightWorkflow).toContain('[ "${buckets}" != "0" ]');
  expect(preflightWorkflow).toContain('[ "${objects}" != "0" ]');
});


describe("Beget cutover recovery", () => {
  test("supports explicit recovery from a retained failed/interrupted-run safety backup before freshness gating", () => {
    expect(script).toContain('RECOVER_FROM_RUN_ID="\${RECOVER_FROM_RUN_ID:-}"');
    expect(script).toContain('RECOVERY_RUN_VERIFIED="\${RECOVERY_RUN_VERIFIED:-0}"');
    expect(script).toContain('if [[ "\${RECOVERY_RUN_VERIFIED}" != "1" ]]');
    expect(script).toContain('recovery_backup="\${recovery_prefix}-postgres.dump"');
    expect(script).toContain('restore_target_backup "${recovery_backup}"');
    const recoveryCall = script.indexOf('restore_target_backup "${recovery_backup}"');
    const freshnessInvocation = script.lastIndexOf("\nassert_target_fresh\n");
    expect(recoveryCall).toBeGreaterThan(-1);
    expect(freshnessInvocation).toBeGreaterThan(-1);
    expect(recoveryCall).toBeLessThan(freshnessInvocation);
  });

  test("arms Beget rollback before remote target mutation", () => {
    expect(script).toContain("target_mutated=0");
    const arm = script.indexOf("target_mutated=1");
    const apply = script.indexOf('ssh "\${REMOTE}" bash -s -- "\${REMOTE_WORK}" <<\'REMOTE\'');
    expect(arm).toBeGreaterThan(-1);
    expect(apply).toBeGreaterThan(-1);
    expect(arm).toBeLessThan(apply);
    expect(script).toContain('restore_target_backup "\${backup_prefix}-postgres.dump"');
  });

  test("restarts Supabase services without requiring access to the compose directory", () => {
    expect(script).toContain("com.docker.compose.project");
    expect(script).toContain("com.docker.compose.service=$service");
    expect(script).toContain('docker restart "$cid"');
    expect(script).not.toContain('cd "$supabase_dir"');
    expect(script).not.toContain('SUPABASE_DIR="/opt/beget/supabase"');
  });

  test("captures database creation metadata and a completed marker in every new safety backup", () => {
    expect(script).toContain("pg_dump -U postgres -d postgres -Fc");
    expect(script).toContain('database_metadata_hash > "${backup_prefix}-dbmeta.md5"');
    expect(script).toContain("printf '%s\\n' 'prepared' > \"${backup_prefix}.state\"");
    expect(script).toContain('cutover-successful-${GITHUB_RUN_ID:-manual}.marker');
  });

  test("authorizes failed/interrupted-run recovery through GitHub Actions before the script can restore", () => {
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("Validate requested failed/interrupted-run recovery");
    expect(workflow).toContain('.conclusion == "failure"');
    expect(workflow).toContain('.conclusion == "timed_out"');
    expect(workflow).toContain('.conclusion == "cancelled"');
    expect(workflow).toContain('.name == "Cut over Mercy Supabase to Beget"');
    expect(workflow).toContain('echo "RECOVERY_RUN_VERIFIED=1" >> "${GITHUB_ENV}"');
    expect(script).toContain("A successful Beget cutover marker exists; failed/interrupted-run recovery is disabled");
  });

  test("rejects incomplete new-format backups and restricts the legacy compatibility path", () => {
    const restoreBlock = script.match(/restore_target_backup\(\) \{([\s\S]*?)\n\}\n\nrestart_target_services/)?.[1] ?? "";
    expect(restoreBlock).toContain('state_file="${backup_prefix}.state"');
    expect(restoreBlock).toContain('"$(tr -d \'[:space:]\' < "$state_file")" == "prepared"');
    expect(restoreBlock).toContain('before-35770879007-postgres.dump');
    expect(restoreBlock).toContain("Safety backup is not prepared, or is not the explicitly supported legacy archive");
  });

  test("recreates target safely while keeping the database container running", () => {
    expect(script).toContain('docker ps --no-trunc -q --filter "label=com.docker.compose.project=$project"');
    expect(script).toContain('docker stop "\${other_ids[@]}"');
    expect(script).toContain("docker exec supabase-db dropdb");
    const restoreBlock = script.match(/restore_target_backup\(\) \{([\s\S]*?)\n\}\n\nrestart_target_services/)?.[1] ?? "";
    expect(restoreBlock).toContain("docker exec -i supabase-db pg_restore");
    expect(restoreBlock).toContain("--create");
    expect(restoreBlock).toContain("database_metadata_hash");
    expect(restoreBlock).toContain('pg_restore -f /dev/null < "$backup_file"');
    expect(restoreBlock).toContain('--create --exit-on-error < "$backup_file"');
    expect(restoreBlock).not.toContain("--no-owner");
    expect(restoreBlock).not.toContain("--no-privileges");
    expect(script).toContain("SET LOCAL ROLE supabase_auth_admin;");
    expect(script).toContain("SET LOCAL ROLE supabase_storage_admin;");
    expect(script).toContain('[[ "$state" == "0||0|0" ]]');
  });
});
