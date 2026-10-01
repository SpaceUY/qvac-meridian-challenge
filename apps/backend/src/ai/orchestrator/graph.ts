import {
  type GraphNode,
  type ConditionalEdgeRouter,
  StateGraph,
  START,
  END,
} from "@langchain/langgraph";
import {
  SystemMessage,
  AIMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { lookupStockTool } from "./stockTool.js";
import { createListDocumentsTool } from "./listDocumentsTool.js";
import { ChatQVAC } from "qvac-langgraph";
import { buildGroundedContext } from "../../rag/service/contextBuilder.js";
import { isCancellationError } from "../../models/domain/errors.js";
import { State } from "./domain.js";
import {
  GROUNDING_INSTRUCTIONS,
  INSUFFICIENT_CONTEXT_MESSAGE,
} from "./ragGraph.const.js";
import type { RagRetrievalService } from "../../rag/service/rag.service.js";
import { buildRetrieveNode } from "./ragGraph.js";
import { BindToolsInput } from "@langchain/core/language_models/chat_models";
import type { AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { DocumentRepository } from "../../document/domain/document-repository.port.js";

const SYSTEM_PROMPT = `You are Meridian's internal assistant.

For stock and inventory questions (SKU, stock levels, price, lead time, region availability), always call the lookup_stock tool instead of answering from memory. SKUs follow a specific format, e.g. SD-X4-001 — use the tool's sku field when one is recognized in the user's query. Never answer stock related queries without calling lookup_stock.

For everything else, ground your answer only in the evidence actually available to you this turn: the Context section below (retrieved company documents), an image the user attached to this message, and/or tool results. Combine sources when more than one is relevant. An attached image is not automatically relevant to the question — if it doesn't actually help answer it, say so instead of guessing from it.

${GROUNDING_INSTRUCTIONS}`;


/**
 * Tag that LangGraph's "messages" stream mode checks to skip a chat model
 * call's tokens (`handleChatModelStart` in @langchain/langgraph's
 * dist/pregel/messages.js). The node's returned message is still emitted
 * once, when the node ends.
 */
const NO_STREAM_TAG = "nostream";

/**
 * Whether the grounding guard in `buildLlmNode` may replace this turn's
 * reply: only when retrieval found no evidence and no tool has run yet.
 * Both are known before the model is called, which is what lets the node
 * decide up front whether the reply may stream.
 */
function guardMayReplaceReply(state: typeof State.State): boolean {
  const usedTool = state.messages.some((message) =>
    ToolMessage.isInstance(message),
  );
  return !state.hasEvidence && !state.hasVisualInput && !usedTool;
}

/**
 * Runs one model call and merges its streamed chunks into a single reply.
 * `hidden` keeps the tokens off the client's stream (see `NO_STREAM_TAG`).
 */
async function generateReply(
  model: ReturnType<ChatQVAC["bindTools"]>,
  messages: BaseMessage[],
  { hidden, temperature, seed, sessionId, requestId }: { hidden: boolean; temperature?: number; seed?: number; sessionId?: string; requestId?: string },
): Promise<AIMessageChunk> {
  const stream = await model.stream(messages, {
    ...(hidden ? { tags: [NO_STREAM_TAG] } : {}),
    temperature,
    seed,
    sessionId,
    requestId,
  });
  let reply: AIMessageChunk | undefined;
  for await (const chunk of stream) {
    reply = reply ? reply.concat(chunk) : chunk;
  }
  if (!reply) {
    throw new Error("model stream produced no chunks");
  }
  return reply;
}

export function buildLlmNode(
  tools: BindToolsInput[],
  model: ChatQVAC,
): GraphNode<typeof State> {
  return async (state) => {
    const context = buildGroundedContext(state.chunks);
    const systemMessage = new SystemMessage(
      `${SYSTEM_PROMPT}\n\nContext:\n${context}`,
    );

    // Decided before the model runs: a reply the guard below may discard
    // must never stream, or the client sees it with the fallback glued on.
    const guardMayReplace = guardMayReplaceReply(state);
    const response = await generateReply(
      model.bindTools(tools),
      [systemMessage, ...state.messages],
      {
        hidden: guardMayReplace,
        temperature: state.temperature,
        seed: state.seed,
        sessionId: state.sessionId,
        requestId: state.requestId,
      },
    );

    // Guard against hallucinated/refused answers: if this turn never called a
    // tool and retrieval found no supporting evidence, don't trust freeform
    // model text — fall back to the fixed insufficient-context message.
    if (guardMayReplace && !response.tool_calls?.length) {
      return { messages: [new AIMessage(INSUFFICIENT_CONTEXT_MESSAGE)] };
    }

    return { messages: [response] };
  };
}

export function buildToolNode(
  toolsByName: Record<string, StructuredToolInterface>,
): GraphNode<typeof State> {
  return async (state) => {
    const lastMessage = state.messages[state.messages.length - 1];

    if (lastMessage == null || !AIMessage.isInstance(lastMessage)) {
      return { messages: [] };
    }

    const result: ToolMessage[] = [];
    for (const toolCall of lastMessage.tool_calls ?? []) {
      const tool = toolsByName[toolCall.name];
      console.log(`looking for tool: ${toolCall.name}`);

      if (!tool) {
        result.push(
          new ToolMessage({
            content: `Tool "${toolCall.name}" does not exist.`,
            tool_call_id: toolCall.id ?? "",
            name: toolCall.name,
            status: "error",
          }),
        );
        continue;
      }

      const observation = await tool.invoke(toolCall);
      result.push(observation);
    }

    return { messages: result };
  };
}

/** Builds the compiled stock-assistant graph around the given chat model. */
export function createGraph(
  model: ChatQVAC,
  ragService: RagRetrievalService,
  documentRepository: DocumentRepository,
) {
  // Augment the LLM with tools
  const listDocumentsTool = createListDocumentsTool(documentRepository);
  const toolsByName: Record<string, StructuredToolInterface> = {
    [lookupStockTool.name]: lookupStockTool,
    [listDocumentsTool.name]: listDocumentsTool,
  };

  const shouldContinue: ConditionalEdgeRouter<{
    InputSchema: typeof State;
    Nodes: "toolNode";
  }> = (state) => {
    const lastMessage = state.messages[state.messages.length - 1];
    // Check if it's an AIMessage before accessing tool_calls
    if (!lastMessage || !AIMessage.isInstance(lastMessage)) {
      return END;
    }

    if (lastMessage.tool_calls?.length) {
      return "toolNode";
    }

    // Otherwise, we stop (reply to the user)
    return END;
  };

  const tools = Object.values(toolsByName);

  const ragNode: GraphNode<typeof State> = buildRetrieveNode(ragService);

  const llmCall: GraphNode<typeof State> = buildLlmNode(tools, model);

  const toolNode: GraphNode<typeof State> = buildToolNode(toolsByName);

  return new StateGraph(State)
    .addNode("llm", llmCall, {
      retryPolicy: { maxAttempts: 2, retryOn: (error) => !isCancellationError(error) },
    })
    .addNode("rag", ragNode)
    .addNode("toolNode", toolNode)
    .addEdge(START, "rag")
    .addEdge("rag", "llm")
    .addConditionalEdges("llm", shouldContinue, ["toolNode", END])
    .addEdge("toolNode", "llm")
    .compile();
}
