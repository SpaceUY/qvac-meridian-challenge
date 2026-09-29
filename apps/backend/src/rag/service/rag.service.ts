import type { EmbeddingPort, VectorStorePort } from '../domain/ports.js';
import type { RagRetrievalConfig, RagRetrievalResult, RetrievedChunk } from '../domain/types.js';
import { DEFAULT_RAG_CONFIG } from './rag.service.const.js';

/**
 * Runtime RAG retrieval: embed -> search -> dedupe -> cap. Knows nothing
 * about LangChain/LangGraph or how retrieved chunks get formatted into a
 * prompt - see `contextBuilder.ts` for that.
 */
export class RagRetrievalService {
  constructor(
    private readonly embeddingPort: EmbeddingPort,
    private readonly vectorStore: VectorStorePort,
    private readonly config: RagRetrievalConfig = DEFAULT_RAG_CONFIG
  ) {}

  async retrieve(query: string): Promise<RagRetrievalResult> {
    const embedding = await this.embeddingPort.embed(query);
    const results = await this.vectorStore.search(embedding, {
      topK: this.config.topK,
      minScore: this.config.minScore
    });

    const chunks = this.dedupe(results).slice(0, this.config.maxContextChunks);

    return { chunks, hasEvidence: chunks.length > 0 };
  }

  private dedupe(chunks: RetrievedChunk[]): RetrievedChunk[] {
    const seenIds = new Set<string>();
    const seenContent = new Set<string>();
    const result: RetrievedChunk[] = [];

    for (const chunk of chunks) {
      if (seenIds.has(chunk.id)) continue;
      if (this.config.dedupeExactContent && seenContent.has(chunk.content)) continue;

      seenIds.add(chunk.id);
      seenContent.add(chunk.content);
      result.push(chunk);
    }

    return result;
  }
}
