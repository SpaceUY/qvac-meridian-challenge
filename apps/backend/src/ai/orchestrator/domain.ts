import * as z from "zod";
import { MessagesValue, StateSchema } from "@langchain/langgraph";
import type { RetrievedChunk } from "../../rag/domain/types.js";

export const State = new StateSchema({
  messages: MessagesValue,
  chunks: z.array(z.custom<RetrievedChunk>()).default(() => []),
  hasEvidence: z.boolean().default(false),
  /** Whether the last human turn attached an image - NOT whether that image is relevant to the question, just that one is present. See ragGraph.const.ts's GROUNDING_INSTRUCTIONS for how the model is told to handle an irrelevant one. */
  hasVisualInput: z.boolean().default(false),
});
