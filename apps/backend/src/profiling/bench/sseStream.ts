/** Splits a `text/event-stream` body into its `data:` payloads, as they arrive - `[DONE]` included, so the caller decides what ends the stream. */
export async function* readSseData(body: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const event = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data) yield data;
    }
  }
}

export interface TimedCompletion {
  /** Time to the first visible answer token - what the user waits before anything appears. */
  firstContentMs: number;
  totalMs: number;
  text: string;
  tools: string[];
  citations: string[];
}

/**
 * Reads one `/v1/chat/completions` stream (OpenAI chunk shape plus this API's
 * additive `tools`/`citations` deltas). `startedAt`/`now` are injected so a
 * test can drive the clock; firstContentMs falls back to totalMs when the
 * answer arrives in no content chunk at all.
 */
export async function timeCompletionStream(
  body: AsyncIterable<Uint8Array>,
  startedAt: number,
  now: () => number = () => performance.now(),
): Promise<TimedCompletion> {
  let firstContentMs: number | undefined;
  let text = '';
  let tools: string[] = [];
  let citations: string[] = [];

  for await (const data of readSseData(body)) {
    if (data === '[DONE]') break;
    const delta = (JSON.parse(data) as { choices?: { delta?: Record<string, unknown> }[] }).choices?.[0]?.delta ?? {};
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      firstContentMs ??= now() - startedAt;
      text += delta.content;
    }
    if (Array.isArray(delta.tools)) tools = delta.tools as string[];
    if (Array.isArray(delta.citations)) citations = (delta.citations as { file: string }[]).map((c) => c.file);
  }

  const totalMs = now() - startedAt;
  return { firstContentMs: firstContentMs ?? totalMs, totalMs, text: text.trim(), tools, citations };
}

export interface TimedVoiceTurn {
  /** Time to the first synthesized sentence with audio - when the user starts hearing the answer. */
  firstAudioMs: number;
  totalMs: number;
  transcript: string;
  answer: string;
  audioChunks: number;
  error?: string;
}

/** Reads one `/v1/chat/voice-completions` stream (`stream: true`): `audio` events per sentence, then `done` or `error`. */
export async function timeVoiceStream(
  body: AsyncIterable<Uint8Array>,
  startedAt: number,
  now: () => number = () => performance.now(),
): Promise<TimedVoiceTurn> {
  let firstAudioMs: number | undefined;
  let answer = '';
  let transcript = '';
  let audioChunks = 0;
  let error: string | undefined;

  for await (const data of readSseData(body)) {
    if (data === '[DONE]') break;
    const event = JSON.parse(data) as { type?: string; text?: string; audioBase64?: string; transcript?: string; error?: string };
    if (event.type === 'audio') {
      if (event.audioBase64) {
        firstAudioMs ??= now() - startedAt;
        audioChunks += 1;
      }
      answer += event.text ?? '';
    } else if (event.type === 'done') {
      transcript = event.transcript ?? '';
    } else if (event.type === 'error') {
      error = event.error ?? 'unknown error';
    }
  }

  const totalMs = now() - startedAt;
  return {
    firstAudioMs: firstAudioMs ?? totalMs,
    totalMs,
    transcript,
    answer: answer.trim(),
    audioChunks,
    ...(error !== undefined ? { error } : {}),
  };
}
