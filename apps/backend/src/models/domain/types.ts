/**
 * SDK-agnostic domain types for local model management. Nothing here may
 * import `@qvac/sdk` — that boundary is what keeps the runtime swappable
 * (see `domain/ports.ts`) and is enforced by convention: only
 * `infra/qvacRuntimeAdapter.ts` is allowed to import the SDK.
 */

/** A model discovered via the QVAC distributed registry (modelRegistryList/Search). */
export interface RegistryModelSummary {
  name: string;
  registryPath: string;
  registrySource: string;
  engine: string;
  addon: string;
  quantization: string;
  params: string;
  expectedSizeBytes: number;
}

export interface RegistrySearchQuery {
  filter?: string;
  engine?: string;
  quantization?: string;
}

/**
 * Where to load model weights from. `registry` resolves a previously
 * discovered catalog entry; `url` loads directly from an HTTPS location
 * (including HuggingFace file URLs) without going through the registry.
 * Adding a new source kind later (e.g. a local filesystem path) only
 * touches this union and the adapter's `load()` — nothing else.
 */
export type ModelSource =
  | { kind: 'registry'; registryPath: string; registrySource: string; modelType?: string }
  | { kind: 'url'; url: string; modelType?: string };

export interface ModelDownloadProgress {
  percentage: number;
  downloadedBytes: number;
  totalBytes: number;
}

export interface LoadedModel {
  modelId: string;
  source: ModelSource;
  loadedAt: Date;
}

export interface InferenceResult {
  text: string;
}

/** Extra load-time engine config. Kept separate from `ModelSource` because it configures the runtime, not where weights come from. */
export interface LoadModelOptions {
  ctxSize?: number;
  /** Enables tool-call parsing for this model; some engines require opting in at load time regardless of whether a given request carries tools. */
  tools?: boolean;
}

/** One turn of chat history, engine-agnostic. */
export interface ChatMessage {
  role: string;
  content: string;
}

export interface ChatToolProperty {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'integer';
  description?: string;
  enum?: (string | number | boolean | null)[];
}

/** A tool definition offered to the model, in the flat/primitive-only shape local completion engines accept. */
export interface ChatTool {
  type: 'function';
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ChatToolProperty>;
    required?: string[];
  };
}

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatCompletionStats {
  timeToFirstToken?: number;
  tokensPerSecond?: number;
  promptTokens?: number;
  generatedTokens?: number;
}

export interface ChatCompletionRequest {
  history: ChatMessage[];
  tools?: ChatTool[];
  temperature?: number;
}

export interface ChatCompletionResult {
  text: string;
  toolCalls: ChatToolCall[];
  stats?: ChatCompletionStats;
}
