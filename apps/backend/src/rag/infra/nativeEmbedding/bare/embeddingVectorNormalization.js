/**
 * Shared by both Bare workers that call `@qvac/embed-llamacpp` directly:
 * the production persistent worker (`embedServer.js`, this directory) and
 * the I.4 spike's one-shot worker
 * (`experiments/native-embed-spike/bare/embedWorker.js`). Previously
 * duplicated byte-for-byte between the two - factored out here so the two
 * workers can't silently drift apart.
 */

/**
 * Mirrors `@qvac/sdk`'s `dist/server/bare/ops/embed.js` `normalizeVector()`
 * exactly (L2-normalize, snap-to-unit tolerance, zero-vector guard) so a
 * native-path vector is bit-for-bit comparable to what `embed()` returns
 * for the same model/config/text.
 */
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

/**
 * `run(text)` -> `response.await()` resolves to `response.output` (an array
 * of native "Output" events). For the embeddings addon there is exactly one
 * event, and its data is `[vector]` (single string input) - see
 * `@qvac/sdk`'s own `embed()` op, which reads `rawEmbeddings[0][0]` the same
 * way for a non-batch call.
 */
export function extractSingleVector(rawEmbeddings) {
  const embeddingsArray = rawEmbeddings[0];
  const vector = embeddingsArray && embeddingsArray[0];
  if (!vector || vector.length === 0) {
    throw new Error("native embed call returned no embedding vector");
  }
  return vector;
}
