# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

This repo implements the Meridian Components challenge: an Express API with QVAC-backed local model
management, retrieval-augmented chat grounded in the `corpus/` document set, local speech-to-text and
text-to-speech, a deterministic stock-lookup tool (`stock-tool/`), P2P delegated inference, and a
React + Vite frontend. See the root `README.md` for the full feature list and setup, and
`apps/backend/README.md` for the backend's module-by-module breakdown.

## Commands

Run from the repo root (npm workspaces: `apps/*`, `stock-tool`).

- `npm ci` — install all workspaces
- `npm run ingest --workspace=apps/backend` — build the local vector store from `corpus/` (required before chat can answer from the corpus)
- `npm run dev:client` — start the frontend dev server (Vite, `apps/frontend`)
- `npm run dev:server` — start the backend dev server (`tsx watch`, `apps/backend`)
- `npm run build:client` — type-check and build the frontend (`tsc -b && vite build`)
- `npm run build --workspace=apps/backend` — tree-shaken `@qvac/sdk` bundle + size report
- `npm test` — run the vitest suite (backend + frontend)
- `npm run lint --workspace=apps/frontend` — run Oxlint on the frontend

`qvac-eval.json` (repo root) declares the commands the grading harness uses to stand up and exercise
the backend — see its `setup`/`start`/`shutdown` entries and the root README's "Grading harness" section.

## Architecture

- **`apps/backend`** — Express server (`src/server.ts`), ESM, run via `tsx`. Modules: `models/` (local
  QVAC model lifecycle), `ai/orchestrator/` (LangGraph chat orchestrator: tool calling, RAG grounding,
  voice), `rag/` (corpus ingestion + retrieval), `speech/` and `tts/` (voice I/O), `document/` (corpus
  document listing), `health/` (readiness).
- **`apps/frontend`** — Vite + React 19 + TypeScript (strict), linted with Oxlint. Chat UI with citation
  hover cards, voice input/output, engine/model status panel, and document browser.
- **`stock-tool`** — standalone npm workspace package with deterministic inventory data, imported
  in-process by the backend's `lookup_stock` tool.
