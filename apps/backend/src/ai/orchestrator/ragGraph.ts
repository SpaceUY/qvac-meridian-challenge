import {
  type GraphNode,
  type ConditionalEdgeRouter,
  StateGraph,
  START,
  END,
} from "@langchain/langgraph";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { hasImageContent, type ChatQVAC } from "./qvacChatModel.js";
import type { RagRetrievalService } from "../../rag/service/rag.service.js";
import { buildGroundedContext } from "../../rag/service/contextBuilder.js";
import {
  GROUNDING_INSTRUCTIONS,
  INSUFFICIENT_CONTEXT_MESSAGE,
} from "./ragGraph.const.js";
import { State } from "./domain.js";

/** Gathers evidence only - does not decide what happens next (see `routeOnEvidence`). */
export function buildRetrieveNode(
  ragService: RagRetrievalService,
): GraphNode<typeof State> {
  return async (state) => {
    const lastHuman = [...state.messages]
      .reverse()
      .find((message): message is HumanMessage =>
        HumanMessage.isInstance(message),
      );

    if (!lastHuman) {
      return { chunks: [], hasEvidence: false, hasVisualInput: false };
    }

    const hasVisualInput = hasImageContent(lastHuman);
    const query = lastHuman.text.trim();
    if (!query) {
      // An embedding search on an empty string returns meaningless
      // results - an image-only turn (or one with only whitespace text)
      // skips RAG entirely rather than risk surfacing chunks that look
      // like real evidence but aren't.
      return { chunks: [], hasEvidence: false, hasVisualInput };
    }

    const result = await ragService.retrieve(query);
    return { chunks: result.chunks, hasEvidence: result.hasEvidence, hasVisualInput };
  };
}

/** The only place that decides whether evidence is sufficient to call the model. */
export const routeOnEvidence: ConditionalEdgeRouter<{
  InputSchema: typeof State;
  Nodes: "llm" | "insufficientContext";
}> = (state) => (state.hasEvidence || state.hasVisualInput ? "llm" : "insufficientContext");

export const insufficientContextNode: GraphNode<typeof State> = async () => ({
  messages: [new AIMessage(INSUFFICIENT_CONTEXT_MESSAGE)],
});

export function buildLlmNode(model: ChatQVAC): GraphNode<typeof State> {
  return async (state) => {
    const context = buildGroundedContext(state.chunks);
    const systemMessage = new SystemMessage(
      `${GROUNDING_INSTRUCTIONS}\n\nContext:\n${context}`,
    );

    const response = await model.invoke([systemMessage, ...state.messages]);
    return { messages: [response] };
  };
}

/** Builds the compiled always-on-retrieval RAG graph around the given chat model and retrieval service. */
export function createRagGraph(
  model: ChatQVAC,
  ragService: RagRetrievalService,
) {
  return new StateGraph(State)
    .addNode("retrieve", buildRetrieveNode(ragService))
    .addNode("llm", buildLlmNode(model))
    .addNode("insufficientContext", insufficientContextNode)
    .addEdge(START, "retrieve")
    .addConditionalEdges("retrieve", routeOnEvidence, [
      "llm",
      "insufficientContext",
    ])
    .addEdge("llm", END)
    .addEdge("insufficientContext", END)
    .compile();
}
