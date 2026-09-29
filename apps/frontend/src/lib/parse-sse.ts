// Reads a stream of Server-Sent Events (the format OpenAI uses and therefore
// also LM Studio and, later, our own API).
//
// The format sends "events" separated by a blank line:
//   data: {"choices":[{"delta":{"content":"Hello"}}]}
//
//   data: {"choices":[{"delta":{"content":" world"}}]}
//
//   data: [DONE]
//
// The real problem: the browser delivers the body in byte chunks that do NOT
// respect these boundaries. One event can arrive split across two reads, or
// two events can arrive glued together in one. That's why a buffer is needed.

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

  // The try/finally is what guarantees the connection closes: it runs whether
  // we finish normally, something explodes, or whoever consumes us
  // abandons the `for await` halfway. Without it, the reader stays held
  // and the stream stays open.
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break

      // { stream: true } tells the decoder that more bytes can come:
      // if a character (a tilde, an emoji) was split across two reads,
      // it saves the half instead of spitting out a broken symbol.
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

/**
 * Separates the buffer into complete events and the rest that is still
 * partial. Answers just one question: WHERE does each event end. It does not
 * care what they say.
 *
 * The split trick: the last chunk is always the incomplete one, because if
 * it were complete there would be a separator after it and split would have
 * generated an empty chunk at the end.
 */
function splitEvents(buffer: string): { complete: string[]; partial: string } {
  const chunks = buffer.split(EVENT_SEPARATOR)
  const partial = chunks.pop() ?? ''
  return { complete: chunks, partial }
}

/**
 * Extracts the payload of an event. Answers the other question: WHAT does it say. It does not
 * care where it started or where it ended.
 *
 * The spec allows multiple "data:" lines in one event; they are concatenated with
 * a newline between them. OpenAI does not use it, but supporting it is free.
 * Returns null if the block had no data lines (for example a
 * ":keep-alive" comment, which some servers send to keep the
 * connection from dying from inactivity).
 */
function extractData(block: string): string | null {
  const lines = block
    .split(LINE_SEPARATOR)
    .filter((line) => DATA_PREFIX.test(line))
    .map((line) => line.replace(DATA_PREFIX, ''))

  return lines.length > 0 ? lines.join('\n').trim() : null
}
