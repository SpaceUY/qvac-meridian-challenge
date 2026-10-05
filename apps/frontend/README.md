# Meridian Assistant — frontend

React + Vite chat client for the Meridian Assistant backend (`apps/backend`). Talks to the
backend's OpenAI-compatible API over a same-origin dev proxy — no separate frontend API, no CORS
configuration to maintain.

## Stack

TypeScript (strict) · React 19 · Vite · Tailwind CSS · shadcn/ui components · Oxlint · Vitest.

## Run it

Needs the backend running first (`npm run dev:server` from the repo root — see the root
[README](../../README.md) and [`apps/backend/README.md`](../backend/README.md)).

```bash
npm run dev       # Vite dev server, default :5173
npm run build     # tsc -b && vite build
npm run test      # Vitest
npm run lint      # Oxlint
npm run preview   # serve the production build locally
```

## How it talks to the backend

`vite.config.ts` proxies `/v1` and `/api` to `http://127.0.0.1:3001` in dev, so the browser only
ever sees one origin. `src/lib/config.ts` holds the handful of `VITE_`-prefixed overrides (see
`.env.example`) — the completions endpoint, the public model alias, and the session header the
backend uses to group KV-cache by conversation (`X-Meridian-Session`).

## What's here

- **Chat** (`components/chat-panel.tsx`, `message-list.tsx`, `composer.tsx`) — streaming
  responses over SSE, markdown rendering, a "new chat" reset.
- **Citations** (`citation-sources.tsx`) — hover cards over each cited source document.
- **Voice** (`mic-button.tsx`, `recording-bar.tsx`, `audio-playback.tsx`,
  `hooks/use-voice-turn.ts`, `lib/mic-recorder.ts`, `lib/audio-chunk-queue.ts`) — record a
  question, stream the transcribed reply back as audio.
- **Vision** (`attach-button.tsx`, `image-thumbnail-row.tsx`, `image-lightbox.tsx`,
  `lib/image-attachments.ts`) — attach an image to a chat message.
- **Engine panel** (`engine-panel.tsx`, `hooks/use-model-status.ts`,
  `hooks/use-delegation-notifications.ts`, `lib/engine-status.ts`, `lib/peers.ts`) — which model
  is loaded, the resolved hardware tier, and whether chat is currently running locally or
  delegated to a P2P peer.
- **Corpus browser** (`corpus-dialog.tsx`, `document-grid.tsx`, `hooks/use-documents.ts`) — the
  same document inventory the backend's `list_documents` tool sees.
- **Tool badges** (`tool-badges.tsx`, `lib/tool-label.ts`) — which structured tools (e.g.
  `lookup_stock`) a given reply used.

## Tests

`npm run test` runs the Vitest suite under `src/lib/*.test.ts` — parsing (SSE frames, thinking
blocks, citation labels), the chat store, prompt length limits, and the peer/delegation status
formatting. No component/DOM tests yet; these are all pure-logic unit tests.
