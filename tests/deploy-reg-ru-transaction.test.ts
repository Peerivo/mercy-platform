import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const workflow = fs.readFileSync(".github/workflows/deploy-reg-ru.yml", "utf8");
const release = "a".repeat(40);
const oldRelease = "b".repeat(40);
type Container = { id: string; name: string; image: string; running: boolean; port: number; label?: string };
type State = { containers: Record<string, Container>; calls: string[][]; failureInjected?: boolean };

function runTransaction(failure = "none", source = workflow) {
  const script = source.split("<<'REMOTE_SCRIPT'\n")[1]?.split("\n          REMOTE_SCRIPT\n")[0]
    .replace(/^ {10}/gm, "");
  if (!script) throw new Error("Deployment remote shell is missing");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mercy-transaction-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const statePath = path.join(dir, "state.json");
  const oldEnv = "GIT_SHA=" + oldRelease + "\nNEXT_PUBLIC_TEST=old\n";
  const newEnv = "GIT_SHA=" + release + "\nNEXT_PUBLIC_TEST=new\n";
  fs.writeFileSync(path.join(dir, ".env.production"), oldEnv);
  fs.writeFileSync(path.join(dir, ".env.next"), newEnv);
  fs.writeFileSync(path.join(dir, "current-image"), "mercy-test:" + oldRelease + "\n");
  fs.writeFileSync(path.join(dir, "mercy-image.tar.gz"), "synthetic archive");
  fs.writeFileSync(path.join(dir, "probe-mercy-public-data.mjs"), "// synthetic test boundary\n");
  fs.writeFileSync(statePath, JSON.stringify({
    containers: { mercy: { id: "original-container", name: "mercy", image: "mercy-test:" + oldRelease, running: true, port: 3100 } },
    calls: [],
  }));
  const mock = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const file = process.env.TRANSACTION_STATE;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const failure = process.env.TRANSACTION_FAILURE;
const release = process.env.TRANSACTION_RELEASE;
state.calls.push([name, ...args]);
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const finish = (code = 0, output = '') => { save(); process.stdout.write(output); process.exit(code); };
const container = id => Object.values(state.containers).find(c => c.name === id || c.id === id);
if (name === 'sleep') finish();
if (name === 'gzip') finish(0, 'synthetic image');
if (name === 'cp' || name === 'mv') {
  if (failure === 'metadata_restore' && name === 'cp' && args[args.length - 2].endsWith('/.env.previous')) finish(1);
  const result = spawnSync('/bin/' + name, args, {stdio:'inherit'});
  if (failure === 'metadata_restore' && name === 'mv') finish(1);
  finish(result.status ?? 1);
}
if (name === 'curl') {
  const url = new URL(args.find(a => a.startsWith('http://')));
  const current = Object.values(state.containers).find(c => c.running && c.port === Number(url.port));
  if (!current) finish(7);
  const next = current.image.endsWith(':' + release);
  if (url.pathname === '/health') finish(0, JSON.stringify({status:'ok',version:current.image.split(':')[1]}));
  if (url.pathname === '/health/data') {
    if (next && (failure === 'candidate_data' || (failure === 'promotion_data' && current.name === 'mercy'))) finish(22);
    finish(0, '{"status":"ok"}');
  }
  if (url.pathname === '/auth/callback') finish(0, 'HTTP/1.1 307 Temporary Redirect\\r\\nlocation: https://mercy.peerivo.net/auth?error=callback\\r\\n');
  if (url.pathname === '/auth/start') finish(0, 'HTTP/1.1 307 Temporary Redirect\\r\\nlocation: https://auth.peerivo.net/authorize?client_id=mercy&code_challenge_method=S256\\r\\n');
  if (url.pathname === '/requests') finish(0, 'HTTP/1.1 308 Permanent Redirect\\r\\nlocation: https://mercy.peerivo.net/requests?cutover_probe=1\\r\\n');
  finish(90);
}
if (name !== 'docker') finish(91);
if (args[0] === 'network') finish(0, args.includes('-f') ? '1400\\n' : '');
if (args[0] === 'load') { fs.readFileSync(0); finish(); }
if (args[0] === 'inspect') {
  const c = container(args[args.length - 1]);
  if (!c) finish(1);
  if (!args.includes('-f')) finish();
  const format = args[args.indexOf('-f') + 1];
  if (format === '{{.Id}}') finish(0, c.id + '\\n');
  if (format === '{{.Name}}') finish(0, '/' + c.name + '\\n');
  if (format === '{{.Config.Image}}') finish(0, c.image + '\\n');
  if (format === '{{.State.Running}}') finish(0, String(c.running) + '\\n');
  if (format.includes('.State.Health')) finish(0, 'healthy\\n');
  if (format.includes('peerivo.mercy.release')) finish(0, (c.label || '') + '\\n');
  finish(92);
}
if (args[0] === 'run') {
  const cname = args[args.indexOf('--name') + 1];
  const labelIndex = args.indexOf('--label');
  const label = labelIndex < 0 ? undefined : args[labelIndex + 1].split('=')[1];
  const port = Number(args[args.indexOf('-p') + 1].split(':')[1]);
  if (state.containers[cname] || Object.values(state.containers).some(c => c.running && c.port === port)) finish(1);
  const c = {id:'created-' + cname, name:cname, image:args[args.length-1], running:true, port, label};
  state.containers[cname] = c;
  if (failure === 'production_start' && cname === 'mercy' && label === release) { c.running = false; finish(1); }
  finish(0, c.id + '\\n');
}
if (args[0] === 'exec') {
  fs.readFileSync(0);
  if (args.includes('--input-type=module')) finish(0, '{"failure_category":"none","http_status":200}\\n');
  if (failure === 'candidate_auth') finish(0, 'fetch_error fetch_error');
  finish(0, '200 200');
}
if (args[0] === 'stop') {
  const c = container(args[1]); if (!c) finish(1); c.running = false;
  if (failure === 'after_stop' && !state.failureInjected) { state.failureInjected = true; finish(1); }
  finish();
}
if (args[0] === 'start') { const c = container(args[1]); if (!c) finish(1); c.running = true; finish(); }
if (args[0] === 'rename') {
  const c = container(args[1]); if (!c || state.containers[args[2]]) finish(1);
  delete state.containers[c.name]; c.name = args[2]; state.containers[c.name] = c;
  if (failure === 'after_rename' && !state.failureInjected) { state.failureInjected = true; finish(1); }
  finish();
}
if (args[0] === 'rm') { const c = container(args[args.length - 1]); if (!c) finish(1); delete state.containers[c.name]; finish(); }
if (args[0] === 'image' && args[1] === 'ls') finish(0, 'mercy-test:' + release + '\\nmercy-test:' + '${oldRelease}' + '\\n');
if (args[0] === 'image' && args[1] === 'rm') finish();
if (args[0] === 'logs') finish();
finish(93);
`;
  try {
    for (const name of ["docker", "curl", "gzip", "sleep", "cp", "mv"]) {
      fs.writeFileSync(path.join(bin, name), mock, { mode: 0o700 });
    }
    const result = spawnSync("bash", ["-c", script, "deployment", "mercy-test", release, dir, "mercy", "fixture.example"], {
      encoding: "utf8", timeout: 20000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`,
        TRANSACTION_STATE: statePath, TRANSACTION_FAILURE: failure, TRANSACTION_RELEASE: release },
    });
    const state: State = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return { ...result, state, oldEnv, newEnv,
      productionEnv: fs.readFileSync(path.join(dir, ".env.production"), "utf8"),
      previousEnv: fs.existsSync(path.join(dir, ".env.previous")) ? fs.readFileSync(path.join(dir, ".env.previous"), "utf8") : null,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("executed REG.RU candidate transaction", () => {
  it.each(["candidate_data", "candidate_auth"])("leaves the exact old container running when %s fails", failure => {
    const result = runTransaction(failure);
    expect(result.status).not.toBe(0);
    expect(Object.keys(result.state.containers)).toEqual(["mercy"]);
    expect(result.state.containers.mercy).toMatchObject({ id: "original-container", running: true });
    expect(result.productionEnv).toBe(result.oldEnv);
    expect(result.state.calls.some(call => ["stop", "rename", "start"].includes(call[1]))).toBe(false);
    expect(result.stdout).toContain("REG_RU_CANDIDATE_REJECTED_PRODUCTION_UNCHANGED");
  });

  it.each(["after_stop", "after_rename", "production_start", "promotion_data"])("restores the same old container after %s", failure => {
    const result = runTransaction(failure);
    expect(result.status).not.toBe(0);
    expect(result.state.containers.mercy).toMatchObject({ id: "original-container", running: true });
    expect(Object.keys(result.state.containers)).toEqual(["mercy"]);
    expect(result.productionEnv).toBe(result.oldEnv);
    expect(result.stdout).toContain("REG_RU_ROLLBACK_CONTAINER_RESTORED");
    expect(result.stderr).not.toContain("REG_RU_ROLLBACK_UNVERIFIED");
  });

  it("promotes only after staging checks and retains the original stopped rollback container", () => {
    const result = runTransaction();
    expect(result.status, result.stderr).toBe(0);
    expect(result.state.containers.mercy).toMatchObject({ image: "mercy-test:" + release, running: true });
    expect(result.state.containers["mercy-rollback-" + release.slice(0, 12)]).toMatchObject({ id: "original-container", running: false });
    expect(Object.keys(result.state.containers)).toHaveLength(2);
    expect(result.productionEnv).toBe(result.newEnv);
    expect(result.previousEnv).toBe(result.oldEnv);
    expect(result.stdout).toContain("REG_RU_STAGED_CANDIDATE_VERIFIED");
    expect(result.stdout).toContain("REG_RU_ROLLBACK_CONTAINER_RETAINED");
    expect(result.stdout).toContain("REG_RU_CANDIDATE_READY");
  });

  it("restores the original process even when promotion and metadata restoration fail", () => {
    const result = runTransaction("metadata_restore");
    expect(result.status).not.toBe(0);
    expect(result.state.containers.mercy).toMatchObject({ id: "original-container", running: true });
    expect(Object.keys(result.state.containers)).toEqual(["mercy"]);
    expect(result.productionEnv).toBe(result.newEnv);
    expect(result.previousEnv).toBe(result.oldEnv);
    expect(result.stdout).toContain("REG_RU_ROLLBACK_CONTAINER_RESTORED");
    expect(result.stderr).toContain("REG_RU_ROLLBACK_METADATA_UNVERIFIED");
    expect(result.stdout).not.toContain("REG_RU_CANDIDATE_READY");
  });
});
