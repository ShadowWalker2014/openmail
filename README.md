# OpenMail

Open-source alternative to Customer.io — PLG customer lifecycle email marketing platform with full API and native MCP server for AI agent automation.

## Services

| Service | Path | Port | Description |
|---------|------|------|-------------|
| web | `web/` | 5173 | React + Vite dashboard |
| api | `api/` | 3001 | Hono REST API |
| mcp | `mcp/` | 3002 | MCP HTTP server for AI agents |
| worker | `worker/` | — | BullMQ email/event workers |
| tracker | `tracker/` | 3003 | Pixel open + click tracking |

## Quick Start

```bash
# Install all deps
bun install

# Copy env files
cp api/.env.example api/.env.local
cp web/.env.example web/.env

# Run DB migrations
bun db:migrate

# Start services
bun dev:api
bun dev:web
```

## Stack
- **Frontend**: React + Vite + TanStack Router + shadcn/ui
- **Backend**: Hono + Better Auth + Drizzle ORM
- **Queue**: BullMQ + Redis
- **Email**: Resend
- **MCP**: @modelcontextprotocol/sdk (HTTP transport)
- **Deploy**: Railway (per-service subfolder)
