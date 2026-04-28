/**
 * Deployment configuration discovery endpoint.
 *
 * Answers: "what does this OpenMail deployment offer, and where do its
 * public-facing services live?"
 *
 * Why this exists:
 *   - The web dashboard must NOT hardcode `https://mcp.openmail.win/mcp` — it
 *     would be wrong for every self-hosted deployment.
 *   - Self-hosters set ONE env var per public-facing surface; the api
 *     reflects them through this endpoint.
 *   - Adding new MCP capabilities is forward-compatible: extend the JSON
 *     shape; old web clients ignore unknown fields.
 *
 * Forward-compatibility discipline:
 *   - Fields are append-only once shipped. Renames require a deprecation cycle.
 *   - `mcp.authScheme` is a versioned literal — when MCP gains OAuth, the
 *     value changes (e.g. "oauth-2.1") and the dashboard renders a different
 *     UI variant per scheme. No nullable fields, no API URL versioning.
 *
 * Auth:
 *   Session auth (logged-in users only). Public-facing config would leak
 *   deployment topology to scrapers; per-workspace scope is overkill since
 *   config is deployment-wide.
 *
 * NEVER hardcode tool names, endpoint lists, or counts here (per AGENTS.md
 * MCP rules). The dashboard discovers tools by calling MCP itself.
 */

import { Hono } from "hono";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

// SaaS defaults. Self-hosters override via env vars.
const DEFAULT_MCP_URL = "https://mcp.openmail.win/mcp";
const DEFAULT_DOCS_URL = "https://openmail.win/docs";

app.get("/", (c) => {
  return c.json({
    apiUrl: process.env.API_PUBLIC_URL ?? process.env.BETTER_AUTH_URL ?? "",
    mcpUrl: process.env.MCP_PUBLIC_URL ?? DEFAULT_MCP_URL,
    docsUrl: process.env.DOCS_PUBLIC_URL ?? DEFAULT_DOCS_URL,
    mcp: {
      // Versioned literal — when MCP scheme changes, this value changes too.
      // The dashboard reads it and renders the correct setup UI variant.
      authScheme: "bearer-api-key" as const,
      // Where the dashboard sends users to issue/manage credentials.
      keysHref: "/settings/api-keys",
    },
    // Informational; from package.json. Useful for debugging deployment issues.
    version: process.env.OPENMAIL_VERSION ?? "dev",
  });
});

export default app;
