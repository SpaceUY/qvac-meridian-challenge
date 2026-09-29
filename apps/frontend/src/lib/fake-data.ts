// ---------------------------------------------------------------------------
// FAKE DATA - BLOCK 2 (visual chassis)
//
// None of this comes from a real source yet: Ernesto's orchestrator will fetch the corpus,
// and your own API will expose the hardware. This
// file exists only so the panels have content while
// the layout is being put together. It is replaced with real data without touching the components
// that show them (they don't know if the data is fake or real).
// ---------------------------------------------------------------------------

export type CorpusDocument = { file: string; chunks: number }

export const FAKE_CORPUS: CorpusDocument[] = [
  { file: 'garantia-x4.md', chunks: 12 },
  { file: 'faq-comercial.md', chunks: 8 },
  { file: 'soporte-p1.md', chunks: 21 },
  { file: 'specs-x4.csv', chunks: 6 },
  { file: 'politica-rma.md', chunks: 9 },
]

export const FAKE_ENGINE_STATE = {
  /** 'local' | 'delegated' -> req [5.1] */
  mode: 'local' as const,
  model: { name: 'llama-3.2-3b', quantization: 'Q4_K_M', context: 4096, tokensPerSec: 18.4 },
  embeddings: { name: 'embeddinggemma', dimension: 768 },
  machine: { cpu: 'Apple M3 · 8c', totalRamGb: 16, gpu: 'integrated' },
  usedRamGb: 2.1,
  availableRamGb: 5.5,
  selectedProfile: '3B / Q4 — automatically selected for having less than 8 GB free.',
}
