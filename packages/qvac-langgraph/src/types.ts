/**
 * Structural port + value types this package depends on instead of any
 * specific backend's model-management types. A consumer's own types (e.g.
 * `ModelManagementService`, `ModelSource`, `ChatCompletionRequest`, ...) can
 * be passed here as-is via TypeScript's structural typing, as long as their
 * shape matches - no adapter object or cast required.
 */

/** Where to load model weights from. Mirrors the `kind`-tagged union most QVAC-style model managers use for registry/url/raw-source loads. */
export type QvacModelSource =
  | {
      kind: "registry";
      registryPath: string;
      registrySource: string;
      modelType?: string;
    }
  | { kind: "url"; url: string; modelType?: string }
  | { kind: "rawSrc"; src: string; modelType?: string };

/** Where to route a model load instead of running it locally, and how to fall back if that fails. */
export interface QvacDelegateOptions {
  providerPublicKey: string;
  timeout?: number;
  fallbackToLocal?: boolean;
  forceNewConnection?: boolean;
}

/** Introspection on a loaded model: whether it's running locally or was delegated to a remote provider. */
export interface QvacLoadedModelDelegationInfo {
  isDelegated: boolean;
  /** Present only when `isDelegated` is true. */
  providerPublicKey?: string;
}

/** Closed set of image formats forwarded as chat attachments. */
export type QvacSupportedImageMimeType = "image/jpeg" | "image/png";

export interface QvacChatImageAttachment {
  mimeType: QvacSupportedImageMimeType;
  data: Uint8Array;
}

/** One turn of chat history, engine-agnostic. */
export interface QvacChatMessage {
  role: string;
  content: string;
  images?: QvacChatImageAttachment[];
}

export interface QvacChatToolProperty {
  type: "string" | "number" | "boolean" | "object" | "array" | "integer";
  description?: string;
  enum?: (string | number | boolean | null)[];
}

/** A tool definition offered to the model, in the flat/primitive-only shape local completion engines accept. */
export interface QvacChatTool {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, QvacChatToolProperty>;
    required?: string[];
  };
}

export interface QvacChatToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface QvacChatCompletionStats {
  timeToFirstToken?: number;
  tokensPerSecond?: number;
  promptTokens?: number;
  generatedTokens?: number;
}

export interface QvacChatCompletionRequest {
  history: QvacChatMessage[];
  tools?: QvacChatTool[];
  temperature?: number;
  seed?: number;
  /** Per-request KV cache session key, forwarded to `QvacModelPort.chatComplete()`'s implementation. */
  sessionId?: string;
  /** Whether the underlying `QvacModelPort.chatComplete()` implementation uses its KV cache for this request. `undefined` means enabled, same as `true`. */
  kvCacheEnabled?: boolean;
}

export interface QvacChatCompletionResult {
  text: string;
  thinkingText?: string;
  toolCalls: QvacChatToolCall[];
  stats?: QvacChatCompletionStats;
}

/** Extra load-time engine config accepted by `QvacModelPort.loadModel()`. */
export interface QvacLoadModelOptions {
  ctxSize?: number;
  /** Enables tool-call parsing for this model; some engines require opting in at load time regardless of whether a given request carries tools. */
  tools?: boolean;
  /** Opaque per-engine load config, merged as-is into the underlying engine's model config. */
  engineConfig?: Record<string, unknown>;
  /** Route this load to a remote provider instead of running it locally. */
  delegate?: QvacDelegateOptions;
}

/**
 * The structural contract `ChatQVAC` depends on for model lifecycle and
 * inference. Any object with this shape works - most commonly a thin
 * wrapper around `@qvac/sdk` or an equivalent local model runtime.
 */
export interface QvacModelPort {
  loadModel(
    source: QvacModelSource,
    options?: QvacLoadModelOptions,
  ): Promise<{ modelId: string }> & { requestId: string };
  chatComplete(
    modelId: string,
    request: QvacChatCompletionRequest,
    onToken?: (textDelta: string) => void,
  ): Promise<QvacChatCompletionResult> & { requestId: string };
  cancel(requestId: string): Promise<void>;
  unloadModel(modelId: string): Promise<void>;
  getLoadedModelInfo(modelId: string): Promise<QvacLoadedModelDelegationInfo>;
}
