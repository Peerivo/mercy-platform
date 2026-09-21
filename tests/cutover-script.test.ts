import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const scriptPath = path.join(process.cwd(), "scripts", "cutover-beget.sh");
const script = fs.readFileSync(scriptPath, "utf8");

describe("Beget cutover freeze transport", () => {
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
  expect(script).toContain("DELETE FROM storage.buckets WHERE id = 'qualification-documents';");
  expect(script).toContain('target_storage_profile=');
  expect(script).toContain('if [[ "${target_storage_profile}" != "0|0" ]]');
});
