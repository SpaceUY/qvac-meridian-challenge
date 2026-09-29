import { DocumentType } from '../../../document/domain/document.model.js';
import type { EmbeddingPort } from '../../domain/ports.js';
import { InMemoryVectorStore } from '../inMemoryVectorStore.js';

export interface FixtureChunk {
  id: string;
  content: string;
  source: string;
  metadata: { documentType: DocumentType; title: string };
}

/**
 * Short excerpts inspired by real files under `corpus/` - not verbatim
 * reproductions. Exists to exercise retrieval (ranking, thresholding,
 * dedupe), not to mirror whole documents. The last two entries are
 * deliberately off-topic relative to SLA/support queries, to validate
 * that ranking and `minScore` correctly push them below relevant chunks.
 */
export const CORPUS_CHUNK_FIXTURES: FixtureChunk[] = [
  {
    id: 'chunk-sla-p1',
    content:
      'Enterprise P1 first-response SLA is 4 hours for production down or safety interlock issues on ControLink Suite and ServoDrive X4 enterprise contracts.',
    source: 'support-sla-faq.html',
    metadata: { documentType: DocumentType.FAQ, title: 'Support SLA - Internal FAQ' }
  },
  {
    id: 'chunk-warranty-01',
    content:
      'Standard hardware warranty covers manufacturing defects for 24 months from the ship date, excluding damage from unauthorized modification.',
    source: 'warranty-terms.md',
    metadata: { documentType: DocumentType.POLICIES, title: 'Warranty Terms' }
  },
  {
    id: 'chunk-escalation-01',
    content:
      'P1 escalation path: L1 to L2 within 30 minutes, L2 to Engineering within 2 hours if unresolved.',
    source: 'escalation-matrix.txt',
    metadata: { documentType: DocumentType.POLICIES, title: 'Escalation Matrix' }
  },
  {
    id: 'chunk-sales-q1-01',
    content:
      'Q1 2026 closed pipeline grew 12 percent quarter over quarter, led by the Atlas and Pinnacle enterprise accounts.',
    source: 'q1-2026-sales-summary.md',
    metadata: { documentType: DocumentType.REPORTS, title: 'Q1 2026 Sales Summary' }
  },
  {
    id: 'chunk-hiring-01',
    content:
      'The field service team is approved to hire two additional technicians in APAC during the third quarter.',
    source: '004-hiring-plan.md',
    metadata: { documentType: DocumentType.EMAIL, title: 'Hiring Plan' }
  },
  {
    id: 'chunk-catalog-01',
    content:
      'The ServoDrive X4 product line ships in three chassis sizes and supports both 24V and 48V input power.',
    source: 'fy2026-product-catalog-excerpt.md',
    metadata: { documentType: DocumentType.REPORTS, title: 'FY2026 Product Catalog Excerpt' }
  }
];

/** Embeds every fixture chunk and indexes it into a fresh `InMemoryVectorStore`. */
export async function buildFixtureVectorStore(embeddingPort: EmbeddingPort): Promise<InMemoryVectorStore> {
  const indexed = await Promise.all(
    CORPUS_CHUNK_FIXTURES.map(async (fixture) => ({
      id: fixture.id,
      content: fixture.content,
      source: fixture.source,
      metadata: fixture.metadata,
      embedding: await embeddingPort.embed(fixture.content)
    }))
  );
  return new InMemoryVectorStore(indexed);
}
