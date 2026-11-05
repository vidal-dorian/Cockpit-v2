import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    // The first test of a file loads its PGlite (a PostgreSQL in WASM), which takes seconds on a slow machine.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          include: ["src/server/**/*.test.ts"],
          globalSetup: ["src/server/db/test-db-setup.ts"],
          setupFiles: ["src/server/test-setup.ts"],
          // A worker runs its files one after the other in the same modules: they share one PGlite (test-db.ts)
          // instead of each starting its own, and skip the reload of the app's modules.
          isolate: false,
          unstubGlobals: true,
        },
      },
      {
        extends: true,
        test: {
          name: "web",
          include: ["src/web/**/*.test.{ts,tsx}"],
          setupFiles: ["src/web/test-setup.ts"],
          // Isolated: the screens leak state between files (TanStack queries still in flight, mocked modules).
        },
      },
    ],
  },
});
