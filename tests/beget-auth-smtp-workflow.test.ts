import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const workflow = fs.readFileSync(
  path.join(root, ".github/workflows/repair-beget-auth-smtp.yml"),
  "utf8",
);
const senderWorkflow = fs.readFileSync(
  path.join(root, ".github/workflows/repair-beget-auth-smtp-sender.yml"),
  "utf8",
);
const script = fs.readFileSync(
  path.join(root, "scripts/repair-beget-auth-smtp-remote.sh"),
  "utf8",
);

describe("Beget Auth SMTP repair workflow", () => {
  it("is manual, production-scoped, exact-main and a single bounded retry", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("\n  push:");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("github.run_number == 3");
    expect(workflow).toContain("github.run_attempt == 1");
    expect(workflow).toContain(
      "ORIGINAL_APPROVED_BASE_SHA: 7ee28845ffa21d0a55a45c6c1e5f63cb5a641f3f",
    );
    expect(workflow).toContain(
      "FAILED_PREMUTATION_SHA: 26bf4e7460ff78e36451d371984acd9a8f461bf8",
    );
    expect(workflow).toContain('FAILED_REPAIR_RUN_ID: "36388250430"');
    expect(workflow).toContain("FAILED_REPAIR_SHA: bdfc33f04e3c828c861d353fe826b9cc86dcc03a");
    expect(workflow).toContain("git rev-parse HEAD^^^");
    expect(workflow).toContain("actions/runs/${FAILED_REPAIR_RUN_ID}");
    expect(workflow).toContain("Run 3 requires fresh scoped production approval");
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

  it("renders an explicit Auth-only target override before mutation", () => {
    expect(script).toContain('scratch_target_override="${scratch}/auth-smtp-target-override.yml"');
    expect(script).toContain("GOTRUE_SMTP_HOST: ${SMTP_HOST}");
    expect(script).toContain("GOTRUE_SMTP_PORT: ${SMTP_PORT}");
    expect(script).toContain("GOTRUE_SMTP_USER: ${SMTP_USER}");
    expect(script).toContain("GOTRUE_SMTP_PASS: ${SMTP_PASS}");
    expect(script).toContain("GOTRUE_SMTP_ADMIN_EMAIL: ${SMTP_ADMIN_EMAIL}");
    expect(script).toContain("GOTRUE_SMTP_SENDER_NAME: ${SMTP_SENDER_NAME}");
    expect(script).toContain("compose_target_args");
    expect(script).toContain("validate_rendered_auth");
  });

  it("changes only approved SMTP source values and recreates only Auth", () => {
    for (const line of [
      'set_env_line SMTP_HOST "${target_host}"',
      'set_env_line SMTP_PORT "${target_port}"',
      'set_env_line SMTP_USER "${target_user}"',
      'set_env_line SMTP_PASS "${smtp_pass}"',
      'set_env_line SMTP_ADMIN_EMAIL "${target_admin}"',
      'set_env_line SMTP_SENDER_NAME "${target_sender}"',
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

  it("binds rollback to the exact pre-run Auth environment", () => {
    expect(script).toContain('scratch_rollback_override="${scratch}/auth-smtp-rollback-override.yml"');
    expect(script).toContain("MERCY_ROLLBACK_API_EXTERNAL_URL");
    expect(script).toContain("MERCY_ROLLBACK_SMTP_PASS");
    expect(script).toContain("compose_auth_up_rollback");
    expect(script).toContain('backup="${scratch}/env.backup"');
    expect(script).toContain("Auth SMTP repair rolled back and verified.");
    expect(script).toContain('if [[ "${code}" -ne 0 && "${host_mutated}" == "1" ]]');
  });

  it("proves pre-state and verifies SMTP without sending mail", () => {
    expect(script).toContain("AUTH_SMTP_REPAIR_PRESTATE_NONCANONICAL=1");
    expect(script).toContain("AUTH_SMTP_REPAIR_ALREADY_OK=1");
    expect(script).toContain("smtp_probe");
    expect(script).toContain('--network "container:${auth_id}"');
    expect(script).toContain('{"status":"authenticated"}');
    expect(script).toContain(
      'python3 -c \'import json,sys; print(json.dumps({"password":sys.stdin.read(),"port":465}))\'',
    );
    expect(script).not.toContain('printf \'%s\' "{"password"');
    expect(script).not.toMatch(/\bMAIL\b|\bRCPT\b|\bDATA\b/);
  });

  it("pins the canonical Resend SMTP endpoint and sender", () => {
    expect(script).toContain('target_host="smtp.resend.com"');
    expect(script).toContain('target_port="465"');
    expect(script).toContain('target_user="resend"');
    expect(script).toContain('target_admin="no-reply@mercy.peerivo.net"');
    expect(script).toContain('target_sender="Mercy"');
  });
});

// Execute the actual shell function against Docker's distinct Config.Image tag
// and Image ID fields. No Docker daemon, network or production key is used.
function exerciseSmtpProbe(imageId: string, source = script) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mercy-smtp-probe-"));
  try {
    const eventsFile = path.join(temp, "events.jsonl");
    fs.writeFileSync(path.join(temp, "probe.mjs"), "// fixture probe\n");
    fs.writeFileSync(path.join(temp, "docker"), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.PROBE_EVENTS, JSON.stringify(args) + '\\n');
if (args[0] === 'inspect') {
  if (args[2] === '{{.Image}}') console.log(process.env.PROBE_IMAGE_ID);
  else if (args[2] === '{{.Config.Image}}') console.log('supabase/storage-api:v1.2.3');
  else process.exit(7);
} else if (args[0] === 'run') {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (input.password !== 'dummy-key' || input.port !== 465) process.exit(8);
  if (!args.includes(process.env.PROBE_IMAGE_ID)) process.exit(9);
  console.log(JSON.stringify({status:'authenticated'}));
} else process.exit(10);
`, { mode: 0o700 });
    const functionBody = source.slice(source.indexOf("smtp_probe() {"), source.indexOf('\nimage_before='));
    const result = spawnSync("bash", ["-c", `set -Eeuo pipefail
smtp_pass=dummy-key
probe_path="$PROBE_PATH"
${functionBody}
smtp_probe auth-test storage-test
`], {
      encoding: "utf8",
      env: {
        NODE_ENV: "test",
        PATH: temp + path.delimiter + process.env.PATH,
        PROBE_PATH: path.join(temp, "probe.mjs"),
        PROBE_EVENTS: eventsFile,
        PROBE_IMAGE_ID: imageId,
      },
    });
    const events: string[][] = fs.readFileSync(eventsFile, "utf8").trim().split("\n").map(line => JSON.parse(line));
    return { result, events };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

describe("SMTP image ID regression", () => {
  const imageId = "sha256:" + "a".repeat(64);

  it("uses the installed immutable image when Config.Image is a tag", () => {
    const { result, events } = exerciseSmtpProbe(imageId);
    expect(result.status, result.stderr).toBe(0);
    expect(events[0]).toEqual(["inspect", "-f", "{{.Image}}", "storage-test"]);
    const run = events[1];
    expect(run).toContain(imageId);
    expect(run.slice(run.indexOf("--pull"), run.indexOf("--pull") + 2)).toEqual(["--pull", "never"]);
    expect(run).toContain("container:auth-test");
    expect(JSON.stringify(events)).not.toContain("dummy-key");
  });

  it("reproduces run 2's failure with the old Config.Image lookup", () => {
    const previous = script.replace("storage_image=\"$(docker inspect -f '{{.Image}}'", "storage_image=\"$(docker inspect -f '{{.Config.Image}}'");
    const { result, events } = exerciseSmtpProbe(imageId, previous);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Storage image ID is not immutable.");
    expect(events).toHaveLength(1);
  });

  it("rejects malformed image metadata before starting a probe container", () => {
    for (const invalid of ["", "supabase/storage-api:latest", "sha256:" + "z".repeat(64)]) {
      const { result, events } = exerciseSmtpProbe(invalid);
      expect(result.status).not.toBe(0);
      expect(events).toHaveLength(1);
    }
  });

  it("checks SMTP before writing the host environment and again after repair", () => {
    const preflight = script.indexOf('\nsmtp_probe "${auth_before}" "${other_before[storage]}"\n');
    const hostWrite = script.lastIndexOf('docker_write_host_file "${scratch_env}" "${env_file}"');
    const postflight = script.lastIndexOf('smtp_probe "${auth_after}" "${other_before[storage]}"');
    expect(preflight).toBeGreaterThan(0);
    expect(hostWrite).toBeGreaterThan(preflight);
    expect(postflight).toBeGreaterThan(hostWrite);
  });
});


describe("Beget Auth SMTP sender repair workflow", () => {
  it("is one-shot, production-scoped and exact-main gated with a bounded auto-start", () => {
    expect(senderWorkflow).toContain("workflow_dispatch:");
    expect(senderWorkflow).toContain("\n  push:");
    expect(senderWorkflow).toContain("branches:");
    expect(senderWorkflow).toContain("- main");
    expect(senderWorkflow).toContain("[run-auth-smtp-sender-repair]");
    expect(senderWorkflow).toContain("environment: production");
    expect(senderWorkflow).toContain("github.ref == 'refs/heads/main'");
    expect(senderWorkflow).toContain("github.run_number == 1");
    expect(senderWorkflow).toContain("github.run_attempt == 1");
    expect(senderWorkflow).toContain("REPAIR_AUTH_SMTP_SENDER");
    expect(senderWorkflow).toContain("inputs.expected_sha || github.sha");
    expect(senderWorkflow).toContain("for _ in $(seq 1 90)");
    expect(senderWorkflow).toContain("Timed out waiting for successful exact-main CI.");
    expect(senderWorkflow).toContain(
      "APPROVED_BASE_SHA: ef73ad89668e876d94d7993db8798663a878ed3d",
    );
    expect(senderWorkflow).toContain("scripts/repair-beget-auth-smtp-remote.sh");
    expect(senderWorkflow).toContain("probe-resend-smtp.mjs");
  });
});
