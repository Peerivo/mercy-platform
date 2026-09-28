import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const workflow = fs.readFileSync(
  path.join(root, ".github/workflows/repair-beget-auth-smtp.yml"),
  "utf8",
);
const script = fs.readFileSync(
  path.join(root, "scripts/repair-beget-auth-smtp-remote.sh"),
  "utf8",
);

describe("Beget Auth SMTP repair workflow", () => {
  it("is manual, production-scoped, exact-main and one-shot", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("\n  push:");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("github.run_number == 1");
    expect(workflow).toContain("github.run_attempt == 1");
    expect(workflow).toContain(
      "APPROVED_BASE_SHA: 7ee28845ffa21d0a55a45c6c1e5f63cb5a641f3f",
    );
    expect(workflow).toContain("git rev-parse HEAD^");
    expect(workflow).toContain("event=push");
    expect(workflow).toContain("REPAIR_AUTH_SMTP");
  });

  it("passes the protected Resend key only through stdin", () => {
    expect(workflow).toContain("RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}");
    expect(workflow).toContain("printf \'%s\' \"${RESEND_API_KEY}\"");
    expect(workflow).toContain("| ssh");
    expect(script).toContain('smtp_pass="$(cat)"');
    expect(script).not.toMatch(/--password|--smtp-pass/i);
  });

  it("changes only the approved SMTP values and recreates only Auth", () => {
    for (const line of [
      'set_env_line SMTP_HOST "${target_host}"',
      'set_env_line SMTP_PORT "${target_port}"',
      'set_env_line SMTP_USER "${target_user}"',
      'set_env_line SMTP_PASS "${smtp_pass}"',
      'set_env_line SMTP_ADMIN_EMAIL "${target_admin}"',
    ]) {
      expect(script).toContain(line);
    }
    expect(script).toContain("up -d --no-deps --force-recreate auth");
    expect(script).not.toMatch(/docker compose[^\n]*(db|rest|storage|realtime|kong)/);
    expect(script).not.toMatch(/psql|ALTER\s+DATABASE|UPDATE\s+|DELETE\s+FROM|INSERT\s+INTO/i);
  });

  it("preserves canonical Auth URLs and non-Auth services", () => {
    expect(script).toContain("validate_canonical_urls");
    expect(script).toContain("https://api.mercy.peerivo.net/auth/v1");
    expect(script).toContain("https://mercy.peerivo.net/auth/callback");
    expect(script).toContain("non_smtp_env_hash");
    expect(script).toContain("Auth environment changed outside the approved SMTP variables.");
    for (const service of ["db", "rest", "realtime", "storage", "kong"]) {
      expect(script).toContain(service);
    }
    expect(script).toContain("Non-Auth service changed unexpectedly");
  });

  it("backs up, rolls back after host mutation and verifies SMTP without sending mail", () => {
    expect(script).toContain('backup="${scratch}/env.backup"');
    expect(script).toContain("Auth configuration backup created");
    expect(script).toContain("host_mutated=1");
    expect(script).toContain('if [[ "${code}" -ne 0 && "${host_mutated}" == "1" ]]');
    expect(script).toContain("Auth SMTP repair rolled back and verified.");
    expect(script).toContain("smtp_probe");
    expect(script).toContain('--network "container:${auth_id}"');
    expect(script).toContain('{"status":"authenticated"}');
    expect(script).not.toMatch(/\bMAIL\b|\bRCPT\b|\bDATA\b/);
  });

  it("pins the canonical Resend SMTP endpoint and sender", () => {
    expect(script).toContain('target_host="smtp.resend.com"');
    expect(script).toContain('target_port="465"');
    expect(script).toContain('target_user="resend"');
    expect(script).toContain('target_admin="no-reply@mercy.peerivo.net"');
  });
});
