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

<hr>

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

<hr>

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

<hr>

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

<hr>

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

<hr>

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

<hr>

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
</p>

<hr>

<h2>Architecture</h2>

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
    <td>Retrieval, tools, inference, and citation orchestration</td>
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
</table>

<hr>

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

<hr>

<h2>Engineering decisions</h2>

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
    <td>Fixed the benchmark and shipped only the measured gain</td>
  </tr>
  <tr>
    <td>Continuous batching regressed on medium hardware</td>
    <td>Medium stays sequential</td>
  </tr>
  <tr>
    <td>Default retrieval settings were insufficient</td>
    <td>Benchmarked model, chunk size, and threshold</td>
  </tr>
  <tr>
    <td>P2P peers may disappear mid-session</td>
    <td>Heartbeat monitoring + automatic local fallback</td>
  </tr>
  <tr>
    <td>Two-image requests crash the current upstream worker</td>
    <td>Production currently caps messages at one image</td>
  </tr>
</table>

<hr>

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

<hr>

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

<hr>

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

<hr>

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

<hr>

<details>
<summary><strong>Challenge requirements coverage</strong></summary>

<br>

<!-- keep your existing requirements table here -->

</details>

<br>

<details>
<summary>
  <strong id="technical-challenges--known-limitations">
    Technical challenges & known limitations
  </strong>
</summary>

<br>

<!-- keep the detailed limitation table here -->

</details>

<hr>

<h2>Team</h2>

<p>
  Built by <strong>SpaceDev</strong> for the QVAC Solutions Service Provider
  Qualification Exercise — Meridian Components scenario.
</p>
