import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const workflow = readFileSync(
  new URL("../.github/workflows/repair-beget-jwt-db-setting.yml", import.meta.url),
  "utf8"
);

describe("Beget JWT database-setting repair workflow", () => {
  test("is manual, production-scoped and main-only", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain('refs/heads/main');
    expect(workflow).toContain("REPAIR_JWT_DB_SETTING");
  });

  test("derives the rotated secret from running services without placing it in GitHub secrets or logs", () => {
    expect(workflow).toContain("GOTRUE_JWT_SECRET");
    expect(workflow).toContain("PGRST_JWT_SECRET");
    expect(workflow).not.toContain("BEGET_JWT_SECRET");
    expect(workflow).not.toMatch(/echo .*jwt_secret/i);
  });

  test("uses database FROM CURRENT and stdin so the secret is not embedded in SQL or process arguments", () => {
    expect(workflow).toContain('alter database postgres set "app.settings.jwt_secret" from current;');
    expect(workflow).toContain('printf \'%s\\n\' "${rest_jwt}" | docker exec -i');
    expect(workflow).not.toContain('alter database postgres set "app.settings.jwt_secret" to');
    expect(workflow).not.toContain("psql -v jwt_secret=");
  });

  test("verifies Auth, REST and optional Storage runtime secret agreement before mutation", () => {
    expect(workflow).toContain('[[ "${auth_jwt}" == "${rest_jwt}" ]]');
    expect(workflow).toContain("storage_jwt");
    expect(workflow).toContain("Database JWT setting verification failed.");
  });
});
