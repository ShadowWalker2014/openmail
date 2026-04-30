import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDocsUrl } from "./lib/public-urls.js";

// Public URL for the live llms.txt is resolved per Stage 2 [A2.12]:
//   DOCS_PUBLIC_URL / OPENMAIL_DOCS_URL env-var override → WEB_URL-derived
//   (subdomain or /docs path) → SaaS default. Self-hosters get the right
//   URL automatically when subdomain conventions match.

/**
 * Fetch a URL and return its text content, with a short in-process TTL cache
 * so repeated reads in the same server process don't hammer the docs server.
 */
const fetchCache = new Map<string, { text: string; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchText(url: string): Promise<string> {
  const cached = fetchCache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.text;

  const res = await fetch(url, {
    headers: { "User-Agent": "openmail-mcp/1.0", Accept: "text/plain,text/html,*/*" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  const text = await res.text();
  fetchCache.set(url, { text, ts: Date.now() });
  return text;
}

/**
 * Register read-only resources on the MCP server.
 *
 * KEY DESIGN: docs content is fetched LIVE from the published llms.txt URL
 * rather than hardcoded. This means the MCP server never needs to be
 * redeployed when the documentation changes — the docs are always current.
 */
export function registerResources(server: McpServer) {
  // Resolved at registration time per [A2.12]; AGENTS.md "lazy init" preserved.
  const DOCS_BASE_URL = getDocsUrl();
  // ── 1. Full documentation index (llms.txt) ────────────────────────────────
  // The canonical LLM-friendly entry point. Lists all doc pages with summaries
  // so the AI knows what's available and where to look for details.
  server.registerResource(
    "openmail-docs",
    "docs://openmail/index",
    {
      title: "OpenMail Documentation Index",
      description:
        "Full index of OpenMail documentation in LLM-friendly format. " +
        "Fetched live from the published docs — always up to date. " +
        "Covers API reference, SDK guides, MCP server, self-hosting, and more.",
      mimeType: "text/plain",
    },
    async (uri) => {
      const text = await fetchText(`${DOCS_BASE_URL}/llms.txt`);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: `# OpenMail Documentation\nSource: ${DOCS_BASE_URL}/llms.txt\n\n${text}`,
          },
        ],
      };
    }
  );

  // ── 2. Dynamic doc page by path ───────────────────────────────────────────
  // Lets the AI fetch the relevant section from the live docs index by path.
  // Example URIs:
  //   docs://openmail/page/api/contacts
  //   docs://openmail/page/sdk/event-ingestion
  //   docs://openmail/page/mcp/overview
  server.registerResource(
    "openmail-doc-page",
    new ResourceTemplate("docs://openmail/page/{path}", { list: undefined }),
    {
      title: "OpenMail Doc Page",
      description:
        "Retrieve the relevant section from the OpenMail documentation for a given path. " +
        "Read docs://openmail/index first to discover available paths.",
      mimeType: "text/plain",
    },
    async (uri, { path }) => {
      const pageUrl = `${DOCS_BASE_URL}/${path}`;
      const text = await fetchText(`${DOCS_BASE_URL}/llms.txt`)
        .then((llms) => {
          // Extract lines that mention this path, plus section headers for context
          const lines = llms.split("\n");
          const pathLower = String(path).toLowerCase();
          const relevant = lines.filter(
            (l) => l.toLowerCase().includes(pathLower) || l.startsWith("## ") || l.startsWith("# ")
          );
          return relevant.length > 2
            ? `# Documentation: ${path}\n\n${relevant.join("\n")}\n\nFull page: ${pageUrl}`
            : `# Documentation: ${path}\nURL: ${pageUrl}\n\nSee docs://openmail/index for the full documentation index.`;
        })
        .catch(() => `# Documentation: ${path}\nURL: ${pageUrl}`);

      return {
        contents: [{ uri: uri.href, mimeType: "text/plain", text }],
      };
    }
  );
}
