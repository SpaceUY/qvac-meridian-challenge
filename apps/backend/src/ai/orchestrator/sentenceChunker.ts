/**
 * A sentence end: ".", "!" or "?" with whitespace already after it. The
 * buffer's last character never counts - while the answer is still
 * streaming, "3." may be about to become "3.1%". A number opening a line
 * ("\n2. Next step") is a list marker, not a sentence end - matched on
 * the "\n" itself, since after a cut the buffer starts mid-line.
 */
const SENTENCE_END_RE = /(?<!\n[ \t]*\d+)[.!?]+(?=\s)/g;
/** The last row of a Markdown table: a "|" line, its line break, and a next line that is blank or isn't a row. */
const TABLE_END_RE = /^[ \t]*\|.*\n(?=[ \t]*(?:\n|[^|\s]))/gm;
const TABLE_ROW_START_RE = /^[ \t]*\|/;

/** Whether `index` sits on a line that is a Markdown table row. */
function isInTableRow(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  return TABLE_ROW_START_RE.test(text.slice(lineStart, index + 1));
}

/** End offset of the first match of `pattern` in `text` that `accept` takes - `undefined` if none. */
function firstAcceptedEnd(pattern: RegExp, text: string, accept: (start: number, end: number) => boolean): number | undefined {
  const scanner = new RegExp(pattern.source, pattern.flags); // own lastIndex: no state shared between calls
  for (let match = scanner.exec(text); match; match = scanner.exec(text)) {
    const end = match.index + match[0].length;
    if (accept(match.index, end)) return end;
  }
  return undefined;
}

/**
 * Buffers streamed text deltas and emits complete sentences once the
 * buffer has grown to at least `minChunkChars` - short leading sentences
 * are bundled together into one chunk rather than each becoming its own
 * (expensive) TTS call. Sentence detection is a simple punctuation regex,
 * not NLP - it won't handle abbreviations ("Mr. Smith") perfectly, which
 * is an acceptable trade-off for grounded assistant prose. A Markdown
 * table is never cut: it goes out whole, ending its chunk.
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

    for (let cut = this.findCut(); cut !== undefined; cut = this.findCut()) {
      sentences.push(this.buffer.slice(0, cut));
      this.buffer = this.buffer.slice(cut);
    }

    return sentences;
  }

  /** Returns whatever text is left buffered, verbatim, clearing it - `undefined` if nothing remains. */
  flush(): string | undefined {
    const remainder = this.buffer;
    this.buffer = "";
    return remainder.length > 0 ? remainder : undefined;
  }

  /** The earliest place a chunk of at least `minChunkChars` may end: a sentence end outside any table, or a table's end. */
  private findCut(): number | undefined {
    if (this.buffer.length < this.minChunkChars) return undefined;
    const longEnough = (end: number) => end >= this.minChunkChars;
    const cuts = [
      firstAcceptedEnd(SENTENCE_END_RE, this.buffer, (start, end) => longEnough(end) && !isInTableRow(this.buffer, start)),
      firstAcceptedEnd(TABLE_END_RE, this.buffer, (_start, end) => longEnough(end)),
    ].filter((cut): cut is number => cut !== undefined);
    return cuts.length > 0 ? Math.min(...cuts) : undefined;
  }
}
