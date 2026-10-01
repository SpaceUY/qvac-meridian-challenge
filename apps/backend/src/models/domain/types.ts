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
  | {
      kind: "registry";
      registryPath: string;
      registrySource: string;
      modelType?: string;
    }
  | { kind: "url"; url: string; modelType?: string };

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

export type ModelRequestState =
  | "pending"
  | "succeeded"
  | "failed"
  | "cancelled";

/**
 * Observability for a load/inference/chat completion started via
 * `loadModel()`/`infer()`/`chatComplete()`. Those return as soon as a
 * `requestId` exists, without waiting for the operation to settle -
 * `ModelManagementService.getRequestStatus()` (and `GET /requests/:requestId`)
 * is how a caller later learns whether it succeeded, failed, or was
 * cancelled.
 */
export interface ModelRequestStatus {
  requestId: string;
  kind: "load" | "inference" | "chat";
  state: ModelRequestState;
  /** Present once a `load` succeeds, or always for `inference`/`chat` (its input modelId, known upfront). */
  modelId?: string;
  /** Present once an `inference` or `chat` completion succeeds. */
  text?: string;
}

/** Extra load-time engine config. Kept separate from `ModelSource` because it configures the runtime, not where weights come from. */
export interface LoadModelOptions {
  ctxSize?: number;
  /** Enables tool-call parsing for this model; some engines require opting in at load time regardless of whether a given request carries tools. */
  tools?: boolean;
  /** Opaque per-engine load config (e.g. whisper's `language`/`detect_language`), merged as-is into the SDK's `modelConfig`. */
  engineConfig?: Record<string, unknown>;
}

/** Closed set of image formats the multimodal pipeline accepts today - see the design spec for why WebP is deliberately excluded even though the API boundary can detect it. */
export type SupportedImageMimeType = "image/jpeg" | "image/png";

export interface ChatImageAttachment {
  mimeType: SupportedImageMimeType;
  data: Uint8Array;
}

/** One turn of chat history, engine-agnostic. */
export interface ChatMessage {
  role: string;
  content: string;
  /** Images attached to this turn. Materialized to temp files by `qvacRuntimeAdapter.ts` before reaching the SDK, which only accepts a file path (never raw bytes) for an attachment. */
  images?: ChatImageAttachment[];
}

export interface ChatToolProperty {
  type: "string" | "number" | "boolean" | "object" | "array" | "integer";
  description?: string;
  enum?: (string | number | boolean | null)[];
}

/** A tool definition offered to the model, in the flat/primitive-only shape local completion engines accept. */
export interface ChatTool {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
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
  thinkingText?: string;
  toolCalls: ChatToolCall[];
  stats?: ChatCompletionStats;
}
