/** Parses and trims a request body's `text` field, rejecting empty/whitespace-only values. */
export function parseText(body: unknown): string | undefined {
  const text = isRecord(body) ? body.text : undefined;
  if (typeof text !== 'string') return undefined;
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
