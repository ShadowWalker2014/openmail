import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import pino from "pino";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

// Public URL for the live llms.txt — update once if the domain ever changes
const DOCS_BASE_URL = process.env.OPENMAIL_DOCS_URL ?? "https://openmail.win/docs";

/**
 * Fetch a URL and return its text content, with a short cache.
 * Using a simple in-process TTL cache so repeated tool calls in one
 * session don't hammer the docs server.
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
 * redeployed when the documentation changes.
 */
export function registerResources(server: McpServer) {
  // ── 1. Full OpenMail documentation index (llms.txt) ───────────────────────
  // This is the canonical LLM-friendly entry point. It lists all doc pages
  // with one-line summaries so the AI knows what's available and where.
  server.registerResource(
    "openmail-docs",
    "docs://openmail/index",
    {
      title: "OpenMail Documentation Index",
      description:
        "Full index of OpenMail documentation in LLM-friendly format (llms.txt). " +
        "Lists all available doc pages — API reference, SDK guides, MCP server, self-hosting, etc.",
      mimeType: "text/plain",
    },
    async (uri) => {
      const text = await fetchText(`${DOCS_BASE_URL}/llms.txt`);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: `# OpenMail Documentation\nFetched live from: ${DOCS_BASE_URL}/llms.txt\n\n${text}`,
          },
        ],
      };
    }
  );

  // ── 2. Dynamic doc page fetcher ───────────────────────────────────────────
  // AI agents can read any specific doc page by providing its path.
  // Example: docs://openmail/page/api/contacts
  //          docs://openmail/page/sdk/event-ingestion
  //          docs://openmail/page/mcp/overview
  server.registerResource(
    "openmail-doc-page",
    new ResourceTemplate("docs://openmail/page/{path}", { list: undefined }),
    {
      title: "OpenMail Doc Page",
      description:
        "Fetch a specific OpenMail documentation page. " +
        "Use path like 'api/contacts', 'sdk/node', 'mcp/overview', 'self-hosting/railway', etc. " +
        "See docs://openmail/index for the full list of available pages.",
      mimeType: "text/plain",
    },
    async (uri, { path }) => {
      const pageUrl = `${DOCS_BASE_URL}/${path}`;
      // Fetch the rendered HTML page and strip tags for clean text
      // The doc site is a React SPA, so we just return the URL and description
      // so the AI knows what to navigate to (actual content is in the llms.txt index)
      const text = await fetchText(`${DOCS_BASE_URL}/llms.txt`).then((llms) => {
        // Extract the relevant section for this page from llms.txt
        const lines = llms.split("\n");
        const pathLower = String(path).toLowerCase();
        const relevant = lines.filter(
          (l) => l.toLowerCase().includes(pathLower) || l.startsWith("## ") || l.startsWith("# ")
        );
        return relevant.length > 2
          ? `# Documentation: ${path}\n\n${relevant.join("\n")}\n\nFull page: ${pageUrl}`
          : `# Documentation: ${path}\nURL: ${pageUrl}\n\nSee docs://openmail/index for full content.`;
      }).catch(() => `# Documentation: ${path}\nURL: ${pageUrl}`);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text,
          },
        ],
      };
    }
  );

  // ── 3. Quick-reference card ───────────────────────────────────────────────
  // A compact cheat-sheet that fits in context without fetching external URLs.
  // Useful when the AI needs a quick reminder without a full docs fetch.
  server.registerResource(
    "openmail-quickref",
    "docs://openmail/quickref",
    {
      title: "OpenMail Quick Reference",
      description:
        "Compact API and SDK quick-reference. Key endpoints, SDK methods, segment field types, " +
        "MCP tool names, and authentication — all in one short document.",
      mimeType: "text/plain",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: `# OpenMail Quick Reference

## Authentication
- API keys: \`Authorization: Bearer om_xxx\` on all /api/v1/* endpoints
- MCP: same Bearer token in the Authorization header
- Ingest API: Bearer OR \`api_key\` in body OR Basic Auth (Customer.io compat)

## Key REST Endpoints (base: /api/v1)
| Resource | Endpoints |
|----------|-----------|
| Contacts | GET/POST /contacts, GET/PATCH/DELETE /contacts/:id, GET /contacts/:id/events |
| Events | POST /events/track { email, name, properties, occurredAt? } |
| Broadcasts | GET/POST /broadcasts, POST /broadcasts/:id/send, POST /broadcasts/:id/test-send |
| Campaigns | GET/POST /campaigns, PATCH /campaigns/:id, POST /campaigns/:id/steps |
| Segments | GET/POST /segments, GET /segments/:id/people |
| Groups | GET/POST /groups, GET /groups/:id/contacts, POST /groups/:id/contacts |
| Templates | GET/POST /templates, PATCH /templates/:id |
| Analytics | GET /analytics/overview, GET /analytics/broadcasts/:id |
| Assets | GET/POST /assets, POST /assets/upload-from-url |

## Ingest API (no auth prefix needed for /api/ingest/*)
- POST /api/ingest/capture — PostHog single event
- POST /api/ingest/batch — PostHog batch (max 100)
- POST /api/ingest/identify — identify/upsert contact
- POST /api/ingest/group — upsert group { groupType, groupKey, attributes, contactEmail? }
- PUT /api/ingest/cio/v1/customers/:id — Customer.io identify
- PUT /api/ingest/cio/v1/objects/:typeId/:id — Customer.io Objects (group)
- PUT /api/ingest/cio/v1/objects/:typeId/:id/relationships — link contacts to group

## Segment Condition Fields
| Field pattern | Example | Operators |
|---|---|---|
| \`attributes.<key>\` | \`attributes.plan\` | eq, ne, gt, lt, gte, lte, contains, not_contains, is_set, is_not_set |
| \`event.<event_name>\` | \`event.plan_upgraded\` | is_set (has triggered), is_not_set (never triggered) |
| \`group.<group_type>\` | \`group.company\` | eq (specific key), is_set (any group), is_not_set, ne |
| \`email\`, \`firstName\`, \`lastName\`, \`phone\`, \`unsubscribed\` | standard fields | eq, ne, contains, is_set, etc. |

## @openmail/sdk Quick Install
\`\`\`bash
npm install @openmail/sdk
\`\`\`

## SDK Key Methods
| Method | What it does |
|--------|-------------|
| \`openmail.identify(email, traits)\` | Create/update contact |
| \`openmail.track(event, props, { userId })\` | Track event → triggers campaigns |
| \`openmail.group(groupKey, traits, { userId, groupType })\` | Upsert group + link user |
| \`openmail.groupPostHog(type, key, props)\` | PostHog-style group identify |
| \`serverTrack(event, props, { userId })\` | Next.js server-side track |
| \`serverIdentify(email, traits)\` | Next.js server-side identify |

## MCP Tools (29 total)
Contacts: list_contacts, create_contact, update_contact, delete_contact, track_event
Broadcasts: list_broadcasts, get_broadcast, create_broadcast, update_broadcast, schedule_broadcast, send_broadcast, delete_broadcast
Campaigns: list_campaigns, create_campaign, update_campaign, pause_campaign
Segments: list_segments, create_segment
Templates: list_templates, create_template, update_template, delete_template
Analytics: get_analytics, get_broadcast_analytics
Assets: list_assets, get_asset, upload_asset_from_url, upload_asset_base64, delete_asset

## Full Docs
- Index: ${DOCS_BASE_URL}/llms.txt
- API Reference: ${DOCS_BASE_URL}/api/authentication
- SDK Guide: ${DOCS_BASE_URL}/sdk/overview
- Event Ingestion: ${DOCS_BASE_URL}/sdk/event-ingestion
- MCP Server: ${DOCS_BASE_URL}/mcp/overview
- Self-Hosting: ${DOCS_BASE_URL}/self-hosting/overview
`,
        },
      ],
    })
  );

  // ── 4. Workspace context (live data) ──────────────────────────────────────
  // Returns a workspace-specific summary the AI can use to ground its actions.
  // This is NOT docs — it's live API data fetched using the caller's API key.
  // We register it as a resource so the AI can proactively read it.
  // NOTE: This resource is registered here but requires the api client
  // to be available. We use a factory pattern and pass apiUrl.
  server.registerResource(
    "workspace-context",
    "openmail://workspace/context",
    {
      title: "Workspace Context",
      description:
        "Live summary of your OpenMail workspace: total contacts, recent analytics, " +
        "active campaigns, and available segments. Useful for grounding AI responses in your actual data.",
      mimeType: "application/json",
    },
    async (uri) => {
      // This resource doesn't have access to the API key here — it's intentionally
      // a lightweight reference. The AI should use MCP tools to fetch live data.
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: [
              "# Workspace Context",
              "",
              "To get live workspace data, use these MCP tools:",
              "- `get_analytics` — 30-day overview (contacts, sends, open rate, click rate)",
              "- `list_campaigns` — active automation campaigns",
              "- `list_segments` — available audience segments",
              "- `list_broadcasts` — recent broadcast history",
              "- `list_contacts` — search contacts",
              "",
              "Example: call `get_analytics` first to understand the workspace state,",
              "then use other tools based on what the user wants to achieve.",
            ].join("\n"),
          },
        ],
      };
    }
  );
}
