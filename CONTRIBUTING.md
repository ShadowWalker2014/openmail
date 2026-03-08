# Contributing to OpenMail

Thank you for your interest in contributing! OpenMail is built by and for developers who want a better, open alternative to Customer.io.

## Ways to Contribute

- **Bug reports** — open an [issue](https://github.com/ShadowWalker2014/openmail/issues/new?template=bug_report.yml)
- **Feature requests** — start a [discussion](https://github.com/ShadowWalker2014/openmail/discussions) or open an [issue](https://github.com/ShadowWalker2014/openmail/issues/new?template=feature_request.yml)
- **Code** — fix bugs, implement features, improve docs
- **Docs** — improve README, add guides, fix typos
- **Design** — UI/UX improvements to the dashboard

## Development Setup

### Prerequisites

- [Bun](https://bun.sh) v1.0+
- PostgreSQL 15+
- Redis 7+

### Steps

```bash
# 1. Fork and clone
git clone https://github.com/YOUR_USERNAME/openmail.git
cd openmail

# 2. Install dependencies
bun install

# 3. Set up environment
cp api/.env.example api/.env.local
cp worker/.env.example worker/.env.local
cp tracker/.env.example tracker/.env.local
# Fill in DATABASE_URL, REDIS_URL, RESEND_API_KEY, BETTER_AUTH_SECRET

# 4. Run migrations
bun db:generate
bun db:migrate

# 5. Start services
bun dev:api      # :3001
bun dev:worker
bun dev:tracker  # :3003
bun dev:mcp      # :3002
bun dev:web      # :5173
```

Or use Docker Compose for the full stack:

```bash
cp .env.example .env
docker compose up -d
```

## Pull Request Process

1. **Branch naming**: `feat/description`, `fix/description`, `docs/description`, `chore/description`
2. **Keep PRs focused** — one feature or fix per PR
3. **Write clear commit messages** — follow [Conventional Commits](https://www.conventionalcommits.org/)
4. **Update docs** — if you change behavior, update README or relevant docs
5. **TypeScript** — all code must be TypeScript, no `any` unless truly necessary
6. **No console.log** — use pino logger
7. **No polling** — use event-driven patterns

### Commit Message Format

```
type(scope): short description

feat(api): add webhook ingestion endpoint
fix(worker): filter unsubscribed contacts before broadcast send
docs(readme): add MCP configuration example
chore(deps): upgrade drizzle-orm to 0.42
```

## Code Style

- TypeScript strict mode — no ignoring type errors
- No try/catch unless absolutely necessary
- Lazy initialization for all services (env vars inside functions, not module top-level)
- Hard deletes only — no soft delete patterns
- API routes only, no server actions

## Project Structure

```
openmail/
├── packages/shared/     # Drizzle schema, shared types, DB client
├── api/src/
│   ├── lib/             # auth, redis, logger
│   ├── middleware/      # session-auth, workspace-api-key-auth
│   └── routes/          # one file per resource
├── worker/src/
│   ├── jobs/            # one file per queue worker
│   └── lib/             # redis, resend, segment-evaluator
├── mcp/src/
│   ├── tools/           # one file per MCP tool group
│   └── lib/             # api-client
├── tracker/src/         # pixel + click tracking
└── web/src/
    ├── components/ui/   # shadcn-style UI components
    ├── hooks/           # TanStack Query hooks
    ├── routes/          # TanStack Router file-based routes
    └── store/           # Zustand global state
```

## Good First Issues

Look for [`good first issue`](https://github.com/ShadowWalker2014/openmail/labels/good%20first%20issue) labels. These are well-defined, self-contained tasks ideal for new contributors.

## Questions?

- Open a [GitHub Discussion](https://github.com/ShadowWalker2014/openmail/discussions)
- Email: [kai@1flow.ai](mailto:kai@1flow.ai)

We review all PRs within 2–3 business days. Thank you for contributing!
