import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const verifier = path.join(
  process.cwd(),
  "scripts",
  "verify-auth-callback-surface.sh",
);

const tempDirs: string[] = [];

function runScenario(scenario: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mercy-callback-"));
  tempDirs.push(dir);
  const fakeCurl = path.join(dir, "curl");
  fs.writeFileSync(
    fakeCurl,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "scenario=\"${FAKE_SCENARIO:-}\"",
      "url=\"${!#}\"",
      "case \"${scenario}\" in",
      "  canonical)",
      "    printf \"307\\nhttps://mercy.peerivo.net/auth?error=callback\\n\"",
      "    ;;",
      "  normalized-hop)",
      "    if [[ \"${url}\" == \"https://mercy.peerivo.net/auth/callback\" ]]; then",
      "      printf \"308\\nhttps://mercy.peerivo.net/auth/callback/\\n\"",
      "    else",
      "      printf \"307\\nhttps://mercy.peerivo.net/auth/?next=%%2Fcabinet&error=callback\\n\"",
      "    fi",
      "    ;;",
      "  external)",
      "    printf \"307\\nhttps://evil.example/auth?error=callback\\n\"",
      "    ;;",
      "  lookalike-origin)",
      "    printf \"307\\nhttps://mercy.peerivo.net.evil.example/auth?error=callback\\n\"",
      "    ;;",
      "  wrong-path)",
      "    printf \"307\\nhttps://mercy.peerivo.net/cabinet?error=callback\\n\"",
      "    ;;",
      "  loop)",
      "    printf \"308\\nhttps://mercy.peerivo.net/auth/callback/\\n\"",
      "    ;;",
      "  non-redirect)",
      "    printf \"200\\n\\n\"",
      "    ;;",
      "  *)",
      "    exit 2",
      "    ;;",
      "esac",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.chmodSync(fakeCurl, 0o755);

  return spawnSync("bash", [verifier, "https://mercy.peerivo.net"], {
    encoding: "utf8",
    env: {
      ...process.env,
      CURL_BIN: fakeCurl,
      FAKE_SCENARIO: scenario,
    },
  });
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("production Auth callback surface verifier", () => {
  it("accepts the canonical callback error redirect", () => {
    const result = runScenario("canonical");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("AUTH_MAGIC_LINK_REDIRECT_CONFIGURATION_VERIFIED=1");
  });

  it("follows a bounded same-origin callback normalization hop and accepts query reordering", () => {
    const result = runScenario("normalized-hop");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("AUTH_MAGIC_LINK_REDIRECT_CONFIGURATION_VERIFIED=1");
  });

  it.each(["external", "lookalike-origin", "wrong-path", "loop", "non-redirect"])(
    "fails closed for %s",
    (scenario) => {
      const result = runScenario(scenario);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "Public Auth callback did not stay on canonical Mercy origin",
      );
      expect(result.stdout).not.toContain(
        "AUTH_MAGIC_LINK_REDIRECT_CONFIGURATION_VERIFIED=1",
      );
    },
  );
});
