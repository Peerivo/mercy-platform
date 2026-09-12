import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: 0,
  use: { baseURL: "http://127.0.0.1:3000", trace: "off", screenshot: "off" },
  webServer: { command: "npm run dev -- --hostname 127.0.0.1", url: "http://127.0.0.1:3000/health", timeout: 120_000, reuseExistingServer: false },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
