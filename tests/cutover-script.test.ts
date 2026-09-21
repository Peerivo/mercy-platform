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
    expect(unfreezeBlock?.[1]).toMatch(/COMMIT;\s*$/);
  });
});
