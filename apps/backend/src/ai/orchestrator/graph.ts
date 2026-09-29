import {
  StateSchema,
  MessagesValue,
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

const State = new StateSchema({
  messages: MessagesValue,
});

/** Builds the compiled stock-assistant graph around the given chat model. */
export function createGraph(model: ChatQVAC) {
  // Augment the LLM with tools
  const toolsByName: Record<string, typeof lookupStockTool> = {
    [lookupStockTool.name]: lookupStockTool,
  };

  const tools = Object.values(toolsByName);

  const modelWithTools = model.bindTools(tools);

  const llmCall: GraphNode<typeof State> = async (state) => {
    const response = await modelWithTools.invoke([
      new SystemMessage(
        "You are a helpful company inventory and stock records assistant tasked to report stock information by name or product line and from different geographical regions. Use the provided lookup_stock tool if the user ask about stock information. There are stock items identifiers named as SKU, and they have a specific format, e.g. SD-X4-001, use specific sku lookup_stock tool's field when a specific SKU inquire is recognized in the user's query. Never answer stock related queries without calling lookup_stock.",
      ),
      ...state.messages,
    ]);
    return {
      messages: [response],
    };
  };

  const toolNode: GraphNode<typeof State> = async (state) => {
    const lastMessage = state.messages[state.messages.length - 1];

    if (lastMessage == null || !AIMessage.isInstance(lastMessage)) {
      return { messages: [] };
    }

    const result: ToolMessage[] = [];
    for (const toolCall of lastMessage.tool_calls ?? []) {
      const tool = toolsByName[toolCall.name];
      console.log(`looking for tool: ${toolCall.name}`);
      const observation = await tool.invoke(toolCall);
      result.push(observation);
    }

    return { messages: result };
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

    // If the LLM makes a tool call, then perform an action
    if (lastMessage.tool_calls?.length) {
      return "toolNode";
    }

    // Otherwise, we stop (reply to the user)
    return END;
  };

  return new StateGraph(State)
    .addNode("llm", llmCall, { retryPolicy: { maxAttempts: 2 } })
    .addNode("toolNode", toolNode)
    .addEdge(START, "llm")
    .addConditionalEdges("llm", shouldContinue, ["toolNode", END])
    .addEdge("toolNode", "llm")
    .compile();
}
