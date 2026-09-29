import { describe, expect, it, vi } from 'vitest';
import type { SdkStreamSession } from './streamSession.js';
import { wrapStreamSession } from './streamSession.js';

function fakeSession(chunks: string[]) {
  return {
    write: vi.fn<(chunk: Uint8Array) => void>(),
    end: vi.fn<() => void>(),
    destroy: vi.fn<() => void>(),
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    }
  } satisfies SdkStreamSession;
}

describe('wrapStreamSession', () => {
  it('concatenates yielded text chunks into the final text', async () => {
    const session = fakeSession(['Hello', ', ', 'world']);

    const wrapped = wrapStreamSession(session);

    await expect(wrapped.text).resolves.toBe('Hello, world');
  });

  it('resolves to an empty string when no chunks are yielded', async () => {
    const wrapped = wrapStreamSession(fakeSession([]));

    await expect(wrapped.text).resolves.toBe('');
  });

  it('forwards write() calls to the underlying session', () => {
    const session = fakeSession([]);
    const wrapped = wrapStreamSession(session);
    const chunk = new Uint8Array([1, 2, 3]);

    wrapped.write(chunk);

    expect(session.write).toHaveBeenCalledWith(chunk);
  });

  it('forwards end() calls to the underlying session', () => {
    const session = fakeSession([]);
    const wrapped = wrapStreamSession(session);

    wrapped.end();

    expect(session.end).toHaveBeenCalled();
  });

  it('forwards destroy() calls to the underlying session', () => {
    const session = fakeSession([]);
    const wrapped = wrapStreamSession(session);

    wrapped.destroy();

    expect(session.destroy).toHaveBeenCalled();
  });
});
