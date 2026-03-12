FROM node:22-alpine
ENV NODE_ENV=production
RUN npm install -g bun
WORKDIR /app

COPY package.json ./package.json
COPY bun.lock* ./
COPY api/package.json ./api/package.json
COPY mcp/package.json ./mcp/package.json
COPY worker/package.json ./worker/package.json
COPY tracker/package.json ./tracker/package.json
COPY web/package.json ./web/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN bun install --frozen-lockfile

COPY mcp/src ./mcp/src
COPY mcp/tsconfig.json ./mcp/tsconfig.json

EXPOSE 3002
WORKDIR /app/mcp
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3002}/health || exit 1
CMD ["bun", "run", "src/index.ts"]
