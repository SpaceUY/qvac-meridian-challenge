# Profiler benchmark - low

- **Run:** 2026-10-06T07:03:56.461Z
- **Machine:** Apple M4, 10 cores, 16 GB RAM (darwin/arm64)
- **Hardware tier:** low · **chat model:** {"name":"QWEN3VL_2B_MULTIMODAL_Q4_K","quantization":"q4_k"}

## Startup (profiler export at readiness)

| Operation | Count | Min | Avg | Max | Total |
|---|---|---|---|---|---|
| `loadModel` | 1 | 1.40 s | 1.40 s | 1.40 s | 1.40 s |
| `loadModel.checksumValidationTime` | 1 | 1.22 s | 1.22 s | 1.22 s | 1.22 s |
| `loadModel.clientOverhead` | 1 | 2.8 ms | 2.8 ms | 2.8 ms | 2.8 ms |
| `loadModel.modelInitializationTime` | 1 | 590.0 ms | 590.0 ms | 590.0 ms | 590.0 ms |
| `loadModel.server.handlerExecution` | 1 | 1.40 s | 1.40 s | 1.40 s | 1.40 s |
| `loadModel.server.totalServerTime` | 1 | 1.40 s | 1.40 s | 1.40 s | 1.40 s |
| `loadModel.serverWait` | 1 | 1.40 s | 1.40 s | 1.40 s | 1.40 s |
| `loadModel.totalClientTime` | 1 | 1.41 s | 1.41 s | 1.41 s | 1.41 s |
| `loadModel.totalLoadTime` | 1 | 1.40 s | 1.40 s | 1.40 s | 1.40 s |
| `rpc.connection` | 1 | 892.9 ms | 892.9 ms | 892.9 ms | 892.9 ms |

## Client-side latency, 13 questions via `POST /v1/chat/completions` (`stream: true`), seconds

| Metric | n | Min | p50 | p90 | Max | Mean |
|---|---|---|---|---|---|---|
| First visible token | 13 | 1.98 | 2.87 | 3.87 | 4.33 | 2.87 |
| Full answer | 13 | 2.40 | 3.35 | 5.30 | 5.79 | 3.75 |

| ID | First token (s) | Full (s) | Tools | Citations | Expected | Answer |
|---|---|---|---|---|---|---|
| 001 | 2.87 | 3.35 | - | 3 | 72 | Based on the provided context, Atlas Manufacturing's health score as of the Q2 close is **72**. |
| 012 | 1.98 | 2.40 | - | 1 | $18,000 per site/year | The list price of the Predictive maintenance module is $18,000 per site per year. |
| 033 | 2.11 | 3.24 | - | 2 | NovaPack EU, $140,000 | The logo lost in Q2 due to competitor displacement on price is **NovaPack EU**, with an ARR of $140,000. The reason was that AxisMotion, a … |
| 060 | 2.63 | 3.25 | - | 3 | $6,800 per unit | According to the H2 FY2026 list pricing update, the list price of the ControLink Gateway rev B is **$6,800** per unit. |
| 101 | 2.48 | 2.87 | - | 2 | Q2 2026: $18.4M revenue, NPS 47 (Q2 is the latest closed/reported quarter) | The last quarter's revenue was $18.4M, and the NPS was 47. |
| 121 | 3.87 | 5.79 | lookup_stock | 0 | No — 8%+5%=13% exceeds the AE's 10% ceiling (the 8% counts toward it, not addit… | The available documents do not contain enough information to determine if an AE can approve a multi-site customer with the 8% package plus … |
| 132 | 3.04 | 3.79 | - | 3 | $5.4M → $6.2M = +$0.8M / +14.8% | EMEA revenue increased from $5.4M in Q1 to $6.2M in Q2, which is a growth of **$0.8M** or **+11%**. |
| 154 | 3.08 | 3.95 | - | 3 | Not in the corpus — the newest document (Jul 3) still has the decision pending,… | Based on the information provided, Helix Robotics did not sign the deal. The status of the deal remains **3 – Technical validation**, and i… |
| 165 | 2.57 | 5.30 | - | 3 | No — 0.7% is the overall field defect rate; ServoDrive X4 is 0.4%; ControLink G… | The Meridian report states a 0.7% field defect rate for the Q2 period, which is consistent with the **ServoDrive X4** product line (0.4% de… |
| 183 | 2.25 | 3.22 | - | 2 | 15 Aug → 30 Sep ≈ 46 days apart | The interim onboarding checkpoint deadline is **15 August 2026**, and the final target deadline is **30 September 2026**. This means the tw… |
| 193 | 3.08 | 3.54 | - | 3 | 4 hours | El SLA de primera respuesta para un ticket P1 es 4 horas, según el documento de política y la comunicación interna. |
| 208 | 2.96 | 3.32 | - | 2 | $18.4M — the challenge's own example question; the citation must be the Q2 repo… | The total revenue for Q2 2026 was $18.4M. |
| 204 (image) | 4.33 | 4.72 | - | 0 | Blue hard hat + high-visibility vest, read from the image | The worker is wearing a blue hard hat, a yellow high-visibility vest, and a tie. |

## Voice turn via `POST /v1/chat/voice-completions` (`stream: true`)

> **Cold voice turn.** This machine had only provisioned the `medium` models, so this turn downloaded Whisper tiny + Supertonic 2 first (`loadModel.downloadTime` below). The warm number is in [`low-voice-warm`](low-voice-warm.md).

- Audio in: `p1-response-time.wav` · transcript: "What is the first response time for a priority one ticket?"
- First audio sentence: **92.72 s** · full turn: **93.19 s** · 2 audio chunks

## Steady state (profiler export after the requests above)

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

`<op>.ttfb` aggregates two different measurements under one key: the client-side RPC phase and the worker-side handler gauge of the same name (the SDK keys both `op.ttfb`). The per-request table below keeps them apart.

### Per request, worker side

| # | Operation | Handler total (s) | Handler ttfb (s) | Model execution (s) | Outside model execution (s) |
|---|---|---|---|---|---|
| 1 | `completionStream` | 3.24 | 2.76 | 1.09 | 2.15 |
| 2 | `completionStream` | 2.37 | 1.95 | 1.00 | 1.37 |
| 3 | `completionStream` | 3.21 | 2.08 | 1.72 | 1.50 |
| 4 | `completionStream` | 3.22 | 2.60 | 1.25 | 1.97 |
| 5 | `completionStream` | 2.84 | 2.45 | 1.00 | 1.84 |
| 6 | `completionStream` | 1.97 | 1.51 | 1.03 | 0.94 |
| 7 | `completionStream` | 3.77 | 1.86 | 2.80 | 0.97 |
| 8 | `completionStream` | 3.76 | 3.02 | 1.41 | 2.35 |
| 9 | `completionStream` | 3.92 | 3.06 | 1.54 | 2.38 |
| 10 | `completionStream` | 5.27 | 2.54 | 3.40 | 1.87 |
| 11 | `completionStream` | 3.19 | 2.23 | 1.61 | 1.58 |
| 12 | `completionStream` | 3.51 | 3.05 | 1.15 | 2.36 |
| 13 | `completionStream` | 3.30 | 2.94 | 1.03 | 2.27 |
| 14 | `completionStream` | 4.64 | 4.25 | 4.07 | 0.57 |
| 15 | `loadModel` | 26.53 | - | - | - |
| 16 | `transcribe` | 0.27 | - | - | - |
| 17 | `completionStream` | 3.62 | 2.83 | 1.48 | 2.15 |
| 18 | `loadModel` | 62.28 | - | - | - |
| 19 | `textToSpeech` | 0.38 | 0.37 | 0.38 | 0.00 |
| 20 | `textToSpeech` | 0.45 | 0.44 | 0.45 | 0.00 |
