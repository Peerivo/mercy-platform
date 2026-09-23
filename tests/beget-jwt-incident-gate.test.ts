import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";

const gate = path.join(process.cwd(), "scripts", "check-beget-jwt-incident-gate.sh");

function check(mode: string, attestation?: string, runId?: string, ref?: string) {
  return spawnSync("bash", [gate, mode], {
    encoding: "utf8",
    env: {
      ...process.env,
      BEGET_JWT_ROTATION_ATTESTATION: attestation ?? "",
      RECOVER_FROM_RUN_ID: runId ?? "",
      GITHUB_ACTIONS: ref ? "true" : "false",
      GITHUB_REF: ref ?? "",
    },
  });
}

describe("Beget JWT incident gate", () => {
  test("fails closed on MIGRATE before rotation attestation", () => {
    expect(check("MIGRATE").status).toBe(1);
    expect(check("MIGRATE", "log-deleted").status).toBe(1);
  });

  test("permits MIGRATE only with the protected rotation attestation", () => {
    expect(check("MIGRATE", "rotated-and-verified-after-run-8").status).toBe(0);
  });

  test("permanently quarantines the old archive even if the attestation is removed", () => {
    expect(check("RECOVER", undefined, "35770879007").status).toBe(1);
    expect(check("RECOVER", "rotated-and-verified-after-run-8", "35770879007").status).toBe(1);
    expect(check("MIGRATE", undefined, "35770879007").status).toBe(1);
    expect(check("MIGRATE", "rotated-and-verified-after-run-8", "35770879007").status).toBe(1);
    expect(check("RECOVER", undefined, "999999").status).toBe(0);
    expect(check("RECOVER", "rotated-and-verified-after-run-8", "999999").status).toBe(0);
  });

  test("rejects unknown modes and never prints the attestation value", () => {
    const result = check("UNKNOWN", "rotated-and-verified-after-run-8");
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain("rotated-and-verified-after-run-8");
  });

  test("rejects workflow dispatch from a non-main ref", () => {
    expect(check("MIGRATE", "rotated-and-verified-after-run-8", "", "refs/heads/old-cutover").status).toBe(1);
    expect(check("RECOVER", undefined, "999999", "refs/tags/old-cutover").status).toBe(1);
    expect(check("RECOVER", undefined, "999999", "refs/heads/main").status).toBe(0);
  });
});
