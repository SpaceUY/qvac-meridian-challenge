# QVAC Meridian Challenge

Monorepo (npm workspaces) containing an Express API, a React + Vite frontend, and a QVAC model-serving config (qvac.config.json).

## Structure

- `apps/backend` — Express API (`GET /api/ping`), port 3001
- `apps/frontend` — Vite + React app, port 5173
- `qvac.config.json` — model config for the QVAC-backed OpenAI-compatible server

## Setup

```bash
npm ci
```

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

## QVAC model server

Starts a qvac openapi http server with basic loaded models. There are basic models for queries, TTS (text-to-speech), ASR (automate speech recognition) and text embeddings (RAG).

```bash
npm run qvac-server
```

Starts an OpenAI-compatible API (via the `qvac` CLI) backed by the models declared in `qvac/qvac.config.json`. Note: the `qvac-server` script currently passes the config path via a `QVAC_CONFIG_PATH` env var, which this CLI version doesn't read — use `qvac serve openai --config ./qvac/qvac.config.json` directly until the script is fixed.

## Run basic dummy time prompt

Requires previously run `qvac-server`

```
npm run basic-prompt
```
