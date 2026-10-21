import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/web",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../../dist/web", emptyOutDir: true },
  // In development, Vite serves the page and forwards API calls to the Node server.
  server: { proxy: { "/api": "http://localhost:3000" } },
});
