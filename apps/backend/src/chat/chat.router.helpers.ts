import { randomUUID } from "node:crypto";
import type { Response } from "express";
import sharp from "sharp";
import type { ConversationMessage } from "../ai/orchestrator/agentService.js";
import type { GenerationOptions } from "../ai/orchestrator/domain.js";
import type { ContextUsage } from "../ai/orchestrator/contextBudget.js";
import type { SupportedImageMimeType } from "../models/domain/types.js";
import type { Citation } from "../rag/domain/types.js";
import {
  INVALID_MESSAGES_ERROR,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_MESSAGE,
  MAX_TOTAL_IMAGE_BYTES,
  PUBLIC_CHAT_MODEL,
} from "./chat.router.const.js";

/** Parses the OpenAI-shaped `messages` array into `ConversationMessage[]`, dropping any `system` role (spec §4). */
export async function parseMessages(body: unknown): Promise<ConversationMessage[] | undefined> {
  const result = await parseMessageEntries(body);
  if ("error" in result) return undefined;
  return result.messages.length > 0 ? result.messages : undefined;
}

/** Same parsing as parseMessages, but an empty `messages` array is valid - the new turn arrives as audio, appended later by VoiceAgentService. */
export async function parseHistory(body: unknown): Promise<ConversationMessage[] | undefined> {
  const result = await parseMessageEntries(body);
  return "error" in result ? undefined : result.messages;
}

/** The specific reason parseMessages()/parseHistory() returned undefined - re-parses the body so their own return shape stays unchanged for other callers. */
export async function describeParseError(body: unknown): Promise<string> {
  const result = await parseMessageEntries(body);
  return "error" in result ? result.error : INVALID_MESSAGES_ERROR;
}

type ParseResult<T> = T | { error: string };

async function parseMessageEntries(
  body: unknown,
): Promise<ParseResult<{ messages: ConversationMessage[] }>> {
  if (!isRecord(body) || !Array.isArray(body.messages)) return { error: INVALID_MESSAGES_ERROR };
  const messages: ConversationMessage[] = [];
  for (const entry of body.messages) {
    if (!isRecord(entry)) return { error: INVALID_MESSAGES_ERROR };
    if (entry.role === "system") continue;
    if (entry.role !== "user" && entry.role !== "assistant") return { error: INVALID_MESSAGES_ERROR };

    const parsedContent = await parseContent(entry.content, entry.role);
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

/** `content` is a plain string or an OpenAI Vision-style array of parts; only `role: "user"` may carry an `image_url` part. */
async function parseContent(
  content: unknown,
  role: "user" | "assistant",
): Promise<ParseResult<ParsedContent>> {
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
      const image = await parseImagePart(part);
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

async function parseImagePart(
  part: Record<string, unknown>,
): Promise<ParseResult<{ mimeType: SupportedImageMimeType; data: Buffer }>> {
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
  if (detectedMimeType === "image/webp") return transcodeWebpToPng(data);
  if (!isSupportedImageMimeType(detectedMimeType)) {
    return { error: "Only JPEG or PNG images are supported" };
  }

  return { mimeType: detectedMimeType, data };
}

/** WebP is valid client input (corpus's own `pic2.png` is really WebP) but QVAC's vision model only accepts JPEG/PNG, so it's transcoded to PNG here. */
async function transcodeWebpToPng(
  data: Buffer,
): Promise<ParseResult<{ mimeType: SupportedImageMimeType; data: Buffer }>> {
  try {
    return { mimeType: "image/png", data: await sharp(data).png().toBuffer() };
  } catch {
    return { error: "Could not read this image" };
  }
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

/** Detects the real image format from its magic bytes - a declared MIME type can't be trusted (corpus's `pic2.png` is `.png`-named WebP). */
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

/** Extracts `temperature`/`seed` for deterministic reruns (req 6.1.3); an out-of-range/malformed value is silently dropped, not an error. */
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

/** Echoes the requested `model`, or the public alias if absent. */
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

/** The `stream: false` response. `citations` sits on the message, where the evaluator reads it; `tools` is additive, outside that contract. */
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

type StreamDelta = { role?: "assistant"; content?: string; tools?: string[]; citations?: Citation[]; context?: ContextUsage };

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

/** Which tools the agent used this turn, sent once the answer is final - empty array when none, so "none" is explicit. */
export function toToolsChunk(envelope: CompletionEnvelope, tools: string[]): string {
  return toChunkEvent(envelope, { tools });
}

/** The last content chunk; sent even when empty, so "none" is explicit. */
export function toCitationsChunk(envelope: CompletionEnvelope, citations: Citation[]): string {
  return toChunkEvent(envelope, { citations });
}

/** Context-window usage, sent once the answer is final; only written when the agent measured it. */
export function toContextChunk(envelope: CompletionEnvelope, context: ContextUsage): string {
  return toChunkEvent(envelope, { context });
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

/** The closing event on a successful turn: full transcript + tools + citations (+ context usage, when measured), then the SSE terminator. */
export function toVoiceDoneChunk(
  envelope: CompletionEnvelope,
  payload: { transcript: string; toolsUsed: string[]; citations: Citation[]; context?: ContextUsage },
): string {
  return `${toVoiceEvent(envelope, {
    type: "done",
    transcript: payload.transcript,
    tools: payload.toolsUsed,
    citations: payload.citations,
    ...(payload.context ? { context: payload.context } : {}),
  })}data: [DONE]\n\n`;
}

/** Sent instead of `toVoiceDoneChunk` when the turn fails after SSE headers are already committed (so a JSON 4xx/5xx is no longer possible) - includes the SSE terminator. */
export function toVoiceErrorChunk(envelope: CompletionEnvelope, error: string): string {
  return `${toVoiceEvent(envelope, { type: "error", error })}data: [DONE]\n\n`;
}

/**
 * A signal that aborts if the client hangs up before this response is
 * done - the way an OpenAI-style client cancels a request. `res`'s `close`
 * fires both then and after a normal `res.end()`; `writableEnded` tells
 * them apart (same check as the completions route). Call `dispose()` once
 * the handler is done with the response.
 */
export function abortOnClientDisconnect(res: Response): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abortIfUnfinished = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on("close", abortIfUnfinished);
  return { signal: controller.signal, dispose: () => res.off("close", abortIfUnfinished) };
}
