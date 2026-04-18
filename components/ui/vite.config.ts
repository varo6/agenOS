import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { createMockShellApiPlugin } from "./dev/mock-shell-api";

export default defineConfig({
  plugins: [react(), tailwindcss(), createMockShellApiPlugin()],
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
