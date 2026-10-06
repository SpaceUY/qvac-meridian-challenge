# Profiler benchmark - medium

- **Run:** 2026-10-06T06:49:36.444Z
- **Machine:** Apple M4, 10 cores, 16 GB RAM (darwin/arm64)
- **Hardware tier:** medium · **chat model:** {"name":"QWEN3_5_9B_MULTIMODAL_Q4_K_M","quantization":"q4_k_m"}

## Startup (profiler export at readiness)

| Operation | Count | Min | Avg | Max | Total |
|---|---|---|---|---|---|
| `loadModel` | 1 | 5.87 s | 5.87 s | 5.87 s | 5.87 s |
| `loadModel.checksumValidationTime` | 1 | 4.15 s | 4.15 s | 4.15 s | 4.15 s |
| `loadModel.clientOverhead` | 1 | 8.7 ms | 8.7 ms | 8.7 ms | 8.7 ms |
| `loadModel.modelInitializationTime` | 1 | 2.44 s | 2.44 s | 2.44 s | 2.44 s |
| `loadModel.server.handlerExecution` | 1 | 5.87 s | 5.87 s | 5.87 s | 5.87 s |
| `loadModel.server.totalServerTime` | 1 | 5.88 s | 5.88 s | 5.88 s | 5.88 s |
| `loadModel.serverWait` | 1 | 5.88 s | 5.88 s | 5.88 s | 5.88 s |
| `loadModel.totalClientTime` | 1 | 5.89 s | 5.89 s | 5.89 s | 5.89 s |
| `loadModel.totalLoadTime` | 1 | 5.87 s | 5.87 s | 5.87 s | 5.87 s |
| `rpc.connection` | 1 | 875.8 ms | 875.8 ms | 875.8 ms | 875.8 ms |

## Client-side latency, 13 questions via `POST /v1/chat/completions` (`stream: true`), seconds

| Metric | n | Min | p50 | p90 | Max | Mean |
|---|---|---|---|---|---|---|
| First visible token | 13 | 19.80 | 34.84 | 47.44 | 61.28 | 36.88 |
| Full answer | 13 | 24.28 | 41.94 | 62.30 | 68.96 | 46.07 |

| ID | First token (s) | Full (s) | Tools | Citations | Expected | Answer |
|---|---|---|---|---|---|---|
| 001 | 26.02 | 28.59 | - | 3 | 72 | Atlas Manufacturing's health score as of the Q2 close (as of 2026-06-30) is **72**. |
| 012 | 19.80 | 24.28 | - | 1 | $18,000 per site/year | Based on the FY2026 Product Catalog excerpt, the **Predictive maintenance module** has a list price of **$18,000 per site / year**. It is s… |
| 033 | 27.50 | 36.20 | - | 2 | NovaPack EU, $140,000 | Based on the Q2 2026 churn alert and competitive displacement notes, **NovaPack EU** was the logo lost due to competitor displacement on pr… |
| 060 | 29.46 | 34.50 | - | 3 | $6,800 per unit | According to the H2 FY2026 list pricing update (emails/013-list-pricing-update.md), the list price of ControLink Gateway rev B is **$6,800 … |
| 101 | 47.44 | 57.85 | - | 2 | Q2 2026: $18.4M revenue, NPS 47 (Q2 is the latest closed/reported quarter) | Based on the available documents: **Last Quarter (Q1 2026):** - **Revenue:** $16.2M - **NPS:** 41 This was against a target of $15.5M reven… |
| 121 | 44.47 | 62.30 | - | 1 | No — 8%+5%=13% exceeds the AE's 10% ceiling (the 8% counts toward it, not addit… | No, an AE cannot approve that alone. Based on the discount authority policy: \| Role \| Max discount off list \| \| --- \| --- \| \| Accoun… |
| 132 | 39.11 | 51.37 | - | 3 | $5.4M → $6.2M = +$0.8M / +14.8% | Based on the available documents: **EMEA Revenue Growth Q1 → Q2:** \| Metric \| Value \| \|--------\|-------\| \| Q1 2026 revenue \| $5.4M … |
| 154 | 46.72 | 62.02 | - | 3 | Not in the corpus — the newest document (Jul 3) still has the decision pending,… | Based on the available documents, there is no information indicating whether Helix Robotics ultimately signed the deal. As of 26 June 2026 … |
| 165 | 37.21 | 51.90 | - | 3 | No — 0.7% is the overall field defect rate; ServoDrive X4 is 0.4%; ControLink G… | No, the **0.7% field defect rate** is an overall company metric (units returned / units shipped), not specific to either product line. Here… |
| 183 | 61.28 | 68.96 | - | 2 | 15 Aug → 30 Sep ≈ 46 days apart | Based on the onboarding remediation email: - **Interim checkpoint deadline:** 15 August 2026 (≤ 38 days average) - **Final target deadline:… |
| 193 | 34.84 | 39.61 | - | 3 | 4 hours | El SLA de primera respuesta para un ticket P1 es **4 horas**. Esto aplica a clientes empresariales con contratos en ControLink Suite y Serv… |
| 208 | 34.35 | 41.94 | - | 2 | $18.4M — the challenge's own example question; the citation must be the Q2 repo… | Based on the Q2 2026 Sales Performance Report (FIN-SAL-2026-Q2-014), **total recognized revenue for Q2 2026 was $18.4M**. This represented … |
| 204 (image) | 31.26 | 39.32 | - | 0 | Blue hard hat + high-visibility vest, read from the image | Based on this image, the worker is wearing the following Personal Protective Equipment (PPE): 1. **Blue hard hat** - A protective helmet fo… |

## Voice turn via `POST /v1/chat/voice-completions` (`stream: true`)

- Audio in: `p1-response-time.wav` · transcript: "What is the first response time for a priority one ticket?"
- First audio sentence: **42.65 s** · full turn: **45.28 s** · 2 audio chunks

## Steady state (profiler export after the requests above)

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

`<op>.ttfb` aggregates two different measurements under one key: the client-side RPC phase and the worker-side handler gauge of the same name (the SDK keys both `op.ttfb`). The per-request table below keeps them apart.

### Per request, worker side

| # | Operation | Handler total (s) | Handler ttfb (s) | Model execution (s) | Outside model execution (s) |
|---|---|---|---|---|---|
| 1 | `completionStream` | 28.28 | 13.82 | 17.96 | 10.32 |
| 2 | `completionStream` | 24.23 | 11.11 | 16.74 | 7.48 |
| 3 | `completionStream` | 36.14 | 12.32 | 27.58 | 8.56 |
| 4 | `completionStream` | 34.44 | 17.51 | 21.71 | 12.73 |
| 5 | `completionStream` | 57.80 | 19.48 | 43.57 | 14.23 |
| 6 | `completionStream` | 62.23 | 13.04 | 54.89 | 7.34 |
| 7 | `completionStream` | 51.30 | 20.12 | 35.99 | 15.31 |
| 8 | `completionStream` | 61.95 | 19.93 | 46.75 | 15.20 |
| 9 | `completionStream` | 51.82 | 17.80 | 38.97 | 12.86 |
| 10 | `completionStream` | 68.89 | 15.56 | 58.16 | 10.73 |
| 11 | `completionStream` | 39.55 | 19.46 | 24.73 | 14.82 |
| 12 | `completionStream` | 41.94 | 18.46 | 27.85 | 14.09 |
| 13 | `completionStream` | 39.19 | 19.07 | 34.89 | 4.30 |
| 14 | `loadModel` | 0.67 | - | - | - |
| 15 | `transcribe` | 2.74 | - | - | - |
| 16 | `loadModel` | 0.55 | - | - | - |
| 17 | `textToSpeech` | 1.25 | 1.23 | 1.25 | 0.00 |
| 18 | `completionStream` | 40.41 | 19.06 | 25.79 | 14.62 |
| 19 | `textToSpeech` | 1.14 | 1.12 | 1.14 | 0.00 |
