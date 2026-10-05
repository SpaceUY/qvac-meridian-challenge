/**
 * I.4 spike - verifies native-path vectors are usable with the existing RAG vector store (built via `@qvac/sdk` embeddings). Read-only, never writes to `.lancedb`.
 * Per query: embeds via both paths, checks both vectors are the same dimension and near-identical (cosine), and compares real `chunks`-table search results.
 * Run with: npm run native-embed-verify --workspace=apps/backend (requires `npm run corpus:ingest` first)
 */
import { close as closeSdk, embed, loadModel, unloadModel } from "@qvac/sdk";
import { LanceDbVectorStore } from "../../rag/infra/lanceDbVectorStore.js";
import { DEFAULT_RAG_CONFIG, EMBEDDING_DIMENSIONS, VECTOR_DB_DIR } from "../../config/rag.config.js";
import { EMBEDDING_MODEL_SOURCE, EMBEDDING_MODEL_TYPE } from "../../config/models.config.js";
import {
  DEFAULT_NATIVE_EMBED_CONFIG,
  resolveEmbeddingGemmaModelPath,
  runNativeEmbeddings,
  toRegistryModelSrc
} from "./nativeEmbedClient.js";

/** Picked from real corpus content (`corpus/faqs/support-sla-faq.html`, `corpus/policies/escalation-matrix.txt`) so retrieval has real matches to find. */
const VERIFY_QUERIES = [
  "What is the P1 first-response SLA for a production-down issue?",
  "When did the APAC on-call roster gap close?",
  "Can we promise a ControLink Gateway rev C delivery next week?"
];

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both vectors are already L2-normalized, so dot product == cosine similarity
}

async function embedAllViaSdk(queries: string[]): Promise<number[][]> {
  const modelId = await loadModel({
    modelSrc: toRegistryModelSrc(EMBEDDING_MODEL_SOURCE),
    modelType: EMBEDDING_MODEL_TYPE
  });
  try {
    const vectors: number[][] = [];
    for (const query of queries) {
      const result = await embed({ modelId, text: query });
      vectors.push(result.embedding as number[]);
    }
    return vectors;
  } finally {
    await unloadModel({ modelId, clearStorage: false });
    await closeSdk();
  }
}

async function embedAllViaNative(queries: string[]): Promise<number[][]> {
  const modelPath = resolveEmbeddingGemmaModelPath();
  const result = await runNativeEmbeddings(modelPath, queries, { config: DEFAULT_NATIVE_EMBED_CONFIG });
  return result.calls.map((call) => call.embedding);
}

async function main(): Promise<void> {
  if (!(await LanceDbVectorStore.exists(VECTOR_DB_DIR))) {
    throw new Error(`No "chunks" table found at ${VECTOR_DB_DIR}. Run "npm run corpus:ingest" first.`);
  }
  const store = await LanceDbVectorStore.open(VECTOR_DB_DIR);

  console.log("Embedding verification queries via @qvac/sdk...");
  const sdkVectors = await embedAllViaSdk(VERIFY_QUERIES);

  console.log("Embedding verification queries via the native path...");
  const nativeVectors = await embedAllViaNative(VERIFY_QUERIES);

  let allOk = true;

  for (let i = 0; i < VERIFY_QUERIES.length; i++) {
    const query = VERIFY_QUERIES[i];
    const sdkVector = sdkVectors[i];
    const nativeVector = nativeVectors[i];

    console.log(`\n▸ Query: "${query}"`);

    const dimensionOk = sdkVector.length === EMBEDDING_DIMENSIONS && nativeVector.length === EMBEDDING_DIMENSIONS;
    console.log(`  dimension: sdk=${sdkVector.length} native=${nativeVector.length} (expected ${EMBEDDING_DIMENSIONS}) ${dimensionOk ? "OK" : "MISMATCH"}`);
    allOk = allOk && dimensionOk;

    const similarity = cosineSimilarity(sdkVector, nativeVector);
    const similarityOk = similarity > 0.99;
    console.log(`  cosine(sdk, native): ${similarity.toFixed(6)} ${similarityOk ? "OK" : "LOW"}`);
    allOk = allOk && similarityOk;

    const [sdkResults, nativeResults] = await Promise.all([
      store.search(sdkVector, DEFAULT_RAG_CONFIG),
      store.search(nativeVector, DEFAULT_RAG_CONFIG)
    ]);

    console.log(
      `  sdk top result:    ${sdkResults[0] ? `${sdkResults[0].source} (score ${sdkResults[0].score.toFixed(4)})` : "none"}`
    );
    console.log(
      `  native top result: ${nativeResults[0] ? `${nativeResults[0].source} (score ${nativeResults[0].score.toFixed(4)})` : "none"}`
    );

    const topResultMatches = sdkResults[0]?.source === nativeResults[0]?.source;
    console.log(`  top result matches: ${topResultMatches ? "OK" : "DIFFERENT"}`);
    allOk = allOk && topResultMatches;
  }

  console.log(`\n▸ Overall: ${allOk ? "PASS - native vectors are interchangeable with the existing vector store" : "FAIL - see mismatches above"}`);
  if (!allOk) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
