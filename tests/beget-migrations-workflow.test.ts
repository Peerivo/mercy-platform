import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflow = fs.readFileSync(
  path.join(process.cwd(), ".github/workflows/apply-beget-migrations.yml"),
  "utf8",
);

describe("protected Beget migration workflow", () => {
  it("is manual, production-scoped and exact-current-main only", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("\n  push:");
    expect(workflow).not.toContain("\n  schedule:");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("APPLY_MERCY_MIGRATIONS");
    expect(workflow).toContain('test "${EXPECTED_SHA}" = "${GITHUB_SHA}"');
    expect(workflow).toContain("refs/remotes/origin/main");
  });

  it("requires green push CI for the exact SHA before SSH mutation", () => {
    const ciGate = workflow.indexOf("actions/workflows/ci.yml/runs?head_sha=");
    const sshValidation = workflow.indexOf("Validate protected Beget access");
    expect(ciGate).toBeGreaterThan(0);
    expect(sshValidation).toBeGreaterThan(ciGate);
    expect(workflow).toContain(".conclusion == \"success\"");
    expect(workflow).toContain(".head_branch == \"main\"");
  });

  it("fails closed on migration-history drift and applies repository migrations in order", () => {
    expect(workflow).toContain("Production migration history is not an exact repository prefix");
    expect(workflow).toContain("LC_ALL=C sort");
    expect(workflow).toContain("^([0-9]{12}|[0-9]{14})_[a-z0-9_]+\\.sql$");
    expect(workflow).toContain('"${version}" "${name}"');
    expect(workflow).not.toContain('"\\${version}" "\\${name}"');
    expect(workflow).toContain("ON_ERROR_STOP=1");
    expect(workflow).toContain("BEGIN;");
    expect(workflow).toContain("supabase_migrations.schema_migrations");
    expect(workflow).toContain("Production migration history does not match repository after apply");
  });

  it("creates a protected backup before applying migrations", () => {
    const backup = workflow.indexOf("Create protected pre-migration database backup");
    const apply = workflow.indexOf("Apply pending repository migrations");
    expect(backup).toBeGreaterThan(0);
    expect(apply).toBeGreaterThan(backup);
    expect(workflow).toContain("pg_dump -U postgres -d postgres -Fc");
    expect(workflow).toContain("umask 077");
    expect(workflow).toContain("mercy-migration-backups");
  });

  it("bootstraps only the requested registered admin through a private database helper", () => {
    expect(workflow).toContain("private.ensure_mercy_admin_by_email('oleg-kabatchenko@yandex.ru')");
    expect(workflow).toContain("Requested Mercy administrator was not verified after bootstrap");
    expect(workflow).toContain("g.role='ADMIN' and g.revoked_at is null");
  });

  it("never uses managed Supabase migration tooling against production", () => {
    expect(workflow).not.toMatch(/supabase\s+db\s+(push|reset)/i);
    expect(workflow).not.toContain("SUPABASE_DB_PASSWORD");
    expect(workflow).not.toContain("SUPABASE_ACCESS_TOKEN");
  });
});
