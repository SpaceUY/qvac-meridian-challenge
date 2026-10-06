import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountProfiler, PROFILER_ROUTE } from './mountProfiler.js';
import type { ProfilerPort } from './domain/ports.js';

describe('mountProfiler', () => {
  let server: http.Server | undefined;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    server?.close();
    server = undefined;
    vi.restoreAllMocks();
  });

  function fakeProfiler(): ProfilerPort {
    return {
      enable: vi.fn(),
      reset: vi.fn(),
      getSnapshot: vi.fn(() => ({ enabled: true, mode: 'summary' as const, exportedAt: 1, operations: {} })),
    };
  }

  async function get(app: express.Express, path: string): Promise<number> {
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    return (await fetch(`http://127.0.0.1:${port}${path}`)).status;
  }

  it('with no options (QVAC_PROFILER unset): never creates the profiler and mounts no route - 404', async () => {
    const app = express();
    const createProfiler = vi.fn(fakeProfiler);

    expect(mountProfiler(app, undefined, createProfiler)).toBeUndefined();
    expect(createProfiler).not.toHaveBeenCalled();
    expect(await get(app, PROFILER_ROUTE)).toBe(404);
  });

  it('with options: enables the profiler with them and serves the export route', async () => {
    const app = express();
    const profiler = fakeProfiler();

    expect(mountProfiler(app, { mode: 'verbose' }, () => profiler)).toBe(profiler);
    expect(profiler.enable).toHaveBeenCalledWith({ mode: 'verbose' });
    expect(await get(app, PROFILER_ROUTE)).toBe(200);
  });

  it('enables the profiler synchronously, before returning - so model loads started right after it are captured', () => {
    const order: string[] = [];
    const profiler = { ...fakeProfiler(), enable: vi.fn(() => order.push('enable')) };

    mountProfiler(express(), { mode: 'summary' }, () => profiler);
    order.push('next statement in server.ts');

    expect(order).toEqual(['enable', 'next statement in server.ts']);
  });

  it('mounts under /api/debug/profiler', () => {
    expect(PROFILER_ROUTE).toBe('/api/debug/profiler');
  });
});
