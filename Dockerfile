# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm test && npm run build

# 런타임: 서버는 의존성까지 한 파일로 번들돼 있어 node_modules가 필요 없다
FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/web
WORKDIR /app
COPY --from=build /src/apps/server/dist/server.cjs ./server.cjs
COPY --from=build /src/apps/web/dist ./web
USER node
EXPOSE 8080
CMD ["node", "server.cjs"]
