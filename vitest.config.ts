import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Rendu des composants React dans les tests (renderToStaticMarkup), sans import explicite de React.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // « server-only » est résolu par Next.js à la compilation ; en test, module vide.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    env: { ORBITAL_DETECTION_PATH: ":memory:" },
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Aucun test ne doit appeler un service réseau réel : les connecteurs sont testés sur fixtures.
    testTimeout: 15000,
  },
});
