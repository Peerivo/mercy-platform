import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflow = fs.readFileSync(
  path.join(process.cwd(), ".github", "workflows", "deploy-reg-ru.yml"),
  "utf8",
);

describe("REG.RU production deployment safety contract", () => {
  it("pins SSH trust instead of trusting a freshly scanned host key", () => {
    expect(workflow).toContain("REG_RU_KNOWN_HOSTS");
    expect(workflow).toContain("StrictHostKeyChecking=yes");
    expect(workflow).not.toContain("ssh-keyscan");
  });

  it("rejects a stale workflow-dispatch revision before build or upload", () => {
    const gate = workflow.indexOf("Reject a stale workflow-dispatch revision");
    expect(gate).toBeGreaterThan(-1);
    expect(workflow.indexOf("Build immutable production image")).toBeGreaterThan(gate);
    expect(workflow).toContain('current_main="$(git rev-parse refs/remotes/origin/main)"');
    expect(workflow).toContain('if [ "${current_main}" != "${GITHUB_SHA}" ]');
  });

  it("keeps the current environment authoritative until the candidate passes data and public checks", () => {
    const localData = workflow.indexOf("http://127.0.0.1:3100/health/data");
    const publicData = workflow.indexOf('"${SITE_URL}/health/data"');
    const promote = workflow.indexOf('mv -f "${NEXT_ENV}" "${PROD_ENV}"');
    expect(localData).toBeGreaterThan(-1);
    expect(publicData).toBeGreaterThan(localData);
    expect(promote).toBeGreaterThan(publicData);
  });

  it("rolls back interrupted remote sessions and restores the prior environment", () => {
    expect(workflow).toContain("trap 'exit 129' HUP");
    expect(workflow).toContain("trap 'exit 130' INT");
    expect(workflow).toContain("trap 'exit 143' TERM");
    expect(workflow).toContain('cp -f "${PREVIOUS_ENV}" "${PROD_ENV}"');
    expect(workflow).toContain('start_container "${old_image}" "${rollback_env}"');
  });

  it("retains only the current and one rollback image", () => {
    expect(workflow).toContain('if [ "${tag}" = "${IMAGE}" ] || [ "${tag}" = "${old_image}" ]');
    expect(workflow).toContain('docker image rm "${tag}"');
    expect(workflow).not.toContain("docker image prune -f");
  });

  it("does not accept liveness alone as deployment success", () => {
    expect(workflow).toContain("/health/data");
    expect(workflow).toContain(".version == $sha");
  });
});


it("verifies the exact candidate revision before promotion", () => {
  const publicRevision = workflow.indexOf('grep -F "\\\"version\\\":\\\"\${IMAGE_TAG}\\\""');
  const promote = workflow.indexOf('mv -f "\${NEXT_ENV}" "\${PROD_ENV}"');
  expect(publicRevision).toBeGreaterThan(-1);
  expect(promote).toBeGreaterThan(publicRevision);
});
