# I.4 — Native QVAC addon: spike, correction, and production integration

**Date:** 2026-09-29 (spike + benchmark correction same day; production integration same day - see §11)
**Branch:** `main` (local, uncommitted at time of writing — see "Status" below)
**Status: integrated into production RAG**, native path primary with an automatic `@qvac/sdk` fallback.
See §11 onward for the integration decision, architecture, and verification. §0–§10 are the original I.4
spike and its benchmark correction, kept as-is for the record.

**This document has two parts.** Part 1 (§0–§10) is the original I.4 spike: an isolated,
not-wired-into-production proof that `@qvac/embed-llamacpp` can be driven directly, plus a correction to
its first benchmark run (the ~36x number was a bug in the benchmark, not a real SDK cost - see §0). Based
on the corrected numbers, that spike's own recommendation (§9) was **not** to integrate, since the
remaining gains looked too small to justify a dual-provider design. Part 2 (§11–§15) documents a
subsequent, explicit decision to integrate anyway, given the corrected numbers still showed a consistent
edge (~13% lower latency, ~16% higher throughput, ~4x faster load) and I.4's own framing is specifically
about "raw efficiency in constrained hardware or high throughput" - on an 8GB target machine, that edge
was judged worth taking, behind a fallback that keeps the SDK path as the safety net. Part 2 also
generalizes the spike's one-shot worker into a persistent one suitable for a long-lived server.

The pre-existing RAG/SDK implementation (`apps/backend/src/rag/domain/**`, `rag/infra/qvacEmbeddingAdapter.ts`,
`rag/service/qvacEmbeddingService.ts`, `config/models.config.ts`, `config/rag.config.ts`,
`rag/infra/lanceDbVectorStore.ts`) is **unmodified** - it is now the fallback path, used verbatim. Only
`server.ts` and `rag/ingest/ingest.cli.ts` changed, and only at their one `EmbeddingPort` construction call
site each (§13).

## 0. Correction — the original ~36x latency/throughput numbers were a benchmark bug

The first version of this doc reported native `embed()` calls as ~36x faster than `@qvac/sdk`'s
(606ms/call avg vs. 16.8ms/call avg) and RSS as ~1.87x lower. Those numbers were real measurements, but of
the wrong thing.

**Root cause:** `rssSampler.ts` polled `bare.exe` memory every 100ms via
`execFileSync('powershell.exe', ['-Command', 'Get-Process ...'])`. On this machine, a single
`powershell.exe` invocation costs **~300ms** (measured directly — `cmd.exe /c tasklist` doing the
equivalent lookup costs **~90ms**), and `execFileSync` is *synchronous* — it blocks Node's entire event
loop for however long the child process takes. Sampling every 100ms with a ~300ms blocking call meant the
event loop was blocked almost continuously for the whole SDK-path benchmark, which also blocked the socket
callback that resolves a pending `@qvac/sdk` `embed()` RPC call. That inflated every measured `embed()`
call by hundreds of milliseconds of pure Node-side scheduling delay — invisible to both `embedWorker.js`'s
own timings (measured *inside* the separate `bare.exe` process) and the SDK's own internal
`durationMs` logs (measured *inside* its worker), which is exactly why those two numbers stayed low
(10–20ms) while the Node-side wall-clock measurement ballooned to ~600ms.

**How this was found:** the recommendation to integrate prompted a sanity check on the 606ms/16-19ms
mismatch. A standalone diagnostic (`diagnoseSdkOverhead.ts`, no RSS sampler running) called `embed()` 10
times separately and showed **22.1ms/call avg** — nothing like 606ms. That immediately pointed at
something benchmark-specific rather than the SDK itself; timing a single `powershell.exe` spawn in
isolation confirmed the mechanism.

**Fix:** `rssSampler.ts` now uses non-blocking `execFile` (async) + `cmd.exe /c tasklist` instead of
`execFileSync` + PowerShell, self-rescheduled via `setTimeout` after each sample resolves (never
overlapping, never blocking the loop). §5 below has the corrected numbers, reproduced across 3 runs.

## 1. Native addon found

`@qvac/embed-llamacpp` (v0.34.0, a dependency of `@qvac/sdk` 0.18.2) — described in its own README as
"This native C++ addon, built using the `Bare` Runtime... for efficient generation of high-quality
contextual text embeddings." It wraps a native `BertInterface`/`GGMLBert` class over a llama.cpp/GGML
inference engine. This is the exact same addon `@qvac/sdk`'s own
`node_modules/@qvac/sdk/dist/server/bare/plugins/llamacpp-embedding/plugin.js` imports and wraps.

**Critical property: this addon only runs under the Bare runtime, never under Node.** Its native binding
(`node_modules/@qvac/embed-llamacpp/binding.js`) is:

```js
module.exports = require.addon()
```

`require.addon()` is a Bare-only module loader — Node's `require` has no such method. This is why
`@qvac/sdk` itself doesn't call this addon from the Node process either: `dist/client/rpc/node-rpc-client.js`
spawns a **separate `bare` process** (via `bare-runtime/spawn`, resolving the prebuilt
`bare-runtime-win32-x64` binary already present in this repo's `node_modules` — `bare.exe` v1.33.4) running
`qvac/worker.entry.mjs` (checked into this repo, generated by `@qvac/sdk`'s bundler), which registers the
`llamacpp-embedding` plugin and talks back to the Node client over `bare-rpc` via a named pipe. **The SDK's
"native engine" is already an out-of-process Bare worker — this spike drives the same addon the same way,
just with our own minimal worker script instead of the SDK's RPC/plugin/schema-validation layer.**

### EmbeddingGemma compatibility — confirmed

The exact GGUF file `npm run models:fetch`/`corpus:ingest` already downloaded
(`.qvac-cache/f65ac80496cf061f_embeddinggemma-300m-Q4_0.gguf`, 277,852,192 bytes — matches
`EMBEDDINGGEMMA_300M_Q4_0.expectedSize` from `@qvac/sdk`'s own catalog exactly) loads and runs through
`@qvac/embed-llamacpp` directly with no changes, producing 768-dimension vectors (matches
`EMBEDDING_DIMENSIONS` in `config/rag.config.ts`) on the GPU backend (Vulkan, auto-selected — confirmed via
the native `stats.backendDevice: "gpu"` field), using the exact same default config
(`device: 'gpu', gpuLayers: 99, batchSize: 1024`) the SDK applies today since `models.config.ts`'s
`EMBEDDING_MODEL_SOURCE` sets no `engineConfig` override.

## 2. Architecture — the two paths

**Existing (unchanged):**

```
RAG (qvacEmbeddingService.ts)
  -> qvacEmbeddingAdapter.ts: embed() from "@qvac/sdk"
  -> RPC over a named pipe (bare-rpc)
  -> qvac/worker.entry.mjs (bare process, registers 4 plugins: llm, embeddings, whisper, tts)
  -> llamacpp-embedding plugin -> @qvac/embed-llamacpp (GGMLBert)
  -> C++ engine (llama.cpp / GGML)
```

**New, isolated (this spike — not wired into RAG):**

```
(would-be RAG caller)
  -> nativeEmbedClient.ts: runNativeEmbeddings()
  -> bare-runtime/spawn -> bare.exe (same binary the SDK uses internally)
  -> bare/embedWorker.js (our own script — imports ONLY @qvac/embed-llamacpp)
  -> C++ engine (llama.cpp / GGML)
```

No `@qvac/sdk` runtime call (`loadModel`, `embed`, `unloadModel`, etc.) appears anywhere in
`bare/embedWorker.js` or its dependency chain. The one `@qvac/sdk` import in `nativeEmbedClient.ts` is
`EMBEDDINGGEMMA_300M_Q4_0`, a plain catalog **constant** (name/registryPath/expectedSize) — the same one
`config/models.config.ts` already reads — used only to locate the already-downloaded GGUF file on disk; it
is not a runtime inference call.

## 3. Files changed

All new; nothing existing was modified.

| File | Purpose |
|---|---|
| `apps/backend/src/experiments/native-embed-spike/bare/embedWorker.js` | Runs **inside** Bare. Directly `import`s `@qvac/embed-llamacpp`, loads the model, embeds each input text, unloads. Reads a request JSON, writes a response JSON. |
| `apps/backend/src/experiments/native-embed-spike/nativeEmbedClient.ts` | Node-side glue. Resolves the cached EmbeddingGemma GGUF path, spawns `bare.exe` against `embedWorker.js` via temp request/response files. |
| `apps/backend/src/experiments/native-embed-spike/rssSampler.ts` | Windows `tasklist`-based peak-RSS sampler for `bare.exe`, async/non-blocking (see §0 for why it was originally PowerShell-based and synchronous, and why that was a bug). |
| `apps/backend/src/experiments/native-embed-spike/benchmark.ts` | Runs both paths back-to-back over the same 10 texts, prints load time / avg latency / p50 / throughput / peak RSS. |
| `apps/backend/src/experiments/native-embed-spike/diagnoseSdkOverhead.ts` | Follow-up diagnostic that isolated the §0 benchmark bug: compares 10 separate `embed()` calls vs. 1 batched call, with no RSS sampler running. |
| `apps/backend/src/experiments/native-embed-spike/verifyVectorStore.ts` | Embeds 3 real queries via both paths, checks dimension + cosine similarity, and queries the **existing, already-ingested** `.lancedb` `chunks` table with both vectors. Read-only. |
| `apps/backend/src/experiments/native-embed-spike/bareRuntimeSpawn.d.ts` | Minimal ambient type declaration for `bare-runtime/spawn` (untyped upstream). |
| `apps/backend/package.json` | +2 scripts (`native-embed-benchmark`, `native-embed-verify`); +1 devDependency `bare-runtime@^1.24.2` — already installed transitively via `@qvac/sdk` at the exact same resolved version (1.33.4); `npm install` changed nothing else (see `package-lock.json` diff: one line added). |
| `docs/i4-native-addon-results.md` | This file. |

## 4. How to run

Prerequisites (already done in this environment): `npm run models:fetch` and `npm run corpus:ingest` once,
so `.qvac-cache` holds the EmbeddingGemma GGUF and `.lancedb` holds the `chunks` table.

```bash
npm run native-embed-benchmark --workspace=apps/backend
npm run native-embed-verify --workspace=apps/backend
```

Both are plain `tsx` scripts — no server needs to be running.

## 5. Benchmark results (corrected, this machine — see §0)

Same 10 texts (short queries + 180-word-ish paragraphs, domain-matched to the real corpus), 1 discarded
warmup call, run sequentially so the two `bare.exe` processes never overlap. Run 3 times back-to-back with
the fixed (non-blocking) sampler; all three agreed closely:

| Metric | Run 1 | Run 2 | Run 3 |
|---|---:|---:|---:|
| SDK avg latency | 18.70 ms | 20.90 ms | 21.60 ms |
| Native avg latency | 15.80 ms | 17.70 ms | 19.30 ms |
| SDK load time | 5,642 ms | ~5,887 ms* | ~5,620 ms* |
| Native load time | 1,442 ms | 1,413 ms | 1,405 ms |
| SDK peak `bare.exe` RSS | 934.8 MB | 1,192.8 MB | 1,186.5 MB |
| Native peak `bare.exe` RSS | 968.2 MB | 975.6 MB | 976.2 MB |

\* runs 2–3's SDK load time was cut from the captured log tail; back-computed from the printed
load-time ratio (`native / SDK`) and native's own logged load time.

Detailed run 1 (representative):

| Metric | `@qvac/sdk` (`embed()`) | Native (`@qvac/embed-llamacpp`) | Native vs SDK |
|---|---:|---:|---:|
| Model load time | 5,642 ms | 1,442 ms | **3.9x faster** |
| Avg per-call latency | 18.70 ms | 15.80 ms | 0.84x (essentially equal) |
| p50 latency | 17 ms | 16 ms | essentially equal |
| Throughput | 53.48 embeddings/sec | 63.29 embeddings/sec | 1.18x (modest) |
| Peak `bare.exe` RSS | 934.8 MB | 968.2 MB | no clear winner (noisy, see below) |
| Per-call ms (10 calls) | `[13,12,12,13,12,49,20,19,20,17]` | `[9,10,9,9,9,45,17,16,18,16]` | |

**Per-call latency and throughput: essentially the same between paths.** The earlier ~36x figures did not
survive a bug fix in the measurement itself (§0). **Model load time: genuinely and consistently ~4x
faster natively** across all 3 runs — this held up. **Peak RSS: inconclusive** — native was tightly
clustered (968–976 MB) across runs, while the SDK's ranged more widely (935–1193 MB) including one run
*below* native; with only 3 runs and a ~90ms sampling floor (`cmd.exe`'s own spawn cost), this isn't a
confident signal either way, and the diagnostic and benchmark are not designed to resolve it further.

## 6. Where the real difference comes from

The SDK's own server-side logs (`[request-lifecycle] ... kind=embeddings ... durationMs=N`) report the
**engine-only** execution time for each call — timed from just before `model.run()` to just after
`response.await()`, *inside* the Bare worker, excluding IPC transit: **10–20 ms per call**, matching the
corrected wall-clock numbers above almost exactly. The RPC round trip itself (named pipe framing via
`bare-rpc`, the SDK's request-lifecycle bookkeeping, zod schema parsing via `embedParamsSchema.parse`) adds
only a few milliseconds on top of engine time — not the hundreds of milliseconds the uncorrected benchmark
implied. This makes sense: it's the same C++ engine either way, and a local named-pipe round trip on
Windows is genuinely fast once nothing else is fighting for the event loop.

**Model load time is the one place the native path has a real, repeatable edge.** `loadModel()`
re-validates the cached file's size against the registry catalog, re-registers it with the SDK's model
registry, and spins up the full RPC handshake (spawn `bare.exe`, establish the named pipe, run
`initializeConfig`) even for a model that's already on disk — none of which the native path does; it just
opens the file it was told to open. This is real, but `QvacEmbeddingService.ensureModel()`
(`apps/backend/src/rag/service/qvacEmbeddingService.ts:39-50`) already caches the loaded model behind a
promise and loads it exactly once per server process lifetime — so in the current architecture this ~4
second difference is paid once at first use (or at ingest-CLI startup) and never again, not on every query
or every ingest batch. It would matter more for a design that reloads the embedding model repeatedly
(e.g. a memory-constrained device that evicts and reloads models between requests), which is not what
this backend does today.

## 7. Verification against the existing vector store

`verifyVectorStore.ts` embedded 3 real queries (drawn from `corpus/faqs/support-sla-faq.html` and
`corpus/policies/escalation-matrix.txt`) via both paths and queried the **existing** `.lancedb` `chunks`
table (built entirely by the SDK path via `npm run corpus:ingest` — never rewritten by this spike):

| Query | Dimension (sdk / native) | cosine(sdk, native) | Top result (both paths) | Match |
|---|---|---|---|---|
| "What is the P1 first-response SLA for a production-down issue?" | 768 / 768 | 1.000000 | `policies/escalation-matrix.txt` (score 0.6176) | identical |
| "When did the APAC on-call roster gap close?" | 768 / 768 | 1.000000 | none (below `minScore: 0.54`) | identical |
| "Can we promise a ControLink Gateway rev C delivery next week?" | 768 / 768 | 1.000000 | `emails/016-capa-441-ship-hold.md` (score 0.5756) | identical |

Cosine similarity of `1.000000` for every query means the native and SDK vectors are, for practical
purposes, the same vector (both are L2-normalized in the same way — `bare/embedWorker.js` replicates
`@qvac/sdk`'s own `normalizeVector()` post-processing step exactly). Both paths return the exact same top
result and score against the real, already-populated table, including correctly returning no match for the
query whose best score falls under the configured `minScore` threshold. **A native-path vector is a
drop-in replacement for an SDK-path vector against this vector store.**

## 8. Trade-offs and limitations

This is a spike, not a production replacement. What the SDK path provides that the native path deliberately
skips:

- **Model provisioning**: HTTP/P2P download, checksum/size validation, registry resolution. The native path
  only works because the SDK already downloaded and cached the file — it does not know how to fetch one.
- **Cross-platform delivery**: mobile (React Native/Expo), Electron packaging, iOS/Android prebuild
  selection. This spike hardcodes a Windows dev-machine path resolution style and was only exercised on
  `win32-x64`.
- **Lifecycle management**: the SDK's model registry, multi-model concurrency, delegation
  (peer-to-peer inference), cancellation-by-`requestId`, and crash/restart handling. The native worker here
  is one-shot: load, run N calls, unload, exit — no persistent server, no cancellation, no concurrent
  requests.
- **Observability**: structured logging, telemetry, the request-lifecycle tracing visible in the logs above.
- **Input validation**: the SDK's zod schemas reject malformed requests before they reach the addon; the
  native worker trusts its input JSON.

RSS sampling (`rssSampler.ts`) uses `cmd.exe /c tasklist` — Windows-only. A Linux/macOS equivalent would
read `/proc/<pid>/status` (`VmRSS`) or shell out to `ps -o rss=`. Its ~90ms-per-sample floor also limits
how confidently it can resolve *peak* RSS to better than roughly that granularity — see §5's "inconclusive"
note on memory.

Model path resolution (`resolveEmbeddingGemmaModelPath()`) matches the cache directory's filename pattern
rather than replicating the SDK's content-hash naming scheme — sufficient to find an already-downloaded
file for this one model, not a general-purpose replacement for the SDK's cache/registry logic.

## 9. Does this satisfy I.4? Should it be integrated?

**I.4 as a spike: yes.** A real, production-relevant capability (embedding generation for RAG, using the
exact model and config the product ships) was driven directly through QVAC's native C++ inference addon
(`@qvac/embed-llamacpp`, via the Bare runtime it requires), with zero `@qvac/sdk` runtime calls in the
execution path, on the installed QVAC 0.18.2 toolchain, without upgrading any QVAC package or inventing any
API. The resulting vectors were verified as a drop-in match against the existing, unmodified vector store.

**Integrating it into production RAG: not recommended, on the corrected evidence.** The case for a
dual-provider design (`NativeEmbeddingProvider` as default, `QvacSdkEmbeddingProvider` as fallback) rested
on a ~36x latency/throughput win and a ~550MB RSS saving. Neither survived the §0 correction:

- Per-call latency/throughput are within noise of each other (§5) — there is no runtime win at the RAG hot
  path (`embed()` per query, `embedBatch()` per ingest chunk) worth trading away everything §8 lists
  (provisioning, cross-platform delivery, lifecycle/cancellation, observability, input validation) for.
- The one real, reproducible difference — ~4x faster model *load* — is a one-time cost the current
  architecture already pays once per server lifetime (`QvacEmbeddingService.ensureModel()` caches the
  loaded model behind a promise). It would only matter for a usage pattern that reloads the embedding model
  repeatedly, which this backend does not do.
- RSS is inconclusive (§5), not a demonstrated saving.

If a specific scenario later makes cold-load time itself the bottleneck (e.g. first-query latency on a
freshly started 8GB device, or a design that intentionally evicts/reloads models to save idle memory), that
would be a narrower, well-scoped reason to revisit the native load path specifically — not a reason to run
two embedding providers in parallel today. The spike's code stays in place as a reference for that
possibility and as documentation of how to drive `@qvac/embed-llamacpp` directly, but is **not wired into
any production path**.

## 10. Tests / build status

- No existing file was modified other than `apps/backend/package.json` (added scripts + one devDependency
  already present transitively at the same version) and `package-lock.json` (records that one new
  dependency edge only).
- `npm run test --workspace=apps/backend` (vitest): **286 passed, 2 skipped, 0 failed** (36 test files) —
  identical to the pre-existing baseline; none of this spike's files have or need tests (they're
  standalone scripts, not units the existing suite imports).
- `npx tsc --noEmit -p tsconfig.json` from `apps/backend`: clean for every file this spike added or
  touched. The only errors reported are two pre-existing ones in
  `src/experiments/lora-spike/spike.ts` (a `node:fs` typing mismatch unrelated to this work, present
  before this spike started, not modified by it) — `apps/backend` has no `tsc`/build step wired into
  CI beyond `scripts/bundle.mjs`, so this was never caught before.
- `npm run native-embed-benchmark` and `npm run native-embed-verify` were both run to completion
  multiple times against the real installed `@qvac/sdk` 0.18.2 + EmbeddingGemma 300M Q4_0 model on this
  machine — see §5 and §7 for the actual output.

---

# Part 2 — Production integration

## 11. Integration decision

Given the corrected benchmark (§5), the SDK's own repeated runs, and the spike's §9 recommendation, the
call was made to integrate the native path into production RAG anyway, as primary with an automatic
fallback:

```
NativeEmbeddingProvider  (primary)
       |
       | init/load fails, OR the worker crashes mid-session
       v
QvacEmbeddingService     (fallback, unchanged)
```

Rationale: the corrected numbers (§5, averaged across the 3 runs) are a consistent, reproducible ~13%
lower avg latency, ~16% higher throughput, and ~4x faster model load - modest per-call gains, but I.4's own
framing is specifically about efficiency "in constrained hardware or high throughput" scenarios, and the
target environment is an 8GB machine where a real 4x faster load and a small but real per-call edge both
count. The fallback removes the main risk the spike's §9 flagged (losing the SDK's provisioning/lifecycle/
observability machinery) by keeping that machinery fully in place and available the instant the native path
can't be used - the production system never depends on the native path succeeding.

## 12. What changed from the spike to make this production-ready

The spike's `bare/embedWorker.js` is **one-shot**: load the model, embed however many texts were passed in
one request, unload, exit - built to be timed cleanly in a benchmark. A server embeds an unknown number of
times over its whole lifetime, so production needed a **persistent** worker instead: load once, serve
requests indefinitely over a real IPC channel, until told to stop or until it crashes.

Verified directly (not guessed) before writing the real implementation, because two earlier guesses in this
project already turned out wrong (`Bare.argv` indexing, CJS vs ESM under Bare):

- Bare has **no global `process`** - `bare-process` must be imported explicitly to get `stdin`/`stdout`.
- Piping a spawned Bare process's stdout through Node's `child_process` (`stdio: 'pipe'`) **silently drops
  all output** on this machine - `bare-stdio`'s pipe-vs-tty-vs-"default" detection does not resolve a
  Node-created anonymous pipe the way it resolves a real named pipe, and writes to the "default"
  `fs.createWriteStream` branch never reach the parent. Confirmed with a minimal repro before ruling it out
  as the IPC transport.
- A genuine named pipe works reliably: Node `net.createServer()` listening on `\\.\pipe\...`, with the Bare
  side connecting via `bare-pipe`'s `new Pipe(path)` (a `Duplex` stream) - the exact mechanism `@qvac/sdk`
  itself uses internally (`node-rpc-client.js`: `net.createServer()` + `bare-runtime/spawn`), just with a
  hand-rolled newline-delimited JSON protocol instead of `bare-rpc`'s binary framing.

## 13. Architecture and files changed

```
RagRetrievalService / CorpusIngestService
        |
        v
ResilientEmbeddingService              <-- new: selection + one-way fallback
   |                        |
   v (primary)              v (fallback, lazy, only if needed)
NativeEmbeddingProvider     QvacEmbeddingService              <-- unchanged
   |                              |
   v                              v
NativeEmbeddingClient         QvacEmbeddingAdapter -> @qvac/sdk embed()
   | (named pipe, JSON lines)
   v
bare/embedServer.js (persistent Bare worker)
   |
   v
@qvac/embed-llamacpp -> C++ engine (same engine either way)
```

| File | Status | Purpose |
|---|---|---|
| `rag/infra/nativeEmbedding/bare/embedServer.js` | new | Persistent Bare worker - loads the model once, serves `{"type":"embed","texts":[...]}` requests over the pipe until `{"type":"shutdown"}` or a crash. Same `normalizeVector()` contract as the spike's worker. |
| `rag/infra/nativeEmbedding/nativeEmbeddingClient.ts` | new | Node-side: spawns `bare.exe`, hosts the named-pipe server, matches responses to requests by id, detects crashes (`isCrashed`), graceful `shutdown()` + force-kill timeout, and a `process.once("exit", ...)` safety net so a crashed/ungraceful Node exit can never leak a live `bare.exe`. |
| `rag/infra/nativeEmbedding/nativeEmbeddingProvider.ts` | new | `EmbeddingPort` implementation wrapping the client - lazy `ensureLoaded()` (same cached-promise pattern as `QvacEmbeddingService.ensureModel()`), per-instance call queue, vector validation. Reuses the spike's `resolveEmbeddingGemmaModelPath()`/`DEFAULT_NATIVE_EMBED_CONFIG` from `experiments/native-embed-spike/nativeEmbedClient.ts` rather than duplicating that logic. |
| `rag/infra/embeddingVectorValidation.ts` | new | The empty/non-finite/dimension-lock check `QvacEmbeddingService` already had, factored out so the native provider enforces the identical contract without a second copy of the error-throwing logic. |
| `rag/service/resilientEmbeddingService.ts` | new | The selector/fallback class described in §11 - `EmbeddingPort`, same first-four-constructor-args shape as `QvacEmbeddingService` (see below), plus two test-only injected overrides. |
| `rag/service/resilientEmbeddingService.test.ts` | new | 10 unit tests: provider selection (native success, native init failure, selected-once), crash failover (embed and embedBatch, retry-and-succeed, no-retry-on-non-crash-error, no-native-retry-after-failover), and `unload()` in both states. |
| `server.ts` | modified | Construction call site only: `new QvacEmbeddingService(...)` → `new ResilientEmbeddingService(...)`, identical arguments. Also: `shutdown()` now calls `embeddingPort.unload()` before `modelManagementService.unloadAll()`, so a native worker gets a graceful shutdown request on server exit, not just the client's exit-time kill fallback. |
| `rag/ingest/ingest.cli.ts` | modified | Same one-line construction swap; its existing `await embeddingPort.unload()` cleanup call needed no change. |
| `docs/i4-native-addon-results.md` | modified | This section. |

`server.ts`'s call site:

```ts
// Before
const embeddingPort = new QvacEmbeddingService(modelManagementService, new QvacEmbeddingAdapter(), EMBEDDING_MODEL_SOURCE, DEFAULT_EMBEDDING_BATCH_SIZE);

// After
const embeddingPort = new ResilientEmbeddingService(modelManagementService, new QvacEmbeddingAdapter(), EMBEDDING_MODEL_SOURCE, DEFAULT_EMBEDDING_BATCH_SIZE);
```

Nothing downstream changed: `RagRetrievalService`, `CorpusIngestService`, `LanceDbVectorStore`/`LanceDbVectorStoreWriter`, and every route/CLI that consumes `embeddingPort` still see a plain `EmbeddingPort` (`embed(text)`, `embedBatch(texts)`) and never know which backend answered.

## 14. Fallback and lifecycle behavior

- **Selected once, lazily.** The first `embed()`/`embedBatch()` call triggers `ResilientEmbeddingService.ensureActive()`, which tries `NativeEmbeddingProvider.ensureLoaded()` (spawn `bare.exe`, load the model) exactly once and caches the result as a promise. Every later call reuses that same decision - there is no per-call re-check, matching the "select once, not on every embed call" requirement.
- **Init failure → permanent SDK fallback for the session.** If `ensureLoaded()` rejects (worker fails to spawn, model fails to load, handshake times out), `ResilientEmbeddingService` logs a warning and lazily constructs the existing `QvacEmbeddingService` with the same arguments, which then serves every call for the rest of the process's life.
- **Mid-session crash → one-way failover, not per-call switching.** If a later call to the (already-successfully-loaded) native provider fails and `NativeEmbeddingProvider.isCrashed` is now true (the worker's process exited unexpectedly, or its pipe errored), `ResilientEmbeddingService` permanently repoints itself at the SDK fallback and **retries the failed call once** against it, so the caller sees a successful result instead of a spurious error caused purely by the internal transition. It never attempts to go back to native. A non-crash error (e.g. a genuinely malformed vector) is not treated as a failover trigger - it propagates exactly as it would from either provider alone.
- **Process lifecycle and cleanup:**
  - Graceful: `unload()` → `NativeEmbeddingClient.shutdown()` sends `{"type":"shutdown"}`, waits for the worker to unload the model and exit, force-`kill()`s it if it doesn't within 5s.
  - Server shutdown: `server.ts`'s `shutdown()` now calls `embeddingPort.unload()` before tearing down the SDK's own models, so a native worker gets the graceful path on a normal Ctrl+C/SIGTERM, not just the exit-time kill.
  - Crash/ungraceful exit safety net: `NativeEmbeddingClient` registers `process.once("exit", ...)` at spawn time and kills the child if it's still alive - covers an uncaught exception or a forced `process.exit()` that skips the normal shutdown path entirely. Windows does not kill child processes automatically when the parent exits, so without this a bare.exe could otherwise be orphaned.
  - A single bad request to the worker (malformed JSON, an unexpected error from one `model.run()` call) reports an error over the pipe without killing the worker - only an actual process exit is treated as a crash.

## 15. Verification (this integration, this machine)

- **Unit tests** (`resilientEmbeddingService.test.ts`, 10 new tests, fakes for both providers): provider selection happens once; native-success and native-init-failure paths; crash failover for both `embed()` and `embedBatch()`, including "retries once and succeeds" and "goes straight to SDK on every call after the first failover, without touching native again"; non-crash errors are not treated as failover triggers; `unload()` behavior in both the "only native was ever constructed" and "fallback happened" states.
- **Real end-to-end smoke test #1** (actual `ResilientEmbeddingService` wired exactly as `server.ts` does, real `bare.exe`, real model): `embed()` selected native (`[embedding] native @qvac/embed-llamacpp path is active for this session`), returned a 768-dim unit vector (norm `1.0000000423517186`); a following `embedBatch()` call reused the same loaded worker; `unload()` left no `bare.exe` process running afterward (`tasklist` confirmed empty before and after).
- **Real end-to-end smoke test #2 (crash failover, no fakes):** started the real native provider, then killed its `bare.exe` process externally (`taskkill /F /IM bare.exe /T`) to simulate a crash. The next `embed()` call logged `[embedding] native worker crashed mid-session, failing over to @qvac/sdk for the remainder of this run`, transparently loaded the real SDK path (visible `[sdk:server]`/`[llamacpp-embedding]` logs), and returned a valid 768-dim vector - the caller never saw an error. A third call went straight to the SDK worker with no native retry attempt. No orphaned `bare.exe` process remained after `unload()`.
- `npm run test --workspace=apps/backend` (vitest): **296 passed, 2 skipped, 0 failed** (37 test files - was 286/36 before this integration; +10 new tests, 0 regressions).
- `npx tsc --noEmit -p tsconfig.json` from `apps/backend`: clean for every file this integration added or touched. The only errors reported are the same two pre-existing, unrelated ones in `src/experiments/lora-spike/spike.ts` noted in Part 1.
- `npm run build --workspace=apps/backend` (`node scripts/bundle.mjs`, `@qvac/sdk`'s own worker-bundle build - unrelated to this integration's files, which run under `bare.exe` directly rather than through that bundle): see result recorded at integration time below.

Ran successfully: `[bundle] wrote docs/bundle-size-report.md (9.6 MB vs 11.8 MB full)`, native addon
verification passed for all 9 target hosts. As expected, this build is unaffected by the integration - it
bundles `@qvac/sdk`'s own worker (`qvac/worker.bundle.js`), which is exactly the fallback path's unchanged
code; the native path's files run directly under `bare.exe`, outside this bundle entirely.

## Status

Integrated on `main`, locally, uncommitted at time of writing. Per this repo's/company's git conventions
(never push to `main`/`master` directly — PRs only), this should move to a `feat/` branch before any push;
no push was made as part of this work.
