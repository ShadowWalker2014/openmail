FROM node:22-alpine
RUN npm install -g bun
WORKDIR /app

# Copy workspace root manifest + lockfile for bun workspace resolution
COPY package.json bun.lock* ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY mcp/package.json ./mcp/package.json
RUN bun install --frozen-lockfile

# Copy source files in workspace layout
COPY packages/shared ./packages/shared
COPY mcp/src ./mcp/src
COPY mcp/tsconfig.json ./mcp/tsconfig.json

EXPOSE 3002
CMD ["bun", "run", "mcp/src/index.ts"]
