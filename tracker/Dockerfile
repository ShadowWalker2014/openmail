FROM node:22-alpine
RUN npm install -g bun
WORKDIR /app
COPY tracker/package.json ./package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY bun.lock* ./
RUN bun install --frozen-lockfile
COPY packages/shared ./packages/shared
COPY tracker/src ./src
COPY tracker/tsconfig.json ./tsconfig.json
EXPOSE 3003
CMD ["bun", "run", "src/index.ts"]
