import {
  StateSchema,
  MessagesValue,
  type GraphNode,
  type ConditionalEdgeRouter,
  StateGraph,
  START,
  END,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import {
  SystemMessage,
  AIMessage,
  ToolMessage,
  HumanMessage,
} from "@langchain/core/messages";
import * as z from "zod";
import { tool } from "@langchain/core/tools";
import {
  DATA_AS_OF,
  INVENTORY,
  listSkus,
  lookupStock,
} from "meridian-stock-tool";

// 1. Initialize the Chat Model pointing to the local QVAC server
const qvacModel = new ChatOpenAI({
  // Point to your QVAC local HTTP server
  configuration: {
    baseURL: "http://localhost:11434/v1",
  },
  // Pass your QVAC hosted model name (defined in your qvac.config.json)
  modelName: "qwen3-600m-inst-q4", //"llama-tool-calling-1b-inst-q4-k",
  // QVAC runs locally and does not require an official OpenAI token,
  // but LangChain requires a non-empty string placeholder to pass validation.
  openAIApiKey: "",
  temperature: 0, // temperature: 0.7 being too high for a 600M/Q4 quantized model to reliably follow the strict tool-call format.
});

const State = new StateSchema({
  messages: MessagesValue,
});

export const lookupStockTool = tool(
  // The first argument is the function implementation.
  // It takes an empty object argument because of the Zod schema definition.
  (args) => {
    console.log("checking stock ...");
    return lookupStock(args);
  },
  {
    name: "lookup_stock",
    description:
      `Meridian inventory as of ${DATA_AS_OF}. Returns structured stock records only. ` +
      "An unknown SKU returns no matches plus suggestions — do not invent stock or prices.",

    schema: z.object({
      sku: z.string().optional().describe("Exact SKU, e.g. SD-X4-001"),
      query: z
        .string()
        .optional()
        .describe("Free-text search against name or product line"),
      region: z.enum(["Americas", "EMEA", "APAC"]).optional(),
      includeDiscontinued: z.boolean().optional(),
    }),
  },
);

// Augment the LLM with tools
const toolsByName: Record<string, typeof lookupStockTool> = {
  [lookupStockTool.name]: lookupStockTool,
};

const tools = Object.values(toolsByName);

const modelWithTools = qvacModel.bindTools(tools);

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

const graph = new StateGraph(State)
  .addNode("llm", llmCall, { retryPolicy: { maxAttempts: 2 } })
  .addNode("toolNode", toolNode)
  .addEdge(START, "llm")
  .addConditionalEdges("llm", shouldContinue, ["toolNode", END])
  .addEdge("toolNode", "llm")
  .compile();

export async function meridianGraph(
  prompt: string,
): Promise<AIMessage["content"] | undefined> {
  const result = await graph.invoke({
    messages: [new HumanMessage(prompt)],
  });

  const lastAIMessage = [...result.messages]
    .reverse()
    .find((message): message is AIMessage => AIMessage.isInstance(message));

  return lastAIMessage?.content;
}

const content = await meridianGraph(
  "Can you give me all the stock information about SKU: SD-X4-HT?",
);
console.log(content);
