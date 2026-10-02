/**
 * The text actually embedded for one retrieval search. The embedding
 * model's window is 2048 tokens; a user message can be far longer (a pasted
 * transcript), and embedding it whole fails the whole turn ("exceeds
 * effective context size (2048)"). The start of a message is what names its
 * question, so the tail is dropped. Never splits a UTF-16 surrogate pair
 * (an emoji) in half, which would hand the tokenizer a broken character.
 */
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
