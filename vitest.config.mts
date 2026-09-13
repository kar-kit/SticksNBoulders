import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Vite resolves the `@/*` paths from tsconfig.json natively; no plugin needed.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["{app,appwrite,components,lib,scripts}/**/*.{test,spec}.{ts,tsx}"],
  },
});
