FROM oven/bun:1-alpine AS api

WORKDIR /app

COPY package.json ./package.json
COPY apps/api/package.json ./apps/api/package.json
RUN bun install --filter @apotek/api --production

COPY apps/api/src ./apps/api/src
RUN addgroup -S app && adduser -S app -G app \
    && mkdir -p apps/api/storage \
    && chown -R app:app /app

USER app
ENV API_PORT=4000
EXPOSE 4000
CMD ["bun", "apps/api/src/server.ts"]

FROM oven/bun:1-alpine AS web-build

WORKDIR /app

COPY package.json ./package.json
COPY apps/web/package.json ./apps/web/package.json
RUN bun install --filter @apotek/web --production

COPY apps/web ./apps/web
RUN cd apps/web && bun run build

FROM nginx:alpine AS web

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
