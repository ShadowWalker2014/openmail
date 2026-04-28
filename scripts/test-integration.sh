#!/usr/bin/env bash
# Script: scripts/test-integration.sh
# Created: 2026-04-28
# Purpose: Run new integration tests (campaign-engine, rate-limit, ingest-posthog, ingest-cio) sequentially with unique Docker containers per file
# Keywords: integration-tests, openmail, docker
# Status: active
# Prerequisites: docker daemon running, bun
set -euo pipefail

cd "$(dirname "$0")/.."

run_file() {
  local file="$1"
  local suffix="$2"
  local pg_port="$3"
  local redis_port="$4"
  echo
  echo "═══ $(basename "$file") (suffix=$suffix) ═══"
  OPENMAIL_TEST_SUFFIX="$suffix" \
  OPENMAIL_TEST_PG_PORT="$pg_port" \
  OPENMAIL_TEST_REDIS_PORT="$redis_port" \
    bun test "api/src/integration/$file"
}

# Each file gets a unique suffix and port pair to avoid collision when run
# in the same shell. Cleanup is handled by each file's afterAll().
run_file "rate-limit.test.ts"        "rl"     5444 6390
run_file "ingest-posthog.test.ts"    "phog"   5445 6391
run_file "ingest-cio.test.ts"        "cio"    5446 6392
run_file "campaign-engine.test.ts"   "cmpe"   5447 6393

echo
echo "✓ All new integration suites passed."
