import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readJson = (name: string) => JSON.parse(readFileSync(resolve(process.cwd(), name), "utf8"));

describe("reviewed dependency security floors", () => {
  it("keeps Next and its ESLint integration on the reviewed patched release", () => {
    const manifest = readJson("package.json");
    const lock = readJson("package-lock.json");
    expect(manifest.dependencies.next).toBe("16.3.8");
    expect(manifest.devDependencies["eslint-config-next"]).toBe("16.3.8");
    expect(lock.packages["node_modules/next"].version).toBe("16.3.8");
    expect(lock.packages["node_modules/eslint-config-next"].version).toBe("16.3.8");
  });

  it("pins the transitive image decoder to the reviewed librsvg fix", () => {
    const manifest = readJson("package.json");
    const lock = readJson("package-lock.json");
    expect(manifest.overrides.sharp).toBe("0.35.5");
    const sharpEntries = Object.entries(lock.packages).filter(([path]) => /(?:^|\/)node_modules\/sharp$/.test(path));
    expect(sharpEntries.length).toBeGreaterThan(0);
    for (const [, value] of sharpEntries) expect((value as { version: string }).version).toBe("0.35.5");
  });

  it("applies available toolchain patches without crossing brace-expansion major APIs", () => {
    const manifest = readJson("package.json");
    const lock = readJson("package-lock.json");
    expect(manifest.devDependencies.vitest).toBe("4.1.11");
    expect(lock.packages["node_modules/vitest"].version).toBe("4.1.11");
    expect(manifest.overrides["source-map-js"]).toBe("1.2.2");
    expect(manifest.overrides["brace-expansion@1"]).toBe("1.1.21");
    expect(manifest.overrides["brace-expansion@5"]).toBe("5.0.12");
    expect(lock.packages["node_modules/source-map-js"].version).toBe("1.2.2");
    expect(lock.packages["node_modules/brace-expansion"].version).toBe("1.1.21");
    expect(lock.packages["node_modules/@typescript-eslint/typescript-estree/node_modules/brace-expansion"].version).toBe("5.0.12");
    expect(manifest.overrides).not.toHaveProperty("braces");
  });
});
