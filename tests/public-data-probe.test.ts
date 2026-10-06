// @vitest-environment node
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { GET as healthData } from "../app/health/data/route";

const scriptPath = path.join(process.cwd(), "scripts/probe-mercy-public-data.mjs");
const script = fs.readFileSync(scriptPath, "utf8");
const origin = "https://api.mercy.peerivo.net";
const rpcPath = "/rest/v1/rpc/list_public_help_requests";
const publicKey = "sb_publishable_synthetic_public_fixture_1234567890";
const privateMarker = "PRIVATE_RESPONSE_OR_EXCEPTION_MUST_NOT_APPEAR";
const encode = (value: string) => Buffer.from(value).toString("base64url");
const jwt = (claims: string, header = '{"alg":"HS256","typ":"JWT"}') =>
  `${encode(header)}.${encode(claims)}.${Buffer.alloc(32, 7).toString("base64url")}`;
const anonKey = jwt('{"iss":"supabase","role":"anon","iat":1,"exp":4102444800}');

type Fixture = {
  mode?: string;
  status?: number;
  body?: string;
  code?: unknown;
  sameOrigin?: boolean;
  url?: string;
  publishable?: string;
  anon?: string;
  directFile?: boolean;
};

// Run the unmodified executable, not a copy of its implementation. Its only
// network driver is replaced at the boundary: canonical requests go to a real
// loopback HTTP server; any other destination throws before transmission. No
// inherited configuration, real credentials or production requests are used.
function runProbe(fixture: Fixture = {}) {
  const config = { mode: "success", status: 200, body: "[]", ...fixture };
  const harness = `
import * as fixtureHttp from 'node:http';
const fixtureConfig = ${JSON.stringify(config)};
const fixtureRealFetch = globalThis.fetch;
const fixtureRealTimeout = AbortSignal.timeout.bind(AbortSignal);
const fixtureFacts = { calls: 0, redirectedRequests: 0, redirectedCredentials: false,
  method: null, redirect: null, cache: null, timeout: null, request: null,
  credentialsMatched: false };
AbortSignal.timeout = ms => {
  fixtureFacts.timeout = ms;
  if (ms !== 5000) throw new Error('Unexpected timeout');
  return fixtureRealTimeout(150);
};
let fixtureServer;
let fixtureSink;
let fixtureOrigin;
if (fixtureConfig.mode !== 'mock_success' && fixtureConfig.mode !== 'transport') {
  fixtureSink = fixtureHttp.createServer((req, res) => {
    fixtureFacts.redirectedRequests++;
    fixtureFacts.redirectedCredentials ||= Boolean(req.headers.apikey || req.headers.authorization);
    res.end('[]');
  });
  await new Promise(resolve => fixtureSink.listen(0, '127.0.0.1', resolve));
  fixtureServer = fixtureHttp.createServer((req, res) => {
    if (req.url !== ${JSON.stringify(rpcPath)}) {
      fixtureFacts.redirectedRequests++;
      fixtureFacts.redirectedCredentials ||= Boolean(req.headers.apikey || req.headers.authorization);
      res.end('[]');
      return;
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      fixtureFacts.request = JSON.parse(body);
      const selected = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      fixtureFacts.credentialsMatched = req.headers.apikey === selected && req.headers.authorization === 'Bearer ' + selected;
      if (fixtureConfig.mode === 'redirect') {
        res.writeHead(fixtureConfig.status, { Location: fixtureConfig.sameOrigin ? '/redirect-sink'
          : 'http://127.0.0.1:' + fixtureSink.address().port + '/redirect-sink' });
        res.end();
      } else if (fixtureConfig.mode === 'headers_timeout') {
        // Leave headers pending until the actual fetch AbortSignal fires.
      } else if (fixtureConfig.mode === 'truncate' || fixtureConfig.mode === 'body_timeout') {
        res.writeHead(200, {'Content-Length': '999', 'Content-Type': 'application/json'});
        res.flushHeaders();
        res.write('[]'); // A valid JSON prefix is not a complete HTTP response.
        if (fixtureConfig.mode === 'truncate') setTimeout(() => res.destroy(), 20);
      } else if (fixtureConfig.mode === 'invalid_utf8') {
        res.end(Buffer.from([0x5b, 0x22, 0xff, 0x22, 0x5d]));
      } else {
        res.writeHead(fixtureConfig.status, {'Content-Type': 'application/json'});
        res.end(fixtureConfig.body);
      }
    });
  });
  await new Promise(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
  fixtureOrigin = 'http://127.0.0.1:' + fixtureServer.address().port;
}
globalThis.fetch = (target, options) => {
  if (String(target) !== ${JSON.stringify(origin + rpcPath)}) throw new Error('Noncanonical network request blocked');
  fixtureFacts.calls++;
  fixtureFacts.method = options.method;
  fixtureFacts.redirect = options.redirect;
  fixtureFacts.cache = options.cache;
  if (fixtureConfig.mode === 'transport') {
    throw Object.assign(new Error(${JSON.stringify(privateMarker)}), {
      cause: { code: fixtureConfig.code, message: ${JSON.stringify(privateMarker)} }
    });
  }
  if (fixtureConfig.mode === 'mock_success') return Promise.resolve(new Response('[]'));
  return fixtureRealFetch(fixtureOrigin + ${JSON.stringify(rpcPath)}, options);
};
process.once('exit', () => process.stderr.write(JSON.stringify(fixtureFacts)));
`;
  const cleanup = `
fixtureServer?.closeAllConnections();
fixtureSink?.closeAllConnections();
await Promise.all([fixtureServer, fixtureSink].filter(Boolean).map(server => new Promise(resolve => server.close(resolve))));
`;
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    NODE_ENV: "test",
    NEXT_PUBLIC_SUPABASE_URL: fixture.url ?? origin,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: fixture.publishable ?? publicKey,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: fixture.anon,
    // These must never substitute for the public environment variables.
    SUPABASE_SERVICE_ROLE_KEY: "synthetic_server_secret_DO_NOT_USE",
    SUPABASE_URL: "https://never-contact.invalid",
  };
  let dir: string | undefined;
  try {
    let result;
    if (fixture.directFile) {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "mercy-public-data-"));
      const preload = path.join(dir, "fixture.mjs");
      fs.writeFileSync(preload, harness);
      result = spawnSync(process.execPath, ["--import", preload, scriptPath], {
        encoding: "utf8", timeout: 5000, env,
      });
    } else {
      result = spawnSync(process.execPath, ["--input-type=module", "-"], {
        input: `${harness}\n${script}\n${cleanup}`, encoding: "utf8", timeout: 5000, env,
      });
    }
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(result.stdout).not.toContain(publicKey);
    expect(result.stdout).not.toContain(anonKey);
    expect(result.stdout).not.toContain(privateMarker);
    expect(result.stdout).not.toContain("synthetic_server_secret");
    const facts = JSON.parse(result.stdout);
    expect(Object.keys(facts).sort()).toEqual([
      "elapsed_ms", "failure_category", "http_status", "postgrest_code", "public_key", "transport_cause",
    ]);
    expect(Number.isInteger(facts.elapsed_ms)).toBe(true);
    expect(facts.elapsed_ms).toBeGreaterThanOrEqual(0);
    const boundary = JSON.parse(result.stderr);
    expect(boundary.redirectedRequests).toBe(0);
    expect(boundary.redirectedCredentials).toBe(false);
    return { status: result.status, facts, boundary };
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("executable Mercy public-data readiness probe", () => {
  it("matches the actual app health route's RPC request and timeout", async () => {
    const calls: { input: RequestInfo | URL; options?: RequestInit }[] = [];
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", origin);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", publicKey);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, options?: RequestInit) => {
      calls.push({ input, options });
      return new Response("[]");
    });
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      expect((await healthData()).status).toBe(200);
      expect(calls).toHaveLength(1);
      const result = runProbe();
      expect(String(calls[0].input)).toBe(origin + rpcPath);
      expect(calls[0].options?.method).toBe(result.boundary.method);
      expect(calls[0].options?.cache).toBe(result.boundary.cache);
      expect(JSON.parse(String(calls[0].options?.body))).toEqual(result.boundary.request);
      expect(calls[0].options?.headers).toEqual({ apikey: publicKey,
        Authorization: `Bearer ${publicKey}`, "Content-Type": "application/json" });
      expect(timeout).toHaveBeenCalledWith(result.boundary.timeout);
    } finally {
      timeout.mockRestore();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it.each(["[]", JSON.stringify([{ id: "synthetic-public-row", description: privateMarker }])])(
    "accepts a complete public RPC array and emits no row content: %s", body => {
      const { status, facts, boundary } = runProbe({ body });
      expect(status).toBe(0);
      expect(facts).toMatchObject({ http_status: 200, failure_category: "none", postgrest_code: null,
        transport_cause: null, public_key: { type: "publishable", role: null,
          sha256: createHash("sha256").update(publicKey).digest("hex") } });
      expect(boundary).toMatchObject({ calls: 1, credentialsMatched: true, method: "POST",
        redirect: "error", cache: "no-store", timeout: 5000,
        request: { category_filter: null, city_filter: null, urgency_filter: null,
          state_filter: "ACTIVE", result_limit: 1, result_offset: 0 } });
    },
  );

  it("also executes directly as a Node file without any dependency imports", () => {
    const result = runProbe({ directFile: true, mode: "mock_success" });
    expect(result.status).toBe(0);
    expect(result.facts.failure_category).toBe("none");
  });

  it("supports the anon fallback and canonical trailing slash", () => {
    const result = runProbe({ publishable: "", anon: anonKey, url: `${origin}/` });
    expect(result.status).toBe(0);
    expect(result.facts.public_key).toEqual({ type: "jwt", role: "anon",
      sha256: createHash("sha256").update(anonKey).digest("hex") });
    expect(result.boundary.credentialsMatched).toBe(true);
  });

  it.each(["", "http://api.mercy.peerivo.net", "https://api.mercy.peerivo.net:444",
    `${origin}/extra`, `${origin}?redirect=1`, `${origin}#fragment`, ` ${origin}`,
    "https://api.mercy.peerivo.net.evil.invalid", "https://user:password@api.mercy.peerivo.net"])(
    "rejects noncanonical configuration before any request: %s", url => {
      const result = runProbe({ url });
      expect(result.status).toBe(1);
      expect(result.facts).toMatchObject({ failure_category: "invalid_config", http_status: null, public_key: null });
      expect(result.boundary.calls).toBe(0);
    },
  );

  // Derive this negative fixture from the explicitly synthetic public fixture;
  // never commit a secret-shaped credential literal, even an unusable one.
  const invalidKeys = ["", "short", publicKey.replace("publishable", "secret"), ` ${publicKey}`, `${publicKey}\n`,
    "x".repeat(4097), jwt('{"role":"service_role"}'), jwt('{"role":"authenticated"}'),
    jwt('{"role":true}'), jwt('{"role":["anon"]}'), jwt('{"role":null}'), jwt('{}'),
    jwt('[{"role":"anon"}]'), jwt('{"role":"service_role","role":"anon"}'),
    jwt('{"role":"anon","nested":{"role":"service_role"}}'), jwt('{"\\u0072ole":"anon"}'),
    jwt('{"role":"anon"}', '{"alg":"none"}'),
    jwt('{"role":"anon"}', '{"alg":"none","alg":"HS256"}'),
    `${anonKey}=`, `${encode('{"alg":"HS256"}')}.${encode('{"role":"anon"}')}.AA`,
  ];
  it.each(invalidKeys.map((key, index) => [index, key] as const))(
    "rejects malformed, privileged or ambiguous public-key candidate %s before transmission or hashing", (_index, key) => {
      // A valid fallback cannot excuse an explicitly invalid primary setting.
      const result = runProbe({ publishable: key, anon: key === "" ? "" : anonKey });
      expect(result.status).toBe(1);
      expect(result.facts).toMatchObject({ failure_category: "invalid_public_key", public_key: null, http_status: null });
      expect(result.boundary.calls).toBe(0);
    },
  );

  it.each([301, 302, 303, 307, 308].flatMap(status => [false, true].map(sameOrigin => ({ status, sameOrigin }))))(
    "never follows or forwards credentials on redirect $status sameOrigin=$sameOrigin", fixture => {
      const result = runProbe({ ...fixture, mode: "redirect" });
      expect(result.status).toBe(1);
      expect(result.facts.failure_category).toBe("redirect_rejected");
      expect(result.boundary.calls).toBe(1);
    },
  );

  it.each(["truncate", "headers_timeout", "body_timeout"])("rejects incomplete HTTP responses: %s", mode => {
    const result = runProbe({ mode });
    expect(result.status).toBe(1);
    expect(result.facts.failure_category).toBe(mode === "truncate" ? "body_incomplete" : "timeout");
    expect(result.facts.http_status).toBe(mode === "headers_timeout" ? null : 200);
    expect(result.boundary.timeout).toBe(5000);
    expect(result.facts.elapsed_ms).toBeLessThan(1500);
  });

  it.each(["", "[", "[] trailing", "<h1>Maintenance</h1>"])("rejects incomplete/invalid JSON: %s", body => {
    const result = runProbe({ body });
    expect(result.status).toBe(1);
    expect(result.facts.failure_category).toBe("invalid_json");
  });

  it("rejects invalid UTF-8", () => {
    const result = runProbe({ mode: "invalid_utf8" });
    expect(result.status).toBe(1);
    expect(result.facts.failure_category).toBe("invalid_json");
  });

  it.each(["{}", "null", "true", '"[]"', "[null]", "[1]", "[[],{}]", "[{},{}]"])(
    "requires the bounded one-row RPC array shape: %s", body => {
      const result = runProbe({ body });
      expect(result.status).toBe(1);
      expect(result.facts.failure_category).toBe("invalid_response");
    },
  );

  it("accepts the exact byte limit and rejects a complete oversized JSON array", () => {
    expect(runProbe({ body: `[${" ".repeat(65_534)}]` }).status).toBe(0);
    const result = runProbe({ body: `[${" ".repeat(65_535)}]` });
    expect(result.status).toBe(1);
    expect(result.facts.failure_category).toBe("body_too_large");
  });

  it.each([201, 206, 400, 401, 403, 404, 429, 500, 503])("fails closed on HTTP %s", status => {
    const result = runProbe({ status });
    expect(result.status).toBe(1);
    expect(result.facts).toMatchObject({ http_status: status, failure_category: "http_error" });
  });

  it.each(["PGRST202", "PGRST301", "42501", privateMarker, "PGRST999", ["PGRST301"], null])(
    "emits only an allowlisted PostgREST code: %s", code => {
      const result = runProbe({ status: 401,
        body: JSON.stringify({ code, message: privateMarker, details: privateMarker, hint: privateMarker }) });
      expect(result.status).toBe(1);
      expect(result.facts.postgrest_code).toBe(["PGRST202", "PGRST301", "42501"].includes(code as string) ? code : null);
    },
  );

  it.each(["ENOTFOUND", "ECONNREFUSED", "CERT_HAS_EXPIRED", "UND_ERR_CONNECT_TIMEOUT", privateMarker, ["ENOTFOUND"], null])(
    "emits only an allowlisted transport cause: %s", code => {
      const result = runProbe({ mode: "transport", code });
      expect(result.status).toBe(1);
      expect(result.facts).toMatchObject({ failure_category: "transport_error", http_status: null,
        transport_cause: ["ENOTFOUND", "ECONNREFUSED", "CERT_HAS_EXPIRED", "UND_ERR_CONNECT_TIMEOUT"].includes(code as string) ? code : null });
    },
  );
});
