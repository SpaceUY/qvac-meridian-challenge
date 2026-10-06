import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProfilerRouter } from './profiler.router.js';
import type { ProfilerPort } from '../domain/ports.js';
import type { ProfilerSnapshot } from '../domain/types.js';

const SNAPSHOT: ProfilerSnapshot = {
  enabled: true,
  mode: 'summary',
  exportedAt: 1234,
  operations: { loadModel: { unit: 'ms', count: 1, min: 5, max: 5, avg: 5, total: 5, last: 5 } },
};

describe('profiler router', () => {
  let server: http.Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  function fakeProfiler(overrides: Partial<ProfilerPort> = {}): Pick<ProfilerPort, 'getSnapshot' | 'reset'> {
    return { getSnapshot: vi.fn(() => SNAPSHOT), reset: vi.fn(), ...overrides };
  }

  async function listen(profiler: Pick<ProfilerPort, 'getSnapshot' | 'reset'>): Promise<string> {
    const app = express();
    app.use('/api/debug/profiler', createProfilerRouter(profiler));
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/api/debug/profiler`;
  }

  describe('GET /', () => {
    it('returns the profiler snapshot as JSON', async () => {
      const response = await fetch(await listen(fakeProfiler()));

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/^application\/json/);
      expect(await response.json()).toEqual(SNAPSHOT);
    });

    it('does not request recent events by default', async () => {
      const profiler = fakeProfiler();
      await fetch(await listen(profiler));

      expect(profiler.getSnapshot).toHaveBeenCalledWith({ includeRecentEvents: false });
    });

    it('requests recent events with ?events=true', async () => {
      const profiler = fakeProfiler();
      await fetch(`${await listen(profiler)}?events=true`);

      expect(profiler.getSnapshot).toHaveBeenCalledWith({ includeRecentEvents: true });
    });

    it('treats any other ?events value as false', async () => {
      const profiler = fakeProfiler();
      await fetch(`${await listen(profiler)}?events=1`);

      expect(profiler.getSnapshot).toHaveBeenCalledWith({ includeRecentEvents: false });
    });

    it('calls getSnapshot() fresh on every request, not a cached value', async () => {
      let calls = 0;
      const url = await listen(
        fakeProfiler({
          getSnapshot: () => {
            calls += 1;
            return { ...SNAPSHOT, exportedAt: calls };
          },
        }),
      );

      const first = (await (await fetch(url)).json()) as ProfilerSnapshot;
      const second = (await (await fetch(url)).json()) as ProfilerSnapshot;

      expect(first.exportedAt).toBe(1);
      expect(second.exportedAt).toBe(2);
    });

    it('answers 500 instead of crashing the server when getSnapshot() throws', async () => {
      const url = await listen(
        fakeProfiler({
          getSnapshot: () => {
            throw new Error('profiler export failed');
          },
        }),
      );

      expect((await fetch(url)).status).toBe(500);
    });
  });

  describe('POST /reset', () => {
    it('clears the profiler and answers 204 with no body', async () => {
      const profiler = fakeProfiler();
      const response = await fetch(`${await listen(profiler)}/reset`, { method: 'POST' });

      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
      expect(profiler.reset).toHaveBeenCalledOnce();
    });

    it('is not reachable with GET - a read never clears data', async () => {
      const profiler = fakeProfiler();
      const response = await fetch(`${await listen(profiler)}/reset`);

      expect(response.status).toBe(404);
      expect(profiler.reset).not.toHaveBeenCalled();
    });
  });
});
