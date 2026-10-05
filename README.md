<p align="center">
  <img
    src="docs/assets/meridian-hero.svg"
    alt="MERIDIAN ASSISTANT — local inference, local RAG, local voice & vision, built by SpaceDev"
    width="900"
  />
</p>

<p align="center">
  <strong>Private company knowledge. Available anywhere. Without sending it anywhere.</strong>
</p>

<p align="center">
  <code>LOCAL INFERENCE</code>
  &nbsp;·&nbsp;
  <code>LOCAL RAG</code>
  &nbsp;·&nbsp;
  <code>LOCAL VECTOR STORE</code>
  &nbsp;·&nbsp;
  <code>NO CLOUD AI</code>
  &nbsp;·&nbsp;
  <code>OFFLINE READY</code>
</p>

<p align="center">
  <sub>QVAC / llama.cpp · BGE-M3 · LanceDB · cached local models</sub>
</p>

<p align="center">
  <sub>
    Not affiliated with or endorsed by Tether or the QVAC project.
    “QVAC” and “Meridian Components” are used only to describe this exercise and its integrations.
  </sub>
</p>

<br>

<hr>

<h2 align="center">What this is</h2>

<p align="center">
  Meridian Assistant is a <strong>local-first AI knowledge and inference layer</strong>
  for Meridian Components.
</p>

<p align="center">
  It answers sales, support, and field-engineering questions using Meridian's own
  documents and inventory while keeping inference, retrieval, embeddings, voice,
  and vision on hardware Meridian controls.
</p>

<p align="center">
  Built with
  <code>@qvac/sdk</code>
  · LangGraph
  · LanceDB
  · Express
  · React
</p>

<br>

<hr>

<h2 align="center">The problem</h2>

<p align="center">
  <img
    src="docs/assets/problem.svg"
    alt="Why the first cloud pilot failed — cost, margin, data, trust"
    width="900"
  />
</p>

<p align="center">
  Meridian's previous cloud AI pilot failed for architectural reasons:
  unpredictable cost, third-party data exposure, and insufficient trust in generated answers.
</p>

<p align="center">
  <strong>Meridian Assistant moves the answer path back onto Meridian-controlled hardware.</strong>
</p>

<br>

<hr>

<h2 align="center">What we built</h2>

<table>
  <tr>
    <td width="25%" align="center" valign="top">
      <strong>Backend</strong><br><br>
      <code>Express + QVAC</code><br><br>
      Local lifecycle, RAG, tools, voice and inference.
    </td>
    <td width="25%" align="center" valign="top">
      <strong>Frontend</strong><br><br>
      <code>React + Vite</code><br><br>
      Streaming chat, citations, voice, vision and engine status.
    </td>
    <td width="25%" align="center" valign="top">
      <strong>Knowledge</strong><br><br>
      <code>LanceDB + corpus/</code><br><br>
      Persisted local retrieval over Meridian documents.
    </td>
    <td width="25%" align="center" valign="top">
      <strong>Tools</strong><br><br>
      <code>stock-tool</code><br><br>
      Deterministic inventory through structured tool calls.
    </td>
  </tr>
</table>

<p align="center">
  <sub>No cloud model client exists in the production dependency path.</sub>
</p>

<br>

<hr>

<h2 align="center">Why this is different</h2>

<p align="center">
  <img
    src="docs/assets/why-different.svg"
    alt="Typical cloud assistant vs Meridian Assistant"
    width="900"
  />
</p>

<table>
  <tr>
    <td width="20%" align="center">
      <strong>Local-first</strong><br><br>
      Inference, embeddings and retrieval stay controlled.
    </td>
    <td width="20%" align="center">
      <strong>Grounded</strong><br><br>
      Citations come from retrieved corpus evidence.
    </td>
    <td width="20%" align="center">
      <strong>Adaptive</strong><br><br>
      Models change with available hardware.
    </td>
    <td width="20%" align="center">
      <strong>Resilient</strong><br><br>
      P2P delegation falls back locally.
    </td>
    <td width="20%" align="center">
      <strong>Compatible</strong><br><br>
      OpenAI-compatible API surface.
    </td>
  </tr>
</table>

<br>

<hr>

<h2 align="center">Key capabilities</h2>

<table>
  <tr>
    <td><strong>Chat</strong></td>
    <td><code>POST /v1/chat/completions</code></td>
    <td>Streaming, grounding and structured tools</td>
  </tr>
  <tr>
    <td><strong>Citations</strong></td>
    <td><code>citations: [{file, score}]</code></td>
    <td>Deterministically derived from retrieved evidence</td>
  </tr>
  <tr>
    <td><strong>Voice</strong></td>
    <td><code>/v1/chat/voice-completions</code></td>
    <td>Speech in, streamed speech out</td>
  </tr>
  <tr>
    <td><strong>Vision</strong></td>
    <td><code>image_url</code></td>
    <td>JPEG / PNG plus WebP transcoding</td>
  </tr>
  <tr>
    <td><strong>Stock</strong></td>
    <td><code>lookup_stock</code></td>
    <td>Deterministic inventory, never fabricated quantities</td>
  </tr>
  <tr>
    <td><strong>RAG</strong></td>
    <td><code>BGE-M3 + LanceDB</code></td>
    <td>Incremental content-hash-based ingestion</td>
  </tr>
  <tr>
    <td><strong>P2P</strong></td>
    <td>Public-key peer</td>
    <td>Delegation with automatic local fallback</td>
  </tr>
  <tr>
    <td><strong>Cancellation</strong></td>
    <td>Request-scoped</td>
    <td>One cancelled request does not disturb siblings</td>
  </tr>
</table>

<br>

<hr>

<h2 align="center">Proven, not mocked</h2>

<p align="center">
  <img
    src="docs/assets/metrics.svg"
    alt="Measured Meridian Assistant performance"
    width="900"
  />
</p>

<p align="center">
  Measurements come from reproducible project benchmarks — including results
  that caused features to be <strong>reverted</strong> when they did not improve performance.
</p>

<p align="center">
  <a href="docs/i4-native-addon-results.md">Native embedding benchmark</a>
  &nbsp;·&nbsp;
  <a href="docs/i2-simultaneous-completions-results.md">Continuous batching benchmark</a>
  &nbsp;·&nbsp;
  <a href="docs/bundle-size-report.md">Bundle report</a>
</p>

<br>

<hr>

<h2 align="center">Architecture</h2>

<p align="center">
  <img
    src="docs/assets/architecture.svg"
    alt="Meridian Assistant architecture"
    width="900"
  />
</p>

<table>
  <tr>
    <td><strong>Express routers</strong></td>
    <td>Parse and validate HTTP requests</td>
  </tr>
  <tr>
    <td><strong>AgentService / LangGraph</strong></td>
    <td>Retrieval, tools, inference and citation orchestration</td>
  </tr>
  <tr>
    <td><strong>ResilientEmbeddingService</strong></td>
    <td>Native C++ embeddings with automatic SDK fallback</td>
  </tr>
  <tr>
    <td><strong>LanceDB</strong></td>
    <td>Persisted local vector search</td>
  </tr>
  <tr>
    <td><strong>ModelManagementService</strong></td>
    <td>Discover → download → load → infer → unload → close</td>
  </tr>
  <tr>
    <td><strong>P2P provider / consumer</strong></td>
    <td>Optional delegated chat inference with health monitoring</td>
  </tr>
</table>

<br>

<hr>

<h2 align="center">How a request flows</h2>

<p align="center">
  <img
    src="docs/assets/request-flow.gif"
    alt="Request flow for a grounded chat completion"
    width="900"
  />
</p>

<p align="center">
  <strong>RAG runs once.</strong>
  The LLM can loop through structured tools multiple times while tokens stream to the client.
  Citations are selected after the graph completes.
</p>

<br>

<hr>

<h2 align="center">Engineering decisions</h2>

<p align="center">
  <img
    src="docs/assets/engineering-decisions.svg"
    alt="Engineering decisions overview"
    width="900"
  />
</p>

<table>
  <tr>
    <th align="left">Finding</th>
    <th align="left">Decision</th>
  </tr>
  <tr>
    <td>Native embeddings improved performance, but less than the first benchmark suggested</td>
    <td>Fixed the benchmark and shipped only the measured gain with SDK fallback</td>
  </tr>
  <tr>
    <td>Continuous batching regressed on medium hardware</td>
    <td>Medium stays sequential; concurrency is limited to high</td>
  </tr>
  <tr>
    <td>Default retrieval settings were insufficient</td>
    <td>Benchmarked model, chunk size and threshold against the real corpus</td>
  </tr>
  <tr>
    <td>P2P peers may disappear mid-session</td>
    <td>Heartbeat monitoring + automatic local fallback and recovery</td>
  </tr>
  <tr>
    <td>Two-image requests crash the current upstream vision worker</td>
    <td>Cap production requests at one image instead of hiding the limitation</td>
  </tr>
</table>

<p align="center">
  <a href="#technical-challenges--known-limitations">
    Technical details & known limitations ↓
  </a>
</p>

<br>

<hr>

<h2 align="center">Hardware-aware inference</h2>

<p align="center">
  <img
    src="docs/assets/hardware-tiers.svg"
    alt="One product, three hardware tiers"
    width="900"
  />
</p>

<p align="center">
  Hardware is detected once per process and mapped automatically to
  <code>low</code>, <code>medium</code>, or <code>high</code>.
</p>

<p align="center">
  <sub>
    Override with <code>QVAC_RESOURCE_TIER=low|medium|high</code>.
    The 8 GB low-tier target has not yet been benchmarked on that exact hardware class.
  </sub>
</p>

<br>

<hr>

<h2 align="center">Security</h2>

<p align="center">
  <img
    src="docs/assets/security-boundary.svg"
    alt="Meridian Assistant security boundary"
    width="900"
  />
</p>

<p align="center">
  <strong>No cloud AI provider exists in the production request path.</strong>
</p>

<p align="center">
  Corpus data, embeddings, retrieval, transcription and TTS remain local.
  Optional delegated chat inference can reach only a configured Meridian-controlled peer
  identified by public key.
</p>

<table>
  <tr>
    <td align="center"><strong>.lancedb/</strong><br><sub>local vector store</sub></td>
    <td align="center"><strong>.qvac-cache/</strong><br><sub>model weights</sub></td>
    <td align="center"><strong>.run/</strong><br><sub>process state</sub></td>
    <td align="center"><strong>.env</strong><br><sub>peer configuration</sub></td>
  </tr>
</table>

<p align="center">
  <sub>All are local and gitignored.</sub>
</p>

<br>

<hr>

<h2 align="center">Quick start</h2>

<pre><code>npm ci
npm run ingest --workspace=apps/backend
npm run dev:server
npm run dev:client</code></pre>

<p align="center">
  First run requires internet once to cache model weights.
  After that, inference can run without a cloud AI connection.
</p>

<p align="center">
  Full backend and P2P setup:
  <a href="apps/backend/README.md"><code>apps/backend/README.md</code></a>
</p>

<br>

<hr>

<h2 align="center">Judge this project in 60 seconds</h2>

<p align="center">
  <img
    src="docs/assets/judge-60-seconds.svg"
    alt="Judge Meridian Assistant in 60 seconds"
    width="900"
  />
</p>

<p align="center">
  <sub>This is the same execution path driven by <code>qvac-eval.json</code>.</sub>
</p>

<table>
  <tr>
    <td align="center"><strong>01</strong></td>
    <td><code>npm ci</code></td>
  </tr>
  <tr>
    <td align="center"><strong>02</strong></td>
    <td><code>npm run build:server</code></td>
  </tr>
  <tr>
    <td align="center"><strong>03</strong></td>
    <td><code>npm run models:fetch</code></td>
  </tr>
  <tr>
    <td align="center"><strong>04</strong></td>
    <td><code>npm run corpus:ingest</code></td>
  </tr>
  <tr>
    <td align="center"><strong>05</strong></td>
    <td><code>npm run serve</code></td>
  </tr>
  <tr>
    <td align="center"><strong>06</strong></td>
    <td>Wait for <code>GET /v1/models</code> → <code>200</code></td>
  </tr>
  <tr>
    <td align="center"><strong>07</strong></td>
    <td><strong>Disconnect outbound network</strong></td>
  </tr>
  <tr>
    <td align="center"><strong>08</strong></td>
    <td>Send a grounded completion</td>
  </tr>
  <tr>
    <td align="center"><strong>09</strong></td>
    <td>Verify <code>citations[]</code></td>
  </tr>
</table>

<pre><code>curl -X POST http://127.0.0.1:3001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"What was Q2 2026 total revenue?"}]}'</code></pre>

<p align="center">
  Verify the response against
  <code>corpus/reports/q2-2026-sales-performance-report.md</code>,
  then run <code>npm run serve:stop</code>.
</p>

<br>

<hr>

<details>
<summary><strong>Challenge requirements coverage</strong></summary>

<br>

<p>
  ✅ Implemented &nbsp;·&nbsp;
  🧪 Tested / demonstrated &nbsp;·&nbsp;
  ⚠️ Partial or documented limitation
</p>

<table>
  <tr>
    <th>Requirement</th>
    <th>Status</th>
    <th>Evidence</th>
  </tr>

  <tr>
    <td>[1.2] Model weights excluded from installer</td>
    <td align="center">✅</td>
    <td><code>docs/bundle-size-report.md</code></td>
  </tr>

  <tr>
    <td>[1.4] Cancel response in progress</td>
    <td align="center">✅ 🧪</td>
    <td><code>chat.router.ts</code> · frontend stop control</td>
  </tr>

  <tr>
    <td>[2.1] No invented stock data</td>
    <td align="center">✅ 🧪</td>
    <td><code>stock-tool</code></td>
  </tr>

  <tr>
    <td>[2.2 / 2.3] Persisted local vector store</td>
    <td align="center">✅</td>
    <td>LanceDB + direct <code>embed()</code>/<code>ragChunk()</code></td>
  </tr>

  <tr>
    <td>[2.4] Conversation UI</td>
    <td align="center">✅</td>
    <td><code>message-list.tsx</code></td>
  </tr>

  <tr>
    <td>[3.1] Structured tool-call loop</td>
    <td align="center">✅ 🧪</td>
    <td>Zod + LangGraph tool events</td>
  </tr>

  <tr>
    <td>[3.1.1] Corpus inventory tool</td>
    <td align="center">✅</td>
    <td><code>listDocumentsTool.ts</code></td>
  </tr>

  <tr>
    <td>[3.1.2] Stock-tool dataset</td>
    <td align="center">✅</td>
    <td><code>stock-tool/</code></td>
  </tr>

  <tr>
    <td>[5.1 / 5.1.1] Runtime visible in UI</td>
    <td align="center">✅</td>
    <td><code>engine-panel.tsx</code></td>
  </tr>

  <tr>
    <td>[5.2] Hardware-aware model selection</td>
    <td align="center">✅ 🧪</td>
    <td><code>resourceTier.ts</code> · <code>models.config.ts</code></td>
  </tr>

  <tr>
    <td>[6.1.2] Citations surfaced</td>
    <td align="center">✅</td>
    <td><code>citation-sources.tsx</code></td>
  </tr>

  <tr>
    <td>[6.1.3] Deterministic reruns</td>
    <td align="center">✅ 🧪</td>
    <td>temperature / seed + deterministic citation sort</td>
  </tr>

  <tr>
    <td>[6.1.4] Offline server start</td>
    <td align="center">✅</td>
    <td><code>models:fetch</code></td>
  </tr>

  <tr>
    <td>[6.2.1] Plugin-scoped SDK</td>
    <td align="center">✅</td>
    <td><code>qvac.config.mjs</code></td>
  </tr>

  <tr>
    <td>[6.2.2] Bundle report</td>
    <td align="center">✅ 🧪</td>
    <td><code>docs/bundle-size-report.md</code></td>
  </tr>

  <tr>
    <td>[6.3] Session KV-cache reuse</td>
    <td align="center">✅</td>
    <td><code>X-Meridian-Session</code></td>
  </tr>
</table>

<h4>Extra mile</h4>

<table>
  <tr>
    <th>Improvement</th>
    <th>Status</th>
  </tr>

  <tr>
    <td>Continuous batching</td>
    <td>⚠️ High tier only after measured regression on medium</td>
  </tr>

  <tr>
    <td>Native C++ embedding path</td>
    <td>✅ 🧪 Primary path with automatic SDK fallback</td>
  </tr>

  <tr>
    <td>LoRA fine-tuning</td>
    <td>⚠️ Attempted and documented as blocked upstream</td>
  </tr>

  <tr>
    <td>P2P resilience</td>
    <td>✅ 🧪 Heartbeat, fallback and recovery</td>
  </tr>

  <tr>
    <td>TurboQuant KV cache</td>
    <td>⚠️ Implemented but disabled pending validation</td>
  </tr>
</table>

</details>

<br>

<details>
<summary>
  <strong id="technical-challenges--known-limitations">
    Technical challenges & known limitations
  </strong>
</summary>

<br>

<table>
  <tr>
    <td valign="top"><strong>Benchmark correctness</strong></td>
    <td>
      The original native-embedding benchmark reported an unrealistic ~36× improvement.
      A blocking PowerShell RSS sampler was distorting the measurement.
      The benchmark was fixed before the result was used to justify the architecture.
    </td>
  </tr>

  <tr>
    <td valign="top"><strong>Continuous batching</strong></td>
    <td>
      QVAC's <code>batchCompletion()</code> schema did not preserve the required KV-cache behavior.
      Concurrent <code>completion()</code> calls were used instead.
      Medium-tier testing showed a regression, so that tier remains sequential.
    </td>
  </tr>

  <tr>
    <td valign="top"><strong>Vision</strong></td>
    <td>
      Two images in one message reproducibly crash the current upstream QVAC / llama.cpp worker.
      Production therefore limits messages to one image.
    </td>
  </tr>

  <tr>
    <td valign="top"><strong>LoRA</strong></td>
    <td>
      Fine-tuning was attempted against the production model and a supported control model.
      The production architecture is rejected and the control path crashes before producing an adapter.
      No successful adapter is claimed.
    </td>
  </tr>

  <tr>
    <td valign="top"><strong>P2P recovery</strong></td>
    <td>
      Heartbeats and reconciliation were added around the SDK so a disappearing provider
      causes automatic local recovery rather than a stalled session.
    </td>
  </tr>
</table>

</details>

<br>

<hr>

<h2 align="center">Team</h2>

<p align="center">
  Built by <strong>SpaceDev</strong><br>
  for the QVAC Solutions Service Provider Qualification Exercise
  <br>
  <sub>Meridian Components scenario</sub>
</p>
