import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("dependency manifest coverage", () => {
  it("keeps the application container dependency surface provable", () => {
    for (const file of [
      "compose.yaml",
      "compose.yml",
      "docker-compose.yaml",
      "docker-compose.yml",
    ]) {
      expect(fs.existsSync(path.join(process.cwd(), file))).toBe(false);
    }

    const dockerfile = fs.readFileSync(
      path.join(process.cwd(), "Dockerfile"),
      "utf8",
    );
    expect(dockerfile).toContain("FROM node:22-alpine@sha256:");
    expect(dockerfile).not.toMatch(/\b(?:apk|apt|apt-get|yum|dnf)\s+(?:add|install)\b/i);
  });
});
