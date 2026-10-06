# Profiler benchmark - medium-kvcache-repeat

- **Run:** 2026-10-06T07:00:21.310Z
- **Machine:** Apple M4, 10 cores, 16 GB RAM (darwin/arm64)
- **Hardware tier:** medium · **chat model:** {"name":"QWEN3_5_9B_MULTIMODAL_Q4_K_M","quantization":"q4_k_m"}

## Startup (profiler export at readiness)

> **Not a startup snapshot.** The server was not restarted before this run, so this export still holds the previous run ([`medium`](../medium.md)). Only the sections from *Client-side latency* down belong to this run.

| Operation | Count | Min | Avg | Max | Total |
|---|---|---|---|---|---|
| `completionStream` | 14 | 24.23 s | 45.58 s | 68.89 s | 638.16 s |
| `completionStream.modelExecutionTime` | 14 | 16.74 s | 33.97 s | 58.16 s | 475.57 s |
| `completionStream.server.handlerExecution` | 14 | 24.23 s | 45.58 s | 68.89 s | 638.16 s |
| `completionStream.server.totalServerTime` | 14 | 24.23 s | 45.59 s | 68.89 s | 638.20 s |
| `completionStream.streamDuration` | 14 | 13.11 s | 28.66 s | 53.32 s | 401.27 s |
| `completionStream.totalClientTime` | 14 | 24.23 s | 45.59 s | 68.89 s | 638.25 s |
| `completionStream.ttfb` | 28 | 11.11 s | 16.92 s | 20.13 s | 473.62 s |
| `loadModel` | 2 | 550.0 ms | 609.0 ms | 668.0 ms | 1.22 s |
| `loadModel.checksumValidationTime` | 2 | 142.0 ms | 252.0 ms | 362.0 ms | 504.0 ms |
| `loadModel.clientOverhead` | 2 | 2.1 ms | 2.8 ms | 3.5 ms | 5.7 ms |
| `loadModel.modelInitializationTime` | 2 | 303.0 ms | 354.0 ms | 405.0 ms | 708.0 ms |
| `loadModel.server.handlerExecution` | 2 | 550.0 ms | 609.5 ms | 669.0 ms | 1.22 s |
| `loadModel.server.totalServerTime` | 2 | 560.0 ms | 616.5 ms | 673.0 ms | 1.23 s |
| `loadModel.serverWait` | 2 | 560.8 ms | 617.4 ms | 674.0 ms | 1.23 s |
| `loadModel.totalClientTime` | 2 | 563.5 ms | 619.3 ms | 675.1 ms | 1.24 s |
| `loadModel.totalLoadTime` | 2 | 550.0 ms | 609.0 ms | 668.0 ms | 1.22 s |
| `textToSpeech` | 2 | 1.14 s | 1.20 s | 1.25 s | 2.39 s |
| `textToSpeech.audioDuration` | 2 | 5.01 s | 6.93 s | 8.85 s | 13.86 s |
| `textToSpeech.modelExecutionTime` | 2 | 1.14 s | 1.20 s | 1.25 s | 2.39 s |
| `textToSpeech.server.handlerExecution` | 2 | 1.14 s | 1.20 s | 1.26 s | 2.40 s |
| `textToSpeech.server.totalServerTime` | 2 | 1.14 s | 1.20 s | 1.26 s | 2.40 s |
| `textToSpeech.streamDuration` | 2 | 30.3 ms | 49.2 ms | 68.0 ms | 98.3 ms |
| `textToSpeech.totalClientTime` | 2 | 1.18 s | 1.27 s | 1.36 s | 2.54 s |
| `textToSpeech.totalSamples` | 2 | 221062 samples | 305613.50 samples | 390165 samples | - |
| `textToSpeech.ttfb` | 4 | 1.12 s | 1.20 s | 1.29 s | 4.79 s |
| `transcribe` | 1 | 2.74 s | 2.74 s | 2.74 s | 2.74 s |
| `transcribe.server.handlerExecution` | 1 | 2.74 s | 2.74 s | 2.74 s | 2.74 s |
| `transcribe.server.totalServerTime` | 1 | 2.74 s | 2.74 s | 2.74 s | 2.74 s |
| `transcribe.streamDuration` | 1 | 2.8 ms | 2.8 ms | 2.8 ms | 2.8 ms |
| `transcribe.totalClientTime` | 1 | 2.75 s | 2.75 s | 2.75 s | 2.75 s |
| `transcribe.ttfb` | 1 | 2.74 s | 2.74 s | 2.74 s | 2.74 s |

## Client-side latency, 3 questions via `POST /v1/chat/completions` (`stream: true`), seconds

| Metric | n | Min | p50 | p90 | Max | Mean |
|---|---|---|---|---|---|---|
| First visible token | 3 | 36.73 | 37.79 | 38.11 | 38.11 | 37.54 |
| Full answer | 3 | 45.04 | 45.29 | 45.61 | 45.61 | 45.31 |

| ID | First token (s) | Full (s) | Tools | Citations | Expected | Answer |
|---|---|---|---|---|---|---|
| 015 | 37.79 | 45.04 | - | 3 | Maya Chen, VP Enterprise Sales | Based on the email announcement for the Atlas Manufacturing deal closure: **Sender:** Maya Chen **Title:** VP Enterprise Sales (Meridian Co… |
| 015 | 36.73 | 45.61 | - | 3 | Maya Chen, VP Enterprise Sales | Based on the email announcement for the Atlas Manufacturing deal closure: **Sender:** Maya Chen **Title:** VP Enterprise Sales (Meridian Co… |
| 015 | 38.11 | 45.29 | - | 3 | Maya Chen, VP Enterprise Sales | Based on the email announcement for the Atlas Manufacturing deal closure: **Sender:** Maya Chen **Title:** VP Enterprise Sales (Meridian Co… |

## Steady state (profiler export after the requests above)

| Operation | Count | Min | Avg | Max | Total |
|---|---|---|---|---|---|
| `completionStream` | 3 | 44.97 s | 45.24 s | 45.53 s | 135.72 s |
| `completionStream.modelExecutionTime` | 3 | 30.25 s | 30.87 s | 31.46 s | 92.61 s |
| `completionStream.server.handlerExecution` | 3 | 44.97 s | 45.24 s | 45.53 s | 135.72 s |
| `completionStream.server.totalServerTime` | 3 | 44.97 s | 45.24 s | 45.53 s | 135.72 s |
| `completionStream.streamDuration` | 3 | 25.51 s | 26.05 s | 26.53 s | 78.15 s |
| `completionStream.totalClientTime` | 3 | 44.98 s | 45.25 s | 45.55 s | 135.76 s |
| `completionStream.ttfb` | 6 | 18.85 s | 19.19 s | 19.72 s | 115.15 s |

`<op>.ttfb` aggregates two different measurements under one key: the client-side RPC phase and the worker-side handler gauge of the same name (the SDK keys both `op.ttfb`). The per-request table below keeps them apart.

### Per request, worker side

| # | Operation | Handler total (s) | Handler ttfb (s) | Model execution (s) | Outside model execution (s) |
|---|---|---|---|---|---|
| 1 | `completionStream` | 44.97 | 18.85 | 30.89 | 14.08 |
| 2 | `completionStream` | 45.53 | 19.00 | 31.46 | 14.06 |
| 3 | `completionStream` | 45.22 | 19.71 | 30.25 | 14.97 |
