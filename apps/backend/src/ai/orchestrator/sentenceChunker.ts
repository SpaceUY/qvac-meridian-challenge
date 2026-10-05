const SENTENCE_END_RE = /[.!?]+(?=\s|$)/;

/**
 * Buffers streamed text deltas and emits complete sentences once the
 * buffer has grown to at least `minChunkChars` - short leading sentences
 * are bundled together into one chunk rather than each becoming its own
 * (expensive) TTS call. Sentence detection is a simple punctuation regex,
 * not NLP - it won't handle abbreviations ("Mr. Smith") perfectly, which
 * is an acceptable trade-off for grounded assistant prose.
 *
 * Chunks come out verbatim: joined back together they reproduce the
 * streamed text exactly, whitespace included - the line breaks are what
 * separate Markdown paragraphs, headings and list items on screen. A
 * consumer that only needs the words (TTS) trims its own copy.
 */
export class SentenceChunker {
  private buffer = "";

  constructor(private readonly minChunkChars: number) {}

  /** Appends `delta` to the buffer and returns zero or more complete sentences it now allows cutting. */
  push(delta: string): string[] {
    this.buffer += delta;
    const sentences: string[] = [];

    while (this.buffer.length >= this.minChunkChars) {
      const searchStart = Math.max(0, this.minChunkChars - 1);
      const match = SENTENCE_END_RE.exec(this.buffer.slice(searchStart));
      if (!match) break;

      const cutIndex = searchStart + match.index + match[0].length;
      sentences.push(this.buffer.slice(0, cutIndex));
      this.buffer = this.buffer.slice(cutIndex);
    }

    return sentences;
  }

  /** Returns whatever text is left buffered, verbatim, clearing it - `undefined` if nothing remains. */
  flush(): string | undefined {
    const remainder = this.buffer;
    this.buffer = "";
    return remainder.length > 0 ? remainder : undefined;
  }
}
