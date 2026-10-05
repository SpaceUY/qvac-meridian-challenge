import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// 5 levels up to repo root (health/ -> src/ -> backend/ -> apps/ -> root) - verified, not guessed.
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../../..");

describe("qvac-eval.json contract", () => {
  const config = JSON.parse(readFileSync(path.join(REPO_ROOT, "qvac-eval.json"), "utf-8"));

  it("baseUrl ends in /v1, so an OpenAI client's default paths (/chat/completions, /models) land on our real routes", () => {
    expect(config.baseUrl).toMatch(/\/v1$/);
  });

  it("readyPath is /models, matching the OpenAI-compatible route this backend actually gates on readiness", () => {
    expect(config.readyPath).toBe("/models");
  });

  it("baseUrl + readyPath resolves to exactly GET /v1/models", () => {
    expect(`${config.baseUrl}${config.readyPath}`).toMatch(/\/v1\/models$/);
  });
});
