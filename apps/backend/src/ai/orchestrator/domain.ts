import * as z from "zod";
import { MessagesValue, StateSchema } from "@langchain/langgraph";
import type { RetrievedChunk } from "../../rag/domain/types.js";

export const State = new StateSchema({
  messages: MessagesValue,
  chunks: z.array(z.custom<RetrievedChunk>()).default(() => []),
  hasEvidence: z.boolean().default(false),
});
