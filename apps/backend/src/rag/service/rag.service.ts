import { DEFAULT_RAG_CONFIG } from '../../config/rag.config.js';
import type { EmbeddingPort, VectorStorePort } from '../domain/ports.js';
import type { RagRetrievalConfig, RagRetrievalResult, RetrievedChunk } from '../domain/types.js';
import { metadataRerank } from './metadataRerank.js';

/**
 * Runtime RAG retrieval: embed -> search -> dedupe -> rerank -> cap. Knows
 * nothing about LangChain/LangGraph or how retrieved chunks get formatted
 * into a prompt - see `contextBuilder.ts` for that.
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

    const deduped = this.dedupe(results);
    const chunks = metadataRerank(deduped).slice(0, this.config.maxContextChunks);

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
