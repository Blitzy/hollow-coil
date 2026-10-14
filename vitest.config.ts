import { defineConfig } from "vitest/config";

// One test run across every app, package, and the tools. Tests live in each
// one's tests/ folder, mirroring src/.
export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/*/tests/**/*.test.ts", "packages/*/tests/**/*.test.ts", "tools/tests/**/*.test.ts"],
  },
});
