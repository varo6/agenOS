import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/views/**/*.test.tsx"],
    setupFiles: ["./src/views/mainview/test/setup.ts"],
  },
});
