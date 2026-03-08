FROM node:22-alpine AS builder
RUN npm install -g bun
WORKDIR /app

COPY package.json ./package.json
COPY bun.lock* ./
COPY web/package.json ./web/package.json

RUN bun install --frozen-lockfile

COPY web/src ./web/src
COPY web/index.html ./web/index.html
COPY web/vite.config.ts web/tailwind.config.js web/postcss.config.js web/tsconfig.json ./web/

WORKDIR /app/web

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN bun run build

FROM nginx:alpine
COPY --from=builder /app/web/dist /usr/share/nginx/html
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
