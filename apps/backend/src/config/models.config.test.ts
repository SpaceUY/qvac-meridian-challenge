import { describe, expect, it } from "vitest";
import {
  resolveEngineConfig,
  TURBOQUANT_KV_CACHE_ENGINE_CONFIG,
  type AgentModelConfig,
} from "./models.config.js";

const BASE_CONFIG: AgentModelConfig = {
  modelSource: { kind: "url", url: "https://example.test/model.gguf" },
  modelName: "fake-model",
  quantization: "Q4_0",
};

describe("resolveEngineConfig", () => {
  it("returns engineConfig unchanged when kvCacheQuantEnabled is unset", () => {
    const config: AgentModelConfig = { ...BASE_CONFIG, engineConfig: { projectionModelSrc: "src" } };
    expect(resolveEngineConfig(config)).toEqual({ projectionModelSrc: "src" });
  });

  it("returns undefined when neither engineConfig nor kvCacheQuantEnabled is set", () => {
    expect(resolveEngineConfig(BASE_CONFIG)).toBeUndefined();
  });

  it("merges the TurboQuant cache-type entries in when kvCacheQuantEnabled is true", () => {
    const config: AgentModelConfig = { ...BASE_CONFIG, kvCacheQuantEnabled: true };
    expect(resolveEngineConfig(config)).toEqual(TURBOQUANT_KV_CACHE_ENGINE_CONFIG);
  });

  it("merges TurboQuant on top of an existing engineConfig without dropping other keys", () => {
    const config: AgentModelConfig = {
      ...BASE_CONFIG,
      engineConfig: { projectionModelSrc: "src" },
      kvCacheQuantEnabled: true,
    };
    expect(resolveEngineConfig(config)).toEqual({
      projectionModelSrc: "src",
      ...TURBOQUANT_KV_CACHE_ENGINE_CONFIG,
    });
  });

  it("does not merge TurboQuant when kvCacheQuantEnabled is explicitly false", () => {
    const config: AgentModelConfig = {
      ...BASE_CONFIG,
      engineConfig: { projectionModelSrc: "src" },
      kvCacheQuantEnabled: false,
    };
    expect(resolveEngineConfig(config)).toEqual({ projectionModelSrc: "src" });
  });

  it("merges parallel into engineConfig when maxConcurrency is greater than 1", () => {
    const config: AgentModelConfig = { ...BASE_CONFIG, maxConcurrency: 2 };
    expect(resolveEngineConfig(config)).toEqual({ parallel: 2 });
  });

  it("does not add parallel when maxConcurrency is 1", () => {
    const config: AgentModelConfig = { ...BASE_CONFIG, maxConcurrency: 1 };
    expect(resolveEngineConfig(config)).toBeUndefined();
  });

  it("does not add parallel when maxConcurrency is unset", () => {
    expect(resolveEngineConfig(BASE_CONFIG)).toBeUndefined();
  });

  it("merges parallel alongside an existing engineConfig and TurboQuant", () => {
    const config: AgentModelConfig = {
      ...BASE_CONFIG,
      engineConfig: { projectionModelSrc: "src" },
      kvCacheQuantEnabled: true,
      maxConcurrency: 2,
    };
    expect(resolveEngineConfig(config)).toEqual({
      projectionModelSrc: "src",
      ...TURBOQUANT_KV_CACHE_ENGINE_CONFIG,
      parallel: 2,
    });
  });
});
