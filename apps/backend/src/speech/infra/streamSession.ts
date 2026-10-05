import type { StreamTranscriptSession } from '../domain/types.js';

/** Minimal shape of the SDK's `TranscribeStreamSession`, so tests can fake it without importing `@qvac/sdk`. */
export interface SdkStreamSession {
  write(chunk: Uint8Array): void;
  end(): void;
  destroy(): void;
  [Symbol.asyncIterator](): AsyncIterator<string>;
}

export function wrapStreamSession(session: SdkStreamSession): StreamTranscriptSession {
  return {
    write: (chunk) => session.write(chunk),
    end: () => session.end(),
    destroy: () => session.destroy(),
    text: accumulateText(session)
  };
}

async function accumulateText(session: SdkStreamSession): Promise<string> {
  let full = '';
  for await (const piece of session) {
    full += piece;
  }
  return full;
}
