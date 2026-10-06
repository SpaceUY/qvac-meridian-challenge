import { profiler, type ProfilerExport } from '@qvac/sdk';
import type { ProfilerPort } from '../domain/ports.js';
import { unitForMetric } from '../domain/metricUnits.js';
import type { OperationStats, ProfilerEvent, ProfilerOptions, ProfilerSnapshot, SnapshotOptions } from '../domain/types.js';

/** Only file in this feature that imports @qvac/sdk. */
export class QvacProfilerAdapter implements ProfilerPort {
  enable(options: ProfilerOptions): void {
    profiler.enable(options);
  }

  getSnapshot(options: SnapshotOptions = {}): ProfilerSnapshot {
    const includeRecentEvents = options.includeRecentEvents === true;
    const { config, aggregates, exportedAt, recentEvents } = profiler.exportJSON({ includeRecentEvents });
    return {
      enabled: config.enabled,
      mode: config.mode,
      exportedAt,
      operations: mapOperations(aggregates),
      ...(includeRecentEvents ? { recentEvents: (recentEvents ?? []).map(toProfilerEvent) } : {}),
    };
  }

  reset(): void {
    profiler.clear();
  }
}

function mapOperations(aggregates: ProfilerExport['aggregates']): Record<string, OperationStats> {
  return Object.fromEntries(
    Object.entries(aggregates).map(([operation, stats]) => [
      operation,
      {
        unit: unitForMetric(operation),
        count: stats.count,
        min: stats.min,
        max: stats.max,
        avg: stats.avg,
        total: stats.sum,
        last: stats.last,
      },
    ]),
  );
}

/** Drops the SDK's resource/backend diagnostics: this export is about timings, and nothing downstream reads those. */
function toProfilerEvent(event: NonNullable<ProfilerExport['recentEvents']>[number]): ProfilerEvent {
  return {
    ts: event.ts,
    op: event.op,
    kind: event.kind,
    ...(event.profileId !== undefined ? { profileId: event.profileId } : {}),
    ...(event.phase !== undefined ? { phase: event.phase } : {}),
    ...(event.ms !== undefined ? { ms: event.ms } : {}),
    ...(event.gauges !== undefined ? { gauges: event.gauges } : {}),
    ...(event.tags !== undefined ? { tags: event.tags } : {}),
  };
}
