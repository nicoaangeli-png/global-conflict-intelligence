import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Aucun test ne doit appeler un service réseau réel : les connecteurs sont testés sur fixtures.
    testTimeout: 15000,
  },
});
