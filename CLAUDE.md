# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

This is an early-stage scaffold: an npm-workspaces monorepo with a bare Express backend stub and an unmodified Vite + React template frontend. There is no business logic, routing, state management, or styling system in place yet — treat existing patterns as placeholders, not conventions to imitate.

## Commands

Run from the repo root (npm workspaces, not pnpm — this repo does not follow the pnpm default in the global config).

- `npm run dev:client` — start the frontend dev server (Vite, `apps/frontend`)
- `npm run dev:server` — start the backend dev server (`tsx watch`, `apps/backend`)
- `npm run build:client` — type-check and build the frontend (`tsc -b && vite build`)
- `npm run build:server` — no build script currently defined in `apps/backend/package.json`
- `npm run lint --workspace=apps/frontend` — run Oxlint on the frontend (no lint script exists for the backend)

There is no test runner configured in either workspace or the root (`npm test` at the root is a placeholder that exits with an error).

## Architecture

Two independent workspaces under `apps/`, linked only by npm workspaces — no shared package/lib directory exists yet.

- **`apps/backend`** — Express server (`src/server.ts`), run via `tsx`, ESM (`"type": "module"`). Uses the `cors` middleware and exposes a single `GET /api/ping` route on port 3001.
- **`apps/frontend`** — Vite + React 19 + TypeScript (strict, per `tsconfig.app.json`), linted with Oxlint (`.oxlintrc.json`). Currently the default `create-vite` React template (`App.tsx`), not yet adapted to the project.

## Notes

- No `dependencies`/`devDependencies` in the root `package.json` — each workspace manages its own.

