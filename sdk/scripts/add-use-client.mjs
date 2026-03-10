/**
 * Post-build script: prepend "use client" directive to the React SDK bundles.
 *
 * Rollup (used by tsup for CJS output) strips module-level directives like
 * "use client" during bundling. This script re-adds the directive to the final
 * dist files so Next.js App Router correctly marks all React exports as
 * client-only at the package boundary.
 */
import { readFileSync, writeFileSync } from "node:fs";

const DIRECTIVE = '"use client";\n';
const FILES = ["dist/react.js", "dist/react.cjs"];

for (const file of FILES) {
  const content = readFileSync(file, "utf8");
  if (!content.startsWith(DIRECTIVE)) {
    writeFileSync(file, DIRECTIVE + content);
    console.log(`✓ Added "use client" to ${file}`);
  } else {
    console.log(`  Already present in ${file}`);
  }
}
