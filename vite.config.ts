import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/web",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../../dist/web", emptyOutDir: true },
  // In development, Vite serves the page and forwards API calls to the Node server.
  // The Host header stays the page's (localhost:5173): the setup wizard detects its address from it (decision 028 J).
  server: {
    proxy: { "/api": { target: "http://localhost:3000", changeOrigin: false } },
  },
});
