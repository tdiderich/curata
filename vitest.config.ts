import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: path.resolve(__dirname, "./src/") + "/",
      },
    ],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: "./tests/global-setup.ts",
    setupFiles: "./tests/setup.ts",
    testTimeout: 15000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
