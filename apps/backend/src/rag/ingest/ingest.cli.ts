import { QvacRuntimeAdapter } from '../../models/infra/qvacRuntimeAdapter.js';
import { ModelManagementService } from '../../models/service/models.service.js';
import { QvacEmbeddingAdapter } from '../infra/qvacEmbeddingAdapter.js';
import { ResilientEmbeddingService } from '../service/resilientEmbeddingService.js';
import { QvacChunker } from '../infra/qvacChunker.adapter.js';
import { LanceDbVectorStoreWriter } from '../infra/lanceDbVectorStore.js';
import { CorpusIngestService, type IngestReport } from './corpusIngest.service.js';
import { CORPUS_ROOT, VECTOR_DB_DIR } from '../../config/rag.config.js';
import { DEFAULT_EMBEDDING_BATCH_SIZE, EMBEDDING_MODEL_SOURCE } from '../../config/models.config.js';

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
  // I.4: native @qvac/embed-llamacpp path primary, @qvac/sdk path as fallback
  // (init failure or a mid-session worker crash) - see
  // docs/i4-native-addon-results.md. Same constructor shape as the
  // QvacEmbeddingService it replaces.
  const embeddingPort = new ResilientEmbeddingService(
    modelService,
    new QvacEmbeddingAdapter(),
    EMBEDDING_MODEL_SOURCE,
    DEFAULT_EMBEDDING_BATCH_SIZE
  );
  const writer = await LanceDbVectorStoreWriter.open(VECTOR_DB_DIR);

  const ingestService = new CorpusIngestService(new QvacChunker(), embeddingPort, writer);

  let failure: unknown;

  try {
    console.log(`Ingesting ${CORPUS_ROOT} ...`);
    const report = await ingestService.ingest(CORPUS_ROOT);
    printReport(report, await writer.countRows());
  } catch (err) {
    failure = err;
  }

  // Always runs: leaving the QVAC worker open keeps Node alive and the
  // terminal hangs. Cleanup failures are reported but never mask the real
  // error, if there was one.
  try {
    await embeddingPort.unload();
    // Project rule, verified: give the unload a moment before tearing the
    // connection down, or the two can race.
    await new Promise((resolve) => setTimeout(resolve, 150));
    await modelService.close();
  } catch (cleanupErr) {
    console.error('Cleanup failed:', cleanupErr);
    if (!failure) failure = cleanupErr;
  }

  if (failure) throw failure;
}

main().catch((err: unknown) => {
  console.error('\n✖ Ingest failed:', err);
  process.exit(1);
});
