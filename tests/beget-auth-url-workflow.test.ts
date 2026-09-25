import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflow = fs.readFileSync(
  path.join(process.cwd(), ".github", "workflows", "repair-beget-auth-urls.yml"),
  "utf8",
);

describe("Repair Beget Auth URLs workflow", () => {
  it("is a protected one-shot production repair on exact reviewed main", () => {
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("expected_sha");
    expect(workflow).toContain("REPAIR_AUTH_URLS");
    expect(workflow).toContain("Dispatch revision is no longer current main");
  });

  it("sets only the canonical public Auth URL values", () => {
    expect(workflow).toContain("TARGET_SITE_URL: https://mercy.peerivo.net");
    expect(workflow).toContain(
      "TARGET_REDIRECT_URL: https://mercy.peerivo.net/auth/callback",
    );
    expect(workflow).toContain(
      "TARGET_API_EXTERNAL_URL: https://api.mercy.peerivo.net/auth/v1",
    );
    expect(workflow).toContain("set_env_line SITE_URL");
    expect(workflow).toContain("set_env_line ADDITIONAL_REDIRECT_URLS");
    expect(workflow).toContain("set_env_line API_EXTERNAL_URL");
  });

  it("recreates only Auth, preserves the image and all non-URL Auth environment, and has rollback", () => {
    expect(workflow).toContain("up -d --no-deps --force-recreate auth");
    expect(workflow).toContain("Auth environment changed outside the approved URL variables.");
    expect(workflow).toContain("Auth image changed unexpectedly.");
    expect(workflow).toContain("Auth URL repair rolled back and verified.");
    expect(workflow).toContain("for service in db rest realtime storage kong");
    expect(workflow).not.toMatch(/\bpsql\b/i);
    expect(workflow).not.toMatch(/alter\s+database/i);
    expect(workflow).not.toContain("GOTRUE_JWT_SECRET");
    expect(workflow).not.toContain("PGRST_JWT_SECRET");
  });

  it("handles root-owned Compose files without sudo or permission widening", () => {
    expect(workflow).toContain("docker_read_host_file");
    expect(workflow).toContain("docker_write_host_file");
    expect(workflow).toContain("docker run --rm --user 0:0");
    expect(workflow).toContain("docker run --rm -i --user 0:0");
    expect(workflow).toContain("--project-directory");
    expect(workflow).not.toContain("sudo -n");
    expect(workflow).not.toMatch(/chmod\\s+(?:[0-7]*[2367]|[^\\n]*[+][^\\n]*w)[^\\n]*\\$\\{env_file\\}/);
  });

  it("normalizes issuer derivation across all Compose files in one pass and rolls back every touched file", () => {
    expect(workflow).toContain("issuer_config_touched=()");
    expect(workflow).toContain("s|${API_EXTERNAL_URL}/auth/v1|${API_EXTERNAL_URL}|g");
    expect(workflow).toContain("s|$API_EXTERNAL_URL/auth/v1|$API_EXTERNAL_URL|g");
    expect(workflow).toContain("set_env_line GOTRUE_JWT_ISSUER");
    expect(workflow).toContain("config -q");
    expect(workflow).toContain("scratch_config_backups");
    expect(workflow).toContain('for index in "${issuer_config_touched[@]}"');
    expect(workflow).not.toContain("Expected exactly one supported GOTRUE_JWT_ISSUER mapping.");
  });

  it("pins checkout and verifies public Auth health and the canonical callback", () => {
    expect(workflow).toContain(
      "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
    );
    expect(workflow).toContain("/auth/v1/health");
    expect(workflow).toContain("/auth/v1/settings");
    expect(workflow).toContain("${TARGET_SITE_URL}/auth/callback");
    expect(workflow).toContain("AUTH_MAGIC_LINK_REDIRECT_CONFIGURATION_VERIFIED=1");
  });
});
