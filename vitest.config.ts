import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    // Each test starts its own PGlite (a PostgreSQL in WASM), which takes seconds on a slow machine.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
