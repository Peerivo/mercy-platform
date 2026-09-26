import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflowsDir = path.join(process.cwd(), ".github", "workflows");
const workflowFiles = fs
  .readdirSync(workflowsDir)
  .filter((name) => /\.ya?ml$/i.test(name))
  .sort();

describe("GitHub Actions executable dependency coverage", () => {
  it("pins every external action to an immutable commit SHA", () => {
    for (const name of workflowFiles) {
      const content = fs.readFileSync(path.join(workflowsDir, name), "utf8");
      const refs = [...content.matchAll(/\buses:\s*([^\s@]+\/[^^\s@]+)@([^\s#}\],'"]+)/g)];

      for (const [, action, ref] of refs) {
        expect(
          ref,
          `${name}: ${action} must use an immutable 40-character SHA`,
        ).toMatch(/^[0-9a-f]{40}$/i);
      }
    }
  });

  it("does not execute package binaries through mutable package resolvers", () => {
    const mutableExecutable = /\b(?:npx(?:\s+--[^\s]+)*|npm\s+exec|pnpm\s+dlx|yarn\s+dlx)\s+\S+/i;

    for (const name of workflowFiles) {
      const content = fs.readFileSync(path.join(workflowsDir, name), "utf8");
      expect(content, `${name} must execute lockfile-installed binaries directly`)
        .not.toMatch(mutableExecutable);
    }
  });
});
