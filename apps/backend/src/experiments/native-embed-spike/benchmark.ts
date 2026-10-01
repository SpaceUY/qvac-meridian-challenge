/**
 * I.4 spike - benchmarks the existing `@qvac/sdk` embedding path against the
 * native `@qvac/embed-llamacpp` path added by this spike, same
 * EmbeddingGemma 300M Q4_0 model, same default config, same input texts.
 *
 * Run with: npm run native-embed-benchmark --workspace=apps/backend
 *
 * Measures, per path: model load time, average per-call embedding latency,
 * throughput (embeddings/sec), and peak `bare.exe` working-set memory (see
 * `rssSampler.ts` for why that process, not the Node driver, is what
 * actually holds the model).
 */
import { close as closeSdk, embed, loadModel, unloadModel } from "@qvac/sdk";
import { EMBEDDING_MODEL_SOURCE, EMBEDDING_MODEL_TYPE } from "../../config/models.config.js";
import {
  DEFAULT_NATIVE_EMBED_CONFIG,
  resolveEmbeddingGemmaModelPath,
  runNativeEmbeddings,
  toRegistryModelSrc
} from "./nativeEmbedClient.js";
import { startBareRssSampler, waitForNoBareProcesses } from "./rssSampler.js";

const WARMUP_TEXT =
  "This is a warmup call so the first timed call in each path is not skewed by cold-start effects.";

/**
 * Short query-like + longer paragraph-like variants, roughly spanning the
 * 180-word chunk size `config/rag.config.ts` ingests at. Drawn from the same
 * domain as the real corpus (`corpus/faqs`, `corpus/policies` - Meridian
 * Components support/escalation content) for realism, though benchmark
 * timing does not depend on the text's subject matter.
 */
const BENCHMARK_TEXTS: string[] = [
  "What is the P1 first-response SLA for a production-down issue?",
  "How many hours does L1 have to escalate a P2 ticket to L2?",
  "When did the APAC on-call roster gap close?",
  "Can we promise a ControLink Gateway rev C delivery before August?",
  "Who owns the support escalation matrix document?",
  "Priority definitions and contractual first-response SLAs for the enterprise ControLink Suite and ServoDrive X4 state that a production-down or safety-interlock issue (P1) requires a first response within 4 hours, a major feature impairment (P2) requires 8 hours, and a minor defect or question (P3) requires a first response within 1 business day.",
  "Internal escalation clocks start when a ticket is created or its severity is confirmed. For P1 issues, L1 must escalate to L2 within 30 minutes, and L2 must escalate to Engineering within 2 hours; if there is no L2 acknowledgment within 15 minutes, the on-call engineer must be paged immediately.",
  "The APAC follow-the-sun roster gap that caused two P1 SLA breaches on 3 May and 19 May was closed on 15 June 2026, and the quarter's actual mean P1 first response time was 2.6 hours, which remained within the contractual SLA despite those two breaches.",
  "CAPA-441 is a ship-hold on the ControLink Gateway revision C hardware, meaning support and sales must not promise a rev C delivery date before 15 August 2026 without written approval from Ops, and should instead offer revision B for any customer need arising in July.",
  "The source of truth for contractual SLA commitments remains the enterprise master service agreement rather than any internal FAQ or escalation matrix document, both of which exist only to help internal staff apply the MSA's terms consistently across regions."
];

interface CallStats {
  elapsedMs: number[];
}

interface PathResult {
  label: string;
  loadTimeMs: number;
  peakBareRssBytes: number;
  calls: CallStats;
}

function summarize(elapsedMs: number[]): { avgMs: number; p50Ms: number; throughputPerSec: number } {
  const sorted = [...elapsedMs].sort((a, b) => a - b);
  const avgMs = elapsedMs.reduce((sum, v) => sum + v, 0) / elapsedMs.length;
  const p50Ms = sorted[Math.floor(sorted.length / 2)];
  return { avgMs, p50Ms, throughputPerSec: 1000 / avgMs };
}

async function runSdkPath(): Promise<PathResult> {
  await waitForNoBareProcesses();
  const sampler = startBareRssSampler();

  const loadStart = Date.now();
  const modelId = await loadModel({ modelSrc: toRegistryModelSrc(EMBEDDING_MODEL_SOURCE), modelType: EMBEDDING_MODEL_TYPE });
  const loadTimeMs = Date.now() - loadStart;

  await embed({ modelId, text: WARMUP_TEXT });

  const elapsedMs: number[] = [];
  for (const text of BENCHMARK_TEXTS) {
    const start = Date.now();
    await embed({ modelId, text });
    elapsedMs.push(Date.now() - start);
  }

  await unloadModel({ modelId, clearStorage: false });
  await closeSdk();
  const peakBareRssBytes = await sampler.stop();
  await waitForNoBareProcesses();

  return { label: "@qvac/sdk (embed())", loadTimeMs, peakBareRssBytes, calls: { elapsedMs } };
}

async function runNativePath(): Promise<PathResult> {
  await waitForNoBareProcesses();
  const sampler = startBareRssSampler();

  const modelPath = resolveEmbeddingGemmaModelPath();
  const result = await runNativeEmbeddings(modelPath, [WARMUP_TEXT, ...BENCHMARK_TEXTS], {
    config: DEFAULT_NATIVE_EMBED_CONFIG
  });

  const peakBareRssBytes = await sampler.stop();
  await waitForNoBareProcesses();

  // First call is the warmup - excluded from the compared stats, same as the SDK path above.
  const [, ...timedCalls] = result.calls;
  return {
    label: "@qvac/embed-llamacpp (native, via bare)",
    loadTimeMs: result.loadTimeMs,
    peakBareRssBytes,
    calls: { elapsedMs: timedCalls.map((c) => c.elapsedMs) }
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "n/a (no bare.exe process observed)";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function printResult(result: PathResult): void {
  const { avgMs, p50Ms, throughputPerSec } = summarize(result.calls.elapsedMs);
  console.log(`\n▸ ${result.label}`);
  console.log(`  load time:        ${result.loadTimeMs} ms`);
  console.log(`  calls:            ${result.calls.elapsedMs.length} (+1 warmup, excluded)`);
  console.log(`  avg latency:      ${avgMs.toFixed(2)} ms`);
  console.log(`  p50 latency:      ${p50Ms} ms`);
  console.log(`  throughput:       ${throughputPerSec.toFixed(2)} embeddings/sec`);
  console.log(`  peak bare.exe RSS: ${formatBytes(result.peakBareRssBytes)}`);
  console.log(`  per-call ms:      [${result.calls.elapsedMs.join(", ")}]`);
}

async function main(): Promise<void> {
  console.log(`Benchmarking ${BENCHMARK_TEXTS.length} texts (+1 warmup) per path, sequentially...`);

  const sdkResult = await runSdkPath();
  printResult(sdkResult);

  const nativeResult = await runNativePath();
  printResult(nativeResult);

  console.log("\n▸ Summary (native vs SDK)");
  const sdkStats = summarize(sdkResult.calls.elapsedMs);
  const nativeStats = summarize(nativeResult.calls.elapsedMs);
  console.log(`  load time:   native is ${(nativeResult.loadTimeMs / sdkResult.loadTimeMs).toFixed(2)}x the SDK's`);
  console.log(`  avg latency: native is ${(nativeStats.avgMs / sdkStats.avgMs).toFixed(2)}x the SDK's`);
  console.log(
    `  throughput:  native is ${(nativeStats.throughputPerSec / sdkStats.throughputPerSec).toFixed(2)}x the SDK's`
  );
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
