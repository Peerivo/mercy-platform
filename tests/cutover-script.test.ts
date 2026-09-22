import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";

const scriptPath = path.join(process.cwd(), "scripts", "cutover-beget.sh");
const script = fs.readFileSync(scriptPath, "utf8");

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
    expect(script).toContain('ssh "${REMOTE}" bash -s -- "${SUPABASE_DIR}" <<\'REMOTE\'');
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

  test("restarts Supabase by compose service instead of a guessed realtime container name", () => {
    expect(script).toContain('services=(auth rest realtime storage kong)');
    expect(script).toContain('docker compose restart "${services[@]}"');
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
  const freshnessQuery = script.match(/target_fresh=.*?storage\.objects[\s\S]*?fi/);
  expect(freshnessQuery?.[0]).toContain("count(*) from storage.buckets");
  expect(freshnessQuery?.[0]).toContain("target_storage_buckets target_storage_objects");
  expect(freshnessQuery?.[0]).toContain('"${target_storage_buckets}" != "0"');
  expect(script.indexOf("target_fresh=")).toBeLessThan(script.indexOf('echo "== Target safety backup =="'));
  expect(script.indexOf("target_fresh=")).toBeLessThan(script.indexOf('echo "== Apply canonical Mercy schema and data on Beget =="'));
});
