import type { ProfilerOptions, ProfilerSnapshot, SnapshotOptions } from './types.js';

/**
 * Deliberately 3 methods, not a full mirror of the SDK's profiler API (which
 * also has disable/isEnabled/onRecord/exportTable/...). server.ts calls
 * enable() once; the router calls getSnapshot() per request and reset()
 * between benchmark phases - nothing needs the rest.
 */
export interface ProfilerPort {
  enable(options: ProfilerOptions): void;
  getSnapshot(options?: SnapshotOptions): ProfilerSnapshot;
  reset(): void;
}
