// ---------------------------------------------------------------------------
// FAKE DATA - BLOCK 2 (visual chassis)
//
// None of this comes from a real source yet: Ernesto's orchestrator will fetch the corpus.
// This file exists only so the corpus panel has content while
// the layout is being put together. It is replaced with real data without touching the component
// that shows it (it doesn't know if the data is fake or real).
// ---------------------------------------------------------------------------

export type CorpusDocument = { file: string; chunks: number }

export const FAKE_CORPUS: CorpusDocument[] = [
  { file: 'garantia-x4.md', chunks: 12 },
  { file: 'faq-comercial.md', chunks: 8 },
  { file: 'soporte-p1.md', chunks: 21 },
  { file: 'specs-x4.csv', chunks: 6 },
  { file: 'politica-rma.md', chunks: 9 },
]
