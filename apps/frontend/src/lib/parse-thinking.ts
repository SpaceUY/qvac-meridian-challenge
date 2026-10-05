// Splits Qwen3's <think>...</think> reasoning block away from the answer the user should see.

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
