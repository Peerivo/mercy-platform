import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const workflow = fs.readFileSync(
  path.join(root, ".github/workflows/repair-beget-auth-session.yml"),
  "utf8",
);
const script = fs.readFileSync(
  path.join(root, "scripts/repair-beget-auth-session-remote.sh"),
  "utf8",
);
const urlRepair = fs.readFileSync(
  path.join(root, "scripts/repair-beget-auth-urls-remote.sh"),
  "utf8",
);
const smtpRepair = fs.readFileSync(
  path.join(root, "scripts/repair-beget-auth-smtp-remote.sh"),
  "utf8",
);

describe("Beget Auth three-day session repair", () => {
  it("is manual, exact-main, production-scoped and CI-gated", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("\n  push:");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("REPAIR_AUTH_SESSION_3D");
    expect(workflow).toContain("event=push");
    expect(workflow).toContain(".conclusion == \"success\"");
    expect(workflow).toContain("github.run_attempt == 1");
  });

  it("pins both maximum lifetime and inactivity to 72 hours", () => {
    expect(script).toContain('target_timebox="72h"');
    expect(script).toContain('target_inactivity="72h"');
    expect(script).toContain("GOTRUE_SESSIONS_TIMEBOX: 72h");
    expect(script).toContain("GOTRUE_SESSIONS_INACTIVITY_TIMEOUT: 72h");
    expect(workflow).toContain("TARGET_TIMEBOX: 72h");
    expect(workflow).toContain("TARGET_INACTIVITY: 72h");
  });

  it("changes only Auth and preserves the rest of the stack", () => {
    expect(script).toContain("up -d --no-deps --force-recreate auth");
    expect(script).toContain("non_session_env_hash");
    expect(script).toContain(
      "Auth environment changed outside the approved session variables.",
    );
    for (const service of ["db", "rest", "realtime", "storage", "kong"]) {
      expect(script).toContain(service);
    }
    expect(script).toContain("Non-Auth service changed unexpectedly");
    expect(script).not.toMatch(
      /psql|ALTER\s+DATABASE|UPDATE\s+|DELETE\s+FROM|INSERT\s+INTO/i,
    );
  });

  it("validates canonical Auth URLs and target rendering before mutation", () => {
    expect(script).toContain("validate_canonical_urls");
    expect(script).toContain("https://api.mercy.peerivo.net/auth/v1");
    expect(script).toContain("https://mercy.peerivo.net/auth/callback");
    const validate = script.indexOf("validate_rendered_auth\n");
    const write = script.indexOf(
      'docker_write_workdir_file "${scratch_target_override}" "${session_override_rel}"',
    );
    expect(validate).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(validate);
  });

  it("persists a dedicated override and restores or removes it on rollback", () => {
    expect(script).toContain(
      'session_override_rel="mercy-auth-session.override.yml"',
    );
    expect(script).toContain("persistent_backup");
    expect(script).toContain("docker_write_workdir_file");
    expect(script).toContain("docker_remove_workdir_file");
    expect(script).toContain("Auth session repair rolled back and verified.");
    expect(script).toContain("full_hash_before");
  });

  it("keeps the session override in future Auth repair fallbacks", () => {
    expect(urlRepair).toContain("mercy-auth-session.override.yml");
    expect(smtpRepair).toContain("mercy-auth-session.override.yml");
  });
});
