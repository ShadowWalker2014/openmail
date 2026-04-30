/**
 * Public URL resolution for MCP prompts and resources.
 *
 * Stage 2 [A2.12] / T16: removes hardcoded `https://openmail.win/docs` and
 * `https://api.openmail.win` literals from `prompts.ts` and `resources.ts`.
 * Resolution chain mirrors `api/src/routes/config.ts:23-49` so self-hosters
 * automatically get the right URLs without setting extra env vars when
 * subdomain conventions match (api.X / mcp.X / docs.X).
 *
 * Resolution order (no SaaS hardcodes — ever):
 *   1. Explicit override env-var (DOCS_PUBLIC_URL / API_PUBLIC_URL).
 *   2. Convention-based derivation from BETTER_AUTH_URL / WEB_URL / API_URL.
 *   3. Final fallback to the SaaS literal — kept for AGENTS.md "Self-hosted
 *      (single tenant) + hosted SaaS (multi-tenant) both supported".
 *
 * All env-var reads happen INSIDE these functions per AGENTS.md "Lazy init"
 * rule; never at module top level.
 */

function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0"
  );
}

/**
 * Resolve the public docs URL. Used by prompt templates referencing
 * `${DOCS_URL}/llms.txt` and similar.
 */
export function getDocsUrl(): string {
  const explicit = process.env.DOCS_PUBLIC_URL?.trim() ?? process.env.OPENMAIL_DOCS_URL?.trim();
  if (explicit) return explicit;

  const web = process.env.WEB_URL?.trim();
  if (web) {
    try {
      const u = new URL(web);
      if (u.hostname.startsWith("app.")) {
        const base = u.hostname.slice("app.".length);
        return `${u.protocol}//docs.${base}`;
      }
      return `${u.protocol}//${u.host}/docs`;
    } catch {
      // Ignore — fall through to SaaS default.
    }
  }

  // SaaS-default fallback. Self-hosters with no env-vars set get this; they
  // can override via DOCS_PUBLIC_URL.
  return "https://openmail.win/docs";
}

/**
 * Resolve the public API URL — used by setup-event-tracking prompt to show
 * code samples that point at the right deployment.
 */
export function getApiPublicUrl(): string {
  const explicit = process.env.API_PUBLIC_URL?.trim();
  if (explicit) return explicit;

  // BETTER_AUTH_URL is set on api service; useful when MCP runs in same deploy
  // and shares env vars.
  const auth = process.env.BETTER_AUTH_URL?.trim();
  if (auth) {
    try {
      const u = new URL(auth);
      if (isLocalHost(u.hostname)) return `${u.protocol}//${u.hostname}:${u.port || "3001"}`;
      return auth;
    } catch {
      // Ignore.
    }
  }

  return "https://api.openmail.win";
}
