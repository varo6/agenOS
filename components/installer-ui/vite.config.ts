import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const devHost = process.env.TAURI_DEV_HOST;
const debug = process.env.TAURI_ENV_DEBUG;

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    sourcemap: Boolean(debug),
    minify: debug ? false : "esbuild",
  },
  server: {
    host: devHost || false,
    port: 5173,
    strictPort: true,
    hmr: devHost
      ? {
          host: devHost,
          port: 1421,
          protocol: "ws",
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
