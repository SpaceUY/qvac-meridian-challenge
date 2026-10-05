import * as z from "zod";
import { MessagesValue, StateSchema } from "@langchain/langgraph";
import type { RetrievedChunk } from "../../rag/domain/types.js";
import type { ChatCompletionStats } from "../../models/domain/types.js";

export const State = new StateSchema({
  messages: MessagesValue,
  chunks: z.array(z.custom<RetrievedChunk>()).default(() => []),
  hasEvidence: z.boolean().default(false),
  /** Whether the last turn attached an image, not whether it's relevant - see ragGraph.const.ts's GROUNDING_INSTRUCTIONS. */
  hasVisualInput: z.boolean().default(false),
  temperature: z.number().optional(),
  seed: z.number().optional(),
  /** KV cache session key, from the `X-Meridian-Session` header. */
  sessionId: z.string().optional(),
  /** `AgentService.invoke()`'s requestId, so a concurrent completion can be tracked/cancelled independently - see `QvacChatSession`. */
  requestId: z.string().optional(),
  /** Last model call's token counters; overwritten each llm-node run, so a tool loop keeps the final call's. Absent if the runtime reported none. */
  completionStats: z.custom<ChatCompletionStats>().optional(),
});

/** Per-request generation overrides (OpenAI's `temperature`/`seed`). Lives here rather than `chat/chat.router.helpers.ts` since an inner layer can't import from the outer `chat/` layer. */
export interface GenerationOptions {
  temperature?: number;
  seed?: number;
  sessionId?: string;
}
