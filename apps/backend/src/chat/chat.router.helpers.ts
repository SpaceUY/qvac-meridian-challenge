import { randomUUID } from "node:crypto";
import type { ConversationMessage } from "../ai/orchestrator/agentService.js";
import type { GenerationOptions } from "../ai/orchestrator/domain.js";
import type { SupportedImageMimeType } from "../models/domain/types.js";
import type { Citation } from "../rag/domain/types.js";
import {
  INVALID_MESSAGES_ERROR,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_MESSAGE,
  MAX_TOTAL_IMAGE_BYTES,
  PUBLIC_CHAT_MODEL,
} from "./chat.router.const.js";

/**
 * Parses the OpenAI-shaped `messages` array, dropping any `system` role — the
 * API never forwards those (spec §4). Returns `ConversationMessage[]`
 * (`{role, message, images?}`) — `AgentService.invoke()`'s own shape — so this
 * file is the one place that knows the wire format (`content`) differs from it.
 */
export function parseMessages(body: unknown): ConversationMessage[] | undefined {
  const result = parseMessageEntries(body);
  if ("error" in result) return undefined;
  return result.messages.length > 0 ? result.messages : undefined;
}

/**
 * Same parsing as parseMessages, but for a voice turn: `messages` here is
 * the turn's prior history and MAY be empty (the new turn arrives as audio,
 * appended separately by VoiceAgentService after transcription) - only a
 * missing/malformed `messages` field is rejected, not an empty array.
 */
export function parseHistory(body: unknown): ConversationMessage[] | undefined {
  const result = parseMessageEntries(body);
  return "error" in result ? undefined : result.messages;
}

/**
 * The specific reason `parseMessages()`/`parseHistory()` returned `undefined`
 * for this same `body` - e.g. "Only JPEG or PNG images are supported" instead
 * of a generic "invalid messages". Kept as a separate function (re-parsing
 * the body, only ever called on the failure path from chat.router.ts) rather
 * than changing what parseMessages/parseHistory themselves return, so every
 * existing caller and test keeps working against the same `ConversationMessage[]
 * | undefined` shape - only the router's error branch needs the reason.
 */
export function describeParseError(body: unknown): string {
  const result = parseMessageEntries(body);
  return "error" in result ? result.error : INVALID_MESSAGES_ERROR;
}

type ParseResult<T> = T | { error: string };

function parseMessageEntries(body: unknown): ParseResult<{ messages: ConversationMessage[] }> {
  if (!isRecord(body) || !Array.isArray(body.messages)) return { error: INVALID_MESSAGES_ERROR };
  const messages: ConversationMessage[] = [];
  for (const entry of body.messages) {
    if (!isRecord(entry)) return { error: INVALID_MESSAGES_ERROR };
    if (entry.role === "system") continue;
    if (entry.role !== "user" && entry.role !== "assistant") return { error: INVALID_MESSAGES_ERROR };

    const parsedContent = parseContent(entry.content, entry.role);
    if ("error" in parsedContent) return parsedContent;

    messages.push({
      role: entry.role,
      message: parsedContent.text,
      ...(parsedContent.images.length > 0 ? { images: parsedContent.images } : {}),
    });
  }
  return { messages };
}

interface ParsedContent {
  text: string;
  images: { mimeType: SupportedImageMimeType; data: Buffer }[];
}

/**
 * `content` is either a plain string (unchanged behavior) or an OpenAI
 * Vision-style array of parts. Only `role: "user"` may carry an
 * `image_url` part — an assistant/tool turn with an attached image has no
 * defined meaning for this pipeline (see the design spec).
 */
function parseContent(content: unknown, role: "user" | "assistant"): ParseResult<ParsedContent> {
  if (typeof content === "string") return { text: content, images: [] };
  if (!Array.isArray(content)) return { error: INVALID_MESSAGES_ERROR };

  const textParts: string[] = [];
  const images: { mimeType: SupportedImageMimeType; data: Buffer }[] = [];

  for (const part of content) {
    if (!isRecord(part) || typeof part.type !== "string") return { error: INVALID_MESSAGES_ERROR };

    if (part.type === "text") {
      if (typeof part.text !== "string") return { error: INVALID_MESSAGES_ERROR };
      textParts.push(part.text);
      continue;
    }

    if (part.type === "image_url") {
      if (role !== "user") return { error: "Images can only be attached to your own messages" };
      const image = parseImagePart(part);
      if ("error" in image) return image;
      images.push(image);
      continue;
    }

    return { error: INVALID_MESSAGES_ERROR };
  }

  if (images.length > MAX_IMAGES_PER_MESSAGE) {
    return { error: `You can attach up to ${MAX_IMAGES_PER_MESSAGE} images` };
  }
  const totalImageBytes = images.reduce((sum, image) => sum + image.data.byteLength, 0);
  if (totalImageBytes > MAX_TOTAL_IMAGE_BYTES) {
    return { error: "These images are too large together" };
  }

  return { text: textParts.join(""), images };
}

const DATA_URL_PATTERN = /^data:([^;,]+);base64,(.+)$/;

function parseImagePart(
  part: Record<string, unknown>,
): ParseResult<{ mimeType: SupportedImageMimeType; data: Buffer }> {
  const imageUrl = part.image_url;
  if (!isRecord(imageUrl) || typeof imageUrl.url !== "string") return { error: INVALID_MESSAGES_ERROR };

  const match = DATA_URL_PATTERN.exec(imageUrl.url);
  if (!match) return { error: INVALID_MESSAGES_ERROR };

  const data = Buffer.from(match[2], "base64");
  if (data.byteLength === 0) return { error: INVALID_MESSAGES_ERROR };
  if (data.byteLength > MAX_IMAGE_BYTES) {
    return { error: `Image is too large (max ${MAX_IMAGE_BYTES / (1024 * 1024)}MB)` };
  }

  const detectedMimeType = detectImageMimeType(data);
  if (!isSupportedImageMimeType(detectedMimeType)) {
    return { error: "Only JPEG or PNG images are supported" };
  }

  return { mimeType: detectedMimeType, data };
}

type DetectedImageMimeType = "image/jpeg" | "image/png" | "image/webp";

const SUPPORTED_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set<SupportedImageMimeType>([
  "image/jpeg",
  "image/png",
]);

function isSupportedImageMimeType(
  mimeType: DetectedImageMimeType | undefined,
): mimeType is SupportedImageMimeType {
  return mimeType !== undefined && SUPPORTED_IMAGE_MIME_TYPES.has(mimeType);
}

/**
 * Detects the real image format by reading its magic-byte signature,
 * ignoring whatever MIME type the client declared - the demo corpus's own
 * `pic2.png` proved a declared/extension MIME type can't be trusted (it's
 * actually WebP). WebP is recognized here (so it's rejected the same way
 * as any other unsupported format, not with a generic parse failure) but
 * not accepted - see the design spec for why.
 */
function detectImageMimeType(data: Buffer): DetectedImageMimeType | undefined {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return "image/png";
  }
  if (data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Extracts `temperature`/`seed` off the OpenAI-shaped request body, honoring only well-formed values in OpenAI's own accepted range (Req 6.1.3 — deterministic reruns via a stock OpenAI client). Silently drops an out-of-range/malformed value rather than erroring the whole request - matches this file's existing `parseMessages()` philosophy of validating narrowly rather than rejecting a request over an unrelated field. */
export function parseGenerationOptions(body: unknown): GenerationOptions {
  if (!isRecord(body)) return {};
  const options: GenerationOptions = {};
  if (
    typeof body.temperature === "number" &&
    Number.isFinite(body.temperature) &&
    body.temperature >= 0 &&
    body.temperature <= 2
  ) {
    options.temperature = body.temperature;
  }
  if (typeof body.seed === "number" && Number.isSafeInteger(body.seed)) {
    options.seed = body.seed;
  }
  return options;
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

/** The `stream: false` response: a whole `chat.completion`. `citations` sits on the message - where the evaluator reads it. `tools` is a separate, additive field (not part of the evaluator's contract) naming which tools the agent used this turn. */
export function toCompletionResponse(
  envelope: CompletionEnvelope,
  answer: string,
  citations: Citation[],
  tools: string[],
) {
  return {
    ...envelope,
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: answer, refusal: null, citations, tools },
        logprobs: null,
        finish_reason: "stop",
      },
    ],
  };
}

type StreamDelta = { role?: "assistant"; content?: string; tools?: string[]; citations?: Citation[] };

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

/** One extra content chunk naming which tools the agent used this turn, sent once the answer is final (right before the citations chunk) - empty array when none were used, so "none" is explicit, same convention as toCitationsChunk. */
export function toToolsChunk(envelope: CompletionEnvelope, tools: string[]): string {
  return toChunkEvent(envelope, { tools });
}

/** The last content chunk, sent once the answer is final (what to cite depends on it). Sent even when empty, so "none" is explicit. */
export function toCitationsChunk(envelope: CompletionEnvelope, citations: Citation[]): string {
  return toChunkEvent(envelope, { citations });
}

/** The closing chunk (empty delta + finish_reason) followed by the SSE terminator. */
export function toDoneChunk(envelope: CompletionEnvelope): string {
  return `${toChunkEvent(envelope, {}, "stop")}data: [DONE]\n\n`;
}

/** One SSE event for `/voice-completions`'s streaming shape - not OpenAI-shaped (there's no `object`/`choices` convention for audio), just this envelope plus a `type` discriminant. */
function toVoiceEvent(envelope: CompletionEnvelope, payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ ...envelope, ...payload })}\n\n`;
}

/** One synthesized sentence: `audioBase64`/`sampleRate` are omitted when that sentence's TTS synthesis failed - the chunk still carries its text. */
export function toVoiceAudioChunk(
  envelope: CompletionEnvelope,
  chunk: { text: string; audioBase64?: string; sampleRate?: number },
): string {
  return toVoiceEvent(envelope, { type: "audio", ...chunk });
}

/** The closing event on a successful turn: full transcript + tools + citations, then the SSE terminator. */
export function toVoiceDoneChunk(
  envelope: CompletionEnvelope,
  payload: { transcript: string; toolsUsed: string[]; citations: Citation[] },
): string {
  return `${toVoiceEvent(envelope, { type: "done", transcript: payload.transcript, tools: payload.toolsUsed, citations: payload.citations })}data: [DONE]\n\n`;
}

/** Sent instead of `toVoiceDoneChunk` when the turn fails after SSE headers are already committed (so a JSON 4xx/5xx is no longer possible) - includes the SSE terminator. */
export function toVoiceErrorChunk(envelope: CompletionEnvelope, error: string): string {
  return `${toVoiceEvent(envelope, { type: "error", error })}data: [DONE]\n\n`;
}
