import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/mobile",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: process.env.MOBILE_TEST_URL ?? "http://localhost:3011",
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm dev --port 3011",
    url: "http://localhost:3011",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
