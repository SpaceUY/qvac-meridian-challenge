import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BaseChatModelParams,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
} from "@langchain/core/messages";
import type { ToolCall } from "@langchain/core/messages/tool";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import type { Runnable } from "@langchain/core/runnables";
import type {
  QvacChatCompletionRequest,
  QvacChatCompletionResult,
  QvacChatImageAttachment,
  QvacChatMessage,
  QvacChatTool,
  QvacChatToolCall,
  QvacChatToolProperty,
  QvacDelegateOptions,
  QvacLoadedModelDelegationInfo,
  QvacModelPort,
  QvacModelSource,
  QvacSupportedImageMimeType,
} from "./types.js";

const QVAC_ROLE_BY_MESSAGE_TYPE: Record<string, string> = {
  system: "system",
  human: "user",
  ai: "assistant",
  tool: "tool",
};

interface JsonSchemaObject {
  properties?: Record<
    string,
    { type?: string; description?: string; enum?: unknown[] }
  >;
  required?: string[];
}

export interface QVACChatModelInput extends BaseChatModelParams {
  service: QvacModelPort;
  /** Where to load model weights from, via the injected `QvacModelPort`. */
  modelSource: QvacModelSource;
  ctxSize?: number;
  temperature?: number;
  /** Opaque per-engine load config (e.g. a multimodal model's `projectionModelSrc`), merged as-is into the underlying engine's model config alongside `ctxSize`/`tools`. */
  engineConfig?: Record<string, unknown>;
  /** Whether `chatComplete()` calls made against this model use the SDK's KV cache. Defaults to enabled (`true`) when omitted. */
  kvCacheEnabled?: boolean;
  /** When set, routes this model's load (and the inference that follows it) to a remote provider instead of running locally. */
  delegate?: QvacDelegateOptions;
  /**
   * True if `err` means the delegated model's remote provider died
   * mid-session and recovery (reload + retry) should be attempted.
   * Defaults to `() => false` (no recovery) when omitted.
   */
  isRetryableProviderError?: (err: unknown) => boolean;
  /**
   * Builds the error used to reject a caller waiting on `ensureModel()`
   * when `cancelLoad()` abandons an in-flight load. Defaults to a plain
   * `Error` when omitted.
   */
  createCancelledError?: (requestId: string) => unknown;
}

export interface ChatQVACCallOptions extends BaseChatModelCallOptions {
  tools?: QvacChatTool[];
  /** Per-call override of the constructor's `temperature`/no `seed` default. */
  temperature?: number;
  seed?: number;
  /** Per-call KV cache session key, forwarded to `QvacModelPort.chatComplete()`. */
  sessionId?: string;
}

/**
 * Converts a LangChain tool definition into the port's flat `QvacChatTool`
 * shape. The underlying completion engine's tool schema only supports
 * primitive-typed properties (no nested object/array item schemas), so
 * only `type`/`description`/`enum` survive - that's all it accepts.
 */
function toChatTool(tool: BindToolsInput): QvacChatTool {
  const { function: fn } = convertToOpenAITool(
    tool as Parameters<typeof convertToOpenAITool>[0],
  );
  const schema = (fn.parameters ?? {}) as JsonSchemaObject;

  const properties: Record<string, QvacChatToolProperty> = {};
  for (const [key, value] of Object.entries(schema.properties ?? {})) {
    properties[key] = {
      type: (value.type as QvacChatToolProperty["type"]) ?? "string",
      description: value.description,
      enum: value.enum as QvacChatToolProperty["enum"],
    };
  }

  return {
    type: "function",
    name: fn.name,
    description: fn.description ?? "",
    parameters: {
      type: "object",
      properties,
      required: schema.required,
    },
  };
}

const SUPPORTED_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set<QvacSupportedImageMimeType>([
  "image/jpeg",
  "image/png",
]);

function isSupportedImageMimeType(mimeType: unknown): mimeType is QvacSupportedImageMimeType {
  return typeof mimeType === "string" && SUPPORTED_IMAGE_MIME_TYPES.has(mimeType);
}

/** Whether `message` carries at least one image content block - used by a consumer's graph nodes to compute e.g. `hasVisualInput`, and internally by `toChatMessage()` below. */
export function hasImageContent(message: BaseMessage): boolean {
  return message.contentBlocks.some((block) => block.type === "image");
}

/**
 * Extracts image content blocks from `message` into `QvacChatMessage.images`.
 * Only blocks whose `mimeType` this pipeline actually supports survive -
 * an API boundary further upstream is what enforces that on the way in;
 * this is a defensive filter against a message constructed some other way.
 */
function toChatImages(message: BaseMessage): QvacChatImageAttachment[] | undefined {
  const images: QvacChatImageAttachment[] = [];

  for (const block of message.contentBlocks) {
    if (block.type !== "image") continue;
    if (!("data" in block) || block.data === undefined) continue;
    if (!isSupportedImageMimeType(block.mimeType)) continue;

    images.push({
      mimeType: block.mimeType,
      data: typeof block.data === "string" ? Buffer.from(block.data, "base64") : block.data,
    });
  }

  return images.length > 0 ? images : undefined;
}

function toChatMessage(message: BaseMessage): QvacChatMessage {
  const role = QVAC_ROLE_BY_MESSAGE_TYPE[message.type] ?? "user";

  // Tool-call turns carry no dedicated field in `QvacChatMessage`; serialize
  // them (alongside any accompanying text) so the model can see its own
  // prior turn when the history is replayed.
  if (AIMessage.isInstance(message) && message.tool_calls?.length) {
    return {
      role,
      content: JSON.stringify({
        ...(message.text ? { text: message.text } : {}),
        tool_calls: message.tool_calls,
      }),
    };
  }

  const images = toChatImages(message);
  return { role, content: message.text, ...(images ? { images } : {}) };
}

function toLangChainToolCalls(toolCalls: QvacChatToolCall[]): ToolCall[] {
  return toolCalls.map((call) => ({
    type: "tool_call",
    id: call.id,
    name: call.name,
    args: call.arguments,
  }));
}

export class ChatQVAC extends BaseChatModel<ChatQVACCallOptions> {
  private readonly service: QvacModelPort;
  private readonly modelSource: QvacModelSource;
  private readonly ctxSize: number;
  private readonly temperature?: number;
  private readonly engineConfig?: Record<string, unknown>;
  private readonly kvCacheEnabled?: boolean;
  private readonly delegate?: QvacDelegateOptions;
  private readonly isRetryableProviderError: (err: unknown) => boolean;
  private readonly createCancelledError: (requestId: string) => unknown;
  private modelIdPromise?: Promise<string>;
  /** Cache backing `getCachedDelegationInfo()`, kept fresh by `getDelegationInfo()` and by `recoverFromDelegationFailure()`. */
  private delegationInfo?: QvacLoadedModelDelegationInfo;
  /** `true` for the duration of a `recoverFromDelegationFailure()` call - lets `AgentService.getStatus()` report "reconnecting" instead of the frontend inferring it 60s late from a state change that already finished. */
  private recovering = false;
  /** The `requestId` of the `chatComplete` call currently in flight, if any - lets `cancelActive()` cancel it. */
  private activeRequestId?: string;
  /** The `requestId` of the `loadModel` call currently in flight, if any - lets `cancelLoad()` cancel it. */
  private loadRequestId?: string;
  /**
   * Set while a load is in flight; `cancelLoad()` uses it to force
   * `ensureModel()`'s pending promise to reject immediately. See
   * `ensureModel()`'s doc comment for why this exists alongside the
   * port-level `service.cancel()` call.
   */
  private loadAbandonSignal?: { reject: (err: unknown) => void };

  constructor(fields: QVACChatModelInput) {
    super(fields);
    this.service = fields.service;
    this.modelSource = fields.modelSource;
    this.ctxSize = fields.ctxSize ?? 4096;
    this.temperature = fields.temperature;
    this.engineConfig = fields.engineConfig;
    this.kvCacheEnabled = fields.kvCacheEnabled;
    this.delegate = fields.delegate;
    this.isRetryableProviderError = fields.isRetryableProviderError ?? (() => false);
    this.createCancelledError =
      fields.createCancelledError ?? ((requestId) => new Error(`Operation "${requestId}" was cancelled`));
  }

  static lc_name(): string {
    return "ChatQVAC";
  }

  /**
   * Cancels the `chatComplete` call currently in flight on this model, if
   * any - used by a host's cancel endpoint to stop a running `invoke()`.
   * No-op when nothing is in flight (e.g. it already settled).
   */
  async cancelActive(): Promise<void> {
    if (!this.activeRequestId) return;
    await this.service.cancel(this.activeRequestId);
  }

  /**
   * Cancels the `loadModel` call currently in flight on this model, if
   * any - used by a host's cancel-preload path to stop a running
   * `preload()`. No-op when nothing is in flight.
   *
   * `service.cancel()` is best-effort here, not a guarantee: a delegated
   * load's connection-establishment phase can fail to register with the
   * underlying runtime's request-cancellation registry at all, so
   * `cancel()` during that phase may just report success without
   * interrupting anything - the connection attempt keeps running until it
   * times out on its own (`QvacDelegateOptions.timeout`). Rejecting
   * `loadAbandonSignal` guarantees the caller isn't stuck waiting that
   * long regardless of whether the port-level cancel actually took effect.
   */
  async cancelLoad(): Promise<void> {
    if (!this.loadRequestId) return;
    const requestId = this.loadRequestId;
    await this.service.cancel(requestId).catch(() => {});
    this.loadAbandonSignal?.reject(this.createCancelledError(requestId));
  }

  _llmType(): string {
    return "qvac";
  }

  bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<ChatQVACCallOptions>,
  ): Runnable<BaseLanguageModelInput, AIMessageChunk, ChatQVACCallOptions> {
    return this.withConfig({
      tools: tools.map(toChatTool),
      ...kwargs,
    } as Partial<ChatQVACCallOptions>);
  }

  /**
   * Races the real load against a manually-triggered "abandon" signal
   * (see `cancelLoad()`) so a caller is never stuck waiting on this
   * promise longer than a cancel request, even when the underlying port
   * can't actually interrupt the operation. The real load keeps running
   * in the background either way - this only stops the caller from
   * waiting on it.
   */
  async ensureModel(): Promise<string> {
    if (!this.modelIdPromise) {
      const pending = this.service.loadModel(this.modelSource, {
        ctxSize: this.ctxSize,
        // The llamacpp-completion addon only parses tool calls when the model
        // was loaded with `tools: true` *and* the request carries tools -
        // load-time opt-in is required even though it's a no-op without the
        // latter, so this can't be deferred to bindTools()/_generate().
        tools: true,
        engineConfig: this.engineConfig,
        delegate: this.delegate,
      });
      this.loadRequestId = pending.requestId;
      const abandoned = new Promise<never>((_, reject) => {
        this.loadAbandonSignal = { reject };
      });
      this.modelIdPromise = Promise.race([pending.then((loaded) => loaded.modelId), abandoned])
        .catch((error: unknown) => {
          this.modelIdPromise = undefined;
          throw error;
        })
        .finally(() => {
          this.loadRequestId = undefined;
          this.loadAbandonSignal = undefined;
        });
    }
    return this.modelIdPromise;
  }

  /**
   * Whether the currently loaded model is running on a remote provider or
   * locally - `undefined` until a model has loaded, or if no `delegate`
   * was configured at all (a non-delegating load is always local, so
   * there's nothing to query). Best-effort: if the introspection query
   * itself fails, resolves `undefined` rather than throwing, so a caller
   * never has its own success/failure hinge on this - the chat model is
   * either loaded and usable or it isn't, independent of whether its
   * delegation status could be confirmed.
   *
   * Caches its result (see `getCachedDelegationInfo()`) - also refreshed
   * by `recoverFromDelegationFailure()` after a mid-session recovery, so
   * the cache never goes stale after the model that was originally
   * delegated falls back to running locally.
   */
  async getDelegationInfo(): Promise<QvacLoadedModelDelegationInfo | undefined> {
    if (!this.delegate) {
      this.delegationInfo = undefined;
      return undefined;
    }
    const modelId = await this.ensureModel();
    this.delegationInfo = await this.service.getLoadedModelInfo(modelId).catch(() => undefined);
    return this.delegationInfo;
  }

  /**
   * Synchronous snapshot of the last `getDelegationInfo()` result. Exists
   * so a host's status endpoint - itself synchronous, if it's polled by a
   * frontend every second - can report current delegation status without
   * an async round-trip (and a port-level call) on every poll.
   */
  getCachedDelegationInfo(): QvacLoadedModelDelegationInfo | undefined {
    return this.delegationInfo;
  }

  /** Synchronous snapshot of whether a delegation-recovery reload is currently in flight. See the `recovering` field's doc comment. */
  isRecovering(): boolean {
    return this.recovering;
  }

  /**
   * Called when a chat completion fails because the delegated model's
   * provider died mid-session (see the constructor's `isRetryableProviderError`
   * hook). A typical port implementation's own fallback-to-local behavior
   * only applies at load time, so an already-loaded delegated model has no
   * port-level recovery of its own once its provider goes down.
   *
   * Unloading the stale model *before* reloading is required, not just
   * cleanup: many local-load implementations only register a model when
   * it isn't already registered under that same model id - a plain reload
   * would find the id still registered (as delegated, pointing at the dead
   * provider) and silently no-op, leaving the model delegated forever and
   * turning every later request into another doomed connection attempt to
   * the same dead provider. `unloadModel()` on a delegated model is
   * expected to unregister it synchronously before even trying to notify
   * the (unreachable) provider, so this is safe and fast even with the
   * provider down. Best-effort: if the unload itself fails, still attempt
   * the reload - the stale entry may cause another no-op fallback, but
   * that's no worse than not trying.
   *
   * Also refreshes `getCachedDelegationInfo()`'s cache once the reload
   * settles - without this, a host's status endpoint would keep reporting
   * the pre-recovery "running on remote peer" snapshot from the original
   * preload forever, even after the model is genuinely running locally
   * again.
   */
  private async recoverFromDelegationFailure(): Promise<string> {
    this.recovering = true;
    try {
      const staleModelId = await this.modelIdPromise;
      this.modelIdPromise = undefined;
      if (staleModelId) {
        await this.service.unloadModel(staleModelId).catch(() => {});
      }
      const modelId = await this.ensureModel();
      await this.getDelegationInfo();
      return modelId;
    } finally {
      this.recovering = false;
    }
  }

  /**
   * Runs `service.chatComplete`, recovering once if it fails specifically
   * because the delegated provider died mid-session - reloads (falling
   * back to local) and retries against the new model. Any other failure,
   * or a second failure after recovery, propagates as-is: this is a
   * one-shot recovery, not a retry loop.
   */
  private async chatCompleteWithRecovery(
    modelId: string,
    request: QvacChatCompletionRequest,
  ): Promise<QvacChatCompletionResult> {
    const pending = this.service.chatComplete(modelId, request);
    this.activeRequestId = pending.requestId;
    try {
      return await pending;
    } catch (error) {
      if (!this.isRetryableProviderError(error)) throw error;
      const recoveredModelId = await this.recoverFromDelegationFailure();
      const retryPending = this.service.chatComplete(recoveredModelId, request);
      this.activeRequestId = retryPending.requestId;
      return await retryPending;
    } finally {
      this.activeRequestId = undefined;
    }
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const modelId = await this.ensureModel();

    const result = await this.chatCompleteWithRecovery(modelId, {
      history: messages.map(toChatMessage),
      tools: options.tools,
      temperature: options.temperature ?? this.temperature,
      seed: options.seed,
      sessionId: options.sessionId,
      kvCacheEnabled: this.kvCacheEnabled,
    });

    const aiMessage = new AIMessage({
      content: result.text,
      tool_calls: toLangChainToolCalls(result.toolCalls),
      additional_kwargs: result.thinkingText
        ? { thinkingText: result.thinkingText }
        : undefined,
    });

    return {
      generations: [{ text: result.text, message: aiMessage }],
      llmOutput: result.stats ? { stats: result.stats } : undefined,
    };
  }

  /**
   * Bridges `service.chatComplete`'s callback-based streaming into an async
   * generator: each `onToken` call is queued and yielded as a
   * `ChatGenerationChunk` carrying just its text delta, then one final
   * content-empty chunk carries `tool_calls`/`thinkingText`/`stats` once
   * `chatComplete`'s promise resolves - the same result `_generate` returns,
   * split into deltas plus a trailer.
   */
  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const modelId = await this.ensureModel();

    type QueueItem =
      | { kind: "token"; textDelta: string }
      | { kind: "done"; result: QvacChatCompletionResult }
      | { kind: "error"; error: unknown };

    const queue: QueueItem[] = [];
    let notify: (() => void) | undefined;
    // Recovery is only safe before the user has seen any output - a
    // provider dying after tokens already streamed can't be silently
    // retried without duplicating/garbling what's already shown, so that
    // case surfaces the error as-is instead (see `startCompletion` below).
    let anyTokenEmitted = false;
    const push = (item: QueueItem) => {
      if (item.kind === "token") anyTokenEmitted = true;
      queue.push(item);
      notify?.();
      notify = undefined;
    };

    const request: QvacChatCompletionRequest = {
      history: messages.map(toChatMessage),
      tools: options.tools,
      temperature: options.temperature ?? this.temperature,
      seed: options.seed,
      sessionId: options.sessionId,
      kvCacheEnabled: this.kvCacheEnabled,
    };

    // A named, re-callable function (rather than the inline
    // `pending.then/catch` this replaced) so a provider-unreachable
    // failure can transparently restart the whole call against a
    // recovered (local) model id, without restructuring the queue-draining
    // loop below. `activeRequestId` is set at the start of each attempt
    // and only cleared right before a terminal ("done"/"error") item is
    // pushed - never in a shared `.finally()`, which would otherwise let
    // the original (now-superseded) attempt's cleanup clobber the retry's
    // `activeRequestId` after it's already been reassigned.
    const startCompletion = (id: string): void => {
      const pending = this.service.chatComplete(
        id,
        request,
        (textDelta) => push({ kind: "token", textDelta }),
      );
      this.activeRequestId = pending.requestId;
      pending
        .then((result) => {
          this.activeRequestId = undefined;
          push({ kind: "done", result });
        })
        .catch((error: unknown) => {
          if (!anyTokenEmitted && this.isRetryableProviderError(error)) {
            this.recoverFromDelegationFailure().then(startCompletion, () => {
              this.activeRequestId = undefined;
              push({ kind: "error", error });
            });
            return;
          }
          this.activeRequestId = undefined;
          push({ kind: "error", error });
        });
    };
    startCompletion(modelId);

    while (true) {
      const item = queue.shift();
      if (!item) {
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
        continue;
      }

      if (item.kind === "token") {
        await runManager?.handleLLMNewToken(item.textDelta);
        yield new ChatGenerationChunk({
          text: item.textDelta,
          message: new AIMessageChunk({ content: item.textDelta }),
        });
        continue;
      }

      if (item.kind === "error") {
        throw item.error;
      }

      yield new ChatGenerationChunk({
        text: "",
        message: new AIMessageChunk({
          content: "",
          tool_calls: toLangChainToolCalls(item.result.toolCalls),
          additional_kwargs: item.result.thinkingText
            ? { thinkingText: item.result.thinkingText }
            : undefined,
        }),
        generationInfo: item.result.stats
          ? { stats: item.result.stats }
          : undefined,
      });
      return;
    }
  }
}
