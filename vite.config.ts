/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  assetsInclude: ["**/*.JPG"],
  plugins: [react()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Scope vitest to our own source — vendored reference trees (zod-main-2,
  // kysely-master) must never run under `npm test`.
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
}));
