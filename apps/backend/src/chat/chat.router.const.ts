export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;

export const MODEL_NOT_READY_ERROR = "model not ready";
export const COMPLETION_ERROR = "could not generate a response";
export const INVALID_MESSAGES_ERROR = "invalid messages";
