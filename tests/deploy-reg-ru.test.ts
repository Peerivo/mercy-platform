import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflow = fs.readFileSync(
  path.join(process.cwd(), ".github", "workflows", "deploy-reg-ru.yml"),
  "utf8",
);
const nextConfig = fs.readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
const healthData = fs.readFileSync(
  path.join(process.cwd(), "app", "health", "data", "route.ts"),
  "utf8",
);

describe("REG.RU production deployment safety contract", () => {
  it("pins checkout and SSH trust", () => {
    expect(workflow).toContain("actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683");
    expect(workflow).toContain("StrictHostKeyChecking=yes");
    expect(workflow).not.toContain("ssh-keyscan");
  });

  it("requires an explicitly approved exact live-main SHA", () => {
    expect(workflow).toContain("expected_sha");
    expect(workflow).toContain('test "${{ inputs.expected_sha }}" = "${GITHUB_SHA}"');
    expect(workflow).toContain('current_main="$(git rev-parse refs/remotes/origin/main)"');
  });

  it("uses the canonical website and Beget API hostnames", () => {
    expect(workflow).toContain("SITE_URL: https://mercy.peerivo.net");
    expect(workflow).toContain("EXPECTED_SUPABASE_URL: https://api.mercy.peerivo.net");
    expect(workflow).not.toContain("SITE_URL: https://xn----htbcggcjkhwxk7j6bn.xn--p1ai");
  });

  it("arms rollback before removing an existing application container", () => {
    const arm = workflow.indexOf("armed=1");
    const remove = workflow.indexOf('docker rm -f "${CONTAINER_NAME}"');
    expect(arm).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(arm);
  });

  it("bounds both readiness probes", () => {
    expect(workflow).toContain("curl --fail --silent --show-error --max-time 10");
    expect(healthData).toContain("AbortSignal.timeout(readinessTimeoutMs)");
    expect(healthData).toContain("await response.arrayBuffer()");
  });

  it("PREPARE never changes DNS and VERIFY is public-read-only", () => {
    expect(workflow).toContain("REG_RU_CANDIDATE_READY");
    expect(workflow).toContain("REG_RU_PUBLIC_CUTOVER_VERIFIED");
    expect(workflow).not.toMatch(/cloudflare|route53|change-resource-record|dns.*update/i);
  });

  it("keeps the Russian hostname a permanent canonical redirect", () => {
    expect(nextConfig).toContain("xn----htbcggcjkhwxk7j6bn.xn--p1ai");
    expect(nextConfig).toContain("https://mercy.peerivo.net/:path*");
    expect(nextConfig).toContain("permanent: true");
    expect(workflow).toContain("cutover_probe=1");
  });

  it("never invokes database migration tooling", () => {
    expect(workflow).not.toMatch(/supabase\s+db\s+(push|reset)|psql|pg_restore|pg_dump/i);
  });
});
