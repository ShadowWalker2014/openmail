/**
 * Deployment configuration discovery endpoint.
 *
 * Answers: "what does this OpenMail deployment offer, and where do its
 * public-facing services live?"
 *
 * SSOT chain (no hardcoded SaaS literals — ever):
 *   1. Explicit override (e.g. MCP_PUBLIC_URL) — for deployments where the
 *      conventional subdomain pattern doesn't apply.
 *   2. Conventional derivation from BETTER_AUTH_URL / WEB_URL (which IS the
 *      reality of every deployment — these env vars are mandatory at startup).
 *   3. null — if neither override nor derivation is possible. The dashboard
 *      shows a "not configured" warning. We do NOT fall back to upstream's
 *      SaaS host, because doing so silently misconfigures self-hosted
 *      deployments.
 *
 * OpenMail public-subdomain convention (used by derivation):
 *   - api.<base>          → BETTER_AUTH_URL
 *   - app.<base> | <base> → WEB_URL
 *   - mcp.<base>/mcp      → derived from api.<base>
 *   - docs.<base> | <base>/docs → derived from app.<base>
 *
 * Local dev convention (when host is localhost/127.0.0.1):
 *   - api on PORT (default 3001)
 *   - mcp on MCP_PORT (default 3002)
 *   - tracker on TRACKER_PORT (default 3003)
 *
 * Forward-compat discipline:
 *   Fields are append-only once shipped. `mcp.authScheme` is a versioned
 *   literal — when MCP scheme changes (e.g. to "oauth-2.1"), the value
 *   changes in lockstep with the dashboard's setup UI variant.
 *
 * Auth: session (logged-in users only). Public-facing config would leak
 * deployment topology to scrapers; per-workspace scope is overkill since
 * config is deployment-wide.
 *
 * NEVER hardcode tool names, endpoint lists, or counts here (per AGENTS.md
 * MCP rules). The dashboard discovers tools by calling MCP itself.
 */

import { Hono } from "hono";
import type { ApiVariables } from "../types.js";

const app = new Hono<{ Variables: ApiVariables }>();

type UrlSource = "explicit" | "derived" | "unconfigured";

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
}

/**
 * Derive the public MCP URL from BETTER_AUTH_URL using the OpenMail
 * subdomain convention. Returns null if derivation is impossible.
 *
 *   https://api.acme.io      → https://mcp.acme.io/mcp        (subdomain swap)
 *   http://localhost:3001    → http://localhost:3002/mcp      (local dev: separate port)
 *   https://acme.io          → null                           (no convention to apply)
 *   https://acme.io/api      → null                           (path-prefixed deploy: ambiguous)
 */
function deriveMcpUrl(): { url: string; source: UrlSource } {
  const explicit = process.env.MCP_PUBLIC_URL?.trim();
  if (explicit) return { url: explicit, source: "explicit" };

  const auth = process.env.BETTER_AUTH_URL?.trim();
  if (!auth) return { url: "", source: "unconfigured" };

  let u: URL;
  try {
    u = new URL(auth);
  } catch {
    return { url: "", source: "unconfigured" };
  }

  // Local dev — assume mcp on its own port on the same host.
  if (isLocalHost(u.hostname)) {
    const mcpPort = process.env.MCP_PORT?.trim() || "3002";
    return { url: `${u.protocol}//${u.hostname}:${mcpPort}/mcp`, source: "derived" };
  }

  // Subdomain convention: api.X → mcp.X/mcp
  if (u.hostname.startsWith("api.")) {
    const base = u.hostname.slice("api.".length);
    return { url: `${u.protocol}//mcp.${base}/mcp`, source: "derived" };
  }

  // No convention applies — don't guess.
  return { url: "", source: "unconfigured" };
}

/**
 * Derive the public docs URL.
 *
 *   https://app.acme.io      → https://docs.acme.io           (subdomain swap)
 *   https://acme.io          → https://acme.io/docs           (path-prefix on root host)
 *   http://localhost:5173    → http://localhost:5173/docs     (local dev)
 *   (no WEB_URL)             → null
 */
function deriveDocsUrl(): { url: string; source: UrlSource } {
  const explicit = process.env.DOCS_PUBLIC_URL?.trim();
  if (explicit) return { url: explicit, source: "explicit" };

  const web = process.env.WEB_URL?.trim();
  if (!web) return { url: "", source: "unconfigured" };

  let u: URL;
  try {
    u = new URL(web);
  } catch {
    return { url: "", source: "unconfigured" };
  }

  // Subdomain convention: app.X → docs.X
  if (u.hostname.startsWith("app.")) {
    const base = u.hostname.slice("app.".length);
    return { url: `${u.protocol}//docs.${base}`, source: "derived" };
  }

  // Bare host or local dev — assume /docs path on the same origin.
  // Matches what `docs/` service is wired up to serve under reverse proxy.
  return { url: `${u.protocol}//${u.host}/docs`, source: "derived" };
}

app.get("/", (c) => {
  const mcp = deriveMcpUrl();
  const docs = deriveDocsUrl();

  return c.json({
    apiUrl: process.env.BETTER_AUTH_URL ?? "",
    mcpUrl: mcp.source === "unconfigured" ? null : mcp.url,
    mcpUrlSource: mcp.source,
    docsUrl: docs.source === "unconfigured" ? null : docs.url,
    docsUrlSource: docs.source,
    mcp: {
      // Versioned literal — when MCP scheme changes, this value changes too.
      // The dashboard reads it and renders the correct setup UI variant.
      authScheme: "bearer-api-key" as const,
      // Where the dashboard sends users to issue/manage credentials.
      keysHref: "/settings/api-keys",
    },
    // Informational; useful for debugging deployment issues.
    version: process.env.OPENMAIL_VERSION ?? "dev",
  });
});

export default app;
