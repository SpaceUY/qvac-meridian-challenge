/** Minimum buffered chars before `SentenceChunker` cuts a TTS chunk - bundles short sentences ("Ok." "Sure.") instead of synthesizing each separately. */
export const DEFAULT_MIN_SENTENCE_CHUNK_CHARS = 40;
