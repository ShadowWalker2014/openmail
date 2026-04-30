#!/usr/bin/env bun
/**
 * check-stability-mapping.ts — Stage 0 [A0.1] CI guard.
 *
 * Walks `docs/src/content/**\/*.mdx`, finds every `<StabilityBadge level="stable" />`
 * (or text-marker fallback `**[Stable]**` if a fix-up build ever uses it), derives
 * the heading-anchor immediately above the badge, and asserts that the
 * `(file, section)` pair appears in `docs/stability-mapping.json` AND that the
 * mapped integration test exists somewhere under `api/`, `worker/`, `mcp/`, or
 * `sdk/` with a matching `describe(...)` / `test(...)` / `it(...)` literal.
 *
 * Exit codes:
 *   0  all Stable badges accounted for
 *   1  one or more Stable badges missing a mapping or referenced test
 *   2  internal error (file system, JSON parse)
 *
 * Run via:  bun run lint:stability
 *
 * CI integration is deferred — the script is wired into root package.json but
 * NOT into .github/workflows/ci.yml yet (Stage 0 plan §T5: "CI integration
 * deferred — note in log").
 */

import { readFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { Glob } from "bun";

interface Mapping {
  file: string;
  section: string;
  test: string;
}

interface MappingFile {
  $schema?: string;
  mappings: Mapping[];
}

interface FoundBadge {
  file: string;
  section: string;
  line: number;
}

const REPO_ROOT = resolve(import.meta.dir, "..");
const MAPPING_PATH = resolve(REPO_ROOT, "docs/stability-mapping.json");
const MDX_GLOB = "docs/src/content/**/*.mdx";
// roadmap.mdx is the badge index itself — it lists every label with bullet
// markers and would self-spam this guard. Skip it (badges there are decorative,
// not feature claims).
const SKIP_FILES = new Set<string>(["docs/src/content/roadmap.mdx"]);

function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function findHeadingAbove(lines: string[], badgeLineIdx: number): { heading: string; lineIdx: number } | null {
  for (let i = badgeLineIdx; i >= 0; i--) {
    const m = lines[i].match(/^#{1,6}\s+(.+?)\s*$/);
    if (m) {
      // Strip any trailing inline JSX (the badge itself often sits on the heading)
      const heading = m[1].replace(/<StabilityBadge[^/]*\/>/g, "").trim();
      return { heading, lineIdx: i };
    }
  }
  return null;
}

function extractStableBadges(lines: string[], filePath: string): FoundBadge[] {
  const badges: FoundBadge[] = [];
  const stableBadgeRe = /<StabilityBadge\s+level=["']stable["'][^/]*\/>/;
  const stableMarkerRe = /\*\*\[Stable\]\*\*/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!stableBadgeRe.test(line) && !stableMarkerRe.test(line)) continue;

    const heading = findHeadingAbove(lines, i);
    if (!heading) {
      console.warn(`[warn] ${filePath}:${i + 1} — Stable badge with no heading above; skipping`);
      continue;
    }
    badges.push({
      file: filePath,
      section: slugify(heading.heading),
      line: i + 1,
    });
  }
  return badges;
}

async function loadMapping(): Promise<MappingFile> {
  const raw = await readFile(MAPPING_PATH, "utf8");
  const parsed = JSON.parse(raw) as MappingFile;
  if (!Array.isArray(parsed.mappings)) {
    throw new Error("stability-mapping.json must have a `mappings` array");
  }
  return parsed;
}

async function findMdxFiles(): Promise<string[]> {
  const glob = new Glob(MDX_GLOB);
  const out: string[] = [];
  for await (const f of glob.scan({ cwd: REPO_ROOT, onlyFiles: true })) {
    out.push(f.split(sep).join("/"));
  }
  out.sort();
  return out;
}

async function testNameExists(testName: string): Promise<boolean> {
  // Pattern: "filename.test.ts > describe-name > test-name" or just "filename.test.ts > test-name"
  // We search for occurrences of the rightmost segment as a literal string within any *.test.ts file.
  const segments = testName.split(">").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return false;
  const fileHint = segments[0];
  const literals = segments.slice(1);

  const glob = new Glob("**/*.test.ts");
  const candidates: string[] = [];
  for await (const f of glob.scan({ cwd: REPO_ROOT, onlyFiles: true })) {
    if (f.endsWith(fileHint) || f.endsWith(`/${fileHint}`)) candidates.push(f);
  }
  if (candidates.length === 0) return false;

  for (const candidate of candidates) {
    const content = await readFile(resolve(REPO_ROOT, candidate), "utf8");
    const allLiteralsPresent = literals.every((lit) => {
      // Look for `describe('lit', ...)` or `test('lit', ...)` or `it('lit', ...)` — quote-flexible
      const escaped = lit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(describe|test|it)\\s*\\(\\s*['"\`]${escaped}['"\`]`);
      return re.test(content);
    });
    if (allLiteralsPresent) return true;
  }
  return false;
}

async function main(): Promise<void> {
  let mapping: MappingFile;
  try {
    mapping = await loadMapping();
  } catch (err) {
    console.error(`[fatal] failed to read ${MAPPING_PATH}: ${(err as Error).message}`);
    process.exit(2);
  }

  const mdxFiles = await findMdxFiles();
  const allBadges: FoundBadge[] = [];
  for (const f of mdxFiles) {
    if (SKIP_FILES.has(f)) continue;
    const abs = resolve(REPO_ROOT, f);
    const content = await readFile(abs, "utf8");
    const lines = content.split("\n");
    allBadges.push(...extractStableBadges(lines, f));
  }

  if (allBadges.length === 0) {
    console.log("[info] no Stable badges found in docs — script PASS (nothing to enforce)");
    process.exit(0);
  }

  console.log(`[info] found ${allBadges.length} Stable badge(s) across ${mdxFiles.length} MDX file(s)`);
  console.log(`[info] loaded ${mapping.mappings.length} mapping(s) from ${relative(REPO_ROOT, MAPPING_PATH)}`);

  const failures: string[] = [];

  for (const badge of allBadges) {
    const m = mapping.mappings.find((x) => x.file === badge.file && x.section === badge.section);
    if (!m) {
      failures.push(
        `MISSING MAPPING: ${badge.file}:${badge.line} → section "${badge.section}" not in stability-mapping.json`,
      );
      continue;
    }
    const ok = await testNameExists(m.test);
    if (!ok) {
      failures.push(
        `MISSING TEST: ${badge.file} → "${badge.section}" maps to "${m.test}" but no matching describe/test/it literal found`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(`\n[FAIL] ${failures.length} stability check failure(s):\n`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      `\nFix by either:\n  (a) adding an entry to docs/stability-mapping.json,\n  (b) adding the named integration test, OR\n  (c) downgrading the badge to <StabilityBadge level="beta" />.\n`,
    );
    process.exit(1);
  }

  console.log(`\n[PASS] all ${allBadges.length} Stable badge(s) have a mapping and a referenced test that exists.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`[fatal] ${(err as Error).stack ?? err}`);
  process.exit(2);
});
