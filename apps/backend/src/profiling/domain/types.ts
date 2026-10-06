export type ProfilerMode = 'summary' | 'verbose';

export interface ProfilerOptions {
  mode: ProfilerMode;
  /** Also record the worker-side phases of each request (`server.handlerExecution`, `server.totalServerTime`, `clientOverhead`). */
  includeServerBreakdown?: boolean;
}

/** Not every aggregate is a duration: the SDK also aggregates gauges like `tokensPerSecond` or `cacheTokens` under the same map - see metricUnits.ts. */
export type MetricUnit = 'ms' | 'tokens/s' | 'tokens' | 'ratio' | 'count' | 'samples' | 'bytes' | 'bytes/s' | 'unknown';

export interface OperationStats {
  unit: MetricUnit;
  count: number;
  min: number;
  max: number;
  avg: number;
  total: number;
  last: number;
}

/** One raw profiler record - only kept by the SDK in `verbose` mode (ring buffer, oldest first). */
export interface ProfilerEvent {
  ts: number;
  op: string;
  kind: string;
  profileId?: string;
  phase?: string;
  ms?: number;
  gauges?: Record<string, number>;
  tags?: Record<string, string>;
}

/** `operations` is keyed by the SDK's own operation names (`loadModel`, `completionStream.modelExecutionTime`, ...) - not enumerated here on purpose: they depend on what the process actually ran. */
export interface ProfilerSnapshot {
  enabled: boolean;
  mode: ProfilerMode;
  exportedAt: number;
  operations: Record<string, OperationStats>;
  recentEvents?: ProfilerEvent[];
}

export interface SnapshotOptions {
  includeRecentEvents?: boolean;
}
