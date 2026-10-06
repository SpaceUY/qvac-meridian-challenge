import { describe, expect, it } from 'vitest';
import { readSseData, timeCompletionStream, timeVoiceStream } from './sseStream.js';

const encoder = new TextEncoder();

/** Yields each string as one network chunk - so tests control where chunk boundaries fall. */
async function* chunks(...parts: string[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield encoder.encode(part);
}

/** A clock that advances `step` ms per call, so each delta is "received" at a distinct, predictable time. */
function steppingClock(step: number): () => number {
  let t = 0;
  return () => (t += step);
}

const chunk = (delta: Record<string, unknown>) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;

describe('readSseData', () => {
  it('yields each event\'s data payload, [DONE] included', async () => {
    const out: string[] = [];
    for await (const data of readSseData(chunks('data: {"a":1}\n\ndata: [DONE]\n\n'))) out.push(data);

    expect(out).toEqual(['{"a":1}', '[DONE]']);
  });

  it('reassembles an event split across network chunks', async () => {
    const out: string[] = [];
    for await (const data of readSseData(chunks('data: {"a"', ':1}\n', '\n'))) out.push(data);

    expect(out).toEqual(['{"a":1}']);
  });

  it('reassembles a multi-byte character split across chunks', async () => {
    const bytes = encoder.encode('data: "¿qué?"\n\n');
    async function* split(): AsyncGenerator<Uint8Array> {
      yield bytes.slice(0, 8); // cuts "¿" (2 bytes in UTF-8) in half
      yield bytes.slice(8);
    }
    const out: string[] = [];
    for await (const data of readSseData(split())) out.push(data);

    expect(out).toEqual(['"¿qué?"']);
  });

  it('ignores comment/keep-alive lines and events with no data', async () => {
    const out: string[] = [];
    for await (const data of readSseData(chunks(': keep-alive\n\nevent: ping\n\ndata: x\n\n'))) out.push(data);

    expect(out).toEqual(['x']);
  });
});

describe('timeCompletionStream', () => {
  it('measures first content and total from the injected start, and collects text, tools and citations', async () => {
    const body = chunks(
      chunk({ role: 'assistant' }),
      chunk({ content: 'Hello' }),
      chunk({ content: ' world' }),
      chunk({ tools: ['list_documents'] }),
      chunk({ citations: [{ file: 'a.md', score: 0.9 }, { file: 'b.md', score: 0.8 }] }),
      'data: [DONE]\n\n',
    );

    const timed = await timeCompletionStream(body, 0, steppingClock(10));

    expect(timed).toEqual({ firstContentMs: 10, totalMs: 20, text: 'Hello world', tools: ['list_documents'], citations: ['a.md', 'b.md'] });
  });

  it('does not count the role chunk or an empty content delta as the first visible token', async () => {
    const body = chunks(chunk({ role: 'assistant' }), chunk({ content: '' }), chunk({ content: 'Hi' }), 'data: [DONE]\n\n');
    let calls = 0;

    const timed = await timeCompletionStream(body, 0, () => (calls += 1) * 100);

    expect(timed.firstContentMs).toBe(100); // only "Hi" read the clock before the end
    expect(timed.text).toBe('Hi');
  });

  it('falls back to totalMs as first content when no content ever arrives', async () => {
    const timed = await timeCompletionStream(chunks(chunk({ role: 'assistant' }), 'data: [DONE]\n\n'), 0, () => 42);

    expect(timed).toMatchObject({ firstContentMs: 42, totalMs: 42, text: '', tools: [], citations: [] });
  });

  it('stops at [DONE] even if the server keeps the connection open', async () => {
    const timed = await timeCompletionStream(chunks(chunk({ content: 'a' }), 'data: [DONE]\n\n', chunk({ content: 'ignored' })), 0, () => 1);

    expect(timed.text).toBe('a');
  });
});

describe('timeVoiceStream', () => {
  const voice = (event: Record<string, unknown>) => `data: ${JSON.stringify(event)}\n\n`;

  it('measures time to the first sentence WITH audio, and collects transcript and answer', async () => {
    const body = chunks(
      voice({ type: 'audio', text: 'Four hours.', audioBase64: 'AAA=', sampleRate: 24000 }),
      voice({ type: 'audio', text: ' Per the SLA.', audioBase64: 'BBB=', sampleRate: 24000 }),
      voice({ type: 'done', transcript: 'What is the P1 SLA?', tools: [], citations: [] }),
      'data: [DONE]\n\n',
    );

    const timed = await timeVoiceStream(body, 0, steppingClock(5));

    expect(timed).toEqual({ firstAudioMs: 5, totalMs: 10, transcript: 'What is the P1 SLA?', answer: 'Four hours. Per the SLA.', audioChunks: 2 });
  });

  it('skips a sentence whose synthesis failed (text but no audio) when timing the first audio', async () => {
    const body = chunks(voice({ type: 'audio', text: 'a' }), voice({ type: 'audio', text: 'b', audioBase64: 'AAA=' }), 'data: [DONE]\n\n');

    const timed = await timeVoiceStream(body, 0, steppingClock(5));

    expect(timed.firstAudioMs).toBe(5);
    expect(timed.audioChunks).toBe(1);
    expect(timed.answer).toBe('ab');
  });

  it('reports the error event of a failed turn', async () => {
    const timed = await timeVoiceStream(chunks(voice({ type: 'error', error: 'Could not hear anything' }), 'data: [DONE]\n\n'), 0, () => 7);

    expect(timed).toMatchObject({ error: 'Could not hear anything', audioChunks: 0, firstAudioMs: 7 });
  });
});
