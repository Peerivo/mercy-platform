import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";

const gate = path.join(process.cwd(), "scripts", "check-beget-jwt-incident-gate.sh");

function check(mode: string, attestation?: string, runId?: string) {
  return spawnSync("bash", [gate, mode], {
    encoding: "utf8",
    env: {
      ...process.env,
      BEGET_JWT_ROTATION_ATTESTATION: attestation ?? "",
      RECOVER_FROM_RUN_ID: runId ?? "",
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

  test("allows recovery before attestation but blocks reintroducing the old secret afterward", () => {
    expect(check("RECOVER", undefined, "35770879007").status).toBe(0);
    expect(check("RECOVER", "rotated-and-verified-after-run-8", "35770879007").status).toBe(1);
    expect(check("MIGRATE", "rotated-and-verified-after-run-8", "35770879007").status).toBe(1);
    expect(check("RECOVER", "rotated-and-verified-after-run-8", "999999").status).toBe(0);
  });

  test("rejects unknown modes and never prints the attestation value", () => {
    const result = check("UNKNOWN", "rotated-and-verified-after-run-8");
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain("rotated-and-verified-after-run-8");
  });
});
