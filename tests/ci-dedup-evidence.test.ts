import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relative: string) =>
  fs.readFileSync(path.join(root, relative), "utf8");

const ci = read(".github/workflows/ci.yml");
const verifier = read("scripts/verify-current-main-ci-evidence.sh");
const consumers = [
  ".github/workflows/inspect-beget-auth-mail.yml",
  ".github/workflows/repair-beget-auth-session.yml",
  ".github/workflows/repair-beget-auth-smtp.yml",
  ".github/workflows/repair-beget-auth-smtp-sender.yml",
  ".github/workflows/dispatch-reg-ru-prepare-once.yml",
].map(read);

describe("Mercy CI deduplication evidence", () => {
  it("runs the heavy validation once on pull requests, not again on push main", () => {
    expect(ci).toContain("  pull_request:");
    expect(ci).toContain("  workflow_dispatch:");
    expect(ci).not.toContain("\n  push:");
    expect(ci).toContain("tested-tree-evidence:");
    expect(ci).toContain("needs: [app, supabase-integration]");
    expect(ci).toContain("ref: ${{ github.sha }}");
    expect(ci).toContain("mercy-tested-tree-${{ github.event.pull_request.number }}-${{ github.run_id }}-${{ steps.tree.outputs.sha }}");
  });

  it("proves exact current-main tree equality against a successful PR CI artifact", () => {
    expect(verifier).toContain("commits/${EXPECTED_SHA}/pulls");
    expect(verifier).toContain("actions/workflows/ci.yml/runs?event=pull_request");
    expect(verifier).toContain("status=success");
    expect(verifier).toContain("mercy-tested-tree-${pr_number}-${run_id}-");
    expect(verifier).toContain('[[ "${tested_tree}" == "${current_tree}" ]]');
    expect(verifier).not.toContain("event=push");
  });

  it("uses the same fail-closed evidence verifier for every production gate", () => {
    for (const workflow of consumers) {
      expect(workflow).toContain("scripts/verify-current-main-ci-evidence.sh");
      expect(workflow).not.toContain("actions/workflows/ci.yml/runs?");
    }
  });
});
