/**
 * Minimum number of buffered characters `SentenceChunker` requires before
 * it will cut a streamed voice answer into a sentence chunk for TTS - see
 * `../ai/orchestrator/sentenceChunker.ts`. Bundles short leading sentences
 * ("Ok." "Sure.") together instead of synthesizing each one separately.
 */
export const DEFAULT_MIN_SENTENCE_CHUNK_CHARS = 40;
