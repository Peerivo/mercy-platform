import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const workflow = fs.readFileSync(
  path.join(process.cwd(), ".github", "workflows", "deploy-reg-ru.yml"),
  "utf8",
);
const dispatcher = fs.readFileSync(
  path.join(
    process.cwd(),
    ".github",
    "workflows",
    "dispatch-reg-ru-prepare-once.yml",
  ),
  "utf8",
);
const nextConfig = fs.readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
const healthData = fs.readFileSync(
  path.join(process.cwd(), "app", "health", "data", "route.ts"),
  "utf8",
);

type PreflightFixture = {
  project?: string;
  kong?: string;
  auth?: string;
  authIp?: string;
  runtimeKeys?: string[];
  fileKeys?: string[];
  statuses?: Record<string, string>;
  unreachable?: boolean;
  partialResponse?: boolean;
};

// Execute the exact remote heredoc that PREPARE sends to Beget. Every external
// boundary is mocked; this fixture cannot use production Docker, curl or env files.
function runDirectPreflight(fixture: PreflightFixture = {}) {
  const step = workflow.split("- name: Resolve live Beget service-role key for Mercy")[1]
    .split("\n      - name:")[0];
  const script = step.split("<<'REMOTE'\n")[1]?.split("\n          REMOTE\n")[0]
    .replace(/^ {10}/gm, "");
  if (!script) throw new Error("Direct preflight remote heredoc is missing");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mercy-direct-preflight-"));
  const log = path.join(dir, "calls.jsonl");
  const config = {
    project: "mercy", kong: "kong-one", auth: "auth-one", authIp: "172.20.0.4",
    runtimeKeys: ["fixture-valid-key"], fileKeys: [],
    statuses: { "fixture-valid-key": "200" }, ...fixture,
  };
  const mock = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const config = JSON.parse(process.env.MERCY_FIXTURE);
const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const emit = (value) => process.stdout.write(value + '\\n');
if (name === 'docker') {
  if (args[0] === 'inspect' && /\\s/.test(args[3] || '')) process.exit(89);
  if (args[0] === 'ps') {
    if (!args.includes('label=com.docker.compose.project=mercy')) process.exit(90);
    if (args.includes('label=com.docker.compose.service=kong')) emit(config.kong);
    else if (args.includes('label=com.docker.compose.service=auth')) emit(config.auth);
    else process.exit(91);
  } else if (args[0] === 'inspect' && args[3] === 'supabase-db') emit(config.project);
  else if (args[0] === 'inspect' && config.auth.split('\\n').includes(args[3])) emit(config.authIp);
  else if (args[0] === 'inspect' && args[3] === config.kong) emit(config.runtimeKeys.map(k => 'SUPABASE_SERVICE_KEY=' + k).join('\\n'));
  else process.exit(92);
} else if (name === 'sed') {
  if (args.includes('/opt/beget/supabase/.env')) emit(config.fileKeys.join('\\n'));
  else { const result = spawnSync('/usr/bin/sed', args, { stdio: 'inherit' }); process.exit(result.status ?? 93); }
} else if (name === 'curl') {
  fs.appendFileSync(process.env.MERCY_FIXTURE_LOG, JSON.stringify(args) + '\\n');
  if (config.unreachable) { process.stdout.write('000'); process.exit(7); }
  if (config.partialResponse) { process.stdout.write('200'); process.exit(28); }
  const token = (args.find(x => x.startsWith('Authorization: Bearer ')) || '').slice(22);
  process.stdout.write(config.statuses[token] || '401');
} else process.exit(94);
`;
  try {
    for (const name of ["docker", "curl", "sed"]) {
      fs.writeFileSync(path.join(dir, name), mock, { mode: 0o700 });
    }
    const result = spawnSync("bash", ["-c", script], {
      encoding: "utf8", timeout: 15000,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`,
        MERCY_FIXTURE: JSON.stringify(config), MERCY_FIXTURE_LOG: log },
    });
    const calls: string[][] = fs.existsSync(log)
      ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line))
      : [];
    return { ...result, calls };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("executable live Beget service-role preflight", () => {
  it("selects the unique accepted key through direct GoTrue with a bounded probe", () => {
    const result = runDirectPreflight();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("fixture-valid-key");
    expect(result.stderr).toBe("");
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toContain("http://172.20.0.4:9999/admin/users?page=1&per_page=1");
    expect(result.calls[0][result.calls[0].indexOf("--max-time") + 1]).toBe("10");
    expect(result.calls[0].join(" ")).not.toContain("api.mercy.peerivo.net");
  });

  it("tries rejected candidates and deduplicates runtime and protected-file keys", () => {
    const result = runDirectPreflight({ runtimeKeys: ["fixture-old-key", "fixture-old-key"],
      fileKeys: ["fixture-old-key", "fixture-valid-key", "fixture-valid-key"] });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("fixture-valid-key");
    expect(result.calls).toHaveLength(2);
  });

  it.each([
    ["unreachable Auth", { unreachable: true }],
    ["incomplete HTTP 200 response", { partialResponse: true }],
    ["rejected JWT", { statuses: { "fixture-valid-key": "401" } }],
    ["empty candidates", { runtimeKeys: [] }],
    ["missing Auth", { auth: "" }],
    ["missing project", { project: "" }],
    ["missing address", { authIp: "" }],
    ["ambiguous Kong containers", { kong: "kong-one\nkong-two" }],
    ["Auth HTTP 500", { statuses: { "fixture-valid-key": "500" } }],
    ["ambiguous Auth containers", { auth: "auth-one\nauth-two" }],
    ["ambiguous Auth addresses", { authIp: "172.20.0.4\n172.21.0.4" }],
    ["ambiguous accepted keys", { runtimeKeys: ["fixture-valid-key", "fixture-second-key"],
      statuses: { "fixture-valid-key": "200", "fixture-second-key": "200" } }],
  ] satisfies [string, PreflightFixture][])("fails closed for %s without emitting keys", (_name, fixture) => {
    const result = runDirectPreflight(fixture);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toMatch(/fixture-(valid|second|old)-key/);
  });
});

function runCandidateAuthProbe(channel: "admin" | "public" | null = null, fault: "truncate" | "timeout" | "redirect" | "html" | "shape" = "truncate") {
  const script = workflow.split('auth_channels="$(')[1]?.split("<<'NODE'\n")[1]
    ?.split("\n          NODE\n")[0].replace(/^ {10}/gm, "");
  if (!script) throw new Error("Candidate Auth Node probe is missing");
  const harness = `
const http = require('node:http');
const realTimeout = AbortSignal.timeout.bind(AbortSignal);
AbortSignal.timeout = milliseconds => {
  if (milliseconds !== 10000) throw new Error('Unexpected production timeout');
  return realTimeout(1000);
};
(async () => {
  let redirectedRequests = 0;
  let redirectedApiKey = false;
  const sink = http.createServer((request, response) => {
    redirectedRequests += 1;
    redirectedApiKey ||= Boolean(request.headers.apikey);
    response.end('{"users":[],"external":{}}');
  });
  await new Promise(resolve => sink.listen(0, '127.0.0.1', resolve));
  const server = http.createServer((request, response) => {
    const requestedChannel = request.url.includes('/admin/') ? 'admin' : 'public';
    if (requestedChannel === ${JSON.stringify(channel)} && ${JSON.stringify(fault)} === 'redirect') {
      response.writeHead(302, {Location: 'http://127.0.0.1:' + sink.address().port});
      response.end();
    } else if (requestedChannel === ${JSON.stringify(channel)} && ['html', 'shape'].includes(${JSON.stringify(fault)})) {
      response.writeHead(200, {'Content-Type': 'application/json'});
      response.end(${JSON.stringify(fault)} === 'html' ? '<h1>Maintenance</h1>' : '{}');
    } else if (requestedChannel === ${JSON.stringify(channel)}) {
      response.writeHead(200, {'Content-Type': 'application/json', 'Content-Length': '999'});
      response.flushHeaders();
      response.write('{');
      if (${JSON.stringify(fault)} === 'truncate') setTimeout(() => response.destroy(), 40);
    } else {
      response.writeHead(200, {'Content-Type': 'application/json'});
      response.end(requestedChannel === 'admin' ? '{"users":[]}' : '{"external":{}}');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:' + server.address().port;
  try {
    const probe = ${script}
    await probe;
  } finally {
    server.closeAllConnections();
    sink.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => sink.close(resolve))]);
    process.stderr.write(JSON.stringify({redirectedRequests, redirectedApiKey}));
  }
})().catch(() => process.exitCode = 1);
`;
  return spawnSync(process.execPath, ["-"], {
    input: harness, encoding: "utf8", timeout: 15000,
    env: { ...process.env,
      SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key" },
  });
}

describe("executable REG.RU public Auth gate", () => {
  it("accepts complete Admin/Public responses from an actual loopback HTTP server", () => {
    const result = runCandidateAuthProbe();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("200 200");
    expect(JSON.parse(result.stderr)).toEqual({ redirectedRequests: 0, redirectedApiKey: false });
  });

  it.each([
    ["admin", "truncate"], ["public", "truncate"],
    ["admin", "timeout"], ["public", "timeout"],
    ["admin", "redirect"], ["public", "redirect"],
    ["admin", "html"], ["public", "html"],
    ["admin", "shape"], ["public", "shape"],
  ] as const)("rejects %s %s after HTTP 200 headers", (channel, fault) => {
    const result = runCandidateAuthProbe(channel, fault);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("fetch_error fetch_error");
    expect(JSON.parse(result.stderr)).toEqual({ redirectedRequests: 0, redirectedApiKey: false });
  });
});

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

  it("sources the Mercy admin key from live Beget instead of a stale repository secret", () => {
    expect(workflow).toContain("Resolve live Beget service-role key for Mercy");
    expect(workflow).toContain("BEGET_SUPABASE_SSH_KEY");
    expect(workflow).toContain("LIVE_BEGET_SERVICE_ROLE_DIRECT_VERIFIED");
    expect(workflow).toContain('http://${auth_ip}:9999/admin/users?page=1&per_page=1');
    expect(workflow).toContain("com.docker.compose.service=auth");
    expect(workflow).toContain("/auth/v1/admin/users?page=1&per_page=1");
    expect(workflow).not.toContain("SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.");
    expect(workflow).not.toContain("runner-side GoTrue Admin verification");
  });

  it("keeps the old container until staging passes and arms restoration before stopping it", () => {
    const safetyComment = workflow.indexOf("Arm rollback before the first destructive production-host action");
    const staged = workflow.indexOf('probe_application "${CANDIDATE_NAME}" http://127.0.0.1:3101');
    const arm = workflow.indexOf("production_changed=1", safetyComment);
    const stop = workflow.indexOf('docker stop "${old_id}"', arm);
    expect(safetyComment).toBeGreaterThan(-1);
    expect(safetyComment).toBeGreaterThan(staged);
    expect(arm).toBeGreaterThan(safetyComment);
    expect(stop).toBeGreaterThan(arm);
    expect(workflow).toContain('docker rename "${old_id}" "${ROLLBACK_NAME}"');
  });

  it("passes Supabase public runtime config into the built-image readiness probe", () => {
    const probeStart = workflow.indexOf('build_probe="mercy-build-probe-${GITHUB_RUN_ID}"');
    const probeEnd = workflow.indexOf('docker save "${IMAGE_NAME}:${GITHUB_SHA}"', probeStart);
    const probe = workflow.slice(probeStart, probeEnd);
    expect(probe).toContain("-e NEXT_PUBLIC_SUPABASE_URL");
    expect(probe).toContain("-e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    expect(probe).toContain("-e NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(probe).toContain('-e "NEXT_PUBLIC_SITE_URL=${SITE_URL}"');
    expect(probe).toContain("http://127.0.0.1:3101/health/data");
  });

  it("bounds both readiness probes", () => {
    expect(workflow).toContain("curl --fail --silent --show-error --max-time 10");
    expect(healthData).toContain("AbortSignal.timeout(readinessTimeoutMs)");
    expect(healthData).toContain("await response.arrayBuffer()");
  });

  it("uses a dedicated MTU-safe network without mutating global Docker settings", () => {
    expect(workflow).toContain('NETWORK_NAME="mercy-reg-ru"');
    expect(workflow).toContain('NETWORK_MTU="1400"');
    expect(workflow).toContain('docker network create');
    expect(workflow).toContain('com.docker.network.driver.mtu=${NETWORK_MTU}');
    expect(workflow).toContain('--network "${NETWORK_NAME}"');
    expect(workflow).toContain("Existing ${NETWORK_NAME} network has unexpected MTU");
    expect(workflow).not.toMatch(/daemon\.json|systemctl\s+restart\s+docker|ip\s+link\s+set\s+docker0/i);
  });


  it("PREPARE never changes DNS and VERIFY is public-read-only", () => {
    expect(workflow).toContain("REG_RU_CANDIDATE_READY");
    expect(workflow).toContain("REG_RU_PUBLIC_CUTOVER_VERIFIED");
    expect(workflow).not.toMatch(/cloudflare|route53|change-resource-record|dns.*update/i);
  });

  it("gates REG.RU promotion on working admin and public Auth channels", () => {
    expect(workflow).toContain("REG_RU_AUTH_CHANNELS_VERIFIED admin=200 public=200");
    expect(workflow).toContain("Candidate Mercy GoTrue Admin channel failed with HTTP");
    expect(workflow).toContain("Candidate Mercy public Auth channel failed with HTTP");
    expect(workflow).toContain("/auth/v1/admin/users?page=1&per_page=1");
    expect(workflow).toContain("/auth/v1/settings");

    const authGate = workflow.indexOf("REG_RU_AUTH_CHANNELS_VERIFIED admin=200 public=200");
    const promote = workflow.indexOf('phase="promoting"');
    expect(authGate).toBeGreaterThan(-1);
    expect(promote).toBeGreaterThan(authGate);
  });

  it("gates REG.RU promotion on the canonical Auth callback redirect", () => {
    expect(workflow).toContain("Candidate Auth callback escaped canonical Mercy origin.");
    expect(workflow).toContain('"${probe_origin}/auth/callback"');
    expect(workflow).toContain('probe_application "${CANDIDATE_NAME}" http://127.0.0.1:3101');
    expect(workflow).toContain("'https://mercy.peerivo.net/auth?error=callback'");
    expect(workflow).toContain("Canonical production Auth callback redirect is wrong");

    const candidateProbe = workflow.indexOf(
      'probe_application "${CANDIDATE_NAME}" http://127.0.0.1:3101',
    );
    const promote = workflow.indexOf('phase="promoting"');
    expect(candidateProbe).toBeGreaterThan(-1);
    expect(promote).toBeGreaterThan(candidateProbe);
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


describe("REG.RU one-shot PREPARE dispatcher", () => {
  it("keeps the production deploy workflow manual-only", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("\n  push:");
  });

  it("is bounded to one marked current-main push", () => {
    expect(dispatcher).toContain("\n  push:");
    expect(dispatcher).toContain("- main");
    expect(dispatcher).toContain("[run-reg-ru-prepare]");
    expect(dispatcher).toContain("github.run_attempt == 1");
    expect(dispatcher).toContain(
      "APPROVED_BASE_SHA: 763b4787e5d29b6aa915e6ea50fd3812b3834906",
    );
    expect(dispatcher).toContain('test "$(git rev-parse HEAD^)" = "${APPROVED_BASE_SHA}"');
    expect(dispatcher).toContain(".github/workflows/deploy-reg-ru.yml");
    expect(dispatcher).toContain("One-shot dispatcher increment contains unexpected files.");
  });

  it("waits for green exact-main CI before dispatching PREPARE", () => {
    expect(dispatcher).toContain("actions/workflows/ci.yml/runs?head_sha=${GITHUB_SHA}&event=push");
    expect(dispatcher).toContain("Exact-main CI completed without success.");
    expect(dispatcher).toContain("Timed out waiting for successful exact-main CI.");
    expect(dispatcher).toContain("actions/workflows/${TARGET_WORKFLOW}/dispatches");
    expect(dispatcher).toContain('operation: "PREPARE"');
    expect(dispatcher).toContain('expected_sha: $sha');
    expect(dispatcher).toContain('confirm: "PREPARE"');
  });

  it("does not carry production secrets itself", () => {
    expect(dispatcher).not.toContain("secrets.");
    expect(dispatcher).not.toContain("REG_RU_SSH_KEY");
    expect(dispatcher).not.toContain("NEXT_PUBLIC_SUPABASE");
  });
});
