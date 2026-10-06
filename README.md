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

<h2>What this is</h2>

<p>
  Meridian Assistant is a <strong>local-first AI knowledge and inference layer</strong>
  for Meridian Components. It answers sales, support, and field-engineering
  questions grounded in Meridian's own documents and inventory.
</p>

<p>
  Inference, retrieval, embeddings, voice, and vision run on hardware Meridian
  controls. The product exposes an OpenAI-compatible API and does not depend on
  a hosted AI provider in the request path.
</p>

<p>
  <strong>Built with:</strong>
  <code>@qvac/sdk</code>
  · LangGraph
  · LanceDB
  · Express
  · React
</p>

<h2>The problem</h2>

<p align="center">
  <img
    src="docs/assets/problem.svg"
    alt="Why the first cloud pilot failed"
    width="900"
  />
</p>

<p>
  Meridian's previous cloud AI pilot failed for architectural reasons:
  unpredictable cost, third-party data exposure, and insufficient trust in
  generated answers.
</p>

<blockquote>
  Meridian Assistant moves the answer path back onto Meridian-controlled hardware.
</blockquote>

<h2>What we built</h2>

<table>
  <tr>
    <td width="25%" valign="top">
      <strong>Backend</strong><br><br>
      <code>Express + QVAC</code><br><br>
      Local lifecycle, RAG, tools, voice, and inference.
    </td>
    <td width="25%" valign="top">
      <strong>Frontend</strong><br><br>
      <code>React + Vite</code><br><br>
      Streaming chat, citations, voice, vision, and engine status.
    </td>
    <td width="25%" valign="top">
      <strong>Knowledge</strong><br><br>
      <code>LanceDB + corpus/</code><br><br>
      Persisted local retrieval over Meridian documents.
    </td>
    <td width="25%" valign="top">
      <strong>Tools</strong><br><br>
      <code>stock-tool</code><br><br>
      Deterministic inventory through structured tool calls.
    </td>
  </tr>
</table>

<p>
  No outbound call to a cloud model provider exists in the production dependency path.
</p>

<h2>Our contribution back to QVAC</h2>

<p align="center">
  <img
    src="docs/assets/qvac-langgraph.svg"
    alt="@space-uy/qvac-langgraph — QVAC as a first-class LangGraph chat model"
    width="900"
  />
</p>

<p>
  <a href="https://www.langchain.com/langgraph"><strong>LangGraph</strong></a> by
  <a href="https://www.langchain.com/">LangChain</a> has become a widely adopted
  orchestration framework for building AI agents and complex workflows.
</p>

<p>
  We built and published
  <a href="https://github.com/SpaceUY/qvac-langgraph"><strong><code>@space-uy/qvac-langgraph</code></strong></a>,
  a reusable adapter that bridges LangGraph with <strong>QVAC</strong>.
  It makes QVAC behave like a native LangChain chat model, supporting
  <code>invoke()</code>, <code>stream()</code>, and <code>bindTools()</code>.
</p>

<blockquote>
  <strong>We did not just build a LangGraph application on QVAC — we made QVAC usable as a first-class LangGraph chat model.</strong>
</blockquote>

<p>
  This lets developers use LangGraph for orchestration, tools, routing, state, and streaming,
  while QVAC provides local or delegated inference underneath — enabling advanced agentic
  workflows without cloud AI dependencies or per-token fees.
</p>

<p>
  This is not a demo-only abstraction:
  <strong>Meridian Assistant itself uses the published package in its production orchestration path</strong>
  for RAG, tool calling, streaming, text, and voice.
</p>

<p>
  <strong>Open-source repository:</strong>
  <a href="https://github.com/SpaceUY/qvac-langgraph">
    github.com/SpaceUY/qvac-langgraph
  </a>
</p>

<h2>Why this is different</h2>

<p align="center">
  <img
    src="docs/assets/why-different.svg"
    alt="Typical cloud assistant vs Meridian Assistant"
    width="900"
  />
</p>

<table>
  <tr>
    <td width="20%" valign="top">
      <strong>Local-first</strong><br><br>
      Inference, embeddings, and retrieval stay controlled.
    </td>
    <td width="20%" valign="top">
      <strong>Grounded</strong><br><br>
      Citations come from retrieved corpus evidence.
    </td>
    <td width="20%" valign="top">
      <strong>Adaptive</strong><br><br>
      Models change with available hardware.
    </td>
    <td width="20%" valign="top">
      <strong>Resilient</strong><br><br>
      P2P delegation falls back locally.
    </td>
    <td width="20%" valign="top">
      <strong>Compatible</strong><br><br>
      OpenAI-compatible API surface.
    </td>
  </tr>
</table>

<h2>Key capabilities</h2>

<table>
  <tr>
    <td><strong>Chat</strong></td>
    <td><code>POST /v1/chat/completions</code></td>
    <td>Streaming, grounding, and structured tools</td>
  </tr>
  <tr>
    <td><strong>Citations</strong></td>
    <td><code>citations: [{file, score}]</code></td>
    <td>Derived from retrieved evidence</td>
  </tr>
  <tr>
    <td><strong>Voice</strong></td>
    <td><code>/v1/chat/voice-completions</code></td>
    <td>Speech in, streamed speech out</td>
  </tr>
  <tr>
    <td><strong>Vision</strong></td>
    <td><code>image_url</code></td>
    <td>JPEG / PNG + WebP transcoding</td>
  </tr>
  <tr>
    <td><strong>RAG</strong></td>
    <td><code>BGE-M3 + LanceDB</code></td>
    <td>Incremental local ingestion</td>
  </tr>
  <tr>
    <td><strong>P2P</strong></td>
    <td>Public-key peer</td>
    <td>Delegation with automatic local fallback</td>
  </tr>
</table>

<h2>Proven, not mocked</h2>

<p align="center">
  <img
    src="docs/assets/metrics.svg"
    alt="Measured Meridian Assistant performance"
    width="900"
  />
</p>

<p>
  Measurements come from reproducible project benchmarks, including results that
  caused features to be reverted when they did not improve performance.
</p>

<p>
  <a href="docs/i4-native-addon-results.md">Native embedding benchmark</a>
  ·
  <a href="docs/i2-simultaneous-completions-results.md">Continuous batching benchmark</a>
  ·
  <a href="docs/bundle-size-report.md">Bundle report</a>
  ·
  <a href="docs/i6-performance-analysis.md">Profiler performance analysis</a>
</p>

<h2>Architecture</h2>

<p align="center">
  <img
    src="docs/assets/architecture.svg"
    alt="Meridian Assistant real runtime architecture: Express, AgentService, LangGraph, ChatQVAC, QvacChatSession, voice, and P2P delegation"
    width="900"
  />
</p>

<p>
  One <code>AgentService</code>, one compiled LangGraph graph, one QVAC model session —
  text and voice both run through the exact same pipeline, not two parallel ones.
</p>

<table>
  <tr>
    <td><strong>Express routers</strong></td>
    <td>Parse, validate, stream SSE, cancel on client disconnect</td>
  </tr>
  <tr>
    <td><strong>AgentService</strong></td>
    <td>Singleton orchestrator; shared by the text and voice routes</td>
  </tr>
  <tr>
    <td><strong>LangGraph graph</strong></td>
    <td>RAG once, then LLM ⇄ tools until no tool call remains</td>
  </tr>
  <tr>
    <td><strong>ChatQVAC</strong></td>
    <td>Our own <code>@space-uy/qvac-langgraph</code> adapter — makes QVAC look like any LangChain chat model</td>
  </tr>
  <tr>
    <td><strong>QvacChatSession</strong></td>
    <td>Model lifecycle, FIFO concurrency, delegation, mid-session recovery</td>
  </tr>
  <tr>
    <td><strong>Voice wrapper</strong></td>
    <td>Sentence-by-sentence TTS queue over the same AgentService output</td>
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
    <td><strong>ModelManagementService / QvacRuntimeAdapter</strong></td>
    <td>Discover → download → load → infer → unload → close</td>
  </tr>
  <tr>
    <td><strong>Local model / Meridian peer</strong></td>
    <td>Optional P2P delegated inference, automatic local fallback</td>
  </tr>
</table>

<h2>How a request flows</h2>

<p align="center">
  <img
    src="docs/assets/request-flow.gif"
    alt="Request flow for a grounded chat completion"
    width="900"
  />
</p>

<p>
  RAG runs once before inference. The LLM may loop through structured tools
  multiple times while tokens stream directly to the client. Citations are
  selected after the graph completes.
</p>

<h2>Engineering decisions</h2>

<p align="center">
  <img
    src="docs/assets/engineering-decisions.svg"
    alt="Engineering decisions overview"
    width="900"
  />
</p>

<h2>Hardware-aware inference</h2>

<p align="center">
  <img
    src="docs/assets/hardware-tiers.svg"
    alt="One product, three hardware tiers"
    width="900"
  />
</p>

<p>
  Hardware is detected once per process and mapped automatically to
  <code>low</code>, <code>medium</code>, or <code>high</code>.
  Override with <code>QVAC_RESOURCE_TIER=low|medium|high</code>.
</p>

<h2>Security</h2>

<p align="center">
  <img
    src="docs/assets/security-boundary.svg"
    alt="Meridian Assistant security boundary"
    width="900"
  />
</p>

<p>
  <strong>No cloud AI provider exists in the production request path.</strong>
  Corpus data, embeddings, retrieval, transcription, and TTS remain local.
</p>

<p>
  Optional delegated chat inference can reach only a configured
  Meridian-controlled peer identified by public key.
</p>

<table>
  <tr>
    <td><strong>.lancedb/</strong></td>
    <td>Local vector store</td>
  </tr>
  <tr>
    <td><strong>.qvac-cache/</strong></td>
    <td>Downloaded model weights</td>
  </tr>
  <tr>
    <td><strong>.run/</strong></td>
    <td>Process state</td>
  </tr>
  <tr>
    <td><strong>.env</strong></td>
    <td>Peer configuration</td>
  </tr>
</table>

<h2>Quick start</h2>

<pre><code>npm ci
npm run ingest --workspace=apps/backend
npm run dev:server
npm run dev:client</code></pre>

<p>
  First run requires internet once to cache model weights.
  Full backend and P2P setup:
  <a href="apps/backend/README.md"><code>apps/backend/README.md</code></a>.
</p>

<p>
  <strong>Or with Docker</strong> — a production-compiled image (no dev tooling in the final
  container) running the P2P provider/server demo on a private network:
</p>

<pre><code>npm run models:fetch --workspace=apps/backend
npm run ingest --workspace=apps/backend
cp .env.example .env
docker compose up --build</code></pre>

<p>
  <code>.qvac-cache/</code> and <code>.lancedb/</code> are host volumes, not baked into the
  image, so both commands above have to run on the host first — the <code>server</code>
  container refuses to start without an ingested vector store. Once up, the
  <code>server</code> container exposes the same OpenAI-compatible API on <code>:3001</code>,
  delegating chat inference to the <code>provider</code> container by public key, with
  automatic local fallback if it's unreachable. <code>.env.example</code> ships demo peer
  identities for local testing; generate fresh ones with
  <code>npm run seed:generate --workspace=apps/backend</code>.
</p>

<h2>Judge this project in 60 seconds</h2>

<p align="center">
  <img
    src="docs/assets/judge-60-seconds.svg"
    alt="Judge Meridian Assistant in 60 seconds"
    width="900"
  />
</p>

<ol>
  <li><code>npm ci</code></li>
  <li><code>npm run build:server</code></li>
  <li><code>npm run models:fetch</code></li>
  <li><code>npm run corpus:ingest</code></li>
  <li><code>npm run serve</code></li>
  <li>Wait for <code>GET /v1/models</code> → <code>200</code></li>
  <li><strong>Disconnect outbound network</strong></li>
  <li>Send a grounded completion</li>
  <li>Verify <code>citations[]</code></li>
</ol>

<pre><code>curl -X POST http://127.0.0.1:3001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"What was Q2 2026 total revenue?"}]}'</code></pre>

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
    <td>LangGraph ↔ QVAC integration</td>
    <td>✅ 🧪 Published as <code>@space-uy/qvac-langgraph</code> on npm — see <a href="#our-contribution-back-to-qvac">above</a></td>
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

  <tr>
    <td>Performance instrumentation</td>
    <td>✅ 🧪 Opt-in <code>profiler.exportJSON()</code> export + reproducible benchmark — see <a href="docs/i6-performance-analysis.md">analysis</a></td>
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

<h2>Team</h2>

<p>
  Built by <strong>SpaceDev</strong> for the QVAC Solutions Service Provider
  Qualification Exercise — Meridian Components scenario.
</p>
