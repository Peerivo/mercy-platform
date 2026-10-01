import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const workflowPath = path.join(root, ".github/workflows/migrate-beget-incremental.yml");
const scriptPath = path.join(root, "scripts/migrate-beget-incremental.sh");
const workflow = fs.readFileSync(workflowPath, "utf8");
const script = fs.readFileSync(scriptPath, "utf8");

describe("incremental Beget migration path", () => {
  it("is manual, production-scoped, exact-main and CI gated", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("\n  push:");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("APPLY_BEGET_MIGRATIONS");
    expect(workflow).toContain("expected_sha:");
    expect(workflow).toContain("event=push");
    expect(workflow).toContain("Timed out waiting for successful exact-main CI.");
  });

  it("fails closed unless target migration history is an exact repository prefix", () => {
    expect(script).toContain("Beget migration history is ahead of the repository");
    expect(script).toContain("Beget migration history is not an exact repository prefix");
    expect(script).toContain("Post-migration history does not match the repository exactly");
    expect(script).toContain("supabase_migrations.schema_migrations");
  });

  it("takes a remote pre-change backup and applies each pending migration transactionally", () => {
    expect(script).toContain("pg_dump");
    expect(script).toContain("mercy-beget-pre-migration-");
    expect(script).toContain("--single-transaction");
    expect(script).toContain("ON_ERROR_STOP=1");
    expect(script).toContain("NOTIFY pgrst, 'reload schema'");
    expect(script).not.toContain("OLD_SUPABASE_DB_URL");
  });

  it("has valid shell syntax", () => {
    const result = spawnSync("bash", ["-n", scriptPath], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  });
});
