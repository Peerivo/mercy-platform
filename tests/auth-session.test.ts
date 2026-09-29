import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTH_COOKIE_OPTIONS,
  AUTH_SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth-session";

const root = process.cwd();

describe("auth session persistence", () => {
  it("keeps the browser cookie for exactly three days", () => {
    expect(AUTH_SESSION_MAX_AGE_SECONDS).toBe(259_200);
    expect(AUTH_COOKIE_OPTIONS.maxAge).toBe(259_200);
  });

  it.each([
    "lib/supabase/client.ts",
    "lib/supabase/server.ts",
    "proxy.ts",
  ])("%s applies the shared cookie policy", (relativePath) => {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    expect(source).toContain("AUTH_COOKIE_OPTIONS");
    expect(source).toContain("cookieOptions: AUTH_COOKIE_OPTIONS");
  });
});
