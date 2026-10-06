# Profiler benchmark - low-kvcache-off

- **Run:** 2026-10-06T07:16:34.499Z
- **Machine:** Apple M4, 10 cores, 16 GB RAM (darwin/arm64)
- **Hardware tier:** low · **chat model:** {"name":"QWEN3VL_2B_MULTIMODAL_Q4_K","quantization":"q4_k"}

## Startup (profiler export at readiness)

| Operation | Count | Min | Avg | Max | Total |
|---|---|---|---|---|---|
| `loadModel` | 1 | 1.32 s | 1.32 s | 1.32 s | 1.32 s |
| `loadModel.checksumValidationTime` | 1 | 1.02 s | 1.02 s | 1.02 s | 1.02 s |
| `loadModel.clientOverhead` | 1 | 3.0 ms | 3.0 ms | 3.0 ms | 3.0 ms |
| `loadModel.modelInitializationTime` | 1 | 632.0 ms | 632.0 ms | 632.0 ms | 632.0 ms |
| `loadModel.server.handlerExecution` | 1 | 1.32 s | 1.32 s | 1.32 s | 1.32 s |
| `loadModel.server.totalServerTime` | 1 | 1.33 s | 1.33 s | 1.33 s | 1.33 s |
| `loadModel.serverWait` | 1 | 1.33 s | 1.33 s | 1.33 s | 1.33 s |
| `loadModel.totalClientTime` | 1 | 1.33 s | 1.33 s | 1.33 s | 1.33 s |
| `loadModel.totalLoadTime` | 1 | 1.32 s | 1.32 s | 1.32 s | 1.32 s |
| `rpc.connection` | 1 | 778.7 ms | 778.7 ms | 778.7 ms | 778.7 ms |

## Client-side latency, 5 questions via `POST /v1/chat/completions` (`stream: true`), seconds

| Metric | n | Min | p50 | p90 | Max | Mean |
|---|---|---|---|---|---|---|
| First visible token | 5 | 2.53 | 2.58 | 2.84 | 2.84 | 2.64 |
| Full answer | 5 | 2.82 | 2.97 | 3.24 | 3.24 | 3.00 |

| ID | First token (s) | Full (s) | Tools | Citations | Expected | Answer |
|---|---|---|---|---|---|---|
| 015 | 2.84 | 3.24 | - | 3 | Maya Chen, VP Enterprise Sales | The email announcing the Atlas Manufacturing deal closed was sent by Maya Chen, who is the VP Enterprise Sales at Meridian Components Inc. |
| 015 | 2.57 | 2.96 | - | 3 | Maya Chen, VP Enterprise Sales | The email announcing the Atlas Manufacturing deal closed was sent by Maya Chen, who is the VP Enterprise Sales at Meridian Components Inc. |
| 015 | 2.58 | 2.97 | - | 3 | Maya Chen, VP Enterprise Sales | The email announcing the Atlas Manufacturing deal closed was sent by Maya Chen, who is the VP Enterprise Sales at Meridian Components Inc. |
| 001 | 2.67 | 3.01 | - | 3 | 72 | Based on the provided document, Atlas Manufacturing's health score as of the Q2 close is **72**. |
| 208 | 2.53 | 2.82 | - | 2 | $18.4M — the challenge's own example question; the citation must be the Q2 repo… | The total revenue for Q2 2026 was $18.4M. |

## Steady state (profiler export after the requests above)

| Operation | Count | Min | Avg | Max | Total |
|---|---|---|---|---|---|
| `completionStream` | 5 | 2.80 s | 2.96 s | 3.13 s | 14.81 s |
| `completionStream.modelExecutionTime` | 5 | 2.80 s | 2.96 s | 3.13 s | 14.81 s |
| `completionStream.server.handlerExecution` | 5 | 2.80 s | 2.96 s | 3.13 s | 14.81 s |
| `completionStream.server.totalServerTime` | 5 | 2.80 s | 2.96 s | 3.14 s | 14.82 s |
| `completionStream.streamDuration` | 5 | 289.8 ms | 363.4 ms | 394.3 ms | 1.82 s |
| `completionStream.totalClientTime` | 5 | 2.80 s | 2.96 s | 3.14 s | 14.82 s |
| `completionStream.ttfb` | 10 | 2.51 s | 2.60 s | 2.74 s | 25.99 s |

`<op>.ttfb` aggregates two different measurements under one key: the client-side RPC phase and the worker-side handler gauge of the same name (the SDK keys both `op.ttfb`). The per-request table below keeps them apart.

### Per request, worker side

| # | Operation | Handler total (s) | Handler ttfb (s) | Model execution (s) | Outside model execution (s) |
|---|---|---|---|---|---|
| 1 | `completionStream` | 3.13 | 2.74 | 3.13 | 0.00 |
| 2 | `completionStream` | 2.94 | 2.55 | 2.94 | 0.00 |
| 3 | `completionStream` | 2.95 | 2.56 | 2.95 | 0.00 |
| 4 | `completionStream` | 2.99 | 2.64 | 2.99 | 0.00 |
| 5 | `completionStream` | 2.80 | 2.51 | 2.80 | 0.00 |
