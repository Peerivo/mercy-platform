import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: 0,
  use: { baseURL: "http://localhost:3000", trace: "off", screenshot: "off" },
  webServer: {
    command:
      "npm run build && node scripts/prepare-standalone.mjs && node .next/standalone/server.js",
    url: "http://localhost:3000/health",
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      PORT: "3000",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    },
  },
  projects: [{
    name: "chromium",
    use: {
      browserName: "chromium",
      channel: "chromium",
      launchOptions: { ignoreDefaultArgs: ["--disable-back-forward-cache"] },
    },
  }],
});
