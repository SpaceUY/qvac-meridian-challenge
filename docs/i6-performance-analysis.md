# I.6 — Performance instrumentation: profiler export and analysis

**Date:** 2026-10-06
**Branch:** `feat/i6-profiler-instrumentation`

**Requirement:** *"Export profiler metrics (e.g. `profiler.exportJSON`) and include a short performance analysis."*

## TL;DR

- **Export:** start the server with `QVAC_PROFILER=summary|verbose` and read `GET /api/debug/profiler`
  (`profiler.exportJSON()`, each metric with its unit). `npm run perf:profile` produces every run below;
  their raw exports are in [`docs/perf/`](perf/). Off by default: the graded `npm run serve` path is
  unchanged.
- **Where the time goes:** the LLM is effectively the whole request. Everything outside `@qvac/sdk` —
  native-embedding retrieval, LanceDB, LangGraph, HTTP — is **≤ 0.3 s** per question, and the
  Node ↔ Bare RPC hop adds 2–8 ms (median).
- **`low` (Qwen3-VL 2B) answers in 3.4 s, `medium` (Qwen3.5 9B) in 41.9 s** (median, full answer), but
  `medium` answered 12/13 questions correctly against 7/13 for `low`.
- **The biggest actionable cost is the automatic KV cache:** on single-turn questions it adds **~15 s per
  answer on `medium`** (45 s with it, 30 s without: turning it off saves 33 %) and nothing measurable on
  `low`. Measured with a controlled on/off experiment; **not changed in this branch** — see
  [Recommendations](#recommendations).
- **KV-cache files are only partly bounded:** the SDK caps the automatic ones at 4 GB, but caches stored
  under a session key (`X-Meridian-Session`) are never evicted by the SDK.
- **`medium` hides ~16 s of reasoning** (median) between the model's first token and the first token the
  user sees.

## How to get the export

| `QVAC_PROFILER` | What is recorded |
|---|---|
| unset / `off` | Nothing; `/api/debug/profiler` is not mounted (404). |
| `summary` | count/min/max/avg/total per SDK operation. |
| `verbose` | `summary` + the last 1000 raw events (per request) + the worker-side breakdown (`server.handlerExecution`, `server.totalServerTime`). |

```bash
QVAC_PROFILER=verbose npm run dev:server                                         # terminal 1
npm run perf:profile -- --label medium --audio "$PWD/docs/perf/p1-response-time.wav"   # terminal 2, from the repo root
```

`perf:profile` exports the profiler at readiness (startup), resets it, sends 13 questions from
[`meridian-benchmark-215-en.md`](meridian-benchmark-215-en.md) (one per category plus one image) through
`POST /v1/chat/completions` with `stream: true`, optionally one voice turn, and exports again. The voice
turn's input, [`perf/p1-response-time.wav`](perf/p1-response-time.wav) (2.8 s, 16 kHz mono), is committed.
Restart the server between runs: the "startup" export is only a startup snapshot on a fresh server, and
the report flags it when it is not.
Usage and endpoint details:
[`apps/backend/README.md` § Performance profiling](../apps/backend/README.md#performance-profiling-req-i6).

## Measurement conditions

MacBook Air M4 (fanless), 10 cores, 16 GB RAM, Metal GPU; `@qvac/sdk` 0.18.2; one request at a time; the
server's resolved tier is `medium`, `low` forced with `QVAC_RESOURCE_TIER=low`. Each scenario is one run of
13 questions (KV experiments: 3–5 repeats) — enough for the order of magnitude and the breakdown, not for
tight percentiles. A second, earlier `medium` run ([`perf/medium-default.md`](perf/medium-default.md))
landed at a 43.8 s median, within 5 % of the one below. Correctness graded by hand against the bank's
expected answers.

## Results

### End-to-end latency, 13 questions (client side, seconds)

| Tier | Chat model | First visible token p50 / p90 / max | Full answer p50 / p90 / max | Correct |
|---|---|---|---|---|
| `low` | Qwen3-VL 2B Q4_K | **2.9** / 3.9 / 4.3 | **3.4** / 5.3 / 5.8 | 7/13 (+2 partial) |
| `medium` | Qwen3.5 9B Q4_K_M | **34.8** / 47.4 / 61.3 | **41.9** / 62.3 / 69.0 | 12/13 |

Raw: [`perf/low.md`](perf/low.md), [`perf/medium.md`](perf/medium.md) (+ `.json`).
`medium`'s one miss (101, "last quarter") is the model's, not retrieval's: the Q2 report it needed is in
its citations, yet it answered with Q1's figures — in both `medium` runs. `low`, given the same two
documents, answered correctly. `low`'s misses are reasoning errors (wrong percentage, a day count off by
one, an invented "did not sign", a `lookup_stock` call on a discount question).

### Where one answer's time goes (median per question)

Pairing each question with the profiler's per-request events (`verbose`):

| Stage | `low` | `medium` | Source |
|---|---|---|---|
| Outside the SDK: retrieval (native BGE-M3 + LanceDB), LangGraph, HTTP | 0.0 s | 0.1 s | client total − `completionStream.totalClientTime` |
| Node ↔ worker RPC + serialization | 2 ms | 8 ms (max 28 ms) | `totalClientTime` − `server.totalServerTime` |
| SDK handler, **outside** the generation loop | 1.9 s | 12.7 s | handler `ms` − `modelExecutionTime` |
| Generation loop (`modelExecutionTime`) | 1.4 s | 34.9 s | handler gauge |
| — of which hidden reasoning before the first visible token | ~0 | ~15.9 s | first visible token − worker `ttfb` |

So the request is the model: the RAG pipeline that I.4 made native is no longer measurable at this scale.
The RPC row subtracts timings taken in two processes; one `medium` request even comes out at −67 ms, so
read it as an order of magnitude, not a precise figure.

### The KV-cache cost (controlled experiment)

The "outside the generation loop" row was the largest unexplained number, so the same question (015)
was repeated with the chat model's KV cache on (today's config) and off:

| | `medium` KV on | `medium` KV off | `low` KV on | `low` KV off |
|---|---|---|---|---|
| Full answer, 3 repeats (s) | 45.0 / 45.6 / 45.3 | **29.4 / 30.2 / 31.2** | 3.2 / 3.2 / 3.2 | 3.2 / 3.0 / 3.0 |
| Handler outside the generation loop (s) | 14.1 / 14.1 / 15.0 | **0.0 / 0.0 / 0.0** | 2.0 / 2.0 / 2.0 | 0.0 / 0.0 / 0.0 |
| Generation loop (s) | 30.9 / 31.5 / 30.3 | 29.1 / 30.1 / 31.1 | 1.1 / 1.1 / 1.1 | 3.1 / 2.9 / 3.0 |

Raw: [`perf/kv-cache/`](perf/kv-cache/). To reproduce the "off" columns, set `kvCacheEnabled: false` on
the tier in `LLM_MODELS_BY_TIER` (`apps/backend/src/config/models.config.ts`), restart the server and run
`npm run perf:profile -- --ids 015,015,015`; it was a temporary local change, reverted. Reading it:

- On `medium` the generation loop costs the same with and without the cache, so the ~15 s is pure
  overhead: **turning the cache off saves ~15 s (−33 %) per single-turn answer.** On `low`, the cache
  moves ~2 s out of the loop and adds them back outside it — no gain.
- Repeating the identical question did not help: its cache file was rewritten in place each time
  (`~/.qvac/kv-cache/<key>/<model>/<hash>.bin`), so this is not a cache miss.
- A likely reason it can't pay off here: the retrieved chunks travel in the **system** prompt — the part
  the SDK primes and persists as the reusable prefix — and they differ per question. The SDK does not
  break the handler time down further, so the exact split (priming vs. persisting) is not isolated.
- **Not measured:** multi-turn sessions with `X-Meridian-Session` (the frontend's path), where the cache
  is designed to reuse the previous turn.

### What the KV cache leaves on disk

Every cached request writes a `.bin` of ~100 MB (median 96 MB, 47–388 MB measured) to
`~/.qvac/kv-cache` — outside the project's `.qvac-cache/`, since `cacheDirectory` in `qvac.config.mjs`
only relocates model weights. What happens to it depends on the key:

| Key | Who removes it | Bound |
|---|---|---|
| Automatic (`kvCache: true`: requests without `X-Meridian-Session`, e.g. the eval harness) | The SDK itself: after writing an automatic cache it sweeps (at most every 5 min), evicting entries idle for 24 h, then the oldest | 4 GB on desktop, 512 MB on mobile (`kv-cache-session.js`, SDK 0.18.2); 5.6 GB after these runs, since it is enforced per sweep, not per write |
| Session (`X-Meridian-Session`) | Only the app: the frontend calls `DELETE /api/chat/sessions/:id/cache` on "New chat" | None — a closed tab, or an API client that never calls it, leaves the cache behind |

On the dev machine, `~/.qvac/kv-cache` held 21 GB after these runs, 15.7 GB of it under session-style
keys (mostly debugging sessions).

### Startup and voice

| | `low` | `medium` |
|---|---|---|
| Chat `loadModel` (warm OS file cache) | 1.4 s (1.2 s checksum) | 5.9 s (4.2 s checksum) |
| Chat `loadModel`, cold (first load of the session, OS file cache empty)¹ | — | 14.2 s (10.3 s initialization) |
| STT `transcribe`, 2.8 s of audio | 0.27 s (Whisper tiny) | 2.7 s (Whisper small) |
| TTS `textToSpeech` per sentence | 0.4–0.5 s (Supertonic 2) | 1.1–1.3 s (Supertonic 3) |
| Voice turn, first audio / full | **3.9 s / 4.4 s** | 42.6 s / 45.3 s |

¹ From the earlier `medium` run, [`perf/medium-default.md`](perf/medium-default.md) — same benchmark, an
earlier build of this branch (its export labels `audioDuration`'s unit `unknown`). `low`'s voice turn is
from [`perf/low-voice-warm.md`](perf/low-voice-warm.md); every other number is from
[`perf/low.md`](perf/low.md) and [`perf/medium.md`](perf/medium.md).

- Checksum validation is 70–88 % of a warm chat-model load: a one-time startup cost, paid before `/health`
  turns ready.
- TTS runs well ahead of real time (real-time factor 0.05–0.25; 0.38 on the first, cold call of the
  earlier `medium` run). STT is ~10× faster than real time on `low`, but only ~1× on `medium`: the turn
  waits about as long as the user spoke. Either way, a voice turn's latency is the chat completion's.
- When a model is not cached, the profiler shows it: forcing `low` on this `medium` machine (whose
  `models:fetch` only provisioned `medium`) made the first voice turn download Whisper tiny + Supertonic 2
  (`loadModel.downloadTime` 26.5 s + 62.1 s, 175 MB) — first audio at 92.7 s. On a real `low` machine
  `models:fetch` provisions them; the warm number above is the representative one.

Three raw reports were taken without restarting the server ([`low-voice-warm`](perf/low-voice-warm.md),
[`low-kvcache-repeat`](perf/kv-cache/low-kvcache-repeat.md),
[`medium-kvcache-repeat`](perf/kv-cache/medium-kvcache-repeat.md)): their "Startup" section holds the
previous run and is flagged as such. Nothing on this page reads from those sections.

## Recommendations

None are applied in this branch — they change product behavior and need a decision.

| Option | Measured effect | Trade-off / open question |
|---|---|---|
| Disable the automatic KV cache for requests without `X-Meridian-Session` (API, eval harness) | `medium`: −15 s (−33 %) per answer; no more automatic-key `.bin` writes | Measure multi-turn sessions first; the frontend path may still benefit. |
| Evict session caches the app no longer uses (e.g. idle TTL, or a sweep at server start) | Bounds the one part of `~/.qvac/kv-cache` the SDK leaves unbounded | An evicted session rebuilds its cache on its next turn. |
| `reasoning_budget: 0` on `medium` | Could remove up to the ~16 s hidden before the first visible token — **not measured** | Less reasoning on multi-step questions. |
| Prefer `low` where latency matters | 12× faster (3.4 s vs 41.9 s) | 7/13 vs 12/13 correct on this set. |

## What the profiler cannot see (`@qvac/sdk` 0.18.2)

- **Native embeddings** (I.4) run in their own `bare` process outside the SDK, so they never appear as
  `embed`; their cost is in [`i4-native-addon-results.md`](i4-native-addon-results.md) and is bounded
  above by the ≤ 0.3 s "outside the SDK" row.
- **`tokensPerSecond` / `timeToFirstToken` for completions** are declared by the SDK but did not reach
  the client's aggregates in any run, so token throughput is not reported here.
- **`<op>.ttfb` mixes two measurements:** the client-side RPC phase and the worker-side handler gauge
  share one aggregate key (hence `count` = 2× the requests). The per-request events keep them apart, and
  the benchmark report uses those.
- **`audioDuration`'s unit is not documented:** verified as ms for TTS (= `totalSamples` / 44.1 kHz) and
  labeled `unknown` for transcription in the export.
