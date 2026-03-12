FROM node:22-alpine AS builder
RUN npm install -g bun
WORKDIR /app

# ── Copy workspace manifests so bun install can resolve all workspaces ────────
COPY package.json ./package.json
COPY bun.lock* ./
COPY api/package.json ./api/package.json
COPY mcp/package.json ./mcp/package.json
COPY worker/package.json ./worker/package.json
COPY tracker/package.json ./tracker/package.json
COPY web/package.json ./web/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN bun install --frozen-lockfile

# ── Build docs site with base='/docs/' so it is served at /docs/ by nginx ─────
COPY docs/package.json ./docs/package.json
COPY docs/bun.lock* ./docs/
RUN cd docs && bun install --frozen-lockfile

COPY docs/src ./docs/src
COPY docs/scripts ./docs/scripts
COPY docs/index.html ./docs/index.html
COPY docs/vite.config.ts docs/tailwind.config.ts docs/postcss.config.js docs/tsconfig.json ./docs/
COPY docs/public ./docs/public
WORKDIR /app/docs
RUN bun run build
# docs/dist now contains the built SPA with all assets referencing /docs/...

# ── Build web dashboard ────────────────────────────────────────────────────────
WORKDIR /app

COPY web/src ./web/src
COPY web/public ./web/public
COPY web/index.html ./web/index.html
COPY web/vite.config.ts web/tailwind.config.js web/postcss.config.js web/tsconfig.json ./web/

WORKDIR /app/web
ARG VITE_API_URL
ARG VITE_PUBLIC_API_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_PUBLIC_API_URL=$VITE_PUBLIC_API_URL
RUN bun run build

# ── Final nginx image ──────────────────────────────────────────────────────────
FROM nginx:alpine
ENV NODE_ENV=production

# Web dashboard — served at /
COPY --from=builder /app/web/dist /usr/share/nginx/html

# Docs SPA — served at /docs/
COPY --from=builder /app/docs/dist /usr/share/nginx/html/docs

# Nginx config — direct to conf.d (NOT templates/) so envsubst never runs
# and nginx's own $uri / $uri/ variables are preserved correctly.
COPY web/nginx.conf /etc/nginx/conf.d/default.conf

COPY web/start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:80/ || exit 1
CMD ["/start.sh"]
