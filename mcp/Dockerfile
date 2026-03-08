FROM node:22-alpine
RUN npm install -g bun
WORKDIR /app
COPY mcp/package.json ./package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY bun.lock* ./
RUN bun install --frozen-lockfile
COPY packages/shared ./packages/shared
COPY mcp/src ./src
COPY mcp/tsconfig.json ./tsconfig.json
EXPOSE 3002
CMD ["bun", "run", "src/index.ts"]
