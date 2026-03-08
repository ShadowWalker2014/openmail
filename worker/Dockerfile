FROM node:22-alpine
RUN npm install -g bun
WORKDIR /app

# Copy workspace root manifest + lockfile for bun workspace resolution
COPY package.json bun.lock* ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY worker/package.json ./worker/package.json
RUN bun install --frozen-lockfile

# Copy source files in workspace layout
COPY packages/shared ./packages/shared
COPY worker/src ./worker/src
COPY worker/tsconfig.json ./worker/tsconfig.json

CMD ["bun", "run", "worker/src/index.ts"]
