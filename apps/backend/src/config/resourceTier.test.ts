import { describe, expect, it, vi } from 'vitest';
import { resolveResourceTier, RESOURCE_TIER_THRESHOLDS } from './resourceTier.js';

const BYTES_PER_GB = 1024 ** 3;
function gb(n: number): number {
  return n * BYTES_PER_GB;
}

describe('resolveResourceTier', () => {
  it('returns "low" for a machine below the medium RAM floor', () => {
    expect(resolveResourceTier({ totalMemBytes: gb(8), cpuCores: 4 }, {})).toBe('low');
  });

  it('returns "low" for a machine with enough RAM but too few CPU cores for medium', () => {
    expect(resolveResourceTier({ totalMemBytes: gb(32), cpuCores: 4 }, {})).toBe('low');
  });

  it('returns "medium" once both the RAM and CPU-core floors for medium are met', () => {
    expect(
      resolveResourceTier(
        {
          totalMemBytes: gb(RESOURCE_TIER_THRESHOLDS.medium.minRamGB),
          cpuCores: RESOURCE_TIER_THRESHOLDS.medium.minCpuCores,
        },
        {},
      ),
    ).toBe('medium');
  });

  it('returns "medium" for a machine that clears medium but not the high floor', () => {
    expect(resolveResourceTier({ totalMemBytes: gb(32), cpuCores: 12 }, {})).toBe('medium');
  });

  it('returns "high" once both the RAM and CPU-core floors for high are met', () => {
    expect(
      resolveResourceTier(
        {
          totalMemBytes: gb(RESOURCE_TIER_THRESHOLDS.high.minRamGB),
          cpuCores: RESOURCE_TIER_THRESHOLDS.high.minCpuCores,
        },
        {},
      ),
    ).toBe('high');
  });

  it('returns "medium" (not "high") for a machine with high RAM but too few CPU cores', () => {
    expect(resolveResourceTier({ totalMemBytes: gb(64), cpuCores: 8 }, {})).toBe('medium');
  });

  it('QVAC_RESOURCE_TIER overrides the heuristic to "low"', () => {
    expect(
      resolveResourceTier({ totalMemBytes: gb(128), cpuCores: 32 }, { QVAC_RESOURCE_TIER: 'low' }),
    ).toBe('low');
  });

  it('QVAC_RESOURCE_TIER overrides the heuristic to "medium"', () => {
    expect(
      resolveResourceTier({ totalMemBytes: gb(4), cpuCores: 2 }, { QVAC_RESOURCE_TIER: 'medium' }),
    ).toBe('medium');
  });

  it('QVAC_RESOURCE_TIER overrides the heuristic to "high"', () => {
    expect(
      resolveResourceTier({ totalMemBytes: gb(4), cpuCores: 2 }, { QVAC_RESOURCE_TIER: 'high' }),
    ).toBe('high');
  });

  it('treats an invalid QVAC_RESOURCE_TIER value as unset and falls back to the heuristic', () => {
    expect(
      resolveResourceTier({ totalMemBytes: gb(8), cpuCores: 4 }, { QVAC_RESOURCE_TIER: 'ultra' }),
    ).toBe('low');
  });

  it('warns once when QVAC_RESOURCE_TIER is set to an invalid value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    resolveResourceTier({ totalMemBytes: gb(8), cpuCores: 4 }, { QVAC_RESOURCE_TIER: 'ultra' });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('QVAC_RESOURCE_TIER');
    warn.mockRestore();
  });

  it('does not warn when QVAC_RESOURCE_TIER is unset', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    resolveResourceTier({ totalMemBytes: gb(8), cpuCores: 4 }, {});

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
