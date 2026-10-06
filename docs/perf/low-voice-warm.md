# Profiler benchmark - low-voice-warm

- **Run:** 2026-10-06T07:06:47.348Z
- **Machine:** Apple M4, 10 cores, 16 GB RAM (darwin/arm64)
- **Hardware tier:** low · **chat model:** {"name":"QWEN3VL_2B_MULTIMODAL_Q4_K","quantization":"q4_k"}

## Startup (profiler export at readiness)

> **Not a startup snapshot.** The server was not restarted before this run, so this export still holds the previous run ([`kv-cache/low-kvcache-repeat`](kv-cache/low-kvcache-repeat.md)). Only the sections from *Client-side latency* down belong to this run.

| Operation | Count | Min | Avg | Max | Total |
|---|---|---|---|---|---|
| `completionStream` | 3 | 3.14 s | 3.15 s | 3.16 s | 9.45 s |
| `completionStream.modelExecutionTime` | 3 | 1.10 s | 1.11 s | 1.13 s | 3.34 s |
| `completionStream.server.handlerExecution` | 3 | 3.14 s | 3.15 s | 3.16 s | 9.45 s |
| `completionStream.server.totalServerTime` | 3 | 3.14 s | 3.15 s | 3.16 s | 9.45 s |
| `completionStream.streamDuration` | 3 | 486.7 ms | 499.1 ms | 512.9 ms | 1.50 s |
| `completionStream.totalClientTime` | 3 | 3.14 s | 3.15 s | 3.16 s | 9.46 s |
| `completionStream.ttfb` | 6 | 2.65 s | 2.65 s | 2.66 s | 15.90 s |

## Client-side latency, 1 questions via `POST /v1/chat/completions` (`stream: true`), seconds

| Metric | n | Min | p50 | p90 | Max | Mean |
|---|---|---|---|---|---|---|
| First visible token | 1 | 2.79 | 2.79 | 2.79 | 2.79 | 2.79 |
| Full answer | 1 | 3.24 | 3.24 | 3.24 | 3.24 | 3.24 |

| ID | First token (s) | Full (s) | Tools | Citations | Expected | Answer |
|---|---|---|---|---|---|---|
| 001 | 2.79 | 3.24 | - | 3 | 72 | Based on the provided context, Atlas Manufacturing's health score as of the Q2 close is **72**. |

## Voice turn via `POST /v1/chat/voice-completions` (`stream: true`)

- Audio in: `p1-response-time.wav` · transcript: "What is the first response time for a priority one ticket?"
- First audio sentence: **3.87 s** · full turn: **4.41 s** · 2 audio chunks

## Steady state (profiler export after the requests above)

| Operation | Count | Min | Avg | Max | Total |
|---|---|---|---|---|---|
| `completionStream` | 2 | 3.19 s | 3.34 s | 3.48 s | 6.67 s |
| `completionStream.modelExecutionTime` | 2 | 1.06 s | 1.23 s | 1.41 s | 2.47 s |
| `completionStream.server.handlerExecution` | 2 | 3.19 s | 3.34 s | 3.48 s | 6.67 s |
| `completionStream.server.totalServerTime` | 2 | 3.19 s | 3.34 s | 3.48 s | 6.67 s |
| `completionStream.streamDuration` | 2 | 453.1 ms | 622.9 ms | 792.7 ms | 1.25 s |
| `completionStream.totalClientTime` | 2 | 3.19 s | 3.34 s | 3.48 s | 6.68 s |
| `completionStream.ttfb` | 4 | 2.69 s | 2.71 s | 2.74 s | 10.85 s |
| `textToSpeech` | 2 | 488.0 ms | 498.0 ms | 508.0 ms | 996.0 ms |
| `textToSpeech.audioDuration` | 2 | 6.55 s | 7.57 s | 8.59 s | 15.14 s |
| `textToSpeech.modelExecutionTime` | 2 | 488.0 ms | 498.0 ms | 508.0 ms | 996.0 ms |
| `textToSpeech.server.handlerExecution` | 2 | 488.0 ms | 498.0 ms | 508.0 ms | 996.0 ms |
| `textToSpeech.server.totalServerTime` | 2 | 488.0 ms | 498.0 ms | 508.0 ms | 996.0 ms |
| `textToSpeech.streamDuration` | 2 | 8.6 ms | 10.3 ms | 12.1 ms | 20.7 ms |
| `textToSpeech.totalClientTime` | 2 | 509.6 ms | 516.3 ms | 522.9 ms | 1.03 s |
| `textToSpeech.totalSamples` | 2 | 288962 samples | 333806 samples | 378650 samples | - |
| `textToSpeech.ttfb` | 4 | 482.0 ms | 497.7 ms | 510.6 ms | 1.99 s |
| `transcribe` | 1 | 275.0 ms | 275.0 ms | 275.0 ms | 275.0 ms |
| `transcribe.server.handlerExecution` | 1 | 275.0 ms | 275.0 ms | 275.0 ms | 275.0 ms |
| `transcribe.server.totalServerTime` | 1 | 275.0 ms | 275.0 ms | 275.0 ms | 275.0 ms |
| `transcribe.streamDuration` | 1 | 1.5 ms | 1.5 ms | 1.5 ms | 1.5 ms |
| `transcribe.totalClientTime` | 1 | 275.8 ms | 275.8 ms | 275.8 ms | 275.8 ms |
| `transcribe.ttfb` | 1 | 273.9 ms | 273.9 ms | 273.9 ms | 273.9 ms |

`<op>.ttfb` aggregates two different measurements under one key: the client-side RPC phase and the worker-side handler gauge of the same name (the SDK keys both `op.ttfb`). The per-request table below keeps them apart.

### Per request, worker side

| # | Operation | Handler total (s) | Handler ttfb (s) | Model execution (s) | Outside model execution (s) |
|---|---|---|---|---|---|
| 1 | `completionStream` | 3.19 | 2.74 | 1.06 | 2.13 |
| 2 | `transcribe` | 0.28 | - | - | - |
| 3 | `completionStream` | 3.48 | 2.69 | 1.41 | 2.08 |
| 4 | `textToSpeech` | 0.49 | 0.48 | 0.49 | 0.00 |
| 5 | `textToSpeech` | 0.51 | 0.50 | 0.51 | 0.00 |
