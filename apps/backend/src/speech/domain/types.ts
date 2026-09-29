/**
 * SDK-agnostic domain types for local speech-to-text. Nothing here may
 * import `@qvac/sdk` - only `infra/qvacTranscriptionAdapter.ts` is allowed
 * to import the SDK, mirroring the same boundary `models/domain` uses.
 */

/** Audio to transcribe via `transcribe()` (prerecorded). Streaming audio is pushed separately via `StreamTranscriptSession.write()`. */
export type AudioInput = { kind: 'filePath'; path: string } | { kind: 'buffer'; data: Buffer };

export interface TranscribeOptions {
  /** Optional initial prompt to guide the transcription (the SDK's own `prompt` field). */
  prompt?: string;
}

export interface TranscriptionResult {
  text: string;
}

/**
 * A live, bidirectional transcription session: push audio in via `write()`,
 * end the audio with `end()`, and await `text` for the full concatenated
 * transcript once the session completes. This is the "hands-free" shape -
 * audio doesn't need to be fully available upfront.
 */
export interface StreamTranscriptSession {
  write(chunk: Uint8Array): void;
  end(): void;
  /** Releases the underlying connection. Call once `text` has been read, even on the happy path - the SDK can otherwise abort mid-teardown if the model is unloaded while this session's RPC handle is still open. */
  destroy(): void;
  /** Resolves once the underlying session's stream completes, with the full concatenated transcript text. */
  text: Promise<string>;
}
