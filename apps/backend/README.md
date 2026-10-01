# Backend

Express API (TypeScript, ESM, run via `tsx`) plus the **Local Model Management** feature: discover, download, load, run inference on, and unload QVAC models locally.

## Setup

```bash
npm ci   # from the repo root
```

`@qvac/sdk` needs its local cache directory to have real disk space available (a model can be 1GB+). This repo points it at `.qvac-cache/` at the repo root via `qvac.config.mjs`, computed relative to the repo — nothing to configure per machine. See [Config](#config).

## Scripts

Run from the repo root, or with `--workspace=apps/backend`:

| Command | What it does |
|---|---|
| `npm run dev:server` | Starts the Express server on `:3001` (`tsx watch`) |
| `npm run model-lifecycle-demo --workspace=apps/backend` | Runs the full lifecycle for real, both sources, no HTTP — see [Demo script](#demo-script) |

Only run **one** QVAC-backed process at a time (`dev:server` *or* the demo script) — the SDK locks its local storage to a single process; running both concurrently fails with `File descriptor could not be locked`.

## Project structure

```
src/
  server.ts                    Express app: wiring, graceful shutdown
  ai/orchestrator/              Pre-existing LangGraph experiment (unrelated to models/)
  models/
    domain/                    Types, ports (interfaces), centralized error type — no @qvac/sdk here
      types.ts
      ports.ts
      errors.ts
    infra/
      qvacRuntimeAdapter.ts    The ONLY file that imports @qvac/sdk for runtime calls
    service/
      models.service.ts        Orchestrates the lifecycle, owns "what's loaded" state
      models.service.const.ts
    router/
      models.router.ts          HTTP layer: parse -> delegate -> respond, no business logic
      models.router.const.ts
      models.router.helpers.ts  Request parsers + error-to-HTTP mapping
    demo.ts                     End-to-end proof script (see below)
    demo.const.ts
qvac.config.mjs                  @qvac/sdk cache location, computed relative to the repo root
postman/                         Postman collection for manual endpoint testing
```

## Local Model Management

### Architecture

```
router/   HTTP concerns only: read req, validate/parse, call the service, map errors to status codes
service/  Business logic: orchestrates the lifecycle, is the single source of truth for "is X loaded?"
domain/   Types + interfaces (ports) — framework/SDK-agnostic
infra/    QVAC-specific: the only layer that knows @qvac/sdk exists
```

The service depends on two narrow interfaces instead of one:

- `ModelProvisioningPort` — `provision(source)`: downloads weights to disk, doesn't touch memory.
- `ModelRuntimePort` — discovery (`searchRegistry`/`listRegistry`) plus the in-memory lifecycle (`load`/`infer`/`unload`/`close`).

`QvacRuntimeAdapter` (in `infra/`) implements both. Swapping the runtime later means implementing those two interfaces again — nothing in `service/` or `router/` needs to change.

### Lifecycle

```
discover  ->  provision (setup)  ->  load  ->  infer  ->  unload  ->  close
```

`provision` and `load` are deliberately separate calls. `provision` uses the SDK's `downloadAsset()` to fetch weights to local disk **without** loading them into memory — this is the "download during setup" step, never bundled with the app. A later `load` for the same source reuses the cached file instead of re-downloading.

### Endpoints

Base path: `/api/models`

| Method | Path | Body / Query | Does |
|---|---|---|---|
| `GET` | `/registry` | `?filter=&engine=&quantization=` (all optional) | Lists or searches the QVAC registry |
| `POST` | `/provision` | `{ source }` | Downloads weights to disk (setup step) |
| `POST` | `/load` | `{ source }` | Loads the model into memory, returns `{ modelId }` |
| `POST` | `/:modelId/infer` | `{ prompt }` | Runs inference, returns `{ text }` |
| `POST` | `/:modelId/unload` | — | Unloads the model from memory |
| `POST` | `/close` | — | Closes the underlying QVAC runtime connection |

`source` is one of:
```jsonc
{ "kind": "registry", "registryPath": "...", "registrySource": "..." }
{ "kind": "url", "url": "https://..." }
```
(Both accept an optional `modelType`, default `"llamacpp-completion"`.)

### Error handling

Every failure becomes a single `ModelManagementError` type tagged with the stage it happened in (`discovery`, `download`, `load`, `inference`, `unload`, `close`, `not-found`). The router (`models.router.helpers.ts`) maps that stage to an HTTP status — `not-found` (model isn't currently loaded) → `404`, everything else → `502` — and always returns a generic message to the client while logging the real error (with the original SDK error as `cause`) server-side.

### Demo script

`apps/backend/src/models/demo.ts` (`npm run model-lifecycle-demo --workspace=apps/backend`) exercises the real `ModelManagementService`/`QvacRuntimeAdapter` end to end, no HTTP involved:

1. **Registry source** — searches for a specific known-small model (`Qwen3-1.7B-Q4_0`) and runs `provision -> load -> infer -> unload` on it.
2. **URL source** — same lifecycle, loading directly from a HuggingFace file URL.

`unload` runs in a `finally` block, so it happens even if inference fails. This is the closest thing to a real acceptance test this feature has — it downloads an actual model over the network, so it needs real disk space and connectivity to run.

### Testing manually

Import `apps/backend/postman/local-model-management.postman_collection.json` into Postman. It covers all 6 endpoints in order (discovery → provision → load → infer → unload → close), including the expected error cases (invalid body → 400, unknown/already-unloaded model → 404). `modelId` is captured automatically from the Load response into a collection variable.

### Config

`apps/backend/qvac.config.mjs` sets `cacheDirectory` — where `@qvac/sdk` stores downloaded weights. It's pointed at `.qvac-cache/` at the repo root instead of the SDK's default (`$HOME/.qvac`) on purpose: it keeps everyone's downloaded weights in one predictable, project-local place instead of buried in a machine-wide home directory, so it's trivial to find and wipe — e.g. `rm -rf .qvac-cache` to force a clean re-download when testing provisioning, or just to reclaim disk space without hunting for it.

`@qvac/sdk` requires `cacheDirectory` to be an absolute path, so this is a `.mjs` config (not `.json`) that computes it from the config file's own location at load time:

```js
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export default { cacheDirectory: path.join(repoRoot, '.qvac-cache') };
```

Nothing to edit per developer/machine/OS — it resolves correctly wherever the repo is cloned. The directory itself is gitignored; weights are never committed.

## Local Text-to-Speech (TTS)

### Architecture

Same layering as [Local Model Management](#local-model-management):

```
router/   HTTP concerns only: read req, validate/parse, call the service, map errors to status codes
service/  Business logic: a single "current synthesis" slot (no queue), reuses ModelManagementService for the model lifecycle
domain/   Types + interfaces (ports) — framework/SDK-agnostic
infra/    QVAC-specific: the only layer that knows @qvac/sdk exists
```

`TtsService` reuses the existing `ModelManagementService` to load the
Supertonic2 model (`SUPERTONIC2_TTS_MODEL_SOURCE` in
`src/config/models.config.ts`), exactly like `TranscriptionService` does for
whisper. Unlike the models/speech features, there's no `requestId`-keyed
map here: `@qvac/sdk`'s `textToSpeech()` doesn't expose a per-call
`requestId` the way `loadModel()`/`completion()` do, so `TtsService` keeps a
single synthesis slot instead — a second `POST /api/tts` while one is
pending gets a `409`, and cancellation goes through the SDK's broad-cancel
escape hatch (`cancel({ modelId, kind: 'tts' })`) rather than a
per-request cancel.

### Endpoints

Base path: `/api/tts`

| Method | Path | Body | Does |
|---|---|---|---|
| `POST` | `/` | `{ text }` | Starts synthesizing `text` in the background; `202` once the model is loaded and synthesis has started |
| `POST` | `/cancel` | — | Cancels the in-flight synthesis, if any (no-op otherwise) |
| `GET` | `/status` | — | `{ state: 'idle' \| 'pending' \| 'succeeded' \| 'failed' \| 'cancelled' }` |
| `GET` | `/audio` | — | The synthesized WAV bytes (`audio/wav`), once `state` is `'succeeded'`; `404` otherwise |

### Demo script

`apps/backend/src/tts/demo.ts` (`npm run tts-demo --workspace=apps/backend`)
exercises the real `TtsService`/`QvacTtsAdapter` end to end, no HTTP
involved: synthesizes a short sentence, writes + plays the resulting WAV
locally, then starts a longer synthesis and cancels it mid-flight to prove
the stop control actually interrupts local synthesis — no cloud service
involved anywhere in the path. Same "only one QVAC-backed process at a
time" constraint as the other demo scripts applies.

## Conventions

- **Only `infra/qvacRuntimeAdapter.ts` imports `@qvac/sdk`.** Everything else works against `domain/ports.ts`. If you need a new SDK call, it goes in that file.
- **Constants live in `<name>.const.ts` next to the file that owns them**, not inline in classes/functions — except constants that identify a concrete model (registry entry, source, model type). Those live centrally in `src/config/models.config.ts`, grouped by capability, so every pipeline (`models`, `ai/orchestrator`, `speech`, ...) reads from one place instead of hardcoding its own.
- **The router never decides business logic or guesses model state** (e.g. it doesn't pre-check "is this loaded?" — it lets the service throw and translates the error).
