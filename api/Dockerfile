FROM node:22-alpine
RUN npm install -g bun
WORKDIR /app

# Copy workspace root manifest + lockfile for bun workspace resolution
COPY package.json bun.lock* ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY api/package.json ./api/package.json
RUN bun install --frozen-lockfile

# Copy source files in workspace layout
COPY packages/shared ./packages/shared
COPY api/src ./api/src
COPY api/tsconfig.json ./api/tsconfig.json

EXPOSE 3001
CMD ["bun", "run", "api/src/index.ts"]
