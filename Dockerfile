# One image for both the QVAC provider and the server client (docker-compose.yml picks the command). Runs the compiled apps/backend/dist - no tsx/TypeScript/dev tooling in the final image.
# QVAC resolves .qvac-cache/.lancedb relative to the repo root (/app) and qvac.config.mjs from the cwd, so the runtime WORKDIR is /app/apps/backend.

# Shared base: toolchain + workspace manifests, cached until dependencies change. Bare/Hyperswarm and some QVAC deps compile native addons on install.
FROM node:22-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY stock-tool/package.json stock-tool/

# Production-only deps for the backend + the stock-tool workspace it uses.
FROM base AS prod-deps
RUN npm ci --omit=dev --workspace=apps/backend --workspace=meridian-stock-tool

# Full install (needs typescript/@types) to compile src/ -> dist/ and build the plugin-scoped QVAC worker (qvac/worker.entry.mjs, per qvac.config.mjs). Also writes docs/bundle-size-report.md, so docs/ must exist here.
FROM base AS build
RUN npm ci --workspace=apps/backend --workspace=meridian-stock-tool
COPY stock-tool stock-tool
COPY apps/backend apps/backend
RUN mkdir docs \
  && npm run compile --workspace=apps/backend \
  && npm run build --workspace=apps/backend

FROM node:22-bookworm-slim AS runtime
# libvulkan1: prebuilt ggml addons need it even for CPU-only inference. libatomic1: rocksdb-native links against it (pulled in by g++ in the build stage).
RUN apt-get update \
  && apt-get install -y --no-install-recommends libvulkan1 libatomic1 \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app

# Manifests + production node_modules, already compiled for this image.
COPY --from=prod-deps /app ./
COPY stock-tool stock-tool
COPY corpus corpus
COPY apps/backend/qvac.config.mjs apps/backend/
COPY --from=build /app/apps/backend/dist apps/backend/dist
# Plugin-scoped QVAC worker; the SDK finds it next to apps/backend/package.json.
COPY --from=build /app/apps/backend/qvac apps/backend/qvac

WORKDIR /app/apps/backend
EXPOSE 3001
