import { defineConfig } from "vitest/config";

// One test run across every app and package. Tests live next to their code
// (src/**/*.test.ts) or in a package's tests/ folder.
export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
  },
});
