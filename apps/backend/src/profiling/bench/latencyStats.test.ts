import { describe, expect, it } from 'vitest';
import { percentile, summarizeLatencies } from './latencyStats.js';

describe('percentile (nearest rank)', () => {
  const tenValues = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it.each([
    [50, 5],
    [90, 9],
    [100, 10],
    [0, 1],
    [1, 1],
  ])('p%s of 1..10 is %s', (p, expected) => {
    expect(percentile(tenValues, p)).toBe(expected);
  });

  it('always returns a measured value, never an interpolated one', () => {
    expect(percentile([100, 200], 50)).toBe(100);
  });

  it('throws on an empty list or an out-of-range percentile', () => {
    expect(() => percentile([], 50)).toThrow(/empty/);
    expect(() => percentile([1], 101)).toThrow(/0-100/);
    expect(() => percentile([1], -1)).toThrow(/0-100/);
  });
});

describe('summarizeLatencies', () => {
  it('summarizes unsorted input without mutating it', () => {
    const values = [300, 100, 200];

    expect(summarizeLatencies(values)).toEqual({ n: 3, min: 100, p50: 200, p90: 300, max: 300, mean: 200 });
    expect(values).toEqual([300, 100, 200]);
  });

  it('handles a single sample', () => {
    expect(summarizeLatencies([42])).toEqual({ n: 1, min: 42, p50: 42, p90: 42, max: 42, mean: 42 });
  });

  it('throws on an empty list', () => {
    expect(() => summarizeLatencies([])).toThrow(/empty/);
  });
});
