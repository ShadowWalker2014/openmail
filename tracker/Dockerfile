FROM node:22-alpine
RUN npm install -g bun
WORKDIR /app

COPY package.json ./package.json
COPY bun.lock* ./
COPY tracker/package.json ./tracker/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN bun install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY tracker/src ./tracker/src
COPY tracker/tsconfig.json ./tracker/tsconfig.json

EXPOSE 3003
WORKDIR /app/tracker
CMD ["bun", "run", "src/index.ts"]
