import * as os from 'node:os';

export type ResourceTier = 'low' | 'medium' | 'high';

export interface ResourceThresholds {
  minRamGB: number;
  minCpuCores: number;
}

const BYTES_PER_GB = 1024 ** 3;

/** A machine qualifies for a tier only once it clears both its RAM and CPU-core floor. */
export const RESOURCE_TIER_THRESHOLDS: Record<'medium' | 'high', ResourceThresholds> = {
  medium: { minRamGB: 16, minCpuCores: 8 },
  high: { minRamGB: 64, minCpuCores: 16 },
};

const VALID_TIERS: readonly ResourceTier[] = ['low', 'medium', 'high'];

function isResourceTier(value: string | undefined): value is ResourceTier {
  return VALID_TIERS.includes(value as ResourceTier);
}

interface MachineResources {
  totalMemBytes: number;
  cpuCores: number;
}

function defaultResources(): MachineResources {
  return { totalMemBytes: os.totalmem(), cpuCores: os.cpus().length };
}

/**
 * `resources`/`env` are parameters, not a direct `os`/`process.env` read,
 * so this is testable without module-reset tricks. `QVAC_RESOURCE_TIER`
 * overrides the RAM/CPU heuristic since it can't see actual GPU VRAM.
 */
export function resolveResourceTier(
  resources: MachineResources = defaultResources(),
  env: NodeJS.ProcessEnv = process.env,
): ResourceTier {
  if (env.QVAC_RESOURCE_TIER !== undefined) {
    if (isResourceTier(env.QVAC_RESOURCE_TIER)) return env.QVAC_RESOURCE_TIER;
    console.warn(
      `[resourceTier] QVAC_RESOURCE_TIER must be one of ${VALID_TIERS.join('/')} - ignoring invalid value "${env.QVAC_RESOURCE_TIER}"; falling back to the automatic heuristic.`,
    );
  }

  const ramGB = resources.totalMemBytes / BYTES_PER_GB;
  const { cpuCores } = resources;

  if (ramGB >= RESOURCE_TIER_THRESHOLDS.high.minRamGB && cpuCores >= RESOURCE_TIER_THRESHOLDS.high.minCpuCores) {
    return 'high';
  }
  if (ramGB >= RESOURCE_TIER_THRESHOLDS.medium.minRamGB && cpuCores >= RESOURCE_TIER_THRESHOLDS.medium.minCpuCores) {
    return 'medium';
  }
  return 'low';
}

/** Resolved once so every tiered consumer (chat, TTS, STT) agrees on the same tier for the process lifetime. */
export const RESOURCE_TIER: ResourceTier = resolveResourceTier();
