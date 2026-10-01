// Human-readable names for a citation. The API sends only the machine form,
// { file: "reports/q2-2026-sales-performance-report.md", score } - its
// OpenAI-compatible contract has no room for titles - so the UI derives the
// readable form from the path itself. One source of truth: the `file` the
// evaluator checks is the same string every label here comes from.

/** "reports/q2-2026-sales-performance-report.md" -> "Q2 2026 Sales Performance Report" */
export function citationTitle(file: string): string {
  const name = file.split('/').at(-1) ?? file
  const words = name
    .replace(/\.[^.]+$/, '')
    .split(/[-_\s]+/)
    .filter(Boolean)
  if (words.length === 0) return file
  return words.map((word) => word[0].toUpperCase() + word.slice(1)).join(' ')
}

/** 0.8312 -> "0.83". A cosine similarity, NOT a probability: shown as a plain number, never as a percentage. */
export function formatScore(score: number): string {
  return score.toFixed(2)
}
