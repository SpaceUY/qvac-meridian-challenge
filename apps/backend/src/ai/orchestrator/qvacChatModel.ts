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
import type { ModelManagementService } from "../../models/service/models.service.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatMessage,
  ChatTool,
  ChatToolCall,
  ChatToolProperty,
  ModelSource,
} from "../../models/domain/types.js";

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
  service: ModelManagementService;
  /** Where to load model weights from, via `ModelManagementService`. */
  modelSource: ModelSource;
  ctxSize?: number;
  temperature?: number;
  /** Opaque per-engine load config (e.g. a multimodal model's `projectionModelSrc`), merged as-is into the SDK's `modelConfig` alongside `ctxSize`/`tools`. */
  engineConfig?: Record<string, unknown>;
}

export interface ChatQVACCallOptions extends BaseChatModelCallOptions {
  tools?: ChatTool[];
}

/**
 * Converts a LangChain tool definition into the models service's flat
 * `ChatTool` shape. The underlying completion engine's tool schema only
 * supports primitive-typed properties (no nested object/array item
 * schemas), so only `type`/`description`/`enum` survive - that's all it
 * accepts.
 */
function toChatTool(tool: BindToolsInput): ChatTool {
  const { function: fn } = convertToOpenAITool(
    tool as Parameters<typeof convertToOpenAITool>[0],
  );
  const schema = (fn.parameters ?? {}) as JsonSchemaObject;

  const properties: Record<string, ChatToolProperty> = {};
  for (const [key, value] of Object.entries(schema.properties ?? {})) {
    properties[key] = {
      type: (value.type as ChatToolProperty["type"]) ?? "string",
      description: value.description,
      enum: value.enum as ChatToolProperty["enum"],
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

function toChatMessage(message: BaseMessage): ChatMessage {
  const role = QVAC_ROLE_BY_MESSAGE_TYPE[message.type] ?? "user";

  // Tool-call turns carry no dedicated field in `ChatMessage`; serialize
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

  return { role, content: message.text };
}

function toLangChainToolCalls(toolCalls: ChatToolCall[]): ToolCall[] {
  return toolCalls.map((call) => ({
    type: "tool_call",
    id: call.id,
    name: call.name,
    args: call.arguments,
  }));
}

export class ChatQVAC extends BaseChatModel<ChatQVACCallOptions> {
  private readonly service: ModelManagementService;
  private readonly modelSource: ModelSource;
  private readonly ctxSize: number;
  private readonly temperature?: number;
  private readonly engineConfig?: Record<string, unknown>;
  private modelIdPromise?: Promise<string>;
  /** The `requestId` of the `chatComplete` call currently in flight, if any - lets `cancelActive()` cancel it. */
  private activeRequestId?: string;

  constructor(fields: QVACChatModelInput) {
    super(fields);
    this.service = fields.service;
    this.modelSource = fields.modelSource;
    this.ctxSize = fields.ctxSize ?? 4096;
    this.temperature = fields.temperature;
    this.engineConfig = fields.engineConfig;
  }

  static lc_name(): string {
    return "ChatQVAC";
  }

  /**
   * Cancels the `chatComplete` call currently in flight on this model, if
   * any - used by `AgentService.cancel()` to stop a running `invoke()`.
   * No-op when nothing is in flight (e.g. it already settled).
   */
  async cancelActive(): Promise<void> {
    if (!this.activeRequestId) return;
    await this.service.cancel(this.activeRequestId);
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

  async ensureModel(): Promise<string> {
    if (!this.modelIdPromise) {
      this.modelIdPromise = this.service
        .loadModel(this.modelSource, {
          ctxSize: this.ctxSize,
          // The llamacpp-completion addon only parses tool calls when the model
          // was loaded with `tools: true` *and* the request carries tools -
          // load-time opt-in is required even though it's a no-op without the
          // latter, so this can't be deferred to bindTools()/_generate().
          tools: true,
          engineConfig: this.engineConfig,
        })
        .then((loaded) => loaded.modelId)
        .catch((error: unknown) => {
          this.modelIdPromise = undefined;
          throw error;
        });
    }
    return this.modelIdPromise;
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const modelId = await this.ensureModel();

    const pending = this.service.chatComplete(modelId, {
      history: messages.map(toChatMessage),
      tools: options.tools,
      temperature: this.temperature,
    });
    this.activeRequestId = pending.requestId;
    let result: ChatCompletionResult;
    try {
      result = await pending;
    } finally {
      this.activeRequestId = undefined;
    }

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
      | { kind: "done"; result: ChatCompletionResult }
      | { kind: "error"; error: unknown };

    const queue: QueueItem[] = [];
    let notify: (() => void) | undefined;
    const push = (item: QueueItem) => {
      queue.push(item);
      notify?.();
      notify = undefined;
    };

    const pending = this.service.chatComplete(
      modelId,
      {
        history: messages.map(toChatMessage),
        tools: options.tools,
        temperature: this.temperature,
      },
      (textDelta) => push({ kind: "token", textDelta }),
    );
    this.activeRequestId = pending.requestId;
    pending
      .then((result) => push({ kind: "done", result }))
      .catch((error: unknown) => push({ kind: "error", error }))
      .finally(() => {
        this.activeRequestId = undefined;
      });

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
