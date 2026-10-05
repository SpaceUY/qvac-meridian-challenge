import { embed } from '@qvac/sdk';

/** Pure translation over `embed()` - no lifecycle/batching/validation, that's `service/qvacEmbeddingService.ts`. */
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
