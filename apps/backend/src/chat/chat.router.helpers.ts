import type { ConversationMessage } from "../ai/orchestrator/agentService.js";

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

/** One OpenAI-shaped SSE chunk carrying the full text as a single delta. */
export function toTextChunk(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

/** The closing chunk (empty delta + finish_reason) followed by the SSE terminator. */
export function toDoneChunk(): string {
  return `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
}
