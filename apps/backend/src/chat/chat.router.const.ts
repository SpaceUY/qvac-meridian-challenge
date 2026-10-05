export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;

export const MODEL_NOT_READY_ERROR = "model not ready";
export const COMPLETION_ERROR = "could not generate a response";
export const INVALID_MESSAGES_ERROR = "invalid messages";
export const INVALID_AUDIO_ERROR = "invalid audio";
export const VOICE_COMPLETION_ERROR = "could not generate a voice response";
export const EMPTY_TRANSCRIPT_ERROR = "no speech detected in audio";
export const CANCEL_PRELOAD_ERROR = "could not cancel model load";
export const INVALID_SESSION_ID_ERROR = "invalid session id";
export const DELETE_SESSION_CACHE_ERROR = "could not delete session cache";

/** The frontend mints session ids with `crypto.randomUUID()`. The id becomes a directory name in the SDK's KV cache folder, so anything else is rejected. */
export const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Per attached image, measured on the decoded byte buffer (not the base64 string, which is ~33% larger). */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Per message. Temporarily 1, not 2: 2 image attachments in one message reproducibly crashes the QVAC/llama.cpp worker. Raise back to 2 once fixed upstream. */
export const MAX_IMAGES_PER_MESSAGE = 1;
/** Sum of all images in one message, decoded. Kept below MAX_IMAGES_PER_MESSAGE × MAX_IMAGE_BYTES so this limit can fire independently of the other two. */
export const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024;

/** Public alias of the chat model, echoed as `model` when a request omits it - the same name `qvac-eval.json` declares under `models.chat`. */
export const PUBLIC_CHAT_MODEL = "meridian-assistant";
