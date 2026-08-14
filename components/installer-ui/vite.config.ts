import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const debug = process.env.DEBUG === "1";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  envPrefix: ["VITE_"],
  resolve: {
    alias: {
      "react/jsx-runtime": resolve(__dirname, "node_modules/react/jsx-runtime.js"),
      "react/jsx-dev-runtime": resolve(__dirname, "node_modules/react/jsx-dev-runtime.js"),
      react: resolve(__dirname, "node_modules/react/index.js"),
      "lucide-react": resolve(__dirname, "node_modules/lucide-react"),
    },
    dedupe: ["react", "react-dom"],
  },
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
