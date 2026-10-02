// Marks where the cited chunks sit inside the whole document, for the source
// dialog's "Full document" view. A chunk is a verbatim slice of its file (the
// backend chunks the exact text it reads from disk), so a plain string search
// finds it - no fuzzy matching.

import type { CitedChunk } from '@/lib/chat-types'

export type Segment = { text: string; highlighted: boolean }

type Range = [start: number, end: number]

/**
 * Splits `content` into alternating plain / highlighted segments that,
 * joined, rebuild it exactly. Neighbouring chunks overlap by design, and the
 * backend sends them best-score first rather than in document order, so the
 * found ranges are sorted and overlapping or touching ones merged.
 *
 * `missing` counts chunks that could not be located - the file changed after
 * it was indexed - so the UI can say so instead of silently showing less.
 * A chunk that occurs twice in the document is marked at its first occurrence.
 */
export function highlightSegments(
  content: string,
  chunks: Pick<CitedChunk, 'content'>[],
): { segments: Segment[]; missing: number } {
  const ranges: Range[] = []
  let missing = 0

  for (const chunk of chunks) {
    const start = chunk.content === '' ? -1 : content.indexOf(chunk.content)
    if (start === -1) missing++
    else ranges.push([start, start + chunk.content.length])
  }

  const segments: Segment[] = []
  let cursor = 0
  for (const [start, end] of mergeRanges(ranges)) {
    if (start > cursor) segments.push({ text: content.slice(cursor, start), highlighted: false })
    segments.push({ text: content.slice(start, end), highlighted: true })
    cursor = end
  }
  if (cursor < content.length) segments.push({ text: content.slice(cursor), highlighted: false })

  return { segments, missing }
}

function mergeRanges(ranges: Range[]): Range[] {
  const merged: Range[] = []
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1)
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}
