import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    environmentMatchGlobs: [
      // Node SDK and queue tests run in Node environment for accuracy
      ["src/__tests__/node.test.ts", "node"],
      ["src/__tests__/queue.test.ts", "node"],
      ["src/__tests__/utils.test.ts", "node"],
      // Browser SDK tests run in jsdom
      ["src/__tests__/browser.test.ts", "jsdom"],
    ],
    setupFiles: ["./src/__tests__/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/__tests__/**", "src/**/*.d.ts"],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
