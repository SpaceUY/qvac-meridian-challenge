// Human-readable names for a citation. The API sends only the machine form,
// { file: "reports/q2-2026-sales-performance-report.md", score } - its
// OpenAI-compatible contract has no room for titles - so the UI derives the
// readable form from the path itself. One source of truth: the `file` the
// evaluator checks is the same string every label here comes from.

import type { CitedChunk } from '@/lib/chat-types'

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

/** `chunkIndex` is zero-based; people count from 1. A chunk with no index is just "Passage". */
export function chunkLabel({ chunkIndex }: Pick<CitedChunk, 'chunkIndex'>): string {
  return chunkIndex === undefined ? 'Passage' : `Passage ${chunkIndex + 1}`
}

export type FormattedChunk = { kind: 'markdown' | 'code' | 'text'; text: string }

const CODE_EXTENSIONS = new Set(['json', 'html', 'csv'])

/**
 * How a chunk should be shown, picked from its file's extension. A chunk is a
 * word-count slice of the document, not a whole file, so only a chunk that
 * happens to be a complete JSON document is pretty-printed; any other
 * fragment - and all html/csv - is shown as source text, never rendered
 * (html is document content: rendering it would be an injection risk, and a
 * mid-document fragment would look broken anyway).
 */
export function formatChunk(file: string, content: string): FormattedChunk {
  const name = file.split('/').at(-1) ?? file
  const extension = name.includes('.') ? name.split('.').at(-1)?.toLowerCase() : undefined

  if (extension === 'md') return { kind: 'markdown', text: content }
  if (extension === 'json') return { kind: 'code', text: prettyJson(content) }
  if (extension !== undefined && CODE_EXTENSIONS.has(extension)) return { kind: 'code', text: content }
  return { kind: 'text', text: content }
}

function prettyJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2)
  } catch {
    return content
  }
}

/** 0.8312 -> "0.83". A cosine similarity, NOT a probability: shown as a plain number, never as a percentage. */
export function formatScore(score: number): string {
  return score.toFixed(2)
}
