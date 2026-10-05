import {
  MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K,
  MMPROJ_QWEN3_5_9B_MULTIMODAL_F16,
  MMPROJ_QWEN3_6_35B_A3B_MULTIMODAL_F16,
  QWEN3_600M_INST_Q4,
  QWEN3VL_2B_MULTIMODAL_Q4_K,
  QWEN3_5_9B_MULTIMODAL_Q4_K_M,
  QWEN3_6_35B_A3B_MULTIMODAL_Q4_K_M,
  TTS_MULTILINGUAL_SUPERTONIC2_Q4_0,
  TTS_MULTILINGUAL_SUPERTONIC3_Q4_0,
  VAD_SILERO_5_1_2,
  WHISPER_LARGE_V3_TURBO,
  WHISPER_SMALL_Q8_0,
  WHISPER_TINY_Q8_0,
} from "@qvac/sdk";
import type { ModelSource } from "../models/domain/types.js";
import type { ResourceTier } from "./resourceTier.js";

/** Builds a registry `ModelSource` from a `@qvac/sdk` catalog entry - dedupes the per-tier entries below. */
function toRegistrySource(
  entry: { registryPath: string; registrySource: string },
  modelType: string,
): ModelSource {
  return {
    kind: "registry",
    registryPath: entry.registryPath,
    registrySource: entry.registrySource,
    modelType,
  };
}

/** Applies `fn` to each tier of a per-tier catalog map, keeping the same tiers - lets WHISPER_MODELS_BY_TIER/WHISPER_MODEL_NAMES_BY_TIER (and their TTS counterparts) both derive from one tier->catalog-entry mapping instead of repeating it. */
function mapTiers<T, R>(
  byTier: Record<ResourceTier, T>,
  fn: (entry: T) => R,
): Record<ResourceTier, R> {
  return {
    low: fn(byTier.low),
    medium: fn(byTier.medium),
    high: fn(byTier.high),
  };
}

/** Single source of truth for every concrete model this backend uses, grouped by capability - pipelines import from here instead of hardcoding entries inline. LLM/STT/TTS are grouped into `*_BY_TIER` maps; embeddings stay untiered. */

/* =============================================================================
 * Text / LLM (completion) models
 * ========================================================================== */

/** Default engine used when a `ModelSource` doesn't specify one - the only inference engine the models feature targets. */
export const DEFAULT_MODEL_TYPE = "llamacpp-completion";

/** Same `ModelSource` `LLM_MODELS_BY_TIER`'s `low` entry below draws from, exposed separately for callers (e.g. `experiments/lora-spike/spike.ts`) that build their own `AgentModelConfig` with different temperature/ctxSize choices. */
export const QWEN3_600M_MODEL_SOURCE: ModelSource = {
  kind: "registry",
  registryPath: QWEN3_600M_INST_Q4.registryPath,
  registrySource: QWEN3_600M_INST_Q4.registrySource,
};

export interface AgentModelConfig {
  modelSource: ModelSource;
  temperature?: number;
  ctxSize?: number;
  /** Opaque per-engine load config merged into the SDK's modelConfig (e.g. a multimodal model's `projectionModelSrc`) - mirrors `LoadModelOptions.engineConfig` (`models/domain/types.ts`). */
  engineConfig?: Record<string, unknown>;
  /** Catalog name/quantization of `modelSource`, surfaced as-is (not re-derived) so callers (e.g. `AgentService.getStatus()`, the engine panel) can report which model is actually loaded. */
  modelName: string;
  quantization: string;
  /** Whether `chatComplete()` calls against this model use the SDK's KV cache. Defaults to enabled (`true`) when omitted - see `QvacChatSession`'s `kvCacheEnabled` option. */
  kvCacheEnabled?: boolean;
  /** Whether this model's KV cache is quantized via TurboQuant - see `TURBOQUANT_KV_CACHE_ENGINE_CONFIG`/`resolveEngineConfig` below. Defaults to disabled (`false`) when omitted. */
  kvCacheQuantEnabled?: boolean;
  /** Max concurrent `completion()` calls this tier admits (continuous batching, see I.2's spike/results doc); merged into `engineConfig.parallel` when >1, default 1. */
  maxConcurrency?: number;
}

/** TurboQuant KV-cache config, merged into `engineConfig` when `kvCacheQuantEnabled` is set. These type strings are undocumented in `@qvac/sdk` itself - confirmed against https://qvac.tether.io/blog/turboquant-in-qvac-sdk-0-12-0-kv-cache-quantization-for-production-local-ai */
export const TURBOQUANT_KV_CACHE_ENGINE_CONFIG: Record<string, string> = {
  "cache-type-k": "tbq4_0",
  "cache-type-v": "pq4_0",
};

/** The `engineConfig` a caller should hand to `ChatQVAC`/`loadModel()` - merges in `TURBOQUANT_KV_CACHE_ENGINE_CONFIG` when `kvCacheQuantEnabled` is set. The one place this merge happens. */
export function resolveEngineConfig(
  config: AgentModelConfig,
): Record<string, unknown> | undefined {
  const kvCacheConfig = config.kvCacheQuantEnabled
    ? TURBOQUANT_KV_CACHE_ENGINE_CONFIG
    : undefined;
  const parallelConfig =
    config.maxConcurrency && config.maxConcurrency > 1
      ? { parallel: config.maxConcurrency }
      : undefined;
  if (!kvCacheConfig && !parallelConfig) return config.engineConfig;
  return { ...config.engineConfig, ...kvCacheConfig, ...parallelConfig };
}

const QWEN3VL_2B_MODEL_SOURCE: ModelSource = {
  kind: "registry",
  registryPath: QWEN3VL_2B_MULTIMODAL_Q4_K.registryPath,
  registrySource: QWEN3VL_2B_MULTIMODAL_Q4_K.registrySource,
};

const QWEN3_5_9B_MODEL_SOURCE: ModelSource = {
  kind: "registry",
  registryPath: QWEN3_5_9B_MULTIMODAL_Q4_K_M.registryPath,
  registrySource: QWEN3_5_9B_MULTIMODAL_Q4_K_M.registrySource,
};

const QWEN3_6_35B_A3B_MODEL_SOURCE: ModelSource = {
  kind: "registry",
  registryPath: QWEN3_6_35B_A3B_MULTIMODAL_Q4_K_M.registryPath,
  registrySource: QWEN3_6_35B_A3B_MULTIMODAL_Q4_K_M.registrySource,
};

/** Chat/VLM model per tier. `medium`/`high` projectors are only published as F16 (no quantized variant like `low`'s Q4_K); their filenames are natively recognized for tool-call dialect detection, unlike `low`'s fallback to the SDK default. */
export const LLM_MODELS_BY_TIER: Record<ResourceTier, AgentModelConfig> = {
  low: {
    modelSource: QWEN3VL_2B_MODEL_SOURCE,
    temperature: 0,
    // Default ctxSize (4096) is too small to fit the full corpus context alongside the system prompt and reply.
    ctxSize: 16384,
    engineConfig: {
      projectionModelSrc: MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K.src,
    },
    kvCacheEnabled: true,
    // kvCacheQuantEnabled: true,
    modelName: QWEN3VL_2B_MULTIMODAL_Q4_K.name,
    quantization: QWEN3VL_2B_MULTIMODAL_Q4_K.quantization,
  },
  medium: {
    modelSource: QWEN3_5_9B_MODEL_SOURCE,
    temperature: 0,
    ctxSize: 16384,
    engineConfig: {
      projectionModelSrc: MMPROJ_QWEN3_5_9B_MULTIMODAL_F16.src,
    },
    modelName: QWEN3_5_9B_MULTIMODAL_Q4_K_M.name,
    quantization: QWEN3_5_9B_MULTIMODAL_Q4_K_M.quantization,
  },
  high: {
    modelSource: QWEN3_6_35B_A3B_MODEL_SOURCE,
    temperature: 0,
    ctxSize: 16384,
    engineConfig: {
      projectionModelSrc: MMPROJ_QWEN3_6_35B_A3B_MULTIMODAL_F16.src,
    },
    modelName: QWEN3_6_35B_A3B_MULTIMODAL_Q4_K_M.name,
    quantization: QWEN3_6_35B_A3B_MULTIMODAL_Q4_K_M.quantization,
    // I.2: bounded continuous batching (see docs/i2-simultaneous-completions-results.md) - only high runs completions in parallel; low/medium stay sequential.
    maxConcurrency: 2,
  },
};

/* =============================================================================
 * Embeddings models
 * ========================================================================== */

/** The only embeddings engine this backend targets. Must be set explicitly: `QvacRuntimeAdapter.load()` falls back to `DEFAULT_MODEL_TYPE` ('llamacpp-completion') otherwise, which loads the wrong engine for an embeddings model. */
export const EMBEDDING_MODEL_TYPE = "llamacpp-embedding";

/**
 * BGE-M3, Q4_K_M GGUF, 1024-dim, untiered. Not a `@qvac/sdk` catalog entry (checked 0.18.2 and 1.1.0, neither lists it) - loaded via HTTPS `url` instead of `registry`. Source: `groonga/bge-m3-Q4_K_M-GGUF` on HuggingFace, a direct GGUF conversion of `BAAI/bge-m3`.
 * Replaces EmbeddingGemma 300M per a retrieval benchmark (30-doc corpus, EN+ES, 13-question holdout) where it beat both EmbeddingGemma-300M and Qwen3-Embedding-0.6B on Recall@3/@5 and `minScore` separation.
 * Changing this (or `EMBEDDING_DIMENSIONS`) requires a full reindex - the ingest state tracks document content only, not which model produced the stored vectors.
 */
export const EMBEDDING_MODEL_SOURCE: ModelSource = {
  kind: "url",
  url: "https://huggingface.co/groonga/bge-m3-Q4_K_M-GGUF/resolve/main/bge-m3-q4_k_m.gguf",
  modelType: EMBEDDING_MODEL_TYPE,
};

/** Exact byte size of `EMBEDDING_MODEL_SOURCE`'s GGUF (confirmed via HEAD request) - threaded to `NativeEmbeddingProvider` as a corrupt-download integrity guard, same as a registry model's catalog `expectedSize`. */
export const EMBEDDING_MODEL_EXPECTED_SIZE = 437_778_464;

/** Chunks per `embed()` call for bulk ingestion - conservative for an 8GB machine sharing budget with the loaded chat model; not benchmarked against a ceiling. */
export const DEFAULT_EMBEDDING_BATCH_SIZE = 16;

/* =============================================================================
 * VAD models
 * ========================================================================== */

/** Silero VAD model source, used by the whisper engine config below to find segment boundaries in a live audio stream. */
export const SILERO_VAD_MODEL_SRC = VAD_SILERO_5_1_2.src;

/* =============================================================================
 * Speech-to-text (ASR) models
 * ========================================================================== */

/** The only whisper.cpp addon type this feature targets. */
export const WHISPER_MODEL_TYPE = "whispercpp-transcription";

/** Whisper catalog entry per resource tier - the single source of truth WHISPER_MODELS_BY_TIER and WHISPER_MODEL_NAMES_BY_TIER both derive from, sized for each tier's RAM/VRAM profile. */
const WHISPER_CATALOG_BY_TIER: Record<
  ResourceTier,
  { registryPath: string; registrySource: string; name: string }
> = {
  low: WHISPER_TINY_Q8_0,
  medium: WHISPER_SMALL_Q8_0,
  high: WHISPER_LARGE_V3_TURBO,
};

export const WHISPER_MODELS_BY_TIER: Record<ResourceTier, ModelSource> =
  mapTiers(WHISPER_CATALOG_BY_TIER, (entry) =>
    toRegistrySource(entry, WHISPER_MODEL_TYPE),
  );

/** Display name of the Whisper model resolved per tier - kept separate so a display-only consumer (the engine panel) doesn't need to unpack a ModelSource to show a name. */
export const WHISPER_MODEL_NAMES_BY_TIER: Record<ResourceTier, string> =
  mapTiers(WHISPER_CATALOG_BY_TIER, (entry) => entry.name);

/** `vadModelSrc` is required for `transcribeStream()` (the engine rejects streaming without it) since it needs voice-activity detection for live segment boundaries; `transcribe()` processes a whole file, so doesn't need it. */
export const DEFAULT_WHISPER_ENGINE_CONFIG = {
  detect_language: true,
  vadModelSrc: SILERO_VAD_MODEL_SRC,
};

/* =============================================================================
 * TTS models
 * ========================================================================== */

/** The only TTS engine this feature targets. */
export const TTS_MODEL_TYPE = "tts-ggml";

/** TTS catalog entry per tier. `medium`/`high` intentionally share Supertonic3 Q4_0 for now - Q8_0 for `high` is evaluated separately once its quality/latency tradeoff is measured. */
const TTS_CATALOG_BY_TIER: Record<
  ResourceTier,
  { registryPath: string; registrySource: string; name: string }
> = {
  low: TTS_MULTILINGUAL_SUPERTONIC2_Q4_0,
  medium: TTS_MULTILINGUAL_SUPERTONIC3_Q4_0,
  high: TTS_MULTILINGUAL_SUPERTONIC3_Q4_0,
};

export const TTS_MODELS_BY_TIER: Record<ResourceTier, ModelSource> = mapTiers(
  TTS_CATALOG_BY_TIER,
  (entry) => toRegistrySource(entry, TTS_MODEL_TYPE),
);

/** Display name of the TTS model resolved per tier - kept separate for the same display-only reason as WHISPER_MODEL_NAMES_BY_TIER. */
export const TTS_MODEL_NAMES_BY_TIER: Record<ResourceTier, string> = mapTiers(
  TTS_CATALOG_BY_TIER,
  (entry) => entry.name,
);

/** textToSpeech() doesn't return this - same for all Supertonic versions per @qvac/tts-ggml. */
export const SUPERTONIC_SAMPLE_RATE = 44100;

/** voice: 'F1' matches @qvac/sdk's own TTS examples. */
export const DEFAULT_SUPERTONIC_ENGINE_CONFIG = {
  ttsEngine: "supertonic",
  language: "en",
  voice: "F1",
};
