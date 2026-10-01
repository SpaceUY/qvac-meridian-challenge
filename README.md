# QVAC Meridian Challenge

Monorepo (npm workspaces) implementing the Meridian Components exercise: an Express API with QVAC-backed local model management, retrieval-augmented chat grounded in a real document corpus, local voice input/output, a deterministic stock-lookup tool, a React + Vite frontend, and a QVAC model-serving config (`apps/backend/qvac.config.mjs`). Everything runs locally through QVAC — no cloud AI APIs.

## Release

1. Download the latest release `.zip`.
2. Extract the zip into a folder.
3. Open a terminal inside the extracted folder.
4. Follow **Prerequisites**, **Setup**, and **Development** below to install dependencies, ingest the corpus, and run the app.

## Structure

- `apps/backend` — Express API (`src/server.ts`), port 3001. Local QVAC model lifecycle, a LangGraph chat orchestrator with tool calling and RAG grounding, speech-to-text and text-to-speech, and the corpus ingest pipeline. See [apps/backend/README.md](apps/backend/README.md) for the full breakdown of each feature.
- `apps/frontend` — Vite + React app, port 5173
- `stock-tool` — workspace package with the deterministic Meridian inventory data used by the stock-lookup tool
- `packages/qvac-langgraph` — workspace package: the `ChatQVAC` LangChain chat model adapter (a `BaseChatModel` over an injected `complete` function). Built automatically on install (`prepare` script); rebuild manually with `npm run build --workspace=packages/qvac-langgraph` after editing its source.
- `corpus/` — the provided Meridian document corpus, ingested into a local vector store (see **Setup**, step 2)
- `apps/backend/qvac.config.mjs` — model-serving config for the QVAC-backed OpenAI-compatible server (see [apps/backend/README.md § Config](apps/backend/README.md#config))
- `qvac/` — tree-shaken `@qvac/sdk` bundle produced by `npm run build --workspace=apps/backend` (gitignored build output, not committed — see **Build** below)

## Features

- **Chat** — `POST /v1/chat/completions` (OpenAI-compatible, streaming), grounded by retrieval over the ingested corpus, with a stock-lookup tool call for inventory questions. `POST /api/chat/preload` / `GET /api/chat/status` manage the chat model's lifecycle.
- **Voice** — `POST /v1/chat/voice-completions` (speech in, speech out) and a standalone local TTS API (`/api/tts`).
- **Local model management** — `/api/models`: discover, download, load, run inference on, and unload any QVAC registry or URL-sourced model, all on-device.
- **RAG / corpus ingestion** — `npm run ingest --workspace=apps/backend` builds a file-backed LanceDB vector store from `corpus/`, incrementally: unchanged documents are never re-embedded. Required before chat can answer from the corpus — see [apps/backend/README.md § RAG: corpus ingestion](apps/backend/README.md#rag-corpus-ingestion).
- **Citations** — every `POST /v1/chat/completions` answer carries a `citations` array (one `{ file, score }` entry per source document that grounded the answer, empty on a refusal), in both streaming and non-streaming responses; the frontend surfaces them as a hover card over the answer. See [apps/backend/README.md § Citations](apps/backend/README.md#citations).
- **P2P delegated inference** — a client terminal can offload the chat-completion model to a stronger, controlled peer reachable over the internet by public key (`npm run provider`), with automatic fallback to local inference if delegation fails. Optional — see [apps/backend/README.md § Delegated inference (P2P)](apps/backend/README.md#delegated-inference-p2p) for setup.

## Prerequisites

- Node.js 22.x and npm 10.x (tested with Node v22.22.2 / npm 10.9.7)
- Internet access for the first run of any model-loading command — QVAC downloads model weights on demand and caches them in `.qvac-cache/` (gitignored) so subsequent runs are offline

## Setup

```bash
npm ci
```

1. Installs all workspaces (`apps/backend`, `apps/frontend`, `stock-tool`, `packages/qvac-langgraph`) and builds `packages/qvac-langgraph` automatically via its `prepare` script. First install takes a few minutes because a couple of QVAC's dependencies (Bare/Hyperswarm) compile native addons — this is expected, not a hang.

```bash
npm run ingest --workspace=apps/backend
```

2. Builds the local vector store from `corpus/` (`.lancedb/`, gitignored — **not** part of the repo, so every clone and every `git pull` of `main` needs to run this once). The first run downloads the embedding model (~277 MB) and can take a few minutes; later runs are fast and only re-embed documents that changed. The chat API refuses to start without this table.

Run both commands from the repo root. `npm run ingest` specifically must run with `--workspace=apps/backend` (not from a subfolder, not without the flag) — the QVAC SDK resolves its config by walking up from the current directory, and running it from the wrong place points the model cache somewhere else.

## Local Development

```bash
npm run dev:server   # backend on http://localhost:3001
npm run dev:client   # frontend on http://localhost:5173
```

## P2P Delegated Inference Development

Start remote provider peer. The first argument is the seed to deterministically generate a known public key. For example, providing the seed `46d223b4e0abef080208b21722001e8dff6c2cc370ac7c07579f31309c9db328` we will get back a provider with the following public key `3640fa359b64de0dc045c3aba7f5757b5a4e4174e4405f976ac0b3156330ca9f`. After this seed you can provide a list of allowed client's public keys.

```bash
npm run provider <provider_seed> <list_of_allowed_clients_public_keys>
```

Start local server connected to the previous provider peer by using the provider's public key. We can set up `QVAC_HYPERSWARM_SEED` env variable to generate a deterministic public key for the server as before. For example, the next public key: `7a1a5772e5516de097517ece9d8c3c83087db516842b5fa4dd2fa125c583c18e` is generated by providing a seed `dabbbea7187e11fdac92b41aa6569db22adc882c6fd5d2ff6b62d492e8ba506c`.

```bash
QVAC_HYPERSWARM_SEED=<server_seed> DELEGATE_PROVIDER_PUBLIC_KEY=<provider_public_key> npm run dev:server
```

### Example

Starts a provider with public key `3640fa359b64de0dc045c3aba7f5757b5a4e4174e4405f976ac0b3156330ca9f` only allowing a client which public key is `7a1a5772e5516de097517ece9d8c3c83087db516842b5fa4dd2fa125c583c18e`

```bash
npm run provider 46d223b4e0abef080208b21722001e8dff6c2cc370ac7c07579f31309c9db328  7a1a5772e5516de097517ece9d8c3c83087db516842b5fa4dd2fa125c583c18e
```

Starts a server connected to previous provider peer with the allowed public key `7a1a5772e5516de097517ece9d8c3c83087db516842b5fa4dd2fa125c583c18e` (using the appropiate `QVAC_HYPERSWARM_SEED`).

```bash
QVAC_HYPERSWARM_SEED=dabbbea7187e11fdac92b41aa6569db22adc882c6fd5d2ff6b62d492e8ba506c DELEGATE_PROVIDER_PUBLIC_KEY=3640fa359b64de0dc045c3aba7f5757b5a4e4174e4405f976ac0b3156330ca9f npm run dev:server
```

## Build

```bash
npm run build:client                     # frontend (tsc -b && vite build)
npm run build --workspace=apps/backend   # backend: tree-shaken @qvac/sdk bundle + size report
```

The backend build produces a plugin-scoped, tree-shaken `@qvac/sdk` bundle and writes
`docs/bundle-size-report.md` comparing it against a full-SDK build — see
[`apps/backend/README.md` § Build](apps/backend/README.md#build).

## Grading harness

`qvac-eval.json` (repo root) declares the commands an external grader uses to stand up and
exercise this backend end to end: `setup` (`npm ci && npm run models:fetch && npm run corpus:ingest`),
`start` (`npm run serve`), and `shutdown` (`npm run serve:stop`), plus `readyPath` (`/models`, i.e. the grader polls `GET /v1/models` until it stops returning 503) that
the grader polls until the server is ready. Once ready, the grader exercises
`POST /v1/chat/completions` directly. See
[`apps/backend/README.md` § Scripts](apps/backend/README.md#scripts) and
[§ Endpoints](apps/backend/README.md#endpoints) for what each of those commands and endpoints does.

