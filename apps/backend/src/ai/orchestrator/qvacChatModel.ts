import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BaseChatModelParams,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import {
  AIMessage,
  type AIMessageChunk,
  type BaseMessage,
} from "@langchain/core/messages";
import type { ToolCall } from "@langchain/core/messages/tool";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { ChatResult } from "@langchain/core/outputs";
import type { Runnable } from "@langchain/core/runnables";
import type { ModelManagementService } from "../../models/service/models.service.js";
import type {
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

  // Tool-call turns carry no text content; serialize the calls so the model
  // can see its own prior turn when the history is replayed.
  if (
    AIMessage.isInstance(message) &&
    !message.text &&
    message.tool_calls?.length
  ) {
    return {
      role,
      content: JSON.stringify({ tool_calls: message.tool_calls }),
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
  private modelIdPromise?: Promise<string>;

  constructor(fields: QVACChatModelInput) {
    super(fields);
    this.service = fields.service;
    this.modelSource = fields.modelSource;
    this.ctxSize = fields.ctxSize ?? 4096;
    this.temperature = fields.temperature;
  }

  static lc_name(): string {
    return "ChatQVAC";
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

  private ensureModel(): Promise<string> {
    if (!this.modelIdPromise) {
      this.modelIdPromise = this.service
        .loadModel(this.modelSource, {
          ctxSize: this.ctxSize,
          // The llamacpp-completion addon only parses tool calls when the model
          // was loaded with `tools: true` *and* the request carries tools -
          // load-time opt-in is required even though it's a no-op without the
          // latter, so this can't be deferred to bindTools()/_generate().
          tools: true,
        })
        .then((loaded) => loaded.modelId);
    }
    return this.modelIdPromise;
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const modelId = await this.ensureModel();

    const result = await this.service.chatComplete(modelId, {
      history: messages.map(toChatMessage),
      tools: options.tools,
      temperature: this.temperature,
    });

    const aiMessage = new AIMessage({
      content: result.text,
      tool_calls: toLangChainToolCalls(result.toolCalls),
    });

    return {
      generations: [{ text: result.text, message: aiMessage }],
      llmOutput: result.stats ? { stats: result.stats } : undefined,
    };
  }
}
