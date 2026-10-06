import { describe, expect, it } from "vitest";
import { createEmbeddingVectorValidator } from "./embeddingVectorValidation.js";
import { EmbeddingDimensionMismatchError, MalformedEmbeddingError } from "../domain/errors.js";

describe("createEmbeddingVectorValidator", () => {
  it("passes a well-formed vector through unchanged", () => {
    const validate = createEmbeddingVectorValidator();
    expect(validate([0.1, -0.2, 0.3])).toEqual([0.1, -0.2, 0.3]);
  });

  it("rejects an empty vector", () => {
    const validate = createEmbeddingVectorValidator();
    expect(() => validate([])).toThrow(MalformedEmbeddingError);
    expect(() => validate([])).toThrow(/empty vector/);
  });

  it("rejects a vector containing NaN or Infinity", () => {
    const validate = createEmbeddingVectorValidator();
    expect(() => validate([0.1, Number.NaN, 0.3])).toThrow(/non-finite value/);
    expect(() => createEmbeddingVectorValidator()([0.1, Number.POSITIVE_INFINITY])).toThrow(MalformedEmbeddingError);
  });

  it("locks in the dimension of the first call and rejects a later mismatch", () => {
    const validate = createEmbeddingVectorValidator();
    validate([0.1, 0.2, 0.3]);

    expect(() => validate([0.1, 0.2])).toThrow(EmbeddingDimensionMismatchError);
    expect(() => validate([0.1, 0.2])).toThrow(/expected 3, received 2/);
  });

  it("accepts further calls whose dimension keeps matching the first one", () => {
    const validate = createEmbeddingVectorValidator();
    validate([0.1, 0.2, 0.3]);

    expect(validate([0.4, 0.5, 0.6])).toEqual([0.4, 0.5, 0.6]);
  });

  it("tracks dimension independently per validator instance", () => {
    const a = createEmbeddingVectorValidator();
    const b = createEmbeddingVectorValidator();
    a([0.1, 0.2, 0.3]);

    expect(() => b([0.1, 0.2])).not.toThrow();
  });
});
