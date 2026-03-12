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

COPY packages/shared ./packages/shared
COPY worker/src ./worker/src
COPY worker/tsconfig.json ./worker/tsconfig.json

WORKDIR /app/worker
CMD ["bun", "run", "src/index.ts"]
