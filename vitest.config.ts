import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { APPLICATION_BASE_PATH } from "./services/applicationRoutes";

export default defineConfig({
  base: APPLICATION_BASE_PATH,
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    // The migration-contract tests build a PGlite database and apply migrations
    // inside each test, which costs ~4.3s under parallel load and so sat within
    // a few hundred milliseconds of Vitest's 5s default. Whichever of them lost
    // the scheduling race failed, making the suite non-deterministic. See #90:
    // the setup cost itself is the real fix, and this ceiling only has to be
    // loose enough to catch a genuine hang.
    testTimeout: 30_000,
  },
});
