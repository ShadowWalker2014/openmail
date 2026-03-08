FROM node:22-alpine
RUN npm install -g bun
WORKDIR /app

COPY package.json ./package.json
COPY bun.lock* ./
COPY worker/package.json ./worker/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN bun install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY worker/src ./worker/src
COPY worker/tsconfig.json ./worker/tsconfig.json

WORKDIR /app/worker
CMD ["bun", "run", "src/index.ts"]
