import { QWEN3_600M_INST_Q4 } from "@qvac/sdk";
import type { ModelSource } from "../models/domain/types.js";

export interface ResourceThresholds {
  minRamGB: number;
  minCpuCores: number;
}

/** A machine is considered low-resource if it falls below either threshold. */
export const RESOURCE_THRESHOLDS: ResourceThresholds = {
  minRamGB: 8,
  minCpuCores: 4,
};

export interface AgentModelConfig {
  modelSource: ModelSource;
  temperature?: number;
  ctxSize?: number;
}

/** Small quantized model for machines below the resource thresholds. */
export const LOW_RESOURCE_MODEL: AgentModelConfig = {
  modelSource: {
    kind: "registry",
    registryPath: QWEN3_600M_INST_Q4.registryPath,
    registrySource: QWEN3_600M_INST_Q4.registrySource,
  },
  // 0.7 being too high for a 600M/Q4 quantized model to reliably follow the strict tool-call format.
  temperature: 0,
  // Default ctxSize (4096) is too small to fit the full corpus context alongside the system prompt and reply.
  ctxSize: 16384,
};

/** Larger model for machines meeting the resource thresholds. */
export const HIGH_RESOURCE_MODEL: AgentModelConfig = {
  modelSource: {
    kind: "registry",
    registryPath: QWEN3_600M_INST_Q4.registryPath,
    registrySource: QWEN3_600M_INST_Q4.registrySource,
  },
  ctxSize: 16384,
};
