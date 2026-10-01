# QVAC Meridian Challenge

Monorepo (npm workspaces) containing an Express API with QVAC-backed local model management, a React + Vite frontend, a deterministic stock-lookup tool, and a QVAC model-serving config (`qvac.config.json`). This is a work-in-progress draft toward the Meridian Components exercise — not all mandatory requirements are implemented yet.

## Release

1. Download the latest release `.zip`.
2. Extract the zip into a folder.
3. Open a terminal inside the extracted folder.
4. Follow **Prerequisites**, **Setup**, and **Development** below to install dependencies and run the app.

## Structure

- `apps/backend` — Express API (`src/server.ts`), local QVAC model lifecycle service, LangGraph orchestrator, port 3001
- `apps/frontend` — Vite + React app, port 5173
- `stock-tool` — workspace package with the deterministic Meridian inventory data used by the stock-lookup tool
- `corpus/` — the provided Meridian document corpus (not yet ingested by an automated pipeline)
- `qvac.config.json` — model config for the QVAC-backed OpenAI-compatible server (repo root, not under a `qvac/` subfolder)

## Prerequisites

- Node.js 22.x and npm 10.x (tested with Node v22.22.2 / npm 10.9.7)
- Internet access for the first run of any model-loading command — QVAC downloads model weights on demand and caches them in `.qvac-cache/` (gitignored) so subsequent runs are offline

## Setup

```bash
npm ci
```

Installs all workspaces (`apps/backend`, `apps/frontend`, `stock-tool`). First install takes a few minutes because a couple of QVAC's dependencies (Bare/Hyperswarm) compile native addons — this is expected, not a hang.

## Development

```bash
npm run dev:server   # backend on http://localhost:3001
npm run dev:client   # frontend on http://localhost:5173
```

## Build

```bash
npm run build:client   # frontend (tsc -b && vite build)
```

There is no build step for the backend yet.

