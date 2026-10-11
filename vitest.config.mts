import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The suite runs in Europe/London unless TZ is set explicitly, so a laptop
// and CI agree. London is the zone the product's weeks are defined in (see
// lib/strength/rollup.ts) and it has real clock changes; CI also runs the
// tests under other zones to keep them zone-independent. Set before the
// workers start, which inherit it.
process.env.TZ ||= "Europe/London";

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
