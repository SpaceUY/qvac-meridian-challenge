import * as z from "zod";
import { MessagesValue, StateSchema } from "@langchain/langgraph";
import type { RetrievedChunk } from "../../rag/domain/types.js";

export const State = new StateSchema({
  messages: MessagesValue,
  chunks: z.array(z.custom<RetrievedChunk>()).default(() => []),
  hasEvidence: z.boolean().default(false),
  /** Whether the last human turn attached an image - NOT whether that image is relevant to the question, just that one is present. See ragGraph.const.ts's GROUNDING_INSTRUCTIONS for how the model is told to handle an irrelevant one. */
  hasVisualInput: z.boolean().default(false),
  /** Per-request override forwarded to the model call (Req 6.1.3) - see `GenerationOptions` below. Absent unless the caller supplied one. */
  temperature: z.number().optional(),
  seed: z.number().optional(),
  /** KV cache session key forwarded to the model call, from the `X-Meridian-Session` header - see `GenerationOptions` below. */
  sessionId: z.string().optional(),
});

/**
 * Per-request generation overrides an HTTP caller may supply (OpenAI's own
 * `temperature`/`seed` fields on `POST /v1/chat/completions`). Lives here,
 * not in `chat/chat.router.helpers.ts`, even though the HTTP layer is what
 * first populates it: `AgentService` (this directory) consumes it, and an
 * inner layer must not import a type from the outer `chat/` layer - see
 * this task's "Layering note". `chat.router.helpers.ts`'s
 * `parseGenerationOptions()` imports this type rather than declaring it.
 */
export interface GenerationOptions {
  temperature?: number;
  seed?: number;
  /** KV cache session key, forwarded from the `X-Meridian-Session` header. */
  sessionId?: string;
}
