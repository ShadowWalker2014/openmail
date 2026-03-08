FROM node:22-alpine
RUN npm install -g bun
WORKDIR /app

COPY package.json ./package.json
COPY bun.lock* ./
COPY mcp/package.json ./mcp/package.json

RUN bun install --frozen-lockfile

COPY mcp/src ./mcp/src
COPY mcp/tsconfig.json ./mcp/tsconfig.json

EXPOSE 3002
WORKDIR /app/mcp
CMD ["bun", "run", "src/index.ts"]
