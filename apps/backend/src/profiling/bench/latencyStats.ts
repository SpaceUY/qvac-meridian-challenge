export interface LatencySummary {
  n: number;
  min: number;
  p50: number;
  p90: number;
  max: number;
  mean: number;
}

/** Nearest-rank percentile (no interpolation): always a value that was actually measured, which is the honest choice for a dozen samples. */
export function percentile(sortedValues: readonly number[], p: number): number {
  if (sortedValues.length === 0) throw new Error('percentile() of an empty list');
  if (p < 0 || p > 100) throw new Error(`percentile must be within 0-100, got ${p}`);
  const rank = Math.max(1, Math.ceil((p / 100) * sortedValues.length));
  return sortedValues[rank - 1]!;
}

export function summarizeLatencies(values: readonly number[]): LatencySummary {
  if (values.length === 0) throw new Error('summarizeLatencies() of an empty list');
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted[0]!,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    max: sorted[sorted.length - 1]!,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}
