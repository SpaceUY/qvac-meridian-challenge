import { randomUUID } from "node:crypto";
import type { ConversationMessage } from "../ai/orchestrator/agentService.js";
import type { Citation } from "../rag/domain/types.js";
import { PUBLIC_CHAT_MODEL } from "./chat.router.const.js";

/**
 * Parses the OpenAI-shaped `messages` array, dropping any `system` role — the
 * API never forwards those (spec §4). Returns `ConversationMessage[]`
 * (`{role, message}`) — `AgentService.invoke()`'s own shape — so this file is
 * the one place that knows the wire format (`content`) differs from it.
 */
export function parseMessages(body: unknown): ConversationMessage[] | undefined {
  const messages = parseMessageEntries(body);
  return messages && messages.length > 0 ? messages : undefined;
}

/**
 * Same parsing as parseMessages, but for a voice turn: `messages` here is
 * the turn's prior history and MAY be empty (the new turn arrives as audio,
 * appended separately by VoiceAgentService after transcription) - only a
 * missing/malformed `messages` field is rejected, not an empty array.
 */
export function parseHistory(body: unknown): ConversationMessage[] | undefined {
  return parseMessageEntries(body);
}

function parseMessageEntries(body: unknown): ConversationMessage[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.messages)) return undefined;
  const messages: ConversationMessage[] = [];
  for (const entry of body.messages) {
    if (!isRecord(entry)) return undefined;
    if (entry.role === "system") continue;
    if ((entry.role !== "user" && entry.role !== "assistant") || typeof entry.content !== "string") {
      return undefined;
    }
    messages.push({ role: entry.role, message: entry.content });
  }
  return messages;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Decodes the voice endpoint's `audioBase64` field into a Buffer. Undefined if missing, not a string, or empty. */
export function parseAudioBase64(body: unknown): Buffer | undefined {
  if (!isRecord(body) || typeof body.audioBase64 !== "string" || body.audioBase64.length === 0) {
    return undefined;
  }
  return Buffer.from(body.audioBase64, "base64");
}

/** The fields every object of ONE completion shares: OpenAI repeats the same id/created/model on each stream chunk. */
export interface CompletionEnvelope {
  id: string;
  /** Unix time in SECONDS, as OpenAI sends it. */
  created: number;
  model: string;
}

/** Echoes the requested `model` (validating the alias is Ticket 4's job), or the public alias if absent. */
export function createEnvelope(body: unknown, now: Date = new Date()): CompletionEnvelope {
  const requested = isRecord(body) && typeof body.model === "string" && body.model !== "" ? body.model : undefined;
  return {
    id: `chatcmpl-${randomUUID()}`,
    created: Math.floor(now.getTime() / 1000),
    model: requested ?? PUBLIC_CHAT_MODEL,
  };
}

/** OpenAI's default is NOT streaming: only an explicit `stream: true` gets SSE. */
export function wantsStream(body: unknown): boolean {
  return isRecord(body) && body.stream === true;
}

/** The `stream: false` response: a whole `chat.completion`. `citations` sits on the message - where the evaluator reads it. */
export function toCompletionResponse(envelope: CompletionEnvelope, answer: string, citations: Citation[]) {
  return {
    ...envelope,
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: answer, refusal: null, citations },
        logprobs: null,
        finish_reason: "stop",
      },
    ],
  };
}

type StreamDelta = { role?: "assistant"; content?: string; citations?: Citation[] };

/** One `chat.completion.chunk` as an SSE event. */
function toChunkEvent(envelope: CompletionEnvelope, delta: StreamDelta, finishReason: "stop" | null = null): string {
  const chunk = {
    ...envelope,
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/** First chunk: announces the role with empty content, as OpenAI does. */
export function toRoleChunk(envelope: CompletionEnvelope): string {
  return toChunkEvent(envelope, { role: "assistant", content: "" });
}

export function toTextChunk(envelope: CompletionEnvelope, text: string): string {
  return toChunkEvent(envelope, { content: text });
}

/** The last content chunk, sent once the answer is final (what to cite depends on it). Sent even when empty, so "none" is explicit. */
export function toCitationsChunk(envelope: CompletionEnvelope, citations: Citation[]): string {
  return toChunkEvent(envelope, { citations });
}

/** The closing chunk (empty delta + finish_reason) followed by the SSE terminator. */
export function toDoneChunk(envelope: CompletionEnvelope): string {
  return `${toChunkEvent(envelope, {}, "stop")}data: [DONE]\n\n`;
}
