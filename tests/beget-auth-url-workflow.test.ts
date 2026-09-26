import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflow = fs.readFileSync(
  path.join(process.cwd(), ".github", "workflows", "repair-beget-auth-urls.yml"),
  "utf8",
);

const remoteScript = fs.readFileSync(
  path.join(process.cwd(), "scripts", "repair-beget-auth-urls-remote.sh"),
  "utf8",
);

const callbackVerifier = fs.readFileSync(
  path.join(process.cwd(), "scripts", "verify-auth-callback-surface.sh"),
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
    expect(remoteScript).toContain("set_env_line SITE_URL");
    expect(remoteScript).toContain("set_env_line ADDITIONAL_REDIRECT_URLS");
    expect(remoteScript).toContain("set_env_line API_EXTERNAL_URL");
  });

  it("keeps the production workflow manual-only and delegates remote logic to a syntax-checked script", () => {
    const triggerBlock = workflow.slice(
      workflow.indexOf("on:"),
      workflow.indexOf("\n\npermissions:"),
    );

    expect(triggerBlock).toContain("workflow_dispatch:");
    expect(triggerBlock).not.toContain("push:");
    expect(triggerBlock).not.toContain("pull_request:");
    expect(workflow).toContain("< scripts/repair-beget-auth-urls-remote.sh");
    expect(workflow).not.toContain("<<'REMOTE'");
    expect(remoteScript).toMatch(/^set -Eeuo pipefail\n/);
  });

  it("detaches Compose commands from streamed bash stdin before host mutation", () => {
    expect(remoteScript).toContain('"${args[@]}" config -q </dev/null');
    expect(remoteScript).toContain('"${args[@]}" </dev/null');
    expect(remoteScript).toContain(
      '\'printf "%s\\\\n" "$API_EXTERNAL_URL" "$GOTRUE_SITE_URL" "$GOTRUE_URI_ALLOW_LIST" "$GOTRUE_JWT_ISSUER"\' </dev/null)',
    );

    const preflightRun = remoteScript.indexOf(
      "run --rm --no-deps -T --entrypoint /bin/sh auth",
    );
    const detachedRunStdin = remoteScript.indexOf("</dev/null)", preflightRun);
    const hostWrite = remoteScript.indexOf(
      'docker_write_host_file "${scratch_env}" "${env_file}"',
    );

    expect(preflightRun).toBeGreaterThan(-1);
    expect(detachedRunStdin).toBeGreaterThan(preflightRun);
    expect(hostWrite).toBeGreaterThan(detachedRunStdin);
  });

  it("recreates only Auth, preserves the image and all non-URL Auth environment, and has rollback", () => {
    expect(remoteScript).toContain("up -d --no-deps --force-recreate auth");
    expect(remoteScript).toContain("Auth environment changed outside the approved URL variables.");
    expect(remoteScript).toContain("Auth image changed unexpectedly.");
    expect(remoteScript).toContain("Auth URL repair rolled back and verified.");
    expect(remoteScript).toContain("for service in db rest realtime storage kong");
    expect(remoteScript).not.toMatch(/\bpsql\b/i);
    expect(remoteScript).not.toMatch(/alter\s+database/i);
    expect(remoteScript).not.toContain("GOTRUE_JWT_SECRET");
    expect(remoteScript).not.toContain("PGRST_JWT_SECRET");
  });

  it("handles root-owned Compose files without sudo or permission widening", () => {
    expect(remoteScript).toContain("docker_read_host_file");
    expect(remoteScript).toContain("docker_write_host_file");
    expect(remoteScript).toContain("docker run --rm --user 0:0");
    expect(remoteScript).toContain("docker run --rm -i --user 0:0");
    expect(remoteScript).toContain("--project-directory");
    expect(remoteScript).not.toContain("sudo -n");
    expect(remoteScript).not.toMatch(/chmod\\s+(?:[0-7]*[2367]|[^\\n]*[+][^\\n]*w)[^\\n]*\\$\\{env_file\\}/);
  });

  it("uses a final Auth-only override and proves its rendered environment before host mutation", () => {
    expect(remoteScript).toContain('scratch_override="${scratch}/auth-url-override.yml"');
    expect(remoteScript).toContain("GOTRUE_JWT_ISSUER: ${GOTRUE_JWT_ISSUER}");
    expect(remoteScript).toContain("set_env_line GOTRUE_JWT_ISSUER");
    expect(remoteScript).toContain("validate_rendered_auth");
    expect(remoteScript).toContain("run --rm --no-deps -T --entrypoint /bin/sh auth");
    expect(remoteScript).toContain('"${rendered_auth[0]}" == "${target_api}"');
    expect(remoteScript).toContain('"${rendered_auth[3]}" == "${target_api}"');
    expect(remoteScript).toContain("Rendered Auth Compose configuration is not canonical");
    expect(remoteScript).toContain("compose_auth_up 1");
    expect(remoteScript).toContain("compose_auth_up 0");
    expect(remoteScript).not.toContain("issuer_config_touched");
    expect(remoteScript).not.toContain("scratch_config_backups");

    const preflight = remoteScript.indexOf("validate_rendered_auth\n");
    const hostWrite = remoteScript.indexOf('docker_write_host_file "${scratch_env}" "${env_file}"', preflight);
    expect(preflight).toBeGreaterThan(-1);
    expect(hostWrite).toBeGreaterThan(preflight);
  });

  it("recovers from stale temporary Compose labels by rediscovering the canonical working-directory files", () => {
    expect(remoteScript).toContain('case "${env_file}" in');
    expect(remoteScript).toContain('*) env_file="${working_dir}/.env"');
    expect(remoteScript).toContain("docker-compose.yml docker-compose.yaml compose.yml compose.yaml");
    expect(remoteScript).toContain("Cannot rediscover a canonical Compose base file under the working directory.");
  });

  it("pins checkout and verifies public Auth health and the canonical callback", () => {
    expect(workflow).toContain(
      "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
    );
    expect(workflow).toContain("/auth/v1/health");
    expect(workflow).toContain("/auth/v1/settings");
    expect(workflow).toContain(
      'bash scripts/verify-auth-callback-surface.sh "${TARGET_SITE_URL}"',
    );
    expect(callbackVerifier).toContain('current="${site}/auth/callback"');
    expect(callbackVerifier).toContain(
      "AUTH_MAGIC_LINK_REDIRECT_CONFIGURATION_VERIFIED=1",
    );
    expect(workflow).not.toContain('case "${location}" in');
  });
});
