# Profiler benchmark - medium-default

- **Run:** 2026-10-06T06:36:40.911Z
- **Machine:** Apple M4, 10 cores, 16 GB RAM (darwin/arm64)
- **Hardware tier:** medium · **chat model:** {"name":"QWEN3_5_9B_MULTIMODAL_Q4_K_M","quantization":"q4_k_m"}

## Startup (profiler export at readiness)

| Operation | Count | Min | Avg | Max | Total |
|---|---|---|---|---|---|
| `loadModel` | 1 | 14.24 s | 14.24 s | 14.24 s | 14.24 s |
| `loadModel.checksumValidationTime` | 1 | 4.89 s | 4.89 s | 4.89 s | 4.89 s |
| `loadModel.modelInitializationTime` | 1 | 10.26 s | 10.26 s | 10.26 s | 10.26 s |
| `loadModel.serverWait` | 1 | 14.29 s | 14.29 s | 14.29 s | 14.29 s |
| `loadModel.totalClientTime` | 1 | 14.31 s | 14.31 s | 14.31 s | 14.31 s |
| `loadModel.totalLoadTime` | 1 | 14.24 s | 14.24 s | 14.24 s | 14.24 s |
| `rpc.connection` | 1 | 2.25 s | 2.25 s | 2.25 s | 2.25 s |

## Client-side latency, 13 questions via `POST /v1/chat/completions` (`stream: true`), seconds

| Metric | n | Min | p50 | p90 | Max | Mean |
|---|---|---|---|---|---|---|
| First visible token | 13 | 18.32 | 34.45 | 47.21 | 62.13 | 35.15 |
| Full answer | 13 | 22.51 | 43.79 | 61.03 | 70.27 | 44.25 |

| ID | First token (s) | Full (s) | Tools | Citations | Expected | Answer |
|---|---|---|---|---|---|---|
| 001 | 25.47 | 27.94 | - | 3 | 72 | Atlas Manufacturing's health score as of the Q2 close (as of 2026-06-30) is **72**. |
| 012 | 18.32 | 22.51 | - | 1 | $18,000 per site/year | Based on the FY2026 Product Catalog excerpt, the **Predictive maintenance module** has a list price of **$18,000 per site / year**. It is s… |
| 033 | 25.59 | 33.31 | - | 2 | NovaPack EU, $140,000 | Based on the Q2 2026 churn alert and competitive displacement notes, **NovaPack EU** was the logo lost due to competitor displacement on pr… |
| 060 | 23.92 | 27.38 | - | 3 | $6,800 per unit | According to the H2 FY2026 list pricing update (emails/013-list-pricing-update.md), the list price of ControLink Gateway rev B is **$6,800 … |
| 101 | 34.45 | 43.70 | - | 2 | Q2 2026: $18.4M revenue, NPS 47 (Q2 is the latest closed/reported quarter) | Based on the available documents: **Last Quarter (Q1 2026):** - **Revenue:** $16.2M - **NPS:** 41 This was against a target of $15.5M reven… |
| 121 | 39.95 | 59.94 | - | 1 | No — 8%+5%=13% exceeds the AE's 10% ceiling (the 8% counts toward it, not addit… | No, an AE cannot approve that alone. Based on the discount authority policy: \| Role \| Max discount off list \| \| --- \| --- \| \| Accoun… |
| 132 | 37.80 | 51.32 | - | 3 | $5.4M → $6.2M = +$0.8M / +14.8% | Based on the available documents: **EMEA Revenue Growth Q1 → Q2:** \| Metric \| Value \| \|--------\|-------\| \| Q1 2026 revenue \| $5.4M … |
| 154 | 47.21 | 61.03 | - | 3 | Not in the corpus — the newest document (Jul 3) still has the decision pending,… | Based on the available documents, there is no information indicating whether Helix Robotics ultimately signed the deal. As of 26 June 2026 … |
| 165 | 34.35 | 47.74 | - | 3 | No — 0.7% is the overall field defect rate; ServoDrive X4 is 0.4%; ControLink G… | No, the **0.7% field defect rate** is an overall company metric (units returned / units shipped), not specific to either product line. Here… |
| 183 | 62.13 | 70.27 | - | 2 | 15 Aug → 30 Sep ≈ 46 days apart | Based on the onboarding remediation email: - **Interim checkpoint deadline:** 15 August 2026 (≤ 38 days average) - **Final target deadline:… |
| 193 | 38.56 | 43.79 | - | 3 | 4 hours | El SLA de primera respuesta para un ticket P1 es **4 horas**. Esto aplica a clientes empresariales con contratos en ControLink Suite y Serv… |
| 208 | 36.89 | 44.56 | - | 2 | $18.4M — the challenge's own example question; the citation must be the Q2 repo… | Based on the Q2 2026 Sales Performance Report (FIN-SAL-2026-Q2-014), **total recognized revenue for Q2 2026 was $18.4M**. This represented … |
| 204 (image) | 32.27 | 41.81 | - | 0 | Blue hard hat + high-visibility vest, read from the image | Based on this image, the worker is wearing the following Personal Protective Equipment (PPE): 1. **Blue hard hat** - A protective helmet fo… |

## Voice turn via `POST /v1/chat/voice-completions` (`stream: true`)

- Audio in: `p1-sla.wav` · transcript: "What is the first response law for a P1 ticket?"
- First audio sentence: **70.88 s** · full turn: **75.90 s** · 2 audio chunks

## Steady state (profiler export after the requests above)

| Operation | Count | Min | Avg | Max | Total |
|---|---|---|---|---|---|
| `completionStream` | 15 | 17.58 s | 42.84 s | 70.20 s | 642.53 s |
| `completionStream.modelExecutionTime` | 15 | 13.71 s | 33.13 s | 60.08 s | 496.89 s |
| `completionStream.streamDuration` | 15 | 9.08 s | 26.69 s | 55.76 s | 400.29 s |
| `completionStream.totalClientTime` | 15 | 17.62 s | 42.87 s | 70.22 s | 643.03 s |
| `completionStream.ttfb` | 30 | 8.51 s | 16.16 s | 29.83 s | 484.78 s |
| `loadModel` | 2 | 671.0 ms | 672.0 ms | 673.0 ms | 1.34 s |
| `loadModel.checksumValidationTime` | 2 | 210.0 ms | 285.5 ms | 361.0 ms | 571.0 ms |
| `loadModel.modelInitializationTime` | 2 | 302.0 ms | 380.5 ms | 459.0 ms | 761.0 ms |
| `loadModel.serverWait` | 2 | 687.1 ms | 691.9 ms | 696.7 ms | 1.38 s |
| `loadModel.totalClientTime` | 2 | 691.8 ms | 694.8 ms | 697.9 ms | 1.39 s |
| `loadModel.totalLoadTime` | 2 | 671.0 ms | 672.0 ms | 673.0 ms | 1.34 s |
| `textToSpeech` | 2 | 2.30 s | 2.60 s | 2.90 s | 5.20 s |
| `textToSpeech.audioDuration` | 2 | 7731.86 | 11278.80 | 14825.74 | - |
| `textToSpeech.modelExecutionTime` | 2 | 2.30 s | 2.60 s | 2.90 s | 5.20 s |
| `textToSpeech.streamDuration` | 2 | 256.4 ms | 349.0 ms | 441.5 ms | 698.0 ms |
| `textToSpeech.totalClientTime` | 2 | 2.31 s | 2.83 s | 3.36 s | 5.67 s |
| `textToSpeech.totalSamples` | 2 | 340975 samples | 497395 samples | 653815 samples | - |
| `textToSpeech.ttfb` | 4 | 1.99 s | 2.44 s | 2.92 s | 9.77 s |
| `transcribe` | 1 | 2.37 s | 2.37 s | 2.37 s | 2.37 s |
| `transcribe.streamDuration` | 1 | 1.2 ms | 1.2 ms | 1.2 ms | 1.2 ms |
| `transcribe.totalClientTime` | 1 | 2.38 s | 2.38 s | 2.38 s | 2.38 s |
| `transcribe.ttfb` | 1 | 2.38 s | 2.38 s | 2.38 s | 2.38 s |
