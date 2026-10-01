import { embed } from '@qvac/sdk';

/**
 * The only file in this feature that imports `@qvac/sdk`. Pure translation
 * over the SDK's `embed()` RPC - no model lifecycle, no batching policy, no
 * validation. That lives in `service/qvacEmbeddingService.ts`, the same
 * split `models/infra/qvacRuntimeAdapter.ts` keeps from
 * `models/service/models.service.ts`.
 */
export class QvacEmbeddingAdapter {
  async embedOne(modelId: string, text: string): Promise<number[]> {
    const result = await embed({ modelId, text });
    return result.embedding;
  }

  async embedMany(modelId: string, texts: string[]): Promise<number[][]> {
    const result = await embed({ modelId, text: texts });
    return result.embedding;
  }
}
