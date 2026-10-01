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
import { ChatQVAC } from "./qvacChatModel.js";
import { buildGroundedContext } from "../../rag/service/contextBuilder.js";
import { State } from "./domain.js";
import {
  GROUNDING_INSTRUCTIONS,
  INSUFFICIENT_CONTEXT_MESSAGE,
} from "./ragGraph.const.js";
import type { RagRetrievalService } from "../../rag/service/rag.service.js";
import { buildRetrieveNode } from "./ragGraph.js";
import { BindToolsInput } from "@langchain/core/language_models/chat_models";
import type { AIMessageChunk } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { DocumentRepository } from "../../document/domain/document-repository.port.js";

const SYSTEM_PROMPT = `You are Meridian's internal assistant. You handle two kinds of questions:

1. Stock and inventory questions (SKU, stock levels, price, lead time, region availability). Always call the lookup_stock tool for these instead of answering from memory. SKUs follow a specific format, e.g. SD-X4-001 — use the tool's sku field when one is recognized in the user's query. Never answer stock related queries without calling lookup_stock.
2. Questions about company documents (deals, warranty terms, SLAs, policies, reports, etc). Answer these using only the Context section below.

${GROUNDING_INSTRUCTIONS}`;

export function buildLlmNode(
  tools: BindToolsInput[],
  model: ChatQVAC,
): GraphNode<typeof State> {
  return async (state) => {
    const context = buildGroundedContext(state.chunks);
    const systemMessage = new SystemMessage(
      `${SYSTEM_PROMPT}\n\nContext:\n${context}`,
    );

    const modelWithTools = model.bindTools(tools);

    const stream = await modelWithTools.stream([
      systemMessage,
      ...state.messages,
    ]);
    let response: AIMessageChunk | undefined;
    for await (const chunk of stream) {
      response = response ? response.concat(chunk) : chunk;
    }
    if (!response) {
      throw new Error("model stream produced no chunks");
    }

    // Guard against hallucinated/refused answers: if this turn never called a
    // tool and retrieval found no supporting evidence, don't trust freeform
    // model text — fall back to the fixed insufficient-context message.
    const usedTool = state.messages.some((message) =>
      ToolMessage.isInstance(message),
    );
    if (!response.tool_calls?.length && !state.hasEvidence && !usedTool) {
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
    .addNode("llm", llmCall, { retryPolicy: { maxAttempts: 2 } })
    .addNode("rag", ragNode)
    .addNode("toolNode", toolNode)
    .addEdge(START, "rag")
    .addEdge("rag", "llm")
    .addConditionalEdges("llm", shouldContinue, ["toolNode", END])
    .addEdge("toolNode", "llm")
    .compile();
}
