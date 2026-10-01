import {
  EMBEDDINGGEMMA_300M_Q4_0,
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
function toRegistrySource(entry: { registryPath: string; registrySource: string }, modelType: string): ModelSource {
  return { kind: "registry", registryPath: entry.registryPath, registrySource: entry.registrySource, modelType };
}

/**
 * Single source of truth for every concrete model this backend uses or has
 * evaluated, grouped by capability. Pipelines (`ai/orchestrator`, `rag`,
 * `speech`, `models`) import from here instead of hardcoding a registry
 * entry/source/model type inline. Mirrors the models feature's own
 * SDK-import convention (see `models/README.md`'s "Only
 * infra/qvacRuntimeAdapter.ts imports @qvac/sdk"): that rule is about the
 * SDK's runtime *calls* (load/infer/etc.), not its catalog constants - this
 * file, like the config it replaces, only ever reads plain data off them.
 *
 * LLM/STT/TTS entries are grouped into `*_BY_TIER` maps keyed by
 * `ResourceTier` (`config/resourceTier.ts`). Embeddings stay untiered.
 *
 * Entries pulled from the SDK's model-serving preload config (previously
 * `qvac.config.json`, since deleted from this repo) that no pipeline
 * consumes yet are kept as plain catalog-name strings rather than
 * `@qvac/sdk` imports, since there's no local install to confirm those
 * exports against - the same "search/reference by name" approach
 * `REGISTRY_MODEL_NAME` below already used.
 */

/* =============================================================================
 * Text / LLM (completion) models
 * ========================================================================== */

/** Default engine used when a `ModelSource` doesn't specify one - the only inference engine the models feature targets. */
export const DEFAULT_MODEL_TYPE = "llamacpp-completion";

/** Same `ModelSource` `LLM_MODELS_BY_TIER`'s `low` entry below draws from, exposed separately for callers (e.g. `ai/ragDemo.ts`) that build their own `AgentModelConfig` with different temperature/ctxSize choices. */
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
  /** Whether `chatComplete()` calls against this model use the SDK's KV cache. Defaults to enabled (`true`) when omitted - see `ChatQVAC`'s `kvCacheEnabled` field. */
  kvCacheEnabled?: boolean;
  /** Whether this model's KV cache is quantized via TurboQuant - see `TURBOQUANT_KV_CACHE_ENGINE_CONFIG`/`resolveEngineConfig` below. Defaults to disabled (`false`) when omitted. */
  kvCacheQuantEnabled?: boolean;
}

/**
 * `cache-type-k`/`cache-type-v` engine config for TurboQuant KV-cache
 * quantization - merged into `engineConfig` at load time by
 * `resolveEngineConfig()` below when `AgentModelConfig.kvCacheQuantEnabled`
 * is set. `cache-type-k`/`cache-type-v` are plain opaque strings on
 * `@qvac/llm-llamacpp`'s `LlamaConfig`, documented there only with
 * standard (non-TurboQuant) examples (`f16`, `q8_0`, `q4_0`, ...);
 * TurboQuant's own type strings and per-cache split (K: 4-bit TurboQuant +
 * QJL Stage 2 `tbq4_0`, V: 4-bit product quantization `pq4_0`, no flash
 * attention or calibration required, works with any GGUF transformer) are
 * undocumented in `@qvac/sdk` itself - confirmed instead against
 * https://qvac.tether.io/blog/turboquant-in-qvac-sdk-0-12-0-kv-cache-quantization-for-production-local-ai
 */
export const TURBOQUANT_KV_CACHE_ENGINE_CONFIG: Record<string, string> = {
  "cache-type-k": "tbq4_0",
  "cache-type-v": "pq4_0",
};

/**
 * The `engineConfig` a caller (currently `AgentService`) should hand to
 * `ChatQVAC`/`loadModel()` for `config` - `config.engineConfig` as-is,
 * with `TURBOQUANT_KV_CACHE_ENGINE_CONFIG` merged in when
 * `config.kvCacheQuantEnabled` is set. The single place this merge
 * happens, so every `AgentModelConfig` consumer stays in sync.
 */
export function resolveEngineConfig(
  config: AgentModelConfig,
): Record<string, unknown> | undefined {
  if (!config.kvCacheQuantEnabled) return config.engineConfig;
  return { ...config.engineConfig, ...TURBOQUANT_KV_CACHE_ENGINE_CONFIG };
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

/**
 * Chat/VLM model per resource tier. `medium`/`high` vision projectors are
 * only published as BF16/F16 in the catalog (no quantized variant like
 * `low`'s Q4_K) - F16 is used for both. Unlike `low`, whose filename falls
 * back to the SDK's default `hermes` tool-call dialect, Qwen3.5/Qwen3.6
 * filenames are natively recognized, so `medium`/`high` get proper
 * tool-call dialect detection.
 */
export const LLM_MODELS_BY_TIER: Record<ResourceTier, AgentModelConfig> = {
  low: {
    modelSource: QWEN3VL_2B_MODEL_SOURCE,
    temperature: 0,
    // Default ctxSize (4096) is too small to fit the full corpus context alongside the system prompt and reply.
    ctxSize: 16384,
    engineConfig: {
      projectionModelSrc: MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K.src
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
      projectionModelSrc: MMPROJ_QWEN3_5_9B_MULTIMODAL_F16.src
    },
    modelName: QWEN3_5_9B_MULTIMODAL_Q4_K_M.name,
    quantization: QWEN3_5_9B_MULTIMODAL_Q4_K_M.quantization,
  },
  high: {
    modelSource: QWEN3_6_35B_A3B_MODEL_SOURCE,
    temperature: 0,
    ctxSize: 16384,
    engineConfig: {
      projectionModelSrc: MMPROJ_QWEN3_6_35B_A3B_MULTIMODAL_F16.src
    },
    modelName: QWEN3_6_35B_A3B_MULTIMODAL_Q4_K_M.name,
    quantization: QWEN3_6_35B_A3B_MULTIMODAL_Q4_K_M.quantization,
  },
};

export const HTTP_MODEL_URL =
  "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_0.gguf";

/**
 * Exact name of the single-file (non-sharded) Qwen3 1.7B Q4 entry in the
 * QVAC registry - matches `@qvac/sdk`'s own exported catalog constant
 * `QWEN3_1_7B_INST_Q4` (registryPath: "unsloth/Qwen3-1.7B-GGUF/resolve/...",
 * registrySource: "hf"), verified against the installed 0.18.2 package.
 * Searched by name instead of importing that constant directly so callers
 * (e.g. `models/demo.ts`) stay free of `@qvac/sdk` imports (only
 * `qvacRuntimeAdapter.ts` imports it).
 */
export const REGISTRY_MODEL_NAME = "Qwen3-1.7B-Q4_0";

/**
 * Previously preloaded via the SDK's model-serving config
 * ("llama-tool-calling-1b-inst-q4-k", tool calling enabled) - not currently
 * used by any tier in `LLM_MODELS_BY_TIER`. No adapter consumes this yet,
 * so it's kept as a catalog-name string rather than an `@qvac/sdk` import.
 */
export const LLAMA_TOOL_CALLING_1B_INST_Q4_K_MODEL_NAME =
  "LLAMA_TOOL_CALLING_1B_INST_Q4_K";

/* =============================================================================
 * Embeddings models
 * ========================================================================== */

/** The only embeddings engine this backend targets. Must be set explicitly: `QvacRuntimeAdapter.load()` falls back to `DEFAULT_MODEL_TYPE` ('llamacpp-completion') otherwise, which loads the wrong engine for an embeddings model. */
export const EMBEDDING_MODEL_TYPE = "llamacpp-embedding";

/**
 * Embedding model backing the RAG pipeline: EmbeddingGemma 300M, Q4_0,
 * ~277MB on disk, 768-dimensional output (measured, see
 * `EMBEDDING_DIMENSIONS` in `rag.config.ts`). Not tiered by resource
 * profile - same model on every machine regardless of `ResourceTier`.
 * Previously preloaded via the SDK's model-serving config as
 * "embeddinggemma-300m-q4-0"; now loaded on-demand by
 * `QvacEmbeddingService.ensureModel()` instead. Passed to
 * `rag/service/qvacEmbeddingService.ts` by the ingest CLI and the server. Whatever queries
 * the table must use this same model: a different embedding model can emit
 * the same 768 dimensions, so a mismatch returns wrong chunks instead of
 * failing.
 */
export const EMBEDDING_MODEL_SOURCE: ModelSource = {
  kind: "registry",
  registryPath: EMBEDDINGGEMMA_300M_Q4_0.registryPath,
  registrySource: EMBEDDINGGEMMA_300M_Q4_0.registrySource,
  modelType: EMBEDDING_MODEL_TYPE,
};

/**
 * Chunks per `embed()` call when embedding many texts at once (document
 * ingestion). Conservative for an 8GB RAM machine sharing that budget with
 * the loaded chat model - not benchmarked against a specific ceiling, so
 * treat as a starting point to tune once ingestion runs against the real
 * corpus.
 */
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

/** Whisper model per resource tier, sized for each tier's RAM/VRAM profile. */
export const WHISPER_MODELS_BY_TIER: Record<ResourceTier, ModelSource> = {
  low: toRegistrySource(WHISPER_TINY_Q8_0, WHISPER_MODEL_TYPE),
  medium: toRegistrySource(WHISPER_SMALL_Q8_0, WHISPER_MODEL_TYPE),
  high: toRegistrySource(WHISPER_LARGE_V3_TURBO, WHISPER_MODEL_TYPE),
};

/**
 * `detect_language` enables EN/ES (and other) auto-detection. `vadModelSrc`
 * is required for `transcribeStream()`: the engine rejects streaming
 * requests without it ("VAD model name is required for Whisper
 * transcription") since it uses voice-activity detection to find segment
 * boundaries in a live audio stream - `transcribe()` doesn't need this,
 * since it processes a whole file at once.
 */
export const DEFAULT_WHISPER_ENGINE_CONFIG = {
  detect_language: true,
  vadModelSrc: SILERO_VAD_MODEL_SRC,
};

/* =============================================================================
 * TTS models
 * ========================================================================== */

/** The only TTS engine this feature targets. */
export const TTS_MODEL_TYPE = "tts-ggml";

/**
 * TTS model per resource tier. `medium`/`high` intentionally use the same
 * Supertonic3 Q4_0 for now - Q8_0 for `high` is evaluated separately once
 * its quality/latency tradeoff is measured.
 */
export const TTS_MODELS_BY_TIER: Record<ResourceTier, ModelSource> = {
  low: toRegistrySource(TTS_MULTILINGUAL_SUPERTONIC2_Q4_0, TTS_MODEL_TYPE),
  medium: toRegistrySource(TTS_MULTILINGUAL_SUPERTONIC3_Q4_0, TTS_MODEL_TYPE),
  high: toRegistrySource(TTS_MULTILINGUAL_SUPERTONIC3_Q4_0, TTS_MODEL_TYPE),
};

/** textToSpeech() doesn't return this - same for all Supertonic versions per @qvac/tts-ggml. */
export const SUPERTONIC_SAMPLE_RATE = 44100;

/** voice: 'F1' matches @qvac/sdk's own TTS examples. */
export const DEFAULT_SUPERTONIC_ENGINE_CONFIG = {
  ttsEngine: "supertonic",
  language: "en",
  voice: "F1",
};

/* =============================================================================
 * World models
 * ========================================================================== */

/**
 * Previously preloaded via the SDK's model-serving config
 * ("abot-world-0-5b-lf-vae", config: `{ prediction: "v" }`) - a world model
 * for agent state simulation/prediction. No world-model pipeline exists in
 * this backend yet. Kept as a catalog-name string rather than an
 * `@qvac/sdk` import since nothing currently loads it.
 */
export const ABOT_WORLD_0_5B_LF_VAE_MODEL_NAME = "ABOT_WORLD_0_5B_LF_VAE";
