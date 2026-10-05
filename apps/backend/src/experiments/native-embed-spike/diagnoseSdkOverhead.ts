/**
 * Follow-up diagnostic: is benchmark.ts's ~600ms/call `@qvac/sdk` `embed()` overhead a fixed per-RPC-call cost, or fixable by batching (like `QvacEmbeddingService.embedBatch()` already does at ingest)?
 * Run with: npx tsx src/experiments/native-embed-spike/diagnoseSdkOverhead.ts
 */
import { close as closeSdk, embed, loadModel, unloadModel } from "@qvac/sdk";
import { EMBEDDING_MODEL_SOURCE, EMBEDDING_MODEL_TYPE } from "../../config/models.config.js";
import { toRegistryModelSrc } from "./nativeEmbedClient.js";

const WARMUP_TEXT = "warmup";
const TEXTS = [
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

async function main(): Promise<void> {
  const modelId = await loadModel({
    modelSrc: toRegistryModelSrc(EMBEDDING_MODEL_SOURCE),
    modelType: EMBEDDING_MODEL_TYPE
  });
  await embed({ modelId, text: WARMUP_TEXT });

  // A) 10 separate embed() calls, one text each - what benchmark.ts did.
  const separateStart = Date.now();
  for (const text of TEXTS) {
    await embed({ modelId, text });
  }
  const separateTotalMs = Date.now() - separateStart;

  // B) ONE embed() call with all 10 texts batched - the shape QvacEmbeddingService.embedBatch() sends at ingest time.
  const batchedStart = Date.now();
  const batchedResult = await embed({ modelId, text: TEXTS });
  const batchedTotalMs = Date.now() - batchedStart;

  // C) A single call with a single trivial text, repeated, to see if the
  // per-call floor is stable regardless of which text/position it is.
  const singleCallTimings: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    await embed({ modelId, text: "x" });
    singleCallTimings.push(Date.now() - t0);
  }

  await unloadModel({ modelId, clearStorage: false });
  await closeSdk();

  console.log("\n=== Diagnostic results ===");
  console.log(`A) 10 separate embed() calls: total ${separateTotalMs}ms, avg/text ${(separateTotalMs / TEXTS.length).toFixed(1)}ms`);
  console.log(
    `B) 1 batched embed() call (${TEXTS.length} texts, ${Array.isArray(batchedResult.embedding) && Array.isArray(batchedResult.embedding[0]) ? batchedResult.embedding.length : "?"} vectors returned): total ${batchedTotalMs}ms, avg/text ${(batchedTotalMs / TEXTS.length).toFixed(1)}ms`
  );
  console.log(`C) 5x single-char embed() calls (repeat, no varying text/position): [${singleCallTimings.join(", ")}] ms`);
  console.log(`\nRatio A/B (per-text avg): ${((separateTotalMs / TEXTS.length) / (batchedTotalMs / TEXTS.length)).toFixed(1)}x`);
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
