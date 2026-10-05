/** Truncates to the embedding model's 2048-token window (keeping the head, where the question is) without splitting a UTF-16 surrogate pair. */
export function toRetrievalQuery(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;

  const cut = trimmed.slice(0, maxChars);
  const safeCut = isHighSurrogate(cut.charCodeAt(cut.length - 1)) ? cut.slice(0, -1) : cut;
  return safeCut.trimEnd();
}

function isHighSurrogate(charCode: number): boolean {
  return charCode >= 0xd800 && charCode <= 0xdbff;
}
