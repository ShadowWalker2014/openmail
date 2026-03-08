FROM node:22-alpine
RUN npm install -g bun
WORKDIR /app

# Copy workspace root manifest + lockfile for bun workspace resolution
COPY package.json bun.lock* ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY tracker/package.json ./tracker/package.json
RUN bun install --frozen-lockfile

# Copy source files in workspace layout
COPY packages/shared ./packages/shared
COPY tracker/src ./tracker/src
COPY tracker/tsconfig.json ./tracker/tsconfig.json

EXPOSE 3003
CMD ["bun", "run", "tracker/src/index.ts"]
