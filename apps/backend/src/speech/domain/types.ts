/** Only `infra/qvacTranscriptionAdapter.ts` may import `@qvac/sdk` (same boundary as `models/domain`). */

export type AudioInput = { kind: 'filePath'; path: string } | { kind: 'buffer'; data: Buffer };

export interface TranscribeOptions {
  prompt?: string;
}

export interface TranscriptionResult {
  text: string;
}

/** Hands-free flow: push audio via `write()`/`end()`, await `text` for the full transcript. */
export interface StreamTranscriptSession {
  write(chunk: Uint8Array): void;
  end(): void;
  /** Call once `text` resolves, even on the happy path - the SDK can abort mid-teardown if the model unloads while this RPC handle is still open. */
  destroy(): void;
  text: Promise<string>;
}
