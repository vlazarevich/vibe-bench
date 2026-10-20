# syntax=docker/dockerfile:1
# Vibe bench dashboard. Build: docker build -t vibe-bench .   Run: see deploy/docker/compose.yml.
ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-bookworm-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Production dependencies only, in a flat layout without pnpm symlinks.
FROM node:${NODE_VERSION}-bookworm-slim AS dependencies
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --prod --frozen-lockfile --config.node-linker=hoisted

FROM node:${NODE_VERSION}-bookworm-slim
LABEL org.opencontainers.image.title="Vibe bench dashboard"
ENV NODE_ENV=production \
    VIBE_HOST=0.0.0.0 \
    VIBE_PORT=8080 \
    VIBE_LOCAL_ROOT=/data
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /src/package.json ./
COPY --from=build /src/dist/server ./dist/server
COPY --from=build /src/dist/web ./dist/web
# Embedded PostgreSQL refuses to run as root; /data holds its state when DATABASE_URL is unset.
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.VIBE_PORT}/api/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/server/serve.mjs"]
