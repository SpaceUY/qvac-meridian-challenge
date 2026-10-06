# Profiler benchmark - low-kvcache-repeat

- **Run:** 2026-10-06T07:06:18.800Z
- **Machine:** Apple M4, 10 cores, 16 GB RAM (darwin/arm64)
- **Hardware tier:** low · **chat model:** {"name":"QWEN3VL_2B_MULTIMODAL_Q4_K","quantization":"q4_k"}

## Startup (profiler export at readiness)

> **Not a startup snapshot.** The server was not restarted before this run, so this export still holds the previous run ([`low`](../low.md)). Only the sections from *Client-side latency* down belong to this run.

| Operation | Count | Min | Avg | Max | Total |
|---|---|---|---|---|---|
| `completionStream` | 15 | 1.97 s | 3.46 s | 5.27 s | 51.84 s |
| `completionStream.modelExecutionTime` | 15 | 1.00 s | 1.71 s | 4.07 s | 25.58 s |
| `completionStream.server.handlerExecution` | 15 | 1.97 s | 3.46 s | 5.27 s | 51.84 s |
| `completionStream.server.totalServerTime` | 15 | 1.97 s | 3.46 s | 5.27 s | 51.85 s |
| `completionStream.streamDuration` | 15 | 355.9 ms | 847.7 ms | 2.73 s | 12.72 s |
| `completionStream.totalClientTime` | 15 | 1.98 s | 3.46 s | 5.27 s | 51.91 s |
| `completionStream.ttfb` | 30 | 1.51 s | 2.61 s | 4.25 s | 78.27 s |
| `loadModel` | 2 | 26.53 s | 44.41 s | 62.28 s | 88.82 s |
| `loadModel.checksumValidationTime` | 2 | 41.0 ms | 68.5 ms | 96.0 ms | 137.0 ms |
| `loadModel.clientOverhead` | 2 | 0.6 ms | 0.9 ms | 1.1 ms | 1.7 ms |
| `loadModel.downloadSpeedBps` | 2 | 1645654.41 bytes/s | 1884993.82 bytes/s | 2124333.24 bytes/s | - |
| `loadModel.downloadTime` | 2 | 26.46 s | 44.30 s | 62.14 s | 88.60 s |
| `loadModel.modelInitializationTime` | 2 | 77.0 ms | 109.0 ms | 141.0 ms | 218.0 ms |
| `loadModel.server.handlerExecution` | 2 | 26.54 s | 44.41 s | 62.28 s | 88.82 s |
| `loadModel.server.totalServerTime` | 2 | 26.54 s | 44.41 s | 62.29 s | 88.82 s |
| `loadModel.serverWait` | 2 | 26.54 s | 44.41 s | 62.29 s | 88.82 s |
| `loadModel.totalBytesDownloaded` | 2 | 43537433 bytes | 87772812.50 bytes | 132008192 bytes | - |
| `loadModel.totalClientTime` | 2 | 26.54 s | 44.41 s | 62.29 s | 88.82 s |
| `loadModel.totalLoadTime` | 2 | 26.53 s | 44.41 s | 62.28 s | 88.82 s |
| `textToSpeech` | 2 | 379.0 ms | 415.0 ms | 451.0 ms | 830.0 ms |
| `textToSpeech.audioDuration` | 2 | 6.55 s | 7.57 s | 8.59 s | 15.14 s |
| `textToSpeech.modelExecutionTime` | 2 | 377.0 ms | 414.0 ms | 451.0 ms | 828.0 ms |
| `textToSpeech.server.handlerExecution` | 2 | 379.0 ms | 415.0 ms | 451.0 ms | 830.0 ms |
| `textToSpeech.server.totalServerTime` | 2 | 381.0 ms | 416.0 ms | 451.0 ms | 832.0 ms |
| `textToSpeech.streamDuration` | 2 | 9.5 ms | 11.5 ms | 13.5 ms | 23.0 ms |
| `textToSpeech.totalClientTime` | 2 | 397.1 ms | 432.2 ms | 467.3 ms | 864.4 ms |
| `textToSpeech.totalSamples` | 2 | 288962 samples | 333806 samples | 378650 samples | - |
| `textToSpeech.ttfb` | 4 | 366.0 ms | 411.8 ms | 453.4 ms | 1.65 s |
| `transcribe` | 1 | 272.0 ms | 272.0 ms | 272.0 ms | 272.0 ms |
| `transcribe.server.handlerExecution` | 1 | 272.0 ms | 272.0 ms | 272.0 ms | 272.0 ms |
| `transcribe.server.totalServerTime` | 1 | 273.0 ms | 273.0 ms | 273.0 ms | 273.0 ms |
| `transcribe.streamDuration` | 1 | 1.1 ms | 1.1 ms | 1.1 ms | 1.1 ms |
| `transcribe.totalClientTime` | 1 | 278.6 ms | 278.6 ms | 278.6 ms | 278.6 ms |
| `transcribe.ttfb` | 1 | 275.6 ms | 275.6 ms | 275.6 ms | 275.6 ms |

## Client-side latency, 3 questions via `POST /v1/chat/completions` (`stream: true`), seconds

| Metric | n | Min | p50 | p90 | Max | Mean |
|---|---|---|---|---|---|---|
| First visible token | 3 | 2.68 | 2.68 | 2.69 | 2.69 | 2.68 |
| Full answer | 3 | 3.16 | 3.18 | 3.20 | 3.20 | 3.18 |

| ID | First token (s) | Full (s) | Tools | Citations | Expected | Answer |
|---|---|---|---|---|---|---|
| 015 | 2.69 | 3.20 | - | 3 | Maya Chen, VP Enterprise Sales | The email announcing the Atlas Manufacturing deal closed was sent by Maya Chen, who is the VP Enterprise Sales at Meridian Components Inc. |
| 015 | 2.68 | 3.16 | - | 3 | Maya Chen, VP Enterprise Sales | The email announcing the Atlas Manufacturing deal closed was sent by Maya Chen, who is the VP Enterprise Sales at Meridian Components Inc. |
| 015 | 2.68 | 3.18 | - | 3 | Maya Chen, VP Enterprise Sales | The email announcing the Atlas Manufacturing deal closed was sent by Maya Chen, who is the VP Enterprise Sales at Meridian Components Inc. |

## Steady state (profiler export after the requests above)

| Operation | Count | Min | Avg | Max | Total |
|---|---|---|---|---|---|
| `completionStream` | 3 | 3.14 s | 3.15 s | 3.16 s | 9.45 s |
| `completionStream.modelExecutionTime` | 3 | 1.10 s | 1.11 s | 1.13 s | 3.34 s |
| `completionStream.server.handlerExecution` | 3 | 3.14 s | 3.15 s | 3.16 s | 9.45 s |
| `completionStream.server.totalServerTime` | 3 | 3.14 s | 3.15 s | 3.16 s | 9.45 s |
| `completionStream.streamDuration` | 3 | 486.7 ms | 499.1 ms | 512.9 ms | 1.50 s |
| `completionStream.totalClientTime` | 3 | 3.14 s | 3.15 s | 3.16 s | 9.46 s |
| `completionStream.ttfb` | 6 | 2.65 s | 2.65 s | 2.66 s | 15.90 s |

`<op>.ttfb` aggregates two different measurements under one key: the client-side RPC phase and the worker-side handler gauge of the same name (the SDK keys both `op.ttfb`). The per-request table below keeps them apart.

### Per request, worker side

| # | Operation | Handler total (s) | Handler ttfb (s) | Model execution (s) | Outside model execution (s) |
|---|---|---|---|---|---|
| 1 | `completionStream` | 3.16 | 2.65 | 1.13 | 2.03 |
| 2 | `completionStream` | 3.14 | 2.65 | 1.10 | 2.04 |
| 3 | `completionStream` | 3.15 | 2.66 | 1.12 | 2.04 |
