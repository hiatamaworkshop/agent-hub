# Hub だけを載せる。shim と hooks はホストで動く (design.md §3.8)
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    HUB_HOST=0.0.0.0 \
    HUB_PORT=7777 \
    HUB_DATA_DIR=/data \
    HUB_ROLES_FILE=/host/roles.json
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY public ./public
# 名前付き volume は初回作成時にこのディレクトリの所有者を引き継ぐ
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 7777
CMD ["node", "dist/hub/main.js"]
