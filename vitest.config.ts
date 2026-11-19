import { defineConfig } from "vitest/config";
// Keep SDK subprocess tests from competing with nine independent TS import
// graphs on small development machines. Assertions and integration coverage stay intact.
export default defineConfig({
  test: {
    maxWorkers: 2,
    hookTimeout: 30000,
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**"],
  },
});
