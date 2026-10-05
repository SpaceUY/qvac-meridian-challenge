/** SDK-agnostic domain types - nothing here may import `@qvac/sdk` (only `infra/qvacRuntimeAdapter.ts` may). */

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

/** Where to load weights from: `registry` (catalog lookup), `url` (direct HTTPS/HF), or `rawSrc` (an already-formed catalog src string passed through, e.g. a VLM's `projectionModelSrc`). */
export type ModelSource =
  | {
      kind: "registry";
      registryPath: string;
      registrySource: string;
      modelType?: string;
    }
  | { kind: "url"; url: string; modelType?: string }
  | { kind: "rawSrc"; src: string; modelType?: string };

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

/** Introspection on a loaded model: whether it's running locally or was delegated to a remote provider (see `DelegateOptions`). */
export interface LoadedModelDelegationInfo {
  isDelegated: boolean;
  /** Present only when `isDelegated` is true. */
  providerPublicKey?: string;
}

export type ModelRequestState =
  | "pending"
  | "succeeded"
  | "failed"
  | "cancelled";

/** Lets a caller poll the eventual outcome of a `load`/`infer`/`chatComplete` call that returned before settling (see `getRequestStatus()`). */
export interface ModelRequestStatus {
  requestId: string;
  kind: "load" | "inference" | "chat";
  state: ModelRequestState;
  /** Present once a `load` succeeds, or always for `inference`/`chat` (its input modelId, known upfront). */
  modelId?: string;
  /** Present once an `inference` or `chat` completion succeeds. */
  text?: string;
}

/** Mirrors `@qvac/sdk`'s `loadModel({ delegate })` shape, kept independent since `domain/` never imports the SDK. */
export interface DelegateOptions {
  providerPublicKey: string;
  timeout?: number;
  fallbackToLocal?: boolean;
  forceNewConnection?: boolean;
}

/** Extra load-time engine config. Kept separate from `ModelSource` because it configures the runtime, not where weights come from. */
export interface LoadModelOptions {
  ctxSize?: number;
  /** Enables tool-call parsing; some engines require this at load time regardless of per-request tools. */
  tools?: boolean;
  /** Opaque per-engine load config (e.g. whisper's `language`/`detect_language`), merged as-is into the SDK's `modelConfig`. */
  engineConfig?: Record<string, unknown>;
  /** Route this load to a remote provider instead of running it locally. See `config/delegate.config.ts` for how the chat-completion path populates this. */
  delegate?: DelegateOptions;
}

/** Closed set of image formats accepted today - WebP is deliberately excluded even though the boundary can detect it. */
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
  /** KV-cache tokens held after this call - grows turn after turn in a session (see contextBudget.ts). */
  cacheTokens?: number;
}

export interface ChatCompletionRequest {
  history: ChatMessage[];
  tools?: ChatTool[];
  temperature?: number;
  seed?: number;
  /** Per-request KV cache session key, forwarded from the `X-Meridian-Session` header. */
  sessionId?: string;
  /** Sourced from `AgentModelConfig.kvCacheEnabled`; `undefined` means enabled, same as `true`. */
  kvCacheEnabled?: boolean;
  /** Caller-assigned id for this specific generation call - lets `QvacChatSession` track/cancel it independently of any other concurrently in flight. */
  requestId?: string;
}

export interface ChatCompletionResult {
  text: string;
  thinkingText?: string;
  toolCalls: ChatToolCall[];
  stats?: ChatCompletionStats;
}
