FROM node:22-alpine
RUN npm install -g bun
WORKDIR /app

# Copy root workspace manifest first (bun needs this to resolve @openmail/shared)
COPY package.json ./package.json
COPY bun.lock* ./

# Copy per-service and shared package manifests for install layer caching
COPY api/package.json ./api/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN bun install --frozen-lockfile

# Copy source files
COPY packages/shared ./packages/shared
COPY api/src ./api/src
COPY api/tsconfig.json ./api/tsconfig.json

EXPOSE 3001
WORKDIR /app/api
CMD ["bun", "run", "src/index.ts"]
