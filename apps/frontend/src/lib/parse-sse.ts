// Reads an OpenAI-style SSE stream. Events are separated by a blank line, but the browser
// delivers the body in byte chunks that don't respect those boundaries - hence the buffer.

/** End of event: a blank line. The \r? covers Windows line endings. */
const EVENT_SEPARATOR = /\r?\n\r?\n/
const LINE_SEPARATOR = /\r?\n/
/** The spec allows "data:" glued or with a space; we accept both forms. */
const DATA_PREFIX = /^data:[ \t]?/

/** Delivers, one at a time, the raw JSON of each event (already without "data: " or [DONE]). */
export async function* readSSEEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // Guarantees the connection closes even if the consumer abandons the `for await` halfway.
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break

      // { stream: true }: a multi-byte character split across reads is buffered, not corrupted.
      buffer += decoder.decode(value, { stream: true })

      const { complete, partial } = splitEvents(buffer)
      buffer = partial

      for (const block of complete) {
        const data = extractData(block)
        if (data === null) continue
        if (data === '[DONE]') return
        yield data
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

/** The last chunk after splitting on the separator is always the incomplete one - a complete final event would leave an empty trailing chunk instead. */
function splitEvents(buffer: string): { complete: string[]; partial: string } {
  const chunks = buffer.split(EVENT_SEPARATOR)
  const partial = chunks.pop() ?? ''
  return { complete: chunks, partial }
}

/** Multiple "data:" lines in one event are joined with a newline (SSE spec; OpenAI doesn't use it, but it's free). Null if the block has no data line (e.g. a ":keep-alive" comment). */
function extractData(block: string): string | null {
  const lines = block
    .split(LINE_SEPARATOR)
    .filter((line) => DATA_PREFIX.test(line))
    .map((line) => line.replace(DATA_PREFIX, ''))

  return lines.length > 0 ? lines.join('\n').trim() : null
}
