# Profiler benchmark - medium-kvcache-off

- **Run:** 2026-10-06T07:17:35.634Z
- **Machine:** Apple M4, 10 cores, 16 GB RAM (darwin/arm64)
- **Hardware tier:** medium · **chat model:** {"name":"QWEN3_5_9B_MULTIMODAL_Q4_K_M","quantization":"q4_k_m"}

## Startup (profiler export at readiness)

| Operation | Count | Min | Avg | Max | Total |
|---|---|---|---|---|---|
| `loadModel` | 1 | 8.51 s | 8.51 s | 8.51 s | 8.51 s |
| `loadModel.checksumValidationTime` | 1 | 4.30 s | 4.30 s | 4.30 s | 4.30 s |
| `loadModel.clientOverhead` | 1 | 62.7 ms | 62.7 ms | 62.7 ms | 62.7 ms |
| `loadModel.modelInitializationTime` | 1 | 4.94 s | 4.94 s | 4.94 s | 4.94 s |
| `loadModel.server.handlerExecution` | 1 | 8.52 s | 8.52 s | 8.52 s | 8.52 s |
| `loadModel.server.totalServerTime` | 1 | 8.54 s | 8.54 s | 8.54 s | 8.54 s |
| `loadModel.serverWait` | 1 | 8.57 s | 8.57 s | 8.57 s | 8.57 s |
| `loadModel.totalClientTime` | 1 | 8.60 s | 8.60 s | 8.60 s | 8.60 s |
| `loadModel.totalLoadTime` | 1 | 8.51 s | 8.51 s | 8.51 s | 8.51 s |
| `rpc.connection` | 1 | 733.6 ms | 733.6 ms | 733.6 ms | 733.6 ms |

## Client-side latency, 3 questions via `POST /v1/chat/completions` (`stream: true`), seconds

| Metric | n | Min | p50 | p90 | Max | Mean |
|---|---|---|---|---|---|---|
| First visible token | 3 | 25.75 | 26.47 | 27.41 | 27.41 | 26.54 |
| Full answer | 3 | 29.38 | 30.15 | 31.20 | 31.20 | 30.25 |

| ID | First token (s) | Full (s) | Tools | Citations | Expected | Answer |
|---|---|---|---|---|---|---|
| 015 | 25.75 | 29.38 | - | 3 | Maya Chen, VP Enterprise Sales | Based on the email document (emails/001-atlas-deal-closed.md), **Maya Chen** sent the announcement about the Atlas Manufacturing deal being… |
| 015 | 26.47 | 30.15 | - | 3 | Maya Chen, VP Enterprise Sales | Based on the email document (emails/001-atlas-deal-closed.md), **Maya Chen** sent the announcement about the Atlas Manufacturing deal being… |
| 015 | 27.41 | 31.20 | - | 3 | Maya Chen, VP Enterprise Sales | Based on the email document (emails/001-atlas-deal-closed.md), **Maya Chen** sent the announcement about the Atlas Manufacturing deal being… |

## Steady state (profiler export after the requests above)

| Operation | Count | Min | Avg | Max | Total |
|---|---|---|---|---|---|
| `completionStream` | 3 | 29.10 s | 30.11 s | 31.14 s | 90.33 s |
| `completionStream.modelExecutionTime` | 3 | 29.09 s | 30.11 s | 31.14 s | 90.32 s |
| `completionStream.server.handlerExecution` | 3 | 29.10 s | 30.11 s | 31.14 s | 90.33 s |
| `completionStream.server.totalServerTime` | 3 | 29.11 s | 30.11 s | 31.14 s | 90.34 s |
| `completionStream.streamDuration` | 3 | 16.49 s | 16.66 s | 16.89 s | 49.98 s |
| `completionStream.totalClientTime` | 3 | 29.15 s | 30.13 s | 31.15 s | 90.40 s |
| `completionStream.ttfb` | 6 | 12.62 s | 13.46 s | 14.26 s | 80.75 s |

`<op>.ttfb` aggregates two different measurements under one key: the client-side RPC phase and the worker-side handler gauge of the same name (the SDK keys both `op.ttfb`). The per-request table below keeps them apart.

### Per request, worker side

| # | Operation | Handler total (s) | Handler ttfb (s) | Model execution (s) | Outside model execution (s) |
|---|---|---|---|---|---|
| 1 | `completionStream` | 29.10 | 12.62 | 29.09 | 0.01 |
| 2 | `completionStream` | 30.08 | 13.49 | 30.08 | 0.00 |
| 3 | `completionStream` | 31.14 | 14.25 | 31.14 | 0.00 |
