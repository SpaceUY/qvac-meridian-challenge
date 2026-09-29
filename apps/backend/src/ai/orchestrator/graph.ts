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

const SYSTEM_PROMPT =
  "You are a helpful company inventory and stock records assistant tasked to report stock information by name or product line and from different geographical regions. Use the provided lookup_stock tool if the user ask about stock information. There are stock items identifiers named as SKU, and they have a specific format, e.g. SD-X4-001, use specific sku lookup_stock tool's field when a specific SKU inquire is recognized in the user's query. Never answer stock related queries without calling lookup_stock.";

export function buildLlmNode(
  tools: BindToolsInput[],
  model: ChatQVAC,
): GraphNode<typeof State> {
  return async (state) => {
    const systemMessagePrompt = new SystemMessage(`${SYSTEM_PROMPT}`);

    const context = buildGroundedContext(state.chunks);
    const systemContextMessage = new SystemMessage(
      `${GROUNDING_INSTRUCTIONS}\n\nContext:\n${context}`,
    );

    const modelWithTools = model.bindTools(tools);

    const response = await modelWithTools.invoke([
      systemMessagePrompt,
      systemContextMessage,
      ...state.messages,
    ]);
    return { messages: [response] };
  };
}

export function buildToolNode(
  toolsByName: Record<string, typeof lookupStockTool>,
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
export function createGraph(model: ChatQVAC, ragService: RagRetrievalService) {
  // Augment the LLM with tools
  const toolsByName: Record<string, typeof lookupStockTool> = {
    [lookupStockTool.name]: lookupStockTool,
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
