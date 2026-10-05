// The OpenAI-compatible citations contract has no room for titles, so the UI derives a readable label from the `file` path itself.

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
