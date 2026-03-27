import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const debug = process.env.DEBUG === "1";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  envPrefix: ["VITE_"],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: Boolean(debug),
    minify: debug ? false : "esbuild",
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
