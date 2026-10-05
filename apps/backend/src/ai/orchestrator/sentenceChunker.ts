const SENTENCE_END_RE = /[.!?]+(?=\s|$)/;

/** Buffers streamed deltas and emits complete sentences once the buffer reaches `minChunkChars`, batching short leading sentences into one TTS call. Punctuation-regex detection, not NLP — doesn't handle abbreviations ("Mr. Smith") perfectly. */
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
