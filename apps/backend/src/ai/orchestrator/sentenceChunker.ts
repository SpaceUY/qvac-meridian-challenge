const SENTENCE_END_RE = /[.!?]+(?=\s|$)/;

/**
 * Buffers streamed text deltas and emits complete sentences once the
 * buffer has grown to at least `minChunkChars` - short leading sentences
 * are bundled together into one chunk rather than each becoming its own
 * (expensive) TTS call. Sentence detection is a simple punctuation regex,
 * not NLP - it won't handle abbreviations ("Mr. Smith") perfectly, which
 * is an acceptable trade-off for grounded assistant prose.
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
      sentences.push(this.buffer.slice(0, cutIndex).trim());
      this.buffer = this.buffer.slice(cutIndex);
    }

    return sentences;
  }

  /** Returns whatever text is left buffered (trimmed), clearing it - `undefined` if nothing remains. */
  flush(): string | undefined {
    const remainder = this.buffer.trim();
    this.buffer = "";
    return remainder.length > 0 ? remainder : undefined;
  }
}
