FROM node:22-alpine
RUN npm install -g bun
WORKDIR /app

# Root workspace manifest + lockfile
COPY package.json ./package.json
COPY bun.lock* ./

# All workspace package.json stubs (bun validates all workspaces on install)
COPY api/package.json ./api/package.json
COPY mcp/package.json ./mcp/package.json
COPY worker/package.json ./worker/package.json
COPY tracker/package.json ./tracker/package.json
COPY web/package.json ./web/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN bun install --frozen-lockfile

# Source files for this service + shared
COPY packages/shared ./packages/shared
COPY api/src ./api/src
COPY api/tsconfig.json ./api/tsconfig.json

EXPOSE 3001
WORKDIR /app/api
CMD ["bun", "run", "src/index.ts"]
