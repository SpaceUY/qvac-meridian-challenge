/** Shared by both Bare workers (production + the I.4 spike) that call `@qvac/embed-llamacpp` directly, so they can't drift apart. */

/** Mirrors `@qvac/sdk`'s own `normalizeVector()` exactly so a native-path vector is bit-for-bit comparable to `embed()`'s output. */
export function normalizeVector(vector) {
  let sumOfSquares = 0;
  for (let i = 0; i < vector.length; i++) {
    const value = vector[i];
    if (!Number.isFinite(value)) {
      throw new Error(`normalizeVector: non-finite value at index ${i}: ${value}`);
    }
    sumOfSquares += value * value;
  }
  const magnitude = Math.sqrt(sumOfSquares);
  const EPS_ZERO = 1e-12;
  const UNIT_TOL = 1e-4;
  if (!Number.isFinite(magnitude) || magnitude < EPS_ZERO) {
    return new Array(vector.length).fill(0);
  }
  if (Math.abs(magnitude - 1) <= UNIT_TOL) {
    return Array.from(vector);
  }
  const inverseMagnitude = 1 / magnitude;
  const normalized = new Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    normalized[i] = vector[i] * inverseMagnitude;
  }
  return normalized;
}

/** For a single text input, the addon's one output event is `[vector]` - matches how `@qvac/sdk`'s own `embed()` reads `rawEmbeddings[0][0]`. */
export function extractSingleVector(rawEmbeddings) {
  const embeddingsArray = rawEmbeddings[0];
  const vector = embeddingsArray && embeddingsArray[0];
  if (!vector || vector.length === 0) {
    throw new Error("native embed call returned no embedding vector");
  }
  return vector;
}
