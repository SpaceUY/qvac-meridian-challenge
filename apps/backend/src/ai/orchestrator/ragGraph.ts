import {
  type GraphNode,
  type ConditionalEdgeRouter,
} from "@langchain/langgraph";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { ChatQVAC } from "@space-uy/qvac-langgraph";
import type { RagRetrievalService } from "../../rag/service/rag.service.js";
import { buildGroundedContext } from "../../rag/service/contextBuilder.js";
import {
  GROUNDING_INSTRUCTIONS,
  INSUFFICIENT_CONTEXT_MESSAGE,
} from "./ragGraph.const.js";
import { State } from "./domain.js";

/** Whether `message` carries at least one image content block - used to compute `hasVisualInput` for the graph state. */
export function hasImageContent(message: BaseMessage): boolean {
  return message.contentBlocks.some((block) => block.type === "image");
}

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
      // Empty query (image-only turn) skips RAG rather than risk meaningless embedding-search results.
      return { chunks: [], hasEvidence: false, hasVisualInput };
    }

    const result = await ragService.retrieve(query);
    return {
      chunks: result.chunks,
      hasEvidence: result.hasEvidence,
      hasVisualInput,
    };
  };
}

/** The only place that decides whether evidence is sufficient to call the model. */
export const routeOnEvidence: ConditionalEdgeRouter<{
  InputSchema: typeof State;
  Nodes: "llm" | "insufficientContext";
}> = (state) =>
  state.hasEvidence || state.hasVisualInput ? "llm" : "insufficientContext";

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
