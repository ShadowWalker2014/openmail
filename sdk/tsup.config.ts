import { defineConfig } from "tsup";

export default defineConfig([
  // Node/server SDK (CJS + ESM)
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "node18",
    platform: "node",
    treeshake: true,
  },
  // Browser SDK
  {
    entry: { browser: "src/browser.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2020",
    platform: "browser",
    treeshake: true,
  },
  // React SDK
  {
    entry: { react: "src/react/index.tsx" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2020",
    platform: "browser",
    external: ["react", "react-dom"],
    treeshake: true,
  },
  // Next.js SDK
  {
    entry: { nextjs: "src/nextjs/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "node18",
    platform: "neutral",
    external: ["react", "react-dom", "next"],
    treeshake: true,
  },
]);
