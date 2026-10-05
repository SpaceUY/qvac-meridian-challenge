![MERIDIAN ASSISTANT — local inference, local RAG, local voice & vision, built by SpaceDev](docs/assets/meridian-hero.svg)

> Private company knowledge. Available anywhere. Without sending it anywhere.

```text
$ meridian status

inference        LOCAL        chat + voice + vision (QVAC / llama.cpp)
embeddings       LOCAL        BGE-M3, 1024-dim, native C++ path + SDK fallback
vector store     LOCAL        LanceDB, file-backed, persisted on disk
cloud ai         DISABLED     no API keys, no outbound inference calls
offline          READY        after one `models:fetch` (weights are cached)
```

*Not affiliated with or endorsed by Tether or the QVAC project. "QVAC" and "Meridian Components" are used here only to describe what this project integrates with and who it was built for.*

---

## What this is

Meridian Assistant is a local-first knowledge and inference layer for Meridian Components. It answers sales, support, and field-engineering questions grounded in Meridian's own documents and live inventory, runs entirely on hardware Meridian controls, and exposes an OpenAI-compatible API so it drops into the chat interface Meridian already has — no cloud model provider in the loop.

It is built on **QVAC**: `@qvac/sdk` for local model lifecycle, inference, embeddings, speech-to-text and text-to-speech; LangGraph for the agent loop; LanceDB for the persisted vector store.

<!-- DEMO GIF:
Show: a field engineer asks a question by voice ("What's the warranty on the ServoDrive X4?") →
the engine panel shows the local model answering → the streamed text response appears → a
citation card expands showing the source document. Target length: 10-15 seconds. Capture with
the backend already warm (npm run serve) so the GIF shows inference, not model loading.
-->

---

## The problem

![Why the first cloud pilot failed — cost, margin, data, trust](docs/assets/problem.svg)

Meridian's previous cloud AI pilot failed for reasons that were architectural, not cosmetic: unpredictable cost, third-party data exposure, and insufficient trust in generated answers.

Meridian Assistant addresses those constraints by moving inference, retrieval, embeddings, and company knowledge onto Meridian-controlled hardware.

## What we built

A monorepo (npm workspaces) with:

- **`apps/backend`** — Express API, QVAC local model lifecycle, a LangGraph chat orchestrator with structured tool calling and RAG grounding, speech-to-text/text-to-speech, and the corpus ingest pipeline.
- **`apps/frontend`** — React + Vite chat client: streaming answers, citation cards, voice/image input, and an engine panel showing what's actually running.
- **`stock-tool`** — a deterministic Meridian inventory dataset and query function, wired into the agent as a structured tool.
- **`corpus/`** — the provided Meridian document set, ingested into a local vector store.

No outbound call to a cloud model provider exists anywhere in the dependency tree.

## Why this is different

![Typical cloud assistant vs. Meridian Assistant](docs/assets/why-different.svg)

- **Local-first** — inference, embeddings, and retrieval stay on controlled hardware.
- **Grounded** — deterministic citations come from retrieved corpus evidence.
- **Hardware-aware** — models adapt automatically across low, medium, and high tiers.
- **Resilient** — optional P2P inference falls back locally if the peer disappears.
- **Compatible** — the product exposes a standard OpenAI-compatible API.

## Key capabilities

| Capability | What it does |
|---|---|
| **Chat** | `POST /v1/chat/completions` — OpenAI-compatible, streaming or not, grounded by retrieval, with tool calling for inventory questions |
| **Citations** | Every answer carries `citations: [{file, score}]`, in both streaming and non-streaming responses; empty on a refusal |
| **Voice** | `POST /v1/chat/voice-completions` — speech in, speech out, streamed sentence-by-sentence; a standalone `/api/tts` for text-to-speech alone |
| **Vision** | OpenAI Vision-style `image_url` content parts on `/v1/chat/completions`; JPEG/PNG, magic-byte sniffed (not trusted from the client), WebP auto-transcoded |
| **Stock lookup** | A structured tool backed by a frozen Meridian inventory snapshot; unknown SKUs return suggestions, never an invented quantity |
| **Local model management** | `/api/models` — discover, download, load, run, unload, close any QVAC registry or URL-sourced model |
| **RAG / corpus ingestion** | Incremental, content-hash-based ingest into LanceDB; unchanged documents are never re-embedded |
| **P2P delegated inference** | Offload the chat model to a trusted peer by public key, with automatic local fallback |
| **Hardware-aware tiers** | RAM/CPU detected once per process; chat/STT/TTS model selection follows automatically |
| **Cancellation** | Preload, chat completions (SSE disconnect), TTS, and model inference each support cancellation |

## Proven, not mocked

![Measured, not assumed — bundle size, embedding latency/throughput/load time, test count](docs/assets/metrics.svg)

Measurements come from reproducible project benchmarks, including a measured regression (continuous batching on `medium` tier, reverted) and an open gap (RAG Recall@3/@5 absolute figures not yet committed). See [`docs/i4-native-addon-results.md`](docs/i4-native-addon-results.md), [`docs/i2-simultaneous-completions-results.md`](docs/i2-simultaneous-completions-results.md), and [`docs/bundle-size-report.md`](docs/bundle-size-report.md).

## Architecture

<!-- ARCHITECTURE DIAGRAM
File: docs/assets/architecture.svg

Layers top to bottom: client/OpenAI-compatible API -> Express routers (parse/validate only) ->
AgentService (LangGraph) fanning out to RAG, Tools, Voice/Vision -> ResilientEmbeddingService
(native primary, SDK fallback) -> LanceDB -> ModelManagementService/QvacRuntimeAdapter -> local
model or a delegated Meridian-controlled peer (auto local fallback). One enclosing trust boundary
around everything; no node connects to a public cloud AI provider.
-->

![Meridian Assistant architecture](docs/assets/architecture.svg)

| Component | Responsibility |
|---|---|
| Express routers | Parse/validate HTTP requests, map domain errors to status codes — no business logic |
| `AgentService` / LangGraph graph | Orchestrates one chat turn: retrieval, tool calls, model invocation, citation selection |
| `ResilientEmbeddingService` | Embeds text via the native C++ path, falling over to the QVAC SDK path on init failure or a mid-session crash |
| `LanceDbVectorStore` | Persisted, file-backed vector search over the ingested corpus |
| `ModelManagementService` / `QvacRuntimeAdapter` | Owns model lifecycle state; the only layer that calls `@qvac/sdk` for load/infer/unload |
| `stock-tool` | Deterministic, structured Meridian inventory data and query function |
| P2P provider/consumer | Optional: delegates chat inference to a controlled peer, with heartbeat health checks and fallback |

## How a request flows

![Request flow for a grounded chat completion](docs/assets/request-flow.gif)

RAG runs once before inference. The LLM may loop through structured tools multiple times, while tokens stream directly to the client. Citations are selected deterministically after the graph completes.

## Engineering highlights

![Engineering decisions overview — native embeddings, hardware aware, batching, P2P resilience](docs/assets/engineering-decisions.svg)

| Finding | Decision |
|---|---|
| Native embeddings measured better, but far less than the first benchmark suggested | Fixed the benchmark and shipped the measured improvement with SDK fallback |
| Continuous batching regressed on medium hardware | Kept medium sequential and enabled concurrency only on high |
| Retrieval defaults were not good enough | Benchmarked model, chunking, and threshold against the real corpus |
| Delegated peers can disappear mid-session | Added heartbeat, automatic local fallback, and recovery |
| Two-image vision requests crash the current upstream worker | Product currently caps requests at one image |

Full write-ups with numbers and file references: [Technical challenges & known limitations](#technical-challenges--known-limitations).

## Hardware tiers

![One product, three hardware tiers — low, medium, high](docs/assets/hardware-tiers.svg)

Hardware is detected once per process and maps to a tier automatically; override with `QVAC_RESOURCE_TIER=low|medium|high` on a machine whose GPU doesn't match its RAM. The `low` tier's 8 GB floor is a design target (matching the weakest laptop named in the provided corpus's own field-service policy), not yet benchmarked on that exact hardware class in this submission.

## Security / what leaves the device

![What leaves the device — everything stays local except optional chat-completion delegation to a Meridian-controlled peer; public cloud AI has no connection](docs/assets/security-boundary.svg)

No cloud AI client exists anywhere in this codebase's dependency tree, and the production chat/voice/RAG path never logs prompt text, retrieved context, or generated answers — only request lifecycle events and errors.

Everything that persists on disk is derived and gitignored: the vector store (`.lancedb/`), downloaded model weights (`.qvac-cache/`), and process logs (`.run/`). The optional P2P peer is authenticated by public key and explicitly allow-listed; if it's unreachable the backend falls back to local inference automatically, reported live via `GET /api/chat/status`.

## Quick start

```bash
npm ci
npm run ingest --workspace=apps/backend   # builds the local vector store from corpus/
npm run dev:server                        # backend on :3001
npm run dev:client                        # frontend on :5173, in a second terminal
```

First run needs internet once, to download model weights into `.qvac-cache/` (gitignored, cached for every run after). See [`apps/backend/README.md`](apps/backend/README.md) for the full command reference, including P2P delegated-inference setup.

## Judge this project in 60 seconds

![Judge this project in 60 seconds — install, fetch models, ingest corpus, serve, go offline, ask, verify citations](docs/assets/judge-60-seconds.svg)

This is exactly the path the grading harness (`qvac-eval.json`) drives:

1. `npm ci`
2. `npm run build:server` — generates the plugin-scoped QVAC worker in `apps/backend/qvac/`, which every later step uses
3. `npm run models:fetch` — pre-caches every model asset; no network needed after this
4. `npm run corpus:ingest` — builds `.lancedb` from `corpus/`
5. `npm run serve` — starts the backend detached; see `.run/server.log`
6. `curl http://127.0.0.1:3001/v1/models` — poll until it returns `200` (not `503`)
7. **Disconnect outbound network**
8. Send a chat completion:
   ```bash
   curl -X POST http://127.0.0.1:3001/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{"messages":[{"role":"user","content":"What was Q2 2026 total revenue?"}]}'
   ```
9. Verify the response's `citations[]` array, and that the answer matches `corpus/reports/q2-2026-sales-performance-report.md`
10. `npm run serve:stop`

`qvac-eval.json`'s `readyPath` (`/v1/models`) is the same endpoint step 6 polls — it returns `503` until both the chat and embedding models have finished warming up, `200` once ready.

<details>
<summary><strong>Challenge requirements coverage</strong></summary>

<br>

Legend: ✅ Implemented · 🧪 Tested/demonstrated · ⚠️ Partial or limitation. This table lists only the requirement IDs this team's own code and docs explicitly reference (`Req`/`[x.y]` comments found across the backend and frontend source) — it is not a reproduction of the full official numbering, which isn't committed to this repo.

**Mandatory requirements**

| Requirement | Implementation | Evidence |
|---|---|---|
| [1.2] Model weights excluded from installer size | ✅ | `docs/bundle-size-report.md` — weights fetched at runtime via `models:fetch`, never bundled |
| [1.4] Cancel a response in progress | ✅ 🧪 | SSE disconnect → `agent.cancel(requestId)`; `apps/backend/src/chat/chat.router.ts`; UI stop button, `composer.tsx` |
| [2.1] No invented stock data | ✅ 🧪 | Unknown SKU returns `{matches: [], suggestions}`, never a fabricated quantity — `stock-tool/README.md`, `stockTool.ts` |
| [2.2]/[2.3] Persisted, file-backed vector store matching embedding dimension (not QVAC's own RAG workspace) | ✅ | LanceDB via `embed()`/`ragChunk()` directly, `config/rag.config.ts`'s `EMBEDDING_DIMENSIONS` assertion |
| [2.4] Conversation UI | ✅ | `apps/frontend/src/components/message-list.tsx` |
| [3.1] Structured tool-calling agent loop | ✅ 🧪 | Zod schema + LangGraph tool-call events, not regex-scraped text — `stockTool.ts`, `agentService.ts` |
| [3.1.1] Corpus inventory tool shared by model and UI | ✅ | `listDocumentsTool.ts`, `documents.router.ts`, `corpus-dialog.tsx` |
| [3.1.2] Stock-tool dataset used as given | ✅ | `stock-tool/` unmodified, `verify.mjs` passes |
| [5.1]/[5.1.1] "What the assistant is running on" visible in the UI | ✅ | `engine-panel.tsx` — active model, tier, peer status |
| [5.2] Runtime model/quantization selection by device capability | ✅ 🧪 | `config/resourceTier.ts`, `config/models.config.ts`'s `*_BY_TIER` maps |
| [6.1.2] Citations surfaced to the user | ✅ | `citation-sources.tsx`, `message-list.tsx` |
| [6.1.3] Deterministic reruns (temperature/seed), citations stable across reruns | ✅ 🧪 | `parseGenerationOptions` (`chat.router.helpers.ts`), `citations.ts`'s deterministic sort/round; `chat.router.test.ts` exercises a stock OpenAI SDK client against all three citation-reading modes |
| [6.1.4] Server start requires no network access | ✅ | `models:fetch` pre-caches every asset; `fetchModels.cli.ts` |
| [6.2.1] Plugin-scoped SDK bundle | ✅ | `qvac.config.mjs` — 4 plugins only |
| [6.2.2] Bundle size measured and reported | ✅ 🧪 | `docs/bundle-size-report.md` — 9.6 MB vs 11.8 MB |
| [6.3] KV-cache grouped by session | ✅ | `X-Meridian-Session` header, `DELETE /api/chat/sessions/:sessionId/cache` |

**Extra-mile improvements**

| Improvement | Status | Evidence |
|---|---|---|
| I.2 Continuous batching (simultaneous completions) | ⚠️ Partial — shipped on `high` tier only, by design | `docs/i2-simultaneous-completions-results.md`: real measured regression on `medium`-tier hardware, reverted there |
| I.4 Native C++ inference/embedding path | ✅ 🧪 | `docs/i4-native-addon-results.md`: integrated as primary path with automatic SDK fallback, verified via a real crash test |
| I.5 LoRA fine-tuning on the production model | ⚠️ Blocked, documented | `docs/i5-lora-stage1-results.md`: `qwen3vl` architecture rejected by `finetune()` at every quantization; the supported control model crashes natively (reproducible `STATUS_STACK_BUFFER_OVERRUN`) before an adapter is produced |
| P2P delegated inference + resilience | ✅ 🧪 | Heartbeat health monitor, automatic fallback/recovery, Docker Compose 2-peer demo — `apps/backend/README.md` § Delegated inference |
| TurboQuant KV-cache quantization | ⚠️ Implemented, not enabled by default | `TURBOQUANT_KV_CACHE_ENGINE_CONFIG`/`resolveEngineConfig()` in `config/models.config.ts`; gated behind `kvCacheQuantEnabled`, off on every shipping tier pending its own validation |

</details>

<details>
<summary><strong id="technical-challenges--known-limitations">Technical challenges & known limitations</strong></summary>

<br>

- **A benchmark bug that would have shipped a wrong conclusion.** The first I.4 measurement showed a ~36x native-vs-SDK speedup. It was a synchronous PowerShell call in the RSS sampler blocking Node's event loop, not a real engine difference — found via a standalone diagnostic before the (wrong) number could justify a bigger architectural bet than the real ~13%/~16%/~4x gains warranted. See `docs/i4-native-addon-results.md` §0.
- **An SDK API that looked right but silently dropped a feature.** `batchCompletion()` was the obvious path to continuous batching; its request schema turned out to have no `kvCache` field at any level, which would have broken multi-turn context for every concurrent request. Caught by reading the SDK's actual shipped schema, not just its public types, before writing the implementation. See `docs/i2-simultaneous-completions-results.md`.
- **A native crash reproduced and root-caused, not patched over.** Two image attachments in one message reliably crashed the QVAC/llama.cpp worker. Confirmed it wasn't a path-dedup artifact (same result with distinct image content), then capped the product at one image per message with the root cause documented in code — `apps/backend/src/chat/chat.router.const.ts`.
- **LoRA fine-tuning, attempted honestly and reported as blocked.** Four full attempts against the current `@qvac/sdk`/`@qvac/llm-llamacpp` stack: the production `Qwen3-VL-2B` architecture is rejected by `finetune()` outright (confirmed at two different quantizations), and the one architecture/quantization combination that is supported (`Qwen3-0.6B` Q4_0, QVAC's own documented example) trains correctly for 44 steps and then crashes the native worker — reproduced twice, byte-identical. No adapter was ever produced, and none is claimed. See `docs/i5-lora-stage1-results.md`.
- **P2P delegation that doesn't just fail open or fail silently.** A delegated provider's own SDK primitives only expose a model-wide cancel and no mid-session "the peer died" signal; a heartbeat loop and an explicit once-per-recovery reconciliation step were built on top so the backend notices and recovers without operator intervention or a restart.

</details>

## Team

Built by **SpaceDev** for the QVAC Solutions Service Provider Qualification Exercise (Meridian Components scenario).

`<<<COMPLETE THIS PLACEHOLDER — named contributor list, if the team wants one in the public README>>>`
