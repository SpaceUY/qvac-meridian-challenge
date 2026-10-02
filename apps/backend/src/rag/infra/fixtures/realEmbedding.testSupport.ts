import { DEFAULT_EMBEDDING_BATCH_SIZE, EMBEDDING_MODEL_EXPECTED_SIZE, EMBEDDING_MODEL_SOURCE } from '../../../config/models.config.js';
import { QvacRuntimeAdapter } from '../../../models/infra/qvacRuntimeAdapter.js';
import { ModelManagementService } from '../../../models/service/models.service.js';
import type { EmbeddingPort } from '../../domain/ports.js';
import { ResilientEmbeddingService } from '../../service/resilientEmbeddingService.js';
import { resolveNativeEmbeddingModelPath } from '../nativeEmbedding/embeddingGemmaModel.js';
import { QvacEmbeddingAdapter } from '../qvacEmbeddingAdapter.js';

/**
 * Whether the production embedding model is in the local QVAC cache
 * (`npm run models:fetch`). Tests that embed for real gate on this with
 * `describe.skipIf(!isEmbeddingModelCached())` so a machine without the
 * ~437MB model skips them instead of failing or downloading it mid-run.
 */
export function isEmbeddingModelCached(): boolean {
  try {
    resolveNativeEmbeddingModelPath(EMBEDDING_MODEL_SOURCE, EMBEDDING_MODEL_EXPECTED_SIZE);
    return true;
  } catch {
    return false;
  }
}

export interface RealEmbedding {
  embeddingPort: EmbeddingPort;
  /** Releases the model and closes the QVAC worker; without it the test process stays alive. */
  dispose(): Promise<void>;
}

/** The same embedding stack `server.ts` and `ingest.cli.ts` build: native path first, SDK fallback. */
export function createRealEmbedding(): RealEmbedding {
  const adapter = new QvacRuntimeAdapter();
  const modelService = new ModelManagementService(adapter, adapter);
  const embeddingPort = new ResilientEmbeddingService(
    modelService,
    new QvacEmbeddingAdapter(),
    EMBEDDING_MODEL_SOURCE,
    DEFAULT_EMBEDDING_BATCH_SIZE,
    EMBEDDING_MODEL_EXPECTED_SIZE
  );

  return {
    embeddingPort,
    async dispose() {
      await embeddingPort.unload();
      // Same unload-then-close pause as ingest.cli.ts: the two can race otherwise.
      await new Promise((resolve) => setTimeout(resolve, 150));
      await modelService.close();
    }
  };
}
