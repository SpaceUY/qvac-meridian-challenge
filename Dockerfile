# One image for both the QVAC provider and the server client; docker-compose.yml
# picks the command per service. WORKDIR is /app because the QVAC config resolves
# .qvac-cache and .lancedb relative to the repo root.
FROM node:22-bookworm-slim

# Bare/Hyperswarm and a few QVAC dependencies compile native addons on install.
# libvulkan1: the prebuilt ggml addons link against the Vulkan loader and fail to
# load without it (CPU inference is used when no GPU/ICD is available).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ libvulkan1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Manifests first so the (slow) install layer is cached until dependencies change.
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY stock-tool/package.json stock-tool/
RUN npm ci

COPY . .

EXPOSE 3001
