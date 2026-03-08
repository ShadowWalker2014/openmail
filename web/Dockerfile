FROM node:22-alpine AS builder
RUN npm install -g bun
WORKDIR /app
COPY web/package.json web/tsconfig.json web/vite.config.ts web/tailwind.config.js web/postcss.config.js ./
COPY web/.env ./.env
RUN bun install --frozen-lockfile
COPY web/src ./src
COPY web/index.html ./index.html
RUN bun run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
