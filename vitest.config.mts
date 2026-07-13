import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", ".worktrees/**", "dist/**"],
  },
  resolve: {
    alias: {
      obsidian: resolve(__dirname, "tests/obsidian-stub.ts"),
    },
  },
});