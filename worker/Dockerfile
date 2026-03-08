FROM node:22-alpine
RUN npm install -g bun
WORKDIR /app
COPY worker/package.json ./package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY bun.lock* ./
RUN bun install --frozen-lockfile
COPY packages/shared ./packages/shared
COPY worker/src ./src
COPY worker/tsconfig.json ./tsconfig.json
CMD ["bun", "run", "src/index.ts"]
