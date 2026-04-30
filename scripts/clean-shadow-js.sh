#!/usr/bin/env bash
#
# Purge `.js` shadow files that sit next to `.ts` source files in workspace
# `src/` trees. These artifacts accumulate from past Bun builds and shadow
# in-progress TypeScript edits — bun's module resolver prefers the `.js`
# when the import path uses `.js` extensions (the project's NodeNext
# convention), which made stale code silently win during Phase B perf
# validation. See PRPs/sota-lifecycle-engine/06-perf-validation.md.
#
# Skips:
#   - node_modules (vendor code; never touched)
#   - .bun cache directories
#   - eslint-rules (allowlisted in .gitignore — ESLint requires .js for
#     custom rules)
#   - dist / build output directories
#
# Idempotent. Safe to run on a clean tree (zero deletions, zero output).
# Wired as `pretest` so test runs always start from a clean state.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Find every .ts file in workspace src trees, compute its sibling .js path,
# delete if present. Single pass; xargs -P for parallelism on large trees.
deleted=0
while IFS= read -r ts_file; do
  js_file="${ts_file%.ts}.js"
  if [ -f "$js_file" ]; then
    rm "$js_file"
    deleted=$((deleted + 1))
  fi
done < <(
  find "$ROOT_DIR" \
    -path "*/node_modules" -prune -o \
    -path "*/.bun" -prune -o \
    -path "*/eslint-rules" -prune -o \
    -path "*/dist" -prune -o \
    -path "*/.git" -prune -o \
    -name "*.ts" -print 2>/dev/null
)

if [ "$deleted" -gt 0 ]; then
  echo "clean: removed $deleted shadow .js file(s)"
fi
