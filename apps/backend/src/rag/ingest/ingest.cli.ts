import { SDK_CLIENT_ERROR_CODES } from '@qvac/sdk';
import { QvacRuntimeAdapter } from '../../models/infra/qvacRuntimeAdapter.js';
import { ModelManagementService } from '../../models/service/models.service.js';
import { QvacEmbeddingAdapter } from '../infra/qvacEmbeddingAdapter.js';
import { ResilientEmbeddingService } from '../service/resilientEmbeddingService.js';
import { QvacChunker } from '../infra/qvacChunker.adapter.js';
import { LanceDbVectorStoreWriter } from '../infra/lanceDbVectorStore.js';
import { CorpusIngestService, type IngestReport } from './corpusIngest.service.js';
import { CORPUS_ROOT, VECTOR_DB_DIR } from '../../config/rag.config.js';
import { DEFAULT_EMBEDDING_BATCH_SIZE, EMBEDDING_MODEL_EXPECTED_SIZE, EMBEDDING_MODEL_SOURCE } from '../../config/models.config.js';

/** True for `@qvac/sdk`'s `RPC_INIT_TIMEOUT` - a slow first `bare.exe` spawn (e.g. antivirus scanning it) can miss the SDK's hardcoded 30s handshake window. Checked on both the raw error and `ModelManagementError.cause`. */
function isRpcInitTimeout(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  const causeCode = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  return code === SDK_CLIENT_ERROR_CODES.RPC_INIT_TIMEOUT || causeCode === SDK_CLIENT_ERROR_CODES.RPC_INIT_TIMEOUT;
}

function printReport(report: IngestReport, totalRows: number): void {
  const list = (label: string, items: string[]): void => {
    console.log(`  ${label.padEnd(12)} ${items.length}`);
    for (const item of items) console.log(`      - ${item}`);
  };

  console.log('\n=== Ingest report ===');
  list('added', report.added);
  list('updated', report.updated);
  list('removed', report.removed);
  console.log(`  ${'unchanged'.padEnd(12)} ${report.unchanged.length} (not re-embedded)`);
  console.log(`\n  chunks written this run: ${report.chunksWritten}`);
  console.log(`  rows in table now:       ${totalRows}`);
  console.log(`  vector store:            ${VECTOR_DB_DIR}`);
}

async function main(): Promise<void> {
  const adapter = new QvacRuntimeAdapter();
  const modelService = new ModelManagementService(adapter, adapter);
  // Native @qvac/embed-llamacpp path primary, @qvac/sdk path as fallback - see docs/i4-native-addon-results.md.
  const embeddingPort = new ResilientEmbeddingService(
    modelService,
    new QvacEmbeddingAdapter(),
    EMBEDDING_MODEL_SOURCE,
    DEFAULT_EMBEDDING_BATCH_SIZE,
    EMBEDDING_MODEL_EXPECTED_SIZE
  );
  const writer = await LanceDbVectorStoreWriter.open(VECTOR_DB_DIR);

  const ingestService = new CorpusIngestService(new QvacChunker(), embeddingPort, writer);

  let failure: unknown;

  try {
    console.log(`Ingesting ${CORPUS_ROOT} ...`);
    let report: IngestReport;
    try {
      report = await ingestService.ingest(CORPUS_ROOT);
    } catch (err) {
      if (!isRpcInitTimeout(err)) throw err;
      // Safe to retry: ingest is idempotent, so a cold-spawn timeout never re-embeds already-written documents.
      console.warn('[ingest] RPC init timed out on the first attempt (cold worker spawn) - retrying once...');
      report = await ingestService.ingest(CORPUS_ROOT);
    }
    printReport(report, await writer.countRows());
  } catch (err) {
    failure = err;
  }

  // Always runs: an open QVAC worker keeps Node alive and the terminal hangs.
  try {
    await embeddingPort.unload();
    // Unload and close can race without this pause.
    await new Promise((resolve) => setTimeout(resolve, 150));
    await modelService.close();
  } catch (cleanupErr) {
    console.error('Cleanup failed:', cleanupErr);
    if (!failure) failure = cleanupErr;
  }

  if (failure) throw failure;
}

main().catch((err: unknown) => {
  console.error('\nIngest failed:', err);
  process.exit(1);
});
