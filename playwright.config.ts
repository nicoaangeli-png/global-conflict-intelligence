import { defineConfig } from "@playwright/test";

/**
 * Tests de bout en bout (navigateur) : fichiers `*.spec.ts` sous `tests/` (Vitest lit `*.test.ts`).
 * Toutes les API ORBITAL sont simulées dans le navigateur : aucun appel Internet.
 *
 * - local : serveur de développement lancé automatiquement (réutilisé s'il tourne) ;
 * - CI : `E2E_SERVER_COMMAND="pnpm start -p 3011"` après `pnpm build`.
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.MOBILE_TEST_URL ?? "http://localhost:3011",
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: process.env.E2E_SERVER_COMMAND ?? "pnpm dev --port 3011",
    url: "http://localhost:3011",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
