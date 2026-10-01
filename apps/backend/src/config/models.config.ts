import {
  EMBEDDINGGEMMA_300M_Q4_0,
  MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K,
  QWEN3_600M_INST_Q4,
  QWEN3VL_2B_MULTIMODAL_Q4_K,
  TTS_MULTILINGUAL_SUPERTONIC2_Q4_0,
  VAD_SILERO_5_1_2,
  WHISPER_TINY_Q8_0
} from '@qvac/sdk';
import type { ModelSource } from '../models/domain/types.js';

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
export const DEFAULT_MODEL_TYPE = 'llamacpp-completion';

/** Same `ModelSource` `LOW_RESOURCE_MODEL`/`HIGH_RESOURCE_MODEL` below use, exposed separately for callers (e.g. `ai/ragDemo.ts`) that build their own `AgentModelConfig` with different temperature/ctxSize choices. */
export const QWEN3_600M_MODEL_SOURCE: ModelSource = {
  kind: 'registry',
  registryPath: QWEN3_600M_INST_Q4.registryPath,
  registrySource: QWEN3_600M_INST_Q4.registrySource,
};

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
  /** Opaque per-engine load config merged into the SDK's modelConfig (e.g. a multimodal model's `projectionModelSrc`) - mirrors `LoadModelOptions.engineConfig` (`models/domain/types.ts`). */
  engineConfig?: Record<string, unknown>;
  /** Catalog name/quantization of `modelSource`, surfaced as-is (not re-derived) so callers (e.g. `AgentService.getStatus()`, the engine panel) can report which model is actually loaded. */
  modelName: string;
  quantization: string;
}

const QWEN3VL_2B_MODEL_SOURCE: ModelSource = {
  kind: 'registry',
  registryPath: QWEN3VL_2B_MULTIMODAL_Q4_K.registryPath,
  registrySource: QWEN3VL_2B_MULTIMODAL_Q4_K.registrySource,
};

/**
 * Selected low-resource-profile model: Qwen3-VL-2B-Instruct Q4_K, text +
 * vision + tool calling - swapped in for Qwen3.5-4B (roughly half the LLM
 * weight: ~1.11GB vs ~2.7GB) to cut CPU latency/RAM on machines without a
 * GPU. `projectionModelSrc` loads the vision projector alongside the main
 * weights (confirmed against `@qvac/sdk`'s own
 * `examples/llamacpp-multimodal.js`); tool calling is already always
 * requested via `tools: true` in `ChatQVAC.ensureModel()`.
 *
 * Unlike Qwen3.5, this model's filename doesn't match the SDK's
 * `detectToolDialectFromName()` patterns (`server/utils/tools/dialect.js`
 * only special-cases qwen3.5/3.6, gemma4, gpt-oss, deepseek-v3.2/v4, lfm),
 * so it falls back to the default `hermes` tool-call dialect - unverified
 * for this specific model, test tool calling explicitly before relying on
 * it (pass `toolDialect` explicitly in `engineConfig` below to override if
 * it turns out hermes doesn't parse reliably).
 */
export const LOW_RESOURCE_MODEL: AgentModelConfig = {
  modelSource: QWEN3VL_2B_MODEL_SOURCE,
  // Temperature/ctxSize carried over unchanged from the previous (600M) low-resource model - not re-tuned for Qwen3-VL-2B.
  temperature: 0,
  // Default ctxSize (4096) is too small to fit the full corpus context alongside the system prompt and reply.
  ctxSize: 16384,
  engineConfig: {
    projectionModelSrc: MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K.src
  },
  modelName: QWEN3VL_2B_MULTIMODAL_Q4_K.name,
  quantization: QWEN3VL_2B_MULTIMODAL_Q4_K.quantization,
};

/**
 * No separate high-resource-tier model has been selected yet - machines
 * meeting the resource thresholds get the same Qwen3.5-4B config as
 * `LOW_RESOURCE_MODEL` above (text + vision + tool calling), so both tiers
 * can exercise it until a larger high-resource pick is made.
 */
export const HIGH_RESOURCE_MODEL: AgentModelConfig = LOW_RESOURCE_MODEL;

export const HTTP_MODEL_URL =
  'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_0.gguf';

/**
 * Exact name of the single-file (non-sharded) Qwen3 1.7B Q4 entry in the
 * QVAC registry - matches `@qvac/sdk`'s own exported catalog constant
 * `QWEN3_1_7B_INST_Q4` (registryPath: "unsloth/Qwen3-1.7B-GGUF/resolve/...",
 * registrySource: "hf"), verified against the installed 0.18.2 package.
 * Searched by name instead of importing that constant directly so callers
 * (e.g. `models/demo.ts`) stay free of `@qvac/sdk` imports (only
 * `qvacRuntimeAdapter.ts` imports it).
 */
export const REGISTRY_MODEL_NAME = 'Qwen3-1.7B-Q4_0';

/**
 * Previously preloaded via the SDK's model-serving config
 * ("llama-tool-calling-1b-inst-q4-k", tool calling enabled) - evaluated but
 * not currently selected by `AgentService.selectModelConfig`
 * (`HIGH_RESOURCE_MODEL` above still uses `QWEN3_600M_INST_Q4`). No adapter
 * consumes this yet, so it's kept as a catalog-name string rather than an
 * `@qvac/sdk` import.
 */
export const LLAMA_TOOL_CALLING_1B_INST_Q4_K_MODEL_NAME = 'LLAMA_TOOL_CALLING_1B_INST_Q4_K';

/* =============================================================================
 * Embeddings models
 * ========================================================================== */

/** The only embeddings engine this backend targets. Must be set explicitly: `QvacRuntimeAdapter.load()` falls back to `DEFAULT_MODEL_TYPE` ('llamacpp-completion') otherwise, which loads the wrong engine for an embeddings model. */
export const EMBEDDING_MODEL_TYPE = 'llamacpp-embedding';

/**
 * Embedding model backing the RAG pipeline: EmbeddingGemma 300M, Q4_0,
 * ~277MB on disk, 768-dimensional output (measured, see
 * `EMBEDDING_DIMENSIONS` in `rag.config.ts`). Previously preloaded via the
 * SDK's model-serving config as "embeddinggemma-300m-q4-0"; now loaded
 * on-demand by `QvacEmbeddingService.ensureModel()` instead. Passed to
 * `rag/service/qvacEmbeddingService.ts` by the ingest CLI and the server. Whatever queries
 * the table must use this same model: a different embedding model can emit
 * the same 768 dimensions, so a mismatch returns wrong chunks instead of
 * failing.
 */
export const EMBEDDING_MODEL_SOURCE: ModelSource = {
  kind: 'registry',
  registryPath: EMBEDDINGGEMMA_300M_Q4_0.registryPath,
  registrySource: EMBEDDINGGEMMA_300M_Q4_0.registrySource,
  modelType: EMBEDDING_MODEL_TYPE
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
export const WHISPER_MODEL_TYPE = 'whispercpp-transcription';

/**
 * Small quantized multilingual whisper model, previously preloaded via the
 * SDK's model-serving config - light enough for an 8GB RAM machine. Same
 * catalog constant the text/LLM completion model section above draws from a
 * sibling entry of, applied here to the transcription engine.
 */
export const DEFAULT_WHISPER_MODEL_SOURCE: ModelSource = {
  kind: 'registry',
  registryPath: WHISPER_TINY_Q8_0.registryPath,
  registrySource: WHISPER_TINY_Q8_0.registrySource,
  modelType: WHISPER_MODEL_TYPE
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
  vadModelSrc: SILERO_VAD_MODEL_SRC
};

/* =============================================================================
 * TTS models
 * ========================================================================== */

/** The only TTS engine this feature targets. */
export const TTS_MODEL_TYPE = 'tts-ggml';

/**
 * Selected low-resource-profile TTS model: multilingual Supertonic2, Q4
 * quant. Loaded by `tts/service/tts.service.ts` via
 * `tts/infra/qvacTtsAdapter.ts`, the same way `qvacRuntimeAdapter.ts` loads
 * completion/whisper models. The SDK's model-serving config previously
 * pointed its TTS preload entry at a different model (chatterbox,
 * "tts-t3-turbo-en-chatterbox-q8-0") before that config was deleted from
 * this repo - that entry was never updated to match this selection.
 */
export const SUPERTONIC2_TTS_MODEL_SOURCE: ModelSource = {
  kind: 'registry',
  registryPath: TTS_MULTILINGUAL_SUPERTONIC2_Q4_0.registryPath,
  registrySource: TTS_MULTILINGUAL_SUPERTONIC2_Q4_0.registrySource,
  modelType: TTS_MODEL_TYPE
};

/** textToSpeech() doesn't return this - same for all Supertonic versions per @qvac/tts-ggml. */
export const SUPERTONIC_SAMPLE_RATE = 44100;

/** voice: 'F1' matches @qvac/sdk's own TTS examples. */
export const DEFAULT_SUPERTONIC_ENGINE_CONFIG = {
  ttsEngine: 'supertonic',
  language: 'en',
  voice: 'F1'
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
export const ABOT_WORLD_0_5B_LF_VAE_MODEL_NAME = 'ABOT_WORLD_0_5B_LF_VAE';
