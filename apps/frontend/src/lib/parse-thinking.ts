// Qwen3 (and other reasoning models) wrap their internal reasoning in
// <think>...</think> before the real answer. This file knows how to split
// that reasoning away from what the user should actually see — nothing else
// in the app needs to know the tag even exists.

const THINK_OPEN = '<think>'
const THINK_CLOSE = '</think>'

export type ParsedThinking = {
  /** True while we're still inside an unclosed <think> block. */
  isThinking: boolean
  /** The part of the text meant to be shown to the user. */
  answer: string
}

export function parseThinking(rawText: string): ParsedThinking {
  const openIndex = rawText.indexOf(THINK_OPEN)
  if (openIndex === -1) return { isThinking: false, answer: rawText }

  const closeIndex = rawText.indexOf(THINK_CLOSE, openIndex)
  const before = rawText.slice(0, openIndex)

  if (closeIndex === -1) return { isThinking: true, answer: before }

  const after = rawText.slice(closeIndex + THINK_CLOSE.length)
  return { isThinking: false, answer: (before + after).trimStart() }
}
