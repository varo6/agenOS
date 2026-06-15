import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

import { createMockShellApiPlugin } from "./dev/mock-shell-api";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), createMockShellApiPlugin()],
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
  },
  server: {
    host: "127.0.0.1",
    port: 4174,
    strictPort: true,
  },
});
