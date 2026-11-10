# Only the Hub goes into the image. The shim and hooks run on the host (design.md §3.8)
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
    HUB_ROLES_FILE=/host/roles.json \
    HUB_CONFIG_FILE=/host/hub.config.json
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY public ./public
# A named volume takes over the owner of this directory when it is first created
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 7777
CMD ["node", "dist/hub/main.js"]
