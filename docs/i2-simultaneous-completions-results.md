# I.2 — Simultaneous completions (continuous batching): results

**Branch:** `feat/i2-simultaneous-completions`

**Verdict: implemented for `medium`/`high` tiers via concurrent `completion()` calls admitted by `@qvac/sdk`'s own request registry (keyed to the loaded model's `parallel` config), not `batchCompletion()`. `low` tier is untouched. One important performance caveat below — read before merging.**

## Why `completion()` instead of `batchCompletion()`

The natural first instinct for I.2 is `@qvac/sdk`'s `batchCompletion()` API. Before committing to it, the actual shipped `@qvac/sdk@0.18.2` package was inspected directly (its real schemas/server-side handlers, not just its public `.d.ts`), and it has a disqualifying gap: **`batchCompletion()`'s request schema has no `kvCache` field at all**, at any level — confirmed in its Zod schema, its own JSDoc's "what each prompt may carry" list, and its server-side handler's type signature (which never imports the SDK's `KvCacheSession` module at all, unlike the single-completion handler). Routing chat traffic through it would silently drop named/auto KV-cache reuse for every turn, not just concurrent ones.

Further inspection of the SDK's actual `completionStream` RPC handler (`server/bare/plugins/llamacpp-completion/plugin.js`) showed it already computes `parallel = getModelParallel(modelCfg)` **per request** and passes it as `maxConcurrentPerModel` to the SDK's own admission registry — i.e. plain `completion()` calls are *already* admitted N-way concurrently once the model is loaded with `parallel >= 2`, through the exact same code path that has always had full KV-cache support. One code path, not two; no `tools`/`kvCache` parity gap to maintain between a "normal" path and a "concurrent" path.

## What changed

- **`apps/backend/src/ai/orchestrator/concurrencyLimiter.ts`** (new) — a small bounded FIFO semaphore: `acquire(key)` admits immediately under the limit or queues; `cancel(key)` rejects a still-queued caller without ever admitting it; the returned `release()` frees exactly one slot and advances the queue. Queue depth is capped (default 64, mirroring `@qvac/sdk`'s own `maxQueueDepthPerModel` default for the identical `parallel`-based admission concept) so a burst of callers can't grow the queue unbounded.
- **`QvacChatSession`** — the core rework. `activeRequestId`/`activeModelId`/`completionAbandonSignal` (scalars) became `Map`s keyed by the caller's own `requestId`, so N concurrent completions are tracked independently instead of racing on one field. `complete()` acquires a limiter slot before dispatching; releases it in one `finally` covering every exit path. `cancelActive(requestId)` (was parameterless) checks the limiter first (still-queued → rejected without ever reaching the SDK), then the active map.
  - **Delegated-model cancellation + concurrency, resolved explicitly**: this codebase already has a model-wide `cancelCompletions(modelId)` fallback for delegated models, because the SDK can't abort a delegated stream by request id alone. That fallback cancels *every* completion on the model — safe under the old single-flight assumption, but a correctness hazard under concurrency (cancelling one request could kill a concurrent sibling on the same delegated model). `cancelActive()` now only uses the model-wide fallback when the request being cancelled is the *only* active one on that model; otherwise it cancels by request-id only and accepts that the remote generation may keep running on the provider until it finishes. This is an inherent limitation of a delegate that only exposes a model-wide remote cancel, not something concurrency itself needed to introduce the risk of — it's made explicit and safe rather than silently glossed over.
  - `isBusy()` now counts queued completions too (a queued call already captured the `modelId` it'll use once admitted).
  - Coalesces concurrent delegation-recovery attempts into one reload.
- **`models.config.ts`** — `AgentModelConfig.maxConcurrency`; `resolveEngineConfig()` merges `{ parallel: maxConcurrency }` into `engineConfig` when `> 1`. `low`: untouched. `medium`/`high`: `maxConcurrency: 2` each, independently configurable.
- **`agentService.ts`** — passes `maxConcurrency` into the session; `cancel(requestId)` forwards to `cancelActive(requestId)`.
- **`domain.ts`/`graph.ts`/`qvac-langgraph`** — threads `requestId` through LangGraph state down to `ChatQVAC`, mirroring the existing `sessionId` pattern (one new optional field, same mechanism) — this is what lets `cancel()` target the one specific concurrent completion an `invoke()` call is making.

## Testing

TDD throughout — every new behavior has a test that was watched failing before the implementation existed, run against this repo's own test suite: `ConcurrencyLimiter` (10 tests), `QvacChatSession` (new concurrency describe block: two genuinely concurrent completions via a controllable fake, a third queuing at the limit, independent cancellation of an active and a queued request, the delegated-model-wide-cancel-safety case specifically, isolated `onToken` streams, `isBusy()` across active+queued, coalesced delegation-recovery), `AgentService` (4 new end-to-end tests through the real graph/RAG stack: two concurrent invokes don't block each other, a third queues at the tier limit, cancelling one doesn't affect the other, two concurrent sessions keep independent KV-cache session ids).

Full suite: 45/48 backend test files green. The 3 failing files (`corpusContext.test.ts`, `fullCorpusContext.test.ts`, `resilientEmbeddingService.test.ts`'s one failing case) are **pre-existing and unrelated** — confirmed by stashing this branch's changes and re-running against unmodified `main`: identical failures (a literal broken import path, and an unrelated RAG-fallback bug). qvac-langgraph: 12/12.

## Mechanism validation against the pinned SDK version and real model weights

The underlying mechanism — `completion()` calls genuinely admitted concurrently when `parallel >= 2`, with independent KV-cache sessions and independent per-request cancellation — was validated against the actual `@qvac/sdk@0.18.2` this project pins, loaded with the real `medium`-tier model (`Qwen3.5-9B Q4_K_M`) and the same `engineConfig`/`maxConcurrency` this branch configures:

- The real llama.cpp addon's own startup log confirmed `parallel: '2'` reaching the engine exactly as configured.
- Two concurrent completions, distinct sessions: the SDK's own request-lifecycle log showed both admitted and running simultaneously on the same `modelId`; both resolved correctly end-to-end through RAG retrieval and tool-calling; multi-turn KV-cache reuse worked independently per session.
- Cancellation: two concurrent long-form completions, one cancelled mid-flight — the SDK's log confirmed only the cancelled one was admitted alongside the survivor before the cancel, and the survivor's own request never began until the cancelled one's `state=cancelled` was confirmed. No sibling disruption, no hang.
- A 3-request queue proof (limit 2): two admitted immediately, a third's SDK-level request never began until the first slot freed via cancellation — confirmed via the SDK's own `begin...running`/`end...cancelled` log sequence.

## ⚠️ Performance finding — read before raising `medium`/`high` concurrency, maybe before merging as-is

A controlled A/B (same prompt, same generation params, run completely alone vs. two concurrently) against the real `medium`-tier model showed:

| | Alone | Concurrent pair |
|---|---|---|
| Tokens/sec (per request) | 8.73 | 3.97 / 4.01 |
| `avgConcurrentSeq` | 1.0 | ~1.93–2.0 (genuine batching confirmed) |

- Per-request slowdown: **2.19x** — each request generates at less than half its solo speed when run concurrently.
- Aggregate throughput ratio: **0.91x** — the *sum* of both concurrent requests' throughput was *lower* than one request running alone. No net gain; a net loss.
- Estimated sequential wall-clock for 2 requests: ~289s. Actual concurrent wall-clock: ~317s — **worse than running them one after another.**

`avgConcurrentSeq≈2` confirms the engine genuinely batched both sequences — this isn't a dispatch bug, it's that the test hardware didn't have spare compute/memory-bandwidth to batch "for free." The test machine had a real discrete GPU (AMD Radeon RX 6600), but the *solo* throughput (8.73 tok/s) is itself low for a 9B Q4_K_M model on that class of card, suggesting the GPU may not have been fully engaged even without concurrency (backend/driver/virtualization specific to that test environment) — this is not confirmed to generalize to every real `medium`/`high` deployment, but it is not confirmed *not* to, either. `resourceTier.ts`'s own tier thresholds are RAM+CPU only, with no GPU/VRAM detection (an existing, separately-documented non-goal) — so a non-trivial fraction of real `medium`-tier machines could plausibly be in the same CPU-bound regime this result represents.

**This directly affects whether `maxConcurrency: 2` should ship as the default for `medium`/`high` today.** Recommendation: validate on real, representative target hardware (ideally including a confirmed-working GPU backend) before merging with concurrency enabled by default — or ship with `low`'s sequential behavior extended to `medium`/`high` (`maxConcurrency: 1`, i.e. the mechanism built but not yet turned on by default) until that validation exists. This is a deliberate decision left open here, not a silently-made one — see the PR description.

## Known limitations

- DHT/P2P provider-serving path: untouched. `@qvac/sdk`'s provider surface exposes no hook for this from application code in this version.
- `medium`/`high` concurrency limits (`2`) are unvalidated on representative hardware per the finding above — treat as provisional, not a benchmarked ceiling.
- The model-wide `cancelCompletions` fallback for delegated models, when a sibling completion is active on the same model, cannot be made fully request-specific with this SDK version's primitives — documented in `qvacChatSession.ts`, not hidden.
